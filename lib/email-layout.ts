/**
 * The HTML shell portal mail shares with the Supabase auth templates in
 * `supabase/email-templates`, so an invitation, a queue confirmation and a
 * seat assignment read as one branded sequence. Table-based and inline-styled
 * because Gmail and Outlook strip stylesheets.
 */

const logoUrl = "https://my.digitalrcc.com/brand/digitalrcc-email-logo.png";
const shellBackground = "#050b16";
const cardBackground = "#0d1b2f";
const cardBorder = "#1d4761";
const divider = "#18384e";
const panel = "#091526";
const accent = "#36d5f5";
const accentSoft = "#74dff4";
const heading = "#f4f9ff";
const body = "#b8cada";
const muted = "#819bae";

export type EmailAction = {
  label: string;
  url: string;
};

export type EmailDetail = {
  label: string;
  value: string;
};

export type BrandedEmailInput = {
  badge: string;
  preheader: string;
  eyebrow: string;
  title: string;
  paragraphs: string[];
  details?: EmailDetail[];
  action?: EmailAction;
  footnote?: string;
};

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function detailRows(details: EmailDetail[]) {
  return details
    .map(
      (detail, index) => `
                  <tr>
                    <td style="padding:16px 20px;${index > 0 ? `border-top:1px solid ${divider};` : ""}">
                      <div style="color:${accentSoft};font-size:10px;line-height:15px;font-weight:800;text-transform:uppercase;">${escapeHtml(detail.label)}</div>
                      <div style="margin-top:4px;color:${heading};font-size:16px;line-height:22px;font-weight:700;">${escapeHtml(detail.value)}</div>
                    </td>
                  </tr>`,
    )
    .join("");
}

function detailsBlock(details: EmailDetail[] | undefined) {
  if (!details?.length) {
    return "";
  }

  return `
            <tr>
              <td class="email-pad" style="padding:12px 36px 8px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${panel};border:1px solid ${divider};border-radius:6px;">${detailRows(details)}
                </table>
              </td>
            </tr>`;
}

function actionBlock(action: EmailAction | undefined) {
  if (!action) {
    return "";
  }

  const href = escapeHtml(action.url);

  return `
            <tr>
              <td class="email-pad" style="padding:26px 36px 8px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td align="center" bgcolor="${accent}" style="border-radius:6px;">
                      <a href="${href}" style="display:inline-block;padding:14px 22px;color:#03111e;font-size:15px;line-height:20px;font-weight:800;text-decoration:none;">${escapeHtml(action.label)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-pad" style="padding:4px 36px 12px;">
                <p style="margin:0;color:${muted};font-size:12px;line-height:20px;">If the button does not work, open this link:<br /><a href="${href}" style="color:${accentSoft};text-decoration:underline;word-break:break-all;">${href}</a></p>
              </td>
            </tr>`;
}

function footnoteBlock(footnote: string | undefined) {
  if (!footnote) {
    return "";
  }

  return `
            <tr>
              <td class="email-pad" style="padding:0 36px 24px;">
                <p style="margin:0;color:${muted};font-size:12px;line-height:20px;">${escapeHtml(footnote)}</p>
              </td>
            </tr>`;
}

export function renderBrandedEmailHtml(input: BrandedEmailInput) {
  const paragraphs = input.paragraphs
    .map(
      (paragraph, index) =>
        `<p style="margin:${index === 0 ? "18px" : "16px"} 0 0;color:${body};font-size:16px;line-height:26px;">${escapeHtml(paragraph)}</p>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-shell { width: 100% !important; }
        .email-pad { padding-left: 24px !important; padding-right: 24px !important; }
        .email-logo { width: 152px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${shellBackground};color:#e8f4ff;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${shellBackground};">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table class="email-shell" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:${cardBackground};border:1px solid ${cardBorder};border-radius:8px;overflow:hidden;">
            <tr>
              <td class="email-pad" style="padding:28px 36px;border-bottom:1px solid ${cardBorder};">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td valign="middle">
                      <img class="email-logo" src="${logoUrl}" width="176" alt="DigitalRCC" style="display:block;width:176px;max-width:176px;height:auto;border:0;" />
                    </td>
                    <td align="right" valign="middle">
                      <span style="display:inline-block;padding:6px 10px;border:1px solid #25617a;border-radius:999px;color:#a9ecf8;font-size:11px;line-height:16px;font-weight:700;">${escapeHtml(input.badge.toUpperCase())}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-pad" style="padding:40px 36px 20px;">
                <div style="margin-bottom:12px;color:${accentSoft};font-size:11px;line-height:16px;font-weight:800;text-transform:uppercase;">${escapeHtml(input.eyebrow)}</div>
                <h1 style="margin:0;color:${heading};font-size:30px;line-height:38px;font-weight:800;">${escapeHtml(input.title)}</h1>
                ${paragraphs}
              </td>
            </tr>${detailsBlock(input.details)}${actionBlock(input.action)}${footnoteBlock(input.footnote)}
            <tr>
              <td class="email-pad" style="padding:24px 36px;background:#091526;border-top:1px solid ${divider};">
                <p style="margin:0;color:#8fa8bb;font-size:12px;line-height:20px;">Need help? Contact <a href="mailto:support@digitalrcc.com" style="color:${accentSoft};text-decoration:none;">support@digitalrcc.com</a>.</p>
                <p style="margin:8px 0 0;color:#657f93;font-size:11px;line-height:18px;">Digital Resilience Community Clinic · Hands-on cyber resilience training</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderBrandedEmailText(input: BrandedEmailInput) {
  const lines = [input.title, "", ...input.paragraphs];

  if (input.details?.length) {
    lines.push(
      "",
      ...input.details.map((detail) => `${detail.label}: ${detail.value}`),
    );
  }

  if (input.action) {
    lines.push("", `${input.action.label}: ${input.action.url}`);
  }

  if (input.footnote) {
    lines.push("", input.footnote);
  }

  lines.push(
    "",
    "Need help? Contact support@digitalrcc.com.",
    "Digital Resilience Community Clinic",
  );

  return lines.join("\n");
}
