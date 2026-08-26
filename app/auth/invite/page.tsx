import Link from "next/link";

import { SubmitButton } from "@/components/forms";
import { confirmInvitationAction } from "@/lib/actions/auth";

type InvitationPageProps = {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
};

export default async function InvitationPage({
  searchParams,
}: InvitationPageProps) {
  const params = await searchParams;
  const validLink = Boolean(params.token_hash && params.type === "invite");

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <section className="card w-full max-w-md">
        <p className="eyebrow">DigitalRCC Account Access</p>
        <h1 className="mt-2 text-3xl font-bold">Accept your invitation</h1>
        {validLink ? (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Your DigitalRCC invitation is ready. Continue to activate your
              account and choose a password.
            </p>
            <form action={confirmInvitationAction} className="mt-6">
              <input
                name="tokenHash"
                type="hidden"
                value={params.token_hash}
              />
              <input name="type" type="hidden" value="invite" />
              <SubmitButton>Activate account</SubmitButton>
            </form>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              This invitation link is incomplete. Ask the DigitalRCC team to
              send a new invitation.
            </p>
            <Link
              className="mt-6 inline-flex text-sm font-bold text-cyan-200 hover:text-cyan-100"
              href="/login"
            >
              Return to login
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
