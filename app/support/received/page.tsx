import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { PublicHeader } from "@/components/public-header";
import { getTicketCode } from "@/lib/support-tickets";

export const metadata: Metadata = {
  title: "Support Request Received",
};

type ReceivedPageProps = {
  searchParams: Promise<{ ticket?: string }>;
};

export default async function SupportReceivedPage({
  searchParams,
}: ReceivedPageProps) {
  const { ticket } = await searchParams;
  const ticketCode = ticket ? getTicketCode(ticket) : null;

  return (
    <>
      <PublicHeader />
      <main className="mx-auto grid min-h-[70vh] w-full max-w-3xl place-items-center px-4 py-12 sm:px-6">
        <section className="w-full border-y border-cyan-200/15 py-10 text-center">
          <CheckCircle2
            aria-hidden="true"
            className="mx-auto text-cyan-300"
            size={34}
          />
          <p className="eyebrow mt-5">Request received</p>
          <h1 className="mt-3 text-3xl font-bold">
            Your ticket is in the queue
          </h1>
          {ticketCode ? (
            <p className="mt-4 font-mono text-sm font-bold text-cyan-100">
              {ticketCode}
            </p>
          ) : null}
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-300">
            TCecure staff have been notified. Because this request concerns
            account access, the first response will be sent to the email address
            you provided.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link className="button" href="/login">
              Try signing in
            </Link>
            <Link className="button secondary" href="/support">
              Review known issues
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
