import { SubmitButton } from "@/components/forms";
import { loginAction } from "@/lib/actions/auth";

type LabOpsLandingProps = {
  searchParams: Promise<{ error?: string }>;
};

export const metadata = {
  title: "DigitalRCC LabOps AI",
};

/**
 * Public landing page for labops.drcc.digitalrcc.com: a sign-in box only, so the host
 * never shows the student-facing portal home.
 */
export default async function LabOpsLandingPage({
  searchParams,
}: LabOpsLandingProps) {
  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10 sm:px-6">
      <section className="card w-full max-w-md">
        <p className="eyebrow">DigitalRCC</p>
        <h1 className="mt-2 text-3xl font-bold">LabOps AI</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Staff operations console. Sign in with your DigitalRCC account.
        </p>
        {params.error ? (
          <p className="mt-5 rounded-md border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
            {params.error}
          </p>
        ) : null}
        <form action={loginAction} className="mt-6 grid gap-4">
          <input name="next" type="hidden" value="/admin/labops" />
          <input name="loginPath" type="hidden" value="/labops" />
          <label className="grid gap-2 text-sm font-semibold">
            Email
            <input className="input" name="email" required type="email" />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Password
            <input className="input" name="password" required type="password" />
          </label>
          <SubmitButton>Log in</SubmitButton>
        </form>
      </section>
    </main>
  );
}
