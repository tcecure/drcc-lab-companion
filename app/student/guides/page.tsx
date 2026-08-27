import Link from "next/link";
import {
  Activity,
  Building2,
  ExternalLink,
  HardDrive,
  KeyRound,
  Network,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { getUserRoles, requireUser } from "@/lib/auth";
import { labGuides, type LabGuide } from "@/lib/lab-guides";
import {
  getStudentCohortAssignment,
  getStudentLabIdentity,
} from "@/lib/student-lab";

const labFamilyIcons: Record<LabGuide["code"], LucideIcon> = {
  AC: ShieldCheck,
  IA: KeyRound,
  SI: Activity,
  SC: Network,
  MP: HardDrive,
  PE: Building2,
};

export default async function GuidesPage() {
  const user = await requireUser();
  const [roles, assignment] = await Promise.all([
    getUserRoles(user.id),
    getStudentCohortAssignment(user.id),
  ]);
  const identity = getStudentLabIdentity(assignment);

  return (
    <AppShell roles={roles} title="Lab Guides">
      <Card eyebrow="Recommended Path" title="Begin with Access Control">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <p className="max-w-3xl text-sm leading-6 text-slate-300">
            Complete the personalized connection steps, then begin with AC.
            Every lab family below includes its current completion guide. The
            personalized Quick Start is the source of truth for connecting and
            supersedes legacy connection examples inside the PDFs.
          </p>
          <Link
            className="button secondary shrink-0"
            href="/student/quick-start"
          >
            Review Quick Start
          </Link>
        </div>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {labGuides.map((family) => {
          const FamilyIcon = labFamilyIcons[family.code];
          const digitalGuide =
            "digitalGuidePath" in family ? family.digitalGuidePath : null;
          const workspace = identity
            ? family.workspace === "dc"
              ? identity.domainController
              : family.workspace === "firewall"
                ? `http://${identity.gatewayAddress}`
                : identity.podName
            : "Assigned pod";

          return (
            <div id={`family-${family.code.toLowerCase()}`} key={family.code}>
              <Card
                className={family.code === "AC" ? "border-cyan-300/35" : ""}
                eyebrow={`${family.code} Lab Family`}
                title={family.title}
              >
                <FamilyIcon className="text-cyan-300" size={24} />
                <p className="mt-4 min-h-20 text-sm leading-6 text-slate-300">
                  {family.description}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-cyan-200/10 pt-4 text-xs">
                  <div>
                    <dt className="text-slate-400">Labs</dt>
                    <dd className="mt-1 font-bold">{family.labCount}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Guide</dt>
                    <dd className="mt-1 font-bold">{family.pageCount} pages</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-400">Primary workspace</dt>
                    <dd className="mt-1 break-all font-bold">{workspace}</dd>
                  </div>
                </dl>
                <div className="mt-5 flex flex-wrap gap-2">
                  {digitalGuide ? (
                    <Link className="button" href={digitalGuide}>
                      Read digital guide
                    </Link>
                  ) : (
                    <a
                      className="button"
                      href={family.guidePath}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open {family.code} Guide
                      <ExternalLink aria-hidden="true" size={16} />
                    </a>
                  )}
                  {digitalGuide ? (
                    <a
                      aria-label={`Open ${family.code} PDF guide`}
                      className="button secondary"
                      href={family.guidePath}
                      rel="noreferrer"
                      target="_blank"
                      title="Open PDF guide"
                    >
                      PDF
                      <ExternalLink aria-hidden="true" size={16} />
                    </a>
                  ) : null}
                </div>
              </Card>
            </div>
          );
        })}
      </section>
    </AppShell>
  );
}
