import { appRouter } from "../routers";
import { getDb } from "../db";
import { projects, projectUpdates, auditLogs } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import type { RoleKey } from "../../shared/monitoring";

function createContext(role: RoleKey, name: string) {
  const now = new Date();
  return {
    user: {
      id: role === "mp" ? 104 : role === "district" ? 103 : role === "state" ? 102 : role === "cag" ? 105 : 101,
      openId: `test-${role}-live`,
      name,
      email: `${role}@example.gov.in`,
      loginMethod: "test",
      role,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as any,
    res: { cookie: () => undefined, clearCookie: () => undefined } as any,
  };
}

async function runE2ETest() {
  console.log("===============================================================================");
  console.log("🚀 STARTING E2E VERIFICATION: MP 'RECOMMEND WORK' WORKFLOW & RBAC ENFORCEMENT");
  console.log("===============================================================================\n");

  const db = await getDb();
  if (!db) {
    throw new Error("❌ Database unavailable!");
  }

  // STEP 1: MP Login and submit recommendation
  console.log("1️⃣  Simulating MP Login (Hon. N. Patil, MP Lok Sabha)...");
  const mpCaller = appRouter.createCaller(createContext("mp", "N. Patil, MP (Lok Sabha)"));

  const workData = {
    title: "Solar Powered Cold Storage Facility for Agricultural Produce",
    category: "Rural Electrification & Solar Power",
    state: "Maharashtra",
    district: "Wardha",
    constituency: "Wardha",
    estimatedAmount: 3500000, // ₹35 Lakhs
    implementingAgency: "Maharashtra State Agricultural Marketing Board / DRDA",
    justification: "Critical infrastructure to prevent post-harvest spoilage for agrarian self-help groups in Wardha.",
  };

  console.log("📝 Submitting work recommendation via trpc.monitoring.createRecommendation()...");
  const result = await mpCaller.monitoring.createRecommendation(workData);
  console.log("✅ Recommendation created:", result);
  const { projectCode, projectId, recommendedBy } = result;

  // STEP 2: Verify in MySQL projects table
  console.log("\n2️⃣  Verifying database insertion in `projects` table...");
  const [projectRow] = await db.select().from(projects).where(eq(projects.projectCode, projectCode));
  if (!projectRow) {
    throw new Error(`❌ Project ${projectCode} not found in database!`);
  }
  console.log("   - ID:", projectRow.id);
  console.log("   - Project Code:", projectRow.projectCode);
  console.log("   - Title:", projectRow.title);
  console.log("   - Status:", projectRow.status, "(Expected: Recommended)");
  console.log("   - Recommended By:", projectRow.recommendedBy);
  console.log("   - District:", projectRow.district);
  console.log("   - State:", projectRow.state);
  console.log("   - Sanctioned/Budget Amount: ₹", projectRow.sanctionedAmount.toLocaleString("en-IN"));
  console.log("   - Spent Amount: ₹", projectRow.spentAmount);
  console.log("   - Progress:", projectRow.progress, "%");

  if (projectRow.status !== "Recommended") throw new Error("Status is not Recommended!");
  if (!projectRow.recommendedBy?.includes("N. Patil")) throw new Error("recommendedBy mismatch!");
  console.log("✅ `projects` record verified successfully.");

  // STEP 3: Verify initial project_updates entry
  console.log("\n3️⃣  Verifying initial entry in `project_updates` table...");
  const updateRows = await db.select().from(projectUpdates).where(eq(projectUpdates.projectCode, projectCode));
  if (updateRows.length === 0) {
    throw new Error(`❌ No project_updates record found for ${projectCode}!`);
  }
  const initialUpdate = updateRows[0];
  console.log("   - Update Type:", initialUpdate.updateType);
  console.log("   - Role:", initialUpdate.role);
  console.log("   - Updated By:", initialUpdate.updatedBy);
  console.log("   - Remarks:", initialUpdate.remarks);
  console.log("✅ `project_updates` record verified successfully.");

  // STEP 4: Verify immutable audit log in audit_logs table
  console.log("\n4️⃣  Verifying immutable audit log in `audit_logs` table...");
  const auditEntries = await db.select().from(auditLogs).where(eq(auditLogs.targetId, projectCode)).orderBy(desc(auditLogs.id));
  if (auditEntries.length === 0) {
    throw new Error(`❌ No audit_logs entry found for ${projectCode}!`);
  }
  const recAudit = auditEntries.find(a => a.action === "WORK_RECOMMENDED");
  if (!recAudit) {
    throw new Error("❌ WORK_RECOMMENDED audit log not found!");
  }
  console.log("   - Audit Code:", recAudit.auditCode);
  console.log("   - User Name:", recAudit.userName);
  console.log("   - User Role:", recAudit.userRole);
  console.log("   - Action:", recAudit.action);
  console.log("   - Target ID:", recAudit.targetId);
  console.log("   - Target Type:", recAudit.targetType);
  console.log("   - Field Changed:", recAudit.fieldChanged);
  console.log("   - New Value:", recAudit.newValue);
  console.log("   - Comments:", recAudit.comments);
  console.log("✅ `audit_logs` record verified successfully.");

  // STEP 5: Verify District Authority sees recommendation
  console.log("\n5️⃣  Verifying District Authority monitoring view (Collector P. Yadav)...");
  const districtCaller = appRouter.createCaller(createContext("district", "P. Yadav, District Authority"));
  const districtSnapshot = await districtCaller.monitoring.snapshot();
  const districtMatch = districtSnapshot.snapshot.rows.find(r => r.id === projectCode);
  if (!districtMatch) {
    throw new Error(`❌ District Authority cannot see recommendation ${projectCode}!`);
  }
  console.log("   - Found in District queue:", districtMatch.id, "·", districtMatch.title);
  console.log("   - District view status:", districtMatch.status);
  console.log("   - District view region:", districtMatch.region);
  console.log("✅ District Authority sees the recommendation!");

  // STEP 6: Verify State Nodal Officer sees recommendation
  console.log("\n6️⃣  Verifying State Nodal Officer monitoring view (R. Menon, Maharashtra)...");
  const stateCaller = appRouter.createCaller(createContext("state", "R. Menon, State Nodal Officer"));
  const stateSnapshot = await stateCaller.monitoring.snapshot();
  const stateMatch = stateSnapshot.snapshot.rows.find(r => r.id === projectCode);
  if (!stateMatch) {
    throw new Error(`❌ State Nodal Officer cannot see recommendation ${projectCode}!`);
  }
  console.log("   - Found in State queue:", stateMatch.id, "·", stateMatch.title);
  console.log("✅ State Nodal Officer sees the recommendation!");

  // STEP 7: Verify MoSPI Central Director sees recommendation
  console.log("\n7️⃣  Verifying MoSPI Central Director monitoring view (A. Qureshi)...");
  const mospiCaller = appRouter.createCaller(createContext("mospi", "A. Qureshi, MoSPI Central Director"));
  const mospiSnapshot = await mospiCaller.monitoring.snapshot();
  const mospiMatch = mospiSnapshot.snapshot.rows.find(r => r.id === projectCode);
  if (!mospiMatch) {
    throw new Error(`❌ MoSPI cannot see recommendation ${projectCode}!`);
  }
  console.log("   - Found in MoSPI queue:", mospiMatch.id, "·", mospiMatch.title);
  console.log("✅ MoSPI Central Director sees the recommendation!");

  // STEP 8: Verify RBAC rejection for all other roles
  console.log("\n8️⃣  Testing RBAC rejection: verify district, state, mospi, and cag cannot recommend works...");
  const unauthorizedRoles: RoleKey[] = ["district", "state", "mospi", "cag"];
  for (const r of unauthorizedRoles) {
    const caller = appRouter.createCaller(createContext(r, `Test ${r}`));
    let rejected = false;
    try {
      await caller.monitoring.createRecommendation({
        title: `Unauthorized work from ${r}`,
        estimatedAmount: 1000000,
      });
    } catch (err: any) {
      if (err.code === "FORBIDDEN") {
        rejected = true;
        console.log(`   ✓ Role '${r}' correctly REJECTED with FORBIDDEN (${err.message.slice(0, 50)}...)`);
      } else {
        throw new Error(`Role '${r}' threw unexpected error: ${err.message}`);
      }
    }
    if (!rejected) {
      throw new Error(`❌ Security failure: Role '${r}' was NOT rejected from creating a recommendation!`);
    }
  }

  console.log("\n===============================================================================");
  console.log("🎉 ALL E2E VERIFICATION STEPS PASSED SUCCESSFULLY!");
  console.log("===============================================================================\n");
}

runE2ETest().catch(err => {
  console.error("❌ E2E TEST FAILED:", err);
  process.exit(1);
});
