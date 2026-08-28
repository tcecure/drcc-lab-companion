import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Paperclip, Send } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { SubmitButton } from "@/components/forms";
import {
  SupportConversation,
  SupportStatusBadge,
} from "@/components/support-ticket-ui";
import { addStudentSupportReplyAction } from "@/lib/actions/support-tickets";
import { requireStudent } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getSupportConversation } from "@/lib/support-data";
import { getSupportCategoryLabel, getTicketCode } from "@/lib/support-tickets";
import { createAdminClient } from "@/lib/supabase/admin";

type StudentTicketPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function StudentTicketPage({
  params,
  searchParams,
}: StudentTicketPageProps) {
  const [{ user, roles }, { id }, feedback] = await Promise.all([
    requireStudent(),
    params,
    searchParams,
  ]);
  const supabase = createAdminClient();
  const { data: ticket } = await supabase
    .from("support_requests")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!ticket) {
    notFound();
  }

  const messages = await getSupportConversation(ticket.id, false);
  const replyAllowed = ticket.status !== "closed";

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
        href="/student/support"
      >
        <ArrowLeft aria-hidden="true" size={16} />
        Back to tickets
      </Link>
      <section className="grid gap-5 border-y border-cyan-200/15 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <SupportStatusBadge status={ticket.status} />
            <span className="text-xs font-bold uppercase text-slate-500">
              {ticket.priority} priority
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-bold">{ticket.subject}</h2>
          <p className="mt-2 text-sm text-slate-400">
            {getSupportCategoryLabel(ticket.category)}
            {ticket.lab_family ? ` · ${ticket.lab_family}` : ""}
            {ticket.pod_name ? ` · ${ticket.pod_name}` : ""}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:text-right">
          <dt className="text-slate-500">Opened</dt>
          <dd>{formatDateTime(ticket.created_at)}</dd>
          <dt className="text-slate-500">Last update</dt>
          <dd>{formatDateTime(ticket.last_message_at)}</dd>
        </dl>
      </section>

      <Card eyebrow="Conversation" title="Support history">
        <SupportConversation messages={messages} />
      </Card>

      {replyAllowed ? (
        <Card
          eyebrow={
            ticket.status === "resolved" ? "Reopen ticket" : "Your reply"
          }
          title={
            ticket.status === "resolved"
              ? "Still need help?"
              : "Continue the conversation"
          }
        >
          <form
            action={addStudentSupportReplyAction}
            className="grid gap-4"
          >
            <input name="ticketId" type="hidden" value={ticket.id} />
            <label className="grid gap-2 text-sm font-bold">
              Reply
              <textarea
                className="input min-h-32 resize-y"
                maxLength={10000}
                name="body"
                placeholder="Add new information or answer the support team’s question."
                required
              />
            </label>
            <label className="grid gap-2 text-sm font-bold">
              <span className="inline-flex items-center gap-2">
                <Paperclip aria-hidden="true" size={15} />
                Add screenshot
                <span className="font-normal text-slate-400">Optional</span>
              </span>
              <input
                accept="image/png,image/jpeg,image/webp"
                className="input file:mr-3 file:rounded-md file:border-0 file:bg-cyan-300 file:px-3 file:py-1 file:font-bold file:text-slate-950"
                name="screenshot"
                type="file"
              />
            </label>
            <div>
              <SubmitButton>
                <Send aria-hidden="true" size={16} />
                {ticket.status === "resolved"
                  ? "Reopen and reply"
                  : "Send reply"}
              </SubmitButton>
            </div>
          </form>
        </Card>
      ) : (
        <p className="rounded-lg border border-slate-500/20 bg-slate-500/10 p-4 text-sm text-slate-300">
          This ticket is closed. Open a new ticket if you need more help.
        </p>
      )}
    </AppShell>
  );
}
