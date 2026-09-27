export const ROLE_KEYS = ["mospi", "state", "district", "mp", "cag"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export type NavItem = {
  key: string;
  label: string;
  icon: string;
};

export type PermissionAction =
  | "processRecommendation"
  | "respondToAiAlert"
  | "requestClarification"
  | "manageCorrectiveAction"
  | "escalateIssue"
  | "submitRecommendation"
  | "recordAuditFinding"
  | "issueAuditRecommendation"
  | "updateFollowup"
  | "configureParameters"
  | "exportReport"
  | "addEvidence";

export type RoleDefinition = {
  key: RoleKey;
  label: string;
  shortLabel: string;
  scopeLabel: string;
  purpose: string;
  question: string;
  nav: NavItem[];
  permissions: string[];
  allowedActions: PermissionAction[];
};

const nav = (items: Array<[string, string, string]>): NavItem[] =>
  items.map(([key, label, icon]) => ({ key, label, icon }));

export const ROLE_DEFINITIONS: Record<RoleKey, RoleDefinition> = {
  mospi: {
    key: "mospi",
    label: "MoSPI / Central Ministry Dashboard",
    shortLabel: "MoSPI / Central Ministry",
    scopeLabel: "National scope · all states and districts",
    purpose: "National-level monitoring and administration of the MPLADS monitoring ecosystem.",
    question: "What is happening across the scheme nationally, and where are the major risks or performance issues?",
    nav: nav([
      ["overview", "National Overview", "LayoutDashboard"],
      ["states", "States", "Map"],
      ["districts", "Districts", "Landmark"],
      ["projects", "Projects / Works", "BriefcaseBusiness"],
      ["finance", "Financial Monitoring", "IndianRupee"],
      ["ai", "AI Risk & Anomalies", "Sparkles"],
      ["escalations", "Escalations", "ArrowUpRight"],
      ["compliance", "Compliance", "ShieldCheck"],
      ["reports", "Reports", "FileBarChart"],
      ["audit", "Audit Trail", "History"],
      ["admin", "System Administration", "Settings2"],
    ]),
    permissions: ["National read access", "Trend and risk analysis", "Report generation", "System parameter administration", "Audit log review"],
    allowedActions: ["configureParameters", "exportReport"],
  },
  state: {
    key: "state",
    label: "State Nodal Dashboard",
    shortLabel: "State Nodal",
    scopeLabel: "Maharashtra scope · 4 assigned districts",
    purpose: "State-level coordination, monitoring, compliance tracking, and supervision of districts.",
    question: "What is happening across the districts in my state, and which district-level issues require attention?",
    nav: nav([
      ["overview", "State Overview", "LayoutDashboard"],
      ["districts", "Districts", "Landmark"],
      ["projects", "Projects", "BriefcaseBusiness"],
      ["finance", "Financial Monitoring", "IndianRupee"],
      ["ai", "AI Alerts", "Sparkles"],
      ["corrective", "Corrective Actions", "ListChecks"],
      ["compliance", "Compliance", "ShieldCheck"],
      ["reports", "Reports", "FileBarChart"],
      ["audit", "Audit Trail", "History"],
    ]),
    permissions: ["Assigned state read access", "District follow-up", "Clarification requests", "Escalation to MoSPI", "State report generation"],
    allowedActions: ["requestClarification", "manageCorrectiveAction", "escalateIssue", "exportReport"],
  },
  district: {
    key: "district",
    label: "District Authority Dashboard",
    shortLabel: "District Authority",
    scopeLabel: "Barwani district scope · operational access",
    purpose: "Operational district-level processing, monitoring, verification, project administration, and response to issues.",
    question: "What is happening with projects in my district, and what action is required?",
    nav: nav([
      ["overview", "District Overview", "LayoutDashboard"],
      ["recommendations", "Recommendations", "ClipboardCheck"],
      ["projects", "Projects", "BriefcaseBusiness"],
      ["finance", "Financial Monitoring", "IndianRupee"],
      ["physical", "Physical Progress", "Activity"],
      ["ai", "AI Alerts", "Sparkles"],
      ["clarifications", "Clarifications", "MessageSquareMore"],
      ["corrective", "Corrective Actions", "ListChecks"],
      ["evidence", "Documents / Evidence", "Files"],
      ["compliance", "Compliance", "ShieldCheck"],
      ["reports", "Reports", "FileBarChart"],
      ["audit", "Audit Trail", "History"],
    ]),
    permissions: ["Assigned district read/write", "Recommendation processing", "Evidence upload", "AI alert response", "Corrective action management"],
    allowedActions: ["processRecommendation", "respondToAiAlert", "requestClarification", "manageCorrectiveAction", "escalateIssue", "addEvidence", "exportReport"],
  },
  mp: {
    key: "mp",
    label: "MP Dashboard",
    shortLabel: "MP",
    scopeLabel: "Own recommendations · authorized constituency scope",
    purpose: "Recommend works and monitor the status and progress of works recommended by the MP.",
    question: "What happened to the works I recommended?",
    nav: nav([
      ["overview", "MP Overview", "LayoutDashboard"],
      ["recommend", "Recommend Work", "PlusCircle"],
      ["recommendations", "My Recommendations", "ClipboardCheck"],
      ["projects", "Project Status", "BriefcaseBusiness"],
      ["progress", "Progress Tracking", "Activity"],
      ["notifications", "Notifications", "Bell"],
      ["reports", "Reports / Status Summary", "FileBarChart"],
    ]),
    permissions: ["Own recommendation write access", "Own project status read access", "Status notifications", "Status report download"],
    allowedActions: ["submitRecommendation", "exportReport"],
  },
  cag: {
    key: "cag",
    label: "Audit & Assurance Dashboard – CAG",
    shortLabel: "Audit & Assurance · CAG",
    scopeLabel: "Authorized audit scope · independent assurance layer",
    purpose: "Independent audit and assurance view across authorized records and evidence.",
    question: "Can implementation and use of public resources be independently assessed through audit evidence?",
    nav: nav([
      ["overview", "Audit Overview", "LayoutDashboard"],
      ["planning", "Audit Planning", "CalendarCheck"],
      ["risk", "AI Risk Assessment", "Radar"],
      ["records", "Projects / Records", "Files"],
      ["evidence", "Evidence", "FileSearch"],
      ["findings", "Audit Findings", "FileWarning"],
      ["recommendations", "Recommendations", "ClipboardCheck"],
      ["followup", "Follow-up", "ListChecks"],
      ["reports", "Reports", "FileBarChart"],
      ["audit", "Audit Trail", "History"],
    ]),
    permissions: ["Broad scoped read access", "Evidence review", "Audit observation write access", "Finding and recommendation write access", "Follow-up tracking"],
    allowedActions: ["recordAuditFinding", "issueAuditRecommendation", "updateFollowup", "addEvidence", "exportReport"],
  },
};

export type DemoAccount = {
  role: RoleKey;
  username: string;
  password: string;
  name: string;
  email: string;
};

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { role: "mospi", username: "mospi001", password: "Mospi@123", name: "A. Qureshi", email: "mospi001@mospi.gov.in" },
  { role: "state", username: "state001", password: "State@123", name: "R. Menon", email: "state001@maharashtra.gov.in" },
  { role: "district", username: "district001", password: "District@123", name: "P. Yadav", email: "district001@barwani.gov.in" },
  { role: "mp", username: "mp001", password: "MP@123", name: "N. Patil", email: "mp001@parliament.gov.in" },
  { role: "cag", username: "cag001", password: "Cag@123", name: "S. Iyer", email: "cag001@cag.gov.in" },
];

export type Kpi = {
  label: string;
  value: string;
  detail: string;
  tone: "teal" | "amber" | "red" | "blue" | "slate";
};

export type AnomalySummary = {
  moduleType: string;
  severity: string;
  score: number;
  flaggedText: string;
};

export type TableRow = {
  id: string;
  title: string;
  meta: string;
  region: string;
  status: string;
  progress: number;
  risk: number;
  amount: string;
  spent?: string;
  sanctionedRaw?: number;
  spentRaw?: number;
  riskLevel?: string;
  aiReasoning?: string;
  anomalies?: AnomalySummary[];
};

export type ActivityItem = {
  label: string;
  ref: string;
  person: string;
  date: string;
  tone: "teal" | "amber" | "red" | "blue";
};

export type SignalModuleStat = {
  count: number;
  maxScore: number;
  percentageText: string;
  statusText: string;
};

export type DashboardSnapshot = {
  kpis: Kpi[];
  hero: { eyebrow: string; title: string; description: string };
  risk: { high: number; medium: number; low: number; total: number };
  rows: TableRow[];
  activities: ActivityItem[];
  focus: { label: string; value: string; detail: string }[];
  workflow: string[];
  signalStats?: {
    duplicateWork: SignalModuleStat;
    fundMovement: SignalModuleStat;
    delayRisk: SignalModuleStat;
    evidenceReuse: SignalModuleStat;
  };
};

const sharedRows: TableRow[] = [
  { id: "MPLAD-2025-001", title: "Integrated drinking water network", meta: "MPLAD-2025-001", region: "Barwani", status: "Delayed", progress: 52, risk: 86, amount: "₹1.24 Cr" },
  { id: "MPLAD-2025-035", title: "Storm-water drainage rehabilitation", meta: "MPLAD-2025-035", region: "Srinagar", status: "Delayed", progress: 41, risk: 79, amount: "₹84.5 L" },
  { id: "MPLAD-2025-014", title: "Government Higher Secondary School upgrade", meta: "MPLAD-2025-014", region: "Wardha", status: "Active", progress: 46, risk: 54, amount: "₹62.0 L" },
  { id: "MPLAD-2025-044", title: "Primary health centre equipment upgrade", meta: "MPLAD-2025-044", region: "Kottayam", status: "Active", progress: 38, risk: 47, amount: "₹39.8 L" },
];

const baseActivities: ActivityItem[] = [
  { label: "Case escalated", ref: "CASE-2396", person: "A. Qureshi", date: "23 Sept 2026", tone: "red" },
  { label: "Clarification added", ref: "CASE-2401", person: "R. Menon", date: "24 Sept 2026", tone: "amber" },
  { label: "Evidence uploaded", ref: "MPLAD-2025-001", person: "P. Yadav", date: "22 Sept 2026", tone: "teal" },
  { label: "Physical progress changed", ref: "MPLAD-2025-014", person: "N. Patil", date: "21 Sept 2026", tone: "blue" },
];

const snapshot = (role: RoleKey): DashboardSnapshot => {
  const definitions: Record<RoleKey, DashboardSnapshot> = {
    mospi: {
      kpis: [
        { label: "Total projects / works", value: "6", detail: "Across 4 districts", tone: "teal" },
        { label: "Recommended amount", value: "₹4.42 Cr", detail: "6 recommendations", tone: "blue" },
        { label: "Sanctioned amount", value: "₹3.89 Cr", detail: "₹2.95 Cr spent", tone: "blue" },
        { label: "Fund utilization", value: "76%", detail: "Against sanctioned value", tone: "teal" },
        { label: "Projects in progress", value: "4", detail: "2 completed", tone: "slate" },
        { label: "Delayed projects", value: "2", detail: "2 high-risk delays", tone: "red" },
        { label: "AI-flagged projects", value: "2", detail: "5 signals need review", tone: "amber" },
        { label: "Pending district actions", value: "7", detail: "Across 3 districts", tone: "amber" },
        { label: "Pending state actions", value: "3", detail: "1 escalation overdue", tone: "red" },
      ],
      hero: { eyebrow: "AI oversight brief · refreshed 09:42 IST", title: "A clearer view of where public works need attention.", description: "Nigraani AI surfaces unusual patterns for human verification. It does not determine guilt or fraud — every signal is explainable, reviewable, and recorded." },
      risk: { high: 2, medium: 2, low: 2, total: 6 }, rows: sharedRows, activities: baseActivities,
      focus: [{ label: "National utilization", value: "76%", detail: "+4.8% versus last quarter" }, { label: "State needing review", value: "Madhya Pradesh", detail: "2 high-risk works" }, { label: "Open escalations", value: "3", detail: "1 beyond SLA" }],
      workflow: ["National signal detected", "State / district review", "Corrective action tracked", "Assurance evidence available"],
    },
    state: {
      kpis: [
        { label: "Total districts", value: "4", detail: "Maharashtra scope", tone: "blue" },
        { label: "Total projects", value: "6", detail: "Within assigned state", tone: "teal" },
        { label: "Sanctioned amount", value: "₹3.89 Cr", detail: "₹2.95 Cr spent", tone: "blue" },
        { label: "Fund utilization", value: "76%", detail: "State portfolio", tone: "teal" },
        { label: "Delayed projects", value: "2", detail: "Barwani · Srinagar", tone: "red" },
        { label: "High-risk projects", value: "2", detail: "Require district response", tone: "amber" },
        { label: "Pending district actions", value: "7", detail: "4 due this week", tone: "amber" },
        { label: "Pending clarifications", value: "3", detail: "2 from Barwani", tone: "amber" },
        { label: "Compliance issues", value: "2", detail: "One open observation", tone: "red" },
      ],
      hero: { eyebrow: "State coordination brief · Maharashtra", title: "Keep district issues moving before they become escalations.", description: "Coordinate corrective actions with District Authorities, track response deadlines, and escalate unresolved or high-risk matters to MoSPI." },
      risk: { high: 2, medium: 2, low: 2, total: 6 }, rows: sharedRows, activities: baseActivities,
      focus: [{ label: "District needing follow-up", value: "Barwani", detail: "3 actions pending" }, { label: "Response SLA", value: "82%", detail: "Within target this month" }, { label: "Escalate today", value: "1", detail: "CASE-2396 · overdue" }],
      workflow: ["District response pending", "State follow-up", "Escalate if unresolved", "MoSPI visibility"],
    },
    district: {
      kpis: [
        { label: "Total recommendations", value: "8", detail: "3 received this month", tone: "blue" },
        { label: "Pending recommendations", value: "2", detail: "Eligibility checks due", tone: "amber" },
        { label: "Sanctioned projects", value: "6", detail: "₹3.89 Cr sanctioned", tone: "teal" },
        { label: "Under implementation", value: "4", detail: "52% average progress", tone: "blue" },
        { label: "Completed projects", value: "2", detail: "Closed with evidence", tone: "teal" },
        { label: "Delayed projects", value: "2", detail: "1 high-risk", tone: "red" },
        { label: "Total expenditure", value: "₹2.95 Cr", detail: "76% utilization", tone: "teal" },
        { label: "AI alerts", value: "3", detail: "2 need response", tone: "amber" },
        { label: "Pending clarifications", value: "2", detail: "1 response received", tone: "amber" },
        { label: "Corrective actions", value: "4", detail: "1 overdue", tone: "red" },
      ],
      hero: { eyebrow: "District operations brief · Barwani", title: "Resolve the next issue with a complete, traceable record.", description: "Process recommendations, verify implementation evidence, respond to AI alerts, and submit corrective actions without silently dismissing risk signals." },
      risk: { high: 1, medium: 2, low: 3, total: 6 }, rows: sharedRows.filter(row => row.region === "Barwani" || row.region === "Wardha"), activities: baseActivities,
      focus: [{ label: "Next recommendation", value: "REC-2026-008", detail: "Eligibility check due today" }, { label: "AI response due", value: "CASE-2401", detail: "Evidence requested" }, { label: "Action overdue", value: "CA-118", detail: "Escalate after 2 days" }],
      workflow: ["MP Recommendation", "Eligibility & feasibility", "Decision / sanction", "Project monitoring", "AI response & evidence"],
    },
    mp: {
      kpis: [
        { label: "Total recommendations", value: "8", detail: "Submitted by you", tone: "blue" },
        { label: "Pending recommendations", value: "2", detail: "Under district review", tone: "amber" },
        { label: "Approved / sanctioned", value: "5", detail: "₹2.75 Cr sanctioned", tone: "teal" },
        { label: "Works in progress", value: "4", detail: "Latest update 21 Sept", tone: "blue" },
        { label: "Completed works", value: "2", detail: "Evidence available", tone: "teal" },
        { label: "Delayed works", value: "2", detail: "Status notifications on", tone: "red" },
        { label: "Recommended amount", value: "₹3.18 Cr", detail: "Across 8 works", tone: "blue" },
        { label: "Sanctioned amount", value: "₹2.75 Cr", detail: "87% of recommendations", tone: "teal" },
        { label: "Completion", value: "42%", detail: "2 of 5 sanctioned works", tone: "amber" },
      ],
      hero: { eyebrow: "Constituency status brief · Wardha", title: "See what happened to the works you recommended.", description: "The MP role is recommendation and monitoring, not project execution or financial administration. Status and expenditure views are read-only." },
      risk: { high: 1, medium: 2, low: 5, total: 8 }, rows: sharedRows.filter(row => row.region === "Wardha" || row.region === "Kottayam"), activities: baseActivities.slice(1),
      focus: [{ label: "Latest recommendation", value: "REC-2026-008", detail: "Received · 22 Sept 2026" }, { label: "Awaiting clarification", value: "1", detail: "District response requested" }, { label: "Next status update", value: "30 Sept", detail: "Automated notification" }],
      workflow: ["Submit recommendation", "District processing", "Sanction status", "Implementation updates", "Completion evidence"],
    },
    cag: {
      kpis: [
        { label: "Reviews in scope", value: "4", detail: "FY 2026 audit plan", tone: "blue" },
        { label: "High-risk areas", value: "2", detail: "Fund movement · delay", tone: "red" },
        { label: "Projects selected", value: "12", detail: "Authorized audit sample", tone: "blue" },
        { label: "Evidence pending", value: "7", detail: "3 past due", tone: "amber" },
        { label: "Findings open", value: "5", detail: "2 material observations", tone: "red" },
        { label: "Findings under follow-up", value: "3", detail: "Management response due", tone: "amber" },
        { label: "Recommendations pending", value: "4", detail: "Awaiting management action", tone: "amber" },
        { label: "Completed follow-ups", value: "8", detail: "This financial year", tone: "teal" },
      ],
      hero: { eyebrow: "Independent assurance brief · authorized scope", title: "Assess implementation through evidence, not operational control.", description: "Audit & Assurance has broad read access to authorized records and controlled write access only for observations, findings, recommendations, evidence, and follow-up." },
      risk: { high: 4, medium: 5, low: 3, total: 12 }, rows: sharedRows, activities: baseActivities,
      focus: [{ label: "Evidence gap", value: "7 records", detail: "3 past the requested date" }, { label: "Material observation", value: "AUD-26-014", detail: "Fund movement variance" }, { label: "Follow-up due", value: "4 Oct", detail: "Management response" }],
      workflow: ["Audit planning", "Risk assessment", "Evidence review", "Finding recorded", "Management response", "Follow-up"],
    },
  };
  return definitions[role];
};

export function getRoleSnapshot(role: RoleKey): DashboardSnapshot {
  return snapshot(role);
}

export function canRolePerform(role: RoleKey, action: PermissionAction): boolean {
  return ROLE_DEFINITIONS[role].allowedActions.includes(action);
}
