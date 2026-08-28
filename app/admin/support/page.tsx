import Link from "next/link";
import { ArrowRight, BookOpenCheck, Inbox } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { SupportStatusBadge } from "@/components/support-ticket-ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  getSupportCategoryLabel,
  getTicketCode,
  supportStatuses,
  type SupportStatus,
} from "@/lib/support-tickets";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminSupportPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
    status?: string;
  }>;
};

function isSupportStatus(value: string | undefined): value is SupportStatus {
  return supportStatuses.some((status) => status.value === value);
}

export default async function AdminSupportPage({
  searchParams,
}: AdminSupportPageProps) {
  const [{ roles }, params] = await Promise.all([requireAdmin(), searchParams]);
  const supabase = createAdminClient();
  const { data: tickets } = await supabase
    .from("support_requests")
    .select("*")
    .order("last_message_at", { ascending: false })
    .limit(300);
  const selectedStatus = isSupportStatus(params.status) ? params.status : null;
  const visibleTickets = selectedStatus
    ? (tickets ?? []).filter((ticket) => ticket.status === selectedStatus)
    : (tickets ?? []).filter((ticket) => ticket.status !== "closed");
  const counts = new Map<SupportStatus, number>();

  for (const ticket of tickets ?? []) {
    counts.set(ticket.status, (counts.get(ticket.status) ?? 0) + 1);
  }

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
          <p className="eyebrow">Student care</p>
          <h2 className="mt-2 text-2xl font-bold">Support queue</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Student issues, account-access exceptions, staff replies, and
            internal notes remain attached to one auditable ticket.
          </p>
        </div>
        <Link className="button secondary" href="/support">
          <BookOpenCheck aria-hidden="true" size={17} />
          Review known issues
        </Link>
      </section>

      <nav
        aria-label="Filter support tickets"
        className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6"
      >
        <FilterLink
          active={!selectedStatus}
          count={
            (tickets ?? []).filter((ticket) => ticket.status !== "closed")
              .length
          }
          href="/admin/support"
          label="Active"
        />
        {supportStatuses.map((status) => (
          <FilterLink
            active={selectedStatus === status.value}
            count={counts.get(status.value) ?? 0}
            href={`/admin/support?status=${status.value}`}
            key={status.value}
            label={status.label}
          />
        ))}
      </nav>

      <Card eyebrow="Ticket queue" title={`${visibleTickets.length} shown`}>
        {visibleTickets.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Requester</th>
                  <th>Context</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th aria-label="Open ticket" />
                </tr>
              </thead>
              <tbody>
                {visibleTickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <Link
                        className="font-bold text-cyan-100 hover:text-white"
                        href={`/admin/support/${ticket.id}`}
                      >
                        {ticket.subject}
                      </Link>
                      <p className="mt-1 font-mono text-xs text-slate-500">
                        {getTicketCode(ticket.id)}
                      </p>
                    </td>
                    <td>
                      <p className="font-bold">
                        {ticket.requester_name || "Student"}
                      </p>
                      <p className="break-all text-slate-400">
                        {ticket.requester_email || "Email unavailable"}
                      </p>
                    </td>
                    <td>
                      <p>{getSupportCategoryLabel(ticket.category)}</p>
                      <p className="text-slate-400">
                        {[ticket.lab_family, ticket.pod_name]
                          .filter(Boolean)
                          .join(" · ") || "General"}
                      </p>
                    </td>
                    <td className="capitalize">{ticket.priority}</td>
                    <td>
                      <SupportStatusBadge status={ticket.status} />
                    </td>
                    <td>{formatDateTime(ticket.last_message_at)}</td>
                    <td>
                      <Link
                        aria-label={`Open ${getTicketCode(ticket.id)}`}
                        className="inline-grid h-9 w-9 place-items-center rounded-md text-cyan-100 hover:bg-white/5"
                        href={`/admin/support/${ticket.id}`}
                      >
                        <ArrowRight aria-hidden="true" size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-center gap-3 border-y border-cyan-200/10 py-8 text-sm text-slate-400">
            <Inbox aria-hidden="true" size={19} />
            No tickets match this view.
          </div>
        )}
      </Card>
    </AppShell>
  );
}

function FilterLink({
  active,
  count,
  href,
  label,
}: {
  active: boolean;
  count: number;
  href: string;
  label: string;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`grid min-h-20 content-center rounded-lg border px-4 transition ${
        active
          ? "border-cyan-300/45 bg-cyan-400/10"
          : "border-cyan-200/10 bg-slate-950/40 hover:border-cyan-200/30"
      }`}
      href={href}
    >
      <span className="text-xs font-bold text-slate-400">{label}</span>
      <span className="mt-1 text-2xl font-bold">{count}</span>
    </Link>
  );
}
