import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ExternalLink,
  FolderOpen,
  Gauge,
  Monitor,
  Server,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { getUserRoles, requireUser } from "@/lib/auth";
import {
  getStudentCohortAssignment,
  getStudentLabIdentity,
} from "@/lib/student-lab";

function Value({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border border-cyan-200/15 bg-slate-950/60 px-2 py-1 text-sm text-cyan-100">
      {children}
    </code>
  );
}

export default async function StudentQuickStartPage() {
  const user = await requireUser();
  const [roles, assignment] = await Promise.all([
    getUserRoles(user.id),
    getStudentCohortAssignment(user.id),
  ]);
  const identity = getStudentLabIdentity(assignment);

  return (
    <AppShell roles={roles} title="Quick Start Guide">
      {identity ? (
        <>
          <Card
            eyebrow={`Student ${identity.studentNumber}`}
            title={`${identity.podName} Cyber Lab Quick Start`}
          >
            <p className="max-w-3xl text-sm leading-6 text-slate-300">
              This guide is personalized from your assigned seat. Do not share
              credentials, screenshots containing credentials, or active lab
              sessions.
            </p>
          </Card>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card eyebrow="Step 1" title="Open the Guacamole gateway">
              <Monitor className="text-cyan-300" size={24} />
              <ol className="mt-4 grid list-decimal gap-3 pl-5 text-sm leading-6 text-slate-300">
                <li>Open your assigned gateway.</li>
                <li>
                  Sign in with username <Value>{identity.labUsername}</Value>.
                </li>
                <li>
                  Use the lab password delivered separately by your instructor.
                </li>
                <li>
                  Select Login to open the list of connections assigned to your
                  pod.
                </li>
              </ol>
              <a
                className="button mt-5"
                href={identity.guacamoleUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open Gateway
                <ExternalLink size={16} />
              </a>
            </Card>

            <Card
              eyebrow="Step 2"
              title={`Connect to ${identity.domainController}`}
            >
              <Server className="text-cyan-300" size={24} />
              <ol className="mt-4 grid list-decimal gap-3 pl-5 text-sm leading-6 text-slate-300">
                <li>
                  Find <Value>{identity.domainController}</Value> in your
                  available connections.
                </li>
                <li>
                  Select the connection. Its remote desktop credentials are
                  preconfigured, so no additional Windows login is required.
                </li>
                <li>
                  Wait a few seconds for the Windows Server desktop to appear.
                </li>
                <li>
                  Press <Value>Ctrl+Alt+Shift</Value> to open the Guacamole side
                  menu when you need to return Home or switch connections.
                </li>
              </ol>
            </Card>

            <Card eyebrow="Step 3" title="Open the firewall for SC labs">
              <Gauge className="text-cyan-300" size={24} />
              <ol className="mt-4 grid list-decimal gap-3 pl-5 text-sm leading-6 text-slate-300">
                <li>
                  Stay connected to <Value>{identity.domainController}</Value>.
                </li>
                <li>Open Edge or Firefox on the Windows desktop.</li>
                <li>
                  Go to <Value>http://{identity.gatewayAddress}</Value>.
                </li>
                <li>
                  Sign in to pfSense with username <Value>admin</Value> and
                  password <Value>pfsense</Value>.
                </li>
              </ol>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                The old {identity.gatewayName} Guacamole tile is not used. The
                supported path is the browser on {identity.domainController}.
              </p>
            </Card>

            <Card eyebrow="Step 4" title="Know your pod layout">
              <FolderOpen className="text-cyan-300" size={24} />
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-400">Pod network</dt>
                  <dd className="mt-2 font-bold">{identity.podNetwork}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Lab artifacts</dt>
                  <dd className="mt-2 break-all font-bold">
                    {identity.artifactsPath}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Domain controller</dt>
                  <dd className="mt-2 font-bold">
                    {identity.domainController}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Firewall URL</dt>
                  <dd className="mt-2 font-bold">
                    http://{identity.gatewayAddress}
                  </dd>
                </div>
              </dl>
            </Card>
          </section>

          <Card eyebrow="Step 5" title="Check your progress">
            <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
              <div>
                <p className="max-w-3xl text-sm leading-6 text-slate-300">
                  Verification runs automatically every 30 minutes. Your status
                  page reports PASS or FAIL for available lab families.
                </p>
                <p className="mt-3 text-sm text-slate-400">
                  SC artifacts: {identity.scArtifactsPath}
                </p>
              </div>
              <a
                className="button secondary shrink-0"
                href={identity.progressUrl}
                rel="noreferrer"
                target="_blank"
              >
                View Progress
                <ExternalLink size={16} />
              </a>
            </div>
          </Card>

          <Card eyebrow="Guide Reviewed" title="Continue to Access Control">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                Begin with the AC family on the Lab Guides page. The remaining
                families stay organized there as they are released.
              </p>
              <Link
                className="button shrink-0"
                href="/student/guides#family-ac"
              >
                Continue to AC Guides
                <ArrowRight size={17} />
              </Link>
            </div>
          </Card>
        </>
      ) : (
        <Card
          eyebrow="Assignment Pending"
          title="Quick start is not available yet"
        >
          <p className="text-sm leading-6 text-slate-300">
            A cohort seat is required before the portal can personalize your lab
            names and addresses.
          </p>
          <Link className="button secondary mt-5" href="/student/queue">
            View Queue Status
          </Link>
        </Card>
      )}
    </AppShell>
  );
}
