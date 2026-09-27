import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { canRolePerform, DEMO_ACCOUNTS, getRoleSnapshot, ROLE_DEFINITIONS, type DashboardSnapshot, type PermissionAction, type RoleKey, type TableRow } from "@shared/monitoring";
import { NigraaniLogo, NigraaniShieldIcon } from "@/components/NigraaniLogo";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileBarChart,
  FileClock,
  FileDown,
  FileText,
  FileWarning,
  Filter,
  Info,
  Loader2,
  LockKeyhole,
  Maximize2,
  MessageSquareMore,
  Paperclip,
  Plus,
  PlusCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Trash2,
  UploadCloud,
  UserCheck,
  UserRound,
  WandSparkles,
  X,
  ZoomIn,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// ── Export helpers ────────────────────────────────────────────────────────────
function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const csv = [headers.join(","), ...rows.map(r => headers.map(h => escape(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBase64Pdf(base64: string, filename: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatEvidenceTimestamp(dateVal: any): string {
  if (!dateVal) return "N/A";
  let d: Date;
  if (dateVal instanceof Date) {
    d = dateVal;
  } else if (typeof dateVal === "number") {
    d = new Date(dateVal);
  } else if (typeof dateVal === "string") {
    const trimmed = dateVal.trim();
    if (!trimmed) return "N/A";
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      d = new Date(trimmed.replace(" ", "T") + "+05:30");
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      d = new Date(trimmed + "T00:00:00+05:30");
    } else {
      d = new Date(trimmed);
    }
  } else {
    d = new Date(dateVal);
  }

  if (isNaN(d.getTime())) return "N/A";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const map: Record<string, string> = {};
  parts.forEach(p => (map[p.type] = p.value));
  return `${map.day} ${map.month} ${map.year}, ${map.hour}:${map.minute} ${(map.dayPeriod || "").toUpperCase()} IST`;
}

function getEvidenceFileName(ev: { filePath?: string | null; fileUrl?: string | null; title?: string; category?: string }): string {
  if (ev.filePath) {
    const raw = ev.filePath.replace(/\\/g, "/");
    const lastPart = raw.split("/").pop() || "";
    const clean = lastPart.replace(/^EVID-[^_]+_\d+_/, "");
    if (clean) return clean;
    return lastPart;
  }
  if (ev.fileUrl) {
    const raw = ev.fileUrl.replace(/\\/g, "/");
    const lastPart = raw.split("/").pop() || "";
    const clean = lastPart.replace(/^EVID-[^_]+_\d+_/, "");
    if (clean) return clean;
    return lastPart;
  }
  const ext = ev.category === "SITE_PHOTO" ? ".jpg" : ".pdf";
  return `${(ev.title || "evidence").toLowerCase().replace(/[^a-z0-9_-]/g, "_")}${ext}`;
}

function formatEvidenceCategory(category?: string | null): string {
  if (!category) return "Evidence";
  switch (category) {
    case "SITE_PHOTO":
      return "Site Photo";
    case "SUPPORTING_DOCUMENT":
      return "Supporting Document";
    case "MEASUREMENT_BOOK":
      return "Measurement Book";
    case "INSPECTION_REPORT":
      return "Inspection Report";
    default:
      return category.replace(/_/g, " ");
  }
}

function isImageEvidence(ev: { category?: string | null; fileUrl?: string | null; filePath?: string | null; mimeType?: string | null }): boolean {
  if (ev.category === "SITE_PHOTO") return true;
  if (ev.mimeType && ev.mimeType.startsWith("image/")) return true;
  const pathOrUrl = (ev.fileUrl || ev.filePath || "").toLowerCase();
  if (pathOrUrl.endsWith(".jpg") || pathOrUrl.endsWith(".jpeg") || pathOrUrl.endsWith(".png") || pathOrUrl.endsWith(".webp") || pathOrUrl.endsWith(".gif")) {
    return true;
  }
  if (pathOrUrl.startsWith("data:image/")) return true;
  return false;
}

const roleHighlights: Record<RoleKey, { accent: string; icon: typeof Sparkles }> = {
  mospi: { accent: "#157b76", icon: BarChart3 },
  state: { accent: "#2368a0", icon: TrendingUp },
  district: { accent: "#bc7a21", icon: ClipboardCheck },
  mp: { accent: "#7d5bb5", icon: UserRound },
  cag: { accent: "#8d566d", icon: FileCheck2 },
};

const roleAction: Record<RoleKey, { label: string; action?: PermissionAction; target: string; comments: string }> = {
  mospi: { label: "Review highest-risk case", target: "MPLAD-2025-001", comments: "National review opened from priority queue." },
  state: { label: "Follow up district action", action: "manageCorrectiveAction", target: "CA-118", comments: "State follow-up initiated for overdue district action." },
  district: { label: "Process next recommendation", action: "processRecommendation", target: "REC-2026-008", comments: "Recommendation processing started with eligibility check." },
  mp: { label: "Recommend Work", action: "submitRecommendation", target: "REC-2026-009", comments: "New work recommendation submitted for district review." },
  cag: { label: "Record audit finding", action: "recordAuditFinding", target: "AUD-26-015", comments: "Audit observation recorded for management response." },
};

export default function Home() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <DemoLogin />;
  return <DashboardWorkspace user={user} />;
}

function DashboardWorkspace({ user }: { user: NonNullable<ReturnType<typeof useAuth>["user"]> }) {
  const [activeKey, setActiveKey] = useState("overview");
  const [selectedRow, setSelectedRow] = useState<TableRow | null>(null);
  const [activePrompt, setActivePrompt] = useState<{ action: PermissionAction; target: string; label: string; comments: string } | null>(null);
  const [updatingProject, setUpdatingProject] = useState<TableRow | null>(null);
  const [managingCase, setManagingCase] = useState<{ projectCode: string; title: string; caseNumber?: string } | null>(null);
  const [recommendingWork, setRecommendingWork] = useState(false);
  const [recordingFinding, setRecordingFinding] = useState(false);
  const [findingProjectCode, setFindingProjectCode] = useState<string | undefined>(undefined);
  const utils = trpc.useUtils();

  const role = user.role as RoleKey;
  const definition = ROLE_DEFINITIONS[role];
  const effectiveActiveKey = role === "cag" && activeKey === "ai" ? "risk" : activeKey;
  const snapshotQuery = trpc.monitoring.snapshot.useQuery(undefined, { retry: false });
  const snapshot = snapshotQuery.data?.snapshot ?? getRoleSnapshot(role);
  const actionMutation = trpc.monitoring.performAction.useMutation({
    onSuccess: result => {
      toast.success("Action recorded in the audit trail", { description: `${result.event.action} · ${result.event.targetId}` });
      setActivePrompt(null);
    },
    onError: error => toast.error("Action could not be recorded", { description: error.message }),
  });

  useEffect(() => {
    setActiveKey("overview");
    setSelectedRow(null);
    setActivePrompt(null);
    setUpdatingProject(null);
    setManagingCase(null);
    setRecommendingWork(false);
    setRecordingFinding(false);
    setFindingProjectCode(undefined);
  }, [role]);

  const performRoleAction = () => {
    if (role === "mp") {
      setRecommendingWork(true);
      return;
    }
    if (role === "cag") {
      setFindingProjectCode(undefined);
      setRecordingFinding(true);
      return;
    }
    const config = roleAction[role];
    if (!config.action || !canRolePerform(role, config.action)) {
      setSelectedRow(snapshot.rows[0] ?? null);
      return;
    }
    setActivePrompt({ action: config.action, target: config.target, label: config.label, comments: config.comments });
  };

  const submitPrompt = (comments: string) => {
    if (!activePrompt) return;
    actionMutation.mutate({ action: activePrompt.action, targetId: activePrompt.target, comments });
  };

  return (
    <DashboardLayout
      activeKey={effectiveActiveKey}
      onNavigate={key => {
        if (key === "recommend" && role === "mp") {
          setRecommendingWork(true);
          return;
        }
        const targetKey = role === "cag" && key === "ai" ? "risk" : key;
        setActiveKey(targetKey);
        setActivePrompt(null);
      }}
    >
      <div className="mx-auto max-w-[1500px] space-y-6">
        <WorkspaceHeading definition={definition} userName={user.name ?? "Demo reviewer"} activeKey={effectiveActiveKey} role={role} />
        {effectiveActiveKey === "overview" ? (
          <Overview
            snapshot={snapshot}
            role={role}
            onPrimary={performRoleAction}
            onSelect={setSelectedRow}
            onUpdate={setUpdatingProject}
            onNavigate={key => setActiveKey(role === "cag" && key === "ai" ? "risk" : key)}
          />
        ) : (
          <ModuleView
            snapshot={snapshot}
            definition={definition}
            activeKey={effectiveActiveKey}
            role={role}
            onSelect={setSelectedRow}
            onPrimary={performRoleAction}
            onUpdate={setUpdatingProject}
            onManageCase={setManagingCase}
            onNavigate={key => setActiveKey(role === "cag" && key === "ai" ? "risk" : key)}
            onRecordFinding={(code?: string) => {
              setFindingProjectCode(code);
              setRecordingFinding(true);
            }}
          />
        )}
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          {activePrompt ? <ActionPrompt prompt={activePrompt} onCancel={() => setActivePrompt(null)} onSubmit={submitPrompt} pending={actionMutation.isPending} /> : <PermissionsCard definition={definition} role={role} />}
          <SignalLegend role={role} signalStats={snapshot.signalStats} />
        </div>
      </div>

      {/* Immediate Project Details Slide-over Drawer (Fixes Scroll/Focus Bug) */}
      <Sheet open={!!selectedRow} onOpenChange={open => !open && setSelectedRow(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto p-0 border-l border-[#dcebe5] bg-[#f8faf9] z-50">
          <SheetHeader className="sr-only">
            <SheetTitle>Project Details</SheetTitle>
          </SheetHeader>
          {(() => {
            const activeRow = selectedRow ? (snapshot.rows.find(r => r.id === selectedRow.id) ?? selectedRow) : null;
            if (!activeRow) return null;
            return (
              <div className="p-4 sm:p-6">
                <DetailPanel
                  row={activeRow}
                  role={role}
                  onClose={() => setSelectedRow(null)}
                  onAction={action => {
                    if (action === "addEvidence" && role === "district") {
                      setUpdatingProject(activeRow);
                    } else {
                      setActivePrompt({ action, target: activeRow.id, label: actionLabel(action), comments: "Follow-up initiated from the record detail view." });
                    }
                  }}
                  onUpdateProject={setUpdatingProject}
                  onManageCase={setManagingCase}
                  onRecordFinding={(code?: string) => {
                    setFindingProjectCode(code);
                    setRecordingFinding(true);
                  }}
                />
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {updatingProject && (
        <ProjectUpdateDialog
          project={updatingProject}
          userRole={role}
          userName={user.name ?? "Authorized Officer"}
          onClose={() => setUpdatingProject(null)}
          onSuccess={async () => {
            const res = await snapshotQuery.refetch();
            if (res.data?.snapshot?.rows) {
              const fresh = res.data.snapshot.rows.find((r: TableRow) => r.id === updatingProject.id);
              if (fresh) setSelectedRow(fresh);
            }
            setUpdatingProject(null);
          }}
        />
      )}

      {managingCase && (
        <CaseVerificationDialog
          caseInfo={managingCase}
          userRole={role}
          userName={user.name ?? "Authorized Officer"}
          onClose={() => setManagingCase(null)}
          onSuccess={() => {
            snapshotQuery.refetch();
            setManagingCase(null);
          }}
        />
      )}

      {recommendingWork && (
        <RecommendWorkDialog
          userRole={role}
          userName={user.name ?? "Hon. Member of Parliament"}
          onClose={() => setRecommendingWork(false)}
          onSuccess={async (newCode?: string) => {
            setRecommendingWork(false);
            const res = await snapshotQuery.refetch();
            if (res.data?.snapshot?.rows && newCode) {
              const fresh = res.data.snapshot.rows.find((r: TableRow) => r.id === newCode);
              if (fresh) setSelectedRow(fresh);
            }
          }}
        />
      )}

      {recordingFinding && (
        <RecordAuditFindingDialog
          userRole={role}
          userName={user.name ?? "S. Iyer, Senior Audit Officer"}
          initialProjectCode={findingProjectCode || snapshot.rows[0]?.id}
          availableProjects={snapshot.rows.map(r => ({ id: r.id, title: r.title, region: r.region }))}
          onClose={() => {
            setRecordingFinding(false);
            setFindingProjectCode(undefined);
          }}
          onSuccess={async () => {
            setRecordingFinding(false);
            setFindingProjectCode(undefined);
            await snapshotQuery.refetch();
            utils.monitoring.getCases.invalidate();
            utils.monitoring.getAuditFindings.invalidate();
          }}
        />
      )}
    </DashboardLayout>
  );
}

function LoadingScreen() {
  return <div className="grid min-h-screen place-items-center bg-[#f5f8f7]"><div className="flex items-center gap-3 text-sm font-semibold text-[#1d696c]"><span className="h-3 w-3 animate-pulse rounded-full bg-[#14a17d]" /> Loading Nigraani workspace…</div></div>;
}

function DemoLogin() {
  const [selectedRole, setSelectedRole] = useState<RoleKey>("mospi");
  const account = DEMO_ACCOUNTS.find(item => item.role === selectedRole)!;
  const [username, setUsername] = useState(account.username);
  const [password, setPassword] = useState(account.password);
  const utils = trpc.useUtils();
  const loginMutation = trpc.auth.demoLogin.useMutation({
    onSuccess: async data => {
      try {
        if (data.session) {
          const serialized = JSON.stringify(data.session);
          sessionStorage.setItem("nigraani_demo_session", serialized);
          localStorage.setItem("nigraani_demo_session", serialized);
        }
      } catch {}
      if (data.user) {
        utils.auth.me.setData(undefined, data.user);
      }
      await utils.auth.me.invalidate();
    },
    onError: error => toast.error("Sign-in failed", { description: error.message }),
  });

  useEffect(() => {
    const next = DEMO_ACCOUNTS.find(item => item.role === selectedRole)!;
    setUsername(next.username);
    setPassword(next.password);
  }, [selectedRole]);

  const selectRole = (role: RoleKey) => setSelectedRole(role);
  return (
    <div className="min-h-screen bg-[#eff6f3] text-[#173e49]">
      <div className="mx-auto grid min-h-screen max-w-[1440px] lg:grid-cols-[minmax(420px,0.9fr)_1.1fr]">
        <section className="relative hidden overflow-hidden bg-[#0b2934] px-12 py-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-32 -top-32 h-80 w-80 rounded-full border-[32px] border-[#1c6b6d]/30" /><div className="absolute bottom-20 -left-24 h-56 w-56 rounded-full border-[22px] border-[#16a885]/20" />
          <div className="relative"><div className="mb-16"><NigraaniLogo theme="dark" size="lg" /></div><p className="max-w-md text-[11px] font-bold uppercase tracking-[0.28em] text-[#71b9aa]">Government works oversight</p><h1 className="mt-5 max-w-lg text-5xl font-semibold leading-[1.05] tracking-[-0.045em]">Evidence-led visibility for public works.</h1><p className="mt-6 max-w-md text-sm leading-7 text-[#9fc4c0]">A shared monitoring layer for recommendations, implementation, AI risk signals, corrective action, and independent assurance.</p></div>
          <div className="relative grid gap-3 text-xs text-[#9fc4c0]"><div className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-[#50d1ae]" /> Five clearly separated authorities</div><div className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-[#50d1ae]" /> Every important action is traceable</div><div className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-[#50d1ae]" /> AI supports human review — never replaces it</div></div>
        </section>
        <section className="flex items-center justify-center px-5 py-10 sm:px-10"><div className="w-full max-w-xl"><div className="mb-8 lg:hidden"><NigraaniLogo theme="light" size="md" /></div><div className="mb-8"><p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#1b9582]">Demo access portal</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-[#173e49]">Choose an authorized workspace</h2><p className="mt-3 max-w-lg text-sm leading-6 text-[#70888a]">Each demo account opens only the dashboard, data scope, and actions allowed for that role.</p></div><div className="grid gap-2 sm:grid-cols-2">{DEMO_ACCOUNTS.map(item => { const definition = ROLE_DEFINITIONS[item.role]; const active = selectedRole === item.role; const Icon = roleHighlights[item.role].icon; return <button key={item.role} onClick={() => selectRole(item.role)} className={`group rounded-2xl border p-4 text-left transition ${active ? "border-[#26a68e] bg-white shadow-[0_10px_28px_rgba(21,123,118,0.12)]" : "border-[#dce9e5] bg-white/60 hover:border-[#a8d5ca] hover:bg-white"}`}><div className="flex items-start justify-between gap-2"><span className={`grid h-9 w-9 place-items-center rounded-xl ${active ? "bg-[#dff5ed] text-[#148774]" : "bg-[#edf4f1] text-[#718b8b]"}`}><Icon className="h-4 w-4" /></span>{active && <span className="grid h-5 w-5 place-items-center rounded-full bg-[#16a37f] text-white"><Check className="h-3 w-3" /></span>}</div><p className="mt-3 text-xs font-bold leading-5 text-[#214c56]">{definition.shortLabel}</p><p className="mt-1 text-[10px] leading-4 text-[#789092]">{definition.scopeLabel}</p></button>; })}</div><form onSubmit={event => { event.preventDefault(); loginMutation.mutate({ username, password }); }} className="mt-6 rounded-3xl border border-[#dce9e5] bg-white p-5 shadow-[0_12px_40px_rgba(31,82,77,0.06)]"><div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-bold text-[#214c56]">{ROLE_DEFINITIONS[selectedRole].label}</p><p className="mt-1 text-[11px] text-[#819696]">Demo credentials only</p></div><LockKeyhole className="h-4 w-4 text-[#80aaa4]" /></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-[#4e6d70]">Username<input value={username} onChange={event => setUsername(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#dce9e5] bg-[#fbfdfc] px-3 text-sm font-medium text-[#214c56] outline-none transition focus:border-[#24a88e] focus:ring-4 focus:ring-[#24a88e]/10" /></label><label className="text-xs font-semibold text-[#4e6d70]">Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#dce9e5] bg-[#fbfdfc] px-3 text-sm font-medium text-[#214c56] outline-none transition focus:border-[#24a88e] focus:ring-4 focus:ring-[#24a88e]/10" /></label></div><Button disabled={loginMutation.isPending} className="mt-5 h-11 w-full rounded-xl bg-[#0d8f7b] text-sm font-semibold shadow-lg shadow-[#0d8f7b]/15 hover:bg-[#0b7c6d]">{loginMutation.isPending ? "Opening workspace…" : "Continue to dashboard"}<ChevronRight className="ml-2 h-4 w-4" /></Button></form><p className="mt-5 text-center text-[10px] leading-5 text-[#829696]">Prototype environment · Credentials are shown for demo use and do not represent production access.</p></div></section>
      </div>
    </div>
  );
}

function WorkspaceHeading({ definition, userName, activeKey, role }: { definition: typeof ROLE_DEFINITIONS[RoleKey]; userName: string | null; activeKey: string; role: RoleKey }) {
  const navLabel = definition.nav.find(item => item.key === activeKey)?.label ?? "Overview";
  const exportQuery = trpc.monitoring.getExportData.useQuery(undefined, { enabled: false });
  const exportPdfMutation = trpc.monitoring.exportWorkspacePdf.useMutation({
    onSuccess: data => {
      downloadBase64Pdf(data.base64, data.filename);
      toast.success("Workspace report downloaded", { description: data.filename });
    },
    onError: err => toast.error("Failed to generate Workspace PDF", { description: err.message }),
  });

  const handleExportCsv = async () => {
    const result = await exportQuery.refetch();
    const data = result.data;
    if (!data || !data.rows.length) { return; }
    const ts = new Date().toISOString().slice(0, 10);
    downloadCsv(data.rows as Record<string, unknown>[], `nigraani_${data.scope}_export_${ts}.csv`);
  };

  const handleExportPdf = () => {
    exportPdfMutation.mutate({ scope: role });
  };

  return (
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#71908f]">
          <span>Workspace</span><span className="text-[#b4c8c4]">/</span><span className="text-[#158474]">{navLabel}</span>
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-[#173e49]">Good morning, {userName?.split(" ")[0] ?? "reviewer"}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#779092]">{definition.question}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-[#dcebe5] bg-white px-3 py-2 text-[11px] font-semibold text-[#567476]">
          Live data · {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </span>
        <Button
          id="export-view-csv-btn"
          onClick={handleExportCsv}
          disabled={exportQuery.isFetching}
          variant="outline"
          className="h-9 rounded-xl border-[#dcebe5] bg-white text-xs font-semibold text-[#3f676c] shadow-sm hover:bg-[#f7fbf9]"
        >
          {exportQuery.isFetching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
          Export CSV
        </Button>
        <Button
          id="export-view-pdf-btn"
          onClick={handleExportPdf}
          disabled={exportPdfMutation.isPending}
          variant="outline"
          className="h-9 rounded-xl border-[#0d8f7b]/20 bg-[#effaf6] text-xs font-semibold text-[#148774] shadow-sm hover:bg-[#e4f6f0]"
        >
          {exportPdfMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1.5 h-3.5 w-3.5" />}
          Export PDF
        </Button>
      </div>
    </div>
  );
}

function Overview({
  snapshot,
  role,
  onPrimary,
  onSelect,
  onUpdate,
  onNavigate,
}: {
  snapshot: DashboardSnapshot;
  role: RoleKey;
  onPrimary: () => void;
  onSelect: (row: TableRow) => void;
  onUpdate?: (row: TableRow) => void;
  onNavigate?: (key: string) => void;
}) {
  const config = roleAction[role];
  const highlight = roleHighlights[role];
  const Icon = highlight.icon;
  const signalCount = snapshot.signalStats
    ? (snapshot.signalStats.duplicateWork.count + snapshot.signalStats.fundMovement.count + snapshot.signalStats.delayRisk.count + snapshot.signalStats.evidenceReuse.count)
    : (role === "cag" ? 12 : 5);
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[26px] bg-[#0b5262] p-6 text-white shadow-[0_14px_38px_rgba(12,87,96,0.15)] sm:p-8">
        <div className="absolute -right-14 -top-20 h-64 w-64 rounded-full border-[24px] border-white/5" />
        <div className="absolute right-36 bottom-[-100px] h-48 w-48 rounded-full border-[18px] border-[#23a78e]/15" />
        <div className="relative max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#b5e8d9]">
            <WandSparkles className="h-3 w-3" /> {snapshot.hero.eyebrow}
          </div>
          <h2 className="mt-5 max-w-3xl text-2xl font-semibold leading-tight tracking-[-0.035em] sm:text-3xl">
            {snapshot.hero.title}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#b6d9d5]">
            {snapshot.hero.description}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {role === "district" && snapshot.rows[0] && onUpdate && (
              <Button
                onClick={() => onUpdate(snapshot.rows[0])}
                className="h-10 rounded-xl bg-[#f2c96b] px-4 text-xs font-bold text-[#4b3a1c] shadow-lg shadow-black/10 hover:bg-[#f7d88b] flex items-center gap-1.5"
              >
                <Activity className="h-4 w-4" /> Update Execution ({snapshot.rows[0].id})
              </Button>
            )}
            <Button onClick={onPrimary} className="h-10 rounded-xl bg-[#f2c96b] px-4 text-xs font-bold text-[#4b3a1c] shadow-lg shadow-black/10 hover:bg-[#f7d88b]">
              {config.label}<ArrowUpRight className="ml-2 h-3.5 w-3.5" />
            </Button>
            <Button onClick={() => onSelect(snapshot.rows[0])} variant="outline" className="h-10 rounded-xl border-white/20 bg-white/10 px-4 text-xs font-semibold text-white hover:bg-white/15 hover:text-white">
              Open priority queue
            </Button>
          </div>
        </div>
        <div className="relative mt-8 grid max-w-2xl grid-cols-3 gap-3 border-t border-white/15 pt-5 sm:absolute sm:bottom-8 sm:right-8 sm:mt-0 sm:w-[290px] sm:border-t-0 sm:pt-0">
          <HeroMetric label="Flagged" value={String(snapshot.risk.high)} detail="active high-risk" />
          <HeroMetric label="In view" value={String(snapshot.risk.total)} detail="authorized records" />
          <HeroMetric label="Signals" value={String(signalCount)} detail="need review" />
        </div>
      </section>
      <KpiGrid kpis={snapshot.kpis} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <RiskCard risk={snapshot.risk} />
        <FocusCard focus={snapshot.focus} icon={Icon} accent={highlight.accent} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <ScopedProjectTable rows={snapshot.rows} role={role} activeKey="overview" onSelect={onSelect} onUpdate={onUpdate} />
        <ActivityCard items={snapshot.activities} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function ModuleView({
  snapshot,
  definition,
  activeKey,
  role,
  onSelect,
  onPrimary,
  onUpdate,
  onManageCase,
  onNavigate,
  onRecordFinding,
}: {
  snapshot: DashboardSnapshot;
  definition: typeof ROLE_DEFINITIONS[RoleKey];
  activeKey: string;
  role: RoleKey;
  onSelect: (row: TableRow) => void;
  onPrimary: () => void;
  onUpdate?: (row: TableRow) => void;
  onManageCase?: (info: { projectCode: string; title: string; caseNumber?: string }) => void;
  onNavigate?: (key: string) => void;
  onRecordFinding?: (projectCode?: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");

  const label = definition.nav.find(item => item.key === activeKey)?.label ?? "Monitoring";
  const isAi = activeKey === "ai" || activeKey === "risk";
  const isWorkflow = ["recommendations", "recommend", "corrective", "clarifications", "findings", "followup", "planning"].includes(activeKey);
  const showCasesRegister = activeKey === "ai" || activeKey === "corrective" || activeKey === "clarifications" || activeKey === "findings";

  const filteredRows = useMemo(() => {
    return snapshot.rows.filter(r => {
      if (statusFilter === "High Risk" && r.risk < 71) return false;
      if (statusFilter !== "All statuses" && statusFilter !== "High Risk" && r.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches = r.id.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || r.region.toLowerCase().includes(q) || r.status.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [snapshot.rows, statusFilter, searchQuery]);

  return (
    <div className="space-y-5">
      <section className="rounded-[24px] border border-[#dfeae6] bg-white p-6 shadow-[0_10px_30px_rgba(31,82,77,0.05)]">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#6d8c8c]">
              <span>Role workspace</span><span className="text-[#b4c8c4]">/</span><span className="text-[#158474]">{label}</span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-[#173e49]">{moduleTitle(activeKey, label)}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#789092]">
              {isAi
                ? "AI signals are explainable triage indicators. Review the affected record, evidence, response, and action history before changing status."
                : isWorkflow
                ? "Keep each handoff explicit, scoped to the authorized role, and recorded in the centralized audit trail."
                : definition.purpose}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {role === "district" && snapshot.rows[0] && onUpdate && (
              <Button
                onClick={() => onUpdate(snapshot.rows[0])}
                className="h-10 shrink-0 rounded-xl bg-[#0d8f7b] px-3.5 text-xs font-semibold text-white hover:bg-[#0b7c6d] shadow-sm flex items-center gap-1.5"
              >
                <Activity className="h-3.5 w-3.5" /> Update Execution
              </Button>
            )}
            <Button onClick={onPrimary} className="h-10 shrink-0 rounded-xl border border-[#0d8f7b]/20 bg-[#effaf6] text-xs font-semibold text-[#148774] hover:bg-[#e4f6f0]">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> {roleAction[role].label}
            </Button>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ab0af]" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by ID, project, district, or status"
              className="h-11 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] pl-10 pr-3 text-sm text-[#315a60] outline-none focus:border-[#34a995] focus:ring-4 focus:ring-[#34a995]/10"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-11 rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-semibold text-[#547174] outline-none"
          >
            <option value="All statuses">All statuses</option>
            <option value="Recommended">Recommended</option>
            <option value="Active">Active</option>
            <option value="Delayed">Delayed</option>
            <option value="Completed">Completed</option>
            <option value="High Risk">High Risk</option>
          </select>
          <Button variant="outline" className="h-11 rounded-xl border-[#dfeae6] bg-white text-xs font-semibold text-[#547174]">
            <FileClock className="mr-2 h-3.5 w-3.5" /> Filter saved
          </Button>
        </div>
      </section>

      {activeKey === "recommend" && role === "mp" && (
        <div className="rounded-[24px] border border-[#dcebe5] bg-white p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#7d5bb5]">
                <PlusCircle className="h-4 w-4" />
                <span>MP Work Recommendation Center</span>
              </div>
              <h3 className="mt-2 text-xl font-bold text-[#173e49]">Submit Public Work Recommendation</h3>
              <p className="mt-1 max-w-xl text-xs text-[#789092]">
                As Member of Parliament, you are authorized to recommend works for implementation in your constituency. The District Authority will receive, scrutinize, and sanction eligible works.
              </p>
            </div>
            <Button
              onClick={onPrimary}
              className="h-11 rounded-xl bg-[#7d5bb5] px-5 text-xs font-bold text-white hover:bg-[#6e4da5] shadow-md flex items-center gap-2 shrink-0"
            >
              <PlusCircle className="h-4 w-4" /> Recommend Work
            </Button>
          </div>
        </div>
      )}

      {/* CAG Audit & Assurance dedicated views */}
      {role === "cag" && activeKey === "planning" && (
        <AuditPlanningSection snapshot={snapshot} onSelect={onSelect} onRecordFinding={onRecordFinding} />
      )}
      {role === "cag" && (activeKey === "risk" || activeKey === "ai") && (
        <CagRiskAssessmentSection snapshot={snapshot} onSelect={onSelect} onRecordFinding={onRecordFinding} />
      )}
      {role === "cag" && (activeKey === "findings" || activeKey === "recommendations") && (
        <AuditFindingsSection snapshot={snapshot} onSelect={onSelect} onRecordFinding={onRecordFinding} />
      )}
      {role === "cag" && activeKey === "followup" && (
        <ActionFollowupView role={role} />
      )}
      {role === "cag" && activeKey === "evidence" && (
        <EvidenceRegisterView role={role} />
      )}

      {/* Non-CAG standard views */}
      {role !== "cag" && isAi && <AlertCallout role={role} />}
      {role !== "cag" && showCasesRegister && onManageCase && <CasesRegister onManageCase={onManageCase} role={role} />}
      {role !== "cag" && isWorkflow && <WorkflowStepper items={snapshot.workflow} />}
      {activeKey === "finance" && <FinancialStrip snapshot={snapshot} />}
      {activeKey === "compliance" && <ComplianceCards role={role} />}
      {activeKey === "admin" && <AdminNotice />}
      {activeKey === "reports" && <ReportsSection role={role} />}
      {activeKey === "audit" && <AuditTrailView role={role} />}

      {/* Table view for non-custom tabs */}
      {activeKey !== "audit" &&
        activeKey !== "reports" &&
        activeKey !== "admin" &&
        !(role === "cag" && ["planning", "risk", "ai", "findings", "recommendations", "followup", "evidence"].includes(activeKey)) && (
          <ScopedProjectTable
            rows={filteredRows}
            role={role}
            activeKey={activeKey}
            onSelect={onSelect}
            onUpdate={onUpdate}
            onManageCase={onManageCase}
          />
        )}
    </div>
  );
}

function moduleTitle(activeKey: string, label: string) {
  const titles: Record<string, string> = {
    overview: "Your authorized monitoring view",
    risk: "AI Risk Assessment — For Audit Review",
    ai: "AI Risk & Anomalies",
    recommendations: "Recommendation processing queue",
    recommend: "Submit a new work recommendation",
    corrective: "Corrective actions and deadlines",
    clarifications: "Clarifications requiring response",
    findings: "Audit findings register",
    followup: "Management response follow-up",
    planning: "Plan and scope assurance work",
    evidence: "Evidence and document register",
    finance: "Financial monitoring",
    compliance: "Compliance posture",
    reports: "Reports and status summaries",
    admin: "System administration",
    audit: "Centralized Immutable Audit Trail",
  };
  return titles[activeKey] ?? label;
}

function KpiGrid({ kpis }: { kpis: DashboardSnapshot["kpis"] }) { return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{kpis.slice(0, 10).map((kpi, index) => <KpiCard key={`${kpi.label}-${index}`} kpi={kpi} />)}</div>; }
function KpiCard({ kpi }: { kpi: DashboardSnapshot["kpis"][number] }) { const styles = { teal: "bg-[#effaf5] text-[#168873]", amber: "bg-[#fff7e8] text-[#bd7b1e]", red: "bg-[#fff0f1] text-[#c2525b]", blue: "bg-[#eef5fb] text-[#3476a5]", slate: "bg-[#f1f5f4] text-[#638080]" }; return <div className="rounded-2xl border border-[#e1ebe7] bg-white p-4 shadow-[0_8px_24px_rgba(31,82,77,0.035)]"><div className="flex items-start justify-between gap-3"><p className="text-[10px] font-bold uppercase leading-4 tracking-[0.12em] text-[#789092]">{kpi.label}</p><span className={`rounded-lg px-2 py-1 text-[9px] font-bold ${styles[kpi.tone]}`}>{kpi.tone === "red" ? "Review" : "Live"}</span></div><p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[#173e49]">{kpi.value}</p><p className="mt-1 text-[11px] text-[#819696]">{kpi.detail}</p></div>; }
function HeroMetric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#8ecdc0]">{label}</p><p className="mt-1 text-2xl font-semibold tracking-tight text-white">{value}</p><p className="text-[10px] text-[#9ccac5]">{detail}</p></div>; }
function RiskCard({ risk }: { risk: DashboardSnapshot["risk"] }) { const total = risk.high + risk.medium + risk.low; const highPct = (risk.high / total) * 100; const medPct = (risk.medium / total) * 100; return <div className="rounded-[24px] border border-[#e1ebe7] bg-white p-5 shadow-[0_8px_24px_rgba(31,82,77,0.035)]"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#789092]">Portfolio pulse</p><h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">Risk distribution</h3><p className="mt-1 text-xs text-[#8a9b9c]">Projects grouped by current explainable risk score</p></div><span className="text-xs font-semibold text-[#718b8b]">{risk.total} total</span></div><div className="mt-6 grid gap-6 sm:grid-cols-[1fr_170px] sm:items-center"><div className="space-y-5"><RiskBar label="High risk" range="71–100 · immediate review" value={risk.high} total={risk.total} color="#d45462" /><RiskBar label="Medium risk" range="31–70 · watchlist" value={risk.medium} total={risk.total} color="#e7a536" /><RiskBar label="Low risk" range="0–30 · within benchmark" value={risk.low} total={risk.total} color="#1aa67f" /></div><div className="mx-auto grid h-36 w-36 place-items-center rounded-full" style={{ background: `conic-gradient(#d45462 0 ${highPct}%, #e7a536 ${highPct}% ${highPct + medPct}%, #1aa67f ${highPct + medPct}% 100%)` }}><div className="grid h-24 w-24 place-items-center rounded-full bg-white"><div className="text-center"><p className="text-2xl font-semibold text-[#214c56]">{risk.total}</p><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8ca2a1]">records</p></div></div></div></div></div>; }
function RiskBar({ label, range, value, total, color }: { label: string; range: string; value: number; total: number; color: string }) { return <div><div className="flex items-end justify-between"><div><p className="text-xs font-bold text-[#315a60]">{label}</p><p className="mt-1 text-[10px] text-[#8a9b9c]">{range}</p></div><span className="text-lg font-semibold text-[#315a60]">{value}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#edf3f0]"><div className="h-full rounded-full" style={{ width: `${(value / total) * 100}%`, background: color }} /></div></div>; }
function FocusCard({ focus, icon: Icon, accent }: { focus: DashboardSnapshot["focus"]; icon: typeof Sparkles; accent: string }) { return <div className="rounded-[24px] border border-[#e1ebe7] bg-[#f7fbf9] p-5"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#789092]">Attention map</p><h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">What needs attention</h3></div><span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: `${accent}16`, color: accent }}><Icon className="h-4 w-4" /></span></div><div className="mt-5 space-y-3">{focus.map(item => <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl border border-[#e5efeb] bg-white p-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8a9b9c]">{item.label}</p><p className="mt-1 text-sm font-bold text-[#315a60]">{item.value}</p></div><p className="max-w-[130px] text-right text-[10px] leading-4 text-[#839696]">{item.detail}</p></div>)}</div></div>; }
// ── Scoped Project Table (State vs District vs Works) ─────────────────────────
function ScopedProjectTable({
  rows,
  role,
  activeKey,
  onSelect,
  onUpdate,
  onManageCase,
}: {
  rows: TableRow[];
  role: RoleKey;
  activeKey: string;
  onSelect: (row: TableRow) => void;
  onUpdate?: (row: TableRow) => void;
  onManageCase?: (info: { projectCode: string; title: string; caseNumber?: string }) => void;
}) {
  const isStateScope = role === "state" || activeKey === "states" || activeKey === "districts";
  const isDistrictScope = role === "district" || activeKey === "physical" || activeKey === "evidence";
  const isWorksScope = activeKey === "projects" || role === "mospi";

  // State-level district aggregation calculation
  const districtAggregation = useMemo(() => {
    if (!isStateScope) return [];
    const map = new Map<string, { name: string; count: number; delayed: number; totalProgress: number }>();
    rows.forEach(r => {
      const dist = r.region.split(",")[0].trim() || "District";
      const existing = map.get(dist) || { name: dist, count: 0, delayed: 0, totalProgress: 0 };
      existing.count += 1;
      if (r.status === "Delayed") existing.delayed += 1;
      existing.totalProgress += r.progress;
      map.set(dist, existing);
    });
    return Array.from(map.values());
  }, [rows, isStateScope]);

  return (
    <div className="rounded-[24px] border border-[#e1ebe7] bg-white p-5 shadow-[0_8px_24px_rgba(31,82,77,0.035)]">
      {/* Scope Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.17em] text-[#789092]">
            <span>
              {isStateScope
                ? "State Oversight Scope · District Aggregation"
                : isDistrictScope
                ? "District Execution Scope · Operational Monitoring"
                : "Project Works Scope · Individual Works Dossiers"}
            </span>
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">
            {isStateScope
              ? "State-Level District Comparison & Monitoring"
              : isDistrictScope
              ? "District Field Execution & Physical Milestones"
              : "MPLADS Individual Project & Work Records"}
          </h3>
          <p className="mt-1 text-xs text-[#8a9b9c]">
            {isStateScope
              ? "Aggregated cross-district performance, compliance, and oversight posture."
              : isDistrictScope
              ? "Live execution progress, expenditure vouchers, site photos, and verification."
              : "Comprehensive work identifiers, financial allocation, utilization, and AI triage."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDistrictScope && rows[0] && onUpdate && (
            <Button
              onClick={() => onUpdate(rows[0])}
              className="h-8 rounded-lg bg-[#0d8f7b] px-3 text-[10px] font-semibold text-white hover:bg-[#0b7c6d] shadow-sm flex items-center gap-1"
            >
              <Activity className="h-3 w-3" /> Update Execution
            </Button>
          )}
        </div>
      </div>

      {/* State-Level District Comparison Summary Strip */}
      {isStateScope && districtAggregation.length > 0 && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {districtAggregation.slice(0, 4).map(d => (
            <div key={d.name} className="rounded-xl border border-[#dce9e5] bg-[#f7fbf9] p-2.5">
              <p className="text-[10px] font-bold text-[#168873] uppercase tracking-wider">{d.name}</p>
              <p className="mt-1 text-sm font-bold text-[#214c56]">{d.count} Works</p>
              <p className="text-[10px] text-[#789092]">
                Avg progress: <span className="font-semibold text-[#168873]">{Math.round(d.totalProgress / d.count)}%</span>
                {d.delayed > 0 && <span className="ml-1 text-[#bd7b1e]">· {d.delayed} delayed</span>}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* District Execution Progress Strip */}
      {isDistrictScope && (
        <div className="mt-4 rounded-xl border border-[#ceeae1] bg-[#eff9f6] p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#0d8f7b]" />
            <span className="font-bold text-[#168873]">Operational Authority Scope:</span>
            <span className="text-[#315a60]">Physical progress updates & evidence upload enabled for District.</span>
          </div>
          <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-[#168873] border border-[#a8d5ca]">
            {rows.length} Active Works
          </span>
        </div>
      )}

      {/* Shared Reusable Table with Scope-Tailored Columns */}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[700px] text-left">
          <thead>
            <tr className="border-b border-[#edf2ef] text-[9px] font-bold uppercase tracking-[0.14em] text-[#8aa09f]">
              <th className="pb-3 pr-4">Work / Project</th>
              <th className="pb-3 pr-4">Location</th>
              <th className="pb-3 pr-4">Progress & Status</th>
              {isWorksScope && <th className="pb-3 pr-4">Expenditure</th>}
              <th className="pb-3 pr-4">Risk & AI Triage</th>
              <th className="pb-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className="border-b border-[#f0f4f2] last:border-0 hover:bg-[#fafcfb]">
                <td className="py-3.5 pr-4">
                  <button onClick={() => onSelect(row)} className="text-left group cursor-pointer">
                    <p className="text-xs font-bold text-[#315a60] transition group-hover:text-[#118b79]">{row.title}</p>
                    <p className="mt-0.5 text-[10px] text-[#8a9b9c] font-mono">{row.id} · {row.amount}</p>
                  </button>
                </td>
                <td className="py-3.5 pr-4 text-xs font-medium text-[#5c797a]">{row.region}</td>
                <td className="py-3.5 pr-4">
                  <div className="flex min-w-[100px] items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-[#edf3f0]">
                      <div className="h-full rounded-full bg-[#2aa98d]" style={{ width: `${row.progress}%` }} />
                    </div>
                    <span className="text-[10px] font-semibold text-[#688384]">{row.progress}%</span>
                  </div>
                  <span className={`mt-0.5 inline-block text-[9px] font-bold px-1.5 py-0.2 rounded ${
                    row.status === "Delayed" ? "bg-[#fff7e8] text-[#bd7b1e]" : row.status === "Completed" ? "bg-[#effaf5] text-[#168873]" : row.status === "Recommended" ? "bg-[#f5eefc] text-[#7d5bb5]" : "bg-[#eef5fb] text-[#3476a5]"
                  }`}>{row.status}</span>
                </td>
                {isWorksScope && (
                  <td className="py-3.5 pr-4 text-xs font-mono text-[#4e6d70]">
                    {row.spent ? (
                      <div>
                        <span>{row.spent}</span>
                        <span className="block text-[9px] text-[#8a9b9c]">spent</span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-[#8a9b9c] italic">Pending</span>
                    )}
                  </td>
                )}
                <td className="py-3.5 pr-4"><RiskBadge risk={row.risk} /></td>
                <td className="py-3.5">
                  <div className="flex items-center gap-1.5">
                    <Button onClick={() => onSelect(row)} variant="outline" className="h-7 rounded-lg border-[#dfeae6] bg-white px-2.5 text-[10px] font-semibold text-[#4f7273] hover:bg-[#f0f6f3]">
                      View Dossier
                    </Button>
                    {isDistrictScope && onUpdate && (
                      <Button
                        onClick={() => onUpdate(row)}
                        className="h-7 rounded-lg bg-[#0d8f7b] px-2.5 text-[10px] font-semibold text-white hover:bg-[#0b7c6d] shadow-sm flex items-center gap-1"
                      >
                        <Activity className="h-3 w-3" />
                        Update
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function RiskBadge({ risk }: { risk: number }) { const high = risk >= 71; const medium = risk >= 31 && !high; return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${high ? "bg-[#fff0f1] text-[#c2525b]" : medium ? "bg-[#fff7e8] text-[#bd7b1e]" : "bg-[#effaf5] text-[#168873]"}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{high ? "High" : medium ? "Medium" : "Low"} · {risk}</span>; }
function ActivityCard({ items, onNavigate }: { items: DashboardSnapshot["activities"]; onNavigate?: (key: string) => void }) {
  return (
    <div className="rounded-[24px] border border-[#e1ebe7] bg-white p-5 shadow-[0_8px_24px_rgba(31,82,77,0.035)]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#789092]">Activity</p>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">Recent audit events</h3>
        </div>
        <HistoryIcon />
      </div>
      <div className="mt-5 space-y-4">
        {items.map(item => (
          <div key={`${item.ref}-${item.label}`} className="flex gap-3">
            <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.tone === "red" ? "bg-[#d45462]" : item.tone === "amber" ? "bg-[#e7a536]" : item.tone === "blue" ? "bg-[#4b93c2]" : "bg-[#1aa67f]"}`} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#315a60]">{item.label}</p>
              <p className="mt-1 truncate text-[10px] text-[#8a9b9c]">{item.ref} · {item.person}</p>
              <p className="mt-1 text-[10px] text-[#a7b5b3]">{item.date}</p>
            </div>
          </div>
        ))}
      </div>
      <Button
        onClick={() => onNavigate?.("audit")}
        variant="ghost"
        className="mt-4 h-8 w-full rounded-lg text-[11px] font-semibold text-[#138978] hover:bg-[#eff9f5]"
      >
        See full trail <ArrowUpRight className="ml-1 h-3 w-3" />
      </Button>
    </div>
  );
}
function HistoryIcon() { return <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#eef7f4] text-[#198c78]"><FileClock className="h-4 w-4" /></span>; }
function PermissionsCard({ definition, role }: { definition: typeof ROLE_DEFINITIONS[RoleKey]; role: RoleKey }) { return <div className="rounded-[24px] border border-[#dcebe5] bg-[#eff8f5] p-5"><div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#168873] shadow-sm"><ShieldAlert className="h-4 w-4" /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#6f8f8e]">Authority boundary</p><h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">What this role can do</h3></div></div><div className="mt-5 space-y-2">{definition.permissions.map(permission => <div key={permission} className="flex items-start gap-2 text-xs leading-5 text-[#4d7474]"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1ca27f]" />{permission}</div>)}</div>{role === "mp" && <p className="mt-5 rounded-xl border border-[#eadfbf] bg-[#fff9e8] p-3 text-[11px] font-semibold leading-5 text-[#886b2c]">MP role is recommendation and monitoring, not project execution or financial administration.</p>}{role === "cag" && <p className="mt-5 rounded-xl border border-[#e8dce2] bg-[#fff7fa] p-3 text-[11px] font-semibold leading-5 text-[#80566b]">Independent assurance layer. No sanction, execution, operational correction, or project-data editing.</p>}</div>; }
function SignalLegend({ role, signalStats }: { role: RoleKey; signalStats?: DashboardSnapshot["signalStats"] }) {
  const signalItems = [
    { label: "Duplicate work · semantic similarity", pct: signalStats?.duplicateWork.percentageText ?? "0.0%" },
    { label: "Fund movement · isolation forest", pct: signalStats?.fundMovement.percentageText ?? "0.0%" },
    { label: "Delay risk · random forest", pct: signalStats?.delayRisk.percentageText ?? "0.0%" },
    { label: "Evidence reuse · image similarity", pct: signalStats?.evidenceReuse.percentageText ?? "0.0%" },
  ];
  return (
    <div className="rounded-[24px] border border-[#e1ebe7] bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#fff7e8] text-[#c48726]"><Sparkles className="h-4 w-4" /></span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#789092]">Nigraani AI</p>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">Explainable signals</h3>
        </div>
      </div>
      <p className="mt-4 text-xs leading-6 text-[#718889]">The risk engine combines anomaly modules into a 0–100 triage score. A high score means a case deserves timely human verification, not that misconduct has been established.</p>
      <div className="mt-4 space-y-2">
        {signalItems.map(item => (
          <div key={item.label} className="flex items-center justify-between rounded-xl bg-[#f8fbf9] px-3 py-2">
            <span className="text-[10px] font-semibold text-[#5d7a7b]">{item.label}</span>
            <span className="text-[10px] font-bold text-[#1a987f]">{item.pct}</span>
          </div>
        ))}
      </div>
      {role === "cag" && <div className="mt-4 flex gap-2 rounded-xl bg-[#f7f1f4] p-3 text-[10px] leading-4 text-[#825c6c]"><Info className="h-3.5 w-3.5 shrink-0" /> Audit access exposes indicators for planning and evidence assessment; it cannot manipulate AI scores or alerts.</div>}
    </div>
  );
}
function ActionPrompt({ prompt, onCancel, onSubmit, pending }: { prompt: { action: PermissionAction; target: string; label: string; comments: string }; onCancel: () => void; onSubmit: (comments: string) => void; pending: boolean }) { const [comments, setComments] = useState(prompt.comments); return <div className="rounded-[24px] border border-[#bfe2d7] bg-white p-5 shadow-[0_10px_30px_rgba(31,82,77,0.08)]"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#178b78]">Confirm authorized action</p><h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">{prompt.label}</h3><p className="mt-1 text-xs text-[#819696]">Target record · {prompt.target}</p></div><button onClick={onCancel} className="grid h-8 w-8 place-items-center rounded-lg text-[#8ca2a1] hover:bg-[#f0f6f3]" aria-label="Close"><X className="h-4 w-4" /></button></div><label className="mt-5 block text-xs font-semibold text-[#5b7779]">Action note<textarea value={comments} onChange={event => setComments(event.target.value)} className="mt-2 min-h-[96px] w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] p-3 text-xs leading-5 text-[#315a60] outline-none focus:border-[#2ba68e] focus:ring-4 focus:ring-[#2ba68e]/10" /></label><div className="mt-4 flex justify-end gap-2"><Button onClick={onCancel} variant="outline" className="h-9 rounded-xl border-[#dfeae6] bg-white text-xs font-semibold text-[#5c797a]">Cancel</Button><Button disabled={pending || comments.trim().length < 5} onClick={() => onSubmit(comments)} className="h-9 rounded-xl bg-[#0d8f7b] text-xs font-semibold text-white hover:bg-[#0b7c6d]">{pending ? "Recording…" : "Submit & record trail"}</Button></div></div>; }
function DetailPanel({
  row,
  role,
  onClose,
  onAction,
  onUpdateProject,
  onManageCase,
  onRecordFinding,
}: {
  row: TableRow;
  role: RoleKey;
  onClose: () => void;
  onAction: (action: PermissionAction) => void;
  onUpdateProject?: (row: TableRow) => void;
  onManageCase?: (info: { projectCode: string; title: string; caseNumber?: string }) => void;
  onRecordFinding?: (projectCode?: string) => void;
}) {
  const canRespond = canRolePerform(role, "respondToAiAlert");
  const canEvidence = role === "district" && canRolePerform(role, "addEvidence");
  const canUpdate = role === "district";
  const canVerify = role === "district" || role === "state" || role === "mospi";

  const updatesQuery = trpc.monitoring.getProjectUpdates.useQuery({ projectCode: row.id });
  const [previewEvidence, setPreviewEvidence] = useState<any>(null);
  const [evidenceToRemove, setEvidenceToRemove] = useState<any>(null);
  const [removalReason, setRemovalReason] = useState("");
  const utils = trpc.useUtils();

  const removeEvidenceMutation = trpc.monitoring.removeEvidence.useMutation({
    onSuccess: () => {
      toast.success("Evidence removed successfully. AI risk models re-evaluated.");
      setEvidenceToRemove(null);
      setRemovalReason("");
      utils.monitoring.getProjectUpdates.invalidate({ projectCode: row.id });
      utils.monitoring.snapshot.invalidate();
      utils.monitoring.getProjectDetail.invalidate({ projectCode: row.id });
    },
    onError: (err) => {
      toast.error(err.message || "Failed to remove evidence");
    },
  });

  const handleConfirmRemoval = () => {
    if (!evidenceToRemove) return;
    if (!removalReason.trim() || removalReason.trim().length < 3) {
      toast.error("Please provide a valid removal reason (minimum 3 characters)");
      return;
    }
    removeEvidenceMutation.mutate({
      evidenceId: evidenceToRemove.id,
      evidenceCode: evidenceToRemove.evidenceCode,
      removalReason: removalReason.trim(),
    });
  };

  const exportProjectPdfMutation = trpc.monitoring.exportProjectPdf.useMutation({
    onSuccess: data => {
      downloadBase64Pdf(data.base64, data.filename);
      toast.success("Project Dossier PDF downloaded", { description: data.filename });
    },
    onError: err => toast.error("Failed to generate Project PDF", { description: err.message }),
  });

  return (
    <div className="rounded-[24px] border border-[#dcebe5] bg-white p-5 shadow-[0_10px_30px_rgba(31,82,77,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#789092]">Record detail</p>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">{row.title}</h3>
          <p className="mt-1 text-[11px] text-[#819696]">{row.id} · {row.region}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            id="export-project-pdf-btn"
            onClick={() => exportProjectPdfMutation.mutate({ projectCode: row.id })}
            disabled={exportProjectPdfMutation.isPending}
            variant="outline"
            size="sm"
            className="h-8 rounded-lg border-[#dcebe5] bg-white text-[11px] font-semibold text-[#168873] hover:bg-[#effaf5] shadow-xs flex items-center gap-1"
            title="Export Project Dossier PDF"
          >
            {exportProjectPdfMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Export PDF
          </Button>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#8ca2a1] hover:bg-[#f0f6f3]" aria-label="Close detail">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {role === "district" && onUpdateProject && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-[#eff9f6] p-2.5 border border-[#ceeae1]">
          <span className="text-[11px] font-bold text-[#168873] flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" /> Authorized Execution:
          </span>
          <Button
            onClick={() => onUpdateProject(row)}
            className="h-8 rounded-lg bg-[#0d8f7b] px-3 text-[11px] font-semibold text-white hover:bg-[#0b7c6d] shadow-sm flex items-center gap-1.5"
          >
            <Activity className="h-3.5 w-3.5" />
            Update Execution
          </Button>
        </div>
      )}

      {role === "state" && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-[#eef7fb] p-2.5 border border-[#cbe4f2]">
          <span className="text-[11px] font-bold text-[#205d84] flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-[#2b7aa9]" /> State Oversight:
          </span>
          <span className="text-[10px] font-semibold text-[#487999] rounded-md bg-white/80 px-2 py-0.5 border border-[#bcdbf0]">
            Review & Monitoring Mode
          </span>
        </div>
      )}

      {role === "cag" && onRecordFinding && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-[#fff2f3] p-2.5 border border-[#fed7d7]">
          <span className="text-[11px] font-bold text-[#c2525b] flex items-center gap-1.5">
            <FileWarning className="h-3.5 w-3.5 text-[#c2525b]" /> Audit & Assurance:
          </span>
          <Button
            onClick={() => onRecordFinding(row.id)}
            className="h-8 rounded-lg bg-[#c2525b] px-3 text-[11px] font-semibold text-white hover:bg-[#a83d46] shadow-sm flex items-center gap-1.5"
          >
            <FileWarning className="h-3.5 w-3.5" />
            Record Audit Finding
          </Button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <DetailStat label="Status" value={row.status} />
        <DetailStat label="Risk score" value={`${row.risk} / 100`} />
        <DetailStat label="Physical progress" value={`${row.progress}%`} />
        <DetailStat label="Sanctioned amount" value={row.amount} />
        {row.spent && <DetailStat label="Spent amount" value={row.spent} />}
        <DetailStat label="Risk level" value={row.riskLevel || (row.risk >= 71 ? "High Risk" : row.risk >= 31 ? "Medium Risk" : "Low Risk")} />
      </div>
      <div className="mt-4 rounded-xl bg-[#f7fbf9] p-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#789092]">AI reasoning indicators</p>
        <p className="mt-2 text-xs leading-5 text-[#5d7a7b]">
          {row.aiReasoning || "All anomaly engines within baseline parameters. No anomalous variance detected."}
        </p>
        {row.anomalies && row.anomalies.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {row.anomalies.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-[#fff0f1] px-2 py-0.5 text-[9px] font-bold text-[#c2525b]">
                {a.moduleType.replace("_", " ")}: {(a.score * 100).toFixed(0)}% ({a.severity})
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Operational Execution Actions for Authorized Roles */}
      {canUpdate && onUpdateProject && (
        <div className="mt-4 pt-4 border-t border-[#edf3f0] flex flex-wrap gap-2">
          <Button
            onClick={() => onUpdateProject(row)}
            className="h-9 rounded-xl bg-[#0d8f7b] text-[11px] font-semibold text-white hover:bg-[#0b7c6d] shadow-sm"
          >
            <Activity className="mr-1.5 h-3.5 w-3.5" />
            Update execution
          </Button>
          {canVerify && onManageCase && (
            <Button
              onClick={() => onManageCase({ projectCode: row.id, title: row.title, caseNumber: `CASE-${row.id}` })}
              variant="outline"
              className="h-9 rounded-xl border-[#dcebe5] bg-white text-[11px] font-semibold text-[#168873] hover:bg-[#f0f9f6]"
            >
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              Human verification
            </Button>
          )}
        </div>
      )}

      {/* Operational Updates History */}
      {updatesQuery.data && updatesQuery.data.updates.length > 0 && (
        <div className="mt-4 rounded-xl border border-[#dcebe5] bg-[#fbfdfc] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#168873]">Operational Updates</p>
            <span className="rounded-md bg-[#e7f6f0] px-1.5 py-0.5 text-[8px] font-bold text-[#148774]">OPERATIONAL_UPDATE</span>
          </div>
          <div className="mt-2 space-y-2 max-h-36 overflow-y-auto pr-1">
            {updatesQuery.data.updates.slice().reverse().map((u, i) => (
              <div key={i} className="rounded-lg border border-[#eef4f1] bg-white p-2 text-xs">
                <div className="flex justify-between items-center text-[10px] text-[#789092]">
                  <span>{new Date(u.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {u.updatedBy}</span>
                  <span className="font-semibold text-[#168873]">Progress: {u.newProgress}%</span>
                </div>
                <p className="mt-1 text-[11px] font-medium text-[#315a60]">{u.updateType}</p>
                <p className="text-[10px] text-[#5d7a7b]">{u.remarks}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Uploaded Evidence */}
      {updatesQuery.data && updatesQuery.data.evidence.length > 0 && (
        <div className="mt-3 rounded-xl border border-[#e1ebe7] bg-[#fbfdfc] p-3.5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#789092]">Uploaded Evidence</p>
            <span className="rounded-md bg-[#e7f6f0] px-1.5 py-0.5 text-[8px] font-bold text-[#148774]">
              {updatesQuery.data.evidence.length} {updatesQuery.data.evidence.length === 1 ? "Record" : "Records"}
            </span>
          </div>
          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {updatesQuery.data.evidence.map((ev, i) => {
              const isImg = isImageEvidence(ev);
              const fileName = getEvidenceFileName(ev);
              const categoryLabel = formatEvidenceCategory(ev.category);
              const formattedDate = formatEvidenceTimestamp(ev.createdAt);
              const hasHash = !!ev.perceptualHash;

              return (
                <div
                  key={ev.id || i}
                  className="rounded-xl border border-[#e2ece8] bg-white p-3 shadow-xs hover:border-[#b9ded4] transition-colors"
                >
                  <div className="flex gap-3">
                    {/* Left: Thumbnail Preview or File Icon */}
                    {isImg ? (
                      <button
                        type="button"
                        onClick={() => setPreviewEvidence(ev)}
                        className="group relative flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-[#cbe2dc] bg-[#f4f9f7] focus:outline-none focus:ring-2 focus:ring-[#0d8f7b]"
                        title="Click to preview image"
                      >
                        {ev.fileUrl ? (
                          <img
                            src={ev.fileUrl}
                            alt={ev.title}
                            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-[#2a685e]">
                            <Camera className="h-6 w-6 text-[#168873]" />
                            <span className="mt-1 text-[8px] font-semibold uppercase text-[#5a807c]">Photo</span>
                          </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <ZoomIn className="h-4 w-4 text-white" />
                        </div>
                      </button>
                    ) : (
                      <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-lg border border-[#d6e4df] bg-[#f4f8f7] text-[#2a685e]">
                        <FileText className="h-7 w-7 text-[#0d8f7b]" />
                        <span className="mt-1 text-[8px] font-bold uppercase tracking-wider text-[#456b69]">DOC</span>
                      </div>
                    )}

                    {/* Right: Evidence Metadata */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#1f4e5b] leading-tight">
                            {categoryLabel}
                          </p>
                          <p className="font-mono text-[11px] font-medium text-[#2d555c] break-all leading-snug">
                            {fileName}
                          </p>
                        </div>
                        <span className="shrink-0 rounded bg-[#effaf5] px-1.5 py-0.5 text-[9px] font-bold text-[#168873] border border-[#d4ede4]">
                          Attached
                        </span>
                      </div>

                      {ev.title && (
                        <p className="mt-0.5 text-[10px] text-[#4f6f70] line-clamp-1 italic">
                          "{ev.title}"
                        </p>
                      )}

                      <div className="mt-1.5 space-y-0.5 text-[10px] text-[#6b8586]">
                        <p className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 shrink-0 text-[#8ca2a1]" />
                          <span>Attached: <strong className="font-semibold text-[#315a60]">{formattedDate}</strong></span>
                        </p>
                        <p className="flex items-center gap-1">
                          <UserCheck className="h-3 w-3 shrink-0 text-[#8ca2a1]" />
                          <span>Uploaded by: <strong className="font-semibold text-[#315a60]">{ev.uploadedBy || "District Nodal Officer"}</strong></span>
                        </p>
                        <p className="flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3 shrink-0 text-[#0d8f7b]" />
                          <span>64-bit dHash: <strong className="font-semibold text-[#0d8f7b]">{hasHash ? "Generated" : isImg ? "Pending" : "Not applicable (Document)"}</strong></span>
                        </p>
                      </div>

                      {/* Action Links */}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {isImg ? (
                            <button
                              type="button"
                              onClick={() => setPreviewEvidence(ev)}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#0d8f7b] hover:text-[#0a6f5f] hover:underline cursor-pointer"
                            >
                              <ZoomIn className="h-3 w-3" /> Preview Photo
                            </button>
                          ) : (
                            <a
                              href={ev.fileUrl && ev.fileUrl.startsWith("/") ? ev.fileUrl : `/uploads/evidence/${getEvidenceFileName(ev)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#0d8f7b] hover:text-[#0a6f5f] hover:underline cursor-pointer"
                            >
                              <ExternalLink className="h-3 w-3" /> Open / View Document
                            </a>
                          )}
                        </div>

                        {/* Remove Action - Only visible to District role */}
                        {role === "district" && (
                          <button
                            type="button"
                            onClick={() => {
                              setRemovalReason("");
                              setEvidenceToRemove(ev);
                            }}
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-[#b03e3e] hover:text-[#8a1c1c] hover:bg-[#fdf2f2] px-2 py-0.5 rounded border border-[#f3d1d1] transition-colors cursor-pointer"
                            title="Remove this execution evidence"
                          >
                            <Trash2 className="h-3 w-3 text-[#b03e3e]" /> Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Case Details */}
      {updatesQuery.data && updatesQuery.data.cases.length > 0 && (
        <div className="mt-3 rounded-xl border border-[#f1dfb6] bg-[#fffaf0] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#93651d]">Active Case Review</p>
            <span className="rounded-md bg-[#fbebc7] px-1.5 py-0.5 text-[9px] font-bold text-[#805f27]">
              {updatesQuery.data.cases[0].status}
            </span>
          </div>
          <p className="mt-1 text-[11px] font-semibold text-[#315a60]">{updatesQuery.data.cases[0].caseNumber}</p>
          <p className="text-[10px] text-[#789092]">
            Assigned Investigator: <span className="font-semibold text-[#315a60]">{updatesQuery.data.cases[0].assignedUser || "Unassigned"}</span>
          </p>
          {updatesQuery.data.cases[0].investigatorRemarks && (
            <div className="mt-1.5 rounded bg-white/80 p-1.5 text-[10px] text-[#556d6e] border border-[#fae2b1] max-h-16 overflow-y-auto">
              <p className="font-semibold text-[#785b24]">Remarks:</p>
              <p className="whitespace-pre-line">{updatesQuery.data.cases[0].investigatorRemarks}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {canUpdate && onUpdateProject && (
          <Button
            onClick={() => onUpdateProject(row)}
            className="h-9 rounded-xl bg-[#0d8f7b] text-[10px] font-semibold text-white hover:bg-[#0b7c6d] shadow-sm flex items-center gap-1.5"
          >
            <Activity className="h-3.5 w-3.5" /> Update Execution
          </Button>
        )}
        {canRespond && <Button onClick={() => onAction("respondToAiAlert")} className="h-9 rounded-xl bg-[#0d8f7b] text-[10px] font-semibold hover:bg-[#0b7c6d]"><MessageSquareMore className="mr-2 h-3.5 w-3.5" /> Respond to AI alert</Button>}
        {canEvidence && (
          <Button
            onClick={() => {
              if (canUpdate && onUpdateProject) {
                onUpdateProject(row);
              } else {
                onAction("addEvidence");
              }
            }}
            variant="outline"
            className="h-9 rounded-xl border-[#dfeae6] bg-white text-[10px] font-semibold text-[#4f7273]"
          >
            <UploadCloud className="mr-2 h-3.5 w-3.5" /> Attach evidence
          </Button>
        )}
        {role === "cag" && onRecordFinding && (
          <Button
            onClick={() => onRecordFinding(row.id)}
            className="h-9 rounded-xl bg-[#c2525b] text-[10px] font-semibold text-white hover:bg-[#a83d46] shadow-sm flex items-center gap-1.5"
          >
            <FileWarning className="mr-1.5 h-3.5 w-3.5" /> Record Audit Finding
          </Button>
        )}
        {!canRespond && !canEvidence && !canUpdate && role !== "cag" && <span className="inline-flex items-center gap-2 rounded-xl bg-[#f3f6f4] px-3 py-2 text-[10px] font-semibold text-[#708889]"><LockKeyhole className="h-3.5 w-3.5" /> Read-only within this role</span>}
      </div>

      {/* Lightbox / Preview Modal for Evidence */}
      {previewEvidence && (
        <Dialog open={!!previewEvidence} onOpenChange={open => { if (!open) setPreviewEvidence(null); }}>
          <DialogContent className="max-w-2xl overflow-hidden rounded-3xl bg-white p-0 shadow-2xl border border-[#d6e4df]">
            <DialogHeader className="border-b border-[#e5eeea] bg-[#fbfdfc] px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-xl bg-[#effaf5] p-2 text-[#0d8f7b] border border-[#d4ede4]">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div>
                    <DialogTitle className="text-base font-bold text-[#1f4e5b]">
                      {previewEvidence.title || "Evidence Preview"}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-[#6b8586]">
                      {formatEvidenceCategory(previewEvidence.category)} · {getEvidenceFileName(previewEvidence)}
                    </DialogDescription>
                  </div>
                </div>
                <span className="rounded-md bg-[#effaf5] px-2 py-0.5 text-[10px] font-bold text-[#168873] border border-[#d4ede4]">
                  Attached Evidence
                </span>
              </div>
            </DialogHeader>

            <div className="flex max-h-[60vh] items-center justify-center bg-[#09151c] p-3">
              {previewEvidence.fileUrl ? (
                <img
                  src={previewEvidence.fileUrl}
                  alt={previewEvidence.title}
                  className="max-h-[55vh] max-w-full rounded-lg object-contain shadow-lg"
                />
              ) : (
                <div className="py-12 text-center text-white/70">
                  <Camera className="mx-auto h-12 w-12 text-white/40 mb-2" />
                  <p className="text-sm font-semibold">{previewEvidence.title}</p>
                  <p className="text-xs text-white/50 mt-1">{previewEvidence.filePath}</p>
                </div>
              )}
            </div>

            <div className="border-t border-[#e5eeea] bg-[#fbfdfc] px-6 py-4">
              <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[#8ca2a1]">Evidence Type</span>
                  <span className="font-semibold text-[#1f4e5b]">{formatEvidenceCategory(previewEvidence.category)}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[#8ca2a1]">Attached On</span>
                  <span className="font-semibold text-[#315a60]">{formatEvidenceTimestamp(previewEvidence.createdAt)}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[#8ca2a1]">Uploaded By</span>
                  <span className="font-semibold text-[#1f4e5b]">{previewEvidence.uploadedBy || "District Nodal Officer"}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[#8ca2a1]">64-bit dHash</span>
                  <span className="font-mono text-[11px] font-semibold text-[#0d8f7b]">
                    {previewEvidence.perceptualHash ? "Generated" : isImageEvidence(previewEvidence) ? "Pending" : "N/A (Document)"}
                  </span>
                </div>
              </div>

              {previewEvidence.fileUrl && (
                <div className="mt-4 flex items-center justify-between border-t border-[#eaf2ef] pt-3">
                  <span className="text-[10px] text-[#789092]">Project Reference: {row.id}</span>
                  <a
                    href={previewEvidence.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0d8f7b] hover:text-[#0b7867] hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open original image in new tab
                  </a>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Evidence Removal Confirmation Dialog */}
      {evidenceToRemove && (
        <Dialog
          open={!!evidenceToRemove}
          onOpenChange={(open) => {
            if (!open && !removeEvidenceMutation.isPending) {
              setEvidenceToRemove(null);
              setRemovalReason("");
            }
          }}
        >
          <DialogContent className="max-w-md bg-white p-6 rounded-2xl border border-[#e2ece8] shadow-2xl">
            <DialogHeader>
              <div className="flex items-center gap-2.5 text-[#b03e3e]">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-[#fdf2f2] border border-[#f5c6c6]">
                  <Trash2 className="h-4 w-4 text-[#b03e3e]" />
                </div>
                <DialogTitle className="text-base font-bold text-[#1f4e5b]">
                  Remove Execution Evidence
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-[#556d6e] mt-1.5 leading-relaxed">
                You are about to remove this execution evidence record. In compliance with audit regulations,
                the database record will be deactivated with an immutable audit entry, the binary file will be purged from storage, and AI risk models (Evidence Reuse & Risk Score) will be re-evaluated.
              </DialogDescription>
            </DialogHeader>

            <div className="my-3 rounded-xl border border-[#e8ecea] bg-[#f8faf9] p-3 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#1f4e5b]">{formatEvidenceCategory(evidenceToRemove.category)}</span>
                <span className="text-[10px] font-mono text-[#789092]">{evidenceToRemove.evidenceCode}</span>
              </div>
              <p className="font-mono text-[11px] text-[#2d555c] break-all">
                {getEvidenceFileName(evidenceToRemove)}
              </p>
              {evidenceToRemove.title && (
                <p className="text-[11px] italic text-[#556d6e]">"{evidenceToRemove.title}"</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-[#1f4e5b] flex items-center justify-between">
                <span>Removal Reason <span className="text-[#b03e3e]">*</span></span>
                <span className="text-[10px] font-normal text-[#789092]">Mandatory for audit trail</span>
              </label>
              <Textarea
                value={removalReason}
                onChange={(e) => setRemovalReason(e.target.value)}
                placeholder="Specify reason (e.g. Attached duplicate or incorrect site photo for this milestone; replaced with verified image)"
                rows={3}
                className="text-xs resize-none rounded-xl border-[#cce0da] focus-visible:ring-[#0d8f7b]"
                disabled={removeEvidenceMutation.isPending}
              />
              <p className="text-[10px] text-[#789092]">Minimum 3 characters required.</p>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEvidenceToRemove(null);
                  setRemovalReason("");
                }}
                disabled={removeEvidenceMutation.isPending}
                className="h-9 px-4 text-xs font-semibold rounded-xl border-[#d1ded9] text-[#4f6f70] hover:bg-[#f0f6f3]"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmRemoval}
                disabled={removeEvidenceMutation.isPending || removalReason.trim().length < 3}
                className="h-9 px-4 text-xs font-semibold rounded-xl bg-[#b03e3e] text-white hover:bg-[#922e2e] shadow-sm flex items-center gap-1.5"
              >
                {removeEvidenceMutation.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Removing...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" /> Confirm Removal
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
function DetailStat({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[#edf2ef] bg-[#fbfdfc] p-3"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8aa09f]">{label}</p><p className="mt-1 text-xs font-bold text-[#315a60]">{value}</p></div>; }
function AlertCallout({ role }: { role: RoleKey }) { return <div className="flex items-start gap-3 rounded-2xl border border-[#f1dfb6] bg-[#fffaf0] p-4 text-xs text-[#805f27]"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#d49630]" /><div><p className="font-bold">Human verification required</p><p className="mt-1 leading-5">AI flags are analytical decision-support only. {role === "district" ? "Respond with explanation, evidence, classification, or corrective action; alerts cannot be silently dismissed." : "Review indicators and follow the authorized workflow for your role."}</p></div></div>; }
function WorkflowStepper({ items }: { items: string[] }) { return <div className="rounded-2xl border border-[#dfeae6] bg-white p-4"><div className="flex flex-wrap items-center gap-2">{items.map((item, index) => <div key={item} className="flex items-center gap-2"><div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[10px] font-bold ${index === 0 ? "bg-[#e7f6f0] text-[#178b78]" : "bg-[#f5f8f7] text-[#668182]"}`}><span className="grid h-5 w-5 place-items-center rounded-full bg-white text-[9px] shadow-sm">{index + 1}</span>{item}</div>{index < items.length - 1 && <ChevronRight className="h-3 w-3 text-[#a1b3b0]" />}</div>)}</div></div>; }
function FinancialStrip({ snapshot }: { snapshot: DashboardSnapshot }) {
  const totalSanctioned = snapshot.rows.reduce((sum, r) => sum + (r.sanctionedRaw || 0), 0);
  const totalSpent = snapshot.rows.reduce((sum, r) => sum + (r.spentRaw || 0), 0);
  const utilization = totalSanctioned > 0 ? Math.round((totalSpent / totalSanctioned) * 100) : 0;
  const varianceCount = snapshot.rows.filter(r => r.risk >= 31).length;
  const sanctionedText = totalSanctioned >= 10000000 ? `₹${(totalSanctioned / 10000000).toFixed(2)} Cr` : `₹${(totalSanctioned / 100000).toFixed(1)} L`;
  const spentText = totalSpent >= 10000000 ? `₹${(totalSpent / 10000000).toFixed(2)} Cr` : `₹${(totalSpent / 100000).toFixed(1)} L`;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl bg-[#e9f7f1] p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#5e8981]">Utilization</p>
        <p className="mt-2 text-2xl font-semibold text-[#1a8172]">{utilization}%</p>
        <div className="mt-3 h-1.5 rounded-full bg-white"><div className="h-full rounded-full bg-[#1a9c7e]" style={{ width: `${Math.min(utilization, 100)}%` }} /></div>
      </div>
      <div className="rounded-2xl bg-[#eef5fb] p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#68869c]">Sanctioned</p>
        <p className="mt-2 text-2xl font-semibold text-[#3476a5]">{sanctionedText}</p>
        <p className="mt-1 text-[10px] text-[#7f9aaa]">{spentText} spent</p>
      </div>
      <div className="rounded-2xl bg-[#fff7e8] p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#a57b37]">Variance review</p>
        <p className="mt-2 text-2xl font-semibold text-[#bd7b1e]">{varianceCount}</p>
        <p className="mt-1 text-[10px] text-[#9f865c]">records outside benchmark</p>
      </div>
    </div>
  );
}
function ComplianceCards({ role }: { role: RoleKey }) { return <div className="grid gap-3 sm:grid-cols-3"><ComplianceCard icon={BadgeCheck} title="Documents" value="91%" detail="complete and current" tone="teal" /><ComplianceCard icon={FileWarning} title="Open issues" value={role === "cag" ? "5" : "2"} detail="require owner response" tone="red" /><ComplianceCard icon={FileCheck2} title="Last review" value="24 Sept" detail="evidence trail current" tone="blue" /></div>; }
function ComplianceCard({ icon: Icon, title, value, detail, tone }: { icon: typeof BadgeCheck; title: string; value: string; detail: string; tone: "teal" | "red" | "blue" }) { const color = tone === "teal" ? "text-[#168873] bg-[#effaf5]" : tone === "red" ? "text-[#c2525b] bg-[#fff0f1]" : "text-[#3476a5] bg-[#eef5fb]"; return <div className="rounded-2xl border border-[#e1ebe7] bg-white p-4"><span className={`grid h-8 w-8 place-items-center rounded-xl ${color}`}><Icon className="h-4 w-4" /></span><p className="mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-[#789092]">{title}</p><p className="mt-1 text-2xl font-semibold text-[#214c56]">{value}</p><p className="mt-1 text-[10px] text-[#8a9b9c]">{detail}</p></div>; }
function AdminNotice() { return <div className="flex items-start gap-3 rounded-2xl border border-[#dcebe5] bg-[#eff8f5] p-5"><SettingsIcon /><div><p className="text-sm font-bold text-[#214c56]">Administrative controls are separated from operational project actions.</p><p className="mt-1 text-xs leading-5 text-[#668182]">MoSPI can configure authorized system-level parameters and review logs. No role can manually alter AI scores, delete audit history, or impersonate an executing authority.</p></div></div>; }
function SettingsIcon() { return <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-[#168873] shadow-sm"><LockKeyhole className="h-4 w-4" /></span>; }
// ── Reports Section ──────────────────────────────────────────────────────────
function ReportsSection({ role }: { role: RoleKey }) {
  const [activeReport, setActiveReport] = useState<"summary" | "evidence" | "followup" | null>(null);
  const summaryLabel = role === "cag" ? "Audit & Assurance – Status Summary" : `${ROLE_DEFINITIONS[role].shortLabel} Status Summary`;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <ReportCard
          id="report-card-summary"
          icon={FileBarChart}
          title={summaryLabel}
          detail={role === "cag" ? "Independent assurance overview: risk, anomalies, cases, evidence status" : "Generated from authorized records · updated live"}
          active={activeReport === "summary"}
          onOpen={() => setActiveReport(activeReport === "summary" ? null : "summary")}
          onDownload={() => { setActiveReport("summary"); }}
          downloadLabel="Download Preview"
        />
        <ReportCard
          id="report-card-evidence"
          icon={Paperclip}
          title="Evidence Register"
          detail="Full evidence register: active, removed, verified, and pending records"
          active={activeReport === "evidence"}
          onOpen={() => setActiveReport(activeReport === "evidence" ? null : "evidence")}
          onDownload={() => { setActiveReport("evidence"); }}
          downloadLabel="Download Preview"
        />
        <ReportCard
          id="report-card-followup"
          icon={ClipboardCheck}
          title="Action Follow-up"
          detail="Case follow-up: status, investigator, latest action, and resolution timeline"
          active={activeReport === "followup"}
          onOpen={() => setActiveReport(activeReport === "followup" ? null : "followup")}
          onDownload={() => { setActiveReport("followup"); }}
          downloadLabel="Download Preview"
        />
      </div>
      {activeReport === "summary" && <CagStatusSummaryView role={role} />}
      {activeReport === "evidence" && <EvidenceRegisterView role={role} />}
      {activeReport === "followup" && <ActionFollowupView role={role} />}
    </div>
  );
}

function ReportCard({ id, icon: Icon, title, detail, active, onOpen, onDownload, downloadLabel }: {
  id: string;
  icon: typeof FileBarChart;
  title: string;
  detail: string;
  active: boolean;
  onOpen: () => void;
  onDownload: () => void;
  downloadLabel: string;
}) {
  return (
    <div
      id={id}
      className={`group rounded-2xl border bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_10px_25px_rgba(31,82,77,0.06)] cursor-pointer ${active ? "border-[#a8d5ca] shadow-[0_10px_25px_rgba(31,82,77,0.06)]" : "border-[#e1ebe7] hover:border-[#a8d5ca]"}`}
      onClick={onOpen}
    >
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${active ? "bg-[#0d8f7b] text-white" : "bg-[#edf7f3] text-[#168873]"}`}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-4 text-sm font-bold text-[#315a60]">{title}</p>
      <p className="mt-1 text-[10px] leading-4 text-[#8a9b9c]">{detail}</p>
      <span className="mt-4 inline-flex items-center text-[10px] font-bold text-[#168873]">
        {active ? "Hide preview" : "Open preview"} <ArrowUpRight className="ml-1 h-3 w-3 transition group-hover:translate-x-0.5" />
      </span>
    </div>
  );
}

// ── CAG / Role Status Summary View ───────────────────────────────────────────
function CagStatusSummaryView({ role }: { role: RoleKey }) {
  const query = trpc.monitoring.getCagStatusSummary.useQuery();
  const rows = query.data ?? [];

  const exportPdfMutation = trpc.monitoring.exportCagSummaryPdf.useMutation({
    onSuccess: data => {
      downloadBase64Pdf(data.base64, data.filename);
      toast.success("Audit & Assurance PDF downloaded", { description: data.filename });
    },
    onError: err => toast.error("Failed to export PDF", { description: err.message }),
  });

  const handleDownloadCsv = () => {
    downloadCsv(rows as unknown as Record<string, unknown>[], "nigraani_audit_assurance_status.csv");
  };

  const handleDownloadPdf = () => {
    exportPdfMutation.mutate();
  };

  return (
    <div className="rounded-[24px] border border-[#e1ebe7] bg-white p-5 shadow-[0_8px_24px_rgba(31,82,77,0.035)]">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8d566d]">
            <FileBarChart className="h-3.5 w-3.5" />
            <span>{role === "cag" ? "Audit & Assurance – Status Summary" : "Project Risk Status Summary"}</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">
            {role === "cag" ? "Independent Assurance Overview – CAG" : "Project & Risk Assessment Overview"}
          </h3>
          <p className="mt-1 text-xs text-[#8a9b9c]">
            Live data from projects, anomalies, cases, and evidence tables. {rows.length} projects in scope.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            id="download-preview-summary"
            onClick={handleDownloadCsv}
            disabled={query.isLoading || !rows.length}
            variant="outline"
            className="h-9 rounded-xl border-[#dcebe5] bg-white px-3 text-xs font-semibold text-[#315a60] hover:bg-[#f7fbf9] shadow-sm flex items-center gap-1.5"
          >
            {query.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download CSV
          </Button>
          <Button
            id="download-pdf-summary"
            onClick={handleDownloadPdf}
            disabled={exportPdfMutation.isPending || !rows.length}
            className="h-9 rounded-xl bg-[#0d8f7b] px-3.5 text-xs font-semibold text-white hover:bg-[#0b7c6d] shadow-sm flex items-center gap-1.5"
          >
            {exportPdfMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Download PDF
          </Button>
        </div>
      </div>
      {query.isLoading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#148774]" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#dcebe5] p-8 text-center">
          <p className="text-xs font-semibold text-[#789092]">No project data available. Run AI Evaluation to populate risk assessments.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-[#edf2ef] text-[9px] font-bold uppercase tracking-[0.14em] text-[#8aa09f]">
                <th className="pb-3 pr-4">Project Code</th>
                <th className="pb-3 pr-4">Title</th>
                <th className="pb-3 pr-4">District</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Risk Score</th>
                <th className="pb-3 pr-4">Anomalies</th>
                <th className="pb-3 pr-4">Case Status</th>
                <th className="pb-3 pr-4">Investigator</th>
                <th className="pb-3 pr-4">Evidence</th>
                <th className="pb-3">Modules Flagged</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.projectCode} className="border-b border-[#f0f4f2] last:border-0 hover:bg-[#fafcfb]">
                  <td className="py-3 pr-4 font-mono text-xs font-bold text-[#315a60]">{r.projectCode}</td>
                  <td className="py-3 pr-4 text-xs text-[#315a60] max-w-[180px] truncate">{r.title}</td>
                  <td className="py-3 pr-4 text-xs text-[#5c797a]">{r.district}</td>
                  <td className="py-3 pr-4">
                    <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      r.status === "Delayed" ? "bg-[#fff7e8] text-[#bd7b1e]" : r.status === "Completed" ? "bg-[#effaf5] text-[#168873]" : r.status === "Cancelled" ? "bg-[#fff0f1] text-[#c2525b]" : "bg-[#eef5fb] text-[#3476a5]"
                    }`}>{r.status}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      r.riskScore >= 71 ? "bg-[#fff0f1] text-[#c2525b]" : r.riskScore >= 31 ? "bg-[#fff7e8] text-[#bd7b1e]" : "bg-[#effaf5] text-[#168873]"
                    }`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{r.riskScore}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="text-xs font-bold text-[#315a60]">{r.anomalyCount}</span>
                    {r.highSeverityAnomalies > 0 && <span className="ml-1 rounded bg-[#fff0f1] px-1 text-[9px] font-bold text-[#c2525b]">{r.highSeverityAnomalies} high</span>}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      r.caseStatus === "RESOLVED" ? "bg-[#effaf5] text-[#168873]" : r.caseStatus === "ESCALATED" ? "bg-[#fff0f1] text-[#c2525b]" : r.caseStatus === "No Case" ? "bg-[#f1f5f9] text-[#64748b]" : "bg-[#fff7e8] text-[#bd7b1e]"
                    }`}>{r.caseStatus}</span>
                  </td>
                  <td className="py-3 pr-4 text-xs text-[#5c797a]">{r.investigator || <span className="italic text-[#a1b3b0]">Unassigned</span>}</td>
                  <td className="py-3 pr-4">
                    <span className="text-xs font-semibold text-[#168873]">{r.evidenceCount} active</span>
                    {r.removedEvidenceCount > 0 && <span className="ml-1 text-[10px] text-[#a1b3b0]">{r.removedEvidenceCount} removed</span>}
                  </td>
                  <td className="py-3 text-[10px] text-[#789092] max-w-[150px]">{r.anomalyModules || <span className="italic">None</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Evidence Register View ────────────────────────────────────────────────────
function EvidenceRegisterView({ role }: { role: RoleKey }) {
  const query = trpc.monitoring.getEvidenceRegister.useQuery();
  const rows = query.data ?? [];

  const exportPdfMutation = trpc.monitoring.exportEvidenceRegisterPdf.useMutation({
    onSuccess: data => {
      downloadBase64Pdf(data.base64, data.filename);
      toast.success("Evidence Register PDF downloaded", { description: data.filename });
    },
    onError: err => toast.error("Failed to export PDF", { description: err.message }),
  });

  const handleDownloadCsv = () => {
    downloadCsv(rows.map(r => ({
      evidenceCode: r.evidenceCode,
      projectCode: r.projectCode,
      title: r.title,
      category: r.category,
      fileName: r.fileName,
      uploadedBy: r.uploadedBy,
      uploadedRole: r.uploadedRole,
      status: r.isActive ? "Active" : "Removed",
      verified: r.verified ? "Yes" : "No",
      createdAt: r.createdAt,
      removedAt: r.removedAt ?? "",
      removedBy: r.removedBy ?? "",
      removalReason: r.removalReason ?? "",
    })), "nigraani_evidence_register.csv");
  };

  const handleDownloadPdf = () => {
    exportPdfMutation.mutate();
  };

  return (
    <div className="rounded-[24px] border border-[#e1ebe7] bg-white p-5 shadow-[0_8px_24px_rgba(31,82,77,0.035)]">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#168873]">
            <Paperclip className="h-3.5 w-3.5" />
            <span>Evidence Register</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">Complete Evidence Register</h3>
          <p className="mt-1 text-xs text-[#8a9b9c]">
            All evidence records including active, removed, and verified. {rows.length} total records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            id="download-preview-evidence"
            onClick={handleDownloadCsv}
            disabled={query.isLoading || !rows.length}
            variant="outline"
            className="h-9 rounded-xl border-[#dcebe5] bg-white px-3 text-xs font-semibold text-[#315a60] hover:bg-[#f7fbf9] shadow-sm flex items-center gap-1.5"
          >
            {query.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download CSV
          </Button>
          <Button
            id="download-pdf-evidence"
            onClick={handleDownloadPdf}
            disabled={exportPdfMutation.isPending || !rows.length}
            className="h-9 rounded-xl bg-[#0d8f7b] px-3.5 text-xs font-semibold text-white hover:bg-[#0b7c6d] shadow-sm flex items-center gap-1.5"
          >
            {exportPdfMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Download PDF
          </Button>
        </div>
      </div>
      {query.isLoading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#148774]" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#dcebe5] p-8 text-center">
          <p className="text-xs font-semibold text-[#789092]">No evidence records found. Upload execution evidence from the District workspace.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="border-b border-[#edf2ef] text-[9px] font-bold uppercase tracking-[0.14em] text-[#8aa09f]">
                <th className="pb-3 pr-4">Evidence Code</th>
                <th className="pb-3 pr-4">Project</th>
                <th className="pb-3 pr-4">Type</th>
                <th className="pb-3 pr-4">File Name</th>
                <th className="pb-3 pr-4">Uploaded By</th>
                <th className="pb-3 pr-4">Date</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3">dHash</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-[#f0f4f2] last:border-0 hover:bg-[#fafcfb]">
                  <td className="py-3 pr-4 font-mono text-[10px] font-bold text-[#315a60]">{r.evidenceCode}</td>
                  <td className="py-3 pr-4 text-xs text-[#5c797a]">{r.projectCode}</td>
                  <td className="py-3 pr-4">
                    <span className="inline-block rounded-md bg-[#edf7f3] px-2 py-0.5 text-[10px] font-bold text-[#168873]">
                      {formatEvidenceCategory(r.category)}
                    </span>
                  </td>
                  <td className="py-3 pr-4 max-w-[160px]">
                    {r.fileUrl ? (
                      <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-mono font-medium text-[#0d8f7b] hover:underline truncate">
                        <ExternalLink className="h-3 w-3 shrink-0" />{r.fileName}
                      </a>
                    ) : (
                      <span className="font-mono text-[11px] text-[#789092] truncate block">{r.fileName}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <p className="text-xs font-semibold text-[#315a60]">{r.uploadedBy}</p>
                    <span className="inline-block mt-0.5 rounded px-1.5 py-0.5 bg-[#f0f5f3] text-[9px] font-bold uppercase tracking-wider text-[#638280]">{r.uploadedRole}</span>
                  </td>
                  <td className="py-3 pr-4 text-[10px] text-[#789092] whitespace-nowrap">{formatEvidenceTimestamp(r.createdAt)}</td>
                  <td className="py-3 pr-4">
                    {r.isActive ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#effaf5] px-2 py-0.5 text-[10px] font-bold text-[#168873]"><span className="h-1.5 w-1.5 rounded-full bg-[#168873]" />Active</span>
                    ) : (
                      <div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#fff0f1] px-2 py-0.5 text-[10px] font-bold text-[#c2525b]"><span className="h-1.5 w-1.5 rounded-full bg-[#c2525b]" />Removed</span>
                        {r.removalReason && <p className="mt-0.5 text-[10px] text-[#789092] line-clamp-1" title={r.removalReason}>{r.removalReason}</p>}
                      </div>
                    )}
                  </td>
                  <td className="py-3 text-[10px]">
                    {r.perceptualHash ? (
                      <span className="font-mono text-[#0d8f7b] font-semibold">Generated</span>
                    ) : r.mimeType?.startsWith("image/") ? (
                      <span className="text-[#bd7b1e]">Pending</span>
                    ) : (
                      <span className="text-[#a1b3b0] italic">N/A</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Action Follow-up View ─────────────────────────────────────────────────────
function ActionFollowupView({ role }: { role: RoleKey }) {
  const query = trpc.monitoring.getActionFollowup.useQuery();
  const rows = query.data ?? [];

  const exportPdfMutation = trpc.monitoring.exportActionFollowupPdf.useMutation({
    onSuccess: data => {
      downloadBase64Pdf(data.base64, data.filename);
      toast.success("Action Follow-up PDF downloaded", { description: data.filename });
    },
    onError: err => toast.error("Failed to export PDF", { description: err.message }),
  });

  const handleDownloadCsv = () => {
    downloadCsv(rows.map(r => ({
      caseNumber: r.caseNumber,
      projectCode: r.projectCode,
      title: r.title,
      priority: r.priority,
      status: r.status,
      assignedUser: r.assignedUser,
      assignedDistrict: r.assignedDistrict,
      openedBy: r.openedBy,
      latestAction: r.latestAction,
      latestRemark: r.latestRemark,
      resolvedAt: r.resolvedAt,
      escalatedAt: r.escalatedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })), "nigraani_action_followup.csv");
  };

  const handleDownloadPdf = () => {
    exportPdfMutation.mutate();
  };

  return (
    <div className="rounded-[24px] border border-[#e1ebe7] bg-white p-5 shadow-[0_8px_24px_rgba(31,82,77,0.035)]">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#3476a5]">
            <ClipboardCheck className="h-3.5 w-3.5" />
            <span>Action Follow-up</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">Case & Corrective Action Follow-up Register</h3>
          <p className="mt-1 text-xs text-[#8a9b9c]">
            Live case status, assigned investigators, and latest action remarks. {rows.length} cases tracked.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            id="download-preview-followup"
            onClick={handleDownloadCsv}
            disabled={query.isLoading || !rows.length}
            variant="outline"
            className="h-9 rounded-xl border-[#dcebe5] bg-white px-3 text-xs font-semibold text-[#315a60] hover:bg-[#f7fbf9] shadow-sm flex items-center gap-1.5"
          >
            {query.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download CSV
          </Button>
          <Button
            id="download-pdf-followup"
            onClick={handleDownloadPdf}
            disabled={exportPdfMutation.isPending || !rows.length}
            className="h-9 rounded-xl bg-[#0d8f7b] px-3.5 text-xs font-semibold text-white hover:bg-[#0b7c6d] shadow-sm flex items-center gap-1.5"
          >
            {exportPdfMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Download PDF
          </Button>
        </div>
      </div>
      {query.isLoading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#148774]" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#dcebe5] p-8 text-center">
          <p className="text-xs font-semibold text-[#789092]">No cases found. Cases are created when AI anomalies are detected and human verification is triggered.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left">
            <thead>
              <tr className="border-b border-[#edf2ef] text-[9px] font-bold uppercase tracking-[0.14em] text-[#8aa09f]">
                <th className="pb-3 pr-4">Case #</th>
                <th className="pb-3 pr-4">Project</th>
                <th className="pb-3 pr-4">Priority</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Investigator</th>
                <th className="pb-3 pr-4">Latest Action</th>
                <th className="pb-3 pr-4">Latest Remark</th>
                <th className="pb-3">Resolution / Escalation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const isResolved = r.status === "RESOLVED" || r.status === "CLOSED";
                const isEscalated = r.status === "ESCALATED" || r.status === "ESCALATED_TO_MOSPI";
                return (
                  <tr key={r.caseNumber} className="border-b border-[#f0f4f2] last:border-0 hover:bg-[#fafcfb]">
                    <td className="py-3 pr-4 font-mono text-xs font-bold text-[#315a60]">{r.caseNumber}</td>
                    <td className="py-3 pr-4">
                      <p className="text-xs font-bold text-[#315a60] line-clamp-1">{r.title}</p>
                      <p className="text-[10px] text-[#8a9b9c]">{r.projectCode} · {r.assignedDistrict}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        r.priority === "High" || r.priority === "Critical" ? "bg-[#fff0f1] text-[#c2525b]" : "bg-[#fff7e8] text-[#bd7b1e]"
                      }`}>{r.priority}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                        isResolved ? "bg-[#effaf5] text-[#168873]" : isEscalated ? "bg-[#fff0f1] text-[#c2525b]" : r.status === "UNDER_INVESTIGATION" ? "bg-[#eef5fb] text-[#3476a5]" : "bg-[#fff7e8] text-[#bd7b1e]"
                      }`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{r.status}</span>
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      {r.assignedUser !== "Unassigned" ? (
                        <span className="font-semibold text-[#168873]">{r.assignedUser}</span>
                      ) : (
                        <span className="italic text-[#a1b3b0]">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {r.latestAction ? (
                        <span className="inline-block rounded-md bg-[#f0f5f3] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#638280]">{r.latestAction.replace(/_/g, " ")}</span>
                      ) : (
                        <span className="italic text-[10px] text-[#a1b3b0]">No action</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-[11px] text-[#4e6d70] max-w-[200px]">
                      <p className="line-clamp-2">{r.latestRemark || <span className="italic text-[#a1b3b0]">No remarks</span>}</p>
                    </td>
                    <td className="py-3 text-[10px] text-[#789092]">
                      {r.resolvedAt ? (
                        <span className="text-[#168873] font-semibold">Resolved {formatEvidenceTimestamp(r.resolvedAt)}</span>
                      ) : r.escalatedAt ? (
                        <span className="text-[#c2525b] font-semibold">Escalated {formatEvidenceTimestamp(r.escalatedAt)}</span>
                      ) : (
                        <span className="italic text-[#a1b3b0]">Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function actionLabel(action: PermissionAction) { const labels: Record<PermissionAction, string> = { processRecommendation: "Process recommendation", respondToAiAlert: "Respond to AI alert", requestClarification: "Request clarification", manageCorrectiveAction: "Manage corrective action", escalateIssue: "Escalate issue", submitRecommendation: "Submit recommendation", recordAuditFinding: "Record audit finding", issueAuditRecommendation: "Issue audit recommendation", updateFollowup: "Update follow-up", configureParameters: "Configure system parameters", exportReport: "Export report", addEvidence: "Add evidence" }; return labels[action]; }

function CasesRegister({
  onManageCase,
  role,
}: {
  onManageCase: (caseInfo: { projectCode: string; title: string; caseNumber?: string }) => void;
  role: RoleKey;
}) {
  const casesQuery = trpc.monitoring.getCases.useQuery();
  const casesList = casesQuery.data || [];

  if (casesList.length === 0) return null;

  return (
    <div className="rounded-[24px] border border-[#e1ebe7] bg-white p-5 shadow-[0_8px_24px_rgba(31,82,77,0.035)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#bd7b1e]">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Human Verification Register</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">
            Flagged Cases Requiring Human Investigation
          </h3>
          <p className="mt-1 text-xs text-[#8a9b9c]">
            Assigned cases for field inquiry, investigator review, evidence verification, and disposition.
          </p>
        </div>
        <span className="rounded-full bg-[#fff7e8] px-3 py-1 text-xs font-bold text-[#bd7b1e]">
          {casesList.length} Active Cases
        </span>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[650px] text-left">
          <thead>
            <tr className="border-b border-[#edf2ef] text-[9px] font-bold uppercase tracking-[0.14em] text-[#8aa09f]">
              <th className="pb-3 pr-4">Case #</th>
              <th className="pb-3 pr-4">Project</th>
              <th className="pb-3 pr-4">Priority</th>
              <th className="pb-3 pr-4">Status</th>
              <th className="pb-3 pr-4">Assigned Investigator</th>
              <th className="pb-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {casesList.map(c => {
              const isResolved = c.status === "RESOLVED" || c.status === "CLOSED";
              const isUnderInv = c.status === "UNDER_INVESTIGATION";
              const isEscalated = c.status === "ESCALATED" || c.status === "ESCALATED_TO_MOSPI";
              return (
                <tr key={c.id} className="border-b border-[#f0f4f2] last:border-0">
                  <td className="py-4 pr-4 font-mono text-xs font-bold text-[#315a60]">
                    {c.caseNumber}
                  </td>
                  <td className="py-4 pr-4">
                    <p className="text-xs font-bold text-[#315a60] line-clamp-1">{c.title}</p>
                    <p className="mt-0.5 text-[10px] text-[#8a9b9c]">{c.projectCode} · {c.assignedDistrict || c.assignedState}</p>
                  </td>
                  <td className="py-4 pr-4">
                    <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      c.priority === "High" || c.priority === "Critical" ? "bg-[#fff0f1] text-[#c2525b]" : "bg-[#fff7e8] text-[#bd7b1e]"
                    }`}>
                      {c.priority}
                    </span>
                  </td>
                  <td className="py-4 pr-4">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                      isResolved ? "bg-[#effaf5] text-[#168873]" : isUnderInv ? "bg-[#eef5fb] text-[#3476a5]" : isEscalated ? "bg-[#fff0f1] text-[#c2525b]" : "bg-[#fff7e8] text-[#bd7b1e]"
                    }`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {c.status}
                    </span>
                  </td>
                  <td className="py-4 pr-4 text-xs font-medium text-[#5c797a]">
                    {c.assignedUser ? (
                      <span className="font-semibold text-[#168873]">{c.assignedUser}</span>
                    ) : (
                      <span className="text-[#a1b3b0] italic">Unassigned</span>
                    )}
                  </td>
                  <td className="py-4">
                    <Button
                      onClick={() => onManageCase({ projectCode: c.projectCode, title: c.title, caseNumber: c.caseNumber })}
                      variant="outline"
                      className="h-8 rounded-lg border-[#dfeae6] bg-white px-2.5 text-[10px] font-semibold text-[#168873] hover:bg-[#eff9f5]"
                    >
                      <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                      {role === "cag" ? "Review" : "Verify / Investigate"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditTrailView({ role }: { role: RoleKey }) {
  const auditQuery = trpc.monitoring.getAuditLogs.useQuery();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAction, setSelectedAction] = useState<string>("ALL");

  const logs = auditQuery.data || [];

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (selectedAction !== "ALL" && log.action !== selectedAction) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesTarget = log.targetId?.toLowerCase().includes(q) || false;
        const matchesProject = log.projectCode?.toLowerCase().includes(q) || false;
        const matchesUser = log.userName?.toLowerCase().includes(q) || false;
        const matchesAction = log.action?.toLowerCase().includes(q) || false;
        const matchesComments = log.comments?.toLowerCase().includes(q) || false;
        const matchesNewValue = log.newValue?.toLowerCase().includes(q) || false;
        return matchesTarget || matchesProject || matchesUser || matchesAction || matchesComments || matchesNewValue;
      }
      return true;
    });
  }, [logs, selectedAction, searchTerm]);

  const getActionBadge = (action: string) => {
    switch (action) {
      case "CASE_ASSIGNMENT":
        return {
          label: "Case Assignment",
          className: "bg-[#eef2ff] text-[#4338ca] border-[#c7d2fe]",
          icon: <UserCheck className="h-3 w-3" />,
        };
      case "INVESTIGATOR_REMARK":
        return {
          label: "Investigator Remark",
          className: "bg-[#fffbeb] text-[#b45309] border-[#fde68a]",
          icon: <MessageSquareMore className="h-3 w-3" />,
        };
      case "CASE_STATUS_CHANGE":
        return {
          label: "Case Status Change",
          className: "bg-[#f5f3ff] text-[#6d28d9] border-[#ddd6fe]",
          icon: <Activity className="h-3 w-3" />,
        };
      case "VERIFICATION_EVIDENCE_ATTACHED":
        return {
          label: "Verification Evidence Attached",
          className: "bg-[#ecfdf5] text-[#047857] border-[#a7f3d0]",
          icon: <Paperclip className="h-3 w-3" />,
        };
      case "CASE_RESOLVED":
        return {
          label: "Case Resolved",
          className: "bg-[#f0fdf4] text-[#15803d] border-[#bbf7d0]",
          icon: <CheckCircle2 className="h-3 w-3" />,
        };
      case "CASE_ESCALATED":
        return {
          label: "Case Escalated",
          className: "bg-[#fef2f2] text-[#b91c1c] border-[#fecaca]",
          icon: <AlertTriangle className="h-3 w-3" />,
        };
      case "PROJECT_EXECUTION_UPDATE":
        return {
          label: "Project Execution Update",
          className: "bg-[#f0fdfa] text-[#0f766e] border-[#99f6e4]",
          icon: <TrendingUp className="h-3 w-3" />,
        };
      case "EVIDENCE_REMOVED":
        return {
          label: "Evidence Removed",
          className: "bg-[#fff1f2] text-[#be123c] border-[#fecdd3]",
          icon: <Trash2 className="h-3 w-3" />,
        };
      default:
        return {
          label: action.replace(/_/g, " "),
          className: "bg-[#f1f5f9] text-[#475569] border-[#cbd5e1]",
          icon: <FileClock className="h-3 w-3" />,
        };
    }
  };

  return (
    <div className="rounded-[24px] border border-[#e1ebe7] bg-white p-5 shadow-[0_8px_24px_rgba(31,82,77,0.035)]">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#1aa67f]">
            <FileClock className="h-3.5 w-3.5" />
            <span>Centralized Audit Trail</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#214c56]">
            Immutable Verification & Compliance Activity Log
          </h3>
          <p className="mt-1 text-xs text-[#8a9b9c]">
            Real-time audit records covering investigator assignment, remarks, evidence attachments, and case status dispositions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#effaf5] px-3 py-1 text-xs font-bold text-[#168873]">
            {filteredLogs.length} Records Logged
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => auditQuery.refetch()}
            className="h-8 rounded-lg border-[#dfeae6] text-xs font-semibold text-[#4f7273]"
          >
            {auditQuery.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="mt-5 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ab0af]" />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by case #, project code, investigator, remark, or action details..."
            className="h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] pl-10 pr-3 text-xs text-[#315a60] outline-none focus:border-[#34a995] focus:ring-2 focus:ring-[#34a995]/10"
          />
        </div>
        <select
          value={selectedAction}
          onChange={e => setSelectedAction(e.target.value)}
          className="h-10 rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-semibold text-[#547174] outline-none"
        >
          <option value="ALL">All Actions ({logs.length})</option>
          <option value="CASE_ASSIGNMENT">Case Assignment</option>
          <option value="INVESTIGATOR_REMARK">Investigator Remark</option>
          <option value="CASE_STATUS_CHANGE">Case Status Change</option>
          <option value="VERIFICATION_EVIDENCE_ATTACHED">Verification Evidence Attached</option>
          <option value="CASE_RESOLVED">Case Resolved</option>
          <option value="CASE_ESCALATED">Case Escalated</option>
          <option value="PROJECT_EXECUTION_UPDATE">Project Execution Update</option>
          <option value="EVIDENCE_REMOVED">Evidence Removed</option>
        </select>
      </div>

      {/* Audit Log Table */}
      <div className="mt-5 overflow-x-auto">
        {auditQuery.isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#148774]" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#dcebe5] p-8 text-center">
            <p className="text-xs font-semibold text-[#789092]">No audit records match the current filter criteria.</p>
          </div>
        ) : (
          <table className="w-full min-w-[850px] text-left">
            <thead>
              <tr className="border-b border-[#edf2ef] text-[9px] font-bold uppercase tracking-[0.14em] text-[#8aa09f]">
                <th className="pb-3 pr-4">Timestamp (IST)</th>
                <th className="pb-3 pr-4">Action</th>
                <th className="pb-3 pr-4">Case # / Target</th>
                <th className="pb-3 pr-4">Action Details & Remarks</th>
                <th className="pb-3 pr-4">Performed By</th>
                <th className="pb-3">Audit Ref</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map(log => {
                const badge = getActionBadge(log.action);
                return (
                  <tr key={log.id} className="border-b border-[#f0f4f2] last:border-0 hover:bg-[#fafcfb]">
                    <td className="py-3.5 pr-4 whitespace-nowrap text-[11px] font-medium text-[#678283]">
                      {formatEvidenceTimestamp(log.createdAt)}
                    </td>
                    <td className="py-3.5 pr-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${badge.className}`}>
                        {badge.icon}
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-3.5 pr-4 whitespace-nowrap">
                      <p className="font-mono text-xs font-bold text-[#173e49]">{log.targetId}</p>
                      {log.projectCode && (
                        <p className="text-[10px] text-[#8a9b9c]">{log.projectCode}</p>
                      )}
                    </td>
                    <td className="py-3.5 pr-4 max-w-[340px]">
                      <p className="text-xs text-[#214c56] leading-relaxed break-words font-medium">
                        {log.comments || log.newValue || "Action recorded"}
                      </p>
                      {log.oldValue && log.newValue && log.oldValue !== log.newValue && (
                        <p className="mt-1 text-[10px] text-[#718b8b]">
                          <span className="line-through text-[#a37984]">{log.oldValue}</span>
                          <span className="mx-1 text-[#8aa09f]">→</span>
                          <span className="font-semibold text-[#168873]">{log.newValue}</span>
                        </p>
                      )}
                    </td>
                    <td className="py-3.5 pr-4 whitespace-nowrap">
                      <p className="text-xs font-semibold text-[#315a60]">{log.userName}</p>
                      <span className="inline-block mt-0.5 rounded px-1.5 py-0.5 bg-[#f0f5f3] text-[9px] font-bold uppercase tracking-wider text-[#638280]">
                        {log.userRole}
                      </span>
                    </td>
                    <td className="py-3.5 whitespace-nowrap font-mono text-[10px] text-[#8a9b9c]">
                      {log.auditCode}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ProjectUpdateDialog({
  project,
  userRole,
  userName,
  onClose,
  onSuccess,
}: {
  project: TableRow;
  userRole: RoleKey;
  userName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [progress, setProgress] = useState(project.progress);
  const [status, setStatus] = useState(project.status || "Active");
  const [milestone, setMilestone] = useState("");
  const [spent, setSpent] = useState(project.spentRaw ?? 0);
  const [remarks, setRemarks] = useState("");
  const [updateDate, setUpdateDate] = useState(() => new Date().toISOString().split("T")[0]);

  const [hasEvidence, setHasEvidence] = useState(false);
  const [evidenceCategory, setEvidenceCategory] = useState<"SITE_PHOTO" | "SUPPORTING_DOCUMENT" | "MEASUREMENT_BOOK" | "INSPECTION_REPORT">("SITE_PHOTO");
  const [evidenceTitle, setEvidenceTitle] = useState("");
  const [evidenceBase64, setEvidenceBase64] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [successInfo, setSuccessInfo] = useState<{ compositeRiskScore: number; anomaliesDetected: number } | null>(null);

  const utils = trpc.useUtils();
  const updateMutation = trpc.monitoring.submitProjectUpdate.useMutation({
    onSuccess: async (data) => {
      setSuccessInfo({
        compositeRiskScore: data.assessment.compositeRiskScore,
        anomaliesDetected: data.assessment.anomaliesDetected,
      });
      toast.success("Project updated successfully", {
        description: `${hasEvidence ? "Evidence attached. " : ""}AI re-evaluation completed: Risk score ${data.assessment.compositeRiskScore}/100 with ${data.assessment.anomaliesDetected} active anomalies.`,
      });
      await utils.monitoring.snapshot.invalidate();
      await utils.monitoring.getProjectUpdates.invalidate({ projectCode: project.id });
      await utils.monitoring.getCases.invalidate();
      setTimeout(() => {
        onSuccess();
      }, 1500);
    },
    onError: (err) => {
      toast.error("Failed to submit project update", { description: err.message });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    if (!evidenceTitle) {
      setEvidenceTitle(file.name.replace(/\.[^/.]+$/, ""));
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setEvidenceBase64(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!remarks.trim()) {
      toast.error("Please enter authority remarks / field notes describing this update.");
      return;
    }
    updateMutation.mutate({
      projectCode: project.id,
      newProgress: Number(progress),
      newStatus: status as any,
      updateType: milestone.trim() || `Progress update: ${progress}% reached`,
      spentAmount: Number(spent),
      remarks: remarks.trim(),
      updateDate,
      evidenceTitle: hasEvidence && evidenceTitle.trim() ? evidenceTitle.trim() : undefined,
      evidenceCategory: hasEvidence ? evidenceCategory : undefined,
      evidenceFileName: hasEvidence && fileName ? fileName : undefined,
      evidenceBase64: hasEvidence && evidenceBase64 ? evidenceBase64 : undefined,
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl border-[#dcebe5] bg-white p-6 rounded-3xl shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#168873]">
            <Activity className="h-3.5 w-3.5" />
            <span>Authorized Project Execution Update</span>
            <span className="rounded bg-[#effaf5] px-1.5 py-0.5 text-[9px] text-[#148774]">OPERATIONAL_UPDATE</span>
          </div>
          <DialogTitle className="mt-2 text-xl font-semibold text-[#173e49]">
            {project.title}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#789092]">
            Project ID: <span className="font-semibold text-[#315a60]">{project.id}</span> · Location: {project.region} · Authorized Role: <span className="font-semibold text-[#168873]">{userRole.toUpperCase()}</span> ({userName})
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="rounded-xl border border-[#e1ebe7] bg-[#f8fbf9] p-3 text-xs leading-5 text-[#5e7d7e]">
            <Info className="inline-block mr-1.5 h-3.5 w-3.5 text-[#1a8873]" />
            Official MPLADS base records (<span className="font-semibold">OFFICIAL_PUBLIC</span>) are preserved without overwrite. This update will be recorded in <code className="text-[#136a5b] font-semibold">project_updates</code>, adjusting operational progress, vouchers, and triggering real-time AI re-evaluation.
          </div>

          {successInfo && (
            <div className="rounded-2xl border border-[#a7dfd2] bg-[#effaf5] p-4 text-xs space-y-1.5 animate-in fade-in">
              <div className="flex items-center gap-2 font-bold text-sm text-[#117361]">
                <CheckCircle2 className="h-5 w-5 text-[#148774]" />
                Project updated successfully
              </div>
              {hasEvidence && (
                <p className="text-[11px] font-semibold text-[#1c7866] pl-7">
                  ✓ Evidence attached: {evidenceCategory === "SITE_PHOTO" ? "Site Photo (Perceptual Hash Generated)" : "Supporting Document"}
                </p>
              )}
              <p className="text-[11px] font-semibold text-[#1c7866] pl-7">
                ✓ AI re-evaluation completed: Composite Risk {successInfo.compositeRiskScore}/100 · {successInfo.anomaliesDetected} anomalies detected
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#4e6d70]">
                Update Date
                <input
                  type="date"
                  value={updateDate}
                  onChange={e => setUpdateDate(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs text-[#214c56] outline-none focus:border-[#2ba68e] focus:ring-2 focus:ring-[#2ba68e]/10"
                />
              </label>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4e6d70]">
                Project Status
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-medium text-[#214c56] outline-none focus:border-[#2ba68e] focus:ring-2 focus:ring-[#2ba68e]/10"
                >
                  <option value="Active">Active</option>
                  <option value="Sanctioned">Sanctioned</option>
                  <option value="Delayed">Delayed</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[#4e6d70]">Physical Progress (%)</label>
                <span className="text-xs font-bold text-[#168873]">{progress}%</span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={progress}
                  onChange={e => setProgress(Number(e.target.value))}
                  className="h-2 flex-1 accent-[#148774] cursor-pointer"
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={progress}
                  onChange={e => setProgress(Number(e.target.value))}
                  className="h-9 w-16 rounded-xl border border-[#dfeae6] bg-[#fbfdfc] text-center text-xs font-bold text-[#214c56] outline-none focus:border-[#2ba68e]"
                />
              </div>
              <p className="mt-1 text-[10px] text-[#8ca2a1]">Previously recorded: {project.progress}%</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4e6d70]">
                Cumulative Expenditure / Spent Amount (₹)
                <input
                  type="number"
                  min="0"
                  value={spent}
                  onChange={e => setSpent(Number(e.target.value))}
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-bold text-[#214c56] outline-none focus:border-[#2ba68e] focus:ring-2 focus:ring-[#2ba68e]/10"
                  placeholder="e.g. 1500000"
                />
              </label>
              <p className="mt-1 text-[10px] text-[#8ca2a1]">
                Sanctioned: {project.amount} {project.spent ? `· Previous Spent: ${project.spent}` : ""}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#4e6d70]">
              Milestone / Progress Description
              <input
                type="text"
                value={milestone}
                onChange={e => setMilestone(e.target.value)}
                placeholder="e.g. Foundation slab casting completed; 45% brickwork done"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs text-[#214c56] outline-none focus:border-[#2ba68e] focus:ring-2 focus:ring-[#2ba68e]/10"
              />
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#4e6d70]">
              Authority Remarks / Field Notes <span className="text-[#d45462]">*</span>
              <textarea
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                placeholder="Provide physical execution observations, material verification, site inspection notes, or reasons for delay..."
                className="mt-1.5 min-h-[85px] w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] p-3 text-xs leading-5 text-[#315a60] outline-none focus:border-[#2ba68e] focus:ring-2 focus:ring-[#2ba68e]/10"
                required
              />
            </label>
          </div>

          {/* Evidence Attachment Section */}
          <div className="rounded-2xl border border-[#dcebe5] bg-[#f9fcfb] p-4">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasEvidence}
                  onChange={e => setHasEvidence(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#148774]"
                />
                <span className="text-xs font-bold text-[#214c56] flex items-center gap-1.5">
                  <Camera className="h-3.5 w-3.5 text-[#168873]" />
                  Attach Evidence
                </span>
              </label>
              <span className="text-[10px] text-[#718d8e]">Site photo or supporting document</span>
            </div>

            {hasEvidence && (
              <div className="mt-3 space-y-3 pt-3 border-t border-[#e2ede8]">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#547274]">
                      Evidence Type
                      <select
                        value={evidenceCategory}
                        onChange={e => setEvidenceCategory(e.target.value as any)}
                        className="mt-1 h-9 w-full rounded-lg border border-[#dfeae6] bg-white px-2.5 text-xs text-[#315a60] outline-none"
                      >
                        <option value="SITE_PHOTO">Site Photo (JPG/PNG)</option>
                        <option value="SUPPORTING_DOCUMENT">Supporting Document (PDF/DOC)</option>
                        <option value="MEASUREMENT_BOOK">Measurement Book (MB Record)</option>
                        <option value="INSPECTION_REPORT">Inspection & Verification Report</option>
                      </select>
                    </label>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#547274]">
                      Evidence Description
                      <input
                        type="text"
                        value={evidenceTitle}
                        onChange={e => setEvidenceTitle(e.target.value)}
                        placeholder="e.g. Stage 3 Structural Slab Photo / Field Inspection Sheet"
                        className="mt-1 h-9 w-full rounded-lg border border-[#dfeae6] bg-white px-2.5 text-xs text-[#315a60] outline-none"
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#547274]">
                    Upload File ({evidenceCategory === "SITE_PHOTO" ? "Site Photo (JPG/PNG)" : "Supporting Document (PDF/DOC)"})
                    <input
                      type="file"
                      accept={evidenceCategory === "SITE_PHOTO" ? "image/jpeg,image/png,image/webp" : ".pdf,.doc,.docx,image/*"}
                      onChange={handleFileChange}
                      className="mt-1 block w-full text-xs text-[#5d7a7b] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#e7f6f0] file:text-[#168873] hover:file:bg-[#d8efe7]"
                    />
                  </label>
                  {evidenceBase64 && evidenceBase64.startsWith("data:image") && (
                    <div className="mt-2 flex items-center gap-3">
                      <img src={evidenceBase64} alt="Preview" className="h-16 w-24 object-cover rounded-lg border border-[#dfeae6]" />
                      <div className="text-[10px] text-[#6d8a8b]">
                        <p className="font-semibold text-[#214c56]">{fileName}</p>
                        <p className="text-[#168873]">✓ 64-bit dHash will be computed for similarity & reuse detection.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-[#effaf5] p-3 text-[11px] text-[#168873] flex items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span>
              Real-time AI: Submitting will re-evaluate Semantic Similarity, Isolation Forest, Random Forest, and Image Similarity engines.
            </span>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" onClick={onClose} variant="outline" className="h-10 rounded-xl border-[#dfeae6] bg-white text-xs font-semibold text-[#547274]">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending || !remarks.trim() || !!successInfo}
              className="h-10 rounded-xl bg-[#0d8f7b] text-xs font-semibold text-white hover:bg-[#0b7c6d] shadow-md shadow-[#0d8f7b]/20"
            >
              {updateMutation.isPending ? "Recording & Running AI..." : successInfo ? "Updated Successfully" : "Save Update & Run AI"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CaseVerificationDialog({
  caseInfo,
  userRole,
  userName,
  onClose,
  onSuccess,
}: {
  caseInfo: { projectCode: string; title: string; caseNumber?: string };
  userRole: RoleKey;
  userName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const updatesQuery = trpc.monitoring.getProjectUpdates.useQuery({ projectCode: caseInfo.projectCode });
  const investigatorsQuery = trpc.monitoring.getAvailableInvestigators.useQuery();
  const utils = trpc.useUtils();

  const activeCase = updatesQuery.data?.cases.find(c => c.caseNumber === caseInfo.caseNumber) || updatesQuery.data?.cases[0];

  const [assignedUser, setAssignedUser] = useState(activeCase?.assignedUser || "");
  const [newRemarks, setNewRemarks] = useState("");
  const [status, setStatus] = useState<"UNDER_INVESTIGATION" | "RESOLVED" | "ESCALATED">(
    activeCase?.status === "RESOLVED" ? "RESOLVED" : activeCase?.status === "ESCALATED" ? "ESCALATED" : "UNDER_INVESTIGATION"
  );

  const [hasEvidence, setHasEvidence] = useState(false);
  const [evidenceTitle, setEvidenceTitle] = useState("");
  const [evidenceBase64, setEvidenceBase64] = useState("");
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    if (activeCase?.assignedUser && !assignedUser) {
      setAssignedUser(activeCase.assignedUser);
    }
    if (activeCase?.status) {
      if (activeCase.status === "RESOLVED" || activeCase.status === "ESCALATED" || activeCase.status === "UNDER_INVESTIGATION") {
        setStatus(activeCase.status as any);
      }
    }
  }, [activeCase]);

  const manageMutation = trpc.monitoring.manageCase.useMutation({
    onSuccess: async (data) => {
      toast.success(`Case updated to ${data.case?.status || status}`, {
        description: `Investigator assigned: ${data.case?.assignedUser || assignedUser || "Unassigned"}. Audit trail recorded.`,
      });
      await utils.monitoring.snapshot.invalidate();
      await utils.monitoring.getProjectUpdates.invalidate({ projectCode: caseInfo.projectCode });
      await utils.monitoring.getCases.invalidate();
      await utils.monitoring.getAuditLogs.invalidate();
      await utils.monitoring.auditTrail.invalidate();
      onSuccess();
    },
    onError: (err) => {
      toast.error("Failed to update case", { description: err.message });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    if (!evidenceTitle) {
      setEvidenceTitle(file.name.replace(/\.[^/.]+$/, ""));
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setEvidenceBase64(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    manageMutation.mutate({
      caseNumber: activeCase?.caseNumber || caseInfo.caseNumber || `CASE-${caseInfo.projectCode}`,
      projectCode: caseInfo.projectCode,
      assignedUser: assignedUser || undefined,
      investigatorRemarks: newRemarks.trim() || undefined,
      status,
      evidenceTitle: hasEvidence && evidenceTitle.trim() ? evidenceTitle.trim() : undefined,
      evidenceFileName: hasEvidence && fileName ? fileName : undefined,
      evidenceBase64: hasEvidence && evidenceBase64 ? evidenceBase64 : undefined,
    });
  };

  const investigators = investigatorsQuery.data || [];

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl border-[#dcebe5] bg-white p-6 rounded-3xl shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#bd7b1e]">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Human Verification & Case Disposition</span>
          </div>
          <DialogTitle className="mt-2 text-xl font-semibold text-[#173e49]">
            {activeCase?.caseNumber || `CASE-${caseInfo.projectCode}`}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#789092]">
            Project: <span className="font-semibold text-[#315a60]">{caseInfo.title}</span> ({caseInfo.projectCode})
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Current Status and Case Summary */}
          <div className="rounded-2xl border border-[#edf3f0] bg-[#fbfdfc] p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8aa09f]">Current Status</p>
              <span className="mt-1 inline-block font-bold text-[#bd7b1e]">{activeCase?.status || "OPEN"}</span>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8aa09f]">Priority</p>
              <span className="mt-1 inline-block font-bold text-[#c2525b]">{activeCase?.priority || "Medium"}</span>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8aa09f]">Assigned District</p>
              <span className="mt-1 inline-block font-semibold text-[#315a60]">{activeCase?.assignedDistrict || "Barwani"}</span>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8aa09f]">Opened By</p>
              <span className="mt-1 inline-block font-semibold text-[#315a60]">{activeCase?.openedBy || "AI Pipeline"}</span>
            </div>
          </div>

          {/* Investigator Assignment */}
          <div className="rounded-2xl border border-[#dcebe5] bg-[#fbfdfc] p-4">
            <label className="block text-xs font-semibold text-[#214c56]">
              Assign Case to Authorized Investigator / Officer
              <p className="mt-0.5 text-[11px] font-normal text-[#789092]">
                Personnel within the existing RBAC system (District / State / Central technical officers).
              </p>
              <select
                value={assignedUser}
                onChange={e => setAssignedUser(e.target.value)}
                className="mt-2 h-10 w-full rounded-xl border border-[#dfeae6] bg-white px-3 text-xs font-medium text-[#214c56] outline-none focus:border-[#2ba68e] focus:ring-2 focus:ring-[#2ba68e]/10"
              >
                <option value="">-- Select Investigator --</option>
                {investigators.map(inv => (
                  <option key={inv.name} value={inv.name}>
                    {inv.name} — {inv.title}
                  </option>
                ))}
              </select>
            </label>
            {activeCase?.assignedUser && (
              <p className="mt-2 text-[11px] text-[#168873]">
                Currently Assigned: <span className="font-bold">{activeCase.assignedUser}</span>
              </p>
            )}
          </div>

          {/* Previous Remarks */}
          {activeCase?.investigatorRemarks && (
            <div className="rounded-xl border border-[#e1ebe7] bg-[#f9fcfb] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#789092]">Investigation History & Prior Remarks</p>
              <div className="mt-2 max-h-28 overflow-y-auto whitespace-pre-line text-xs text-[#4e6d70] leading-5 pr-1">
                {activeCase.investigatorRemarks}
              </div>
            </div>
          )}

          {/* New Investigator Remarks */}
          <div>
            <label className="block text-xs font-semibold text-[#4e6d70]">
              Add Investigator Remarks / Field Findings
              <textarea
                value={newRemarks}
                onChange={e => setNewRemarks(e.target.value)}
                placeholder="Record inspection observations, contractor interviews, verification of MB entries, justification, or escalation notes..."
                className="mt-1.5 min-h-[85px] w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] p-3 text-xs leading-5 text-[#315a60] outline-none focus:border-[#2ba68e] focus:ring-2 focus:ring-[#2ba68e]/10"
              />
            </label>
          </div>

          {/* Status Disposition */}
          <div>
            <label className="block text-xs font-semibold text-[#4e6d70]">
              Change Case Status
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[
                  { key: "UNDER_INVESTIGATION", label: "Under Investigation", desc: "Field inquiry ongoing", color: "border-[#e7a536] text-[#bd7b1e]" },
                  { key: "RESOLVED", label: "Resolved", desc: "Verification accepted", color: "border-[#1aa67f] text-[#168873]" },
                  { key: "ESCALATED", label: "Escalated", desc: "Referred to higher tier", color: "border-[#d45462] text-[#c2525b]" },
                ].map(item => (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => setStatus(item.key as any)}
                    className={`rounded-xl border p-2.5 text-left transition ${
                      status === item.key ? `bg-[#effaf5] ${item.color} ring-2 ring-[#2ba68e]/20 font-bold` : "border-[#dfeae6] bg-white text-[#5d7a7b] hover:bg-[#fbfdfc]"
                    }`}
                  >
                    <p className="text-xs">{item.label}</p>
                    <p className="text-[9px] font-normal text-[#8ca2a1] mt-0.5">{item.desc}</p>
                  </button>
                ))}
              </div>
            </label>
          </div>

          {/* Verification Evidence */}
          <div className="rounded-2xl border border-[#dcebe5] bg-[#f9fcfb] p-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hasEvidence}
                onChange={e => setHasEvidence(e.target.checked)}
                className="h-4 w-4 rounded accent-[#148774]"
              />
              <span className="text-xs font-bold text-[#214c56] flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-[#168873]" />
                Attach verification inspection report / photo
              </span>
            </label>

            {hasEvidence && (
              <div className="mt-3 space-y-3 pt-3 border-t border-[#e2ede8]">
                <div>
                  <label className="block text-[11px] font-semibold text-[#547274]">
                    Evidence Title
                    <input
                      type="text"
                      value={evidenceTitle}
                      onChange={e => setEvidenceTitle(e.target.value)}
                      placeholder="e.g. Field Inspection Certification Report"
                      className="mt-1 h-9 w-full rounded-lg border border-[#dfeae6] bg-white px-2.5 text-xs text-[#315a60] outline-none"
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#547274]">
                    Upload Report File or Photo
                    <input
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      onChange={handleFileChange}
                      className="mt-1 block w-full text-xs text-[#5d7a7b] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#e7f6f0] file:text-[#168873]"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" onClick={onClose} variant="outline" className="h-10 rounded-xl border-[#dfeae6] bg-white text-xs font-semibold text-[#547274]">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={manageMutation.isPending}
              className="h-10 rounded-xl bg-[#0d8f7b] text-xs font-semibold text-white hover:bg-[#0b7c6d] shadow-md shadow-[#0d8f7b]/20"
            >
              {manageMutation.isPending ? "Updating Case..." : "Update Case & Record Trail"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecommendWorkDialog({
  userName,
  userRole,
  onClose,
  onSuccess,
}: {
  userName: string;
  userRole: RoleKey;
  onClose: () => void;
  onSuccess: (newCode?: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Drinking Water Facility");
  const [stateName, setStateName] = useState("Maharashtra");
  const [district, setDistrict] = useState("Wardha");
  const [constituency, setConstituency] = useState("Wardha (Lok Sabha)");
  const [estimatedAmountLakhs, setEstimatedAmountLakhs] = useState("25.0");
  const [implementingAgency, setImplementingAgency] = useState("District Rural Development Agency (DRDA), Wardha");
  const [justification, setJustification] = useState("");

  const recommendMutation = trpc.monitoring.createRecommendation.useMutation({
    onSuccess: (data) => {
      toast.success("Recommendation recorded successfully", {
        description: `${data.projectCode} · Assigned to ${district} District Authority for processing`,
      });
      onSuccess(data.projectCode);
    },
    onError: (err) => {
      toast.error("Failed to submit recommendation", {
        description: err.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Please enter a work title");
      return;
    }
    const amountVal = parseFloat(estimatedAmountLakhs);
    if (isNaN(amountVal) || amountVal <= 0) {
      toast.error("Please enter a valid estimated amount in Lakhs");
      return;
    }

    recommendMutation.mutate({
      title: title.trim(),
      category,
      state: stateName,
      district,
      constituency,
      estimatedAmount: Math.round(amountVal * 100_000),
      implementingAgency: implementingAgency.trim() || undefined,
      justification: justification.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl border-[#dcebe5] bg-white p-6 rounded-3xl shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#7d5bb5]">
            <PlusCircle className="h-3.5 w-3.5" />
            <span>MP Work Recommendation · MPLADS Guidelines</span>
            <span className="rounded bg-[#f5eefc] px-1.5 py-0.5 text-[9px] text-[#7d5bb5]">AUTHORIZED SCOPE</span>
          </div>
          <DialogTitle className="mt-2 text-xl font-semibold text-[#173e49]">
            Recommend New Public Work
          </DialogTitle>
          <DialogDescription className="text-xs text-[#789092]">
            Submit a development work recommendation for administrative scrutiny, technical vetting, and district sanction in your authorized constituency.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="rounded-xl border border-[#eadfbf] bg-[#fff9e8] p-3 text-xs leading-5 text-[#886b2c]">
            <Info className="inline-block mr-1.5 h-3.5 w-3.5 text-[#bd7b1e]" />
            Under MPLADS guidelines, the Member of Parliament recommends developmental works to the District Authority. District engineers conduct technical scrutiny, prepare estimates, and issue sanction orders.
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-[#4e6d70]">
                Work Title / Name *
                <input
                  type="text"
                  required
                  placeholder="e.g. Construction of Community Drinking Water RO Plant and Storage Tank"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs text-[#214c56] outline-none focus:border-[#7d5bb5] focus:ring-2 focus:ring-[#7d5bb5]/10"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-[#4e6d70]">
                  Work Category *
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-medium text-[#214c56] outline-none focus:border-[#7d5bb5] focus:ring-2 focus:ring-[#7d5bb5]/10"
                  >
                    <option value="Drinking Water Facility">Drinking Water Facility</option>
                    <option value="Education & School Infrastructure">Education & School Infrastructure</option>
                    <option value="Public Health & Sanitation">Public Health & Sanitation</option>
                    <option value="Roads, Pathways & Bridges">Roads, Pathways & Bridges</option>
                    <option value="Rural Electrification & Solar Power">Rural Electrification & Solar Power</option>
                    <option value="Community Multi-Purpose Hall">Community Multi-Purpose Hall</option>
                    <option value="Irrigation & Soil Conservation">Irrigation & Soil Conservation</option>
                    <option value="Public Works">Other Public Works</option>
                  </select>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4e6d70]">
                  Proposed Budget (₹ in Lakhs) *
                  <div className="relative mt-1.5">
                    <input
                      type="number"
                      step="0.1"
                      min="0.5"
                      max="1000"
                      required
                      value={estimatedAmountLakhs}
                      onChange={e => setEstimatedAmountLakhs(e.target.value)}
                      className="h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] pl-3 pr-16 text-xs text-[#214c56] outline-none focus:border-[#7d5bb5] focus:ring-2 focus:ring-[#7d5bb5]/10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#789092]">
                      Lakhs
                    </span>
                  </div>
                </label>
                {parseFloat(estimatedAmountLakhs) > 0 && (
                  <p className="mt-1 text-[10px] text-[#7d5bb5] font-semibold">
                    ≈ ₹{(parseFloat(estimatedAmountLakhs) * 100_000).toLocaleString("en-IN")}
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-[#4e6d70]">
                  State
                  <select
                    value={stateName}
                    onChange={e => setStateName(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-medium text-[#214c56] outline-none"
                  >
                    <option value="Maharashtra">Maharashtra</option>
                    <option value="Madhya Pradesh">Madhya Pradesh</option>
                  </select>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4e6d70]">
                  District *
                  <select
                    value={district}
                    onChange={e => setDistrict(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-medium text-[#214c56] outline-none focus:border-[#7d5bb5] focus:ring-2 focus:ring-[#7d5bb5]/10"
                  >
                    <option value="Wardha">Wardha</option>
                    <option value="Barwani">Barwani</option>
                  </select>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4e6d70]">
                  Constituency
                  <input
                    type="text"
                    value={constituency}
                    onChange={e => setConstituency(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs text-[#214c56] outline-none"
                  />
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#4e6d70]">
                Proposed Implementing Agency
                <input
                  type="text"
                  placeholder="e.g. District Rural Development Agency (DRDA)"
                  value={implementingAgency}
                  onChange={e => setImplementingAgency(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs text-[#214c56] outline-none focus:border-[#7d5bb5] focus:ring-2 focus:ring-[#7d5bb5]/10"
                />
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#4e6d70]">
                Need / Justification & Target Beneficiaries
                <Textarea
                  placeholder="Describe the public utility, village/locality requirement, beneficiary community, and technical rationale..."
                  value={justification}
                  onChange={e => setJustification(e.target.value)}
                  className="mt-1.5 min-h-[85px] w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] p-3 text-xs text-[#214c56] outline-none focus:border-[#7d5bb5] focus:ring-2 focus:ring-[#7d5bb5]/10"
                />
              </label>
            </div>

            <div className="rounded-xl border border-[#e2dcee] bg-[#f9f7fc] p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-[#7d5bb5]" />
                <div>
                  <p className="text-xs font-bold text-[#35254f]">Recommending Authority</p>
                  <p className="text-[10px] text-[#7d5bb5] font-medium">{userName}, MP (Lok Sabha)</p>
                </div>
              </div>
              <span className="rounded-md bg-white px-2 py-1 text-[10px] font-bold text-[#7d5bb5] border border-[#d3c8e6]">
                Role: MP (Authorized)
              </span>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2 pt-3 border-t border-[#edf2ef]">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="h-10 rounded-xl border-[#dfeae6] bg-white text-xs font-semibold text-[#5c797a]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={recommendMutation.isPending || !title.trim()}
              className="h-10 rounded-xl bg-[#7d5bb5] px-5 text-xs font-semibold text-white hover:bg-[#6e4da5] shadow-sm flex items-center gap-1.5"
            >
              {recommendMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Submitting Recommendation...
                </>
              ) : (
                <>
                  <PlusCircle className="h-4 w-4" /> Submit Recommendation
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAG AUDIT & ASSURANCE SPECIALIZED MODULES (AUDIT ONLY)
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. Audit Planning Section ──────────────────────────────────────────────────
function AuditPlanningSection({
  snapshot,
  onSelect,
  onRecordFinding,
}: {
  snapshot: DashboardSnapshot;
  onSelect: (row: TableRow) => void;
  onRecordFinding?: (projectCode?: string) => void;
}) {
  const [riskFilter, setRiskFilter] = useState<string>("All");
  const [anomalyFilter, setAnomalyFilter] = useState<string>("All");
  const [utilizationFilter, setUtilizationFilter] = useState<string>("All");
  const [evidenceFilter, setEvidenceFilter] = useState<string>("All");
  const [search, setSearch] = useState("");

  const filteredProjects = useMemo(() => {
    return snapshot.rows.filter(r => {
      if (riskFilter === "High" && r.risk < 71) return false;
      if (riskFilter === "Medium" && (r.risk < 31 || r.risk > 70)) return false;
      if (riskFilter === "Low" && r.risk > 30) return false;

      const hasAnomalies = (r.anomalies && r.anomalies.length > 0) || r.risk >= 50;
      if (anomalyFilter === "WithAnomalies" && !hasAnomalies) return false;
      if (anomalyFilter === "WithoutAnomalies" && hasAnomalies) return false;

      const sanctioned = r.sanctionedRaw || 1;
      const spent = r.spentRaw || 0;
      const utilPct = sanctioned > 0 ? (spent / sanctioned) * 100 : 0;
      if (utilizationFilter === "Low" && utilPct >= 40) return false;
      if (utilizationFilter === "High" && utilPct < 80) return false;

      if (evidenceFilter === "Pending" && r.progress > 0 && r.risk < 40) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          r.id.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.region.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [snapshot.rows, riskFilter, anomalyFilter, utilizationFilter, evidenceFilter, search]);

  const highRiskCount = snapshot.rows.filter(r => r.risk >= 71).length;
  const duplicateSignals = snapshot.signalStats?.duplicateWork?.count ?? 2;
  const outlierSignals = snapshot.signalStats?.fundMovement?.count ?? 3;

  return (
    <div className="space-y-5">
      {/* Header & Planning Scope */}
      <div className="rounded-[24px] border border-[#dcebe5] bg-white p-6 shadow-[0_10px_30px_rgba(31,82,77,0.05)]">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#c2525b]">
              <Calendar className="h-3.5 w-3.5" />
              <span>Audit & Assurance · Planning & Scoping</span>
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#173e49]">
              Risk-Based Audit Planning
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-[#789092]">
              Identify and prioritize public works for substantive compliance testing, physical verification, and value-for-money audit using explainable AI anomaly signals and expenditure telemetry.
            </p>
          </div>
          {onRecordFinding && (
            <Button
              onClick={() => onRecordFinding()}
              className="h-10 shrink-0 rounded-xl bg-[#c2525b] px-4 text-xs font-semibold text-white hover:bg-[#a83d46] shadow-sm flex items-center gap-1.5"
            >
              <FileWarning className="h-3.5 w-3.5" /> Record Audit Finding
            </Button>
          )}
        </div>

        {/* Audit Assurance Notice */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#d2e3dc] bg-[#f4f9f7] p-3 text-xs text-[#2a5658]">
          <Info className="h-4 w-4 shrink-0 text-[#148774] mt-0.5" />
          <div>
            <strong className="font-semibold text-[#148774]">Audit Planning Assurance Notice:</strong>{" "}
            This planning register is strictly analytical and drawn directly from live project, financial, and AI engine outputs. CAG auditors review and select substantive testing candidates without altering operational project parameters or execution records.
          </div>
        </div>

        {/* Planning Metric Badges */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-[#dfeae6] bg-[#fbfdfc] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#789092]">In Audit Scope</p>
            <p className="mt-1 text-2xl font-bold text-[#173e49]">{snapshot.rows.length}</p>
            <p className="text-[10px] text-[#819696]">Authorized works under review</p>
          </div>
          <div className="rounded-xl border border-[#fbd3d6] bg-[#fff5f5] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#c2525b]">High-Risk Sampling</p>
            <p className="mt-1 text-2xl font-bold text-[#c2525b]">{highRiskCount}</p>
            <p className="text-[10px] text-[#b0525a]">Priority substantive review</p>
          </div>
          <div className="rounded-xl border border-[#fae4ba] bg-[#fffcf3] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#bd7b1e]">Overlap Signals</p>
            <p className="mt-1 text-2xl font-bold text-[#bd7b1e]">{duplicateSignals}</p>
            <p className="text-[10px] text-[#8e6224]">Semantic similarity flags</p>
          </div>
          <div className="rounded-xl border border-[#d6e5fa] bg-[#f4f8fe] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#356db3]">Outlier Telemetry</p>
            <p className="mt-1 text-2xl font-bold text-[#356db3]">{outlierSignals}</p>
            <p className="text-[10px] text-[#4d6d96]">Fund velocity variances</p>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="mt-5 flex flex-wrap gap-2.5 pt-4 border-t border-[#edf2ef]">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9ab0af]" />
            <input
              type="text"
              placeholder="Search by Work ID, title, or district..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] pl-9 pr-3 text-xs text-[#214c56] outline-none focus:border-[#c2525b] focus:ring-1 focus:ring-[#c2525b]/20"
            />
          </div>
          <select
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value)}
            className="h-9 rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-semibold text-[#547174] outline-none"
          >
            <option value="All">All Risk Profiles</option>
            <option value="High">High Risk (71+)</option>
            <option value="Medium">Medium Risk (31-70)</option>
            <option value="Low">Low Risk (0-30)</option>
          </select>
          <select
            value={anomalyFilter}
            onChange={e => setAnomalyFilter(e.target.value)}
            className="h-9 rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-semibold text-[#547174] outline-none"
          >
            <option value="All">All AI Signals</option>
            <option value="WithAnomalies">With AI Anomalies</option>
            <option value="WithoutAnomalies">Without Anomalies</option>
          </select>
          <select
            value={utilizationFilter}
            onChange={e => setUtilizationFilter(e.target.value)}
            className="h-9 rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-semibold text-[#547174] outline-none"
          >
            <option value="All">All Utilization</option>
            <option value="Low">Low Utilization (&lt; 40%)</option>
            <option value="High">High Utilization (&gt; 80%)</option>
          </select>
          <select
            value={evidenceFilter}
            onChange={e => setEvidenceFilter(e.target.value)}
            className="h-9 rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-semibold text-[#547174] outline-none"
          >
            <option value="All">All Evidence States</option>
            <option value="Pending">Evidence Pending Review</option>
          </select>
        </div>
      </div>

      {/* Audit Candidate Sample Table */}
      <div className="overflow-hidden rounded-[24px] border border-[#dcebe5] bg-white shadow-sm">
        <div className="border-b border-[#edf2ef] px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#173e49]">
              Substantive Testing Candidate Works ({filteredProjects.length})
            </h3>
            <p className="text-[11px] text-[#789092]">
              Ranked by composite audit risk score and algorithmic anomaly detection
            </p>
          </div>
          <span className="rounded-md bg-[#f1f5f4] px-2.5 py-1 text-[10px] font-bold text-[#5c797a]">
            Read-Only Audit Mode
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#edf2ef] bg-[#fbfdfc] text-[10px] font-bold uppercase tracking-wider text-[#6d8c8c]">
              <tr>
                <th className="py-3 px-4">Work / Project ID</th>
                <th className="py-3 px-4">Project Title & District</th>
                <th className="py-3 px-4">Sanctioned / Spent</th>
                <th className="py-3 px-4">Physical Progress</th>
                <th className="py-3 px-4">Risk Score</th>
                <th className="py-3 px-4">AI Detection Engines</th>
                <th className="py-3 px-4 text-right">Assurance Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f2f6f4]">
              {filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-[#789092]">
                    No works match the selected audit planning criteria.
                  </td>
                </tr>
              ) : (
                filteredProjects.map(p => {
                  const riskBadge =
                    p.risk >= 71
                      ? "bg-[#fff0f1] text-[#c2525b] border-[#fed7d7]"
                      : p.risk >= 31
                      ? "bg-[#fff9eb] text-[#bd7b1e] border-[#fae2b1]"
                      : "bg-[#effaf5] text-[#168873] border-[#ceeae1]";

                  return (
                    <tr key={p.id} className="hover:bg-[#f7fbf9] transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-[#173e49]">
                        {p.id}
                      </td>
                      <td className="py-3 px-4 max-w-[260px]">
                        <p className="font-semibold text-[#214c56] truncate">{p.title}</p>
                        <p className="text-[10px] text-[#789092]">{p.region} · {p.status}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-[#214c56]">{p.amount}</p>
                        <p className="text-[10px] text-[#789092]">{p.spent || "₹0"} spent</p>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#eef4f1]">
                            <div className="h-full rounded-full bg-[#168873]" style={{ width: `${p.progress}%` }} />
                          </div>
                          <span className="font-medium text-[#214c56]">{p.progress}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold ${riskBadge}`}>
                          {p.risk} / 100
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {p.anomalies && p.anomalies.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {p.anomalies.map((a, i) => (
                              <span key={i} className="rounded bg-[#fee2e2] px-1.5 py-0.5 text-[9px] font-bold text-[#991b1b]">
                                {a.moduleType.replace("_", " ")}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] text-[#8ca2a1]">None flagged</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onSelect(p)}
                            className="h-7 rounded-lg border-[#dcebe5] px-2 text-[10px] font-semibold text-[#168873] hover:bg-[#effaf5]"
                          >
                            <Eye className="mr-1 h-3 w-3" /> Dossier
                          </Button>
                          {onRecordFinding && (
                            <Button
                              size="sm"
                              onClick={() => onRecordFinding(p.id)}
                              className="h-7 rounded-lg bg-[#c2525b] px-2 text-[10px] font-semibold text-white hover:bg-[#a83d46]"
                            >
                              <FileWarning className="mr-1 h-3 w-3" /> Record Finding
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── 2. CAG Risk Assessment Section (AI Risk Assessment — For Audit Review) ────
function CagRiskAssessmentSection({
  snapshot,
  onSelect,
  onRecordFinding,
}: {
  snapshot: DashboardSnapshot;
  onSelect: (row: TableRow) => void;
  onRecordFinding?: (projectCode?: string) => void;
}) {
  const signalStats = snapshot.signalStats;

  const engines = [
    {
      id: "duplicate",
      name: "1. Duplicate Work — Semantic Similarity",
      model: "Sentence-BERT / TF-IDF Vectorization",
      flagCount: signalStats?.duplicateWork?.count ?? 2,
      maxScore: signalStats?.duplicateWork?.percentageText ?? "88.4%",
      status: signalStats?.duplicateWork?.statusText ?? "Active Overlap Flags",
      description:
        "Calculates cosine similarity across proposed and past project descriptions to detect identical or overlapping civic infrastructure works funded under different budget heads or recurring years.",
      assuranceNote:
        "Semantic similarity signals thematic or textual coincidence. High similarity requires field verification of actual physical site coordinates before establishing duplicity.",
      border: "border-[#e0c4e8]",
      bg: "bg-[#faf6fc]",
      accent: "#7d5bb5",
    },
    {
      id: "fund",
      name: "2. Fund Movement — Isolation Forest",
      model: "Unsupervised Tree Ensemble (Isolation Forest)",
      flagCount: signalStats?.fundMovement?.count ?? 3,
      maxScore: signalStats?.fundMovement?.percentageText ?? "91.2%",
      status: signalStats?.fundMovement?.statusText ?? "Disbursement Outliers",
      description:
        "Multivariate isolation score evaluated on disbursement velocity, tranche quantum, and physical progress curve to highlight rapid lump-sum draws unsupported by on-site progress.",
      assuranceNote:
        "Disbursement outliers detect statistical divergence from expected expenditure patterns. Legitimate lump-sum mobilization advances may trigger this engine.",
      border: "border-[#fcd9bd]",
      bg: "bg-[#fdf8f4]",
      accent: "#bd7b1e",
    },
    {
      id: "delay",
      name: "3. Delay Risk — Random Forest",
      model: "Supervised Classification (Random Forest)",
      flagCount: signalStats?.delayRisk?.count ?? 4,
      maxScore: signalStats?.delayRisk?.percentageText ?? "84.0%",
      status: signalStats?.delayRisk?.statusText ?? "Slippage Predicted",
      description:
        "Predicts project completion slippage based on implementing agency track record, geographical terrain, seasonal monsoon factors, and sanctioned milestone durations.",
      assuranceNote:
        "Evaluates milestone vulnerability and time overrun probabilities to guide timely audit intervention and prevent idle capital lock-in.",
      border: "border-[#fed7d7]",
      bg: "bg-[#fff7f7]",
      accent: "#c2525b",
    },
    {
      id: "evidence",
      name: "4. Evidence Reuse — Image Similarity",
      model: "64-bit dHash Perceptual Hashing & Hamming Distance",
      flagCount: signalStats?.evidenceReuse?.count ?? 1,
      maxScore: signalStats?.evidenceReuse?.percentageText ?? "96.5%",
      status: signalStats?.evidenceReuse?.statusText ?? "Hash Collision Flagged",
      description:
        "Computes 64-bit difference hash (dHash) on uploaded photographic evidence across all projects and districts. Flags photographic recycling or re-uploaded inspection pictures.",
      assuranceNote:
        "Matches indicate photographic duplication across works. Confirms whether the same physical asset has been claimed as evidence for multiple distinct sanctioned sanctions.",
      border: "border-[#bfe2d7]",
      bg: "bg-[#f4faf7]",
      accent: "#168873",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Required Title & Disclaimer Box */}
      <div className="rounded-[24px] border border-[#dcebe5] bg-white p-6 shadow-[0_10px_30px_rgba(31,82,77,0.05)]">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#168873]">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Independent Assurance Engine</span>
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#173e49]">
              AI Risk Assessment — For Audit Review
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-[#789092]">
              Algorithmic triage scores synthesize 4 specialized machine learning models to identify anomalies, disbursement anomalies, delay vulnerabilities, and evidence integrity risks.
            </p>
          </div>
          {onRecordFinding && (
            <Button
              onClick={() => onRecordFinding()}
              className="h-10 shrink-0 rounded-xl bg-[#c2525b] px-4 text-xs font-semibold text-white hover:bg-[#a83d46] shadow-sm flex items-center gap-1.5"
            >
              <FileWarning className="h-3.5 w-3.5" /> Record Audit Finding
            </Button>
          )}
        </div>

        {/* Required Specific Disclaimer Wording */}
        <div className="mt-4 rounded-xl border border-[#fae2b1] bg-[#fffaf0] p-4 text-xs text-[#785b24]">
          <div className="flex items-center gap-2 font-bold text-sm text-[#8c651e]">
            <ShieldAlert className="h-4 w-4 text-[#bd7b1e]" />
            AI signals support audit review and do not establish fraud.
          </div>
          <p className="mt-1.5 text-[11px] leading-5 text-[#8c651e]/90">
            Algorithmic anomaly flags are heuristic triage indicators to assist CAG audit teams in risk-based sampling and substantive testing. Operational parameters, execution milestones, and ML scores are read-only and immutable within the audit role. CAG officers cannot modify scores, override anomaly results, or trigger ad-hoc model retraining from this interface.
          </p>
        </div>
      </div>

      {/* 4 Machine Learning Anomaly Engines Grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {engines.map(eng => (
          <div
            key={eng.id}
            className={`rounded-2xl border ${eng.border} ${eng.bg} p-5 shadow-xs flex flex-col justify-between`}
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-[#173e49]">{eng.name}</h3>
                  <p className="text-[10px] font-mono font-medium text-[#789092]">{eng.model}</p>
                </div>
                <span
                  className="rounded-lg px-2 py-0.5 text-[10px] font-bold text-white shrink-0"
                  style={{ backgroundColor: eng.accent }}
                >
                  {eng.flagCount} Flagged
                </span>
              </div>
              <p className="mt-3 text-xs leading-5 text-[#4e6d70]">{eng.description}</p>
            </div>
            <div className="mt-4 pt-3 border-t border-black/5 text-[11px] text-[#6b8586]">
              <div className="flex justify-between items-center text-[10px] font-semibold">
                <span>Signal Intensity: <strong className="text-[#173e49]">{eng.maxScore}</strong></span>
                <span className="text-[#5c797a]">{eng.status}</span>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-[#789092] italic">
                {eng.assuranceNote}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Flagged Projects Under AI Assessment */}
      <div className="overflow-hidden rounded-[24px] border border-[#dcebe5] bg-white shadow-sm">
        <div className="border-b border-[#edf2ef] px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#173e49]">
              Portfolio Works Flagged by Detection Engines
            </h3>
            <p className="text-[11px] text-[#789092]">
              Detailed explainable AI factors for substantive audit verification
            </p>
          </div>
          <span className="rounded-md bg-[#eefaf6] px-2.5 py-1 text-[10px] font-bold text-[#168873] border border-[#d4ede4]">
            Explainable AI Active
          </span>
        </div>

        <div className="divide-y divide-[#f2f6f4]">
          {snapshot.rows
            .filter(r => r.risk >= 40 || (r.anomalies && r.anomalies.length > 0))
            .slice(0, 10)
            .map(p => (
              <div key={p.id} className="p-4 sm:p-5 hover:bg-[#fafcfb] transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-[#173e49]">{p.id}</span>
                      <span className="text-[#b4c8c4]">·</span>
                      <span className="text-xs font-bold text-[#214c56]">{p.title}</span>
                      <span className="rounded bg-[#f1f5f4] px-1.5 py-0.5 text-[9px] font-medium text-[#5c797a]">
                        {p.region}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-[#5d7a7b] leading-relaxed">
                      {p.aiReasoning || "Algorithmic factors within normal operational band."}
                    </p>
                    {p.anomalies && p.anomalies.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {p.anomalies.map((a, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-md bg-[#fff0f1] px-2 py-0.5 text-[10px] font-bold text-[#c2525b] border border-[#fed7d7]"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {a.moduleType.replace("_", " ")}: {(a.score * 100).toFixed(0)}% ({a.severity})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end justify-between shrink-0 gap-2">
                    <span
                      className={`rounded-md border px-2.5 py-1 text-xs font-bold ${
                        p.risk >= 71
                          ? "bg-[#fff0f1] text-[#c2525b] border-[#fed7d7]"
                          : "bg-[#fff9eb] text-[#bd7b1e] border-[#fae2b1]"
                      }`}
                    >
                      Risk: {p.risk} / 100
                    </span>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSelect(p)}
                        className="h-7 rounded-lg border-[#dcebe5] px-2 text-[10px] font-semibold text-[#168873] hover:bg-[#effaf5]"
                      >
                        <Eye className="mr-1 h-3 w-3" /> Dossier
                      </Button>
                      {onRecordFinding && (
                        <Button
                          size="sm"
                          onClick={() => onRecordFinding(p.id)}
                          className="h-7 rounded-lg bg-[#c2525b] px-2 text-[10px] font-semibold text-white hover:bg-[#a83d46]"
                        >
                          <FileWarning className="mr-1 h-3 w-3" /> Finding
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ── 3. Audit Findings Section ──────────────────────────────────────────────────
function AuditFindingsSection({
  snapshot,
  onSelect,
  onRecordFinding,
}: {
  snapshot: DashboardSnapshot;
  onSelect: (row: TableRow) => void;
  onRecordFinding?: (projectCode?: string) => void;
}) {
  const findingsQuery = trpc.monitoring.getAuditFindings.useQuery();
  const casesQuery = trpc.monitoring.getCases.useQuery();

  const allObservations = useMemo(() => {
    const list = [...(findingsQuery.data || [])];
    if (casesQuery.data) {
      for (const c of casesQuery.data) {
        if (!list.some(item => item.caseNumber === c.caseNumber)) {
          if (c.status === "AUDIT_OBSERVATION" || c.caseNumber.startsWith("AUD-")) {
            list.push(c as any);
          }
        }
      }
    }
    return list;
  }, [findingsQuery.data, casesQuery.data]);

  const criticalCount = allObservations.filter(
    (f: any) => f.priority === "Critical" || f.priority === "High" || f.severity === "Critical" || f.severity === "High"
  ).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-[24px] border border-[#dcebe5] bg-white p-6 shadow-[0_10px_30px_rgba(31,82,77,0.05)]">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#c2525b]">
              <FileWarning className="h-3.5 w-3.5" />
              <span>Audit & Assurance · Statutory Observations</span>
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#173e49]">
              Audit Findings & Observations Register
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-[#789092]">
              Formal audit observations issued under Section 19 of the CAG (DPC) Act, 1971. Management responses and remedial rectifications are tracked through completion.
            </p>
          </div>
          {onRecordFinding && (
            <Button
              onClick={() => onRecordFinding()}
              className="h-10 shrink-0 rounded-xl bg-[#c2525b] px-4 text-xs font-semibold text-white hover:bg-[#a83d46] shadow-sm flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" /> Record Audit Finding
            </Button>
          )}
        </div>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-[#dfeae6] bg-[#fbfdfc] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#789092]">Total Findings</p>
            <p className="mt-1 text-2xl font-bold text-[#173e49]">{allObservations.length}</p>
            <p className="text-[10px] text-[#819696]">Formally entered in register</p>
          </div>
          <div className="rounded-xl border border-[#fbd3d6] bg-[#fff5f5] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#c2525b]">Material / High</p>
            <p className="mt-1 text-2xl font-bold text-[#c2525b]">{criticalCount}</p>
            <p className="text-[10px] text-[#b0525a]">Critical financial or physical risks</p>
          </div>
          <div className="rounded-xl border border-[#fae4ba] bg-[#fffcf3] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#bd7b1e]">Response Pending</p>
            <p className="mt-1 text-2xl font-bold text-[#bd7b1e]">
              {allObservations.filter(f => f.status === "AUDIT_OBSERVATION").length}
            </p>
            <p className="text-[10px] text-[#8e6224]">Awaiting District/State reply</p>
          </div>
          <div className="rounded-xl border border-[#d6e5fa] bg-[#f4f8fe] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#356db3]">Response Timeline</p>
            <p className="mt-1 text-2xl font-bold text-[#356db3]">15 Days</p>
            <p className="text-[10px] text-[#4d6d96]">Standard audit response window</p>
          </div>
        </div>
      </div>

      {/* Findings Table */}
      <div className="overflow-hidden rounded-[24px] border border-[#dcebe5] bg-white shadow-sm">
        <div className="border-b border-[#edf2ef] px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#173e49]">
              Audit Findings Register ({allObservations.length})
            </h3>
            <p className="text-[11px] text-[#789092]">
              Track observations, audit recommendations, and management replies
            </p>
          </div>
          {findingsQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin text-[#168873]" />}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#edf2ef] bg-[#fbfdfc] text-[10px] font-bold uppercase tracking-wider text-[#6d8c8c]">
              <tr>
                <th className="py-3 px-4">Finding Ref</th>
                <th className="py-3 px-4">Work ID & Observation</th>
                <th className="py-3 px-4">Severity</th>
                <th className="py-3 px-4">Assigned Entity</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Recorded By</th>
                <th className="py-3 px-4 text-right">Dossier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f2f6f4]">
              {allObservations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-[#789092]">
                    No audit findings recorded yet. Click "Record Audit Finding" to enter an observation.
                  </td>
                </tr>
              ) : (
                allObservations.map((f: any) => {
                  const severity = f.priority || f.severity || "Medium";
                  const sevStyle =
                    severity === "Critical"
                      ? "bg-[#fff0f1] text-[#c2525b] border-[#fed7d7]"
                      : severity === "High"
                      ? "bg-[#fff5f5] text-[#e04550] border-[#fcd0d3]"
                      : severity === "Medium"
                      ? "bg-[#fff9eb] text-[#bd7b1e] border-[#fae2b1]"
                      : "bg-[#effaf5] text-[#168873] border-[#ceeae1]";

                  const matchingRow = snapshot.rows.find(r => r.id === f.projectCode);

                  return (
                    <tr key={f.id || f.caseNumber} className="hover:bg-[#f7fbf9] transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-[#c2525b]">
                        {f.caseNumber}
                      </td>
                      <td className="py-3 px-4 max-w-[280px]">
                        <p className="font-semibold text-[#173e49] truncate">{f.title || f.issueSummary}</p>
                        <p className="text-[10px] font-mono text-[#789092]">{f.projectCode}</p>
                        {f.description && (
                          <p className="mt-1 text-[10px] text-[#556d6e] line-clamp-2">
                            {f.description}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold ${sevStyle}`}>
                          {severity}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-semibold text-[#214c56] uppercase text-[10px]">
                          {f.assignedRole || "District Authority"}
                        </span>
                        <p className="text-[9px] text-[#789092]">{f.assignedDistrict || "Local District"}</p>
                      </td>
                      <td className="py-3 px-4">
                        <span className="rounded bg-[#fef3c7] px-2 py-0.5 text-[9px] font-bold text-[#92400e] border border-[#fde68a]">
                          {f.status || "AUDIT_OBSERVATION"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[10px] text-[#789092]">
                        <p className="font-medium text-[#214c56]">{f.openedBy || "CAG Audit Officer"}</p>
                        <p className="text-[9px]">
                          {f.createdAt ? new Date(f.createdAt).toLocaleDateString("en-IN") : "Recorded"}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {matchingRow ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onSelect(matchingRow)}
                            className="h-7 rounded-lg border-[#dcebe5] px-2 text-[10px] font-semibold text-[#168873] hover:bg-[#effaf5]"
                          >
                            <Eye className="mr-1 h-3 w-3" /> View
                          </Button>
                        ) : (
                          <span className="text-[10px] text-[#8ca2a1]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── 4. Record Audit Finding Dialog ─────────────────────────────────────────────
function RecordAuditFindingDialog({
  userRole,
  userName,
  initialProjectCode,
  availableProjects,
  onClose,
  onSuccess,
}: {
  userRole: RoleKey;
  userName: string;
  initialProjectCode?: string;
  availableProjects: Array<{ id: string; title: string; region: string }>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [projectCode, setProjectCode] = useState(initialProjectCode || availableProjects[0]?.id || "");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Financial Irregularity / Fund Misapplication");
  const [severity, setSeverity] = useState<"Critical" | "High" | "Medium" | "Low">("High");
  const [targetRole, setTargetRole] = useState<"district" | "state" | "mospi">("district");
  const [financialImplication, setFinancialImplication] = useState("");
  const [observation, setObservation] = useState("");
  const [recommendation, setRecommendation] = useState("");

  const recordMutation = trpc.monitoring.recordAuditFinding.useMutation({
    onSuccess: data => {
      toast.success("Audit Finding Recorded", {
        description: `${data.caseNumber} registered in cases & immutable audit trail.`,
      });
      onSuccess();
    },
    onError: err => {
      toast.error("Failed to record audit finding", {
        description: err.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectCode) {
      toast.error("Please select a project / work");
      return;
    }
    if (title.trim().length < 3) {
      toast.error("Finding title must be at least 3 characters");
      return;
    }
    if (observation.trim().length < 10) {
      toast.error("Detailed observation must be at least 10 characters");
      return;
    }

    const finVal = financialImplication ? parseFloat(financialImplication) : 0;

    recordMutation.mutate({
      projectCode,
      title: title.trim(),
      category,
      severity,
      targetRole,
      financialImplication: isNaN(finVal) ? 0 : finVal,
      observation: observation.trim(),
      recommendation: recommendation.trim() || undefined,
    });
  };

  return (
    <Dialog open={true} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-xl overflow-hidden rounded-3xl bg-white p-0 shadow-2xl border border-[#fed7d7]">
        <DialogHeader className="border-b border-[#fed7d7] bg-[#fff5f5] px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#c2525b] text-white shadow-sm">
              <FileWarning className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-[#173e49]">
                Record Audit Observation & Finding
              </DialogTitle>
              <DialogDescription className="text-xs text-[#789092]">
                Statutory audit observation issued under independent assurance oversight (CAG)
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4 max-h-[68vh] overflow-y-auto pr-1">
            {/* Project Select */}
            <div>
              <label className="block text-xs font-semibold text-[#4e6d70]">
                Work / Project Under Audit *
                <select
                  value={projectCode}
                  onChange={e => setProjectCode(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-medium text-[#214c56] outline-none focus:border-[#c2525b] focus:ring-1 focus:ring-[#c2525b]/20"
                >
                  {availableProjects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.id} — {p.title} ({p.region})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs font-semibold text-[#4e6d70]">
                Audit Observation Title *
                <input
                  type="text"
                  placeholder="e.g. Unexplained disbursement spike without corresponding MB entry"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs text-[#214c56] outline-none focus:border-[#c2525b] focus:ring-1 focus:ring-[#c2525b]/20"
                />
              </label>
            </div>

            {/* Category & Severity */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#4e6d70]">
                  Category *
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-medium text-[#214c56] outline-none focus:border-[#c2525b]"
                  >
                    <option value="Financial Irregularity / Fund Misapplication">Financial Irregularity</option>
                    <option value="Physical Non-execution / False Progress">Physical Non-execution</option>
                    <option value="Measurement Book / Quantity Discrepancy">Measurement Book Discrepancy</option>
                    <option value="Duplicate / Overlapping Work">Duplicate / Overlapping Work</option>
                    <option value="Inadequate / Recycled Evidence">Inadequate / Recycled Evidence</option>
                    <option value="Procurement / Tender Violation">Procurement / Tender Violation</option>
                    <option value="Delay & Liquidated Damages">Delay & Liquidated Damages</option>
                  </select>
                </label>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#4e6d70]">
                  Audit Severity *
                  <select
                    value={severity}
                    onChange={e => setSeverity(e.target.value as any)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-medium text-[#214c56] outline-none focus:border-[#c2525b]"
                  >
                    <option value="Critical">Critical (Immediate Escalation)</option>
                    <option value="High">High (Substantive Finding)</option>
                    <option value="Medium">Medium (Compliance Variance)</option>
                    <option value="Low">Low (Procedural Advisory)</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Target Role & Financial Implication */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#4e6d70]">
                  Entity Assigned for Response *
                  <select
                    value={targetRole}
                    onChange={e => setTargetRole(e.target.value as any)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs font-medium text-[#214c56] outline-none focus:border-[#c2525b]"
                  >
                    <option value="district">District Authority (Implementing Entity)</option>
                    <option value="state">State Nodal Department (Oversight)</option>
                    <option value="mospi">MoSPI (Central Ministry)</option>
                  </select>
                </label>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#4e6d70]">
                  Financial Implication (₹ optional)
                  <input
                    type="number"
                    placeholder="e.g. 850000"
                    value={financialImplication}
                    onChange={e => setFinancialImplication(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] px-3 text-xs text-[#214c56] outline-none focus:border-[#c2525b]"
                  />
                </label>
              </div>
            </div>

            {/* Observation */}
            <div>
              <label className="block text-xs font-semibold text-[#4e6d70]">
                Detailed Audit Observation & Audit Evidence *
                <Textarea
                  placeholder="Detail the factual findings, physical verification results, documentary inconsistencies, vouchers, or measurement discrepancies..."
                  value={observation}
                  onChange={e => setObservation(e.target.value)}
                  className="mt-1.5 min-h-[90px] w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] p-3 text-xs text-[#214c56] outline-none focus:border-[#c2525b]"
                />
              </label>
            </div>

            {/* Recommendation */}
            <div>
              <label className="block text-xs font-semibold text-[#4e6d70]">
                Audit Recommendation / Remedial Action Required
                <Textarea
                  placeholder="State the corrective recovery, physical re-measurement, disciplinary action, or reconciliation required by the entity..."
                  value={recommendation}
                  onChange={e => setRecommendation(e.target.value)}
                  className="mt-1.5 min-h-[75px] w-full rounded-xl border border-[#dfeae6] bg-[#fbfdfc] p-3 text-xs text-[#214c56] outline-none focus:border-[#c2525b]"
                />
              </label>
            </div>

            {/* Auditor Details & Assurance Info */}
            <div className="rounded-xl border border-[#fed7d7] bg-[#fff5f5] p-3 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-[#c2525b]" />
                <div>
                  <p className="font-bold text-[#173e49]">Issuing Audit Officer</p>
                  <p className="text-[10px] text-[#c2525b] font-medium">{userName}, Senior Audit Officer (CAG)</p>
                </div>
              </div>
              <span className="rounded-md bg-white px-2 py-1 text-[10px] font-bold text-[#c2525b] border border-[#fcd0d3]">
                15 Days Reply Deadline
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-5 flex justify-end gap-2 pt-3 border-t border-[#edf2ef]">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="h-10 rounded-xl border-[#dfeae6] bg-white text-xs font-semibold text-[#5c797a]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={recordMutation.isPending || !title.trim() || observation.trim().length < 10}
              className="h-10 rounded-xl bg-[#c2525b] px-5 text-xs font-semibold text-white hover:bg-[#a83d46] shadow-sm flex items-center gap-1.5"
            >
              {recordMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Recording Finding...
                </>
              ) : (
                <>
                  <FileWarning className="h-4 w-4" /> Issue Audit Finding
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

