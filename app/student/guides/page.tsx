import Link from "next/link";
import {
  Activity,
  Building2,
  HardDrive,
  KeyRound,
  Network,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { getUserRoles, requireUser } from "@/lib/auth";
import {
  getStudentCohortAssignment,
  getStudentLabIdentity,
} from "@/lib/student-lab";
import { createClient } from "@/lib/supabase/server";

type LabFamily = {
  code: string;
  title: string;
  description: string;
  icon: LucideIcon;
  workspace: "dc" | "gateway" | "pod";
};

const labFamilies: LabFamily[] = [
  {
    code: "AC",
    title: "Access Control",
    description:
      "Active Directory, Group Policy, permissions, and account access.",
    icon: ShieldCheck,
    workspace: "dc",
  },
  {
    code: "IA",
    title: "Identification & Authentication",
    description:
      "Passwords, authentication controls, MFA, and account policies.",
    icon: KeyRound,
    workspace: "dc",
  },
  {
    code: "SI",
    title: "System & Information Integrity",
    description: "Patching, antivirus, flaw remediation, and integrity checks.",
    icon: Activity,
    workspace: "dc",
  },
  {
    code: "SC",
    title: "System & Communications Protection",
    description:
      "Firewall rules, VLANs, segmentation, logging, and network protection.",
    icon: Network,
    workspace: "gateway",
  },
  {
    code: "MP",
    title: "Media Protection",
    description:
      "Media handling, storage, sanitization, and removable-media safeguards.",
    icon: HardDrive,
    workspace: "pod",
  },
  {
    code: "PE",
    title: "Physical Protection",
    description:
      "Physical access controls, monitoring, and facility safeguards.",
    icon: Building2,
    workspace: "pod",
  },
];

function matchesFamily(programArea: string, family: LabFamily) {
  const normalized = programArea.trim().toLowerCase();

  return (
    normalized === family.code.toLowerCase() ||
    normalized.includes(family.title.toLowerCase())
  );
}

export default async function GuidesPage() {
  const user = await requireUser();
  const [roles, assignment] = await Promise.all([
    getUserRoles(user.id),
    getStudentCohortAssignment(user.id),
  ]);
  const identity = getStudentLabIdentity(assignment);
  const supabase = await createClient();
  const { data } = await supabase
    .from("resources")
    .select(
      "title, slug, description, program_area, external_url, resource_type",
    )
    .eq("status", "published")
    .in("resource_type", [
      "lab_guide",
      "student_guide",
      "checklist",
      "cmmc_reference",
    ])
    .order("title", { ascending: true });
  const guides = data ?? [];

  return (
    <AppShell roles={roles} title="Lab Guides">
      <Card eyebrow="Recommended Path" title="Begin with Access Control">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <p className="max-w-3xl text-sm leading-6 text-slate-300">
            Complete the quick-start review, then begin with AC. Each lab family
            has its own card below and will surface its published guide as it
            becomes available.
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
        {labFamilies.map((family) => {
          const guide = guides.find((item) =>
            matchesFamily(item.program_area, family),
          );
          const workspace = identity
            ? family.workspace === "dc"
              ? identity.domainController
              : family.workspace === "gateway"
                ? identity.gatewayName
                : identity.podName
            : "Assigned pod";

          return (
            <div id={`family-${family.code.toLowerCase()}`} key={family.code}>
              <Card
                className={family.code === "AC" ? "border-cyan-300/35" : ""}
                eyebrow={`${family.code} Lab Family`}
                title={family.title}
              >
                <family.icon className="text-cyan-300" size={24} />
                <p className="mt-4 min-h-20 text-sm leading-6 text-slate-300">
                  {guide?.description || family.description}
                </p>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-cyan-200/10 pt-4 text-xs">
                  <span className="text-slate-400">Primary workspace</span>
                  <strong>{workspace}</strong>
                </div>
                {guide?.external_url ? (
                  <a
                    className="button mt-5"
                    href={guide.external_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open {family.code} Guide
                  </a>
                ) : (
                  <span className="status-pill mt-5">
                    {family.code === "AC" ? "First guide" : "Coming soon"}
                  </span>
                )}
              </Card>
            </div>
          );
        })}
      </section>
    </AppShell>
  );
}
