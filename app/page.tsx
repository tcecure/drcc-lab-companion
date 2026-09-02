import type { Metadata } from "next";
import Image from "next/image";
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
      <PublicHeader variant="home" />
      <main className="home-page">
        <section className="home-hero">
          <div className="home-hero-inner">
            <div className="home-hero-copy">
              <h1 className="home-hero-title">DigitalRCC Lab Companion</h1>
              <p className="home-hero-summary">
                Enter your assigned pod, follow the current CMMC Level 1 lab
                guides, and pick up where your training left off.
              </p>
            </div>

            <div aria-hidden="true" className="home-logo-stage">
              <div className="home-logo-orbit">
                <span className="home-logo-orbit-marker">
                  <span />
                </span>
                <Image
                  alt=""
                  className="home-hero-logo"
                  height={420}
                  priority
                  sizes="(max-width: 640px) 220px, 300px"
                  src="/brand/drcc-logo.png"
                  width={420}
                />
              </div>
            </div>

            <div className="home-hero-actions">
              <div className="flex flex-wrap justify-center gap-3">
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

            <div className="home-operations-wrap">
              <Suspense fallback={<HomeOperationsFallback />}>
                <OperationsSummary />
              </Suspense>
            </div>
          </div>
        </section>

        <section className="home-notices-shell">
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
