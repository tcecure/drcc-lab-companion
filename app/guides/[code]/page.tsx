import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookOpenCheck,
  ExternalLink,
  FileText,
  GraduationCap,
} from "lucide-react";

import AcGuide from "@/content/guides/ac/2026.08.1/guide.mdx";
import IaGuide from "@/content/guides/ia/2026.08.1/guide.mdx";
import MpGuide from "@/content/guides/mp/2026.08.1/guide.mdx";
import PeGuide from "@/content/guides/pe/2026.08.1/guide.mdx";
import ScGuide from "@/content/guides/sc/2026.08.1/guide.mdx";
import SiGuide from "@/content/guides/si/2026.08.1/guide.mdx";
import { AppShell } from "@/components/app-shell";
import {
  getDigitalGuideComponents,
  GuidePendingNotice,
} from "@/components/digital-guide";
import { getUserRoles, requireUser } from "@/lib/auth";
import {
  digitalGuideReleases,
  getDigitalGuideContext,
  type DigitalGuideCode,
} from "@/lib/digital-guides";
import { canManage } from "@/lib/roles";
import {
  getStudentCohortAssignment,
  getStudentLabIdentity,
} from "@/lib/student-lab";

const guideContent = {
  AC: AcGuide,
  IA: IaGuide,
  MP: MpGuide,
  PE: PeGuide,
  SC: ScGuide,
  SI: SiGuide,
} as const;

function isDigitalGuideCode(code: string): code is DigitalGuideCode {
  return code in digitalGuideReleases;
}

export default async function DigitalLabGuidePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: routeCode } = await params;
  const code = routeCode.toUpperCase();

  if (!isDigitalGuideCode(code)) {
    notFound();
  }

  const release = digitalGuideReleases[code];
  const Guide = guideContent[code];
  const user = await requireUser();
  const roles = await getUserRoles(user.id);
  const manager = canManage(roles);
  const assignment = manager ? null : await getStudentCohortAssignment(user.id);
  const studentIdentity = getStudentLabIdentity(assignment);
  const guideContext = getDigitalGuideContext({
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
    <AppShell roles={roles} title={`${release.family} Guide`}>
      <section className="guide-hero">
        <div>
          <Link className="guide-back-link" href={backPath}>
            <ArrowLeft aria-hidden="true" size={16} />
            Lab guide library
          </Link>
          <p className="eyebrow mt-6">
            {release.code} Lab Family · Digital Edition
          </p>
          <h2>{release.family}</h2>
          <p className="guide-hero-summary">{release.summary}</p>
        </div>
        <div className="guide-release-panel">
          <BookOpenCheck aria-hidden="true" size={22} />
          <div>
            <span>Current release</span>
            <strong>Version {release.version}</strong>
            <small>{release.effectiveDate}</small>
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
            <dd>{release.labCount}</dd>
          </div>
        </dl>
        <div className="guide-header-actions">
          <Link className="button secondary" href={progressPath}>
            <GraduationCap aria-hidden="true" size={16} />
            {manager ? "Student progress" : "My progress"}
          </Link>
          <a
            className="button secondary"
            href={release.pdfPath}
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
            {release.sections.map((section) => (
              <a href={section.href} key={section.href}>
                {section.label}
              </a>
            ))}
          </nav>
          <a
            className="guide-pdf-link"
            href={release.pdfPath}
            rel="noreferrer"
            target="_blank"
          >
            Original PDF
            <ExternalLink aria-hidden="true" size={14} />
          </a>
        </aside>

        <article className="digital-guide-article">
          <Guide components={guideComponents} />
        </article>
      </div>
    </AppShell>
  );
}
