import Link from "next/link";
import {
  ArrowLeft,
  BookOpenCheck,
  ExternalLink,
  FileText,
  GraduationCap,
} from "lucide-react";

import AcGuide from "@/content/guides/ac/2026.08.1/guide.mdx";
import { AppShell } from "@/components/app-shell";
import {
  getDigitalGuideComponents,
  GuidePendingNotice,
} from "@/components/digital-guide";
import { getUserRoles, requireUser } from "@/lib/auth";
import { acGuideRelease, getAcGuideContext } from "@/lib/digital-guides";
import { canManage } from "@/lib/roles";
import {
  getStudentCohortAssignment,
  getStudentLabIdentity,
} from "@/lib/student-lab";

const guideSections = [
  { href: "#before-you-begin", label: "Before you begin" },
  { href: "#connect", label: "Connect" },
  { href: "#workspace", label: "Directory workspace" },
  { href: "#module-1", label: "M1 Account management" },
  { href: "#module-2", label: "M2 User lifecycle" },
  { href: "#module-3", label: "M3 Least privilege" },
  { href: "#module-4", label: "M4 Audit and evidence" },
  { href: "#quick-reference", label: "Quick reference" },
  { href: "#completion-checklist", label: "Completion checklist" },
] as const;

export default async function AccessControlGuidePage() {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);
  const manager = canManage(roles);
  const assignment = manager ? null : await getStudentCohortAssignment(user.id);
  const studentIdentity = getStudentLabIdentity(assignment);
  const guideContext = getAcGuideContext({
    identity: studentIdentity,
    manager,
  });
  const identity = guideContext.identity;
  const guideComponents = getDigitalGuideComponents(identity);
  const backPath = manager ? "/admin/guides" : "/student/guides";
  const progressPath = manager ? "/admin/progress" : "/student/training";
  const contextLabel =
    guideContext.mode === "review"
      ? "Admin review mode · Sample Pod01"
      : guideContext.mode === "personalized"
        ? `Personalized for Student ${identity?.studentNumber}`
        : "Pod assignment pending";

  return (
    <AppShell roles={roles} title="Access Control Guide">
      <section className="guide-hero">
        <div>
          <Link className="guide-back-link" href={backPath}>
            <ArrowLeft aria-hidden="true" size={16} />
            Lab guide library
          </Link>
          <p className="eyebrow mt-6">AC Lab Family · Digital Edition</p>
          <h2>Access Control</h2>
          <p className="guide-hero-summary">
            A personalized field guide for account management, user lifecycle,
            least privilege, and access review evidence.
          </p>
        </div>
        <div className="guide-release-panel">
          <BookOpenCheck aria-hidden="true" size={22} />
          <div>
            <span>Current release</span>
            <strong>Version {acGuideRelease.version}</strong>
            <small>{acGuideRelease.effectiveDate}</small>
          </div>
        </div>
      </section>

      <section className="guide-identity-strip">
        <div>
          <span className="guide-context-label">{contextLabel}</span>
          <strong>{identity?.podName ?? "Pod not assigned"}</strong>
        </div>
        <dl>
          <div>
            <dt>Username</dt>
            <dd>{identity?.labUsername ?? "studentXX"}</dd>
          </div>
          <div>
            <dt>Connection</dt>
            <dd>{identity?.sessionHost ?? "PODXX-SRV"}</dd>
          </div>
          <div>
            <dt>Labs</dt>
            <dd>{acGuideRelease.labCount}</dd>
          </div>
        </dl>
        <div className="guide-header-actions">
          <Link className="button secondary" href={progressPath}>
            <GraduationCap aria-hidden="true" size={16} />
            {manager ? "Student progress" : "My progress"}
          </Link>
          <a
            className="button secondary"
            href={acGuideRelease.pdfPath}
            rel="noreferrer"
            target="_blank"
          >
            <FileText aria-hidden="true" size={16} />
            PDF
            <ExternalLink aria-hidden="true" size={14} />
          </a>
        </div>
      </section>

      {guideContext.mode === "pending" ? <GuidePendingNotice /> : null}

      <div className="digital-guide-layout">
        <aside className="guide-toc" aria-label="Guide sections">
          <p>On this page</p>
          <nav>
            {guideSections.map((section) => (
              <a href={section.href} key={section.href}>
                {section.label}
              </a>
            ))}
          </nav>
          <a
            className="guide-pdf-link"
            href={acGuideRelease.pdfPath}
            rel="noreferrer"
            target="_blank"
          >
            Original PDF
            <ExternalLink aria-hidden="true" size={14} />
          </a>
        </aside>

        <article className="digital-guide-article">
          <AcGuide components={guideComponents} />
        </article>
      </div>
    </AppShell>
  );
}
