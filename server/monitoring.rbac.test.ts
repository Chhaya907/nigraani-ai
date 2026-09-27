import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ROLE_DEFINITIONS, ROLE_KEYS, type RoleKey } from "../shared/monitoring";

function contextFor(role: RoleKey): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 100,
      openId: `test-${role}`,
      name: `${role} test user`,
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

describe("Nigraani RBAC model", () => {
  it("defines exactly the five authorized roles", () => {
    expect(ROLE_KEYS).toEqual(["mospi", "state", "district", "mp", "cag"]);
    expect(Object.keys(ROLE_DEFINITIONS)).toHaveLength(5);
    expect(Object.values(ROLE_DEFINITIONS).flatMap(definition => definition.nav.map(item => item.label)).join(" ")).not.toContain("Project Manager");
  });

  it("returns role-scoped dashboard data from the authenticated user, not client input", async () => {
    const districtSnapshot = await appRouter.createCaller(contextFor("district")).monitoring.snapshot();
    expect(districtSnapshot.user.role).toBe("district");
    expect(districtSnapshot.definition.label).toBe("District Authority Dashboard");
    expect(districtSnapshot.snapshot.rows.every(row => ["Barwani", "Wardha"].includes(row.region))).toBe(true);

    const cagSnapshot = await appRouter.createCaller(contextFor("cag")).monitoring.snapshot();
    expect(cagSnapshot.user.role).toBe("cag");
    expect(cagSnapshot.snapshot.kpis.find(kpi => kpi.label === "Reviews in scope")?.value).toBe("4");
  });

  it("rejects operational actions for MoSPI and permits district processing", async () => {
    const mospi = appRouter.createCaller(contextFor("mospi"));
    await expect(mospi.monitoring.performAction({ action: "processRecommendation", targetId: "REC-1", comments: "Should be rejected" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const district = appRouter.createCaller(contextFor("district"));
    const result = await district.monitoring.performAction({ action: "processRecommendation", targetId: "REC-1", comments: "Eligibility review started" });
    expect(result.success).toBe(true);
    expect(result.event.role).toBe("district");
  });

  it("keeps CAG controlled writes limited to assurance records", async () => {
    const cag = appRouter.createCaller(contextFor("cag"));
    const finding = await cag.monitoring.performAction({ action: "recordAuditFinding", targetId: "AUD-1", comments: "Observation recorded" });
    expect(finding.success).toBe(true);
    await expect(cag.monitoring.performAction({ action: "manageCorrectiveAction", targetId: "CA-1", comments: "Should be rejected" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
