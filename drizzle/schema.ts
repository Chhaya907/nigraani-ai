import { boolean, doublePrecision, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import type { RoleKey } from "../shared/monitoring";

/**
 * Core user table backing auth flow.
 * Preserves the exact 5 authorized Nigraani AI roles.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: text("role", { enum: ["mospi", "state", "district", "mp", "cag"] }).default("mospi").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type UserRole = RoleKey;

/**
 * Data provenance source types.
 * Every record is explicitly tagged so official data is never conflated with demo augmentation.
 */
export const SOURCE_TYPES = ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Projects / Works table.
 * Represents recommended and sanctioned MPLADS works across national, state, and district jurisdictions.
 */
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  projectCode: varchar("projectCode", { length: 64 }).notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  state: varchar("state", { length: 128 }).notNull(),
  district: varchar("district", { length: 128 }).notNull(),
  constituency: varchar("constituency", { length: 128 }),
  recommendedBy: varchar("recommendedBy", { length: 128 }),
  sanctionOrderNo: varchar("sanctionOrderNo", { length: 128 }),
  implementingAgency: varchar("implementingAgency", { length: 255 }),
  category: varchar("category", { length: 128 }),
  status: text("status", { enum: ["Recommended", "Sanctioned", "Active", "Delayed", "Completed", "Cancelled"] }).default("Active").notNull(),
  progress: integer("progress").default(0).notNull(),
  sanctionedAmount: doublePrecision("sanctionedAmount").default(0).notNull(),
  spentAmount: doublePrecision("spentAmount").default(0).notNull(),
  utilization: doublePrecision("utilization").default(0).notNull(),
  riskScore: integer("riskScore").default(0).notNull(),
  riskLevel: text("riskLevel", { enum: ["Low", "Medium", "High"] }).default("Low").notNull(),
  startDate: timestamp("startDate"),
  targetCompletionDate: timestamp("targetCompletionDate"),
  actualCompletionDate: timestamp("actualCompletionDate"),
  sourceType: text("sourceType", { enum: ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"] }).default("OFFICIAL_PUBLIC").notNull(),
  provenanceId: integer("provenanceId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/**
 * Project updates table.
 * Records operational progress submissions, field inspections, and status changes.
 */
export const projectUpdates = pgTable("project_updates", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  updatedBy: varchar("updatedBy", { length: 128 }).notNull(),
  role: text("role", { enum: ["mospi", "state", "district", "mp", "cag"] }).notNull(),
  updateType: varchar("updateType", { length: 64 }).notNull(),
  previousProgress: integer("previousProgress"),
  newProgress: integer("newProgress"),
  remarks: text("remarks"),
  sourceType: text("sourceType", { enum: ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"] }).default("OPERATIONAL_UPDATE").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProjectUpdate = typeof projectUpdates.$inferSelect;
export type InsertProjectUpdate = typeof projectUpdates.$inferInsert;

/**
 * Financial / Project Expenditure data.
 * Records disbursement installments, vouchers, and expenditure milestones.
 */
export const expenditures = pgTable("expenditures", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  voucherNo: varchar("voucherNo", { length: 128 }),
  disbursementDate: timestamp("disbursementDate").defaultNow().notNull(),
  amount: doublePrecision("amount").notNull(),
  purpose: text("purpose"),
  recipientAgency: varchar("recipientAgency", { length: 255 }),
  utilizationCertificateStatus: varchar("utilizationCertificateStatus", { length: 64 }).default("Pending"),
  sourceType: text("sourceType", { enum: ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"] }).default("OFFICIAL_PUBLIC").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Expenditure = typeof expenditures.$inferSelect;
export type InsertExpenditure = typeof expenditures.$inferInsert;

/**
 * AI Anomaly flags.
 * Tracks signals generated by the 4 required modules:
 * 1. Duplicate Work (Semantic Similarity)
 * 2. Fund Movement (Isolation Forest)
 * 3. Delay Risk (Random Forest)
 * 4. Evidence Reuse (Image Similarity)
 */
export const anomalies = pgTable("anomalies", {
  id: serial("id").primaryKey(),
  anomalyCode: varchar("anomalyCode", { length: 64 }).notNull().unique(),
  projectId: integer("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  moduleType: text("moduleType", { enum: ["DUPLICATE_WORK", "FUND_MOVEMENT", "DELAY_RISK", "EVIDENCE_REUSE"] }).notNull(),
  severity: text("severity", { enum: ["Low", "Medium", "High", "Critical"] }).notNull(),
  score: doublePrecision("score").notNull(),
  flaggedText: text("flaggedText").notNull(),
  reasoning: text("reasoning").notNull(),
  status: text("status", { enum: ["FLAGGED", "UNDER_REVIEW", "CLARIFICATION_REQUESTED", "EXPLAINED", "ACTION_TAKEN", "RESOLVED"] }).default("FLAGGED").notNull(),
  detectionMetadata: jsonb("detectionMetadata"),
  sourceType: text("sourceType", { enum: ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"] }).default("OPERATIONAL_UPDATE").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type Anomaly = typeof anomalies.$inferSelect;
export type InsertAnomaly = typeof anomalies.$inferInsert;

/**
 * Risk assessments table.
 * Transparent 0–100 composite risk calculation with explainable factors.
 */
export const riskAssessments = pgTable("risk_assessments", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  compositeScore: integer("compositeScore").notNull(),
  riskLevel: text("riskLevel", { enum: ["Low", "Medium", "High"] }).notNull(),
  duplicateWorkScore: doublePrecision("duplicateWorkScore").default(0),
  fundMovementScore: doublePrecision("fundMovementScore").default(0),
  delayRiskScore: doublePrecision("delayRiskScore").default(0),
  evidenceReuseScore: doublePrecision("evidenceReuseScore").default(0),
  explainableFactors: jsonb("explainableFactors"),
  sourceType: text("sourceType", { enum: ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"] }).default("OPERATIONAL_UPDATE").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RiskAssessment = typeof riskAssessments.$inferSelect;
export type InsertRiskAssessment = typeof riskAssessments.$inferInsert;

/**
 * Cases & Escalations table.
 * Formal case workflow between District Authority, State Nodal, and MoSPI.
 */
export const cases = pgTable("cases", {
  id: serial("id").primaryKey(),
  caseNumber: varchar("caseNumber", { length: 64 }).notNull().unique(),
  projectId: integer("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  priority: text("priority", { enum: ["Low", "Medium", "High", "Critical"] }).default("Medium").notNull(),
  status: text("status", { enum: ["OPEN", "PENDING_DISTRICT_RESPONSE", "PENDING_STATE_REVIEW", "UNDER_INVESTIGATION", "ESCALATED", "ESCALATED_TO_MOSPI", "AUDIT_OBSERVATION", "RESOLVED", "CLOSED"] }).default("OPEN").notNull(),
  assignedRole: text("assignedRole", { enum: ["mospi", "state", "district", "mp", "cag"] }).notNull(),
  assignedUser: varchar("assignedUser", { length: 128 }),
  investigatorRemarks: text("investigatorRemarks"),
  assignedDistrict: varchar("assignedDistrict", { length: 128 }),
  assignedState: varchar("assignedState", { length: 128 }),
  openedBy: varchar("openedBy", { length: 128 }).notNull(),
  deadline: timestamp("deadline"),
  escalatedAt: timestamp("escalatedAt"),
  resolvedAt: timestamp("resolvedAt"),
  sourceType: text("sourceType", { enum: ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"] }).default("OPERATIONAL_UPDATE").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type Case = typeof cases.$inferSelect;
export type InsertCase = typeof cases.$inferInsert;

/**
 * Evidence / Documents table.
 * Uploaded physical evidence: measurement books, site photographs, geo-tagged inspection photos.
 */
export const evidence = pgTable("evidence", {
  id: serial("id").primaryKey(),
  evidenceCode: varchar("evidenceCode", { length: 64 }).notNull().unique(),
  projectId: integer("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  caseId: integer("caseId"),
  title: varchar("title", { length: 255 }).notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  filePath: text("filePath").notNull(),
  fileUrl: text("fileUrl"),
  fileSize: integer("fileSize"),
  mimeType: varchar("mimeType", { length: 128 }),
  perceptualHash: varchar("perceptualHash", { length: 128 }),
  uploadedBy: varchar("uploadedBy", { length: 128 }).notNull(),
  uploadedRole: text("uploadedRole", { enum: ["mospi", "state", "district", "mp", "cag"] }).notNull(),
  verified: boolean("verified").default(false),
  isActive: boolean("isActive").default(true).notNull(),
  removalReason: text("removalReason"),
  removedAt: timestamp("removedAt"),
  removedBy: varchar("removedBy", { length: 128 }),
  sourceType: text("sourceType", { enum: ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"] }).default("OPERATIONAL_UPDATE").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Evidence = typeof evidence.$inferSelect;
export type InsertEvidence = typeof evidence.$inferInsert;

/**
 * Immutable Audit Logs table.
 * Captures user, timestamp, project, field changed, old value, new value, action.
 */
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  auditCode: varchar("auditCode", { length: 64 }).notNull().unique(),
  userId: integer("userId"),
  userName: varchar("userName", { length: 128 }).notNull(),
  userRole: text("userRole", { enum: ["mospi", "state", "district", "mp", "cag"] }).notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  projectId: integer("projectId"),
  projectCode: varchar("projectCode", { length: 64 }),
  targetId: varchar("targetId", { length: 64 }).notNull(),
  targetType: varchar("targetType", { length: 64 }),
  fieldChanged: varchar("fieldChanged", { length: 128 }),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  comments: text("comments"),
  sourceType: text("sourceType", { enum: ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"] }).default("OPERATIONAL_UPDATE").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * Data imports registry.
 * Records batch ingestion of official public datasets (CSV, XLSX, Portal data).
 */
export const dataImports = pgTable("data_imports", {
  id: serial("id").primaryKey(),
  batchId: varchar("batchId", { length: 64 }).notNull().unique(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  sourceUrl: text("sourceUrl"),
  sourceOrganization: varchar("sourceOrganization", { length: 255 }).default("Ministry of Statistics and Programme Implementation (MoSPI)"),
  recordsCount: integer("recordsCount").default(0).notNull(),
  status: text("status", { enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] }).default("COMPLETED").notNull(),
  importedBy: varchar("importedBy", { length: 128 }).notNull(),
  summary: jsonb("summary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DataImport = typeof dataImports.$inferSelect;
export type InsertDataImport = typeof dataImports.$inferInsert;

/**
 * Data provenance tracking.
 * Maps every data point to its authoritative origin, verification level, and ingestion timestamp.
 */
export const dataProvenance = pgTable("data_provenance", {
  id: serial("id").primaryKey(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: integer("entityId").notNull(),
  importBatchId: varchar("importBatchId", { length: 64 }),
  sourceType: text("sourceType", { enum: ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"] }).notNull(),
  officialPortal: varchar("officialPortal", { length: 255 }),
  publishedDate: timestamp("publishedDate"),
  ingestedAt: timestamp("ingestedAt").defaultNow().notNull(),
  verifiedByRole: varchar("verifiedByRole", { length: 64 }),
  notes: text("notes"),
});

export type DataProvenance = typeof dataProvenance.$inferSelect;
export type InsertDataProvenance = typeof dataProvenance.$inferInsert;
