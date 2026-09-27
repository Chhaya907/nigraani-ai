import { getDb } from "../db";
import {
  projects,
  anomalies,
  riskAssessments,
  cases,
  auditLogs,
  Project,
  Anomaly,
  RiskAssessment,
  Case,
  AuditLog,
} from "../../drizzle/schema";
import {
  getRoleSnapshot,
  ROLE_DEFINITIONS,
  type RoleKey,
  type DashboardSnapshot,
  type TableRow,
  type ActivityItem,
  type Kpi,
  type SignalModuleStat,
} from "../../shared/monitoring";

function formatInr(amount: number): string {
  if (amount >= 10_000_000) {
    return `₹${(amount / 10_000_000).toFixed(2)} Cr`;
  }
  if (amount >= 100_000) {
    return `₹${(amount / 100_000).toFixed(1)} L`;
  }
  return `₹${amount.toLocaleString("en-IN")}`;
}

export async function buildLiveSnapshot(role: RoleKey): Promise<DashboardSnapshot> {
  const defaultSnapshot = getRoleSnapshot(role);
  const db = await getDb();
  if (!db) {
    return defaultSnapshot;
  }

  try {
    const allProjects = await db.select().from(projects);
    if (allProjects.length === 0) {
      return defaultSnapshot;
    }

    const allAnomalies = await db.select().from(anomalies);
    const allRiskAssessments = await db.select().from(riskAssessments);
    const allCases = await db.select().from(cases);
    const allAuditLogs = await db.select().from(auditLogs);

    // 1. Filter projects by authorized role scope
    let scopedProjects = allProjects;
    if (role === "state") {
      scopedProjects = allProjects.filter(p => p.state === "Maharashtra" || p.district === "Wardha" || p.district === "Pune");
    } else if (role === "district") {
      scopedProjects = allProjects.filter(p => p.district === "Barwani" || p.district === "Wardha");
    } else if (role === "mp") {
      scopedProjects = allProjects.filter(p => p.district === "Wardha" || p.constituency?.includes("Wardha"));
    }
    // MoSPI and CAG have broad national/audit access to all authorized records
    if (scopedProjects.length === 0) {
      scopedProjects = allProjects;
    }

    // 2. Build project rows with genuine AI and database values
    const rows: TableRow[] = scopedProjects.map(p => {
      const projAnomalies = allAnomalies.filter(a => a.projectId === p.id || a.projectCode === p.projectCode);
      const assessment = allRiskAssessments.find(r => r.projectId === p.id || r.projectCode === p.projectCode);

      let aiReasoning = "Within benchmark operational parameters; no anomalies detected across ML engines.";
      if (projAnomalies.length > 0) {
        aiReasoning = projAnomalies.map(a => `${a.flaggedText}. ${a.reasoning}`).join(" ");
      } else if (assessment?.explainableFactors) {
        const ef = assessment.explainableFactors as Record<string, any>;
        const explanations = [
          ef.duplicateExplanation,
          ef.fundMovementExplanation,
          ef.delayRiskExplanation,
          ef.evidenceReuseExplanation,
        ].filter(Boolean);
        if (explanations.length > 0) {
          aiReasoning = explanations.join(" ");
        }
      }

      return {
        id: p.projectCode,
        title: p.title,
        meta: `${p.projectCode} · ${p.category || "Public Works"}`,
        region: p.district,
        status: p.status,
        progress: p.progress,
        risk: p.riskScore,
        amount: formatInr(p.sanctionedAmount),
        spent: formatInr(p.spentAmount),
        sanctionedRaw: p.sanctionedAmount,
        spentRaw: p.spentAmount,
        riskLevel: p.riskLevel,
        aiReasoning,
        anomalies: projAnomalies.map(a => ({
          moduleType: a.moduleType,
          severity: a.severity,
          score: a.score,
          flaggedText: a.flaggedText,
        })),
      };
    });

    // Sort priority queue by risk score descending (highest risk first)
    rows.sort((a, b) => b.risk - a.risk);

    // 3. Compute risk distribution from actual database risk scores
    const risk = {
      high: rows.filter(r => r.risk >= 71).length,
      medium: rows.filter(r => r.risk >= 31 && r.risk <= 70).length,
      low: rows.filter(r => r.risk <= 30).length,
      total: rows.length,
    };

    // 4. Compute financial totals
    const totalSanctioned = scopedProjects.reduce((sum, p) => sum + (p.sanctionedAmount || 0), 0);
    const totalSpent = scopedProjects.reduce((sum, p) => sum + (p.spentAmount || 0), 0);
    const avgUtilization = totalSanctioned > 0 ? Math.round((totalSpent / totalSanctioned) * 100) : 0;
    const delayedCount = scopedProjects.filter(p => p.status === "Delayed").length;
    const inProgressCount = scopedProjects.filter(p => p.status === "Active" || p.status === "Delayed").length;
    const completedCount = scopedProjects.filter(p => p.status === "Completed").length;
    const flaggedProjectsCount = rows.filter(r => r.risk >= 31 || (r.anomalies && r.anomalies.length > 0)).length;

    // 5. Compute AI anomaly module stats from actual database
    const dupAnoms = allAnomalies.filter(a => a.moduleType === "DUPLICATE_WORK");
    const fundAnoms = allAnomalies.filter(a => a.moduleType === "FUND_MOVEMENT");
    const delayAnoms = allAnomalies.filter(a => a.moduleType === "DELAY_RISK");
    const reuseAnoms = allAnomalies.filter(a => a.moduleType === "EVIDENCE_REUSE");

    const maxScore = (anoms: Anomaly[]) => anoms.length > 0 ? Math.max(...anoms.map(a => a.score)) : 0;

    const signalStats = {
      duplicateWork: {
        count: dupAnoms.length,
        maxScore: maxScore(dupAnoms),
        percentageText: dupAnoms.length > 0 ? `${(maxScore(dupAnoms) * 100).toFixed(1)}%` : "0.0%",
        statusText: dupAnoms.length > 0 ? `${dupAnoms.length} overlap flagged` : "Normal",
      },
      fundMovement: {
        count: fundAnoms.length,
        maxScore: maxScore(fundAnoms),
        percentageText: fundAnoms.length > 0 ? `${(maxScore(fundAnoms) * 100).toFixed(1)}%` : "0.0%",
        statusText: fundAnoms.length > 0 ? `${fundAnoms.length} outlier flagged` : "Normal",
      },
      delayRisk: {
        count: delayAnoms.length,
        maxScore: maxScore(delayAnoms),
        percentageText: delayAnoms.length > 0 ? `${(maxScore(delayAnoms) * 100).toFixed(1)}%` : "0.0%",
        statusText: delayAnoms.length > 0 ? `${delayAnoms.length} delayed flagged` : "On Track",
      },
      evidenceReuse: {
        count: reuseAnoms.length,
        maxScore: maxScore(reuseAnoms),
        percentageText: reuseAnoms.length > 0 ? `${(maxScore(reuseAnoms) * 100).toFixed(1)}%` : "0.0%",
        statusText: reuseAnoms.length > 0 ? `${reuseAnoms.length} duplicate match` : "Unique",
      },
    };

    // 6. Build dynamic KPIs
    let kpis: Kpi[];
    if (role === "cag") {
      kpis = [
        { label: "Reviews in scope", value: "4", detail: "FY 2026 audit plan", tone: "blue" },
        { label: "High-risk areas", value: String(rows.filter(r => r.risk >= 71).length), detail: "Immediate review", tone: "red" },
        { label: "Projects selected", value: String(scopedProjects.length), detail: "Authorized audit sample", tone: "blue" },
        { label: "Evidence pending", value: "7", detail: "3 past due", tone: "amber" },
        { label: "Findings open", value: "5", detail: "2 material observations", tone: "red" },
        { label: "Active AI signals", value: String(allAnomalies.length), detail: "Across 4 ML detection engines", tone: "amber" },
        { label: "Flagged cases", value: String(allCases.length), detail: "Pending assurance review", tone: "amber" },
      ];
    } else {
      kpis = [
        {
          label: role === "district" ? "Total works in district" : role === "mp" ? "Total recommendations" : "Total projects / works",
          value: String(scopedProjects.length),
          detail: `Across ${scopedProjects.length} catalogued records`,
          tone: "teal",
        },
        {
          label: "Sanctioned amount",
          value: formatInr(totalSanctioned),
          detail: `${formatInr(totalSpent)} spent`,
          tone: "blue",
        },
        {
          label: "Fund utilization",
          value: `${avgUtilization}%`,
          detail: "Against sanctioned value",
          tone: avgUtilization >= 70 ? "teal" : "amber",
        },
        {
          label: "Works in progress",
          value: String(inProgressCount),
          detail: `${completedCount} completed`,
          tone: "slate",
        },
        {
          label: "Delayed works",
          value: String(delayedCount),
          detail: `${rows.filter(r => r.risk >= 71).length} high-risk delays`,
          tone: delayedCount > 0 ? "red" : "teal",
        },
        {
          label: "AI-flagged works",
          value: String(flaggedProjectsCount),
          detail: `${allAnomalies.length} anomaly signals active`,
          tone: flaggedProjectsCount > 0 ? "amber" : "teal",
        },
        {
          label: "Flagged cases",
          value: String(allCases.length),
          detail: `${allCases.filter(c => c.priority === "High" || c.priority === "Critical").length} high priority`,
          tone: allCases.length > 0 ? "amber" : "teal",
        },
      ];
    }

    // 7. Recent activity from real audit logs
    const activities: ActivityItem[] = allAuditLogs.slice(-6).reverse().map(al => {
      let tone: "teal" | "amber" | "red" | "blue" = "blue";
      if (al.action.includes("RISK") || al.action.includes("ANOMALY")) tone = "amber";
      if (al.action.includes("ESCALAT") || al.action.includes("DELAY")) tone = "red";
      if (al.action.includes("COMPLET") || al.action.includes("VERIF")) tone = "teal";

      return {
        label: al.action.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
        ref: al.projectCode || al.targetId,
        person: al.userName,
        date: new Date(al.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        tone,
      };
    });

    return {
      kpis,
      hero: {
        ...defaultSnapshot.hero,
        eyebrow: `AI oversight brief · live data (${scopedProjects.length} works in view)`,
      },
      risk,
      rows,
      activities: activities.length > 0 ? activities : defaultSnapshot.activities,
      focus: [
        { label: "High risk works", value: String(risk.high), detail: `${risk.high} projects require immediate review` },
        { label: "Active anomalies", value: String(allAnomalies.length), detail: "Across 4 detection engines" },
        { label: "Open cases", value: String(allCases.length), detail: "Assigned for verification" },
      ],
      workflow: defaultSnapshot.workflow,
      signalStats,
    };
  } catch (error) {
    console.error("[Dashboard Service] Error building live snapshot:", error);
    return defaultSnapshot;
  }
}
