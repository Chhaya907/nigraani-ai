import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  projects,
  expenditures,
  evidence,
  projectUpdates,
  anomalies,
  riskAssessments,
  cases,
  auditLogs,
  InsertAnomaly,
  InsertRiskAssessment,
  InsertCase,
  InsertAuditLog,
} from "../../drizzle/schema";
import { semanticSimilarityEngine, DuplicateDetectionResult } from "../ml/embedding";
import { isolationForestEngine, FundMovementResult } from "../ml/isolationForest";
import { randomForestEngine, DelayRiskResult } from "../ml/randomForest";
import { perceptualHashEngine, EvidenceReuseResult } from "../ml/perceptualHash";
import { nanoid } from "nanoid";

export interface ProjectAiAssessment {
  projectCode: string;
  title: string;
  sourceType: "OFFICIAL_PUBLIC" | "OPERATIONAL_UPDATE" | "DEMO_AUGMENTATION";
  compositeRiskScore: number;
  riskLevel: "Low" | "Medium" | "High";
  signals: {
    duplicateWork: {
      status: "NORMAL" | "POTENTIAL_ANOMALY" | "INSUFFICIENT_DATA";
      score: number;
      explanation: string;
      comparedProject?: string;
      model: string;
    };
    fundMovement: {
      status: "NORMAL" | "POTENTIAL_ANOMALY" | "INSUFFICIENT_DATA";
      score: number;
      explanation: string;
      topDriver?: string;
      model: string;
      trainingDataType: string;
    };
    delayRisk: {
      status: "NORMAL" | "POTENTIAL_ANOMALY" | "INSUFFICIENT_DATA";
      score: number;
      predictedClass: string;
      confidence: number;
      explanation: string;
      featureImportances?: Record<string, number>;
      model: string;
      trainingDataType: string;
    };
    evidenceReuse: {
      status: "NORMAL" | "POTENTIAL_ANOMALY" | "INSUFFICIENT_DATA";
      score: number;
      explanation: string;
      matchedEvidence?: string;
      model: string;
    };
  };
  anomaliesDetected: number;
  caseOpened: boolean;
}

/**
 * Calculates deterministic composite risk score from real ML module outputs.
 * Range: 0 to 100.
 * Weights:
 * - Duplicate Work: 30%
 * - Fund Movement: 25%
 * - Delay Risk: 25%
 * - Evidence Reuse: 20%
 */
export function calculateCompositeRiskScore(
  duplicateScore: number,
  fundScore: number,
  delayScore: number,
  reuseScore: number
): { compositeScore: number; riskLevel: "Low" | "Medium" | "High" } {
  // Pure deterministic arithmetic - zero randomness
  const weightedSum =
    (duplicateScore * 30.0) +
    (fundScore * 25.0) +
    (delayScore * 25.0) +
    (reuseScore * 20.0);

  const compositeScore = Math.max(0, Math.min(100, Math.round(weightedSum)));

  let riskLevel: "Low" | "Medium" | "High" = "Low";
  if (compositeScore >= 71) {
    riskLevel = "High";
  } else if (compositeScore >= 31) {
    riskLevel = "Medium";
  }

  return { compositeScore, riskLevel };
}

/**
 * Runs the full AI evaluation pipeline on official projects.
 * Persists results to MySQL: anomalies, risk_assessments, cases, projects.
 */
export async function runFullAiEvaluation(initiatedBy: string = "MoSPI AI Engine"): Promise<ProjectAiAssessment[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("[Anomaly Service] Database unavailable");
  }

  // Fetch all official projects
  const allProjects = await db.select().from(projects);
  const allExpenditures = await db.select().from(expenditures);
  const allEvidence = await db.select().from(evidence).where(eq(evidence.isActive, true));
  const allUpdates = await db.select().from(projectUpdates);

  // Clear prior anomaly flags before fresh evaluation for idempotency
  await db.delete(anomalies);

  const assessments: ProjectAiAssessment[] = [];

  // 1. Run Duplicate Work Semantic Scan across all project pairs
  const duplicateResults = semanticSimilarityEngine.scanAll(
    allProjects.map(p => ({
      projectCode: p.projectCode,
      title: p.title,
      description: p.description,
      state: p.state,
      district: p.district,
      category: p.category,
    })),
    0.65 // Configurable threshold
  );

  const duplicateResultsMap = new Map<string, DuplicateDetectionResult>();
  for (const anom of duplicateResults) {
    if (!duplicateResultsMap.has(anom.projectA)) {
      duplicateResultsMap.set(anom.projectA, anom);
    }
    if (!duplicateResultsMap.has(anom.projectB)) {
      duplicateResultsMap.set(anom.projectB, anom);
    }
  }

  // 2. Evaluate each project with the 4 genuine ML models
  for (const proj of allProjects) {
    const projExps = allExpenditures.filter(e => e.projectId === proj.id || e.projectCode === proj.projectCode);
    const projUpdates = allUpdates.filter(u => u.projectId === proj.id || u.projectCode === proj.projectCode);
    const projEvidence = allEvidence.filter(ev => ev.projectId === proj.id || ev.projectCode === proj.projectCode);

    // Module 1: Duplicate Work (Semantic Similarity)
    const dupRes = duplicateResultsMap.get(proj.projectCode);
    const dupScore = dupRes ? dupRes.score : 0.0;
    const dupStatus = dupRes ? dupRes.status : "NORMAL";
    const dupExplanation = dupRes
      ? dupRes.explanation
      : "No semantic scope overlap detected with other catalogued MPLADS works.";

    // Module 2: Fund Movement (Isolation Forest)
    const fundRes: FundMovementResult = isolationForestEngine.predict(
      {
        projectCode: proj.projectCode,
        sanctionedAmount: proj.sanctionedAmount,
        spentAmount: proj.spentAmount,
      },
      projExps.map(e => ({ amount: e.amount, voucherNo: e.voucherNo }))
    );

    // Module 3: Delay Risk (Random Forest)
    const delayRes: DelayRiskResult = randomForestEngine.predict(
      {
        projectCode: proj.projectCode,
        status: proj.status,
        progress: proj.progress,
        sanctionedAmount: proj.sanctionedAmount,
        spentAmount: proj.spentAmount,
        startDate: proj.startDate,
      },
      projUpdates.map(u => ({ newProgress: u.newProgress, createdAt: u.createdAt }))
    );

    // Module 4: Evidence Reuse (Perceptual Image Hashing)
    let reuseRes: EvidenceReuseResult;
    if (projEvidence.length > 0) {
      reuseRes = perceptualHashEngine.scanForReuse(
        {
          evidenceCode: projEvidence[0].evidenceCode,
          projectCode: proj.projectCode,
          title: projEvidence[0].title,
          perceptualHash: projEvidence[0].perceptualHash,
        },
        allEvidence.map(e => ({
          evidenceCode: e.evidenceCode,
          projectCode: e.projectCode,
          title: e.title,
          perceptualHash: e.perceptualHash,
        }))
      );
    } else {
      reuseRes = {
        module: "EVIDENCE_REUSE",
        model: "Image Similarity (Perceptual Hash dHash/aHash)",
        modelVersion: "v1.0-dHash64",
        evidenceCode: "N/A",
        projectCode: proj.projectCode,
        status: "INSUFFICIENT_DATA",
        score: 0.0,
        maxAllowedDistance: 10,
        isAnomaly: false,
        explanation:
          "No photographic evidence has been uploaded for this project yet. " +
          "Perceptual hashing will execute automatically upon file upload.",
        matchedEvidence: null,
      };
    }

    // Composite Risk Score Calculation
    const { compositeScore, riskLevel } = calculateCompositeRiskScore(
      dupScore,
      fundRes.score,
      delayRes.score,
      reuseRes.score
    );

    // Update project table with AI computed risk
    await db
      .update(projects)
      .set({
        riskScore: compositeScore,
        riskLevel,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, proj.id));

    // Persist Risk Assessment Record (idempotent: delete previous assessment for this project)
    await db.delete(riskAssessments).where(eq(riskAssessments.projectId, proj.id));
    const riskAssessmentData: InsertRiskAssessment = {
      projectId: proj.id,
      projectCode: proj.projectCode,
      compositeScore,
      riskLevel,
      duplicateWorkScore: dupScore,
      fundMovementScore: fundRes.score,
      delayRiskScore: delayRes.score,
      evidenceReuseScore: reuseRes.score,
      explainableFactors: {
        duplicateExplanation: dupExplanation,
        fundMovementExplanation: fundRes.explanation,
        delayRiskExplanation: delayRes.explanation,
        evidenceReuseExplanation: reuseRes.explanation,
        features: {
          fund: fundRes.features || null,
          delay: delayRes.features || null,
          delayImportances: delayRes.featureImportances || null,
        },
      },
      sourceType: proj.sourceType,
    };
    await db.insert(riskAssessments).values(riskAssessmentData);

    // Persist Individual Anomalies if detected (deterministic anomaly codes for repeatability)
    let anomalyCount = 0;

    if (dupRes && dupRes.isAnomaly) {
      anomalyCount++;
      const anomalyInsert: InsertAnomaly = {
        anomalyCode: `ANOM-DUP-${proj.projectCode}`,
        projectId: proj.id,
        projectCode: proj.projectCode,
        moduleType: "DUPLICATE_WORK",
        severity: dupScore > 0.80 ? "High" : "Medium",
        score: dupScore,
        flaggedText: `Semantic similarity ${dupScore.toFixed(3)} with ${dupRes.projectB === proj.projectCode ? dupRes.projectA : dupRes.projectB}`,
        reasoning: dupExplanation,
        status: "FLAGGED",
        detectionMetadata: { matchedProject: dupRes.projectB, modelVersion: dupRes.modelVersion },
        sourceType: proj.sourceType,
      };
      await db.insert(anomalies).values(anomalyInsert).onConflictDoUpdate({
        target: anomalies.anomalyCode,
        set: { score: dupScore, reasoning: dupExplanation, severity: anomalyInsert.severity, updatedAt: new Date() },
      });
    }

    if (fundRes.isAnomaly) {
      anomalyCount++;
      const anomalyInsert: InsertAnomaly = {
        anomalyCode: `ANOM-FUND-${proj.projectCode}`,
        projectId: proj.id,
        projectCode: proj.projectCode,
        moduleType: "FUND_MOVEMENT",
        severity: fundRes.score > 0.75 ? "High" : "Medium",
        score: fundRes.score,
        flaggedText: `Isolation Forest flagged fund movement trajectory (score: ${fundRes.score})`,
        reasoning: fundRes.explanation,
        status: "FLAGGED",
        detectionMetadata: { features: fundRes.features, topDriver: fundRes.topDriver },
        sourceType: proj.sourceType,
      };
      await db.insert(anomalies).values(anomalyInsert).onConflictDoUpdate({
        target: anomalies.anomalyCode,
        set: { score: fundRes.score, reasoning: fundRes.explanation, severity: anomalyInsert.severity, updatedAt: new Date() },
      });
    }

    if (delayRes.isAnomaly) {
      anomalyCount++;
      const anomalyInsert: InsertAnomaly = {
        anomalyCode: `ANOM-DELAY-${proj.projectCode}`,
        projectId: proj.id,
        projectCode: proj.projectCode,
        moduleType: "DELAY_RISK",
        severity: delayRes.predictedClass === "DELAYED" ? "High" : "Medium",
        score: delayRes.score,
        flaggedText: `Random Forest predicted ${delayRes.predictedClass} with ${(delayRes.confidence * 100).toFixed(1)}% confidence`,
        reasoning: delayRes.explanation,
        status: "FLAGGED",
        detectionMetadata: { importances: delayRes.featureImportances, features: delayRes.features },
        sourceType: proj.sourceType,
      };
      await db.insert(anomalies).values(anomalyInsert).onConflictDoUpdate({
        target: anomalies.anomalyCode,
        set: { score: delayRes.score, reasoning: delayRes.explanation, severity: anomalyInsert.severity, updatedAt: new Date() },
      });
    }

    if (reuseRes.isAnomaly) {
      anomalyCount++;
      const anomalyInsert: InsertAnomaly = {
        anomalyCode: `ANOM-IMG-${proj.projectCode}`,
        projectId: proj.id,
        projectCode: proj.projectCode,
        moduleType: "EVIDENCE_REUSE",
        severity: "Critical",
        score: reuseRes.score,
        flaggedText: `Perceptual hash distance ${reuseRes.hammingDistance}/64 matches prior photo`,
        reasoning: reuseRes.explanation,
        status: "FLAGGED",
        detectionMetadata: { matchedEvidence: reuseRes.matchedEvidence },
        sourceType: proj.sourceType,
      };
      await db.insert(anomalies).values(anomalyInsert).onConflictDoUpdate({
        target: anomalies.anomalyCode,
        set: { score: reuseRes.score, reasoning: reuseRes.explanation, severity: anomalyInsert.severity, updatedAt: new Date() },
      });
    }

    // Human Review Escalation: If risk level is High (or Medium with anomalies), open/update a formal Case
    let caseOpened = false;
    if (compositeScore >= 45 || anomalyCount > 0) {
      const caseCode = `CASE-${proj.projectCode}`;
      const caseInsert: InsertCase = {
        caseNumber: caseCode,
        projectId: proj.id,
        projectCode: proj.projectCode,
        title: `AI Risk Review: ${proj.title.substring(0, 60)}...`,
        description: `Composite Risk Score: ${compositeScore}/100 (${riskLevel}). Detected ${anomalyCount} anomaly signal(s). Initiated for District Authority review.`,
        priority: compositeScore >= 70 ? "High" : "Medium",
        status: "OPEN",
        assignedRole: "district",
        assignedDistrict: proj.district,
        assignedState: proj.state,
        openedBy: initiatedBy,
        sourceType: proj.sourceType,
      };
      await db.insert(cases).values(caseInsert).onConflictDoUpdate({
        target: cases.caseNumber,
        set: { priority: caseInsert.priority, description: caseInsert.description, updatedAt: new Date() },
      });
      caseOpened = true;
    }

    // Record Audit Trail for AI assessment
    const auditData: InsertAuditLog = {
      auditCode: `AUD-AI-${nanoid(8).toUpperCase()}`,
      userName: initiatedBy,
      userRole: "mospi",
      action: "AI_RISK_ASSESSMENT_COMPLETED",
      projectId: proj.id,
      projectCode: proj.projectCode,
      targetId: proj.projectCode,
      targetType: "project",
      fieldChanged: "riskScore",
      oldValue: "0",
      newValue: String(compositeScore),
      comments: `AI Assessment: Risk Score ${compositeScore}/100 (${riskLevel}). Signals: Dup=${dupStatus}, Fund=${fundRes.status}, Delay=${delayRes.status}, Reuse=${reuseRes.status}`,
      sourceType: proj.sourceType,
    };
    await db.insert(auditLogs).values(auditData);

    assessments.push({
      projectCode: proj.projectCode,
      title: proj.title,
      sourceType: proj.sourceType,
      compositeRiskScore: compositeScore,
      riskLevel,
      signals: {
        duplicateWork: {
          status: dupStatus,
          score: dupScore,
          explanation: dupExplanation,
          comparedProject: dupRes?.projectB,
          model: "Semantic Similarity (NLP Vector Embedding)",
        },
        fundMovement: {
          status: fundRes.status,
          score: fundRes.score,
          explanation: fundRes.explanation,
          topDriver: fundRes.topDriver,
          model: "Isolation Forest",
          trainingDataType: fundRes.trainingDataType,
        },
        delayRisk: {
          status: delayRes.status,
          score: delayRes.score,
          predictedClass: delayRes.predictedClass,
          confidence: delayRes.confidence,
          explanation: delayRes.explanation,
          featureImportances: delayRes.featureImportances,
          model: "Random Forest Classifier",
          trainingDataType: delayRes.trainingDataType,
        },
        evidenceReuse: {
          status: reuseRes.status,
          score: reuseRes.score,
          explanation: reuseRes.explanation,
          matchedEvidence: reuseRes.matchedEvidence?.evidenceCode,
          model: "Image Similarity (Perceptual Hash dHash/aHash)",
        },
      },
      anomaliesDetected: anomalyCount,
      caseOpened,
    });
  }

  return assessments;
}

/**
 * Re-evaluates a single project after an operational update or new evidence.
 * Deterministically executes all 4 ML engines, updates risk_assessments, anomalies, and cases.
 */
export async function evaluateSingleProject(
  projectCode: string,
  initiatedBy: string = "Operational Update"
): Promise<ProjectAiAssessment> {
  const db = await getDb();
  if (!db) {
    throw new Error("[Anomaly Service] Database unavailable");
  }

  const [proj] = await db.select().from(projects).where(eq(projects.projectCode, projectCode));
  if (!proj) {
    throw new Error(`[Anomaly Service] Project not found: ${projectCode}`);
  }

  const allProjects = await db.select().from(projects);
  const allExpenditures = await db.select().from(expenditures);
  const allEvidence = await db.select().from(evidence).where(eq(evidence.isActive, true));
  const allUpdates = await db.select().from(projectUpdates);

  const projExps = allExpenditures.filter(e => e.projectId === proj.id || e.projectCode === proj.projectCode);
  const projUpdates = allUpdates.filter(u => u.projectId === proj.id || u.projectCode === proj.projectCode);
  const projEvidence = allEvidence.filter(ev => ev.projectId === proj.id || ev.projectCode === proj.projectCode);

  // Module 1: Duplicate Work (Semantic Similarity)
  const duplicateResults = semanticSimilarityEngine.scanAll(
    allProjects.map(p => ({
      projectCode: p.projectCode,
      title: p.title,
      description: p.description,
      state: p.state,
      district: p.district,
      category: p.category,
    })),
    0.65
  );

  const match = duplicateResults.find(d => d.projectA === proj.projectCode || d.projectB === proj.projectCode);
  const dupScore = match ? match.score : 0.0;
  const dupStatus = match ? match.status : "NORMAL";
  const dupExplanation = match
    ? match.explanation
    : "No semantic scope overlap detected with other catalogued MPLADS works.";

  // Module 2: Fund Movement (Isolation Forest)
  const fundRes: FundMovementResult = isolationForestEngine.predict(
    {
      projectCode: proj.projectCode,
      sanctionedAmount: proj.sanctionedAmount,
      spentAmount: proj.spentAmount,
    },
    projExps.map(e => ({ amount: e.amount, voucherNo: e.voucherNo }))
  );

  // Module 3: Delay Risk (Random Forest)
  const delayRes: DelayRiskResult = randomForestEngine.predict(
    {
      projectCode: proj.projectCode,
      status: proj.status,
      progress: proj.progress,
      sanctionedAmount: proj.sanctionedAmount,
      spentAmount: proj.spentAmount,
      startDate: proj.startDate,
    },
    projUpdates.map(u => ({ newProgress: u.newProgress, createdAt: u.createdAt }))
  );

  // Module 4: Evidence Reuse (Perceptual Image Hashing)
  let reuseRes: EvidenceReuseResult;
  if (projEvidence.length > 0) {
    let mostAnomalous: EvidenceReuseResult | null = null;
    for (const ev of projEvidence) {
      const res = perceptualHashEngine.scanForReuse(
        {
          evidenceCode: ev.evidenceCode,
          projectCode: proj.projectCode,
          title: ev.title,
          perceptualHash: ev.perceptualHash,
        },
        allEvidence.map(e => ({
          evidenceCode: e.evidenceCode,
          projectCode: e.projectCode,
          title: e.title,
          perceptualHash: e.perceptualHash,
        }))
      );
      if (!mostAnomalous || res.score > mostAnomalous.score) {
        mostAnomalous = res;
      }
    }
    reuseRes = mostAnomalous!;
  } else {
    reuseRes = {
      module: "EVIDENCE_REUSE",
      model: "Image Similarity (Perceptual Hash dHash/aHash)",
      modelVersion: "v1.0-dHash64",
      evidenceCode: "N/A",
      projectCode: proj.projectCode,
      status: "INSUFFICIENT_DATA",
      score: 0.0,
      maxAllowedDistance: 10,
      isAnomaly: false,
      explanation:
        "No photographic evidence has been uploaded for this project yet. " +
        "Perceptual hashing will execute automatically upon file upload.",
      matchedEvidence: null,
    };
  }

  // Composite Risk Score Calculation
  const { compositeScore, riskLevel } = calculateCompositeRiskScore(
    dupScore,
    fundRes.score,
    delayRes.score,
    reuseRes.score
  );

  // Update project table with AI computed risk
  await db
    .update(projects)
    .set({
      riskScore: compositeScore,
      riskLevel,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, proj.id));

  // Persist Risk Assessment Record
  await db.delete(riskAssessments).where(eq(riskAssessments.projectId, proj.id));
  const riskAssessmentData: InsertRiskAssessment = {
    projectId: proj.id,
    projectCode: proj.projectCode,
    compositeScore,
    riskLevel,
    duplicateWorkScore: dupScore,
    fundMovementScore: fundRes.score,
    delayRiskScore: delayRes.score,
    evidenceReuseScore: reuseRes.score,
    explainableFactors: {
      duplicateExplanation: dupExplanation,
      fundMovementExplanation: fundRes.explanation,
      delayRiskExplanation: delayRes.explanation,
      evidenceReuseExplanation: reuseRes.explanation,
      features: {
        fund: fundRes.features || null,
        delay: delayRes.features || null,
        delayImportances: delayRes.featureImportances || null,
      },
    },
    sourceType: "OPERATIONAL_UPDATE",
  };
  await db.insert(riskAssessments).values(riskAssessmentData);

  // Clean prior anomalies for this project and re-insert
  await db.delete(anomalies).where(eq(anomalies.projectId, proj.id));

  let anomalyCount = 0;
  if (match && match.isAnomaly) {
    anomalyCount++;
    await db.insert(anomalies).values({
      anomalyCode: `ANOM-DUP-${proj.projectCode}`,
      projectId: proj.id,
      projectCode: proj.projectCode,
      moduleType: "DUPLICATE_WORK",
      severity: dupScore > 0.80 ? "High" : "Medium",
      score: dupScore,
      flaggedText: `Semantic similarity ${dupScore.toFixed(3)} with ${match.projectB === proj.projectCode ? match.projectA : match.projectB}`,
      reasoning: dupExplanation,
      status: "FLAGGED",
      detectionMetadata: { matchedProject: match.projectB, modelVersion: match.modelVersion },
      sourceType: "OPERATIONAL_UPDATE",
    });
  }

  if (fundRes.isAnomaly) {
    anomalyCount++;
    await db.insert(anomalies).values({
      anomalyCode: `ANOM-FUND-${proj.projectCode}`,
      projectId: proj.id,
      projectCode: proj.projectCode,
      moduleType: "FUND_MOVEMENT",
      severity: fundRes.score > 0.75 ? "High" : "Medium",
      score: fundRes.score,
      flaggedText: `Isolation Forest flagged fund movement trajectory (score: ${fundRes.score})`,
      reasoning: fundRes.explanation,
      status: "FLAGGED",
      detectionMetadata: { features: fundRes.features, topDriver: fundRes.topDriver },
      sourceType: "OPERATIONAL_UPDATE",
    });
  }

  if (delayRes.isAnomaly) {
    anomalyCount++;
    await db.insert(anomalies).values({
      anomalyCode: `ANOM-DELAY-${proj.projectCode}`,
      projectId: proj.id,
      projectCode: proj.projectCode,
      moduleType: "DELAY_RISK",
      severity: delayRes.predictedClass === "DELAYED" ? "High" : "Medium",
      score: delayRes.score,
      flaggedText: `Random Forest predicted ${delayRes.predictedClass} with ${(delayRes.confidence * 100).toFixed(1)}% confidence`,
      reasoning: delayRes.explanation,
      status: "FLAGGED",
      detectionMetadata: { importances: delayRes.featureImportances, features: delayRes.features },
      sourceType: "OPERATIONAL_UPDATE",
    });
  }

  if (reuseRes.isAnomaly) {
    anomalyCount++;
    await db.insert(anomalies).values({
      anomalyCode: `ANOM-IMG-${proj.projectCode}`,
      projectId: proj.id,
      projectCode: proj.projectCode,
      moduleType: "EVIDENCE_REUSE",
      severity: "Critical",
      score: reuseRes.score,
      flaggedText: `Perceptual hash distance ${reuseRes.hammingDistance}/64 matches prior photo`,
      reasoning: reuseRes.explanation,
      status: "FLAGGED",
      detectionMetadata: { matchedEvidence: reuseRes.matchedEvidence },
      sourceType: "OPERATIONAL_UPDATE",
    });
  }

  // Create or update Case if risk level is Medium/High or anomaly detected
  let caseOpened = false;
  if (compositeScore >= 45 || anomalyCount > 0) {
    const caseCode = `CASE-${proj.projectCode}`;
    const [existingCase] = await db.select().from(cases).where(eq(cases.caseNumber, caseCode));
    if (existingCase) {
      await db
        .update(cases)
        .set({
          priority: compositeScore >= 70 ? "High" : "Medium",
          description: `Composite Risk Score: ${compositeScore}/100 (${riskLevel}). Detected ${anomalyCount} anomaly signal(s). Operational update re-evaluated.`,
          updatedAt: new Date(),
        })
        .where(eq(cases.id, existingCase.id));
    } else {
      await db.insert(cases).values({
        caseNumber: caseCode,
        projectId: proj.id,
        projectCode: proj.projectCode,
        title: `AI Risk Review: ${proj.title.substring(0, 60)}...`,
        description: `Composite Risk Score: ${compositeScore}/100 (${riskLevel}). Detected ${anomalyCount} anomaly signal(s). Initiated for District Authority review.`,
        priority: compositeScore >= 70 ? "High" : "Medium",
        status: "OPEN",
        assignedRole: "district",
        assignedDistrict: proj.district,
        assignedState: proj.state,
        openedBy: initiatedBy,
        sourceType: "OPERATIONAL_UPDATE",
      });
    }
    caseOpened = true;
  }

  // Record Audit Trail for Re-evaluation
  const auditData: InsertAuditLog = {
    auditCode: `AUD-AI-${nanoid(8).toUpperCase()}`,
    userName: initiatedBy,
    userRole: "district",
    action: "AI_RE_EVALUATION_COMPLETED",
    projectId: proj.id,
    projectCode: proj.projectCode,
    targetId: proj.projectCode,
    targetType: "project",
    fieldChanged: "riskScore",
    oldValue: String(proj.riskScore),
    newValue: String(compositeScore),
    comments: `Project re-evaluated after update: Risk Score ${compositeScore}/100 (${riskLevel}). Signals: Dup=${dupStatus}, Fund=${fundRes.status}, Delay=${delayRes.status}, Reuse=${reuseRes.status}`,
    sourceType: "OPERATIONAL_UPDATE",
  };
  await db.insert(auditLogs).values(auditData);

  return {
    projectCode: proj.projectCode,
    title: proj.title,
    sourceType: "OPERATIONAL_UPDATE",
    compositeRiskScore: compositeScore,
    riskLevel,
    signals: {
      duplicateWork: {
        status: dupStatus,
        score: dupScore,
        explanation: dupExplanation,
        comparedProject: match?.projectB,
        model: "Semantic Similarity (NLP Vector Embedding)",
      },
      fundMovement: {
        status: fundRes.status,
        score: fundRes.score,
        explanation: fundRes.explanation,
        topDriver: fundRes.topDriver,
        model: "Isolation Forest",
        trainingDataType: fundRes.trainingDataType,
      },
      delayRisk: {
        status: delayRes.status,
        score: delayRes.score,
        predictedClass: delayRes.predictedClass,
        confidence: delayRes.confidence,
        explanation: delayRes.explanation,
        featureImportances: delayRes.featureImportances,
        model: "Random Forest Classifier",
        trainingDataType: delayRes.trainingDataType,
      },
      evidenceReuse: {
        status: reuseRes.status,
        score: reuseRes.score,
        explanation: reuseRes.explanation,
        matchedEvidence: reuseRes.matchedEvidence?.evidenceCode,
        model: "Image Similarity (Perceptual Hash dHash/aHash)",
      },
    },
    anomaliesDetected: anomalyCount,
    caseOpened,
  };
}
