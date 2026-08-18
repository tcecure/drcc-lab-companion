import "server-only";

import { createHash, createHmac } from "node:crypto";

import { readServerEnv, type ServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

function paragraphsToHtml(subject: string, paragraphs: string[]) {
  const body = paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px">${paragraph}</p>`)
    .join("");

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0f172a"><h1 style="font-size:19px;margin:0 0 18px">${subject}</h1>${body}</div>`;
}

function buildEmail(subject: string, paragraphs: string[]): EmailContent {
  return {
    subject,
    text: paragraphs.join("\n\n"),
    html: paragraphsToHtml(subject, paragraphs),
  };
}

export function renderQueueConfirmation(input: {
  fullName: string;
  labStartDate: string;
  portalUrl: string;
}) {
  return buildEmail("You are in the queue for the DigitalRCC Cyber Lab", [
    `Hello ${input.fullName},`,
    `You have been added to the queue for the hands-on Cyber Lab session beginning ${input.labStartDate}.`,
    "Student numbers, pods, and lab credentials are assigned automatically at 1:00 AM Eastern on the start date. Until then your queue entry shows no student number, which is expected.",
    `You can check your place in the queue any time at ${input.portalUrl}/student/queue.`,
    "DigitalRCC Cyber Lab Team",
  ]);
}

export function renderSeatAssignment(input: {
  fullName: string;
  labStartDate: string;
  labUsername: string;
  podName: string;
  portalUrl: string;
}) {
  return buildEmail("Your DigitalRCC lab access is ready", [
    `Hello ${input.fullName},`,
    `Your hands-on lab access for the session beginning ${input.labStartDate} is now assigned: ${input.podName}, lab username ${input.labUsername}.`,
    `Sign in at ${input.portalUrl}/student/start for your personalized quick start, connection details, and lab guides.`,
    "Your lab password is never sent by email. Retrieve it from the portal after signing in.",
    "DigitalRCC Cyber Lab Team",
  ]);
}

export async function queueEmail(input: {
  userId: string | null;
  recipient: string;
  templateName: string;
  content: EmailContent;
  payload: Record<string, string | number | null>;
}) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("email_jobs").insert({
    user_id: input.userId,
    template_name: input.templateName,
    recipient: input.recipient,
    subject: input.content.subject,
    payload: input.payload,
    rendered_text: input.content.text,
    rendered_html: input.content.html,
    status: "queued",
  });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Sends queued email jobs. With `EMAIL_DELIVERY_MODE=mock` (the default) jobs
 * are marked sent without contacting a provider, so an import never emails real
 * students until live delivery is configured deliberately.
 */
export async function processQueuedEmails(limit = 100) {
  const env = readServerEnv();
  const supabase = createAdminClient();
  const { data: jobs, error } = await supabase
    .from("email_jobs")
    .select("*")
    .in("status", ["queued", "failed"])
    .order("requested_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  let sent = 0;
  let failed = 0;

  for (const job of jobs ?? []) {
    await supabase
      .from("email_jobs")
      .update({
        status: "sending",
        attempts: job.attempts + 1,
        error_message: null,
      })
      .eq("id", job.id);

    try {
      if (env.EMAIL_DELIVERY_MODE === "live") {
        await sendSesEmail(env, {
          to: job.recipient,
          subject: job.subject,
          text: job.rendered_text ?? job.subject,
          html: job.rendered_html ?? `<p>${job.subject}</p>`,
        });
      }

      await supabase
        .from("email_jobs")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", job.id);
      sent += 1;
    } catch (sendError) {
      await supabase
        .from("email_jobs")
        .update({
          status: "failed",
          error_message:
            sendError instanceof Error ? sendError.message : "Send failed.",
        })
        .eq("id", job.id);
      failed += 1;
    }
  }

  return { mode: env.EMAIL_DELIVERY_MODE, sent, failed };
}

async function sendSesEmail(
  env: ServerEnv,
  message: { to: string; subject: string; text: string; html: string },
) {
  if (
    !env.AWS_REGION ||
    !env.AWS_ACCESS_KEY_ID ||
    !env.AWS_SECRET_ACCESS_KEY ||
    !env.SES_FROM_ADDRESS
  ) {
    throw new Error(
      "Live email delivery needs AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and SES_FROM_ADDRESS.",
    );
  }

  const body = JSON.stringify({
    FromEmailAddress: env.SES_FROM_ADDRESS,
    Destination: { ToAddresses: [message.to] },
    ReplyToAddresses: env.SES_REPLY_TO_ADDRESS
      ? [env.SES_REPLY_TO_ADDRESS]
      : undefined,
    Content: {
      Simple: {
        Subject: { Data: message.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: message.text, Charset: "UTF-8" },
          Html: { Data: message.html, Charset: "UTF-8" },
        },
      },
    },
  });
  const endpoint = `https://email.${env.AWS_REGION}.amazonaws.com/v2/email/outbound-emails`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...signedHeaders({
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        region: env.AWS_REGION,
        url: endpoint,
        body,
      }),
      "content-type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`AWS SES send failed with ${response.status}.`);
  }
}

function signedHeaders({
  accessKeyId,
  secretAccessKey,
  region,
  url,
  body,
}: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  url: string;
  body: string;
}) {
  const parsedUrl = new URL(url);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalHeaders = `host:${parsedUrl.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaderNames = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "POST",
    parsedUrl.pathname,
    "",
    canonicalHeaders,
    signedHeaderNames,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const signature = hmac(
    signingKey(secretAccessKey, dateStamp, region),
    stringToSign,
  ).toString("hex");

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
    host: parsedUrl.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
) {
  return hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), "ses"),
    "aws4_request",
  );
}
