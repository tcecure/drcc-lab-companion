import Link from "next/link";

import { SubmitButton } from "@/components/forms";
import { confirmPasswordRecoveryAction } from "@/lib/actions/auth";

type RecoveryPageProps = {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
};

export default async function RecoveryPage({
  searchParams,
}: RecoveryPageProps) {
  const params = await searchParams;
  const validLink = Boolean(
    params.token_hash && params.type === "recovery",
  );

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <section className="card w-full max-w-md">
        <p className="eyebrow">DigitalRCC Account Access</p>
        <h1 className="mt-2 text-3xl font-bold">Confirm password reset</h1>
        {validLink ? (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Your reset request is ready. Continue to choose a new password.
            </p>
            <form action={confirmPasswordRecoveryAction} className="mt-6">
              <input
                name="tokenHash"
                type="hidden"
                value={params.token_hash}
              />
              <input name="type" type="hidden" value="recovery" />
              <SubmitButton>Continue</SubmitButton>
            </form>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              This password reset link is incomplete. Request a new link to
              continue.
            </p>
            <Link
              className="mt-6 inline-flex text-sm font-bold text-cyan-200 hover:text-cyan-100"
              href="/forgot-password"
            >
              Request a new link
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
