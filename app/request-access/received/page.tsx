import Link from "next/link";

export default function RequestReceivedPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <section className="card max-w-lg text-center">
        <p className="eyebrow">Request Received</p>
        <h1 className="mt-2 text-3xl font-bold">
          You are in the intake queue.
        </h1>
        <p className="mt-4 leading-7 text-slate-300">
          The DigitalRCC team will review your request and schedule student
          access through the cohort queue.
        </p>
        <Link className="button mt-6" href="/login">
          Return to login
        </Link>
      </section>
    </main>
  );
}
