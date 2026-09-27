import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { RoleKey } from "../shared/monitoring";
import { getDb } from "./db";
import { projects, projectUpdates, evidence, auditLogs, cases, riskAssessments, anomalies } from "../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

function contextFor(role: RoleKey, name?: string): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 200,
      openId: `test-${role}`,
      name: name ?? `${role} test user`,
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

describe("Project Execution & Update Workflow (End-to-End)", () => {
  const targetProjectCode = "MPLAD-2025-001";

  it("1. RBAC authorization: rejects non-operational roles (mp, mospi, cag) from submitting project updates", async () => {
    const mpCaller = appRouter.createCaller(contextFor("mp"));
    await expect(
      mpCaller.monitoring.submitProjectUpdate({
        projectCode: targetProjectCode,
        newProgress: 50,
        updateType: "Unauthorized progress test",
        remarks: "Should fail with FORBIDDEN",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const mospiCaller = appRouter.createCaller(contextFor("mospi"));
    await expect(
      mospiCaller.monitoring.submitProjectUpdate({
        projectCode: targetProjectCode,
        newProgress: 50,
        updateType: "Unauthorized progress test",
        remarks: "Should fail with FORBIDDEN",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const stateCaller = appRouter.createCaller(contextFor("state"));
    await expect(
      stateCaller.monitoring.submitProjectUpdate({
        projectCode: targetProjectCode,
        newProgress: 50,
        updateType: "Unauthorized state execution update",
        remarks: "Should fail with FORBIDDEN as State is review-only",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("2. Operational Update: District Authority submits project update with progress, expenditure, remarks, and evidence", async () => {
    const db = await getDb();
    expect(db).toBeDefined();

    // Verify official source record exists with OFFICIAL_PUBLIC provenance
    const [beforeProject] = await db!.select().from(projects).where(eq(projects.projectCode, targetProjectCode));
    expect(beforeProject).toBeDefined();
    expect(beforeProject.sourceType).toBe("OFFICIAL_PUBLIC");

    const districtCaller = appRouter.createCaller(contextFor("district", "P. Yadav"));

    // 1x1 PNG base64 for perceptual hashing
    const sampleImageBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const result = await districtCaller.monitoring.submitProjectUpdate({
      projectCode: targetProjectCode,
      newProgress: 68,
      newStatus: "Active",
      updateType: "Structural Column & Roof Slab Completion",
      spentAmount: 1850000,
      remarks: "Field inspection conducted by Assistant Engineer. 68% physical execution completed according to specifications.",
      updateDate: "2026-09-27",
      evidenceTitle: "Stage 3 Structural Concrete Pouring Site Photo",
      evidenceCategory: "SITE_PHOTO",
      evidenceBase64: sampleImageBase64,
    });

    expect(result.success).toBe(true);
    expect(result.projectCode).toBe(targetProjectCode);
    expect(result.newProgress).toBe(68);
    expect(result.spentAmount).toBe(1850000);
    expect(result.evidenceCode).toBeDefined();

    // Verify project_updates table has OPERATIONAL_UPDATE provenance
    const [latestUpdate] = await db!
      .select()
      .from(projectUpdates)
      .where(eq(projectUpdates.projectCode, targetProjectCode))
      .orderBy(desc(projectUpdates.id))
      .limit(1);

    expect(latestUpdate).toBeDefined();
    expect(latestUpdate.sourceType).toBe("OPERATIONAL_UPDATE");
    expect(latestUpdate.newProgress).toBe(68);
    expect(latestUpdate.updatedBy).toBe("P. Yadav");
    expect(latestUpdate.updateType).toBe("Structural Column & Roof Slab Completion");

    // Verify attached evidence table has OPERATIONAL_UPDATE provenance and perceptualHash computed
    const [latestEvidence] = await db!
      .select()
      .from(evidence)
      .where(eq(evidence.projectCode, targetProjectCode))
      .orderBy(desc(evidence.id))
      .limit(1);

    expect(latestEvidence).toBeDefined();
    expect(latestEvidence.sourceType).toBe("OPERATIONAL_UPDATE");
    expect(latestEvidence.category).toBe("SITE_PHOTO");
    expect(latestEvidence.perceptualHash).toBeDefined();
    expect(latestEvidence.perceptualHash!.length).toBeGreaterThan(0);

    // Verify official project record provenance remains intact while operational progress is updated
    const [afterProject] = await db!.select().from(projects).where(eq(projects.projectCode, targetProjectCode));
    expect(afterProject.sourceType).toBe("OFFICIAL_PUBLIC"); // Official base provenance NEVER overwritten
    expect(afterProject.progress).toBe(68);
    expect(afterProject.spentAmount).toBe(1850000);
  });

  it("3. AI Re-evaluation Pipeline: Anomaly models execute and generate deterministic risk assessment & anomalies", async () => {
    const db = await getDb();
    expect(db).toBeDefined();

    // Verify risk assessment was generated and saved
    const [assessment] = await db!
      .select()
      .from(riskAssessments)
      .where(eq(riskAssessments.projectCode, targetProjectCode));

    expect(assessment).toBeDefined();
    expect(assessment.compositeScore).toBeGreaterThanOrEqual(0);
    expect(assessment.compositeScore).toBeLessThanOrEqual(100);
    expect(assessment.riskLevel).toBeDefined();
    expect(["Low", "Medium", "High"]).toContain(assessment.riskLevel);

    // Verify project's riskScore is synced with AI composite score
    const [project] = await db!.select().from(projects).where(eq(projects.projectCode, targetProjectCode));
    expect(project.riskScore).toBe(assessment.compositeScore);

    // Verify case was created or updated for verification
    const [projectCase] = await db!.select().from(cases).where(eq(cases.projectCode, targetProjectCode));
    expect(projectCase).toBeDefined();
    expect(projectCase.projectCode).toBe(targetProjectCode);
  });

  it("4. Human Verification: District/State user assigns investigator, adds remarks, and changes status", async () => {
    const db = await getDb();
    expect(db).toBeDefined();

    // Verify non-investigating role (MP) cannot manage cases
    const mpCaller = appRouter.createCaller(contextFor("mp"));
    await expect(
      mpCaller.monitoring.manageCase({
        projectCode: targetProjectCode,
        assignedUser: "P. Yadav",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const districtCaller = appRouter.createCaller(contextFor("district", "P. Yadav"));

    // Ensure case is clean for assignment and status transition testing
    await db!.update(cases).set({ assignedUser: null, status: "OPEN" }).where(eq(cases.projectCode, targetProjectCode));

    // Step A: Assign Investigator and Add Remarks (UNDER_INVESTIGATION)
    const assignResult = await districtCaller.monitoring.manageCase({
      projectCode: targetProjectCode,
      assignedUser: "A. Sharma",
      investigatorRemarks: "Site inspection initiated by Assistant Engineer A. Sharma. Foundation and column alignments inspected.",
      status: "UNDER_INVESTIGATION",
      evidenceTitle: "Assistant Engineer Field Verification Inspection Sheet",
    });

    expect(assignResult.success).toBe(true);
    expect(assignResult.case.assignedUser).toBe("A. Sharma");
    expect(assignResult.case.status).toBe("UNDER_INVESTIGATION");
    expect(assignResult.case.investigatorRemarks).toContain("Foundation and column alignments inspected");

    // Step B: Resolve the Case after human verification is complete
    const resolveResult = await districtCaller.monitoring.manageCase({
      projectCode: targetProjectCode,
      investigatorRemarks: "Verification complete. All MB entries verified against actual physical casting. Irregularity resolved.",
      status: "RESOLVED",
    });

    expect(resolveResult.success).toBe(true);
    expect(resolveResult.case.status).toBe("RESOLVED");
    expect(resolveResult.case.resolvedAt).toBeDefined();

    // Verify database reflects the assignment and resolution
    const [updatedCase] = await db!.select().from(cases).where(eq(cases.projectCode, targetProjectCode));
    expect(updatedCase.assignedUser).toBe("A. Sharma");
    expect(updatedCase.status).toBe("RESOLVED");
  });

  it("5. Audit Trail: Every project update, evidence addition, investigator assignment, remark, and status change is logged", async () => {
    const db = await getDb();
    expect(db).toBeDefined();

    const logs = await db!
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.projectCode, targetProjectCode))
      .orderBy(desc(auditLogs.id));

    expect(logs.length).toBeGreaterThanOrEqual(4);

    const actions = logs.map(l => l.action);
    expect(actions).toContain("PROJECT_EXECUTION_UPDATE");
    expect(actions).toContain("EVIDENCE_ATTACHED");
    expect(actions).toContain("CASE_ASSIGNMENT");
    expect(actions).toContain("INVESTIGATOR_REMARK");
    expect(actions).toContain("CASE_STATUS_CHANGE");
    expect(actions).toContain("CASE_RESOLVED");

    // Verify all operational audit logs are tagged with OPERATIONAL_UPDATE provenance
    const operationalLogs = logs.filter(l => l.sourceType === "OPERATIONAL_UPDATE");
    expect(operationalLogs.length).toBeGreaterThan(0);
  });

  it("6. State Nodal role: Enforcement of review-only security model (cannot modify execution, but can view and add review remark)", async () => {
    const db = await getDb();
    expect(db).toBeDefined();

    const stateCaller = appRouter.createCaller(contextFor("state", "R. Menon"));

    // 1. Verify State CANNOT submit execution update (strict backend enforcement)
    await expect(
      stateCaller.monitoring.submitProjectUpdate({
        projectCode: targetProjectCode,
        newProgress: 95,
        newStatus: "Completed",
        updateType: "Unauthorized State Execution Attempt",
        spentAmount: 3000000,
        remarks: "Should be blocked by backend authorization check.",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 2. Verify State CAN view District execution updates and evidence
    const updatesData = await stateCaller.monitoring.getProjectUpdates({ projectCode: targetProjectCode });
    expect(updatesData.updates.length).toBeGreaterThan(0);
    expect(updatesData.evidence.length).toBeGreaterThan(0);
    const photoEv = updatesData.evidence.find(e => e.category === "SITE_PHOTO");
    expect(photoEv).toBeDefined();
    expect(photoEv!.createdAt).toBeInstanceOf(Date);
    expect(photoEv!.fileUrl).toBeDefined();
    expect(photoEv!.fileUrl).toMatch(/^\/uploads\/evidence\//);
    expect(photoEv!.uploadedBy).toBeDefined();
    expect(photoEv!.perceptualHash).toBeDefined();

    // 3. Verify State CAN submit an oversight review remark (without modifying execution data)
    const reviewResult = await stateCaller.monitoring.addStateReviewRemark({
      projectCode: targetProjectCode,
      remarks: "State quality wing reviewed District operational updates and verified physical progress documentation.",
    });
    expect(reviewResult.success).toBe(true);

    // 4. Verify District's execution data was NOT modified by the State review remark
    const [project] = await db!.select().from(projects).where(eq(projects.projectCode, targetProjectCode));
    expect(project.sourceType).toBe("OFFICIAL_PUBLIC");
    expect(project.progress).toBe(68); // Progress remains at District's 68%
    expect(project.spentAmount).toBe(1850000); // Spent remains at District's ₹18.5L

    // 5. Verify the review remark is recorded in audit_logs
    const [latestLog] = await db!
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.projectCode, targetProjectCode))
      .orderBy(desc(auditLogs.id))
      .limit(1);

    expect(latestLog.action).toBe("STATE_REVIEW_REMARK");
    expect(latestLog.userName).toBe("R. Menon");
    expect(latestLog.userRole).toBe("state");
  });

  it("6. Controlled Remove Evidence: Only District role can remove, rejects unauthorized roles, requires reason, soft-deletes DB record, deletes stored file, logs audit, and triggers AI re-evaluation", async () => {
    const db = await getDb();
    expect(db).toBeDefined();

    const districtCaller = appRouter.createCaller(contextFor("district", "P. Yadav"));
    const stateCaller = appRouter.createCaller(contextFor("state", "R. Menon"));
    const mospiCaller = appRouter.createCaller(contextFor("mospi", "A. Qureshi"));
    const mpCaller = appRouter.createCaller(contextFor("mp", "Hon. MP"));
    const cagCaller = appRouter.createCaller(contextFor("cag", "S. Iyer"));

    // Find the active evidence attached in previous tests
    const [targetEvidence] = await db!
      .select()
      .from(evidence)
      .where(eq(evidence.projectCode, targetProjectCode))
      .orderBy(desc(evidence.id))
      .limit(1);

    expect(targetEvidence).toBeDefined();
    expect(targetEvidence.isActive).toBe(true);

    // Verify stored binary file exists before removal
    let diskFilePath: string | null = null;
    if (targetEvidence.fileUrl && targetEvidence.fileUrl.startsWith("/uploads/evidence/")) {
      diskFilePath = path.resolve(process.cwd(), "uploads", "evidence", path.basename(targetEvidence.fileUrl));
    }
    if (diskFilePath) {
      expect(fs.existsSync(diskFilePath)).toBe(true);
    }

    // 1. RBAC: Reject unauthorized roles (state, mospi, mp, cag)
    await expect(
      stateCaller.monitoring.removeEvidence({
        evidenceId: targetEvidence.id,
        removalReason: "State officer attempting unauthorized removal",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      mospiCaller.monitoring.removeEvidence({
        evidenceId: targetEvidence.id,
        removalReason: "MoSPI officer attempting unauthorized removal",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      mpCaller.monitoring.removeEvidence({
        evidenceId: targetEvidence.id,
        removalReason: "MP attempting unauthorized removal",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      cagCaller.monitoring.removeEvidence({
        evidenceId: targetEvidence.id,
        removalReason: "CAG auditor attempting unauthorized removal",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 2. Validation: Require a short removal reason (minimum 3 characters)
    await expect(
      districtCaller.monitoring.removeEvidence({
        evidenceId: targetEvidence.id,
        removalReason: "ab", // Less than 3 chars
      })
    ).rejects.toThrow();

    // 3. District successfully removes execution evidence
    const removalReasonText = "Superceded site photo; corrected geo-tagged angle required per inspection notes";
    const removalResult = await districtCaller.monitoring.removeEvidence({
      evidenceId: targetEvidence.id,
      removalReason: removalReasonText,
    });

    expect(removalResult.success).toBe(true);
    expect(removalResult.evidenceId).toBe(targetEvidence.id);
    expect(removalResult.projectCode).toBe(targetProjectCode);
    expect(removalResult.assessment).toBeDefined();

    // 4. Verify database record is preserved (NOT deleted), but marked inactive/removed
    const [removedRecord] = await db!
      .select()
      .from(evidence)
      .where(eq(evidence.id, targetEvidence.id));

    expect(removedRecord).toBeDefined();
    expect(removedRecord.isActive).toBe(false);
    expect(removedRecord.removalReason).toBe(removalReasonText);
    expect(removedRecord.removedAt).toBeInstanceOf(Date);
    expect(removedRecord.removedBy).toBe("P. Yadav");
    // Verify original metadata is preserved
    expect(removedRecord.title).toBe(targetEvidence.title);
    expect(removedRecord.category).toBe(targetEvidence.category);
    expect(removedRecord.uploadedBy).toBe(targetEvidence.uploadedBy);
    expect(removedRecord.projectCode).toBe(targetProjectCode);

    // 5. Verify stored binary file was deleted from uploads/evidence/
    if (diskFilePath) {
      expect(fs.existsSync(diskFilePath)).toBe(false);
    }

    // 6. Verify immutable audit log was created
    const [auditLog] = await db!
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "EVIDENCE_REMOVED"))
      .orderBy(desc(auditLogs.id))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog.projectCode).toBe(targetProjectCode);
    expect(auditLog.targetId).toBe(String(targetEvidence.id));
    expect(auditLog.targetType).toBe("evidence");
    expect(auditLog.userName).toBe("P. Yadav");
    expect(auditLog.userRole).toBe("district");
    expect(auditLog.comments).toContain(targetProjectCode);
    expect(auditLog.comments).toContain(String(targetEvidence.id));
    expect(auditLog.comments).toContain(removalReasonText);

    // 7. Verify getProjectUpdates excludes the removed evidence
    const updatesAfter = await districtCaller.monitoring.getProjectUpdates({
      projectCode: targetProjectCode,
    });
    const foundInActiveList = updatesAfter.evidence.some(e => e.id === targetEvidence.id);
    expect(foundInActiveList).toBe(false);

    // 8. Verify calling remove again on already removed evidence fails
    await expect(
      districtCaller.monitoring.removeEvidence({
        evidenceId: targetEvidence.id,
        removalReason: "Trying to remove again",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("7. Evidence Upload Timestamp: Verifies newly uploaded evidence records actual current IST time (Asia/Kolkata), not midnight AM", async () => {
    const db = await getDb();
    expect(db).toBeDefined();

    const districtCaller = appRouter.createCaller(contextFor("district", "P. Yadav"));
    const sampleImageBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const beforeUpload = new Date();

    const result = await districtCaller.monitoring.submitProjectUpdate({
      projectCode: targetProjectCode,
      newProgress: 75,
      newStatus: "Active",
      updateType: "Verified Timestamp Upload Test",
      spentAmount: 1900000,
      remarks: "Uploading verified geo-tagged photo with live timestamp.",
      updateDate: "2026-09-27",
      evidenceTitle: "Realtime Uploaded Site Photo",
      evidenceCategory: "SITE_PHOTO",
      evidenceBase64: sampleImageBase64,
    });

    const afterUpload = new Date();

    expect(result.success).toBe(true);

    const [newEvidence] = await db!
      .select()
      .from(evidence)
      .where(eq(evidence.projectCode, targetProjectCode))
      .orderBy(desc(evidence.id))
      .limit(1);

    expect(newEvidence).toBeDefined();
    expect(newEvidence.title).toBe("Realtime Uploaded Site Photo");
    expect(newEvidence.createdAt).toBeInstanceOf(Date);

    // Verify createdAt is the actual upload time (within the test window), NOT midnight 00:00:00 (which was 05:30 AM)
    const createdAtMs = newEvidence.createdAt.getTime();
    expect(createdAtMs).toBeGreaterThanOrEqual(beforeUpload.getTime() - 2000);
    expect(createdAtMs).toBeLessThanOrEqual(afterUpload.getTime() + 2000);

    // Format in Asia/Kolkata
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(newEvidence.createdAt);

    const map: Record<string, string> = {};
    parts.forEach(p => (map[p.type] = p.value));
    const formatted = `${map.day} ${map.month} ${map.year}, ${map.hour}:${map.minute} ${(map.dayPeriod || "").toUpperCase()} IST`;

    // Compare with current IST time
    const expectedParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: true,
    }).formatToParts(new Date());
    const expectedMap: Record<string, string> = {};
    expectedParts.forEach(p => (expectedMap[p.type] = p.value));

    // Must match the actual PM/AM of the current local IST time
    expect((map.dayPeriod || "").toUpperCase()).toBe((expectedMap.dayPeriod || "").toUpperCase());
    expect(formatted).toMatch(/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4},\s+\d{1,2}:\d{2}\s+(AM|PM)\s+IST$/);
  });

  it("9. Complete Human Verification Audit Trail Flow: Assign investigator -> Add remark -> Set Under Investigation -> Attach evidence -> Resolve / Escalate -> Open Audit Trail", async () => {
    const db = await getDb();
    expect(db).toBeDefined();

    const caseProjectCode = "MPLAD-2025-035";
    const districtCaller = appRouter.createCaller(contextFor("district", "P. Yadav"));

    // Ensure case is clean for human-verification workflow testing
    await db!.update(cases).set({ assignedUser: null, status: "OPEN", investigatorRemarks: null }).where(eq(cases.projectCode, caseProjectCode));

    // Step 1: Assign investigator
    const assignRes = await districtCaller.monitoring.manageCase({
      projectCode: caseProjectCode,
      assignedUser: "A. Sharma",
    });
    expect(assignRes.success).toBe(true);
    const caseNum = assignRes.case.caseNumber;
    expect(caseNum).toBeDefined();

    // Verify 1: CASE_ASSIGNMENT audit record
    const [assignmentLog] = await db!
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, caseNum), eq(auditLogs.action, "CASE_ASSIGNMENT")))
      .orderBy(desc(auditLogs.id))
      .limit(1);

    expect(assignmentLog).toBeDefined();
    expect(assignmentLog.targetId).toBe(caseNum);
    expect(assignmentLog.projectCode).toBe(caseProjectCode);
    expect(assignmentLog.newValue).toBe("A. Sharma");
    expect(assignmentLog.userName).toBe("P. Yadav");
    expect(assignmentLog.userRole).toBe("district");
    expect(assignmentLog.createdAt).toBeInstanceOf(Date);
    expect(assignmentLog.comments).toContain("assigned to investigator: A. Sharma");

    // Step 2: Add investigator remark
    const remarkText = "Field survey initiated: inspected concrete foundation depth and reinforcement steel spacing.";
    const remarkRes = await districtCaller.monitoring.manageCase({
      caseNumber: caseNum,
      projectCode: caseProjectCode,
      investigatorRemarks: remarkText,
    });
    expect(remarkRes.success).toBe(true);

    // Verify 2: INVESTIGATOR_REMARK audit record
    const [remarkLog] = await db!
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, caseNum), eq(auditLogs.action, "INVESTIGATOR_REMARK")))
      .orderBy(desc(auditLogs.id))
      .limit(1);

    expect(remarkLog).toBeDefined();
    expect(remarkLog.targetId).toBe(caseNum);
    expect(remarkLog.projectCode).toBe(caseProjectCode);
    expect(remarkLog.newValue).toBe(remarkText);
    expect(remarkLog.userName).toBe("P. Yadav");
    expect(remarkLog.createdAt).toBeInstanceOf(Date);
    expect(remarkLog.comments).toContain(remarkText);

    // Step 3: Set Under Investigation
    const statusRes = await districtCaller.monitoring.manageCase({
      caseNumber: caseNum,
      projectCode: caseProjectCode,
      status: "UNDER_INVESTIGATION",
    });
    expect(statusRes.success).toBe(true);
    expect(statusRes.case.status).toBe("UNDER_INVESTIGATION");

    // Verify 3: CASE_STATUS_CHANGE audit record
    const [statusLog] = await db!
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, caseNum), eq(auditLogs.action, "CASE_STATUS_CHANGE")))
      .orderBy(desc(auditLogs.id))
      .limit(1);

    expect(statusLog).toBeDefined();
    expect(statusLog.targetId).toBe(caseNum);
    expect(statusLog.projectCode).toBe(caseProjectCode);
    expect(statusLog.newValue).toBe("UNDER_INVESTIGATION");
    expect(statusLog.userName).toBe("P. Yadav");
    expect(statusLog.createdAt).toBeInstanceOf(Date);
    expect(statusLog.comments).toContain("changed from");
    expect(statusLog.comments).toContain("UNDER_INVESTIGATION");

    // Step 4: Attach verification evidence
    const evidenceRes = await districtCaller.monitoring.manageCase({
      caseNumber: caseNum,
      projectCode: caseProjectCode,
      evidenceTitle: "Structural Compliance On-Site Inspection Sheet",
      evidenceFileName: "structural_compliance_cert.pdf",
      evidenceCategory: "INSPECTION_REPORT",
    });
    expect(evidenceRes.success).toBe(true);

    // Verify 4: VERIFICATION_EVIDENCE_ATTACHED audit record
    const [evidenceLog] = await db!
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, caseNum), eq(auditLogs.action, "VERIFICATION_EVIDENCE_ATTACHED")))
      .orderBy(desc(auditLogs.id))
      .limit(1);

    expect(evidenceLog).toBeDefined();
    expect(evidenceLog.targetId).toBe(caseNum);
    expect(evidenceLog.projectCode).toBe(caseProjectCode);
    expect(evidenceLog.newValue).toBe("structural_compliance_cert.pdf");
    expect(evidenceLog.fieldChanged).toBe("INSPECTION_REPORT");
    expect(evidenceLog.userName).toBe("P. Yadav");
    expect(evidenceLog.createdAt).toBeInstanceOf(Date);
    expect(evidenceLog.comments).toContain("Structural Compliance On-Site Inspection Sheet");

    // Step 5A: Resolve the case
    const resolutionRemark = "Verification completed and approved. Measurement book and site test cylinders match requirements.";
    const resolveRes = await districtCaller.monitoring.manageCase({
      caseNumber: caseNum,
      projectCode: caseProjectCode,
      status: "RESOLVED",
      investigatorRemarks: resolutionRemark,
    });
    expect(resolveRes.success).toBe(true);
    expect(resolveRes.case.status).toBe("RESOLVED");
    expect(resolveRes.case.resolvedAt).toBeDefined();

    // Verify 5A: CASE_RESOLVED audit record
    const [resolvedLog] = await db!
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, caseNum), eq(auditLogs.action, "CASE_RESOLVED")))
      .orderBy(desc(auditLogs.id))
      .limit(1);

    expect(resolvedLog).toBeDefined();
    expect(resolvedLog.targetId).toBe(caseNum);
    expect(resolvedLog.projectCode).toBe(caseProjectCode);
    expect(resolvedLog.newValue).toBe("RESOLVED");
    expect(resolvedLog.userName).toBe("P. Yadav");
    expect(resolvedLog.createdAt).toBeInstanceOf(Date);
    expect(resolvedLog.comments).toContain("resolved with final status RESOLVED");
    expect(resolvedLog.comments).toContain(resolutionRemark);

    // Step 5B: Also verify CASE_ESCALATED on another case
    const escalationCaseCode = "MPLAD-2025-073";
    await db!.update(cases).set({ assignedUser: null, status: "OPEN", investigatorRemarks: null }).where(eq(cases.projectCode, escalationCaseCode));

    const escalateRes = await districtCaller.monitoring.manageCase({
      projectCode: escalationCaseCode,
      assignedUser: "R. Menon",
      status: "ESCALATED",
      investigatorRemarks: "Critical foundation variance detected. Escalated to State Nodal Authority for technical audit.",
    });
    expect(escalateRes.success).toBe(true);

    const [escalatedLog] = await db!
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, escalateRes.case.caseNumber), eq(auditLogs.action, "CASE_ESCALATED")))
      .orderBy(desc(auditLogs.id))
      .limit(1);

    expect(escalatedLog).toBeDefined();
    expect(escalatedLog.action).toBe("CASE_ESCALATED");
    expect(escalatedLog.newValue).toBe("ESCALATED");
    expect(escalatedLog.comments).toContain("escalated with final status ESCALATED");
    expect(escalatedLog.comments).toContain("Critical foundation variance detected");

    // Step 6: Open Audit Trail via tRPC procedure and verify all actions appear as separate meaningful records
    const auditTrailLogs = await districtCaller.monitoring.getAuditLogs({
      caseNumber: caseNum,
    });

    const caseActionTypes = auditTrailLogs.map(l => l.action);
    expect(caseActionTypes).toContain("CASE_ASSIGNMENT");
    expect(caseActionTypes).toContain("INVESTIGATOR_REMARK");
    expect(caseActionTypes).toContain("CASE_STATUS_CHANGE");
    expect(caseActionTypes).toContain("VERIFICATION_EVIDENCE_ATTACHED");
    expect(caseActionTypes).toContain("CASE_RESOLVED");

    // Verify all 5 records are distinct and contain meaningful details
    const uniqueActions = new Set(caseActionTypes);
    expect(uniqueActions.size).toBeGreaterThanOrEqual(5);

    for (const log of auditTrailLogs) {
      expect(log.targetId).toBe(caseNum);
      expect(log.projectCode).toBe(caseProjectCode);
      expect(log.userName).toBeDefined();
      expect(log.comments).toBeDefined();
      expect(log.comments!.length).toBeGreaterThan(10);
      expect(log.createdAt).toBeInstanceOf(Date);
    }
  });
});
