import { SubmitButton } from "@/components/forms";
import { setPasswordAction } from "@/lib/actions/auth";
import { requireUser } from "@/lib/auth";

type SetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SetPasswordPage({
  searchParams,
}: SetPasswordPageProps) {
  await requireUser();
  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <section className="card w-full max-w-md">
        <p className="eyebrow">DigitalRCC Staff Access</p>
        <h1 className="mt-2 text-3xl font-bold">Set your password</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Create the password you will use to return to the Lab Companion.
        </p>
        {params.error ? (
          <p className="mt-5 rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
            {params.error}
          </p>
        ) : null}
        <form action={setPasswordAction} className="mt-6 grid gap-4">
          <label className="grid gap-2 text-sm font-semibold">
            Password
            <input
              autoComplete="new-password"
              className="input"
              minLength={12}
              name="password"
              required
              type="password"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Confirm password
            <input
              autoComplete="new-password"
              className="input"
              minLength={12}
              name="passwordConfirmation"
              required
              type="password"
            />
          </label>
          <p className="text-xs leading-5 text-slate-400">
            Use at least 12 characters. A passphrase is encouraged.
          </p>
          <SubmitButton>Save password</SubmitButton>
        </form>
      </section>
    </main>
  );
}
