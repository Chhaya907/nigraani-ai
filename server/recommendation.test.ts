import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { type RoleKey } from "../shared/monitoring";
import { getDb } from "./db";
import { projects, auditLogs } from "../drizzle/schema";
import { eq } from "drizzle-orm";

function contextFor(role: RoleKey, name?: string): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: role === "mp" ? 104 : 100,
      openId: `test-${role}`,
      name: name ?? (role === "mp" ? "N. Patil, MP (Lok Sabha)" : `${role} test user`),
      email: `${role}@example.gov.in`,
      loginMethod: "test",
      role,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: () => undefined, clearCookie: () => undefined } as TrpcContext["res"],
  };
}

describe("MP Work Recommendation RBAC and Workflow", () => {
  let createdProjectCode: string = "";

  it("permits MP to create a recommendation and saves to MySQL and Audit Log", async () => {
    const mpCaller = appRouter.createCaller(contextFor("mp", "N. Patil, MP (Lok Sabha)"));

    const result = await mpCaller.monitoring.createRecommendation({
      title: "Drinking Water RO Facility for Wardha Rural Hospital",
      category: "Drinking Water Facility",
      state: "Maharashtra",
      district: "Wardha",
      constituency: "Wardha",
      estimatedAmount: 2500000,
      implementingAgency: "District Rural Development Agency (DRDA), Wardha",
      justification: "Critical drinking water purification system for rural patients and staff.",
    });

    expect(result.success).toBe(true);
    expect(result.projectCode).toMatch(/^MPLAD-2026-/);
    expect(result.recommendedBy).toContain("N. Patil");

    createdProjectCode = result.projectCode;

    // Verify database record in MySQL
    const db = await getDb();
    expect(db).toBeDefined();
    if (db) {
      const [savedProject] = await db.select().from(projects).where(eq(projects.projectCode, createdProjectCode));
      expect(savedProject).toBeDefined();
      expect(savedProject.title).toBe("Drinking Water RO Facility for Wardha Rural Hospital");
      expect(savedProject.status).toBe("Recommended");
      expect(savedProject.district).toBe("Wardha");
      expect(savedProject.recommendedBy).toContain("N. Patil");
      expect(savedProject.sanctionedAmount).toBe(2500000);

      // Verify audit log entry in MySQL
      const auditEntries = await db.select().from(auditLogs).where(eq(auditLogs.targetId, createdProjectCode));
      expect(auditEntries.length).toBeGreaterThan(0);
      const recAudit = auditEntries.find(a => a.action === "WORK_RECOMMENDED");
      expect(recAudit).toBeDefined();
      expect(recAudit?.userRole).toBe("mp");
      expect(recAudit?.userName).toContain("N. Patil");
    }
  });

  it("strictly rejects recommendation creation from district, state, mospi, and cag", async () => {
    const districtCaller = appRouter.createCaller(contextFor("district"));
    await expect(
      districtCaller.monitoring.createRecommendation({
        title: "Unauthorized District Recommendation",
        estimatedAmount: 1000000,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const stateCaller = appRouter.createCaller(contextFor("state"));
    await expect(
      stateCaller.monitoring.createRecommendation({
        title: "Unauthorized State Recommendation",
        estimatedAmount: 1000000,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const mospiCaller = appRouter.createCaller(contextFor("mospi"));
    await expect(
      mospiCaller.monitoring.createRecommendation({
        title: "Unauthorized MoSPI Recommendation",
        estimatedAmount: 1000000,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const cagCaller = appRouter.createCaller(contextFor("cag"));
    await expect(
      cagCaller.monitoring.createRecommendation({
        title: "Unauthorized CAG Recommendation",
        estimatedAmount: 1000000,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("makes the recommendation visible in District, State, and MoSPI monitoring views", async () => {
    expect(createdProjectCode).toBeTruthy();

    // 1. District monitoring view
    const districtCaller = appRouter.createCaller(contextFor("district"));
    const districtSnapshot = await districtCaller.monitoring.snapshot();
    const districtFound = districtSnapshot.snapshot.rows.find(r => r.id === createdProjectCode);
    expect(districtFound).toBeDefined();
    expect(districtFound?.status).toBe("Recommended");
    expect(districtFound?.region).toBe("Wardha");

    // 2. State monitoring view
    const stateCaller = appRouter.createCaller(contextFor("state"));
    const stateSnapshot = await stateCaller.monitoring.snapshot();
    const stateFound = stateSnapshot.snapshot.rows.find(r => r.id === createdProjectCode);
    expect(stateFound).toBeDefined();
    expect(stateFound?.status).toBe("Recommended");

    // 3. MoSPI monitoring view
    const mospiCaller = appRouter.createCaller(contextFor("mospi"));
    const mospiSnapshot = await mospiCaller.monitoring.snapshot();
    const mospiFound = mospiSnapshot.snapshot.rows.find(r => r.id === createdProjectCode);
    expect(mospiFound).toBeDefined();
    expect(mospiFound?.status).toBe("Recommended");

    // 4. MP monitoring view
    const mpCaller = appRouter.createCaller(contextFor("mp", "N. Patil, MP (Lok Sabha)"));
    const mpSnapshot = await mpCaller.monitoring.snapshot();
    const mpFound = mpSnapshot.snapshot.rows.find(r => r.id === createdProjectCode);
    expect(mpFound).toBeDefined();
    expect(mpFound?.status).toBe("Recommended");
  });
});
