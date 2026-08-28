"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { requireAdmin, requireStudent } from "@/lib/auth";
import {
  notifyRequesterOfReply,
  notifySupportTeam,
  notifySupportTeamOfReply,
} from "@/lib/support-notifications";
import {
  isAllowedSupportImage,
  maximumSupportImageBytes,
  sanitizeSupportFileName,
} from "@/lib/support-tickets";
import { createAdminClient } from "@/lib/supabase/admin";

const ticketSchema = z.object({
  category: z.enum([
    "connectivity",
    "guacamole",
    "vpn",
    "lab_guide",
    "verification",
    "course_platform",
    "other",
  ]),
  labFamily: z.enum(["AC", "IA", "SI", "SC", "MP", "PE"]).nullable(),
  subject: z.string().trim().min(5).max(120),
  description: z.string().trim().min(20).max(5000),
});

const publicTicketSchema = z.object({
  requesterName: z.string().trim().min(2).max(120),
  requesterEmail: z.string().trim().toLowerCase().email().max(254),
  subject: z.string().trim().min(5).max(120),
  description: z.string().trim().min(20).max(5000),
});

const replySchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(2).max(10000),
});

const ticketUpdateSchema = z.object({
  ticketId: z.string().uuid(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  status: z.enum([
    "open",
    "in_progress",
    "waiting_on_student",
    "resolved",
    "closed",
  ]),
});

type AdminClient = ReturnType<typeof createAdminClient>;

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function withMessage(path: string, kind: "error" | "message", text: string) {
  const separator = path.includes("?") ? "&" : "?";

  return `${path}${separator}${kind}=${encodeURIComponent(text)}`;
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

async function getAttachment(formData: FormData) {
  const entry = formData.get("screenshot");

  if (!(entry instanceof File) || entry.size === 0) {
    return null;
  }

  if (entry.size > maximumSupportImageBytes) {
    throw new Error("Screenshots must be 3 MB or smaller.");
  }

  if (!isAllowedSupportImage(entry.type)) {
    throw new Error("Screenshots must be PNG, JPEG, or WebP files.");
  }

  const bytes = new Uint8Array(await entry.arrayBuffer());

  if (!matchesImageSignature(bytes, entry.type)) {
    throw new Error("The screenshot content does not match its file type.");
  }

  return {
    bytes,
    fileName: sanitizeSupportFileName(entry.name),
    mimeType: entry.type as "image/jpeg" | "image/png" | "image/webp",
    size: entry.size,
  };
}

function matchesImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47].every(
      (value, index) => bytes[index] === value,
    );
  }

  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  return (
    mimeType === "image/webp" &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

async function uploadAttachment(input: {
  attachment: Awaited<ReturnType<typeof getAttachment>>;
  messageId: string;
  supabase: AdminClient;
  ticketId: string;
  uploadedBy: string | null;
}) {
  if (!input.attachment) {
    return;
  }

  const storagePath = `${input.ticketId}/${input.messageId}/${randomUUID()}-${input.attachment.fileName}`;
  const { error: uploadError } = await input.supabase.storage
    .from("support-attachments")
    .upload(storagePath, input.attachment.bytes, {
      contentType: input.attachment.mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Screenshot upload failed: ${uploadError.message}`);
  }

  const { error: metadataError } = await input.supabase
    .from("support_attachments")
    .insert({
      support_message_id: input.messageId,
      uploaded_by: input.uploadedBy,
      storage_path: storagePath,
      file_name: input.attachment.fileName,
      mime_type: input.attachment.mimeType,
      size_bytes: input.attachment.size,
    });

  if (metadataError) {
    await input.supabase.storage
      .from("support-attachments")
      .remove([storagePath]);
    throw new Error(`Screenshot metadata failed: ${metadataError.message}`);
  }
}

function scheduleNotification(task: () => Promise<unknown>) {
  after(async () => {
    try {
      await task();
    } catch (error) {
      console.error("Support notification failed.", error);
    }
  });
}

export async function createStudentSupportTicketAction(formData: FormData) {
  const { user } = await requireStudent();
  const parsed = ticketSchema.safeParse({
    category: value(formData, "category"),
    labFamily: value(formData, "labFamily") || null,
    subject: value(formData, "subject"),
    description: value(formData, "description"),
  });

  if (!parsed.success) {
    redirect(
      withMessage(
        "/student/support/new",
        "error",
        "Choose a category and provide a clear subject and description.",
      ),
    );
  }

  let attachment: Awaited<ReturnType<typeof getAttachment>>;

  try {
    attachment = await getAttachment(formData);
  } catch (error) {
    redirect(withMessage("/student/support/new", "error", errorText(error)));
  }

  const supabase = createAdminClient();
  const [{ data: profile }, { data: assignment }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("student_cohort_assignments")
      .select("pod_name")
      .eq("user_id", user.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const requesterName = profile?.full_name || user.email || "Student";
  const requesterEmail = profile?.email || user.email;

  if (!requesterEmail) {
    redirect(
      withMessage(
        "/student/support/new",
        "error",
        "Your profile does not have an email address.",
      ),
    );
  }

  const { data: ticket, error: ticketError } = await supabase
    .from("support_requests")
    .insert({
      user_id: user.id,
      category: parsed.data.category,
      subject: parsed.data.subject,
      description: parsed.data.description,
      requester_name: requesterName,
      requester_email: requesterEmail,
      lab_family: parsed.data.labFamily,
      pod_name: assignment?.pod_name ?? null,
      priority: "normal",
      status: "open",
    })
    .select("id")
    .single();

  if (ticketError || !ticket) {
    redirect(
      withMessage(
        "/student/support/new",
        "error",
        ticketError?.message ?? "The support ticket could not be created.",
      ),
    );
  }

  const { data: firstMessage, error: messageError } = await supabase
    .from("support_messages")
    .insert({
      support_request_id: ticket.id,
      author_user_id: user.id,
      author_role: "requester",
      body: parsed.data.description,
    })
    .select("id")
    .single();

  if (messageError || !firstMessage) {
    await supabase.from("support_requests").delete().eq("id", ticket.id);
    redirect(
      withMessage(
        "/student/support/new",
        "error",
        messageError?.message ??
          "The ticket conversation could not be started.",
      ),
    );
  }

  let warning: string | null = null;

  try {
    await uploadAttachment({
      attachment,
      messageId: firstMessage.id,
      supabase,
      ticketId: ticket.id,
      uploadedBy: user.id,
    });
  } catch (error) {
    warning = errorText(error);
  }

  await supabase.from("notifications").insert({
    user_id: user.id,
    notification_type: "support_ticket_created",
    title: "Support ticket opened",
    message: `We received “${parsed.data.subject}.”`,
    action_url: `/student/support/${ticket.id}`,
  });

  scheduleNotification(() =>
    notifySupportTeam({
      category: parsed.data.category,
      requesterEmail,
      requesterName,
      subject: parsed.data.subject,
      ticketId: ticket.id,
    }),
  );

  revalidatePath("/student/support");
  revalidatePath("/admin/support");
  const destination = warning
    ? withMessage(`/student/support/${ticket.id}`, "error", warning)
    : withMessage(
        `/student/support/${ticket.id}`,
        "message",
        "Support ticket opened.",
      );
  redirect(destination);
}

export async function createPublicAccountSupportTicketAction(
  formData: FormData,
) {
  if (value(formData, "company")) {
    redirect("/support/received");
  }

  const parsed = publicTicketSchema.safeParse({
    requesterName: value(formData, "requesterName"),
    requesterEmail: value(formData, "requesterEmail"),
    subject: value(formData, "subject"),
    description: value(formData, "description"),
  });

  if (!parsed.success) {
    redirect(
      withMessage(
        "/support/request",
        "error",
        "Enter your name, email, a short subject, and at least 20 characters of detail.",
      ),
    );
  }

  const startedAt = Number(value(formData, "startedAt"));
  const elapsed = Date.now() - startedAt;

  if (!Number.isFinite(startedAt) || elapsed < 1500 || elapsed > 7_200_000) {
    redirect(
      withMessage(
        "/support/request",
        "error",
        "Reload the form and try again.",
      ),
    );
  }

  let attachment: Awaited<ReturnType<typeof getAttachment>>;

  try {
    attachment = await getAttachment(formData);
  } catch (error) {
    redirect(withMessage("/support/request", "error", errorText(error)));
  }

  const supabase = createAdminClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await supabase
    .from("support_requests")
    .select("id", { count: "exact", head: true })
    .ilike("requester_email", parsed.data.requesterEmail)
    .gte("created_at", since);

  if ((count ?? 0) >= 3) {
    redirect(
      withMessage(
        "/support/request",
        "error",
        "This email has reached today’s account-support request limit.",
      ),
    );
  }

  const { data: ticket, error: ticketError } = await supabase
    .from("support_requests")
    .insert({
      user_id: null,
      category: "account_access",
      subject: parsed.data.subject,
      description: parsed.data.description,
      requester_name: parsed.data.requesterName,
      requester_email: parsed.data.requesterEmail,
      priority: "normal",
      status: "open",
    })
    .select("id")
    .single();

  if (ticketError || !ticket) {
    redirect(
      withMessage(
        "/support/request",
        "error",
        ticketError?.message ?? "The support request could not be created.",
      ),
    );
  }

  const { data: firstMessage, error: messageError } = await supabase
    .from("support_messages")
    .insert({
      support_request_id: ticket.id,
      author_user_id: null,
      author_role: "requester",
      body: parsed.data.description,
    })
    .select("id")
    .single();

  if (messageError || !firstMessage) {
    await supabase.from("support_requests").delete().eq("id", ticket.id);
    redirect(
      withMessage(
        "/support/request",
        "error",
        messageError?.message ??
          "The ticket conversation could not be started.",
      ),
    );
  }

  try {
    await uploadAttachment({
      attachment,
      messageId: firstMessage.id,
      supabase,
      ticketId: ticket.id,
      uploadedBy: null,
    });
  } catch (error) {
    console.error("Public support screenshot upload failed.", error);
  }

  scheduleNotification(() =>
    notifySupportTeam({
      category: "account access",
      requesterEmail: parsed.data.requesterEmail,
      requesterName: parsed.data.requesterName,
      subject: parsed.data.subject,
      ticketId: ticket.id,
    }),
  );

  revalidatePath("/admin/support");
  redirect(`/support/received?ticket=${encodeURIComponent(ticket.id)}`);
}

export async function addStudentSupportReplyAction(formData: FormData) {
  const { user } = await requireStudent();
  const parsed = replySchema.safeParse({
    ticketId: value(formData, "ticketId"),
    body: value(formData, "body"),
  });

  if (!parsed.success) {
    redirect(
      withMessage(
        `/student/support/${value(formData, "ticketId")}`,
        "error",
        "Enter a reply before sending.",
      ),
    );
  }

  let attachment: Awaited<ReturnType<typeof getAttachment>>;

  try {
    attachment = await getAttachment(formData);
  } catch (error) {
    redirect(
      withMessage(
        `/student/support/${parsed.data.ticketId}`,
        "error",
        errorText(error),
      ),
    );
  }

  const supabase = createAdminClient();
  const { data: ticket } = await supabase
    .from("support_requests")
    .select("id, user_id, requester_name, requester_email, subject, status")
    .eq("id", parsed.data.ticketId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!ticket) {
    redirect("/student/support?error=Support%20ticket%20not%20found.");
  }

  if (ticket.status === "closed") {
    redirect(
      withMessage(
        `/student/support/${ticket.id}`,
        "error",
        "This ticket is closed. Open a new ticket for additional help.",
      ),
    );
  }

  const { data: message, error } = await supabase
    .from("support_messages")
    .insert({
      support_request_id: ticket.id,
      author_user_id: user.id,
      author_role: "requester",
      body: parsed.data.body,
    })
    .select("id")
    .single();

  if (error || !message) {
    redirect(
      withMessage(
        `/student/support/${ticket.id}`,
        "error",
        error?.message ?? "The reply could not be added.",
      ),
    );
  }

  let warning: string | null = null;

  try {
    await uploadAttachment({
      attachment,
      messageId: message.id,
      supabase,
      ticketId: ticket.id,
      uploadedBy: user.id,
    });
  } catch (uploadError) {
    warning = errorText(uploadError);
  }

  scheduleNotification(() =>
    notifySupportTeamOfReply({
      requesterEmail: ticket.requester_email || user.email || "Unavailable",
      requesterName: ticket.requester_name || "Student",
      subject: ticket.subject,
      ticketId: ticket.id,
    }),
  );

  revalidatePath(`/student/support/${ticket.id}`);
  revalidatePath(`/admin/support/${ticket.id}`);
  redirect(
    withMessage(
      `/student/support/${ticket.id}`,
      warning ? "error" : "message",
      warning ?? "Reply added.",
    ),
  );
}

export async function addAdminSupportReplyAction(formData: FormData) {
  const { user } = await requireAdmin();
  const parsed = replySchema.safeParse({
    ticketId: value(formData, "ticketId"),
    body: value(formData, "body"),
  });

  if (!parsed.success) {
    redirect(
      withMessage(
        `/admin/support/${value(formData, "ticketId")}`,
        "error",
        "Enter a reply before sending.",
      ),
    );
  }

  const supabase = createAdminClient();
  const { data: ticket } = await supabase
    .from("support_requests")
    .select("id, user_id, requester_name, requester_email, subject")
    .eq("id", parsed.data.ticketId)
    .maybeSingle();

  if (!ticket) {
    redirect("/admin/support?error=Support%20ticket%20not%20found.");
  }

  const { error: messageError } = await supabase
    .from("support_messages")
    .insert({
      support_request_id: ticket.id,
      author_user_id: user.id,
      author_role: "staff",
      body: parsed.data.body,
    });

  if (messageError) {
    redirect(
      withMessage(`/admin/support/${ticket.id}`, "error", messageError.message),
    );
  }

  await supabase
    .from("support_requests")
    .update({
      assigned_to: user.id,
      status: "waiting_on_student",
      resolved_at: null,
    })
    .eq("id", ticket.id);

  if (ticket.user_id) {
    await supabase.from("notifications").insert({
      user_id: ticket.user_id,
      notification_type: "support_reply",
      title: "Support replied",
      message: `There is a new reply on “${ticket.subject}.”`,
      action_url: `/student/support/${ticket.id}`,
    });
  }

  if (ticket.requester_email) {
    scheduleNotification(() =>
      notifyRequesterOfReply({
        recipient: ticket.requester_email!,
        requesterName: ticket.requester_name || "Student",
        response: parsed.data.body,
        studentUserId: ticket.user_id,
        subject: ticket.subject,
        ticketId: ticket.id,
      }),
    );
  }

  revalidatePath(`/admin/support/${ticket.id}`);
  revalidatePath(`/student/support/${ticket.id}`);
  redirect(
    withMessage(
      `/admin/support/${ticket.id}`,
      "message",
      "Reply sent and ticket moved to waiting on student.",
    ),
  );
}

export async function addAdminInternalNoteAction(formData: FormData) {
  const { user } = await requireAdmin();
  const parsed = replySchema.safeParse({
    ticketId: value(formData, "ticketId"),
    body: value(formData, "body"),
  });

  if (!parsed.success) {
    redirect(
      withMessage(
        `/admin/support/${value(formData, "ticketId")}`,
        "error",
        "Enter an internal note before saving.",
      ),
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("support_messages").insert({
    support_request_id: parsed.data.ticketId,
    author_user_id: user.id,
    author_role: "staff",
    body: parsed.data.body,
    is_internal: true,
  });

  if (error) {
    redirect(
      withMessage(
        `/admin/support/${parsed.data.ticketId}`,
        "error",
        error.message,
      ),
    );
  }

  revalidatePath(`/admin/support/${parsed.data.ticketId}`);
  redirect(
    withMessage(
      `/admin/support/${parsed.data.ticketId}`,
      "message",
      "Internal note saved.",
    ),
  );
}

export async function updateSupportTicketAction(formData: FormData) {
  const { user } = await requireAdmin();
  const parsed = ticketUpdateSchema.safeParse({
    ticketId: value(formData, "ticketId"),
    priority: value(formData, "priority"),
    status: value(formData, "status"),
  });

  if (!parsed.success) {
    redirect("/admin/support?error=Invalid%20ticket%20update.");
  }

  const resolved = ["resolved", "closed"].includes(parsed.data.status);
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("support_requests")
    .update({
      assigned_to: user.id,
      priority: parsed.data.priority,
      status: parsed.data.status,
      resolved_at: resolved ? new Date().toISOString() : null,
    })
    .eq("id", parsed.data.ticketId);

  if (error) {
    redirect(
      withMessage(
        `/admin/support/${parsed.data.ticketId}`,
        "error",
        error.message,
      ),
    );
  }

  revalidatePath("/admin/support");
  revalidatePath(`/admin/support/${parsed.data.ticketId}`);
  revalidatePath(`/student/support/${parsed.data.ticketId}`);
  redirect(
    withMessage(
      `/admin/support/${parsed.data.ticketId}`,
      "message",
      "Ticket updated.",
    ),
  );
}
