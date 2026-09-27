import { getDb } from "./db";
import { projects, expenditures, evidence, projectUpdates, anomalies, riskAssessments, cases, auditLogs } from "../drizzle/schema";
import { seedDemoAugmentation } from "./services/demoAugmentationService";
import { runFullAiEvaluation } from "./services/anomalyService";

async function main() {
  console.log("=== EXECUTING DATA + AI/ML PIPELINE ===");

  const db = await getDb();
  if (!db) {
    console.error("Database connection failed");
    process.exit(1);
  }

  // 1. Verify official records
  const officialProjects = await db.select().from(projects);
  console.log(`[Step 1] Official Projects in MySQL: ${officialProjects.length}`);

  // 2. Apply Demo Augmentation (Execution Telemetry)
  console.log("[Step 2] Applying Demo Augmentation (telemetry, milestone expenditures, photo evidence)...");
  const augResult = await seedDemoAugmentation();
  console.log("Demo Augmentation Results:", augResult);

  // 3. Run Genuine AI/ML Evaluation Pipeline
  console.log("[Step 3] Running full AI evaluation across all 4 ML engines...");
  await db.delete(cases);
  const assessments = await runFullAiEvaluation("MoSPI AI Review System");
  console.log(`AI Assessments completed: ${assessments.length} projects evaluated.`);

  // 4. Verify Database Persistence
  const allAnomalies = await db.select().from(anomalies);
  const allRiskAssessments = await db.select().from(riskAssessments);
  const allCases = await db.select().from(cases);
  const allAudit = await db.select().from(auditLogs);

  console.log("\n=== DATABASE PERSISTENCE RESULTS ===");
  console.log(`Total Anomalies Detected: ${allAnomalies.length}`);
  const byModule: Record<string, number> = {};
  for (const a of allAnomalies) {
    byModule[a.moduleType] = (byModule[a.moduleType] || 0) + 1;
    console.log(`  - [${a.moduleType}] ${a.anomalyCode} on ${a.projectCode}: ${a.flaggedText} (Score: ${a.score})`);
  }
  console.log("Anomalies breakdown by module:", byModule);

  console.log(`\nTotal Risk Assessments: ${allRiskAssessments.length}`);
  const riskCounts = { High: 0, Medium: 0, Low: 0 };
  for (const r of allRiskAssessments) {
    riskCounts[r.riskLevel]++;
    console.log(`  - ${r.projectCode} -> Composite: ${r.compositeScore}/100 (${r.riskLevel}) | Dup: ${((r.duplicateWorkScore ?? 0) * 100).toFixed(1)}%, Fund: ${((r.fundMovementScore ?? 0) * 100).toFixed(1)}%, Delay: ${((r.delayRiskScore ?? 0) * 100).toFixed(1)}%, Reuse: ${((r.evidenceReuseScore ?? 0) * 100).toFixed(1)}%`);
  }
  console.log("Risk distribution:", riskCounts);

  console.log(`\nTotal Cases Flagged: ${allCases.length}`);
  for (const c of allCases) {
    console.log(`  - [${c.caseNumber}] Priority: ${c.priority}, Status: ${c.status} | Assigned: ${c.assignedRole} (${c.assignedDistrict}) | ${c.title}`);
  }

  console.log(`\nTotal Audit Logs: ${allAudit.length}`);

  console.log("\n=== AI/ML PIPELINE COMPLETED SUCCESSFULLY ===");
  process.exit(0);
}

main().catch(err => {
  console.error("Pipeline execution failed:", err);
  process.exit(1);
});
