/**
 * Support conversation intake for LabOps AI.
 *
 * `support_requests` stays the only authoritative ticket table and `support_messages` the
 * only conversation. This module turns that conversation into bounded, sanitized evidence:
 *
 * - internal staff notes (`is_internal = true`) never leave the portal;
 * - only author role, timestamp and sanitized body travel — never a name, email or user id;
 * - each message is sanitized independently and wrapped as untrusted evidence, so an
 *   injection in message 14 cannot escape the quoting of message 14;
 * - message count and total size are bounded, and what was dropped is recorded;
 * - attachments contribute metadata only: no storage path, no signed URL, no content.
 *
 * Nothing here writes to the database.
 */

import {
  packageUntrustedContent,
  sanitizeUntrustedText,
  type SanitizeResult,
} from "@/lib/labops/sanitize";
import type { Database } from "@/lib/types";

export type SupportMessageRow =
  Database["public"]["Tables"]["support_messages"]["Row"];

export type ConversationAttachmentMeta = {
  messageId: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

/** Newest messages are kept when a ticket is longer than this. */
export const MAX_CONVERSATION_MESSAGES = 20;

/** Total sanitized conversation characters allowed in one brief. */
export const MAX_CONVERSATION_CHARS = 24_000;

/** Per-message cap, so one pasted log cannot consume the whole budget. */
export const MAX_MESSAGE_CHARS = 4_000;

export type ConversationEntry = {
  messageId: string;
  authorRole: SupportMessageRow["author_role"];
  createdAt: string;
  body: string;
  attachments: string[];
};

export type ConversationContext = {
  entries: ConversationEntry[];
  includedMessageIds: string[];
  /** Chronologically newest included message, used for the freshness check. */
  lastIncludedMessageAt: string | null;
  internalExcluded: number;
  /** Older messages dropped because of the count or size bound. */
  droppedForBounds: number;
  /** True when the first message repeated the ticket description verbatim. */
  deduplicatedDescription: boolean;
  prompt: string;
  provenance: {
    pii: string[];
    neutralized: string[];
    truncatedMessages: number;
    redactions: SanitizeResult["redactions"];
  };
};

function normalizeForComparison(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function describeAttachments(
  attachments: readonly ConversationAttachmentMeta[],
) {
  return attachments.map((attachment) => {
    const name = sanitizeUntrustedText(attachment.fileName, { maxLength: 120 })
      .text.replace(/\s+/g, "_")
      .replace(/[^\w.+-]/g, "_");
    const size =
      typeof attachment.sizeBytes === "number"
        ? `, ${Math.ceil(attachment.sizeBytes / 1024)} KB`
        : "";

    return `${name} (${attachment.mimeType ?? "unknown"}${size})`;
  });
}

/**
 * Builds the sanitized conversation. `messages` may arrive in any order and may include
 * internal notes; both are handled here rather than trusted from the caller's query.
 */
export function buildConversationContext(
  messages: readonly SupportMessageRow[],
  options: {
    /** `support_requests.description`, used only to drop a duplicated first message. */
    description?: string | null;
    attachments?: readonly ConversationAttachmentMeta[];
    maxMessages?: number;
    maxChars?: number;
  } = {},
): ConversationContext {
  const maxMessages = options.maxMessages ?? MAX_CONVERSATION_MESSAGES;
  const maxChars = options.maxChars ?? MAX_CONVERSATION_CHARS;
  const attachmentsByMessage = new Map<string, ConversationAttachmentMeta[]>();

  for (const attachment of options.attachments ?? []) {
    const current = attachmentsByMessage.get(attachment.messageId) ?? [];
    current.push(attachment);
    attachmentsByMessage.set(attachment.messageId, current);
  }

  const internalExcluded = messages.filter((message) => message.is_internal).length;
  const ordered = messages
    .filter((message) => !message.is_internal)
    .slice()
    .sort((left, right) => left.created_at.localeCompare(right.created_at));

  let deduplicatedDescription = false;
  const description = normalizeForComparison(options.description ?? "");
  const candidates = ordered.filter((message, index) => {
    const duplicate =
      index === 0 &&
      description.length > 0 &&
      normalizeForComparison(message.body) === description;

    if (duplicate) {
      deduplicatedDescription = true;
    }

    return !duplicate;
  });

  let droppedForBounds = Math.max(0, candidates.length - maxMessages);
  const windowed = candidates.slice(-maxMessages);

  // Sanitize newest-first so the size bound keeps the most recent exchange, then restore
  // chronological order for the prompt.
  const kept: { entry: ConversationEntry; result: SanitizeResult }[] = [];
  let budget = maxChars;

  for (const message of [...windowed].reverse()) {
    const result = sanitizeUntrustedText(message.body, {
      maxLength: MAX_MESSAGE_CHARS,
      keepPodIdentifiers: true,
    });

    if (result.text.length > budget) {
      droppedForBounds += 1;
      continue;
    }

    budget -= result.text.length;
    kept.push({
      entry: {
        messageId: message.id,
        authorRole: message.author_role,
        createdAt: message.created_at,
        body: result.text,
        attachments: describeAttachments(attachmentsByMessage.get(message.id) ?? []),
      },
      result,
    });
  }

  kept.reverse();

  const entries = kept.map(({ entry }) => entry);
  const prompt = entries
    .map((entry, index) =>
      packageUntrustedContent(
        `support_message:${index + 1}:${entry.authorRole}:${entry.createdAt}`,
        [
          entry.body,
          entry.attachments.length > 0
            ? `Attachments on this message (contents not provided): ${entry.attachments.join(", ")}`
            : "",
        ]
          .join("\n")
          .trim(),
      ),
    )
    .join("\n\n");

  return {
    entries,
    includedMessageIds: entries.map((entry) => entry.messageId),
    lastIncludedMessageAt: entries.at(-1)?.createdAt ?? null,
    internalExcluded,
    droppedForBounds,
    deduplicatedDescription,
    prompt,
    provenance: {
      pii: [...new Set(kept.flatMap(({ result }) => result.pii))],
      neutralized: [...new Set(kept.flatMap(({ result }) => result.neutralized))],
      truncatedMessages: kept.filter(({ result }) => result.truncated).length,
      redactions: kept.flatMap(({ result }) => result.redactions),
    },
  };
}

export type ContextFreshness = {
  /** `support_requests.last_message_at` as read when the context was captured. */
  lastMessageAt: string;
  includedMessageIds: string[];
};

/**
 * A run's proposals are only valid for the conversation it actually read. The ticket's
 * `last_message_at` plus the set of included message ids is enough to detect a new student
 * reply, an edited window, or a message the run never saw.
 */
export function isContextStale(
  captured: ContextFreshness,
  current: {
    lastMessageAt: string;
    /**
     * Non-internal message ids created at or after the capture. Older messages the run
     * dropped for its size bound are deliberately not staleness: the run summarised the
     * newest exchange, which is what a resolution is judged against.
     */
    recentMessageIds?: readonly string[];
  },
) {
  if (captured.lastMessageAt !== current.lastMessageAt) {
    return true;
  }

  if (!current.recentMessageIds) {
    return false;
  }

  const seen = new Set(captured.includedMessageIds);

  return current.recentMessageIds.some((id) => !seen.has(id));
}
