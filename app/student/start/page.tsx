import Link from "next/link";
import { ArrowRight, BookOpenCheck, CircleCheck, IdCard } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { getProfile, getUserRoles, requireUser } from "@/lib/auth";
import {
  getStudentCohortAssignment,
  getStudentLabIdentity,
} from "@/lib/student-lab";

export default async function StudentStartPage() {
  const user = await requireUser();
  const [roles, profile, assignment] = await Promise.all([
    getUserRoles(user.id),
    getProfile(user.id),
    getStudentCohortAssignment(user.id),
  ]);
  const identity = getStudentLabIdentity(assignment);

  return (
    <AppShell roles={roles} title="Start Here">
      {identity ? (
        <>
          <Card
            eyebrow="Welcome to DigitalRCC"
            title={`You are Student ${identity.studentNumber}`}
          >
            <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
              <div className="max-w-3xl">
                <p className="text-lg leading-8 text-slate-200">
                  Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}.
                  Your student number connects every part of your lab
                  environment, from your pod and username to your gateway and
                  progress page.
                </p>
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  Keep your assigned credentials private. Complete the quick
                  start review before beginning the AC lab guides.
                </p>
              </div>
              <div className="grid min-h-32 min-w-32 place-items-center rounded-lg border border-cyan-200/20 bg-cyan-300/10 px-6 text-center">
                <div>
                  <p className="eyebrow">Student</p>
                  <p className="mt-2 text-5xl font-bold text-cyan-100">
                    {identity.studentNumber}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          <section className="grid gap-4 md:grid-cols-3">
            <Card eyebrow="Step 1" title="Know your identity">
              <IdCard className="text-cyan-300" size={24} />
              <p className="mt-4 text-sm leading-6 text-slate-300">
                You are assigned to {identity.podName} with lab username{" "}
                <strong className="text-white">{identity.labUsername}</strong>.
              </p>
            </Card>
            <Card eyebrow="Step 2" title="Review quick start">
              <BookOpenCheck className="text-cyan-300" size={24} />
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Review gateway access, your assigned server, pod layout, and
                progress checks.
              </p>
            </Card>
            <Card eyebrow="Step 3" title="Begin with AC">
              <CircleCheck className="text-cyan-300" size={24} />
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Continue to Lab Guides and begin with the Access Control family.
              </p>
            </Card>
          </section>

          <Card
            eyebrow="Next Step"
            title="Review your personalized quick start"
          >
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                The next page automatically uses Student{" "}
                {identity.studentNumber} throughout the guide.
              </p>
              <Link className="button shrink-0" href="/student/quick-start">
                Review Quick Start
                <ArrowRight size={17} />
              </Link>
            </div>
          </Card>
        </>
      ) : (
        <Card
          eyebrow="Assignment Pending"
          title="Your student number is not ready"
        >
          <p className="text-sm leading-6 text-slate-300">
            Your personalized welcome will appear as soon as an administrator
            assigns you to a cohort seat.
          </p>
          <Link className="button secondary mt-5" href="/student/queue">
            View Queue Status
          </Link>
        </Card>
      )}
    </AppShell>
  );
}
