import { getDb } from "./db";
import {
  projects,
  expenditures,
  dataImports,
  dataProvenance,
  auditLogs,
  anomalies,
  riskAssessments,
  cases,
  evidence,
  projectUpdates,
} from "../drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database connection failed!");
    process.exit(1);
  }

  const p = await db.select().from(projects);
  const e = await db.select().from(expenditures);
  const di = await db.select().from(dataImports);
  const dp = await db.select().from(dataProvenance);
  const al = await db.select().from(auditLogs);
  const an = await db.select().from(anomalies);
  const ra = await db.select().from(riskAssessments);
  const c = await db.select().from(cases);
  const ev = await db.select().from(evidence);
  const pu = await db.select().from(projectUpdates);

  console.log("=== CURRENT DATABASE COUNTS ===");
  console.log("projects:", p.length);
  console.log("expenditures:", e.length);
  console.log("dataImports:", di.length);
  console.log("dataProvenance:", dp.length);
  console.log("auditLogs:", al.length);
  console.log("anomalies:", an.length);
  console.log("riskAssessments:", ra.length);
  console.log("cases:", c.length);
  console.log("evidence:", ev.length);
  console.log("projectUpdates:", pu.length);

  console.log("\nAll 10 project records:");
  for (const proj of p) {
    console.log(`- [${proj.projectCode}] ${proj.title} | Status: ${proj.status} | Progress: ${proj.progress}% | Sanctioned: ₹${proj.sanctionedAmount} | Spent: ₹${proj.spentAmount} | Risk: ${proj.riskScore} (${proj.riskLevel})`);
  }

  console.log("\nAnomalies by module:");
  const byModule: Record<string, number> = {};
  for (const a of an) {
    byModule[a.moduleType] = (byModule[a.moduleType] || 0) + 1;
    console.log(`  * [${a.moduleType}] ${a.anomalyCode} on ${a.projectCode}: ${a.flaggedText} (Score: ${a.score}, Severity: ${a.severity})`);
  }
  console.log("Summary by module:", byModule);

  console.log("\nRisk assessments count:", ra.length);
  for (const r of ra.slice(0, 5)) {
    console.log(`  * ${r.projectCode} -> Composite: ${r.compositeScore} (${r.riskLevel}) | Dup: ${r.duplicateWorkScore}, Fund: ${r.fundMovementScore}, Delay: ${r.delayRiskScore}, Reuse: ${r.evidenceReuseScore}`);
  }

  console.log("\nCases count:", c.length);
  for (const cs of c) {
    console.log(`  * [${cs.caseNumber}] ${cs.title} | Priority: ${cs.priority} | Status: ${cs.status} | Assigned: ${cs.assignedRole} (${cs.assignedDistrict}, ${cs.assignedState})`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Error inspecting DB:", err);
  process.exit(1);
});
