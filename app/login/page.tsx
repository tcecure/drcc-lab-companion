import Link from "next/link";
import { Suspense } from "react";

import { SubmitButton } from "@/components/forms";
import {
  PublicOperationsCard,
  PublicOperationsCardFallback,
} from "@/components/public-operations-card";
import { loginAction } from "@/lib/actions/auth";
import { getPublicOperationsSummary } from "@/lib/public-operations";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  return (
    <main className="min-h-screen px-4 py-10 sm:px-6 sm:py-12">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] w-full max-w-4xl items-center gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="card w-full">
          <p className="eyebrow">DigitalRCC</p>
          <h1 className="mt-2 text-3xl font-bold">Lab Companion Login</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Access lab guides, queue status, cohort windows, and lab operations.
          </p>
          {params.error ? (
            <p className="mt-5 rounded-md border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
              {params.error}
            </p>
          ) : null}
          <form action={loginAction} className="mt-6 grid gap-4">
            <label className="grid gap-2 text-sm font-semibold">
              Email
              <input
                autoComplete="email"
                className="input"
                name="email"
                required
                type="email"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Password
              <input
                autoComplete="current-password"
                className="input"
                name="password"
                required
                type="password"
              />
            </label>
            <Link
              className="w-fit text-sm font-bold text-cyan-200 hover:text-cyan-100"
              href="/forgot-password"
            >
              Forgot password?
            </Link>
            <SubmitButton>Log in</SubmitButton>
          </form>
          <Link
            className="mt-5 inline-flex text-sm font-bold text-cyan-200"
            href="/request-access"
          >
            Request student access
          </Link>
        </section>
        <Suspense fallback={<PublicOperationsCardFallback />}>
          <OperationsSummary />
        </Suspense>
      </div>
    </main>
  );
}

async function OperationsSummary() {
  const summary = await getPublicOperationsSummary();

  return <PublicOperationsCard summary={summary} />;
}
