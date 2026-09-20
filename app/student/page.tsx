import Link from "next/link";
import {
  ArrowRight,
  Check,
  Clock3,
  HelpCircle,
  LockKeyhole,
  Server,
} from "lucide-react";
import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { getProfile, getUserRoles, requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import {
  getStudentCohortAssignment,
  getStudentLabIdentity,
  type StudentLabIdentity,
} from "@/lib/student-lab";
import { getPodProgress, type ProgressStatus } from "@/lib/training-progress";

export const dynamic = "force-dynamic";

const fallbackModules = [
  { id: "AC", title: "Access Control" },
  { id: "IA", title: "Identification & Authentication" },
  { id: "SI", title: "System & Information Integrity" },
  { id: "SC", title: "System & Communications Protection" },
  { id: "MP", title: "Media Protection" },
  { id: "PE", title: "Physical Protection" },
];

async function StudentTrainingOverview({
  identity,
}: {
  identity: StudentLabIdentity;
}) {
  const progress = await getPodProgress(identity.podName);
  const trackerAvailable = progress?.status !== "unavailable";
  const modules = progress?.modules.length
    ? progress.modules
    : fallbackModules.map((module) => ({
        ...module,
        status: "not_started" as ProgressStatus,
      }));
  const currentModule = progress?.currentModule
    ? modules.find((module) => module.id === progress.currentModule)
    : (modules.find((module) => module.status === "in_progress") ?? modules[0]);
  const overallPercentage = trackerAvailable
    ? (progress?.overallPercentage ?? 0)
    : null;

  return (
    <>
      <section className="training-focus">
        <div className="training-focus-copy">
          <p className="workspace-label">Continue your training</p>
          <h2>{currentModule?.title ?? "Begin your lab orientation"}</h2>
          <p>
            {trackerAvailable
              ? `${progress?.completedModules ?? 0} of ${progress?.totalModules ?? modules.length} lab families complete.`
              : "Your live tracker is syncing. You can continue working while it reconnects."}
          </p>

          <div className="training-progress-summary">
            <div className="training-progress-label">
              <span>Overall progress</span>
              <strong>
                {overallPercentage === null
                  ? "Syncing"
                  : `${overallPercentage}%`}
              </strong>
            </div>
            <div
              aria-label="Overall training progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={overallPercentage ?? undefined}
              className="training-progress-track"
              role="progressbar"
            >
              <span style={{ width: `${overallPercentage ?? 0}%` }} />
            </div>
          </div>

          <div className="training-focus-actions">
            <Link className="button" href="/student/guides">
              View lab guide
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <Link className="text-link" href="/student/training">
              View full progress
            </Link>
          </div>
        </div>
        <div className="training-focus-identity">
          <Server aria-hidden="true" size={30} strokeWidth={1.6} />
          <span>Assigned environment</span>
          <strong>{identity.podName}</strong>
          <small>Student {identity.studentNumber}</small>
        </div>
      </section>

      <section className="training-journey" aria-labelledby="journey-title">
        <div className="section-heading-row">
          <div>
            <h2 id="journey-title">Training journey</h2>
            <p>Follow the lab families in order and return anytime.</p>
          </div>
          <Link className="text-link" href="/student/training">
            View details
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>
        <ol className="journey-list">
          {modules.map((module, index) => {
            const status = module.status;
            const current =
              module.id === currentModule?.id && status !== "completed";

            return (
              <li
                className={`journey-step journey-step-${status}${current ? " journey-step-current" : ""}`}
                key={module.id}
              >
                <span className="journey-marker">
                  {status === "completed" ? (
                    <Check aria-hidden="true" size={16} />
                  ) : status === "not_started" && !current ? (
                    <LockKeyhole aria-hidden="true" size={13} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span>
                  <strong>{module.id}</strong>
                  <small>{module.title}</small>
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

export default async function StudentPage() {
  const user = await requireUser();
  const [roles, profile, assignment] = await Promise.all([
    getUserRoles(user.id),
    getProfile(user.id),
    getStudentCohortAssignment(user.id),
  ]);
  const identity = getStudentLabIdentity(assignment);
  const firstName = profile?.full_name?.trim().split(/\s+/)[0];
  const displayName =
    firstName || (identity ? `Student ${identity.studentNumber}` : "Student");

  return (
    <AppShell roles={roles} title={`Welcome back, ${displayName}`}>
      {identity ? (
        <Suspense
          fallback={
            <section className="training-focus training-focus-loading">
              Loading your training workspace…
            </section>
          }
        >
          <StudentTrainingOverview identity={identity} />
        </Suspense>
      ) : (
        <section className="training-focus">
          <div className="training-focus-copy">
            <p className="workspace-label">Start here</p>
            <h2>Prepare for your DigitalRCC labs</h2>
            <p>
              Review the orientation while your student number and pod are being
              assigned.
            </p>
            <Link className="button" href="/student/start">
              Start orientation
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </div>
        </section>
      )}

      <section className="student-dashboard-grid">
        <Card title="Your lab access">
          <div className="access-summary">
            <div className="access-summary-icon">
              <Clock3 aria-hidden="true" size={22} />
            </div>
            <div>
              <p className="access-summary-label">Access window</p>
              <p className="access-summary-value">
                {assignment
                  ? `${formatDate(assignment.access_starts_at)} – ${formatDate(assignment.access_ends_at)}`
                  : "Pending cohort assignment"}
              </p>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Status</dt>
              <dd className="capitalize">
                {assignment?.status?.replaceAll("_", " ") ?? "Not queued"}
              </dd>
            </div>
            <div>
              <dt>Pod</dt>
              <dd>{identity?.podName ?? "Pending"}</dd>
            </div>
            <div>
              <dt>Lab username</dt>
              <dd>{identity?.labUsername ?? "Pending"}</dd>
            </div>
          </dl>
          <Link className="text-link mt-5" href="/student/start">
            Review connection details
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </Card>

        <Card title="Need help?">
          <div className="support-callout">
            <HelpCircle aria-hidden="true" size={28} strokeWidth={1.6} />
            <p>
              Tell the cyber lab team what is happening and include the lab
              family you are working on.
            </p>
          </div>
          <Link className="button secondary mt-5" href="/student/support/new">
            Open a support ticket
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </Card>
      </section>
    </AppShell>
  );
}
