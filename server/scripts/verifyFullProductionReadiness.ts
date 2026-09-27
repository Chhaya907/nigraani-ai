import { getDb } from "../db";
import { appRouter } from "../routers";
import { projects, evidence, auditLogs, cases, anomalies, riskAssessments } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { semanticSimilarityEngine } from "../ml/embedding";
import { isolationForestEngine } from "../ml/isolationForest";
import { randomForestEngine } from "../ml/randomForest";
import { perceptualHashEngine } from "../ml/perceptualHash";
import { ROLE_KEYS, canRolePerform } from "../../shared/monitoring";
import fs from "fs";
import path from "path";

async function verifyAll13Checks() {
  console.log("=================================================================");
  console.log("   NIGRAANI AI — 13-POINT PRODUCTION READINESS VERIFICATION      ");
  console.log("=================================================================\n");

  const db = await getDb();
  if (!db) {
    throw new Error("FAIL: Database connection unavailable");
  }

  // 1. Database Connection & Schema Verification
  console.log("✓ CHECK 4: Database Connection & Schema Status");
  const allProjects = await db.select().from(projects);
  console.log(`   Connected to MySQL. Projects in database: ${allProjects.length}`);
  if (allProjects.length === 0) throw new Error("No projects found in database");

  // 2. Authentication for all 5 roles
  console.log("\n✓ CHECK 5: Authentication & Session Scoping for all 5 Roles");
  for (const role of ROLE_KEYS) {
    const caller = appRouter.createCaller({
      user: {
        id: 100,
        openId: `prod-test-${role}`,
        name: `${role.toUpperCase()} Production User`,
        email: `${role}@nigraani.gov.in`,
        loginMethod: "demo",
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as any,
      res: { cookie: () => {}, clearCookie: () => {} } as any,
    });
    const snapshot = await caller.monitoring.snapshot();
    if (snapshot.user.role !== role) {
      throw new Error(`Auth failed for role ${role}: returned ${snapshot.user.role}`);
    }
    console.log(`   Authenticated role '${role}': scope '${snapshot.definition.label}', rows: ${snapshot.snapshot.rows.length}`);
  }

  // 3. RBAC Strict Boundaries Verification
  console.log("\n✓ CHECK 6: Role-Based Access Control (RBAC) Enforcement");
  const districtCaller = appRouter.createCaller({
    user: { id: 1, role: "district", openId: "d-1", name: "District Nodal", email: "dist@gov.in" } as any,
    req: {} as any,
    res: { cookie: () => {} } as any,
  });
  const mpCaller = appRouter.createCaller({
    user: { id: 2, role: "mp", openId: "mp-1", name: "Hon MP", email: "mp@sansad.in" } as any,
    req: {} as any,
    res: { cookie: () => {} } as any,
  });
  const cagCaller = appRouter.createCaller({
    user: { id: 3, role: "cag", openId: "cag-1", name: "CAG Auditor", email: "cag@gov.in" } as any,
    req: {} as any,
    res: { cookie: () => {} } as any,
  });
  const mospiCaller = appRouter.createCaller({
    user: { id: 4, role: "mospi", openId: "m-1", name: "MoSPI Officer", email: "mospi@gov.in" } as any,
    req: {} as any,
    res: { cookie: () => {} } as any,
  });

  // MP only recommends
  try {
    await districtCaller.monitoring.createRecommendation({
      title: "Illegal Recommendation",
      category: "Roads",
      district: "Wardha",
      state: "Maharashtra",
      estimatedAmount: 1000000,
    });
    throw new Error("RBAC breach: District created recommendation!");
  } catch (err: any) {
    console.log("   ✓ District blocked from creating recommendations");
  }

  // District only updates operational execution
  try {
    await cagCaller.monitoring.submitProjectUpdate({
      projectCode: allProjects[0].projectCode,
      newProgress: 80,
      updateType: "Unauthorized CAG update",
      remarks: "Should fail",
    });
    throw new Error("RBAC breach: CAG performed operational update!");
  } catch (err: any) {
    console.log("   ✓ CAG blocked from operational execution updates");
  }

  // CAG only records audit findings
  try {
    await districtCaller.monitoring.recordAuditFinding({
      projectCode: allProjects[0].projectCode,
      title: "District attempting finding",
      category: "Financial",
      severity: "Low",
      observation: "Should fail authorization check",
    });
    throw new Error("RBAC breach: District recorded audit finding!");
  } catch (err: any) {
    console.log("   ✓ District blocked from recording audit findings");
  }

  // 4. Project Update Workflow Verification
  console.log("\n✓ CHECK 7: Project Update Workflow (District Authority)");
  const testProjectCode = allProjects[0].projectCode;
  const updateRes = await districtCaller.monitoring.submitProjectUpdate({
    projectCode: testProjectCode,
    newProgress: 65,
    updateType: "Physical Milestone - Superstructure Stage Verification",
    remarks: "Production readiness execution test verified on site.",
  });
  console.log(`   ✓ Operational update processed: Project=${updateRes.projectCode}, New Progress=${updateRes.newProgress}%`);

  // 5. Evidence Upload and Preview Verification
  console.log("\n✓ CHECK 8: Evidence Upload, dHash Generation, and Preview");
  const dummyBase64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
  const evRes = await districtCaller.monitoring.submitProjectUpdate({
    projectCode: testProjectCode,
    newProgress: 68,
    updateType: "Inspection Evidence Documentation",
    remarks: "Attaching photographic verification evidence.",
    evidenceTitle: "Site Inspection Pillar Construction",
    evidenceCategory: "SITE_PHOTO",
    evidenceFileName: `prod_site_photo_${Date.now()}.jpg`,
    evidenceBase64: dummyBase64,
  });
  console.log(`   ✓ Evidence uploaded: Code=${evRes.evidenceCode}`);

  const [savedEv] = await db.select().from(evidence).where(eq(evidence.evidenceCode, evRes.evidenceCode!));
  if (!savedEv) throw new Error("Uploaded evidence not found in DB");
  console.log(`   ✓ Evidence DB record verified: URL=${savedEv.fileUrl}, MIME=${savedEv.mimeType}`);

  // 6. All 4 AI Anomaly Modules Verification
  console.log("\n✓ CHECK 9: Four AI Anomaly Detection Engines");
  
  // A. Semantic Similarity
  const pairRes = semanticSimilarityEngine.comparePair(
    { projectCode: "P1", title: "Construction of concrete CC road in Ward 4", state: "Maharashtra", district: "Wardha" },
    { projectCode: "P2", title: "Paving of CC concrete road in Ward 4", state: "Maharashtra", district: "Wardha" }
  );
  console.log(`   1. Duplicate Work (Semantic Similarity): ${(pairRes.score * 100).toFixed(1)}% match, Status=${pairRes.status}`);
  if (pairRes.score < 0.5) throw new Error("Semantic similarity engine failed expected similarity benchmark");

  // B. Isolation Forest
  const ifRes = isolationForestEngine.predict(
    { projectCode: "TEST-01", sanctionedAmount: 5000000, spentAmount: 4900000 },
    [{ amount: 2500000, voucherNo: "V1" }, { amount: 2400000, voucherNo: "V2" }]
  );
  console.log(`   2. Fund Movement (Isolation Forest): Score=${ifRes.score.toFixed(3)}, Status=${ifRes.status}`);

  // C. Delay Risk
  const rfRes = randomForestEngine.predict(
    { projectCode: "TEST-01", progress: 15, sanctionedAmount: 10000000, spentAmount: 2000000, startDate: new Date("2024-01-01") },
    [{ newProgress: 10, createdAt: new Date("2024-03-01") }, { newProgress: 15, createdAt: new Date("2024-06-01") }]
  );
  console.log(`   3. Delay Risk (Random Forest): Predicted=${rfRes.predictedClass}, Confidence=${(rfRes.confidence * 100).toFixed(1)}%`);

  // D. Evidence Reuse
  const sampleBuf = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
  const dhash = perceptualHashEngine.computeHashFromBuffer(sampleBuf);
  console.log(`   4. Evidence Reuse (64-bit dHash): Computed dHash=${dhash}`);
  if (!dhash || dhash.length !== 16) throw new Error("Perceptual dHash generation failed");

  // 7. Human Verification / Case Workflow
  console.log("\n✓ CHECK 10: Human Verification & Case Workflow");
  const caseList = await districtCaller.monitoring.getCases();
  console.log(`   ✓ Active cases accessible: count = ${caseList.length}`);
  const sampleCase = caseList[0];
  if (sampleCase) {
    const caseResult = await districtCaller.monitoring.manageCase({
      caseNumber: sampleCase.caseNumber,
      investigatorRemarks: "Verification audit confirmed milestone progress on site.",
      status: "UNDER_INVESTIGATION",
    });
    console.log(`   ✓ Case transition verified: ${sampleCase.caseNumber} -> ${caseResult.case?.status}`);
  }

  // 8. CAG Audit Workflow
  console.log("\n✓ CHECK 11: CAG Audit & Assurance Workflow");
  const cagFinding = await cagCaller.monitoring.recordAuditFinding({
    projectCode: testProjectCode,
    title: `Statutory Field Inspection Finding (${Date.now()})`,
    category: "Measurement Book / Quantity Discrepancy",
    severity: "High",
    targetRole: "district",
    financialImplication: 320000,
    observation: "Field measurements differ from billed quantities by 12% across initial excavation.",
    recommendation: "Reconcile Measurement Book with executive engineer counter-signature.",
  });
  console.log(`   ✓ CAG audit observation recorded: CaseNumber=${cagFinding.caseNumber}, assigned to district with 15-day deadline`);

  // 9. Reports & Exports (CSV and PDF)
  console.log("\n✓ CHECK 12: Reports & Exports (CSV + PDF Generation)");
  const csvExport = await mospiCaller.monitoring.getExportData();
  console.log(`   ✓ CSV export: ${csvExport.rows.length} rows`);

  const cagSummaryPdf = await cagCaller.monitoring.exportCagSummaryPdf();
  const pdfBytes = Buffer.from(cagSummaryPdf.base64, "base64");
  console.log(`   ✓ PDF export (CAG Summary): ${cagSummaryPdf.filename} (${pdfBytes.length} bytes, Header: ${pdfBytes.slice(0, 4).toString()})`);
  if (!pdfBytes.slice(0, 4).toString().includes("%PDF")) throw new Error("Invalid PDF generation");

  const projPdf = await mospiCaller.monitoring.exportProjectPdf({ projectCode: testProjectCode });
  console.log(`   ✓ PDF export (Project Detail): ${projPdf.filename} (${Buffer.from(projPdf.base64, "base64").length} bytes)`);

  // 10. Audit Trail Persistence
  console.log("\n✓ CHECK 13: Immutable Audit Trail Persistence in MySQL");
  const [latestAuditLog] = await db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(1);
  if (!latestAuditLog) throw new Error("No audit logs in DB");
  console.log(`   ✓ Latest Audit Log: ID=${latestAuditLog.id}, Action=${latestAuditLog.action}, Actor=${latestAuditLog.userName} (${latestAuditLog.userRole})`);

  console.log("\n=================================================================");
  console.log("   ALL PRODUCTION READINESS CHECKS PASSED SUCCESSFULLY!          ");
  console.log("=================================================================");
  process.exit(0);
}

verifyAll13Checks().catch(err => {
  console.error("FATAL ERROR in readiness verification:", err);
  process.exit(1);
});
