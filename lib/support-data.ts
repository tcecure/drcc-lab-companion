import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { SupportAttachment, SupportMessage } from "@/lib/support-tickets";

export type SupportAttachmentView = SupportAttachment & {
  signedUrl: string | null;
};

export type SupportMessageView = SupportMessage & {
  attachments: SupportAttachmentView[];
  authorName: string;
};

export async function getSupportConversation(
  ticketId: string,
  includeInternal: boolean,
) {
  const supabase = createAdminClient();
  let query = supabase
    .from("support_messages")
    .select("*")
    .eq("support_request_id", ticketId)
    .order("created_at", { ascending: true });

  if (!includeInternal) {
    query = query.eq("is_internal", false);
  }

  const { data: messages, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const messageIds = (messages ?? []).map((message) => message.id);
  const authorIds = [
    ...new Set(
      (messages ?? [])
        .map((message) => message.author_user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [{ data: attachments }, { data: profiles }] = await Promise.all([
    messageIds.length
      ? supabase
          .from("support_attachments")
          .select("*")
          .in("support_message_id", messageIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as SupportAttachment[] }),
    authorIds.length
      ? supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", authorIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; full_name: string; email: string }>,
        }),
  ]);
  const attachmentRows = attachments ?? [];
  const paths = attachmentRows.map((attachment) => attachment.storage_path);
  const { data: signedFiles } = paths.length
    ? await supabase.storage
        .from("support-attachments")
        .createSignedUrls(paths, 3600)
    : { data: [] };
  const signedUrlMap = new Map(
    (signedFiles ?? []).map((file) => [file.path, file.signedUrl]),
  );
  const attachmentMap = new Map<string, SupportAttachmentView[]>();

  for (const attachment of attachmentRows) {
    const current = attachmentMap.get(attachment.support_message_id) ?? [];
    current.push({
      ...attachment,
      signedUrl: signedUrlMap.get(attachment.storage_path) ?? null,
    });
    attachmentMap.set(attachment.support_message_id, current);
  }

  const profileMap = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      profile.full_name || profile.email,
    ]),
  );

  return (messages ?? []).map((message): SupportMessageView => ({
    ...message,
    attachments: attachmentMap.get(message.id) ?? [],
    authorName:
      (message.author_user_id
        ? profileMap.get(message.author_user_id)
        : null) ??
      (message.author_role === "staff"
        ? "DigitalRCC Support"
        : message.author_role === "system"
          ? "Portal"
          : "Student"),
  }));
}
