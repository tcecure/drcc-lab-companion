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
import { requireManager } from "@/lib/auth";
import { labGuides, type LabGuide } from "@/lib/lab-guides";

const labFamilyIcons: Record<LabGuide["code"], LucideIcon> = {
  AC: ShieldCheck,
  IA: KeyRound,
  SI: Activity,
  SC: Network,
  MP: HardDrive,
  PE: Building2,
};

const workspaceLabels: Record<LabGuide["workspace"], string> = {
  dc: "Assigned domain controller",
  firewall: "Assigned pod gateway",
  pod: "Assigned student pod",
};

export default async function AdminGuidesPage() {
  const { roles } = await requireManager();

  return (
    <AppShell roles={roles} title="Current Lab Guides">
      <Card eyebrow="Review Library" title="Published Student Guides">
        <p className="max-w-3xl text-sm leading-6 text-slate-300">
          These are the current guides available to students. Open any guide to
          review its steps or walk through a lab with a student. Connection
          details are personalized separately from each student&apos;s assigned
          pod.
        </p>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {labGuides.map((family) => {
          const FamilyIcon = labFamilyIcons[family.code];
          const digitalGuide =
            "digitalGuidePath" in family ? family.digitalGuidePath : null;

          return (
            <Card
              className={family.code === "AC" ? "border-cyan-300/35" : ""}
              eyebrow={`${family.code} Lab Family`}
              key={family.code}
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
                  <dt className="text-slate-400">Student workspace</dt>
                  <dd className="mt-1 font-bold">
                    {workspaceLabels[family.workspace]}
                  </dd>
                </div>
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                {digitalGuide ? (
                  <Link className="button" href={digitalGuide}>
                    Review digital guide
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
          );
        })}
      </section>
    </AppShell>
  );
}
