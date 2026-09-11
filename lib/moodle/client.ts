import "server-only";

import { readServerEnv } from "@/lib/env";

/**
 * Every Moodle web service function this portal is allowed to call. All of
 * them are read functions; the client refuses anything outside this list so a
 * future change cannot quietly start writing to Moodle.
 */
export const moodleReadFunctions = [
  "core_webservice_get_site_info",
  "core_course_get_courses_by_field",
  "core_enrol_get_enrolled_users",
  "core_completion_get_course_completion_status",
] as const;

export type MoodleFunction = (typeof moodleReadFunctions)[number];

export type MoodleConfig = {
  baseUrl: string;
  timeoutMs: number;
  token: string;
};

export class MoodleError extends Error {
  readonly code: string;

  constructor(message: string, code = "moodle_error") {
    super(message);
    this.name = "MoodleError";
    this.code = code;
  }
}

/**
 * Removes the web service token from anything that may reach a log, an error
 * response or the browser.
 */
export function redactToken(text: string, token: string) {
  if (!token) {
    return text;
  }

  return text.split(token).join("[redacted]");
}

export function readMoodleConfig(): MoodleConfig | null {
  const env = readServerEnv();

  if (!env.MOODLE_BASE_URL || !env.MOODLE_API_TOKEN) {
    return null;
  }

  return {
    baseUrl: env.MOODLE_BASE_URL.replace(/\/+$/, ""),
    timeoutMs: env.MOODLE_REQUEST_TIMEOUT_MS,
    token: env.MOODLE_API_TOKEN,
  };
}

export function encodeMoodleParams(params: Record<string, unknown>) {
  const body = new URLSearchParams();

  const append = (key: string, value: unknown) => {
    if (value === undefined || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry, index) => append(`${key}[${index}]`, entry));
      return;
    }

    if (typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) {
        append(`${key}[${childKey}]`, childValue);
      }
      return;
    }

    body.append(key, String(value));
  };

  for (const [key, value] of Object.entries(params)) {
    append(key, value);
  }

  return body;
}

export type MoodleClient = {
  call: <T>(
    moodleFunction: MoodleFunction,
    params?: Record<string, unknown>,
  ) => Promise<T>;
};

/** Network blips and gateway errors are worth retrying; a rejected token is not. */
const retryableCodes = new Set(["unreachable", "http_error"]);
export const moodleMaxAttempts = 3;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMoodleClient(
  config: MoodleConfig,
  fetchImpl: typeof fetch = fetch,
  retryDelayMs = 500,
): MoodleClient {
  async function request<T>(
    moodleFunction: MoodleFunction,
    params: Record<string, unknown>,
  ): Promise<T> {
    if (!moodleReadFunctions.includes(moodleFunction)) {
      throw new MoodleError(
        `${moodleFunction} is not an allowed read function.`,
        "function_not_allowed",
      );
    }

    const body = encodeMoodleParams(params);
    // The token travels in the POST body so it never lands in a URL, an
    // access log or a redirect.
    body.set("wstoken", config.token);
    body.set("wsfunction", moodleFunction);
    body.set("moodlewsrestformat", "json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    let response: Response;

    try {
      response = await fetchImpl(
        `${config.baseUrl}/webservice/rest/server.php`,
        {
          body,
          cache: "no-store",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw new MoodleError(
        redactToken(
          error instanceof Error ? error.message : "Moodle request failed.",
          config.token,
        ),
        "unreachable",
      );
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();

    if (!response.ok) {
      throw new MoodleError(
        `Moodle responded with HTTP ${response.status}.`,
        "http_error",
      );
    }

    let payload: unknown;

    try {
      payload = JSON.parse(text);
    } catch {
      throw new MoodleError(
        "Moodle returned a response that was not JSON.",
        "invalid_response",
      );
    }

    const failure = payload as {
      errorcode?: unknown;
      exception?: unknown;
      message?: unknown;
    } | null;

    if (failure?.exception && typeof failure.message === "string") {
      throw new MoodleError(
        redactToken(failure.message, config.token),
        String(failure.errorcode ?? "moodle_exception"),
      );
    }

    return payload as T;
  }

  return {
    async call<T>(
      moodleFunction: MoodleFunction,
      params: Record<string, unknown> = {},
    ) {
      let lastError: unknown;

      for (let attempt = 1; attempt <= moodleMaxAttempts; attempt += 1) {
        try {
          return await request<T>(moodleFunction, params);
        } catch (error) {
          lastError = error;

          if (
            !(error instanceof MoodleError) ||
            !retryableCodes.has(error.code) ||
            attempt === moodleMaxAttempts
          ) {
            throw error;
          }

          await delay(retryDelayMs * attempt);
        }
      }

      throw lastError;
    },
  };
}
