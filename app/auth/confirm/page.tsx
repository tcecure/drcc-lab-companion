import Link from "next/link";

import { SubmitButton } from "@/components/forms";
import { confirmEmailAddressAction } from "@/lib/actions/auth";

type ConfirmationPageProps = {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
};

export default async function ConfirmationPage({
  searchParams,
}: ConfirmationPageProps) {
  const params = await searchParams;
  const validLink = Boolean(params.token_hash && params.type === "email");

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <section className="card w-full max-w-md">
        <p className="eyebrow">DigitalRCC Account Access</p>
        <h1 className="mt-2 text-3xl font-bold">Confirm your email</h1>
        {validLink ? (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Confirm this email address to finish activating your DigitalRCC
              account.
            </p>
            <form action={confirmEmailAddressAction} className="mt-6">
              <input
                name="tokenHash"
                type="hidden"
                value={params.token_hash}
              />
              <input name="type" type="hidden" value="email" />
              <SubmitButton>Confirm email address</SubmitButton>
            </form>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              This confirmation link is incomplete. Request a new confirmation
              email to continue.
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
