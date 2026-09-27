import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ROLE_DEFINITIONS, type RoleKey } from "@shared/monitoring";
import {
  Activity,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarCheck,
  ChevronDown,
  ClipboardCheck,
  FileBarChart,
  FileSearch,
  FileWarning,
  Files,
  History,
  IndianRupee,
  Landmark,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Map,
  MessageSquareMore,
  PanelLeft,
  PlusCircle,
  Radar,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { NigraaniShieldIcon } from "@/components/NigraaniLogo";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";

const icons: Record<string, LucideIcon> = {
  Activity,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarCheck,
  ClipboardCheck,
  FileBarChart,
  FileSearch,
  FileWarning,
  Files,
  History,
  IndianRupee,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Map,
  MessageSquareMore,
  PlusCircle,
  Radar,
  Settings2,
  ShieldCheck,
  Sparkles,
};

export default function DashboardLayout({
  activeKey,
  onNavigate,
  children,
}: {
  activeKey: string;
  onNavigate: (key: string) => void;
  children: React.ReactNode;
}) {
  const { loading, user } = useAuth();
  if (loading || !user) return null;
  const role = user.role as RoleKey;
  const definition = ROLE_DEFINITIONS[role];

  return (
    <SidebarProvider defaultOpen>
      <DashboardSidebar role={role} activeKey={activeKey} onNavigate={onNavigate} />
      <SidebarInset className="min-h-screen bg-[#f5f8f7]">
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-[#dfe9e5] bg-[#f5f8f7]/95 px-5 backdrop-blur-xl lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger className="h-9 w-9 rounded-xl border border-[#dfe9e5] bg-white text-[#49636a] shadow-sm lg:hidden" />
            <div className="hidden h-8 w-px bg-[#dfe9e5] lg:block" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6e8689]">
                <span>Workspace</span><span className="text-[#b4c8c4]">/</span><span className="truncate text-[#174652]">{definition.shortLabel}</span>
              </div>
              <p className="mt-1 truncate text-xs text-[#7b9091]">{definition.scopeLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden items-center gap-2 rounded-full border border-[#dcebe5] bg-white px-3 py-2 text-xs font-medium text-[#42656a] shadow-sm sm:flex">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#19a37d]" /> All systems operational
            </div>
            <button className="relative grid h-9 w-9 place-items-center rounded-xl border border-[#dfe9e5] bg-white text-[#5b7779] shadow-sm transition hover:-translate-y-0.5 hover:text-[#127a70]" aria-label="Notifications">
              <Bell className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#d95862]" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 gap-2 rounded-xl px-2 hover:bg-white">
                  <Avatar className="h-8 w-8 border border-[#bfe2d7] bg-[#e6f5ef]"><AvatarFallback className="bg-[#e6f5ef] text-xs font-bold text-[#127a70]">{user.name?.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                  <span className="hidden text-left sm:block"><span className="block text-xs font-semibold text-[#173e49]">{user.name}</span><span className="block text-[10px] text-[#7b9091]">{definition.shortLabel}</span></span>
                  <ChevronDown className="h-3.5 w-3.5 text-[#8ca3a3]" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-2xl border-[#dfe9e5] p-2 shadow-xl">
                <div className="border-b border-[#edf2ef] px-3 pb-2 pt-1"><p className="text-xs font-semibold text-[#173e49]">Signed in as {user.name}</p><p className="mt-1 text-[11px] text-[#789092]">{user.email}</p></div>
                <DropdownMenuItem onClick={() => void useAuth} className="mt-1 cursor-default rounded-xl text-xs text-[#547174]">{definition.scopeLabel}</DropdownMenuItem>
                <SignOutItem />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 pb-12 pt-6 sm:px-6 lg:px-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function SignOutItem() {
  const { logout } = useAuth();
  return <DropdownMenuItem onClick={() => void logout()} className="cursor-pointer rounded-xl text-xs text-[#bf4f58] focus:text-[#bf4f58]"><LogOut className="mr-2 h-3.5 w-3.5" /> Sign out</DropdownMenuItem>;
}

function DashboardSidebar({ role, activeKey, onNavigate }: { role: RoleKey; activeKey: string; onNavigate: (key: string) => void }) {
  const { state, toggleSidebar } = useSidebar();
  const definition = useMemo(() => ROLE_DEFINITIONS[role], [role]);
  return (
    <Sidebar collapsible="icon" className="border-r-0 bg-[#0b2934] text-[#d6eeea]">
      <SidebarHeader className="h-[72px] border-b border-white/10 px-3">
        <div className="flex h-full items-center gap-3">
          <button onClick={toggleSidebar} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#13a68b] text-white shadow-lg shadow-[#13a68b]/20 transition hover:bg-[#20b99b]" aria-label="Toggle navigation">
            <NigraaniShieldIcon className="h-5 w-5" />
          </button>
          {state !== "collapsed" && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight text-white">NIGRAANI AI</p>
              <p className="truncate text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#7db8ae]">AI-Powered MPLAD Monitoring</p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-4">
        {state !== "collapsed" && <p className="px-3 pb-2 text-[9px] font-bold uppercase tracking-[0.22em] text-[#6c9d98]">Monitoring workspace</p>}
        <SidebarMenu className="gap-1">
          {definition.nav.map(item => {
            const Icon = icons[item.icon] ?? LayoutDashboard;
            const active = activeKey === item.key;
            return <SidebarMenuItem key={item.key}><SidebarMenuButton isActive={active} onClick={() => onNavigate(item.key)} tooltip={item.label} className={`h-10 rounded-xl text-[12px] transition ${active ? "bg-[#0e9c83] font-semibold text-white shadow-lg shadow-[#0e9c83]/15 hover:bg-[#0e9c83] hover:text-white" : "text-[#9fc4c0] hover:bg-white/8 hover:text-white"}`}><Icon className="h-4 w-4" /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>;
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="border-t border-white/10 p-3">
        {state !== "collapsed" && <div className="rounded-2xl bg-white/6 p-3"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#63d2b2]" /><span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8ec3b7]">Scoped access</span></div><p className="mt-2 text-[11px] leading-relaxed text-[#8fb5b0]">{definition.scopeLabel}</p></div>}
      </SidebarFooter>
    </Sidebar>
  );
}
