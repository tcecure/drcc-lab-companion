import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LifeBuoy, LogIn } from "lucide-react";
import { Suspense } from "react";

import {
  HomeOperations,
  HomeOperationsFallback,
} from "@/components/home-operations";
import { KnownIssuesSummary } from "@/components/known-issues";
import { PublicHeader } from "@/components/public-header";
import { getPublicOperationsSummary } from "@/lib/public-operations";

export const metadata: Metadata = {
  title: "DigitalRCC Lab Companion",
  description:
    "Request lab access, sign in to your training workspace, and review current DigitalRCC support guidance.",
};

export default function HomePage() {
  return (
    <>
      <PublicHeader />
      <main>
        <section className="border-b border-cyan-100/10">
          <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-10 sm:px-6 sm:pb-14 sm:pt-18">
            <div className="max-w-4xl">
              <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-6xl">
                DigitalRCC Lab Companion
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Enter your assigned pod, follow the current CMMC Level 1 lab
                guides, and pick up where your training left off.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link className="button" href="/login">
                  <LogIn aria-hidden="true" size={17} />
                  Log in
                </Link>
                <Link className="button secondary" href="/request-access">
                  Request access
                  <ArrowRight aria-hidden="true" size={16} />
                </Link>
                <Link
                  className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-bold text-cyan-100 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                  href="/support"
                >
                  <LifeBuoy aria-hidden="true" size={17} />
                  Get support
                </Link>
              </div>
            </div>

            <div className="mt-8 sm:mt-12">
              <Suspense fallback={<HomeOperationsFallback />}>
                <OperationsSummary />
              </Suspense>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-14">
          <KnownIssuesSummary />
        </section>
      </main>
    </>
  );
}

async function OperationsSummary() {
  const summary = await getPublicOperationsSummary();

  return <HomeOperations summary={summary} />;
}
