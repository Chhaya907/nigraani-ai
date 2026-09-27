import "dotenv/config";
import { getDb } from "../db";
import { runFullAiEvaluation } from "./anomalyService";
import { projects, anomalies, riskAssessments, cases, auditLogs } from "../../drizzle/schema";

async function main() {
  console.log("==================================================");
  console.log("STEP 3: RUNNING REAL AI/ML ANOMALY EVALUATION");
  console.log("==================================================");

  const db = await getDb();
  if (!db) {
    console.error("FATAL: Database connection unavailable.");
    process.exit(1);
  }

  console.log("\n[1/3] Executing AI ML engines on official MPLADS records...");
  const assessments = await runFullAiEvaluation("MoSPI Automated AI Audit Subsystem");
  console.log(`Evaluated ${assessments.length} projects successfully.\n`);

  console.log("[2/3] Project AI Assessment Results:");
  console.log("--------------------------------------------------------------------------------");
  for (const a of assessments) {
    console.log(`Project: [${a.projectCode}] ${a.title.substring(0, 50)}...`);
    console.log(`  Source Type: ${a.sourceType}`);
    console.log(`  Composite Risk Score: ${a.compositeRiskScore}/100 [Level: ${a.riskLevel}]`);
    console.log(`  Signals:`);
    console.log(`    - Duplicate Work (${a.signals.duplicateWork.model}): Status=${a.signals.duplicateWork.status}, Score=${a.signals.duplicateWork.score}`);
    console.log(`    - Fund Movement (${a.signals.fundMovement.model}): Status=${a.signals.fundMovement.status}, Score=${a.signals.fundMovement.score} (Training: ${a.signals.fundMovement.trainingDataType})`);
    console.log(`    - Delay Risk (${a.signals.delayRisk.model}): Status=${a.signals.delayRisk.status}, Predicted=${a.signals.delayRisk.predictedClass} (Confidence: ${(a.signals.delayRisk.confidence * 100).toFixed(0)}%), Score=${a.signals.delayRisk.score}`);
    console.log(`    - Evidence Reuse (${a.signals.evidenceReuse.model}): Status=${a.signals.evidenceReuse.status}`);
    console.log(`  Anomalies Flagged: ${a.anomaliesDetected} | Case Created: ${a.caseOpened ? "YES" : "NO"}`);
    console.log("--------------------------------------------------------------------------------");
  }

  console.log("\n[3/3] Database Verification:");
  const allAnomalies = await db.select().from(anomalies);
  const allRiskAssessments = await db.select().from(riskAssessments);
  const allCases = await db.select().from(cases);
  const allAudit = await db.select().from(auditLogs);
  const updatedProjects = await db.select().from(projects);

  console.log(`- Rows in 'projects' table: ${updatedProjects.length}`);
  console.log(`- Rows in 'anomalies' table: ${allAnomalies.length}`);
  console.log(`- Rows in 'risk_assessments' table: ${allRiskAssessments.length}`);
  console.log(`- Rows in 'cases' table: ${allCases.length}`);
  console.log(`- Rows in 'audit_logs' table: ${allAudit.length}`);

  console.log("\nTop Risk Projects (Sorted by AI Risk Score):");
  const sorted = [...updatedProjects].sort((a, b) => b.riskScore - a.riskScore);
  sorted.forEach((p, idx) => {
    console.log(`  ${idx + 1}. [${p.projectCode}] Risk: ${p.riskScore}/100 (${p.riskLevel}) | Status: ${p.status} | ${p.district}, ${p.state}`);
  });

  console.log("\n==================================================");
  console.log("STEP 3 AI/ML PIPELINE COMPLETED AND VERIFIED");
  console.log("==================================================");

  process.exit(0);
}

main().catch(err => {
  console.error("AI Evaluation failed:", err);
  process.exit(1);
});
