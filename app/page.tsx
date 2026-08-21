import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LifeBuoy, LogIn } from "lucide-react";

import { KnownIssuesSummary } from "@/components/known-issues";
import { PublicHeader } from "@/components/public-header";

export const metadata: Metadata = {
  title: "DigitalRCC Lab Companion",
  description:
    "Request lab access, sign in to your training workspace, and review current DigitalRCC support guidance.",
};

export default function HomePage() {
  return (
    <>
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="max-w-4xl py-4 sm:py-8">
          <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-6xl">
            DigitalRCC Lab Companion
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            Your workspace for DigitalRCC lab access, hands-on training guides,
            pod assignments, and progress tracking.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="button" href="/login">
              <LogIn aria-hidden="true" size={17} />
              Log in
            </Link>
            <Link className="button secondary" href="/request-access">
              Request student access
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
            <Link
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-bold text-cyan-100 hover:bg-white/5"
              href="/support"
            >
              <LifeBuoy aria-hidden="true" size={17} />
              Get support
            </Link>
          </div>
        </section>

        <div className="mt-8">
          <KnownIssuesSummary />
        </div>
      </main>
    </>
  );
}
