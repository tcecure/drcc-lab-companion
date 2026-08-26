import Link from "next/link";

import { SubmitButton } from "@/components/forms";
import { requestPasswordResetAction } from "@/lib/actions/auth";

type ForgotPasswordPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <section className="card w-full max-w-md">
        <p className="eyebrow">DigitalRCC Account Access</p>
        <h1 className="mt-2 text-3xl font-bold">Reset your password</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Enter the email connected to your Lab Companion account. We will send
          you a secure link to choose a new password.
        </p>
        {params.error ? (
          <p className="mt-5 rounded-md border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
            {params.error}
          </p>
        ) : null}
        {params.message ? (
          <p className="mt-5 rounded-md border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm text-cyan-50">
            {params.message}
          </p>
        ) : null}
        <form action={requestPasswordResetAction} className="mt-6 grid gap-4">
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
          <SubmitButton>Send reset link</SubmitButton>
        </form>
        <Link
          className="mt-5 inline-flex text-sm font-bold text-cyan-200 hover:text-cyan-100"
          href="/login"
        >
          Return to login
        </Link>
      </section>
    </main>
  );
}
