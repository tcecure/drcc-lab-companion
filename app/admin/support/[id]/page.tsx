import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LockKeyhole, Send } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { SubmitButton } from "@/components/forms";
import {
  SupportConversation,
  SupportStatusBadge,
} from "@/components/support-ticket-ui";
import {
  addAdminInternalNoteAction,
  addAdminSupportReplyAction,
  updateSupportTicketAction,
} from "@/lib/actions/support-tickets";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getSupportConversation } from "@/lib/support-data";
import {
  getSupportCategoryLabel,
  getTicketCode,
  supportStatuses,
} from "@/lib/support-tickets";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminTicketPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function AdminTicketPage({
  params,
  searchParams,
}: AdminTicketPageProps) {
  const [{ user, roles }, { id }, feedback] = await Promise.all([
    requireAdmin(),
    params,
    searchParams,
  ]);
  const supabase = createAdminClient();
  const { data: ticket } = await supabase
    .from("support_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!ticket) {
    notFound();
  }

  const [messages, { data: assignedProfile }] = await Promise.all([
    getSupportConversation(ticket.id, true),
    ticket.assigned_to
      ? supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", ticket.assigned_to)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <AppShell roles={roles} title={getTicketCode(ticket.id)}>
      {feedback.error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {feedback.error}
        </p>
      ) : null}
      {feedback.message ? (
        <p className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm text-cyan-100">
          {feedback.message}
        </p>
      ) : null}
      <Link
        className="inline-flex w-fit items-center gap-2 text-sm font-bold text-cyan-100 hover:text-white"
        href="/admin/support"
      >
        <ArrowLeft aria-hidden="true" size={16} />
        Back to support queue
      </Link>

      <section className="grid gap-6 border-y border-cyan-200/15 py-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <SupportStatusBadge status={ticket.status} />
            <span className="text-xs font-bold uppercase text-slate-500">
              {ticket.priority} priority
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-bold">{ticket.subject}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {ticket.requester_name || "Student"} ·{" "}
            {ticket.requester_email || "Email unavailable"}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {getSupportCategoryLabel(ticket.category)}
            {ticket.lab_family ? ` · ${ticket.lab_family}` : ""}
            {ticket.pod_name ? ` · ${ticket.pod_name}` : ""}
          </p>
        </div>
        <dl className="grid grid-cols-2 content-start gap-x-5 gap-y-2 text-sm">
          <dt className="text-slate-500">Opened</dt>
          <dd>{formatDateTime(ticket.created_at)}</dd>
          <dt className="text-slate-500">Last update</dt>
          <dd>{formatDateTime(ticket.last_message_at)}</dd>
          <dt className="text-slate-500">Assigned</dt>
          <dd>
            {assignedProfile?.full_name ||
              assignedProfile?.email ||
              (ticket.assigned_to === user.id ? "You" : "Unassigned")}
          </dd>
        </dl>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)] xl:items-start">
        <Card eyebrow="Conversation" title="Ticket history">
          <SupportConversation messages={messages} />
        </Card>
        <Card eyebrow="Ownership" title="Status and priority">
          <form action={updateSupportTicketAction} className="grid gap-4">
            <input name="ticketId" type="hidden" value={ticket.id} />
            <label className="grid gap-2 text-sm font-bold">
              Status
              <select
                className="input"
                defaultValue={ticket.status}
                name="status"
              >
                {supportStatuses.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold">
              Priority
              <select
                className="input"
                defaultValue={ticket.priority}
                name="priority"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <p className="text-xs leading-5 text-slate-500">
              Saving also assigns this ticket to you. Student replies reopen
              resolved tickets automatically.
            </p>
            <SubmitButton>Save ticket</SubmitButton>
          </form>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card eyebrow="Student response" title="Reply to requester">
          <form action={addAdminSupportReplyAction} className="grid gap-4">
            <input name="ticketId" type="hidden" value={ticket.id} />
            <label className="grid gap-2 text-sm font-bold">
              Reply
              <textarea
                className="input min-h-36 resize-y"
                maxLength={10000}
                name="body"
                placeholder="Give the student a clear next action. This response is emailed and saved in the portal."
                required
              />
            </label>
            <p className="text-xs leading-5 text-slate-500">
              Sending assigns the ticket to you and moves it to waiting on
              student.
            </p>
            <div>
              <SubmitButton>
                <Send aria-hidden="true" size={16} />
                Send reply
              </SubmitButton>
            </div>
          </form>
        </Card>

        <Card eyebrow="Staff only" title="Add internal note">
          <form action={addAdminInternalNoteAction} className="grid gap-4">
            <input name="ticketId" type="hidden" value={ticket.id} />
            <label className="grid gap-2 text-sm font-bold">
              <span className="inline-flex items-center gap-2">
                <LockKeyhole aria-hidden="true" size={15} />
                Note
              </span>
              <textarea
                className="input min-h-36 resize-y"
                maxLength={10000}
                name="body"
                placeholder="Record troubleshooting context that students should not see."
                required
              />
            </label>
            <p className="text-xs leading-5 text-amber-100/80">
              Internal notes never appear in the student portal or email.
            </p>
            <div>
              <SubmitButton className="secondary">
                Save internal note
              </SubmitButton>
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
