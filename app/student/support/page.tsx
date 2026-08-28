import Link from "next/link";
import { ArrowRight, LifeBuoy, Plus } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { SupportStatusBadge } from "@/components/support-ticket-ui";
import { requireStudent } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getSupportCategoryLabel, getTicketCode } from "@/lib/support-tickets";
import { createAdminClient } from "@/lib/supabase/admin";

type StudentSupportPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function StudentSupportPage({
  searchParams,
}: StudentSupportPageProps) {
  const [{ user, roles }, params] = await Promise.all([
    requireStudent(),
    searchParams,
  ]);
  const supabase = createAdminClient();
  const { data: tickets } = await supabase
    .from("support_requests")
    .select("*")
    .eq("user_id", user.id)
    .order("last_message_at", { ascending: false })
    .limit(100);

  return (
    <AppShell roles={roles} title="Support Tickets">
      {params.error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {params.error}
        </p>
      ) : null}
      {params.message ? (
        <p className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm text-cyan-100">
          {params.message}
        </p>
      ) : null}
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-cyan-200/15 pb-5">
        <div>
          <p className="eyebrow">Student support</p>
          <h2 className="mt-2 text-2xl font-bold">Your conversations</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Keep every question and response here so the support team can see
            the full history of your lab issue.
          </p>
        </div>
        <Link className="button" href="/student/support/new">
          <Plus aria-hidden="true" size={17} />
          Open ticket
        </Link>
      </section>

      {(tickets ?? []).length ? (
        <div className="grid gap-3">
          {(tickets ?? []).map((ticket) => (
            <Link
              className="group grid gap-4 rounded-lg border border-cyan-200/15 bg-slate-950/45 p-4 transition hover:border-cyan-300/45 hover:bg-slate-900/65 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              href={`/student/support/${ticket.id}`}
              key={ticket.id}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-cyan-200">
                    {getTicketCode(ticket.id)}
                  </span>
                  <SupportStatusBadge status={ticket.status} />
                </div>
                <h3 className="mt-3 truncate font-bold text-slate-100">
                  {ticket.subject}
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  {getSupportCategoryLabel(ticket.category)}
                  {ticket.lab_family ? ` · ${ticket.lab_family}` : ""}
                  {ticket.pod_name ? ` · ${ticket.pod_name}` : ""}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Updated {formatDateTime(ticket.last_message_at)}
                </p>
              </div>
              <span className="inline-flex items-center gap-2 text-sm font-bold text-cyan-100">
                View conversation
                <ArrowRight
                  aria-hidden="true"
                  className="transition group-hover:translate-x-0.5"
                  size={16}
                />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <Card eyebrow="No open conversations" title="Support starts here">
          <div className="flex items-start gap-3">
            <LifeBuoy
              aria-hidden="true"
              className="mt-1 shrink-0 text-cyan-300"
              size={20}
            />
            <div>
              <p className="text-sm leading-6 text-slate-300">
                Review known issues first. If the issue is not covered, open a
                ticket and include the exact error you see.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link className="button" href="/student/support/new">
                  Open ticket
                </Link>
                <Link className="button secondary" href="/support">
                  Review known issues
                </Link>
              </div>
            </div>
          </div>
        </Card>
      )}
    </AppShell>
  );
}
