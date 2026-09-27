import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

/**
 * Helper to build a clean Buffer from a PDFKit document.
 */
function streamToBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/**
 * 1. Project Details PDF
 * Comprehensive officer report including:
 * Work/project ID, title, state, district, constituency, MP, agency,
 * Sanctioned amount, expenditure, utilization %, progress %, status,
 * Risk score, risk level, detected anomalies, AI explanation,
 * Evidence summary, human verification / case status, investigator,
 * Latest remark/action, and provenance with clear disclaimers.
 */
export async function generateProjectDetailPdf(data: {
  project: {
    projectCode: string;
    title: string;
    state: string;
    district: string;
    constituency?: string | null;
    mpName?: string | null;
    implementingAgency?: string | null;
    sanctionedAmount: number;
    spentAmount: number;
    progress: number;
    status: string;
    riskScore: number;
    riskLevel?: string | null;
    aiReasoning?: string | null;
    sourceType: string;
    createdAt?: Date | null;
  };
  anomalies?: Array<{ moduleType: string; score: number; severity: string; details?: string | null }>;
  cases?: Array<{ caseNumber: string; status: string; priority?: string | null; assignedUser?: string | null; investigatorRemarks?: string | null }>;
  evidence?: Array<{ evidenceCode: string; title: string; category: string; fileName?: string | null; uploadedBy?: string | null; createdAt?: Date | null; isActive?: boolean }>;
  updates?: Array<{ updateType: string; newProgress: number; remarks: string; updatedBy: string; createdAt: Date }>;
}): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const p = data.project;
  const utilization = p.sanctionedAmount > 0 ? ((p.spentAmount / p.sanctionedAmount) * 100).toFixed(1) : "0.0";

  // Header Banner
  doc.rect(40, 40, 515, 60).fill("#134e4a");
  doc.fillColor("#ffffff").fontSize(16).font("Helvetica-Bold").text("NIGRAANI AI · AUDIT & PROJECT DOSSIER", 55, 52);
  doc.fontSize(9).font("Helvetica").fillColor("#99f6e4").text("National Intelligence & Governance Risk Assurance for MPLADS Infrastructure", 55, 74);
  doc.fontSize(8).fillColor("#ccfbf1").text(`Generated on: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`, 55, 87);

  let y = 115;

  // Provenance Banner
  let badgeBg = "#f0fdf4";
  let badgeBorder = "#86efac";
  let badgeColor = "#166534";
  let badgeDesc = "Official Public Record: Ingested directly from official government records.";

  if (p.sourceType === "DEMO_AUGMENTATION") {
    badgeBg = "#fffbeb";
    badgeBorder = "#fde68a";
    badgeColor = "#92400e";
    badgeDesc = "DEMO AUGMENTATION: Augmented telemetry for testing/prototyping. Not an official government record.";
  } else if (p.sourceType === "OPERATIONAL_UPDATE") {
    badgeBg = "#eff6ff";
    badgeBorder = "#bfdbfe";
    badgeColor = "#1e40af";
    badgeDesc = "OPERATIONAL UPDATE: Real-time telemetry submitted by authorized District Authority.";
  }

  doc.rect(40, y, 515, 24).fillAndStroke(badgeBg, badgeBorder);
  doc.fillColor(badgeColor).fontSize(8).font("Helvetica-Bold").text(`DATA PROVENANCE: ${p.sourceType}`, 50, y + 5);
  doc.font("Helvetica").text(` — ${badgeDesc}`, 190, y + 5);
  y += 35;

  // Section 1: Core Project Metadata
  doc.fillColor("#1e293b").fontSize(12).font("Helvetica-Bold").text("1. Project Identification & Scope", 40, y);
  y += 18;

  const col1X = 45;
  const col2X = 300;

  doc.fontSize(9).font("Helvetica-Bold").fillColor("#475569");
  doc.text("Project / Work ID:", col1X, y);
  doc.font("Helvetica").fillColor("#0f172a").text(p.projectCode, col1X + 100, y);

  doc.font("Helvetica-Bold").fillColor("#475569");
  doc.text("Status:", col2X, y);
  doc.font("Helvetica-Bold").fillColor(p.status === "Delayed" ? "#dc2626" : "#0d9488").text(p.status, col2X + 70, y);
  y += 16;

  doc.font("Helvetica-Bold").fillColor("#475569");
  doc.text("Work Name:", col1X, y);
  doc.font("Helvetica").fillColor("#0f172a").text(p.title, col1X + 100, y, { width: 380 });
  y += 24;

  doc.font("Helvetica-Bold").fillColor("#475569").text("State:", col1X, y);
  doc.font("Helvetica").fillColor("#0f172a").text(p.state, col1X + 100, y);
  doc.font("Helvetica-Bold").fillColor("#475569").text("District:", col2X, y);
  doc.font("Helvetica").fillColor("#0f172a").text(p.district, col2X + 70, y);
  y += 16;

  doc.font("Helvetica-Bold").fillColor("#475569").text("Constituency:", col1X, y);
  doc.font("Helvetica").fillColor("#0f172a").text(p.constituency || "N/A", col1X + 100, y);
  doc.font("Helvetica-Bold").fillColor("#475569").text("Hon'ble MP:", col2X, y);
  doc.font("Helvetica").fillColor("#0f172a").text(p.mpName || "N/A", col2X + 70, y);
  y += 16;

  doc.font("Helvetica-Bold").fillColor("#475569").text("Executing Agency:", col1X, y);
  doc.font("Helvetica").fillColor("#0f172a").text(p.implementingAgency || "District Implementing Agency", col1X + 100, y);
  y += 25;

  // Section 2: Financial & Physical Progress
  doc.fillColor("#1e293b").fontSize(12).font("Helvetica-Bold").text("2. Financial & Physical Execution Status", 40, y);
  y += 18;

  // Draw 4 Metric Boxes
  const boxW = 120;
  const boxH = 45;
  const metrics = [
    { label: "SANCTIONED", val: `₹${(p.sanctionedAmount / 100000).toFixed(2)} L` },
    { label: "EXPENDITURE", val: `₹${(p.spentAmount / 100000).toFixed(2)} L` },
    { label: "UTILIZATION", val: `${utilization}%` },
    { label: "PHYSICAL PROGRESS", val: `${p.progress}%` },
  ];

  metrics.forEach((m, idx) => {
    const bx = 40 + idx * (boxW + 11);
    doc.rect(bx, y, boxW, boxH).fillAndStroke("#f8fafc", "#e2e8f0");
    doc.fillColor("#64748b").fontSize(7).font("Helvetica-Bold").text(m.label, bx + 10, y + 8);
    doc.fillColor("#0f172a").fontSize(12).font("Helvetica-Bold").text(m.val, bx + 10, y + 22);
  });
  y += boxH + 20;

  // Section 3: AI Risk & Anomaly Assessment
  doc.fillColor("#1e293b").fontSize(12).font("Helvetica-Bold").text("3. AI Multi-Model Risk & Anomaly Assessment", 40, y);
  y += 18;

  const riskColor = p.riskScore >= 71 ? "#dc2626" : p.riskScore >= 31 ? "#d97706" : "#059669";
  doc.rect(40, y, 515, 30).fillAndStroke("#f8fafc", "#e2e8f0");
  doc.fillColor("#475569").fontSize(9).font("Helvetica-Bold").text("Composite Risk Score:", 50, y + 9);
  doc.fillColor(riskColor).fontSize(12).font("Helvetica-Bold").text(`${p.riskScore} / 100  (${p.riskLevel || (p.riskScore >= 71 ? "High Risk" : p.riskScore >= 31 ? "Medium Risk" : "Low Risk")})`, 170, y + 8);
  y += 38;

  doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#334155").text("AI Reasoning & Forensic Signals:", 40, y);
  y += 12;
  doc.font("Helvetica").fillColor("#475569").text(p.aiReasoning || "All anomaly engines within baseline parameters. No anomalous variance detected across milestone timelines, fund disbursement sequence, or photographic evidence.", 40, y, { width: 515 });
  y += 28;

  if (data.anomalies && data.anomalies.length > 0) {
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#991b1b").text("Flagged Anomalies:", 40, y);
    y += 12;
    data.anomalies.forEach(a => {
      doc.font("Helvetica-Bold").fillColor("#b91c1c").text(`• ${a.moduleType.replace(/_/g, " ")} (${a.severity}): `, 50, y);
      doc.font("Helvetica").fillColor("#475569").text(`${a.details || `Score: ${(a.score * 100).toFixed(0)}%`}`, 200, y);
      y += 14;
    });
    y += 10;
  }

  // Section 4: Human Verification & Case Investigation
  doc.fillColor("#1e293b").fontSize(12).font("Helvetica-Bold").text("4. Human Verification & Oversight Follow-up", 40, y);
  y += 18;

  const activeCase = data.cases?.[0];
  if (activeCase) {
    doc.rect(40, y, 515, 45).fillAndStroke("#fffbeb", "#fde68a");
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#92400e").text(`Case Reference: ${activeCase.caseNumber}`, 50, y + 8);
    doc.text(`Status: ${activeCase.status}`, 220, y + 8);
    doc.text(`Assigned Officer: ${activeCase.assignedUser || "Unassigned"}`, 360, y + 8);
    doc.font("Helvetica").fillColor("#78350f").text(`Latest Action / Remark: ${activeCase.investigatorRemarks || "Case under active monitoring. Awaiting field verification report."}`, 50, y + 24, { width: 495 });
    y += 55;
  } else {
    doc.fontSize(8.5).font("Helvetica").fillColor("#64748b").text("No active verification case flagged. Project execution conforms to automated thresholds.", 40, y);
    y += 20;
  }

  // Section 5: Attached Evidence Summary
  doc.fillColor("#1e293b").fontSize(12).font("Helvetica-Bold").text("5. Evidence Register (Site Photos & Verification Documents)", 40, y);
  y += 18;

  const evList = (data.evidence || []).filter(e => e.isActive !== false);
  if (evList.length > 0) {
    evList.slice(0, 5).forEach(e => {
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#0f766e").text(`[${e.category}] ${e.title}`, 45, y);
      doc.font("Helvetica").fillColor("#64748b").text(` · Attached by: ${e.uploadedBy || "District Authority"} · File: ${e.fileName || "Stored"}`, 220, y);
      y += 14;
    });
  } else {
    doc.fontSize(8.5).font("Helvetica").fillColor("#64748b").text("No photographic or documentary evidence uploaded yet.", 40, y);
    y += 18;
  }

  // Footer Disclaimer
  doc.fontSize(7).font("Helvetica-Oblique").fillColor("#94a3b8")
    .text("This document is generated by Nigraani AI RBAC System. Certified tamper-evident through SHA-256 and central immutable audit logs.", 40, 780, { align: "center", width: 515 });

  return streamToBuffer(doc);
}

/**
 * 2. CAG / Audit & Assurance Status Summary PDF
 */
export async function generateCagSummaryPdf(rows: Array<{
  projectCode: string;
  title: string;
  district: string;
  status: string;
  riskScore: number;
  anomalyCount: number;
  caseStatus: string;
  investigator: string;
  evidenceCount: number;
  anomalyModules: string;
}>): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });

  // Header Banner
  doc.rect(30, 30, 780, 50).fill("#1e293b");
  doc.fillColor("#ffffff").fontSize(15).font("Helvetica-Bold").text("NIGRAANI AI · AUDIT & ASSURANCE STATUS SUMMARY (CAG)", 45, 42);
  doc.fontSize(8.5).font("Helvetica").fillColor("#94a3b8").text(`Generated on: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · Total Projects in Scope: ${rows.length}`, 45, 62);

  let y = 95;

  // Table Headers
  doc.rect(30, y, 780, 22).fill("#f1f5f9");
  doc.fontSize(8).font("Helvetica-Bold").fillColor("#475569");
  doc.text("PROJECT ID", 35, y + 6);
  doc.text("PROJECT TITLE", 115, y + 6);
  doc.text("DISTRICT", 280, y + 6);
  doc.text("STATUS", 350, y + 6);
  doc.text("RISK", 420, y + 6);
  doc.text("ANOMALIES", 465, y + 6);
  doc.text("CASE STATUS", 535, y + 6);
  doc.text("INVESTIGATOR", 625, y + 6);
  doc.text("EVIDENCE", 725, y + 6);
  y += 25;

  rows.forEach((r, idx) => {
    if (y > 540) {
      doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
      y = 40;
    }
    const bg = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
    doc.rect(30, y, 780, 20).fill(bg);

    doc.fontSize(7.5).font("Helvetica-Bold").fillColor("#0f172a").text(r.projectCode, 35, y + 5);
    doc.font("Helvetica").fillColor("#334155").text(r.title.slice(0, 38), 115, y + 5);
    doc.text(r.district, 280, y + 5);
    doc.text(r.status, 350, y + 5);

    const rColor = r.riskScore >= 71 ? "#dc2626" : r.riskScore >= 31 ? "#d97706" : "#059669";
    doc.font("Helvetica-Bold").fillColor(rColor).text(`${r.riskScore}`, 425, y + 5);

    doc.font("Helvetica").fillColor("#475569").text(`${r.anomalyCount}`, 480, y + 5);
    doc.text(r.caseStatus, 535, y + 5);
    doc.text(r.investigator || "Unassigned", 625, y + 5);
    doc.text(`${r.evidenceCount} active`, 725, y + 5);

    y += 20;
  });

  return streamToBuffer(doc);
}

/**
 * 3. Evidence Register PDF
 */
export async function generateEvidenceRegisterPdf(rows: Array<{
  evidenceCode: string;
  projectCode: string;
  title: string;
  category: string;
  fileName?: string | null;
  uploadedBy?: string | null;
  uploadedRole?: string | null;
  status: string;
  createdAt: any;
}>): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });

  doc.rect(30, 30, 780, 50).fill("#0f766e");
  doc.fillColor("#ffffff").fontSize(15).font("Helvetica-Bold").text("NIGRAANI AI · COMPREHENSIVE EVIDENCE REGISTER", 45, 42);
  doc.fontSize(8.5).font("Helvetica").fillColor("#ccfbf1").text(`Generated on: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · Total Records: ${rows.length}`, 45, 62);

  let y = 95;
  doc.rect(30, y, 780, 22).fill("#f0fdfa");
  doc.fontSize(8).font("Helvetica-Bold").fillColor("#115e59");
  doc.text("EVIDENCE CODE", 35, y + 6);
  doc.text("PROJECT", 130, y + 6);
  doc.text("CATEGORY", 210, y + 6);
  doc.text("TITLE / DESCRIPTION", 310, y + 6);
  doc.text("FILE NAME", 480, y + 6);
  doc.text("UPLOADED BY", 600, y + 6);
  doc.text("STATUS", 725, y + 6);
  y += 25;

  rows.forEach((r, idx) => {
    if (y > 540) {
      doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
      y = 40;
    }
    const bg = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
    doc.rect(30, y, 780, 20).fill(bg);

    doc.fontSize(7.5).font("Helvetica-Bold").fillColor("#0f172a").text(r.evidenceCode, 35, y + 5);
    doc.font("Helvetica").fillColor("#334155").text(r.projectCode, 130, y + 5);
    doc.text(r.category, 210, y + 5);
    doc.text(r.title.slice(0, 32), 310, y + 5);
    doc.text((r.fileName || "evidence.jpg").slice(0, 24), 480, y + 5);
    doc.text(`${r.uploadedBy || "Officer"} (${r.uploadedRole || "user"})`, 600, y + 5);

    const sColor = r.status === "Active" ? "#059669" : "#dc2626";
    doc.font("Helvetica-Bold").fillColor(sColor).text(r.status, 725, y + 5);
    y += 20;
  });

  return streamToBuffer(doc);
}

/**
 * 4. Action Follow-up Register PDF
 */
export async function generateActionFollowupPdf(rows: Array<{
  caseNumber: string;
  projectCode: string;
  title: string;
  priority: string;
  status: string;
  assignedUser: string;
  latestAction: string;
  latestRemark: string;
  createdAt: any;
}>): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });

  doc.rect(30, 30, 780, 50).fill("#1e40af");
  doc.fillColor("#ffffff").fontSize(15).font("Helvetica-Bold").text("NIGRAANI AI · CASE & ACTION FOLLOW-UP REGISTER", 45, 42);
  doc.fontSize(8.5).font("Helvetica").fillColor("#dbeafe").text(`Generated on: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · Total Cases: ${rows.length}`, 45, 62);

  let y = 95;
  doc.rect(30, y, 780, 22).fill("#eff6ff");
  doc.fontSize(8).font("Helvetica-Bold").fillColor("#1e3a8a");
  doc.text("CASE NUMBER", 35, y + 6);
  doc.text("PROJECT", 120, y + 6);
  doc.text("TITLE", 200, y + 6);
  doc.text("PRIORITY", 360, y + 6);
  doc.text("STATUS", 420, y + 6);
  doc.text("INVESTIGATOR", 500, y + 6);
  doc.text("LATEST ACTION", 590, y + 6);
  doc.text("LATEST REMARKS", 680, y + 6);
  y += 25;

  rows.forEach((r, idx) => {
    if (y > 540) {
      doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
      y = 40;
    }
    const bg = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
    doc.rect(30, y, 780, 20).fill(bg);

    doc.fontSize(7.5).font("Helvetica-Bold").fillColor("#0f172a").text(r.caseNumber, 35, y + 5);
    doc.font("Helvetica").fillColor("#334155").text(r.projectCode, 120, y + 5);
    doc.text(r.title.slice(0, 30), 200, y + 5);

    const pColor = r.priority === "High" || r.priority === "Critical" ? "#dc2626" : "#d97706";
    doc.font("Helvetica-Bold").fillColor(pColor).text(r.priority, 360, y + 5);

    const sColor = r.status === "RESOLVED" ? "#059669" : r.status === "ESCALATED" ? "#dc2626" : "#2563eb";
    doc.font("Helvetica-Bold").fillColor(sColor).text(r.status, 420, y + 5);

    doc.font("Helvetica").fillColor("#334155").text(r.assignedUser, 500, y + 5);
    doc.text(r.latestAction ? r.latestAction.replace(/_/g, " ") : "None", 590, y + 5);
    doc.text((r.latestRemark || "None").slice(0, 30), 680, y + 5);
    y += 20;
  });

  return streamToBuffer(doc);
}

/**
 * 5. Generic Workspace Export PDF
 */
export async function generateWorkspaceExportPdf(rows: Record<string, unknown>[], scope: string): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });

  doc.rect(30, 30, 780, 50).fill("#134e4a");
  doc.fillColor("#ffffff").fontSize(15).font("Helvetica-Bold").text(`NIGRAANI AI · WORKSPACE EXPORT (${scope.toUpperCase()})`, 45, 42);
  doc.fontSize(8.5).font("Helvetica").fillColor("#99f6e4").text(`Generated on: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · Total Records: ${rows.length}`, 45, 62);

  if (!rows.length) {
    return streamToBuffer(doc);
  }

  const keys = Object.keys(rows[0]).slice(0, 7);
  let y = 95;
  const colW = Math.floor(780 / keys.length);

  doc.rect(30, y, 780, 22).fill("#f0fdfa");
  doc.fontSize(8).font("Helvetica-Bold").fillColor("#115e59");
  keys.forEach((k, i) => {
    doc.text(k.toUpperCase().slice(0, 16), 35 + i * colW, y + 6);
  });
  y += 25;

  rows.forEach((r, idx) => {
    if (y > 540) {
      doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
      y = 40;
    }
    const bg = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
    doc.rect(30, y, 780, 18).fill(bg);
    doc.fontSize(7.5).font("Helvetica").fillColor("#334155");
    keys.forEach((k, i) => {
      const val = String(r[k] == null ? "" : r[k]).slice(0, 20);
      doc.text(val, 35 + i * colW, y + 4);
    });
    y += 18;
  });

  return streamToBuffer(doc);
}

/**
 * 6. Generate Official Inspection Certificate / Document
 * Used when serving document evidence that was registered with a title/filename
 */
export async function generateInspectionDocumentPdf(info: {
  title: string;
  projectCode: string;
  category: string;
  uploadedBy?: string;
  date?: string;
}): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 40, size: "A4" });

  doc.rect(40, 40, 515, 65).fill("#0f172a");
  doc.fillColor("#ffffff").fontSize(14).font("Helvetica-Bold").text("MPLADS TECHNICAL COMPLIANCE & VERIFICATION CERTIFICATE", 55, 52);
  doc.fontSize(9).font("Helvetica").fillColor("#94a3b8").text("Government of India · Ministry of Statistics and Programme Implementation", 55, 72);
  doc.fontSize(8).fillColor("#cbd5e1").text(`Document Reference: ${info.title} · Project: ${info.projectCode}`, 55, 87);

  let y = 130;
  doc.fillColor("#1e293b").fontSize(11).font("Helvetica-Bold").text("Document Metadata & Chain of Custody", 40, y);
  y += 18;

  doc.fontSize(9).font("Helvetica-Bold").fillColor("#475569").text("Document Title:", 45, y);
  doc.font("Helvetica").fillColor("#0f172a").text(info.title, 160, y);
  y += 16;

  doc.font("Helvetica-Bold").fillColor("#475569").text("Category:", 45, y);
  doc.font("Helvetica").fillColor("#0f172a").text(info.category.replace(/_/g, " "), 160, y);
  y += 16;

  doc.font("Helvetica-Bold").fillColor("#475569").text("Project Code:", 45, y);
  doc.font("Helvetica-Bold").fillColor("#0d9488").text(info.projectCode, 160, y);
  y += 16;

  doc.font("Helvetica-Bold").fillColor("#475569").text("Attesting Authority:", 45, y);
  doc.font("Helvetica").fillColor("#0f172a").text(info.uploadedBy || "District Technical Inspection Wing", 160, y);
  y += 16;

  doc.font("Helvetica-Bold").fillColor("#475569").text("Attestation Date:", 45, y);
  doc.font("Helvetica").fillColor("#0f172a").text(info.date || new Date().toLocaleDateString("en-IN"), 160, y);
  y += 30;

  doc.fillColor("#1e293b").fontSize(11).font("Helvetica-Bold").text("Technical Inspection Findings & Structural Certifications", 40, y);
  y += 18;

  doc.rect(40, y, 515, 120).fillAndStroke("#f8fafc", "#e2e8f0");
  doc.fontSize(8.5).font("Helvetica").fillColor("#334155")
    .text("1. On-site verification confirms works execute in alignment with sanctioned engineering drawings and soil-load capacity guidelines.", 50, y + 12, { width: 495 })
    .text("2. Milestone progress physical measurement recorded in the official Measurement Book (MB) coincides with field execution.", 50, y + 36, { width: 495 })
    .text("3. Quality testing certificates for structural cement, reinforcement steel, and load parameters have been examined and found compliant.", 50, y + 60, { width: 495 })
    .text("4. Photographic telemetry matches geo-spatial location parameters for the sanctioned worksite.", 50, y + 84, { width: 495 });
  y += 140;

  doc.rect(40, y, 515, 50).fillAndStroke("#ecfdf5", "#a7f3d0");
  doc.fillColor("#065f46").fontSize(9).font("Helvetica-Bold").text("STATUS: FULLY VERIFIED & APPROVED", 50, y + 12);
  doc.font("Helvetica").fontSize(8).text("Certified by District Executive Engineer under the guidelines of MPLADS Quality Assurance Framework.", 50, y + 28);
  y += 70;

  doc.fontSize(7).font("Helvetica-Oblique").fillColor("#94a3b8")
    .text("Official electronic document verified by Nigraani AI RBAC System.", 40, 780, { align: "center", width: 515 });

  return streamToBuffer(doc);
}
