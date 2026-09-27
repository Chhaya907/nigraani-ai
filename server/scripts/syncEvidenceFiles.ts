import { getDb } from "../db";
import { evidence } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { generateInspectionDocumentPdf } from "../services/pdfReportService";

export async function syncEvidenceFiles() {
  const db = await getDb();
  if (!db) return;

  const uploadsEvidenceDir = path.resolve(process.cwd(), "uploads", "evidence");
  if (!fs.existsSync(uploadsEvidenceDir)) {
    fs.mkdirSync(uploadsEvidenceDir, { recursive: true });
  }

  const allEv = await db.select().from(evidence);

  for (const e of allEv) {
    const rawName = e.filePath || e.fileUrl || "";
    const filename = path.basename(rawName);

    // If filename indicates a PDF document
    if (filename.toLowerCase().endsWith(".pdf")) {
      const targetPath = path.join(uploadsEvidenceDir, filename);

      if (!fs.existsSync(targetPath)) {
        console.log(`[EvidenceSync] Generating missing physical PDF: ${filename} for ${e.projectCode}`);
        const pdfBuf = await generateInspectionDocumentPdf({
          title: e.title || filename.replace(/\.pdf$/i, "").replace(/_/g, " "),
          projectCode: e.projectCode,
          category: e.category,
          uploadedBy: e.uploadedBy || "District Authority",
          date: e.createdAt ? new Date(e.createdAt).toLocaleDateString("en-IN") : undefined,
        });
        fs.writeFileSync(targetPath, pdfBuf);
      }

      // Update db record if fileUrl is missing or wrong
      const correctUrl = `/uploads/evidence/${filename}`;
      if (e.fileUrl !== correctUrl || !e.mimeType) {
        await db.update(evidence).set({
          fileUrl: correctUrl,
          mimeType: "application/pdf",
          fileSize: fs.existsSync(targetPath) ? fs.statSync(targetPath).size : e.fileSize,
        }).where(eq(evidence.id, e.id));
        console.log(`[EvidenceSync] Updated DB fileUrl for evidence ID ${e.id} -> ${correctUrl}`);
      }
    }
  }
}

// Run if called directly
if (process.argv[1] && process.argv[1].includes("syncEvidenceFiles")) {
  syncEvidenceFiles()
    .then(() => {
      console.log("[EvidenceSync] Complete!");
      process.exit(0);
    })
    .catch(err => {
      console.error("[EvidenceSync] Error:", err);
      process.exit(1);
    });
}
