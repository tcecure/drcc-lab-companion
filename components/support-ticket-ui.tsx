import { ExternalLink, LockKeyhole, MessageSquareText } from "lucide-react";

import { formatDateTime } from "@/lib/format";
import type { SupportMessageView } from "@/lib/support-data";
import {
  getSupportStatusLabel,
  type SupportStatus,
} from "@/lib/support-tickets";

export function SupportStatusBadge({ status }: { status: SupportStatus }) {
  const tone =
    status === "resolved" || status === "closed"
      ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
      : status === "waiting_on_student"
        ? "border-amber-300/25 bg-amber-400/10 text-amber-100"
        : "border-cyan-300/25 bg-cyan-400/10 text-cyan-100";

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${tone}`}
    >
      {getSupportStatusLabel(status)}
    </span>
  );
}

export function SupportConversation({
  messages,
}: {
  messages: SupportMessageView[];
}) {
  if (!messages.length) {
    return (
      <div className="flex items-center gap-3 border-y border-cyan-200/10 py-8 text-sm text-slate-400">
        <MessageSquareText aria-hidden="true" size={19} />
        No conversation has been recorded yet.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {messages.map((message) => {
        const staff = message.author_role === "staff";
        const internal = message.is_internal;

        return (
          <article
            className={`border-l-2 px-4 py-3 ${
              internal
                ? "border-amber-300 bg-amber-400/[0.07]"
                : staff
                  ? "border-cyan-300 bg-cyan-400/[0.06]"
                  : "border-slate-500 bg-white/[0.03]"
            }`}
            key={message.id}
          >
            <header className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-slate-100">
                  {message.authorName}
                </p>
                {internal ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-100">
                    <LockKeyhole aria-hidden="true" size={13} />
                    Internal note
                  </span>
                ) : null}
              </div>
              <time className="text-xs text-slate-500">
                {formatDateTime(message.created_at)}
              </time>
            </header>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">
              {message.body}
            </p>
            {message.attachments.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {message.attachments.map((attachment) =>
                  attachment.signedUrl ? (
                    <a
                      className="inline-flex min-h-9 items-center gap-2 rounded-md border border-cyan-200/15 bg-white/[0.04] px-3 text-xs font-bold text-cyan-100 hover:bg-white/[0.08]"
                      href={attachment.signedUrl}
                      key={attachment.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {attachment.file_name}
                      <ExternalLink aria-hidden="true" size={13} />
                    </a>
                  ) : null,
                )}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
