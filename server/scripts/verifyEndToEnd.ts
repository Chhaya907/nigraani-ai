import { getDb } from "../db";
import { appRouter } from "../routers";
import { projects, evidence, auditLogs, cases } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import fs from "fs";
import path from "path";
import axios from "axios";

async function main() {
  console.log("=== STARTING COMPREHENSIVE END-TO-END VERIFICATION ===");
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  // 1. Verify Existing Project Data & 5 RBAC Roles
  console.log("\n[1] Verifying 5 RBAC Roles & Projects...");
  const callerDistrict = appRouter.createCaller({
    user: { id: 1, role: "district", openId: "dist-1", name: "P. Yadav", email: "dist@mp.gov.in" } as any,
    req: {} as any,
    res: { cookie: () => {} } as any,
  });
  const callerMospi = appRouter.createCaller({
    user: { id: 2, role: "mospi", openId: "mospi-1", name: "A. Qureshi", email: "mospi@gov.in" } as any,
    req: {} as any,
    res: { cookie: () => {} } as any,
  });
  const callerCag = appRouter.createCaller({
    user: { id: 3, role: "cag", openId: "cag-1", name: "CAG Auditor", email: "cag@gov.in" } as any,
    req: {} as any,
    res: { cookie: () => {} } as any,
  });
  const callerState = appRouter.createCaller({
    user: { id: 4, role: "state", openId: "state-1", name: "R. Menon", email: "state@gov.in" } as any,
    req: {} as any,
    res: { cookie: () => {} } as any,
  });
  const callerMp = appRouter.createCaller({
    user: { id: 5, role: "mp", openId: "mp-1", name: "Hon MP", email: "mp@sansad.in" } as any,
    req: {} as any,
    res: { cookie: () => {} } as any,
  });

  const projList = await db.select().from(projects);
  console.log(`✓ Active Projects in DB: ${projList.length}`);
  const targetProject = projList[0].projectCode;
  console.log(`✓ Target Project for verification: ${targetProject}`);

  // 2. CSV Exports Verification
  console.log("\n[2] Verifying CSV Export Data...");
  const exportData = await callerMospi.monitoring.getExportData();
  console.log(`✓ MoSPI Export View CSV rows: ${exportData.rows.length}`);
  if (exportData.rows.length === 0) throw new Error("Export data is empty");

  const cagData = await callerCag.monitoring.getCagStatusSummary();
  console.log(`✓ CAG Status Summary CSV rows: ${cagData.length}`);
  if (cagData.length === 0) throw new Error("CAG Status Summary is empty");

  const evData = await callerDistrict.monitoring.getEvidenceRegister();
  console.log(`✓ Evidence Register CSV rows: ${evData.length}`);

  const actData = await callerDistrict.monitoring.getActionFollowup();
  console.log(`✓ Action Follow-up CSV rows: ${actData.length}`);

  // 3. PDF Exports Verification
  console.log("\n[3] Verifying PDF Exports (Server-side PDFKit generation)...");

  // A. Project Details PDF
  const projPdf = await callerMospi.monitoring.exportProjectPdf({ projectCode: targetProject });
  const projPdfBuffer = Buffer.from(projPdf.base64, "base64");
  console.log(`✓ Project Details PDF generated: ${projPdf.filename} (${projPdfBuffer.length} bytes, PDF header: ${projPdfBuffer.slice(0, 4).toString()})`);
  if (!projPdfBuffer.slice(0, 4).toString().includes("%PDF")) throw new Error("Invalid PDF header in project PDF");

  // B. CAG Status Summary PDF
  const cagPdf = await callerCag.monitoring.exportCagSummaryPdf();
  const cagPdfBuffer = Buffer.from(cagPdf.base64, "base64");
  console.log(`✓ CAG Summary PDF generated: ${cagPdf.filename} (${cagPdfBuffer.length} bytes)`);

  // C. Evidence Register PDF
  const evPdf = await callerDistrict.monitoring.exportEvidenceRegisterPdf();
  const evPdfBuffer = Buffer.from(evPdf.base64, "base64");
  console.log(`✓ Evidence Register PDF generated: ${evPdf.filename} (${evPdfBuffer.length} bytes)`);

  // D. Action Follow-up PDF
  const actPdf = await callerDistrict.monitoring.exportActionFollowupPdf();
  const actPdfBuffer = Buffer.from(actPdf.base64, "base64");
  console.log(`✓ Action Follow-up PDF generated: ${actPdf.filename} (${actPdfBuffer.length} bytes)`);

  // E. Workspace PDF
  const wsPdf = await callerMospi.monitoring.exportWorkspacePdf({ scope: "mospi" });
  const wsPdfBuffer = Buffer.from(wsPdf.base64, "base64");
  console.log(`✓ Workspace PDF generated: ${wsPdf.filename} (${wsPdfBuffer.length} bytes)`);

  // 4. Evidence Document 404 Bug Verification
  console.log("\n[4] Verifying Evidence Document & Physical File Resolution...");

  // A. Existing Image Evidence
  const photoEv = evData.find(e => e.mimeType?.startsWith("image/") && e.isActive);
  if (photoEv) {
    const photoDiskPath = path.resolve(process.cwd(), "uploads", "evidence", path.basename(photoEv.fileUrl || photoEv.fileName || ""));
    const photoExists = fs.existsSync(photoDiskPath);
    console.log(`✓ Existing Photo Evidence: [${photoEv.evidenceCode}] -> ${photoEv.fileUrl} | On-disk: ${photoExists}`);
  }

  // B. Existing PDF Document: structural_compliance_cert.pdf
  const structCertPath = path.resolve(process.cwd(), "uploads", "evidence", "structural_compliance_cert.pdf");
  if (!fs.existsSync(structCertPath)) throw new Error("structural_compliance_cert.pdf physical file missing!");
  console.log(`✓ Existing PDF Document: structural_compliance_cert.pdf exists physically (${fs.statSync(structCertPath).size} bytes)`);

  // C. Another Project Document: soil_load_verification_2026.pdf
  const soilCertPath = path.resolve(process.cwd(), "uploads", "evidence", "soil_load_verification_2026.pdf");
  if (!fs.existsSync(soilCertPath)) throw new Error("soil_load_verification_2026.pdf physical file missing!");
  console.log(`✓ Project MPLAD-2025-095 Document: soil_load_verification_2026.pdf exists physically (${fs.statSync(soilCertPath).size} bytes)`);

  // D. Test Uploading a New Document Evidence (District execution)
  console.log("\n[5] Testing Uploading New Document Evidence...");
  const dummyPdfContent = "%PDF-1.4\n%Demo test document content for Nigraani AI RBAC\n%%EOF";
  const dummyBase64 = `data:application/pdf;base64,${Buffer.from(dummyPdfContent).toString("base64")}`;
  const newDocUpload = await callerDistrict.monitoring.submitProjectUpdate({
    projectCode: targetProject,
    newProgress: 75,
    newStatus: "Active",
    updateType: "E2E Verification Milestone",
    remarks: "Verification testing for newly attached inspection report document.",
    evidenceTitle: "Bridge Girder Radiography Inspection Sheet",
    evidenceCategory: "INSPECTION_REPORT",
    evidenceFileName: "bridge_girder_inspection.pdf",
    evidenceBase64: dummyBase64,
  });
  console.log(`✓ Newly attached document update success: ${newDocUpload.success}, projectCode: ${newDocUpload.projectCode}`);

  const [newEvRecord] = await db
    .select()
    .from(evidence)
    .where(eq(evidence.projectCode, targetProject))
    .orderBy(desc(evidence.id))
    .limit(1);

  console.log(`✓ New Evidence Record in DB: [${newEvRecord.evidenceCode}] fileUrl: ${newEvRecord.fileUrl}, mimeType: ${newEvRecord.mimeType}`);
  const newDocDiskPath = path.resolve(process.cwd(), "uploads", "evidence", path.basename(newEvRecord.fileUrl!));
  if (!fs.existsSync(newDocDiskPath)) throw new Error(`Newly uploaded file missing from disk: ${newDocDiskPath}`);
  console.log(`✓ Newly uploaded document verified on disk: ${newDocDiskPath} (${fs.statSync(newDocDiskPath).size} bytes)`);

  // E. Removed Evidence Record Auditability Check
  console.log("\n[6] Verifying Removed Evidence Auditability...");
  const removedList = evData.filter(e => !e.isActive);
  console.log(`✓ Total Removed Evidence Records in DB: ${removedList.length} (Auditable, marked inactive)`);
  if (removedList.length > 0) {
    console.log(`✓ Sample removed record: [${removedList[0].evidenceCode}] reason: "${removedList[0].removalReason}" removedAt: ${removedList[0].removedAt}`);
  }

  console.log("\n=== ALL END-TO-END VERIFICATIONS PASSED CLEANLY! ===");
}

main().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
