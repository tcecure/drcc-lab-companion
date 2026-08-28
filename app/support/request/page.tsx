import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";

import { SubmitButton } from "@/components/forms";
import { PublicHeader } from "@/components/public-header";
import { createPublicAccountSupportTicketAction } from "@/lib/actions/support-tickets";

export const metadata: Metadata = {
  title: "Account Support",
  description: "Request help accessing your DigitalRCC student account.",
};

export const dynamic = "force-dynamic";

type AccountSupportPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function AccountSupportPage({
  searchParams,
}: AccountSupportPageProps) {
  const params = await searchParams;

  return (
    <>
      <PublicHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <Link
          className="inline-flex items-center gap-2 text-sm font-bold text-cyan-100 hover:text-white"
          href="/support"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          Back to known issues
        </Link>
        <section className="mt-6 border-b border-cyan-200/15 pb-7">
          <p className="eyebrow">Account access</p>
          <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
            Get help signing in
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
            Use this form only when you cannot access your portal account. Once
            you can sign in, all support conversations continue inside the Lab
            Companion.
          </p>
        </section>

        {params.error ? (
          <p className="mt-6 rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
            {params.error}
          </p>
        ) : null}

        <form
          action={createPublicAccountSupportTicketAction}
          className="mt-7 grid gap-5"
        >
          <input name="startedAt" type="hidden" value={Date.now()} />
          <div aria-hidden="true" className="hidden">
            <label>
              Company
              <input autoComplete="off" name="company" tabIndex={-1} />
            </label>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-bold">
              Full name
              <input
                autoComplete="name"
                className="input"
                maxLength={120}
                name="requesterName"
                required
              />
            </label>
            <label className="grid gap-2 text-sm font-bold">
              Student email
              <input
                autoComplete="email"
                className="input"
                maxLength={254}
                name="requesterEmail"
                required
                type="email"
              />
            </label>
          </div>
          <label className="grid gap-2 text-sm font-bold">
            What is preventing access?
            <input
              className="input"
              maxLength={120}
              name="subject"
              placeholder="Example: Password reset link has expired"
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-bold">
            Details
            <textarea
              className="input min-h-36 resize-y"
              maxLength={5000}
              minLength={20}
              name="description"
              placeholder="Tell us what you tried, what happened, and any error message you saw."
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-bold">
            Screenshot{" "}
            <span className="font-normal text-slate-400">Optional</span>
            <input
              accept="image/png,image/jpeg,image/webp"
              className="input file:mr-3 file:rounded-md file:border-0 file:bg-cyan-300 file:px-3 file:py-1 file:font-bold file:text-slate-950"
              name="screenshot"
              type="file"
            />
            <span className="text-xs font-normal text-slate-500">
              PNG, JPEG, or WebP. Maximum 3 MB.
            </span>
          </label>
          <div className="flex items-start gap-2 border-t border-cyan-200/10 pt-5 text-sm text-amber-100">
            <LockKeyhole
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              size={16}
            />
            Never include a password, invitation link, or recovery code.
          </div>
          <div>
            <SubmitButton>Open account support ticket</SubmitButton>
          </div>
        </form>
      </main>
    </>
  );
}
