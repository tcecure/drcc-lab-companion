/**
 * Phase 1 ticket intake: support_requests is the only source.
 *
 * The gateway copies a minimal, sanitized brief out of a support request. The row itself
 * is never modified here and stays the authoritative record; the investigation only
 * carries a link back to it.
 */

import {
  packageUntrustedContent,
  sanitizeUntrustedText,
  type SanitizeResult,
} from "@/lib/labops/sanitize";
import type { Database } from "@/lib/types";

export type SupportRequestRow =
  Database["public"]["Tables"]["support_requests"]["Row"];

export type SupportRequestAttachment = {
  filename: string;
  contentType?: string | null;
  byteSize?: number | null;
};

/** Statuses an investigation may be opened against. */
export const investigableStatuses = [
  "open",
  "in_progress",
  "waiting_on_student",
] as const;

/** Categories LabOps AI can meaningfully investigate in Phase 1. */
export const investigableCategories = [
  "connectivity",
  "guacamole",
  "vpn",
  "verification",
  "lab_guide",
  "other",
] as const;

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string };

export function evaluateEligibility(
  request: Pick<SupportRequestRow, "status" | "category" | "description">,
): EligibilityResult {
  if (!investigableStatuses.includes(request.status as (typeof investigableStatuses)[number])) {
    return {
      eligible: false,
      reason: `Requests with status "${request.status}" are closed to investigation.`,
    };
  }

  if (!investigableCategories.includes(request.category as (typeof investigableCategories)[number])) {
    return {
      eligible: false,
      reason: `Category "${request.category}" is out of scope for Phase 1.`,
    };
  }

  if (request.description.trim().length < 20) {
    return {
      eligible: false,
      reason: "The request has too little detail to investigate; ask the student first.",
    };
  }

  return { eligible: true };
}

export function isEligibleForInvestigation(
  request: Pick<SupportRequestRow, "status" | "category" | "description">,
) {
  return evaluateEligibility(request).eligible;
}

export type InvestigationBrief = {
  supportRequestId: string;
  category: SupportRequestRow["category"];
  priority: SupportRequestRow["priority"];
  status: SupportRequestRow["status"];
  openedAt: string;
  /** Pod identifier when the assignment is known, never the student's name or email. */
  podLabel: string | null;
  subject: string;
  description: string;
  attachmentSummary: string[];
  /** Prompt-ready text: sanitized and wrapped as untrusted evidence. */
  prompt: string;
  provenance: {
    redactions: SanitizeResult["redactions"];
    pii: string[];
    neutralized: string[];
    truncated: boolean;
  };
};

const allowedAttachmentTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/json",
  "application/pdf",
]);

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Attachments are never forwarded to the model in Phase 1; only a described, sanitized
 * inventory is, so the operator can ask for a specific one deliberately.
 */
export function summarizeAttachments(
  attachments: readonly SupportRequestAttachment[],
) {
  return attachments.map((attachment) => {
    const name = sanitizeUntrustedText(attachment.filename, { maxLength: 120 }).text
      .replace(/\s+/g, "_")
      .replace(/[^\w.+-]/g, "_");
    const type = attachment.contentType?.toLowerCase() ?? "unknown";
    const notes: string[] = [];

    if (!allowedAttachmentTypes.has(type)) {
      notes.push("unsupported type, not readable by the agent");
    }

    if ((attachment.byteSize ?? 0) > MAX_ATTACHMENT_BYTES) {
      notes.push("over the 10 MB limit");
    }

    return notes.length > 0
      ? `${name} (${type}; ${notes.join("; ")})`
      : `${name} (${type})`;
  });
}

export function buildInvestigationBrief(
  request: SupportRequestRow,
  context: {
    podLabel?: string | null;
    attachments?: readonly SupportRequestAttachment[];
  } = {},
): InvestigationBrief {
  const subject = sanitizeUntrustedText(request.subject, { maxLength: 200 });
  const description = sanitizeUntrustedText(request.description);
  const attachmentSummary = summarizeAttachments(context.attachments ?? []);
  const podLabel = context.podLabel?.trim() || null;

  const evidence = [
    `Category: ${request.category}`,
    `Priority: ${request.priority}`,
    `Status: ${request.status}`,
    `Opened: ${request.created_at}`,
    podLabel ? `Pod: ${podLabel}` : "Pod: unknown",
    "",
    `Subject: ${subject.text}`,
    "",
    description.text,
    attachmentSummary.length > 0
      ? `\nAttachments listed on the ticket (contents not provided): ${attachmentSummary.join(", ")}`
      : "",
  ]
    .join("\n")
    .trim();

  return {
    supportRequestId: request.id,
    category: request.category,
    priority: request.priority,
    status: request.status,
    openedAt: request.created_at,
    podLabel,
    subject: subject.text,
    description: description.text,
    attachmentSummary,
    prompt: packageUntrustedContent(
      `support_request:${request.id}`,
      evidence,
    ),
    provenance: {
      redactions: [...subject.redactions, ...description.redactions],
      pii: [...new Set([...subject.pii, ...description.pii])],
      neutralized: [...new Set([...subject.neutralized, ...description.neutralized])],
      truncated: subject.truncated || description.truncated,
    },
  };
}
