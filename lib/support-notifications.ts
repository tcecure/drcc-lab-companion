import "server-only";

import { readServerEnv } from "@/lib/env";
import { buildEmail, processEmailJob, queueEmail } from "@/lib/notifications";
import { getTicketCode } from "@/lib/support-tickets";

async function queueAndSend(input: Parameters<typeof queueEmail>[0]) {
  const jobId = await queueEmail(input);

  return processEmailJob(jobId);
}

export async function notifySupportTeam(input: {
  category: string;
  requesterEmail: string;
  requesterName: string;
  subject: string;
  ticketId: string;
}) {
  const env = readServerEnv();
  const code = getTicketCode(input.ticketId);
  const ticketUrl = `${env.NEXT_PUBLIC_APP_URL}/admin/support/${input.ticketId}`;

  return queueAndSend({
    userId: null,
    recipient: env.SUPPORT_NOTIFY_EMAIL,
    templateName: "support_team_new_ticket",
    content: buildEmail(`New support ticket ${code}`, [
      `${input.requesterName} (${input.requesterEmail}) opened a ${input.category} ticket.`,
      `Subject: ${input.subject}`,
      `Open the ticket in the admin portal: ${ticketUrl}`,
      "Reply from the portal so the complete support history stays with the ticket.",
    ]),
    payload: {
      ticket_id: input.ticketId,
      ticket_code: code,
      event: "created",
    },
  });
}

export async function notifySupportTeamOfReply(input: {
  requesterEmail: string;
  requesterName: string;
  subject: string;
  ticketId: string;
}) {
  const env = readServerEnv();
  const code = getTicketCode(input.ticketId);
  const ticketUrl = `${env.NEXT_PUBLIC_APP_URL}/admin/support/${input.ticketId}`;

  return queueAndSend({
    userId: null,
    recipient: env.SUPPORT_NOTIFY_EMAIL,
    templateName: "support_team_student_reply",
    content: buildEmail(`Student replied to ${code}`, [
      `${input.requesterName} (${input.requesterEmail}) replied to “${input.subject}.”`,
      `Continue the conversation in the admin portal: ${ticketUrl}`,
      "Reply from the portal so the complete support history stays with the ticket.",
    ]),
    payload: {
      ticket_id: input.ticketId,
      ticket_code: code,
      event: "requester_reply",
    },
  });
}

export async function notifyRequesterOfReply(input: {
  recipient: string;
  requesterName: string;
  response: string;
  studentUserId: string | null;
  subject: string;
  ticketId: string;
}) {
  const env = readServerEnv();
  const code = getTicketCode(input.ticketId);
  const studentUrl = input.studentUserId
    ? `${env.NEXT_PUBLIC_APP_URL}/student/support/${input.ticketId}`
    : `${env.NEXT_PUBLIC_APP_URL}/support`;

  return queueAndSend({
    userId: input.studentUserId,
    recipient: input.recipient,
    templateName: "support_requester_staff_reply",
    content: buildEmail(
      `New reply on support ticket ${code}`,
      input.studentUserId
        ? [
            `Hello ${input.requesterName},`,
            `The DigitalRCC support team replied to “${input.subject}.”`,
            `Read and respond in the portal: ${studentUrl}`,
            "Please keep your response in the portal so the full support history stays together.",
            "Digital Resilience Community Clinic Support",
          ]
        : [
            `Hello ${input.requesterName},`,
            `The DigitalRCC support team replied to your account-access request “${input.subject}.”`,
            input.response,
            "Follow the instructions above. Once you can sign in, use the portal for any future support requests.",
            "Digital Resilience Community Clinic Support",
          ],
    ),
    payload: {
      ticket_id: input.ticketId,
      ticket_code: code,
      event: "staff_reply",
    },
  });
}
