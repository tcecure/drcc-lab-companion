import { LogOut } from "lucide-react";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { PortalNavigation } from "@/components/portal-navigation";
import { logoutAction } from "@/lib/actions/auth";
import { canManage, isAdmin, type PortalRole } from "@/lib/roles";

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
  const workspace = manager ? "admin" : "student";
  const primaryRole = isAdmin(roles)
    ? "Administrator"
    : manager
      ? "Approver"
      : "Student";

  return (
    <main className={`app-shell app-shell-${workspace}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandLogo />
          <div className="min-w-0">
            <p className="sidebar-brand-name">DigitalRCC</p>
            <p className="sidebar-brand-product">Lab Companion</p>
          </div>
        </div>

        <div className="sidebar-workspace">
          {manager ? "Admin console" : "Student portal"}
        </div>

        <PortalNavigation isAdministrator={isAdmin(roles)} mode={workspace} />

        <div className="sidebar-footer">
          <div className="sidebar-account">
            <span aria-hidden="true" className="sidebar-account-avatar">
              {primaryRole.slice(0, 1)}
            </span>
            <div>
              <p>{primaryRole}</p>
              <span>DigitalRCC access</span>
            </div>
          </div>
          <form action={logoutAction}>
            <button
              aria-label="Log out"
              className="sidebar-logout"
              title="Log out"
              type="submit"
            >
              <LogOut aria-hidden="true" size={17} />
            </button>
          </form>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div>
            <p className="workspace-label">
              {manager ? "Administration" : "My training"}
            </p>
            <h1>{title}</h1>
          </div>
          <span className="topbar-role">{primaryRole}</span>
        </header>
        <div className="page-content">{children}</div>
      </section>
    </main>
  );
}
