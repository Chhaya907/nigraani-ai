import { z } from "zod";
import fs from "fs";
import path from "path";
import { COOKIE_NAME } from "@shared/const";
import { canRolePerform, DEMO_ACCOUNTS, getRoleSnapshot, ROLE_DEFINITIONS, type PermissionAction, type RoleKey } from "../shared/monitoring";
import { getSessionCookieOptions } from "./_core/cookies.js";
import { DEMO_SESSION_COOKIE } from "./_core/context.js";
import { systemRouter } from "./_core/systemRouter.js";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { desc, eq, and, or, ne } from "drizzle-orm";
import { getDb } from "./db.js";
import { projects, dataImports, dataProvenance, anomalies, riskAssessments, cases, projectUpdates, expenditures, evidence, auditLogs } from "../drizzle/schema.js";
import { ingestOfficialMpladsRecords, ingestBaseOfficialDataset } from "./services/mpladsIngestion.js";
import { runFullAiEvaluation, evaluateSingleProject } from "./services/anomalyService.js";
import { buildLiveSnapshot } from "./services/dashboardService.js";
import { perceptualHashEngine } from "./ml/perceptualHash.js";
import { nanoid } from "nanoid";
import {
  generateInspectionDocumentPdf,
  generateProjectDetailPdf,
  generateCagSummaryPdf,
  generateEvidenceRegisterPdf,
  generateActionFollowupPdf,
  generateWorkspaceExportPdf,
} from "./services/pdfReportService.js";
import { getUploadsEvidenceDir } from "./uploadsDir.js";

const permissionActions = [
  "processRecommendation",
  "respondToAiAlert",
  "requestClarification",
  "manageCorrectiveAction",
  "escalateIssue",
  "submitRecommendation",
  "recordAuditFinding",
  "issueAuditRecommendation",
  "updateFollowup",
  "configureParameters",
  "exportReport",
  "addEvidence",
] as const satisfies readonly PermissionAction[];

const auditEvents: Array<{
  id: string;
  role: RoleKey;
  user: string;
  action: string;
  targetId: string;
  timestamp: string;
  comments: string;
}> = [
    { id: "AUDIT-001", role: "mospi", user: "A. Qureshi", action: "National overview reviewed", targetId: "PORTFOLIO-2026", timestamp: "23 Sept 2026 · 09:42 IST", comments: "Reviewed current national risk concentration." },
    { id: "AUDIT-002", role: "district", user: "P. Yadav", action: "Evidence uploaded", targetId: "MPLAD-2025-001", timestamp: "22 Sept 2026 · 16:18 IST", comments: "Measurement book and site photograph added." },
    { id: "AUDIT-003", role: "cag", user: "S. Iyer", action: "Audit observation recorded", targetId: "AUD-26-014", timestamp: "20 Sept 2026 · 11:06 IST", comments: "Fund movement variance sent for management response." },
  ];

const userSummary = (user: NonNullable<import("../drizzle/schema").User>) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  roleLabel: ROLE_DEFINITIONS[user.role].label,
});

function saveEvidenceFile({
  projectCode,
  evidenceCode,
  base64Data,
  fileName,
  category,
}: {
  projectCode: string;
  evidenceCode: string;
  base64Data: string;
  fileName?: string;
  category?: string;
}): {
  fileUrl: string;
  storedFileName: string;
  fileSize: number;
  mimeType: string | null;
  buffer: Buffer;
} {
  const matches = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  let buffer: Buffer;
  let mimeType: string | null = null;
  if (matches) {
    mimeType = matches[1];
    buffer = Buffer.from(matches[2], "base64");
  } else {
    buffer = Buffer.from(base64Data.replace(/^data:[^;]+;base64,/, ""), "base64");
  }

  let ext = ".jpg";
  if (fileName && path.extname(fileName)) {
    ext = path.extname(fileName);
  } else if (mimeType) {
    if (mimeType === "image/png") ext = ".png";
    else if (mimeType === "image/webp") ext = ".webp";
    else if (mimeType === "image/jpeg" || mimeType === "image/jpg") ext = ".jpg";
    else if (mimeType === "application/pdf") ext = ".pdf";
    else if (mimeType.includes("word") || mimeType.includes("doc")) ext = ".docx";
  } else if (category === "SITE_PHOTO") {
    ext = ".jpg";
  } else {
    ext = ".pdf";
  }

  const uploadsEvidenceDir = getUploadsEvidenceDir();
  const cleanOriginal = (fileName || `evidence${ext}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const diskFileName = `${evidenceCode}_${Date.now()}_${cleanOriginal}`;
  const diskFilePath = path.join(uploadsEvidenceDir, diskFileName);

  try {
    fs.writeFileSync(diskFilePath, buffer);
  } catch (_) { }

  return {
    fileUrl: `/uploads/evidence/${diskFileName}`,
    storedFileName: fileName || cleanOriginal,
    fileSize: buffer.length,
    mimeType,
    buffer,
  };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => (opts.ctx.user ? userSummary(opts.ctx.user) : null)),
    demoLogin: publicProcedure
      .input(z.object({ username: z.string().min(1), password: z.string().min(1) }))
      .mutation(({ ctx, input }) => {
        const index = DEMO_ACCOUNTS.findIndex(item => item.username === input.username && item.password === input.password);
        if (index === -1) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid demo credentials" });
        const account = DEMO_ACCOUNTS[index];
        const cookieOptions = getSessionCookieOptions(ctx.req as any);
        const sessionPayload = { role: account.role, username: account.username };
        if (typeof (ctx.res as any).cookie === "function") {
          (ctx.res as any).cookie(DEMO_SESSION_COOKIE, JSON.stringify(sessionPayload), {
            ...cookieOptions,
            maxAge: 8 * 60 * 60 * 1000,
          });
        }
        const now = new Date();
        const demoUser = {
          id: 10_000 + index,
          openId: `demo-${account.role}`,
          name: account.name,
          email: account.email,
          loginMethod: "demo",
          role: account.role,
          createdAt: now,
          updatedAt: now,
          lastSignedIn: now,
        };
        return {
          success: true,
          role: account.role,
          roleLabel: ROLE_DEFINITIONS[account.role].label,
          user: userSummary(demoUser),
          session: sessionPayload,
        } as const;
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req as any);
      if (typeof (ctx.res as any).clearCookie === "function") {
        (ctx.res as any).clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
        (ctx.res as any).clearCookie(DEMO_SESSION_COOKIE, { ...cookieOptions, maxAge: -1 });
      }
      return { success: true } as const;
    }),
  }),
  monitoring: router({
    snapshot: protectedProcedure.query(async ({ ctx }) => ({
      user: userSummary(ctx.user),
      definition: ROLE_DEFINITIONS[ctx.user.role],
      snapshot: await buildLiveSnapshot(ctx.user.role),
    })),
    auditTrail: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(auditLogs).orderBy(desc(auditLogs.id));
    }),
    getAuditLogs: protectedProcedure
      .input(
        z
          .object({
            projectCode: z.string().optional(),
            caseNumber: z.string().optional(),
            action: z.string().optional(),
            limit: z.number().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.id));
        if (!input) return logs;
        return logs
          .filter(l => {
            if (input.projectCode && l.projectCode !== input.projectCode) return false;
            if (input.caseNumber && l.targetId !== input.caseNumber) return false;
            if (input.action && l.action !== input.action) return false;
            return true;
          })
          .slice(0, input.limit || 500);
      }),
    performAction: protectedProcedure
      .input(z.object({ action: z.enum(permissionActions), targetId: z.string().min(1), comments: z.string().min(1).max(500) }))
      .mutation(({ ctx, input }) => {
        if (!canRolePerform(ctx.user.role, input.action)) {
          throw new TRPCError({ code: "FORBIDDEN", message: `${ROLE_DEFINITIONS[ctx.user.role].label} is not authorized for ${input.action}` });
        }
        const event = {
          id: `AUDIT-${String(auditEvents.length + 1).padStart(3, "0")}`,
          role: ctx.user.role,
          user: ctx.user.name ?? "Demo user",
          action: input.action,
          targetId: input.targetId,
          timestamp: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }),
          comments: input.comments,
        };
        auditEvents.unshift(event);
        return { success: true, event } as const;
      }),
    runAiEvaluation: protectedProcedure.mutation(async ({ ctx }) => {
      return await runFullAiEvaluation(ctx.user.name || "Authorized Auditor");
    }),
    getAiAnomalies: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(anomalies);
    }),
    getRiskAssessments: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(riskAssessments);
    }),
    getCases: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const allCases = await db.select().from(cases);
      if (ctx.user.role === "mospi" || ctx.user.role === "cag" || ctx.user.role === "state" || ctx.user.role === "district") return allCases;
      return allCases.filter(c => c.assignedRole === ctx.user.role || c.openedBy === ctx.user.name);
    }),
    getProjectDetail: protectedProcedure
      .input(z.object({ projectCode: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const [project] = await db.select().from(projects).where(eq(projects.projectCode, input.projectCode));
        if (!project) return null;
        const projectAnomalies = await db.select().from(anomalies).where(eq(anomalies.projectCode, input.projectCode));
        const [assessment] = await db.select().from(riskAssessments).where(eq(riskAssessments.projectCode, input.projectCode));
        const projectCases = await db.select().from(cases).where(eq(cases.projectCode, input.projectCode));
        return {
          project,
          anomalies: projectAnomalies,
          assessment,
          cases: projectCases,
        };
      }),
    getProjectUpdates: protectedProcedure
      .input(z.object({ projectCode: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { updates: [], evidence: [], cases: [] };
        const updatesList = await db.select().from(projectUpdates).where(eq(projectUpdates.projectCode, input.projectCode)).orderBy(desc(projectUpdates.id));
        const evidenceList = await db.select().from(evidence).where(and(eq(evidence.projectCode, input.projectCode), eq(evidence.isActive, true))).orderBy(desc(evidence.id));
        const casesList = await db.select().from(cases).where(eq(cases.projectCode, input.projectCode)).orderBy(desc(cases.id));
        return {
          updates: updatesList,
          evidence: evidenceList,
          cases: casesList,
        };
      }),
    getAvailableInvestigators: protectedProcedure.query(async () => {
      return [
        { name: "P. Yadav", title: "District Authority / Collector (Barwani)", role: "district" },
        { name: "R. Menon", title: "State Nodal Officer (Maharashtra)", role: "state" },
        { name: "A. Qureshi", title: "MoSPI Central Director", role: "mospi" },
        { name: "A. Sharma", title: "Assistant Engineer (Technical Verification)", role: "district" },
        { name: "V. Kulkarni", title: "Executive Engineer (Public Works)", role: "district" },
        { name: "S. Iyer", title: "Senior Audit Officer (Assurance)", role: "cag" },
      ];
    }),
    createRecommendation: protectedProcedure
      .input(
        z.object({
          title: z.string().min(3, "Work title must be at least 3 characters").max(255),
          description: z.string().optional(),
          state: z.string().default("Maharashtra"),
          district: z.string().default("Wardha"),
          constituency: z.string().default("Wardha"),
          category: z.string().default("Drinking Water Facility"),
          estimatedAmount: z.number().positive("Estimated amount must be greater than zero"),
          implementingAgency: z.string().optional(),
          justification: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Enforce RBAC: Strictly restricted to MP role
        if (ctx.user.role !== "mp") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `${ROLE_DEFINITIONS[ctx.user.role]?.label || ctx.user.role} is not authorized to create work recommendations. Work recommendations are restricted exclusively to the Member of Parliament (role = 'mp').`,
          });
        }

        const db = await getDb();
        if (!db) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        }

        // Generate sequential project code
        const allProj = await db.select({ projectCode: projects.projectCode }).from(projects);
        const existingCodes = new Set(allProj.map(p => p.projectCode));
        let nextNum = allProj.length + 1;
        let projectCode = `MPLAD-2026-${String(nextNum).padStart(3, "0")}`;
        while (existingCodes.has(projectCode)) {
          nextNum++;
          projectCode = `MPLAD-2026-${String(nextNum).padStart(3, "0")}`;
        }

        // Record logged-in MP as recommender
        const recommender = ctx.user.name ? (ctx.user.name.includes("MP") ? ctx.user.name : `${ctx.user.name}, MP (Lok Sabha)`) : "N. Patil, MP (Lok Sabha)";

        // 1. Save recommendation to MySQL projects table
        const [insertResult] = await db.insert(projects).values({
          projectCode,
          title: input.title.trim(),
          description: input.description?.trim() || input.justification?.trim() || "Recommended by Member of Parliament under MPLADS scheme.",
          state: input.state.trim() || "Maharashtra",
          district: input.district.trim() || "Wardha",
          constituency: input.constituency?.trim() || "Wardha",
          recommendedBy: recommender,
          implementingAgency: input.implementingAgency?.trim() || "District Rural Development Agency (DRDA), Wardha",
          category: input.category.trim() || "Drinking Water Facility",
          status: "Recommended",
          progress: 0,
          sanctionedAmount: input.estimatedAmount,
          spentAmount: 0,
          utilization: 0,
          riskScore: 10,
          riskLevel: "Low",
          startDate: new Date(),
          sourceType: "OPERATIONAL_UPDATE",
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning({ id: projects.id });
        const projectId = insertResult.id;

        // 2. Insert initial project update entry
        await db.insert(projectUpdates).values({
          projectId,
          projectCode,
          updatedBy: recommender,
          role: "mp",
          updateType: "WORK_RECOMMENDED",
          previousProgress: 0,
          newProgress: 0,
          remarks: input.justification?.trim() || `Work recommendation submitted by ${recommender} for administrative scrutiny.`,
          sourceType: "OPERATIONAL_UPDATE",
          createdAt: new Date(),
        });

        // 3. Create immutable audit log entry
        const auditCode = `AUD-${nanoid(8).toUpperCase()}`;
        await db.insert(auditLogs).values({
          auditCode,
          userId: ctx.user.id,
          userName: recommender,
          userRole: "mp",
          action: "WORK_RECOMMENDED",
          projectId,
          projectCode,
          targetId: projectCode,
          targetType: "PROJECT",
          fieldChanged: "status",
          oldValue: null,
          newValue: "Recommended",
          comments: `Work recommendation submitted: "${input.title}" by ${recommender}. Budget: ₹${input.estimatedAmount.toLocaleString("en-IN")}. District: ${input.district}, State: ${input.state}.`,
          sourceType: "OPERATIONAL_UPDATE",
          createdAt: new Date(),
        });

        // Also add to auditEvents array for in-memory consumers
        auditEvents.unshift({
          id: auditCode,
          role: "mp",
          user: recommender,
          action: "WORK_RECOMMENDED",
          targetId: projectCode,
          timestamp: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }),
          comments: `Work recommendation submitted: "${input.title}" by ${recommender}.`,
        });

        return {
          success: true,
          projectCode,
          projectId,
          recommendedBy: recommender,
          message: `Work recommendation ${projectCode} submitted successfully and recorded in audit log.`,
        };
      }),
    recordAuditFinding: protectedProcedure
      .input(
        z.object({
          projectCode: z.string().min(1, "Project code is required"),
          title: z.string().min(3, "Finding title must be at least 3 characters").max(255),
          category: z.string().min(1),
          severity: z.enum(["Critical", "High", "Medium", "Low"]),
          observation: z.string().min(10, "Detailed observation must be at least 10 characters"),
          financialImplication: z.number().min(0).optional(),
          recommendation: z.string().optional(),
          targetRole: z.enum(["district", "state", "mospi"]).default("district"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Enforce RBAC: Strictly restricted to CAG role
        if (ctx.user.role !== "cag") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `${ROLE_DEFINITIONS[ctx.user.role]?.label || ctx.user.role} is not authorized to record audit findings. Audit findings are strictly restricted to Audit & Assurance (role = 'cag').`,
          });
        }

        const db = await getDb();
        if (!db) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        }

        const [project] = await db.select().from(projects).where(eq(projects.projectCode, input.projectCode));
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.projectCode} not found` });
        }

        const year = new Date().getFullYear();
        const caseNumber = `AUD-${year}-${nanoid(4).toUpperCase()}`;
        const auditorName = ctx.user.name ? (ctx.user.name.includes("CAG") || ctx.user.name.includes("Audit") ? ctx.user.name : `${ctx.user.name}, Senior Audit Officer (CAG)`) : "S. Iyer, Senior Audit Officer (CAG)";

        const description = `${input.observation.trim()}${input.recommendation?.trim() ? `\n\nAudit Recommendation: ${input.recommendation.trim()}` : ""
          }${input.financialImplication ? `\nFinancial Implication: ₹${input.financialImplication.toLocaleString("en-IN")}` : ""}`;

        // 1. Insert into cases table as AUDIT_OBSERVATION
        const [caseResult] = await db.insert(cases).values({
          caseNumber,
          projectId: project.id,
          projectCode: project.projectCode,
          title: `[AUDIT] ${input.title.trim()}`,
          description,
          priority: input.severity,
          status: "AUDIT_OBSERVATION",
          assignedRole: input.targetRole,
          assignedUser: null,
          assignedDistrict: project.district,
          assignedState: project.state,
          openedBy: auditorName,
          deadline: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days response deadline
          sourceType: "OPERATIONAL_UPDATE",
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning({ id: cases.id });

        // 2. Create immutable audit log in audit_logs
        const auditCode = `AUD-LOG-${nanoid(8).toUpperCase()}`;
        await db.insert(auditLogs).values({
          auditCode,
          userId: ctx.user.id,
          userName: auditorName,
          userRole: "cag",
          action: "AUDIT_FINDING_RECORDED",
          projectId: project.id,
          projectCode: project.projectCode,
          targetId: caseNumber,
          targetType: "AUDIT_FINDING",
          fieldChanged: "status",
          oldValue: null,
          newValue: "AUDIT_OBSERVATION",
          comments: `Audit finding recorded: "${input.title}". Severity: ${input.severity}. Category: ${input.category}. Financial Implication: ₹${(input.financialImplication || 0).toLocaleString("en-IN")}. Assigned to ${input.targetRole} for management response.`,
          sourceType: "OPERATIONAL_UPDATE",
          createdAt: new Date(),
        });

        // Add to auditEvents array for in-memory consumers
        auditEvents.unshift({
          id: auditCode,
          role: "cag",
          user: auditorName,
          action: "AUDIT_FINDING_RECORDED",
          targetId: caseNumber,
          timestamp: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }),
          comments: `Audit observation recorded: "${input.title}".`,
        });

        return {
          success: true,
          caseNumber,
          caseId: caseResult.id,
          projectCode: project.projectCode,
          message: `Audit finding ${caseNumber} recorded successfully and sent for management response.`,
        };
      }),
    getAuditFindings: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const allCases = await db.select().from(cases).orderBy(desc(cases.id));
      return allCases.filter(c => c.status === "AUDIT_OBSERVATION" || c.title.startsWith("[AUDIT]") || c.openedBy.includes("Audit") || c.openedBy.includes("CAG"));
    }),
    submitProjectUpdate: protectedProcedure
      .input(
        z.object({
          projectCode: z.string().min(1),
          newProgress: z.number().min(0).max(100),
          newStatus: z.enum(["Recommended", "Sanctioned", "Active", "Delayed", "Completed", "Cancelled"]).optional(),
          updateType: z.string().min(1),
          spentAmount: z.number().min(0).optional(),
          remarks: z.string().min(1),
          updateDate: z.string().optional(),
          evidenceTitle: z.string().optional(),
          evidenceCategory: z.enum(["SITE_PHOTO", "SUPPORTING_DOCUMENT", "MEASUREMENT_BOOK", "INSPECTION_REPORT"]).optional(),
          evidenceFileName: z.string().optional(),
          evidenceFileUrl: z.string().optional(),
          evidenceBase64: z.string().optional(),
          evidencePerceptualHash: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "district") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `${ROLE_DEFINITIONS[ctx.user.role].label} is not authorized to submit operational project updates. Project execution updates are restricted exclusively to the District Authority.`,
          });
        }

        const db = await getDb();
        if (!db) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        }

        const [project] = await db.select().from(projects).where(eq(projects.projectCode, input.projectCode));
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.projectCode} not found` });
        }

        const updateDate = input.updateDate ? new Date(input.updateDate) : new Date();

        // 1. Record in project_updates table with OPERATIONAL_UPDATE provenance
        await db.insert(projectUpdates).values({
          projectId: project.id,
          projectCode: project.projectCode,
          updatedBy: ctx.user.name ?? "District Authority",
          role: ctx.user.role,
          updateType: input.updateType,
          previousProgress: project.progress,
          newProgress: input.newProgress,
          remarks: input.remarks,
          sourceType: "OPERATIONAL_UPDATE",
          createdAt: updateDate,
        });

        // 2. If spentAmount changed, record expenditure voucher with OPERATIONAL_UPDATE provenance
        if (input.spentAmount !== undefined && input.spentAmount !== project.spentAmount) {
          const deltaAmount = Math.max(0, input.spentAmount - project.spentAmount);
          if (deltaAmount > 0) {
            await db.insert(expenditures).values({
              projectId: project.id,
              projectCode: project.projectCode,
              voucherNo: `VOUCH-OP-${nanoid(6).toUpperCase()}`,
              disbursementDate: updateDate,
              amount: deltaAmount,
              purpose: `Operational progress update: ${input.updateType} (${input.remarks.slice(0, 100)})`,
              recipientAgency: project.implementingAgency || "District Implementing Agency",
              sourceType: "OPERATIONAL_UPDATE",
            });
          }
        }

        // 3. If evidence is attached, save file, compute perceptual hash for photos and insert into evidence table
        let attachedEvidenceCode: string | null = null;
        if (input.evidenceTitle) {
          attachedEvidenceCode = `EVID-${project.projectCode}-${nanoid(4).toUpperCase()}`;
          let computedHash: string | null = input.evidencePerceptualHash || null;
          let savedFileUrl: string | null = input.evidenceFileUrl || null;
          let storedFileName = input.evidenceFileName || `site_photo_${Date.now()}.jpg`;
          let fileSize: number | null = null;
          let mimeType: string | null = null;

          if (input.evidenceBase64) {
            try {
              const saved = saveEvidenceFile({
                projectCode: project.projectCode,
                evidenceCode: attachedEvidenceCode,
                base64Data: input.evidenceBase64,
                fileName: input.evidenceFileName,
                category: input.evidenceCategory,
              });
              savedFileUrl = saved.fileUrl;
              storedFileName = saved.storedFileName;
              fileSize = saved.fileSize;
              mimeType = saved.mimeType;

              if (!computedHash && (!mimeType || mimeType.startsWith("image/"))) {
                try {
                  computedHash = perceptualHashEngine.computeHashFromBuffer(saved.buffer);
                } catch {
                  computedHash = null;
                }
              }
            } catch (err) {
              console.error("[Evidence] Error writing file to disk:", err);
            }
          } else if (input.evidenceCategory && input.evidenceCategory !== "SITE_PHOTO") {
            try {
              const uploadsEvidenceDir = getUploadsEvidenceDir();
              const cleanDocName = path.basename(storedFileName).replace(/[^a-zA-Z0-9._-]/g, "_");
              const finalDocName = cleanDocName.toLowerCase().endsWith(".pdf") ? cleanDocName : `${cleanDocName}.pdf`;
              const targetDocPath = path.join(uploadsEvidenceDir, finalDocName);
              const pdfBuf = await generateInspectionDocumentPdf({
                title: input.evidenceTitle || "Operational Inspection Document",
                projectCode: project.projectCode,
                category: input.evidenceCategory,
                uploadedBy: ctx.user.name ?? "District Officer",
                date: new Date().toLocaleDateString("en-IN"),
              });
              try {
                fs.writeFileSync(targetDocPath, pdfBuf);
              } catch (_) { }
              savedFileUrl = `/uploads/evidence/${finalDocName}`;
              storedFileName = finalDocName;
              fileSize = pdfBuf.length;
              mimeType = "application/pdf";
            } catch (err) {
              console.error("[Evidence] Error writing fallback document to disk:", err);
            }
          }

          await db.insert(evidence).values({
            evidenceCode: attachedEvidenceCode,
            projectId: project.id,
            projectCode: project.projectCode,
            title: input.evidenceTitle,
            category: input.evidenceCategory || "SITE_PHOTO",
            filePath: storedFileName,
            fileUrl: savedFileUrl,
            fileSize: fileSize,
            mimeType: mimeType,
            perceptualHash: computedHash,
            uploadedBy: ctx.user.name ?? "District Officer",
            uploadedRole: ctx.user.role,
            verified: false,
            sourceType: "OPERATIONAL_UPDATE",
            createdAt: new Date(),
          });

          // Audit log for evidence upload
          await db.insert(auditLogs).values({
            auditCode: `AUD-EVID-${nanoid(8).toUpperCase()}`,
            userName: ctx.user.name ?? "District Officer",
            userRole: ctx.user.role,
            action: "EVIDENCE_ATTACHED",
            projectId: project.id,
            projectCode: project.projectCode,
            targetId: attachedEvidenceCode,
            targetType: "evidence",
            fieldChanged: "perceptualHash",
            oldValue: null,
            newValue: computedHash || "Document attached",
            comments: `Attached ${input.evidenceCategory || 'SITE_PHOTO'}: "${input.evidenceTitle}" (${storedFileName}, Perceptual Hash: ${computedHash || 'N/A'})`,
            sourceType: "OPERATIONAL_UPDATE",
          });
        }

        // 4. Update project's operational fields (preserving official source record provenance)
        const updatedSpent = input.spentAmount !== undefined ? input.spentAmount : project.spentAmount;
        const updatedStatus = input.newStatus || (input.newProgress >= 100 ? "Completed" : project.status);
        const updatedUtilization = project.sanctionedAmount > 0 ? (updatedSpent / project.sanctionedAmount) * 100 : 0;

        await db
          .update(projects)
          .set({
            progress: input.newProgress,
            status: updatedStatus,
            spentAmount: updatedSpent,
            utilization: Number(updatedUtilization.toFixed(1)),
            updatedAt: new Date(),
          })
          .where(eq(projects.id, project.id));

        // 5. Audit log for project update
        await db.insert(auditLogs).values({
          auditCode: `AUD-UPD-${nanoid(8).toUpperCase()}`,
          userName: ctx.user.name ?? "District Authority",
          userRole: ctx.user.role,
          action: "PROJECT_EXECUTION_UPDATE",
          projectId: project.id,
          projectCode: project.projectCode,
          targetId: project.projectCode,
          targetType: "project",
          fieldChanged: "progress/status/spentAmount",
          oldValue: `Progress: ${project.progress}%, Status: ${project.status}, Spent: ₹${project.spentAmount}`,
          newValue: `Progress: ${input.newProgress}%, Status: ${updatedStatus}, Spent: ₹${updatedSpent}`,
          comments: input.remarks,
          sourceType: "OPERATIONAL_UPDATE",
        });

        // 6. Run AI Re-evaluation Pipeline immediately
        const assessment = await evaluateSingleProject(project.projectCode, ctx.user.name || "District Authority");

        return {
          success: true,
          projectCode: project.projectCode,
          newProgress: input.newProgress,
          newStatus: updatedStatus,
          spentAmount: updatedSpent,
          evidenceCode: attachedEvidenceCode,
          assessment,
        };
      }),
    addStateReviewRemark: protectedProcedure
      .input(
        z.object({
          projectCode: z.string().min(1),
          remarks: z.string().min(1).max(1000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "state") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `${ROLE_DEFINITIONS[ctx.user.role].label} is not authorized to submit state review remarks. Only State Nodal Officers can add state review remarks.`,
          });
        }
        const db = await getDb();
        if (!db) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        }
        const [project] = await db.select().from(projects).where(eq(projects.projectCode, input.projectCode));
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.projectCode} not found` });
        }
        await db.insert(auditLogs).values({
          auditCode: `AUD-SRV-${nanoid(8).toUpperCase()}`,
          userName: ctx.user.name ?? "State Nodal Officer",
          userRole: ctx.user.role,
          action: "STATE_REVIEW_REMARK",
          projectId: project.id,
          projectCode: project.projectCode,
          targetId: project.projectCode,
          targetType: "project",
          fieldChanged: "stateReview",
          oldValue: null,
          newValue: input.remarks,
          comments: `State Oversight Observation: ${input.remarks}`,
          sourceType: "OPERATIONAL_UPDATE",
        });
        return { success: true, projectCode: input.projectCode };
      }),
    removeEvidence: protectedProcedure
      .input(
        z.object({
          evidenceId: z.number().int().positive().optional(),
          evidenceCode: z.string().min(1).optional(),
          removalReason: z.string().min(3, "Removal reason must be at least 3 characters").max(1000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "district") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `${ROLE_DEFINITIONS[ctx.user.role].label} is not authorized to remove execution evidence. Evidence removal is strictly restricted to District Authority.`,
          });
        }

        const db = await getDb();
        if (!db) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        }

        let ev: typeof evidence.$inferSelect | undefined;
        if (input.evidenceId) {
          const [found] = await db.select().from(evidence).where(eq(evidence.id, input.evidenceId));
          ev = found;
        } else if (input.evidenceCode) {
          const [found] = await db.select().from(evidence).where(eq(evidence.evidenceCode, input.evidenceCode));
          ev = found;
        }

        if (!ev) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Evidence record not found" });
        }

        if (!ev.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Evidence has already been removed" });
        }

        const now = new Date();

        // 1. Mark as removed/inactive while preserving its original metadata
        await db
          .update(evidence)
          .set({
            isActive: false,
            removalReason: input.removalReason,
            removedAt: now,
            removedBy: ctx.user.name || "District Officer",
          })
          .where(eq(evidence.id, ev.id));

        // 2. Delete the stored binary file from uploads/evidence/ when appropriate
        const candidatePaths: string[] = [];
        if (ev.fileUrl && ev.fileUrl.startsWith("/uploads/evidence/")) {
          candidatePaths.push(path.join(getUploadsEvidenceDir(), path.basename(ev.fileUrl)));
        }
        if (ev.filePath) {
          const resolvedPath = path.isAbsolute(ev.filePath)
            ? ev.filePath
            : path.join(getUploadsEvidenceDir(), path.basename(ev.filePath));
          candidatePaths.push(resolvedPath);
        }

        for (const filePath of candidatePaths) {
          try {
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              fs.unlinkSync(filePath);
            }
          } catch (err) {
            console.error("[Evidence] Error deleting file from disk:", err);
          }
        }

        // 3. Record an immutable audit log containing project code, evidence ID, filename, removing officer, timestamp and removal reason
        const evidenceFileName = ev.filePath ? path.basename(ev.filePath) : (ev.fileUrl ? path.basename(ev.fileUrl) : ev.title);
        await db.insert(auditLogs).values({
          auditCode: `AUD-EVID-REM-${nanoid(8).toUpperCase()}`,
          userId: ctx.user.id ?? null,
          userName: ctx.user.name || "District Officer",
          userRole: ctx.user.role,
          action: "EVIDENCE_REMOVED",
          projectId: ev.projectId,
          projectCode: ev.projectCode,
          targetId: String(ev.id),
          targetType: "evidence",
          fieldChanged: "isActive",
          oldValue: `Active (${evidenceFileName})`,
          newValue: `Inactive / Removed: ${input.removalReason}`,
          comments: `Officer: ${ctx.user.name || "District Officer"} (${ctx.user.role}) | Project: ${ev.projectCode} | Evidence ID: ${ev.id} (${ev.evidenceCode}) | Filename: ${evidenceFileName} | Timestamp: ${now.toISOString()} | Reason: ${input.removalReason}`,
          sourceType: "OPERATIONAL_UPDATE",
          createdAt: now,
        });

        // 4. Trigger AI re-evaluation so Evidence Reuse and overall risk assessment are recalculated
        const assessment = await evaluateSingleProject(ev.projectCode, ctx.user.name || "District Officer");

        return {
          success: true,
          evidenceId: ev.id,
          evidenceCode: ev.evidenceCode,
          projectCode: ev.projectCode,
          assessment,
        };
      }),
    manageCase: protectedProcedure
      .input(
        z.object({
          caseNumber: z.string().optional(),
          projectCode: z.string().optional(),
          assignedUser: z.string().optional(),
          investigatorRemarks: z.string().optional(),
          status: z.enum([
            "OPEN",
            "PENDING_DISTRICT_RESPONSE",
            "PENDING_STATE_REVIEW",
            "UNDER_INVESTIGATION",
            "ESCALATED",
            "ESCALATED_TO_MOSPI",
            "AUDIT_OBSERVATION",
            "RESOLVED",
            "CLOSED",
          ]).optional(),
          evidenceTitle: z.string().optional(),
          evidenceCategory: z.string().optional(),
          evidenceFileName: z.string().optional(),
          evidenceFileUrl: z.string().optional(),
          evidenceBase64: z.string().optional(),
          evidencePerceptualHash: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role === "mp") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "MP role is recommendation and monitoring only, not case investigation.",
          });
        }
        if (ctx.user.role === "cag") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "CAG role is independent assurance and cannot modify operational case management records.",
          });
        }

        const db = await getDb();
        if (!db) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        }

        const searchKey = input.caseNumber || input.projectCode;
        if (!searchKey) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Either caseNumber or projectCode must be provided" });
        }

        let [caseRecord] = await db.select().from(cases).where(eq(cases.caseNumber, searchKey));
        if (!caseRecord) {
          [caseRecord] = await db.select().from(cases).where(eq(cases.projectCode, searchKey));
        }
        if (!caseRecord) {
          const [proj] = await db.select().from(projects).where(eq(projects.projectCode, searchKey));
          if (proj) {
            const newCaseNumber = `CASE-${proj.projectCode}`;
            await db.insert(cases).values({
              caseNumber: newCaseNumber,
              projectId: proj.id,
              projectCode: proj.projectCode,
              title: `AI & Human Verification Review: ${proj.title.substring(0, 60)}`,
              description: `Verification case opened for project ${proj.projectCode}. Initiated by ${ctx.user.name}.`,
              priority: (proj.riskScore && proj.riskScore >= 70) ? "High" : "Medium",
              status: "OPEN",
              assignedRole: ctx.user.role === "state" ? "state" : "district",
              assignedDistrict: proj.district,
              assignedState: proj.state,
              openedBy: ctx.user.name ?? "Authorized User",
              sourceType: "OPERATIONAL_UPDATE",
            });
            [caseRecord] = await db.select().from(cases).where(eq(cases.caseNumber, newCaseNumber));
          }
        }

        if (!caseRecord) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Case or project not found for ${searchKey}` });
        }

        const now = new Date();
        const updateFields: Partial<typeof cases.$inferInsert> = {
          updatedAt: now,
        };

        // 1. Assign Investigator (user/person in the existing RBAC system)
        if (input.assignedUser && input.assignedUser !== caseRecord.assignedUser) {
          updateFields.assignedUser = input.assignedUser;
          await db.insert(auditLogs).values({
            auditCode: `AUD-CASE-ASN-${nanoid(8).toUpperCase()}`,
            userId: ctx.user.id,
            userName: ctx.user.name ?? "Authorized User",
            userRole: ctx.user.role,
            action: "CASE_ASSIGNMENT",
            projectId: caseRecord.projectId,
            projectCode: caseRecord.projectCode,
            targetId: caseRecord.caseNumber,
            targetType: "case",
            fieldChanged: "assignedUser",
            oldValue: caseRecord.assignedUser ?? "Unassigned",
            newValue: input.assignedUser,
            comments: `Case ${caseRecord.caseNumber} (Project: ${caseRecord.projectCode}) assigned to investigator: ${input.assignedUser}. Performed by ${ctx.user.name ?? "Authorized User"}.`,
            sourceType: "OPERATIONAL_UPDATE",
            createdAt: now,
          });
        }

        // 2. Add Investigator Remarks
        if (input.investigatorRemarks && input.investigatorRemarks.trim()) {
          const remarkText = input.investigatorRemarks.trim();
          const timestampPrefix = `[${now.toLocaleDateString("en-IN")} ${ctx.user.name}]: `;
          const newRemarks = caseRecord.investigatorRemarks
            ? `${caseRecord.investigatorRemarks}\n\n${timestampPrefix}${remarkText}`
            : `${timestampPrefix}${remarkText}`;
          updateFields.investigatorRemarks = newRemarks;

          const currentInvestigator = input.assignedUser || caseRecord.assignedUser || ctx.user.name || "Assigned Investigator";

          await db.insert(auditLogs).values({
            auditCode: `AUD-CASE-RMK-${nanoid(8).toUpperCase()}`,
            userId: ctx.user.id,
            userName: ctx.user.name ?? "Investigator",
            userRole: ctx.user.role,
            action: "INVESTIGATOR_REMARK",
            projectId: caseRecord.projectId,
            projectCode: caseRecord.projectCode,
            targetId: caseRecord.caseNumber,
            targetType: "case",
            fieldChanged: "investigatorRemarks",
            oldValue: null,
            newValue: remarkText,
            comments: `Investigator remark recorded by ${ctx.user.name} (Investigator: ${currentInvestigator}) for Case ${caseRecord.caseNumber} (Project: ${caseRecord.projectCode}): "${remarkText}"`,
            sourceType: "OPERATIONAL_UPDATE",
            createdAt: now,
          });
        }

        // 3. Attach Case Evidence
        if (input.evidenceTitle || input.evidenceFileName || input.evidenceBase64) {
          const evidenceTitle = input.evidenceTitle || input.evidenceFileName || "Verification Inspection Report";
          const evidenceCode = `EVID-CASE-${nanoid(6).toUpperCase()}`;
          let computedHash: string | null = input.evidencePerceptualHash || null;
          let savedFileUrl: string | null = input.evidenceFileUrl || null;
          let storedFileName = input.evidenceFileName || `case_evidence_${Date.now()}.jpg`;
          let fileSize: number | null = null;
          let mimeType: string | null = null;

          if (input.evidenceBase64) {
            try {
              const saved = saveEvidenceFile({
                projectCode: caseRecord.projectCode,
                evidenceCode,
                base64Data: input.evidenceBase64,
                fileName: input.evidenceFileName,
                category: input.evidenceCategory || "INSPECTION_REPORT",
              });
              savedFileUrl = saved.fileUrl;
              storedFileName = saved.storedFileName;
              fileSize = saved.fileSize;
              mimeType = saved.mimeType;

              if (!computedHash && (!mimeType || mimeType.startsWith("image/"))) {
                try {
                  computedHash = perceptualHashEngine.computeHashFromBuffer(saved.buffer);
                } catch {
                  computedHash = null;
                }
              }
            } catch (err) {
              console.error("[Evidence] Error writing case evidence to disk:", err);
            }
          } else {
            try {
              const uploadsEvidenceDir = getUploadsEvidenceDir();
              const cleanDocName = path.basename(storedFileName).replace(/[^a-zA-Z0-9._-]/g, "_");
              const finalDocName = cleanDocName.toLowerCase().endsWith(".pdf") ? cleanDocName : `${cleanDocName}.pdf`;
              const targetDocPath = path.join(uploadsEvidenceDir, finalDocName);
              const pdfBuf = await generateInspectionDocumentPdf({
                title: evidenceTitle,
                projectCode: caseRecord.projectCode,
                category: input.evidenceCategory || "INSPECTION_REPORT",
                uploadedBy: ctx.user.name ?? "Investigator",
                date: new Date().toLocaleDateString("en-IN"),
              });
              try {
                fs.writeFileSync(targetDocPath, pdfBuf);
              } catch (_) { }
              savedFileUrl = `/uploads/evidence/${finalDocName}`;
              storedFileName = finalDocName;
              fileSize = pdfBuf.length;
              mimeType = "application/pdf";
            } catch (err) {
              console.error("[Evidence] Error writing case inspection document to disk:", err);
            }
          }

          await db.insert(evidence).values({
            evidenceCode,
            projectId: caseRecord.projectId,
            projectCode: caseRecord.projectCode,
            caseId: caseRecord.id,
            title: evidenceTitle,
            category: input.evidenceCategory || "INSPECTION_REPORT",
            filePath: storedFileName,
            fileUrl: savedFileUrl,
            fileSize: fileSize,
            mimeType: mimeType,
            perceptualHash: computedHash,
            uploadedBy: ctx.user.name ?? "Investigator",
            uploadedRole: ctx.user.role,
            verified: true,
            sourceType: "OPERATIONAL_UPDATE",
            createdAt: now,
          });

          await db.insert(auditLogs).values({
            auditCode: `AUD-CASE-EVID-${nanoid(8).toUpperCase()}`,
            userId: ctx.user.id,
            userName: ctx.user.name ?? "Investigator",
            userRole: ctx.user.role,
            action: "VERIFICATION_EVIDENCE_ATTACHED",
            projectId: caseRecord.projectId,
            projectCode: caseRecord.projectCode,
            targetId: caseRecord.caseNumber,
            targetType: "case",
            fieldChanged: input.evidenceCategory || "INSPECTION_REPORT",
            oldValue: null,
            newValue: storedFileName,
            comments: `Verification evidence attached for Case ${caseRecord.caseNumber} (Project: ${caseRecord.projectCode}): "${evidenceTitle}" (Filename: ${storedFileName}, Type: ${input.evidenceCategory || "INSPECTION_REPORT"}, Code: ${evidenceCode}). Uploaded by ${ctx.user.name}.`,
            sourceType: "OPERATIONAL_UPDATE",
            createdAt: now,
          });
        }

        // 4. Change Status (Under Investigation / Resolved / Escalated)
        if (input.status && input.status !== caseRecord.status) {
          updateFields.status = input.status;
          const isResolved = input.status === "RESOLVED" || input.status === "CLOSED";
          const isEscalated = input.status === "ESCALATED" || input.status === "ESCALATED_TO_MOSPI";

          if (isResolved) {
            updateFields.resolvedAt = now;
          }
          if (isEscalated) {
            updateFields.escalatedAt = now;
          }

          const effectiveInvestigator = input.assignedUser || caseRecord.assignedUser || ctx.user.name || "Assigned Investigator";
          const remarkNote = input.investigatorRemarks?.trim() ? ` Remark: "${input.investigatorRemarks.trim()}"` : "";

          if (isResolved) {
            await db.insert(auditLogs).values({
              auditCode: `AUD-CASE-RES-${nanoid(8).toUpperCase()}`,
              userId: ctx.user.id,
              userName: ctx.user.name ?? "Authorized User",
              userRole: ctx.user.role,
              action: "CASE_RESOLVED",
              projectId: caseRecord.projectId,
              projectCode: caseRecord.projectCode,
              targetId: caseRecord.caseNumber,
              targetType: "case",
              fieldChanged: "status",
              oldValue: caseRecord.status,
              newValue: input.status,
              comments: `Case ${caseRecord.caseNumber} (Project: ${caseRecord.projectCode}) resolved with final status ${input.status}. Investigator: ${effectiveInvestigator}.${remarkNote}`,
              sourceType: "OPERATIONAL_UPDATE",
              createdAt: now,
            });
          } else if (isEscalated) {
            await db.insert(auditLogs).values({
              auditCode: `AUD-CASE-ESC-${nanoid(8).toUpperCase()}`,
              userId: ctx.user.id,
              userName: ctx.user.name ?? "Authorized User",
              userRole: ctx.user.role,
              action: "CASE_ESCALATED",
              projectId: caseRecord.projectId,
              projectCode: caseRecord.projectCode,
              targetId: caseRecord.caseNumber,
              targetType: "case",
              fieldChanged: "status",
              oldValue: caseRecord.status,
              newValue: input.status,
              comments: `Case ${caseRecord.caseNumber} (Project: ${caseRecord.projectCode}) escalated with final status ${input.status}. Investigator: ${effectiveInvestigator}.${remarkNote}`,
              sourceType: "OPERATIONAL_UPDATE",
              createdAt: now,
            });
          } else {
            await db.insert(auditLogs).values({
              auditCode: `AUD-CASE-STAT-${nanoid(8).toUpperCase()}`,
              userId: ctx.user.id,
              userName: ctx.user.name ?? "Authorized User",
              userRole: ctx.user.role,
              action: "CASE_STATUS_CHANGE",
              projectId: caseRecord.projectId,
              projectCode: caseRecord.projectCode,
              targetId: caseRecord.caseNumber,
              targetType: "case",
              fieldChanged: "status",
              oldValue: caseRecord.status,
              newValue: input.status,
              comments: `Status for Case ${caseRecord.caseNumber} (Project: ${caseRecord.projectCode}) changed from ${caseRecord.status} to ${input.status} by ${ctx.user.name ?? "Authorized User"}.${remarkNote}`,
              sourceType: "OPERATIONAL_UPDATE",
              createdAt: now,
            });
          }
        }

        await db.update(cases).set(updateFields).where(eq(cases.id, caseRecord.id));
        const [updatedCase] = await db.select().from(cases).where(eq(cases.id, caseRecord.id));

        return {
          success: true,
          case: updatedCase,
        };
      }),
    // ── Export View ──────────────────────────────────────────────────────────
    // Returns structured data for the currently visible projects/risk table.
    // Used by the "Export view" button on every page header.
    getExportData: protectedProcedure
      .input(
        z.object({
          scope: z.enum(["projects", "evidence", "cases", "audit"]).default("projects"),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return { rows: [], scope: "projects" as const };
        const scope = input?.scope ?? "projects";

        if (scope === "evidence") {
          const rows = await db.select().from(evidence).orderBy(desc(evidence.id));
          return {
            scope,
            rows: rows.map(r => ({
              evidenceCode: r.evidenceCode,
              projectCode: r.projectCode,
              title: r.title,
              category: r.category,
              fileName: r.filePath ? r.filePath.split(/[\\/]/).pop() ?? r.filePath : r.title,
              uploadedBy: r.uploadedBy,
              uploadedRole: r.uploadedRole,
              createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
              status: r.isActive ? "Active" : "Removed",
              removalReason: r.removalReason ?? "",
            })),
          };
        }

        if (scope === "cases") {
          const rows = await db.select().from(cases).orderBy(desc(cases.id));
          return {
            scope,
            rows: rows.map(r => ({
              caseNumber: r.caseNumber,
              projectCode: r.projectCode,
              title: r.title,
              priority: r.priority,
              status: r.status,
              assignedUser: r.assignedUser ?? "Unassigned",
              openedBy: r.openedBy,
              createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
              resolvedAt: r.resolvedAt ? (r.resolvedAt instanceof Date ? r.resolvedAt.toISOString() : String(r.resolvedAt)) : "",
            })),
          };
        }

        // Default: projects
        const projectRows = await db.select().from(projects).orderBy(desc(projects.riskScore));
        const assessments = await db.select().from(riskAssessments);
        const assessMap = new Map(assessments.map(a => [a.projectCode, a]));

        return {
          scope,
          rows: projectRows.map(p => {
            const a = assessMap.get(p.projectCode);
            return {
              projectCode: p.projectCode,
              title: p.title,
              state: p.state,
              district: p.district,
              status: p.status,
              progress: p.progress,
              sanctionedAmount: p.sanctionedAmount,
              spentAmount: p.spentAmount,
              utilization: p.utilization,
              riskScore: p.riskScore,
              riskLevel: p.riskLevel,
              duplicateWorkScore: a?.duplicateWorkScore ?? 0,
              fundMovementScore: a?.fundMovementScore ?? 0,
              delayRiskScore: a?.delayRiskScore ?? 0,
              evidenceReuseScore: a?.evidenceReuseScore ?? 0,
            };
          }),
        };
      }),

    // ── Evidence Register ─────────────────────────────────────────────────────
    // Full evidence register: all rows (active + removed). Read-only.
    getEvidenceRegister: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(evidence).orderBy(desc(evidence.id));
      return rows.map(r => ({
        id: r.id,
        evidenceCode: r.evidenceCode,
        projectCode: r.projectCode,
        caseId: r.caseId,
        title: r.title,
        category: r.category,
        fileName: r.filePath ? r.filePath.split(/[\\/]/).pop() ?? r.filePath : r.title,
        fileUrl: r.fileUrl,
        uploadedBy: r.uploadedBy,
        uploadedRole: r.uploadedRole,
        verified: r.verified,
        isActive: r.isActive,
        removalReason: r.removalReason,
        removedAt: r.removedAt ? (r.removedAt instanceof Date ? r.removedAt.toISOString() : String(r.removedAt)) : null,
        removedBy: r.removedBy,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        mimeType: r.mimeType,
        perceptualHash: r.perceptualHash,
      }));
    }),

    // ── Action Follow-up ──────────────────────────────────────────────────────
    // Cases with latest investigator remark and resolution/escalation status.
    getActionFollowup: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const caseRows = await db.select().from(cases).orderBy(desc(cases.updatedAt));
      // Fetch latest remark from audit_logs per case
      const auditRows = await db.select().from(auditLogs)
        .where(or(eq(auditLogs.action, "INVESTIGATOR_REMARK"), eq(auditLogs.action, "CASE_RESOLVED"), eq(auditLogs.action, "CASE_ESCALATED"), eq(auditLogs.action, "CASE_STATUS_CHANGE")))
        .orderBy(desc(auditLogs.id));

      const latestAuditByCase = new Map<string, typeof auditRows[number]>();
      for (const a of auditRows) {
        if (!latestAuditByCase.has(a.targetId)) {
          latestAuditByCase.set(a.targetId, a);
        }
      }

      return caseRows.map(c => {
        const latest = latestAuditByCase.get(c.caseNumber);
        return {
          caseNumber: c.caseNumber,
          projectCode: c.projectCode,
          title: c.title,
          priority: c.priority,
          status: c.status,
          assignedUser: c.assignedUser ?? "Unassigned",
          assignedDistrict: c.assignedDistrict ?? "",
          openedBy: c.openedBy,
          latestAction: latest?.action ?? "",
          latestRemark: latest?.comments ?? c.investigatorRemarks ?? "",
          resolvedAt: c.resolvedAt ? (c.resolvedAt instanceof Date ? c.resolvedAt.toISOString() : String(c.resolvedAt)) : "",
          escalatedAt: c.escalatedAt ? (c.escalatedAt instanceof Date ? c.escalatedAt.toISOString() : String(c.escalatedAt)) : "",
          createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
          updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : String(c.updatedAt),
        };
      });
    }),

    // ── CAG Status Summary ────────────────────────────────────────────────────
    // Consolidated assurance view: anomalies + cases + evidence per project.
    getCagStatusSummary: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];

      const projectRows = await db.select().from(projects).orderBy(desc(projects.riskScore));
      const anomalyRows = await db.select().from(anomalies);
      const caseRows = await db.select().from(cases);
      const evidenceRows = await db.select().from(evidence);
      const assessRows = await db.select().from(riskAssessments);

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
      const removedEvidenceMap = new Map<string, number>();
      for (const e of evidenceRows) {
        if (e.isActive) evidenceMap.set(e.projectCode, (evidenceMap.get(e.projectCode) ?? 0) + 1);
        else removedEvidenceMap.set(e.projectCode, (removedEvidenceMap.get(e.projectCode) ?? 0) + 1);
      }
      const assessMap = new Map(assessRows.map(a => [a.projectCode, a]));

      return projectRows.map(p => {
        const projectAnomalies = anomalyMap.get(p.projectCode) ?? [];
        const projectCase = caseMap.get(p.projectCode);
        const assess = assessMap.get(p.projectCode);
        return {
          projectCode: p.projectCode,
          title: p.title,
          state: p.state,
          district: p.district,
          status: p.status,
          riskScore: p.riskScore,
          riskLevel: p.riskLevel,
          anomalyCount: projectAnomalies.length,
          highSeverityAnomalies: projectAnomalies.filter(a => a.severity === "High" || a.severity === "Critical").length,
          anomalyModules: Array.from(new Set(projectAnomalies.map(a => a.moduleType))).join(", "),
          caseNumber: projectCase?.caseNumber ?? "",
          caseStatus: projectCase?.status ?? "No Case",
          investigator: projectCase?.assignedUser ?? "",
          evidenceCount: evidenceMap.get(p.projectCode) ?? 0,
          removedEvidenceCount: removedEvidenceMap.get(p.projectCode) ?? 0,
          compositeScore: assess?.compositeScore ?? p.riskScore,
          duplicateWorkScore: assess?.duplicateWorkScore ?? 0,
          fundMovementScore: assess?.fundMovementScore ?? 0,
          delayRiskScore: assess?.delayRiskScore ?? 0,
          evidenceReuseScore: assess?.evidenceReuseScore ?? 0,
        };
      });
    }),

    // ── PDF Export Procedures ──────────────────────────────────────────────────
    exportProjectPdf: protectedProcedure
      .input(z.object({ projectCode: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

        const [project] = await db.select().from(projects).where(eq(projects.projectCode, input.projectCode));
        if (!project) throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.projectCode} not found` });

        const projAnomalies = await db.select().from(anomalies).where(eq(anomalies.projectCode, input.projectCode));
        const projCases = await db.select().from(cases).where(eq(cases.projectCode, input.projectCode));
        const projEvidence = await db.select().from(evidence).where(eq(evidence.projectCode, input.projectCode));
        const projUpdates = await db.select().from(projectUpdates).where(eq(projectUpdates.projectCode, input.projectCode));
        const [projAssessment] = await db.select().from(riskAssessments).where(eq(riskAssessments.projectCode, input.projectCode));

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
          anomalies: projAnomalies.map(a => ({ moduleType: a.moduleType, score: a.score, severity: a.severity, details: a.reasoning || a.flaggedText })),
          cases: projCases.map(c => ({ caseNumber: c.caseNumber, status: c.status, priority: c.priority, assignedUser: c.assignedUser, investigatorRemarks: c.investigatorRemarks })),
          evidence: projEvidence.map(e => ({
            evidenceCode: e.evidenceCode,
            title: e.title,
            category: e.category,
            fileName: e.filePath ? path.basename(e.filePath) : path.basename(e.fileUrl || "evidence.jpg"),
            uploadedBy: e.uploadedBy,
            createdAt: e.createdAt,
            isActive: e.isActive,
          })),
          updates: projUpdates.map(u => ({ updateType: u.updateType, newProgress: u.newProgress ?? 0, remarks: u.remarks ?? "", updatedBy: u.updatedBy, createdAt: u.createdAt })),
        });

        return {
          base64: pdfBuffer.toString("base64"),
          filename: `nigraani_project_${input.projectCode}.pdf`,
        };
      }),

    exportCagSummaryPdf: protectedProcedure.mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

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
      return {
        base64: pdfBuffer.toString("base64"),
        filename: "nigraani_audit_assurance_status.pdf",
      };
    }),

    exportEvidenceRegisterPdf: protectedProcedure.mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

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
      return {
        base64: pdfBuffer.toString("base64"),
        filename: "nigraani_evidence_register.pdf",
      };
    }),

    exportActionFollowupPdf: protectedProcedure.mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

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
      return {
        base64: pdfBuffer.toString("base64"),
        filename: "nigraani_action_followup.pdf",
      };
    }),

    exportWorkspacePdf: protectedProcedure
      .input(z.object({ scope: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const scope = input.scope || ctx.user.role;
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

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
        return {
          base64: pdfBuffer.toString("base64"),
          filename: `nigraani_${scope}_export_${ts}.pdf`,
        };
      }),
  }),
  mplads: router({
    getOfficialProjects: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const records = await db.select().from(projects);
      return records;
    }),
    getImportHistory: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const batches = await db.select().from(dataImports);
      return batches;
    }),
    getProvenance: protectedProcedure
      .input(z.object({ projectCode: z.string().optional() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const prov = await db.select().from(dataProvenance);
        return prov;
      }),
    importOfficialData: protectedProcedure
      .input(
        z.object({
          records: z.array(z.record(z.string(), z.unknown())).optional(),
          sourceFileName: z.string().default("official_mplads_works.json"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "mospi") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only MoSPI administrators can trigger official data ingestion" });
        }
        if (input.records && input.records.length > 0) {
          return await ingestOfficialMpladsRecords(input.records as any, input.sourceFileName, ctx.user.name || "MoSPI Administrator");
        }
        return await ingestBaseOfficialDataset();
      }),
  }),
});

export type AppRouter = typeof appRouter;
