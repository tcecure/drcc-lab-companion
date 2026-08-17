import Link from "next/link";

import { SubmitButton } from "@/components/forms";
import { requestAccessAction } from "@/lib/actions/request-access";

type RequestAccessPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function RequestAccessPage({
  searchParams,
}: RequestAccessPageProps) {
  const params = await searchParams;

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-5xl items-center gap-8 px-4 py-12 lg:grid-cols-[0.9fr_1.1fr]">
      <section>
        <p className="eyebrow">Student Intake</p>
        <h1 className="mt-3 text-5xl font-bold">
          Request access to the DigitalRCC lab companion.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-8 text-slate-300">
          Students are queued into 20-seat cohorts with a 14-day hands-on lab
          access window. CMMC Level 1 is the first active training track.
        </p>
        <Link
          className="mt-8 inline-flex text-sm font-bold text-cyan-200"
          href="/login"
        >
          Already invited? Log in
        </Link>
      </section>
      <section className="card">
        <p className="eyebrow">CMMC Level 1</p>
        <h2 className="mt-2 text-2xl font-bold">Pre-registration interest</h2>
        {params.error ? (
          <p className="mt-5 rounded-md border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
            {params.error}
          </p>
        ) : null}
        <form action={requestAccessAction} className="mt-6 grid gap-4">
          <label className="grid gap-2 text-sm font-semibold">
            Name
            <input className="input" name="name" required />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Email
            <input className="input" name="email" required type="email" />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Organization
            <input className="input" name="organization" required />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Notes
            <textarea className="input min-h-28" name="message" />
          </label>
          <SubmitButton>Submit request</SubmitButton>
        </form>
      </section>
    </main>
  );
}
