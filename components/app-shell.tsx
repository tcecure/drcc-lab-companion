import Link from "next/link";
import {
  Activity,
  Bell,
  Bot,
  BookOpen,
  ClipboardCheck,
  Gauge,
  GraduationCap,
  HelpCircle,
  Import,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Mail,
  MessageSquareText,
  Server,
  ShieldCheck,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { logoutAction } from "@/lib/actions/auth";
import { canManage, isAdmin, type PortalRole } from "@/lib/roles";

type NavItem = {
  adminOnly?: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
};

const studentNav: NavItem[] = [
  { href: "/student", icon: LayoutDashboard, label: "Overview" },
  { href: "/student/guides", icon: BookOpen, label: "Lab Guides" },
  { href: "/student/labs", icon: Server, label: "Labs" },
  { href: "/student/queue", icon: ListChecks, label: "Queue Status" },
  { href: "/student/training", icon: GraduationCap, label: "Training" },
  { href: "/student/notifications", icon: Bell, label: "Notifications" },
  { href: "/student/profile", icon: User, label: "Profile" },
  { href: "/student/support", icon: HelpCircle, label: "Support" },
];

const adminNav: NavItem[] = [
  { href: "/admin", icon: ShieldCheck, label: "Admin Overview" },
  {
    adminOnly: true,
    href: "/admin/users",
    icon: Users,
    label: "User Management",
  },
  { href: "/admin/guides", icon: BookOpen, label: "Current Lab Guides" },
  { href: "/admin/lab-status", icon: Activity, label: "Lab Metrics" },
  { href: "/admin/labops", icon: Bot, label: "LabOps AI" },
  {
    adminOnly: true,
    href: "/admin/support",
    icon: MessageSquareText,
    label: "Support Tickets",
  },
  { href: "/admin/approvals", icon: ClipboardCheck, label: "Approvals" },
  { href: "/admin/queue", icon: Users, label: "Student Queue" },
  {
    href: "/admin/progress",
    icon: GraduationCap,
    label: "Student Progress",
  },
  { href: "/admin/import", icon: Import, label: "Import Students" },
  { href: "/admin/email-jobs", icon: Mail, label: "Email Jobs" },
  { href: "/admin/labs", icon: Gauge, label: "Lab Capacity" },
  { href: "/support", icon: HelpCircle, label: "Support Guidance" },
];

export function AppShell({
  children,
  roles,
  title,
}: {
  children: ReactNode;
  roles: PortalRole[];
  title: string;
}) {
  const manager = canManage(roles);
  const nav = manager
    ? adminNav.filter((item) => !item.adminOnly || isAdmin(roles))
    : studentNav;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="flex items-center gap-3 border-b border-cyan-200/10 pb-5">
          <BrandLogo />
          <div>
            <p className="font-bold">DigitalRCC</p>
            <p className="text-xs text-slate-400">Lab Companion</p>
          </div>
        </div>
        <nav className="grid gap-1">
          {nav.map((item) => (
            <Link className="sidebar-link" href={item.href} key={item.href}>
              <item.icon size={17} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <form action={logoutAction} className="mt-auto">
          <button
            className="sidebar-link w-full border-0 bg-transparent text-left"
            type="submit"
          >
            <LogOut size={17} />
            <span>Log out</span>
          </button>
        </form>
      </aside>
      <section className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              {manager ? "Administration Workspace" : "Student Workspace"}
            </p>
            <h1 className="mt-2 text-3xl font-bold">{title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {roles.map((role) => (
              <span className="status-pill" key={role}>
                {role}
              </span>
            ))}
          </div>
        </header>
        <div className="mt-6 grid gap-6">{children}</div>
      </section>
    </main>
  );
}
