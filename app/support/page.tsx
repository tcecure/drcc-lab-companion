import type { Metadata } from "next";
import Link from "next/link";
import { LifeBuoy, LockKeyhole, Mail } from "lucide-react";

import {
  CohortUpdate,
  CurrentLabNotices,
  ExpectedBehaviorNotices,
  ResolvedIssuesArchive,
} from "@/components/known-issues";
import { PublicHeader } from "@/components/public-header";
import { getSupportEmail } from "@/lib/support";

export const metadata: Metadata = {
  title: "Support",
  description: "Known issues and student support for DigitalRCC labs.",
};

export default function SupportPage() {
  const supportEmail = getSupportEmail();
  const emailHref = `mailto:${supportEmail}?subject=${encodeURIComponent(
    "DigitalRCC Lab Support Request",
  )}`;

  return (
    <>
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="max-w-3xl">
          <div className="flex items-center gap-3 text-cyan-200">
            <LifeBuoy aria-hidden="true" size={22} />
            <span className="text-sm font-bold">DigitalRCC Support</span>
          </div>
          <h1 className="mt-5 text-4xl font-bold sm:text-5xl">
            How can we help?
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg">
            Review the current lab notices before opening a support request.
            These workarounds are already accounted for and will not prevent you
            from completing the training.
          </p>
        </section>

        <div className="mt-10">
          <CurrentLabNotices />
        </div>

        <div className="mt-8 grid gap-8">
          <ExpectedBehaviorNotices />
          <CohortUpdate />
          <ResolvedIssuesArchive />
        </div>

        <section className="mt-8 grid gap-6 rounded-lg border border-cyan-200/15 bg-slate-950/55 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center">
          <div>
            <h2 className="text-2xl font-bold">Still need help?</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Include your full name, student number or pod, the page you were
              using, what you expected to happen, and a screenshot of the error.
            </p>
            <div className="mt-4 flex items-start gap-2 text-sm text-amber-100">
              <LockKeyhole
                aria-hidden="true"
                className="mt-0.5 shrink-0"
                size={16}
              />
              <p>
                Never include your password or invitation link in a support
                email.
              </p>
            </div>
          </div>
          <Link className="button w-full" href={emailHref}>
            <Mail aria-hidden="true" size={17} />
            Email {supportEmail}
          </Link>
        </section>
      </main>
    </>
  );
}
