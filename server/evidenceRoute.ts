import { Router } from "express";
import fs from "fs";
import path from "path";
import { getDb } from "./db";
import { evidence, projects, anomalies, cases, projectUpdates, riskAssessments } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { getUploadsEvidenceDir } from "./uploadsDir";
import {
  generateInspectionDocumentPdf,
  generateProjectDetailPdf,
  generateCagSummaryPdf,
  generateEvidenceRegisterPdf,
  generateActionFollowupPdf,
  generateWorkspaceExportPdf,
} from "./services/pdfReportService";

export const evidenceRouter = Router();

// ── Evidence Serving Route with Proper MIME & Inline Disposition ──────────────
evidenceRouter.get("/uploads/evidence/:filename", async (req: any, res: any) => {
  const rawParam = req.params.filename;
  const filename = path.basename(rawParam);
  const uploadsEvidenceDir = getUploadsEvidenceDir();
  const filePath = path.join(uploadsEvidenceDir, filename);

  const sendFileWithHeaders = (absPath: string, name: string) => {
    const ext = path.extname(name).toLowerCase();
    if (ext === ".pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    } else if (ext === ".docx") {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    } else if (ext === ".doc") {
      res.setHeader("Content-Type", "application/msword");
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    } else if (ext === ".png") {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    } else if (ext === ".jpg" || ext === ".jpeg") {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    }
    return res.sendFile(absPath);
  };

  if (fs.existsSync(filePath)) {
    return sendFileWithHeaders(filePath, filename);
  }

  // If not found physically, check database for matching record
  try {
    const db = await getDb();
    if (db) {
      const allEv = await db.select().from(evidence);
      const matched = allEv.find(
        e =>
          path.basename(e.filePath || "") === filename ||
          path.basename(e.fileUrl || "") === filename ||
          e.evidenceCode === filename.replace(/\.[^/.]+$/, "")
      );

      if (matched && filename.toLowerCase().endsWith(".pdf")) {
        const buf = await generateInspectionDocumentPdf({
          title: matched.title || filename.replace(/\.pdf$/i, "").replace(/_/g, " "),
          projectCode: matched.projectCode,
          category: matched.category,
          uploadedBy: matched.uploadedBy || "District Authority",
          date: matched.createdAt ? new Date(matched.createdAt).toLocaleDateString("en-IN") : undefined,
        });

        try {
          fs.writeFileSync(filePath, buf);
        } catch (_) {}
        return sendFileWithHeaders(filePath, filename);
      }
    }
  } catch (err) {
    console.error("[EvidenceRouter] Error recovering missing document:", err);
  }

  return res.status(404).send("Evidence document not found");
});

// Alias /evidence/* to the same logic
evidenceRouter.get("/evidence/*", (req: any, res: any) => {
  const filename = path.basename(req.path);
  const target = `/uploads/evidence/${filename}`;
  return res.redirect(target);
});

// ── PDF Export Direct Download Endpoints ─────────────────────────────────────

// Project Details PDF
evidenceRouter.get("/api/export/pdf/project/:projectCode", async (req: any, res: any) => {
  try {
    const projectCode = req.params.projectCode;
    const db = await getDb();
    if (!db) return res.status(500).send("Database unavailable");

    const [project] = await db.select().from(projects).where(eq(projects.projectCode, projectCode));
    if (!project) return res.status(404).send("Project not found");

    const projAnomalies = await db.select().from(anomalies).where(eq(anomalies.projectCode, projectCode));
    const projCases = await db.select().from(cases).where(eq(cases.projectCode, projectCode));
    const projEvidence = await db.select().from(evidence).where(eq(evidence.projectCode, projectCode));
    const projUpdates = await db.select().from(projectUpdates).where(eq(projectUpdates.projectCode, projectCode));
    const [projAssessment] = await db.select().from(riskAssessments).where(eq(riskAssessments.projectCode, projectCode));

    const pdfBuffer = await generateProjectDetailPdf({
      project: {
        projectCode: project.projectCode,
        title: project.title,
        state: project.state,
        district: project.district,
        constituency: project.constituency,
        mpName: project.recommendedBy,
        implementingAgency: project.implementingAgency,
        sanctionedAmount: project.sanctionedAmount,
        spentAmount: project.spentAmount,
        progress: project.progress,
        status: project.status,
        riskScore: project.riskScore,
        riskLevel: project.riskLevel,
        aiReasoning: project.description || (projAssessment?.explainableFactors ? JSON.stringify(projAssessment.explainableFactors) : null),
        sourceType: project.sourceType,
        createdAt: project.createdAt,
      },
      anomalies: projAnomalies.map(a => ({
        moduleType: a.moduleType,
        score: a.score,
        severity: a.severity,
        details: a.reasoning || a.flaggedText,
      })),
      cases: projCases.map(c => ({
        caseNumber: c.caseNumber,
        status: c.status,
        priority: c.priority,
        assignedUser: c.assignedUser,
        investigatorRemarks: c.investigatorRemarks,
      })),
      evidence: projEvidence.map(e => ({
        evidenceCode: e.evidenceCode,
        title: e.title,
        category: e.category,
        fileName: e.filePath ? path.basename(e.filePath) : path.basename(e.fileUrl || "evidence.jpg"),
        uploadedBy: e.uploadedBy,
        createdAt: e.createdAt,
        isActive: e.isActive,
      })),
      updates: projUpdates.map(u => ({
        updateType: u.updateType,
        newProgress: u.newProgress ?? 0,
        remarks: u.remarks ?? "",
        updatedBy: u.updatedBy,
        createdAt: u.createdAt,
      })),
    });

    const filename = `nigraani_project_${projectCode}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("[ExportProjectPdf] Error:", err);
    return res.status(500).send("Failed to generate PDF");
  }
});

// CAG Audit & Assurance Status Summary PDF
evidenceRouter.get("/api/export/pdf/cag-summary", async (_req: any, res: any) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).send("Database unavailable");

    const projectRows = await db.select().from(projects).orderBy(desc(projects.riskScore));
    const anomalyRows = await db.select().from(anomalies);
    const caseRows = await db.select().from(cases);
    const evidenceRows = await db.select().from(evidence);

    const anomalyMap = new Map<string, typeof anomalyRows>();
    for (const a of anomalyRows) {
      if (!anomalyMap.has(a.projectCode)) anomalyMap.set(a.projectCode, []);
      anomalyMap.get(a.projectCode)!.push(a);
    }
    const caseMap = new Map<string, typeof caseRows[number] | undefined>();
    for (const c of caseRows) {
      if (!caseMap.has(c.projectCode)) caseMap.set(c.projectCode, c);
    }
    const evidenceMap = new Map<string, number>();
    for (const e of evidenceRows) {
      if (e.isActive) evidenceMap.set(e.projectCode, (evidenceMap.get(e.projectCode) ?? 0) + 1);
    }

    const rows = projectRows.map(p => {
      const pAnoms = anomalyMap.get(p.projectCode) ?? [];
      const pCase = caseMap.get(p.projectCode);
      return {
        projectCode: p.projectCode,
        title: p.title,
        district: p.district,
        status: p.status,
        riskScore: p.riskScore,
        anomalyCount: pAnoms.length,
        caseStatus: pCase?.status ?? "No Case",
        investigator: pCase?.assignedUser ?? "",
        evidenceCount: evidenceMap.get(p.projectCode) ?? 0,
        anomalyModules: Array.from(new Set(pAnoms.map(a => a.moduleType))).join(", "),
      };
    });

    const pdfBuffer = await generateCagSummaryPdf(rows);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="nigraani_audit_assurance_status.pdf"');
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("[ExportCagPdf] Error:", err);
    return res.status(500).send("Failed to generate PDF");
  }
});

// Evidence Register PDF
evidenceRouter.get("/api/export/pdf/evidence-register", async (_req: any, res: any) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).send("Database unavailable");

    const rows = await db.select().from(evidence).orderBy(desc(evidence.id));
    const formatted = rows.map(r => ({
      evidenceCode: r.evidenceCode,
      projectCode: r.projectCode,
      title: r.title,
      category: r.category,
      fileName: r.filePath ? path.basename(r.filePath) : path.basename(r.fileUrl || "file"),
      uploadedBy: r.uploadedBy,
      uploadedRole: r.uploadedRole,
      status: r.isActive ? "Active" : "Removed",
      createdAt: r.createdAt,
    }));

    const pdfBuffer = await generateEvidenceRegisterPdf(formatted);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="nigraani_evidence_register.pdf"');
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("[ExportEvidencePdf] Error:", err);
    return res.status(500).send("Failed to generate PDF");
  }
});

// Action Follow-up PDF
evidenceRouter.get("/api/export/pdf/action-followup", async (_req: any, res: any) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).send("Database unavailable");

    const caseRows = await db.select().from(cases).orderBy(desc(cases.id));
    const projectRows = await db.select().from(projects);
    const pMap = new Map(projectRows.map(p => [p.projectCode, p]));

    const formatted = caseRows.map(c => {
      const proj = pMap.get(c.projectCode);
      return {
        caseNumber: c.caseNumber,
        projectCode: c.projectCode,
        title: proj?.title || c.title,
        priority: c.priority,
        status: c.status,
        assignedUser: c.assignedUser || "Unassigned",
        latestAction: c.status,
        latestRemark: c.investigatorRemarks || "Under investigation",
        createdAt: c.createdAt,
      };
    });

    const pdfBuffer = await generateActionFollowupPdf(formatted);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="nigraani_action_followup.pdf"');
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("[ExportActionFollowupPdf] Error:", err);
    return res.status(500).send("Failed to generate PDF");
  }
});

// Workspace Export PDF
evidenceRouter.get("/api/export/pdf/workspace", async (req: any, res: any) => {
  try {
    const scope = (req.query.scope as string) || "national";
    const db = await getDb();
    if (!db) return res.status(500).send("Database unavailable");

    const projectRows = await db.select().from(projects).orderBy(desc(projects.riskScore));
    const rows = projectRows.map(p => ({
      projectCode: p.projectCode,
      title: p.title,
      district: p.district,
      state: p.state,
      status: p.status,
      riskScore: p.riskScore,
      progress: `${p.progress}%`,
    }));

    const pdfBuffer = await generateWorkspaceExportPdf(rows, scope);
    const ts = new Date().toISOString().slice(0, 10);
    const filename = `nigraani_${scope}_export_${ts}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("[ExportWorkspacePdf] Error:", err);
    return res.status(500).send("Failed to generate PDF");
  }
});
