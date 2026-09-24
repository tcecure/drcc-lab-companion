"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  HeartHandshake,
  HelpCircle,
  Import,
  KeyRound,
  LayoutDashboard,
  Mail,
  MessageSquareText,
  ShieldCheck,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

type NavigationMode = "admin" | "student";

type NavigationItem = {
  administratorOnly?: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
};

type NavigationGroup = {
  items: NavigationItem[];
  label: string;
};

const studentGroups: NavigationGroup[] = [
  {
    label: "My workspace",
    items: [
      { href: "/student", icon: LayoutDashboard, label: "Overview" },
      { href: "/student/start", icon: ShieldCheck, label: "Start Here" },
      { href: "/student/guides", icon: BookOpen, label: "Lab Guides" },
      {
        href: "/student/training",
        icon: GraduationCap,
        label: "Training Progress",
      },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/student/support", icon: HelpCircle, label: "Support" },
      { href: "/student/profile", icon: User, label: "Profile" },
    ],
  },
];

const adminGroups: NavigationGroup[] = [
  {
    label: "Operations",
    items: [{ href: "/admin", icon: LayoutDashboard, label: "Overview" }],
  },
  {
    label: "Students",
    items: [
      { href: "/admin/queue", icon: Users, label: "Student Queue" },
      {
        href: "/admin/progress",
        icon: GraduationCap,
        label: "Student Progress",
      },
      { href: "/admin/import", icon: Import, label: "Import Students" },
      {
        href: "/admin/approvals",
        icon: ClipboardCheck,
        label: "Approvals",
      },
    ],
  },
  {
    label: "Lab operations",
    items: [
      { href: "/admin/lab-status", icon: Activity, label: "Lab Status" },
      { href: "/admin/labs", icon: ShieldCheck, label: "Lab Capacity" },
      { href: "/admin/labops", icon: Bot, label: "LabOps AI" },
      {
        href: "/admin/lab-credentials",
        icon: KeyRound,
        label: "Lab Credentials",
      },
    ],
  },
  {
    label: "Support and content",
    items: [
      {
        administratorOnly: true,
        href: "/admin/support",
        icon: MessageSquareText,
        label: "Support Tickets",
      },
      { href: "/admin/guides", icon: BookOpen, label: "Lab Guides" },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        administratorOnly: true,
        href: "/admin/users",
        icon: User,
        label: "User Management",
      },
      { href: "/admin/email-jobs", icon: Mail, label: "Email Jobs" },
      {
        administratorOnly: true,
        href: "/admin/community-impact",
        icon: HeartHandshake,
        label: "Community Impact",
      },
    ],
  },
];

export function PortalNavigation({
  isAdministrator,
  mode,
}: {
  isAdministrator: boolean;
  mode: NavigationMode;
}) {
  const pathname = usePathname();
  const groups = mode === "admin" ? adminGroups : studentGroups;

  return (
    <nav aria-label={`${mode} navigation`} className="portal-navigation">
      {groups.map((group) => {
        const items = group.items.filter(
          (item) => !item.administratorOnly || isAdministrator,
        );

        if (!items.length) {
          return null;
        }

        return (
          <section className="nav-group" key={group.label}>
            <p className="nav-group-label">{group.label}</p>
            <div className="nav-group-links">
              {items.map((item) => {
                const rootRoute =
                  item.href === "/admin" || item.href === "/student";
                const active = rootRoute
                  ? pathname === item.href
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className="sidebar-link"
                    href={item.href}
                    key={item.href}
                  >
                    <item.icon aria-hidden="true" size={18} strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </nav>
  );
}
