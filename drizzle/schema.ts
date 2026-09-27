import { boolean, double, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
import type { RoleKey } from "../shared/monitoring";

/**
 * Core user table backing auth flow.
 * Preserves the exact 5 authorized Nigraani AI roles.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["mospi", "state", "district", "mp", "cag"]).default("mospi").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
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
  status: mysqlEnum("status", ["Recommended", "Sanctioned", "Active", "Delayed", "Completed", "Cancelled"]).default("Active").notNull(),
  progress: int("progress").default(0).notNull(),
  sanctionedAmount: double("sanctionedAmount").default(0.0).notNull(),
  spentAmount: double("spentAmount").default(0.0).notNull(),
  utilization: double("utilization").default(0.0).notNull(),
  riskScore: int("riskScore").default(0).notNull(),
  riskLevel: mysqlEnum("riskLevel", ["Low", "Medium", "High"]).default("Low").notNull(),
  startDate: timestamp("startDate"),
  targetCompletionDate: timestamp("targetCompletionDate"),
  actualCompletionDate: timestamp("actualCompletionDate"),
  sourceType: mysqlEnum("sourceType", ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"]).default("OFFICIAL_PUBLIC").notNull(),
  provenanceId: int("provenanceId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/**
 * Project updates table.
 * Records operational progress submissions, field inspections, and status changes.
 */
export const projectUpdates = mysqlTable("project_updates", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  updatedBy: varchar("updatedBy", { length: 128 }).notNull(),
  role: mysqlEnum("role", ["mospi", "state", "district", "mp", "cag"]).notNull(),
  updateType: varchar("updateType", { length: 64 }).notNull(),
  previousProgress: int("previousProgress"),
  newProgress: int("newProgress"),
  remarks: text("remarks"),
  sourceType: mysqlEnum("sourceType", ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"]).default("OPERATIONAL_UPDATE").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProjectUpdate = typeof projectUpdates.$inferSelect;
export type InsertProjectUpdate = typeof projectUpdates.$inferInsert;

/**
 * Financial / Project Expenditure data.
 * Records disbursement installments, vouchers, and expenditure milestones.
 */
export const expenditures = mysqlTable("expenditures", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  voucherNo: varchar("voucherNo", { length: 128 }),
  disbursementDate: timestamp("disbursementDate").defaultNow().notNull(),
  amount: double("amount").notNull(),
  purpose: text("purpose"),
  recipientAgency: varchar("recipientAgency", { length: 255 }),
  utilizationCertificateStatus: varchar("utilizationCertificateStatus", { length: 64 }).default("Pending"),
  sourceType: mysqlEnum("sourceType", ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"]).default("OFFICIAL_PUBLIC").notNull(),
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
export const anomalies = mysqlTable("anomalies", {
  id: int("id").autoincrement().primaryKey(),
  anomalyCode: varchar("anomalyCode", { length: 64 }).notNull().unique(),
  projectId: int("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  moduleType: mysqlEnum("moduleType", ["DUPLICATE_WORK", "FUND_MOVEMENT", "DELAY_RISK", "EVIDENCE_REUSE"]).notNull(),
  severity: mysqlEnum("severity", ["Low", "Medium", "High", "Critical"]).notNull(),
  score: double("score").notNull(),
  flaggedText: text("flaggedText").notNull(),
  reasoning: text("reasoning").notNull(),
  status: mysqlEnum("status", ["FLAGGED", "UNDER_REVIEW", "CLARIFICATION_REQUESTED", "EXPLAINED", "ACTION_TAKEN", "RESOLVED"]).default("FLAGGED").notNull(),
  detectionMetadata: json("detectionMetadata"),
  sourceType: mysqlEnum("sourceType", ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"]).default("OPERATIONAL_UPDATE").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Anomaly = typeof anomalies.$inferSelect;
export type InsertAnomaly = typeof anomalies.$inferInsert;

/**
 * Risk assessments table.
 * Transparent 0–100 composite risk calculation with explainable factors.
 */
export const riskAssessments = mysqlTable("risk_assessments", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  compositeScore: int("compositeScore").notNull(),
  riskLevel: mysqlEnum("riskLevel", ["Low", "Medium", "High"]).notNull(),
  duplicateWorkScore: double("duplicateWorkScore").default(0.0),
  fundMovementScore: double("fundMovementScore").default(0.0),
  delayRiskScore: double("delayRiskScore").default(0.0),
  evidenceReuseScore: double("evidenceReuseScore").default(0.0),
  explainableFactors: json("explainableFactors"),
  sourceType: mysqlEnum("sourceType", ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"]).default("OPERATIONAL_UPDATE").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RiskAssessment = typeof riskAssessments.$inferSelect;
export type InsertRiskAssessment = typeof riskAssessments.$inferInsert;

/**
 * Cases & Escalations table.
 * Formal case workflow between District Authority, State Nodal, and MoSPI.
 */
export const cases = mysqlTable("cases", {
  id: int("id").autoincrement().primaryKey(),
  caseNumber: varchar("caseNumber", { length: 64 }).notNull().unique(),
  projectId: int("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  priority: mysqlEnum("priority", ["Low", "Medium", "High", "Critical"]).default("Medium").notNull(),
  status: mysqlEnum("status", ["OPEN", "PENDING_DISTRICT_RESPONSE", "PENDING_STATE_REVIEW", "UNDER_INVESTIGATION", "ESCALATED", "ESCALATED_TO_MOSPI", "AUDIT_OBSERVATION", "RESOLVED", "CLOSED"]).default("OPEN").notNull(),
  assignedRole: mysqlEnum("assignedRole", ["mospi", "state", "district", "mp", "cag"]).notNull(),
  assignedUser: varchar("assignedUser", { length: 128 }),
  investigatorRemarks: text("investigatorRemarks"),
  assignedDistrict: varchar("assignedDistrict", { length: 128 }),
  assignedState: varchar("assignedState", { length: 128 }),
  openedBy: varchar("openedBy", { length: 128 }).notNull(),
  deadline: timestamp("deadline"),
  escalatedAt: timestamp("escalatedAt"),
  resolvedAt: timestamp("resolvedAt"),
  sourceType: mysqlEnum("sourceType", ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"]).default("OPERATIONAL_UPDATE").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Case = typeof cases.$inferSelect;
export type InsertCase = typeof cases.$inferInsert;

/**
 * Evidence / Documents table.
 * Uploaded physical evidence: measurement books, site photographs, geo-tagged inspection photos.
 */
export const evidence = mysqlTable("evidence", {
  id: int("id").autoincrement().primaryKey(),
  evidenceCode: varchar("evidenceCode", { length: 64 }).notNull().unique(),
  projectId: int("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  caseId: int("caseId"),
  title: varchar("title", { length: 255 }).notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  filePath: text("filePath").notNull(),
  fileUrl: text("fileUrl"),
  fileSize: int("fileSize"),
  mimeType: varchar("mimeType", { length: 128 }),
  perceptualHash: varchar("perceptualHash", { length: 128 }),
  uploadedBy: varchar("uploadedBy", { length: 128 }).notNull(),
  uploadedRole: mysqlEnum("uploadedRole", ["mospi", "state", "district", "mp", "cag"]).notNull(),
  verified: boolean("verified").default(false),
  isActive: boolean("isActive").default(true).notNull(),
  removalReason: text("removalReason"),
  removedAt: timestamp("removedAt"),
  removedBy: varchar("removedBy", { length: 128 }),
  sourceType: mysqlEnum("sourceType", ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"]).default("OPERATIONAL_UPDATE").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Evidence = typeof evidence.$inferSelect;
export type InsertEvidence = typeof evidence.$inferInsert;

/**
 * Immutable Audit Logs table.
 * Captures user, timestamp, project, field changed, old value, new value, action.
 */
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  auditCode: varchar("auditCode", { length: 64 }).notNull().unique(),
  userId: int("userId"),
  userName: varchar("userName", { length: 128 }).notNull(),
  userRole: mysqlEnum("userRole", ["mospi", "state", "district", "mp", "cag"]).notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  projectId: int("projectId"),
  projectCode: varchar("projectCode", { length: 64 }),
  targetId: varchar("targetId", { length: 64 }).notNull(),
  targetType: varchar("targetType", { length: 64 }),
  fieldChanged: varchar("fieldChanged", { length: 128 }),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  comments: text("comments"),
  sourceType: mysqlEnum("sourceType", ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"]).default("OPERATIONAL_UPDATE").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * Data imports registry.
 * Records batch ingestion of official public datasets (CSV, XLSX, Portal data).
 */
export const dataImports = mysqlTable("data_imports", {
  id: int("id").autoincrement().primaryKey(),
  batchId: varchar("batchId", { length: 64 }).notNull().unique(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  sourceUrl: text("sourceUrl"),
  sourceOrganization: varchar("sourceOrganization", { length: 255 }).default("Ministry of Statistics and Programme Implementation (MoSPI)"),
  recordsCount: int("recordsCount").default(0).notNull(),
  status: mysqlEnum("status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"]).default("COMPLETED").notNull(),
  importedBy: varchar("importedBy", { length: 128 }).notNull(),
  summary: json("summary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DataImport = typeof dataImports.$inferSelect;
export type InsertDataImport = typeof dataImports.$inferInsert;

/**
 * Data provenance tracking.
 * Maps every data point to its authoritative origin, verification level, and ingestion timestamp.
 */
export const dataProvenance = mysqlTable("data_provenance", {
  id: int("id").autoincrement().primaryKey(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: int("entityId").notNull(),
  importBatchId: varchar("importBatchId", { length: 64 }),
  sourceType: mysqlEnum("sourceType", ["OFFICIAL_PUBLIC", "OPERATIONAL_UPDATE", "DEMO_AUGMENTATION"]).notNull(),
  officialPortal: varchar("officialPortal", { length: 255 }),
  publishedDate: timestamp("publishedDate"),
  ingestedAt: timestamp("ingestedAt").defaultNow().notNull(),
  verifiedByRole: varchar("verifiedByRole", { length: 64 }),
  notes: text("notes"),
});

export type DataProvenance = typeof dataProvenance.$inferSelect;
export type InsertDataProvenance = typeof dataProvenance.$inferInsert;
