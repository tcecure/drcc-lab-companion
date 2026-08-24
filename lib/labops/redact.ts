/**
 * Secret and credential redaction for anything crossing into a model request, an
 * agent workspace, or a persisted investigation record.
 *
 * The rule this enforces: text that reaches OpenAI or OpenHands has been through
 * redactText(). Nothing is ever redacted in place in support_requests — the original
 * row stays authoritative.
 */

export type RedactionKind =
  | "openai_key"
  | "aws_key"
  | "github_token"
  | "slack_token"
  | "supabase_key"
  | "jwt"
  | "private_key"
  | "bearer_token"
  | "basic_auth"
  | "url_credentials"
  | "connection_string"
  | "assigned_secret"
  | "credential_pair"
  | "high_entropy";

export type Redaction = { kind: RedactionKind; count: number };

export type RedactionResult = {
  text: string;
  redactions: Redaction[];
  /** True when anything at all was removed; useful for audit records. */
  redacted: boolean;
};

type Rule = { kind: RedactionKind; pattern: RegExp; replace?: string };

const placeholder = (kind: RedactionKind) => `[REDACTED:${kind}]`;

/**
 * Keys, tokens and secret-shaped assignments. Ordering matters: the specific provider
 * patterns run before the generic assignment and entropy rules so that the audit trail
 * names the credential type that was found.
 */
const rules: Rule[] = [
  { kind: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "openai_key", pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: "aws_key", pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { kind: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { kind: "slack_token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "supabase_key", pattern: /\bsb(?:p|s)_[A-Za-z0-9_-]{20,}\b/g },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    kind: "connection_string",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/\S+/gi,
  },
  {
    kind: "url_credentials",
    pattern: /\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
    replace: `$1${placeholder("url_credentials")}@`,
  },
  {
    kind: "bearer_token",
    pattern: /\b(bearer|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replace: `$1 ${placeholder("bearer_token")}`,
  },
  {
    kind: "basic_auth",
    pattern: /\bbasic\s+[A-Za-z0-9+/=]{16,}/gi,
    replace: `Basic ${placeholder("basic_auth")}`,
  },
  {
    // "login admin/pfsense123", "creds: student03 / Winter2026"
    kind: "credential_pair",
    pattern:
      /\b(admin|administrator|root|instructor|student\d*|user(?:name)?)\s*[/|]\s*[^\s/|,;]{4,}/gi,
    replace: `$1/${placeholder("credential_pair")}`,
  },
  {
    // password=..., "api_key": "...", secret: '...', PAT -> ...
    kind: "assigned_secret",
    pattern:
      /\b((?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?key|client[_-]?secret|password|passwd|pwd|token|session[_-]?key|service[_-]?role[_-]?key)\b\s*["']?\s*[:=]\s*)["']?([^\s"',;}]{6,})["']?/gi,
    replace: `$1${placeholder("assigned_secret")}`,
  },
];

/** Long random-looking strings that survived the named rules. */
const highEntropyPattern = /\b(?=[A-Za-z0-9+/_-]*[0-9])(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}={0,2}\b/g;

function shannonEntropy(value: string) {
  const counts = new Map<string, number>();

  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  let entropy = 0;

  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

export function redactText(input: string | null | undefined): RedactionResult {
  if (!input) {
    return { text: "", redactions: [], redacted: false };
  }

  const found = new Map<RedactionKind, number>();
  let text = input;

  const record = (kind: RedactionKind) =>
    found.set(kind, (found.get(kind) ?? 0) + 1);

  for (const rule of rules) {
    text = text.replace(rule.pattern, (...args) => {
      record(rule.kind);

      if (!rule.replace) {
        return placeholder(rule.kind);
      }

      // Rebuild the replacement using the captured groups the rule referenced.
      const groups = args.slice(0, -2) as string[];
      return rule.replace.replace(/\$(\d)/g, (_, index: string) =>
        groups[Number(index)] ?? "",
      );
    });
  }

  text = text.replace(highEntropyPattern, (match) => {
    // 3.2 bits/char keeps hashes and keys while leaving long words and base64 of
    // plain English (which sits lower) alone.
    if (shannonEntropy(match) < 3.2) {
      return match;
    }

    record("high_entropy");
    return placeholder("high_entropy");
  });

  const redactions = [...found.entries()].map(([kind, count]) => ({ kind, count }));

  return { text, redactions, redacted: redactions.length > 0 };
}

/** Convenience guard for values that must never be forwarded at all. */
export function containsSecret(input: string | null | undefined) {
  return redactText(input).redacted;
}

/**
 * Redacts every string in a shallow record, e.g. before writing tool output or a
 * finding to the database.
 */
export function redactRecord<T extends Record<string, unknown>>(record: T) {
  const redactions: Redaction[] = [];
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string") {
      output[key] = value;
      continue;
    }

    const result = redactText(value);
    output[key] = result.text;
    redactions.push(...result.redactions);
  }

  return { record: output as T, redactions };
}
