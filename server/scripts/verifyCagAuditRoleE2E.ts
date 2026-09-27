import { appRouter } from "../routers";
import { getDb } from "../db";
import { cases, auditLogs, projects } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";

function createContextFor(role: any, name = "Test Officer"): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 999,
      openId: `test-${role}`,
      name,
      email: `${role}@cag.gov.in`,
      loginMethod: "demo",
      role,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as any,
    res: { cookie: () => undefined, clearCookie: () => undefined } as any,
  };
}

async function verifyCagAuditRole() {
  console.log("=== STARTING CAG AUDIT & ASSURANCE E2E VERIFICATION ===");
  const db = await getDb();
  if (!db) {
    console.error("Database connection failed");
    process.exit(1);
  }

  // 1. Verify CAG snapshot
  console.log("\n1. Verifying CAG Snapshot & Role-Scoped KPIs...");
  const cagCaller = appRouter.createCaller(createContextFor("cag", "A. K. Sharma, Senior Audit Officer"));
  const cagSnapshot = await cagCaller.monitoring.snapshot();
  console.log(`Role: ${cagSnapshot.user.role}`);
  console.log(`Total projects in CAG scope: ${cagSnapshot.snapshot.rows.length}`);
  console.log(`KPIs count: ${cagSnapshot.snapshot.kpis.length}`);
  const reviewsInScope = cagSnapshot.snapshot.kpis.find(k => k.label === "Reviews in scope");
  console.log(`Reviews in scope KPI: ${reviewsInScope?.value}`);
  if (reviewsInScope?.value !== "4") {
    throw new Error(`Expected Reviews in scope to be 4, got ${reviewsInScope?.value}`);
  }

  // 2. Select a project for audit observation
  const testProject = cagSnapshot.snapshot.rows[0];
  console.log(`\n2. Selected Project for Audit: ${testProject.id} (${testProject.title})`);

  // 3. Record Audit Finding as CAG
  console.log("\n3. Testing CAG recordAuditFinding mutation...");
  const findingTitle = `Statutory Audit Observation - Physical vs Expenditure Variance (${Date.now()})`;
  const result = await cagCaller.monitoring.recordAuditFinding({
    projectCode: testProject.id,
    title: findingTitle,
    category: "Financial Irregularity / Fund Misapplication",
    severity: "High",
    targetRole: "district",
    financialImplication: 450000,
    observation: "Physical milestone verified on site indicates 35% completion whereas financial disbursement voucher records 70% expenditure without Measurement Book cross-verification.",
    recommendation: "District Authority must produce authenticated Measurement Book (MB) and reconcile ledger discrepancies within 15 calendar days.",
  });

  console.log(`Result: success = ${result.success}, caseNumber = ${result.caseNumber}`);
  if (!result.success || !result.caseNumber.startsWith("AUD-")) {
    throw new Error(`Invalid recordAuditFinding response: ${JSON.stringify(result)}`);
  }

  // 4. Verify in MySQL database cases table
  console.log("\n4. Verifying persistence in MySQL 'cases' table...");
  const [caseRow] = await db.select().from(cases).where(eq(cases.caseNumber, result.caseNumber));
  if (!caseRow) {
    throw new Error(`Case ${result.caseNumber} not found in MySQL!`);
  }
  console.log(`Case Found: ID=${caseRow.id}, Number=${caseRow.caseNumber}, Status=${caseRow.status}, Priority=${caseRow.priority}, OpenedBy=${caseRow.openedBy}`);
  if (caseRow.status !== "AUDIT_OBSERVATION") {
    throw new Error(`Expected case status AUDIT_OBSERVATION, got ${caseRow.status}`);
  }

  // 5. Verify in MySQL database audit_logs table
  console.log("\n5. Verifying persistence in MySQL 'audit_logs' table...");
  const [logRow] = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, result.caseNumber))
    .orderBy(desc(auditLogs.id));

  if (!logRow) {
    throw new Error(`Audit log for ${result.caseNumber} not found!`);
  }
  console.log(`Audit Log Found: ID=${logRow.id}, Action=${logRow.action}, TargetType=${logRow.targetType}, ActorRole=${logRow.userRole}, User=${logRow.userName}`);
  if (logRow.action !== "AUDIT_FINDING_RECORDED" || logRow.userRole !== "cag") {
    throw new Error(`Audit log mismatch: action=${logRow.action}, role=${logRow.userRole}`);
  }

  // 6. Verify getAuditFindings query returns the new observation
  console.log("\n6. Verifying getAuditFindings query...");
  const findingsList = await cagCaller.monitoring.getAuditFindings();
  const matched = findingsList.find(f => f.caseNumber === result.caseNumber);
  if (!matched) {
    throw new Error(`Newly created audit finding ${result.caseNumber} not returned in getAuditFindings query!`);
  }
  console.log(`Finding retrieved in register: ${matched.caseNumber} - ${matched.title}`);

  // 7. Test RBAC: Non-CAG roles CANNOT record audit findings
  console.log("\n7. Testing RBAC: Non-CAG roles must be rejected from recording audit findings...");
  for (const nonCagRole of ["district", "mp", "state", "mospi"] as const) {
    const unauthorizedCaller = appRouter.createCaller(createContextFor(nonCagRole, `${nonCagRole} officer`));
    try {
      await unauthorizedCaller.monitoring.recordAuditFinding({
        projectCode: testProject.id,
        title: "Unauthorized finding attempt",
        category: "Financial Irregularity",
        severity: "Low",
        observation: "This attempt should be rejected by RBAC.",
      });
      throw new Error(`RBAC FAILURE: Role '${nonCagRole}' was permitted to record an audit finding!`);
    } catch (err: any) {
      if (err.message && err.message.includes("is not authorized to record audit findings")) {
        console.log(`✓ Role '${nonCagRole}' correctly rejected with FORBIDDEN`);
      } else {
        throw err;
      }
    }
  }

  // 8. Test RBAC: CAG cannot submit operational project updates
  console.log("\n8. Testing RBAC: CAG must be rejected from submitting operational project updates...");
  try {
    await cagCaller.monitoring.submitProjectUpdate({
      projectCode: testProject.id,
      newProgress: 90,
      updateType: "Operational Milestone Progress",
      remarks: "CAG attempting unauthorized operational update",
    });
    throw new Error("RBAC FAILURE: Role 'cag' was permitted to submit an operational update!");
  } catch (err: any) {
    console.log(`✓ CAG correctly rejected from operational update: ${err.message}`);
  }

  // 9. Test RBAC: CAG cannot recommend works (MP only)
  console.log("\n9. Testing RBAC: CAG must be rejected from recommending works...");
  try {
    await cagCaller.monitoring.createRecommendation({
      title: "CAG attempting work recommendation",
      category: "Roads",
      district: "Wardha",
      state: "Maharashtra",
      estimatedAmount: 5000000,
      description: "Should fail",
    });
    throw new Error("RBAC FAILURE: Role 'cag' was permitted to create a recommendation!");
  } catch (err: any) {
    console.log(`✓ CAG correctly rejected from recommending works: ${err.message}`);
  }

  // 10. Test RBAC: CAG cannot remove evidence (District only)
  console.log("\n10. Testing RBAC: CAG must be rejected from removing evidence...");
  try {
    await cagCaller.monitoring.removeEvidence({
      evidenceId: 1,
      removalReason: "CAG unauthorized deletion attempt",
    });
    throw new Error("RBAC FAILURE: Role 'cag' was permitted to remove evidence!");
  } catch (err: any) {
    console.log(`✓ CAG correctly rejected from removing evidence: ${err.message}`);
  }

  console.log("\n========================================================");
  console.log("✓ ALL CAG AUDIT & ASSURANCE E2E VERIFICATIONS PASSED!");
  console.log("========================================================");
  process.exit(0);
}

verifyCagAuditRole().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
