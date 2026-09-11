import { describe, expect, it, vi } from "vitest";

import {
  createMoodleClient as createClient,
  encodeMoodleParams,
  moodleMaxAttempts,
  moodleReadFunctions,
  MoodleError,
  redactToken,
  type MoodleFunction,
} from "@/lib/moodle/client";

const config = {
  baseUrl: "https://lms.example.com",
  timeoutMs: 5000,
  token: "super-secret-token",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

// No retry backoff in tests.
function createMoodleClient(
  clientConfig: typeof config,
  fetchImpl: typeof fetch,
) {
  return createClient(clientConfig, fetchImpl, 0);
}

describe("moodle client", () => {
  it("only exposes read functions", () => {
    expect([...moodleReadFunctions]).toEqual([
      "core_webservice_get_site_info",
      "core_course_get_courses_by_field",
      "core_enrol_get_enrolled_users",
      "core_completion_get_course_completion_status",
    ]);
    expect(
      moodleReadFunctions.some((fn) =>
        /update|create|delete|enrol_enrol/.test(fn),
      ),
    ).toBe(false);
  });

  it("refuses a function outside the allow list", async () => {
    const fetchImpl = vi.fn();
    const client = createMoodleClient(
      config,
      fetchImpl as unknown as typeof fetch,
    );

    await expect(
      client.call("core_user_update_users" as MoodleFunction),
    ).rejects.toMatchObject({ code: "function_not_allowed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the token out of the URL and sends it in the POST body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ sitename: "C&AI" }));
    const client = createMoodleClient(
      config,
      fetchImpl as unknown as typeof fetch,
    );

    await client.call("core_webservice_get_site_info");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://lms.example.com/webservice/rest/server.php");
    expect(url).not.toContain(config.token);
    expect(init.method).toBe("POST");
    const body = init.body as URLSearchParams;
    expect(body.get("wstoken")).toBe(config.token);
    expect(body.get("wsfunction")).toBe("core_webservice_get_site_info");
    expect(body.get("moodlewsrestformat")).toBe("json");
  });

  it("raises a redacted error when Moodle reports an exception", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        errorcode: "invalidtoken",
        exception: "moodle_exception",
        message: `Invalid token ${config.token} - token not found`,
      }),
    );
    const client = createMoodleClient(
      config,
      fetchImpl as unknown as typeof fetch,
    );

    const error = await client
      .call("core_webservice_get_site_info")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MoodleError);
    expect((error as MoodleError).code).toBe("invalidtoken");
    expect((error as MoodleError).message).not.toContain(config.token);
    expect((error as MoodleError).message).toContain("[redacted]");
  });

  it("reports an unreachable Moodle without leaking the token", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED using ${config.token}`);
    });
    const client = createMoodleClient(
      config,
      fetchImpl as unknown as typeof fetch,
    );

    const error = await client
      .call("core_enrol_get_enrolled_users", { courseid: 4 })
      .catch((caught: unknown) => caught);

    expect((error as MoodleError).code).toBe("unreachable");
    expect((error as MoodleError).message).not.toContain(config.token);
  });

  it("fails on a non-JSON or error response", async () => {
    const html = createMoodleClient(
      config,
      (async () =>
        new Response("<html>nope</html>")) as unknown as typeof fetch,
    );
    await expect(
      html.call("core_webservice_get_site_info"),
    ).rejects.toMatchObject({
      code: "invalid_response",
    });

    const broken = createMoodleClient(config, (async () =>
      jsonResponse({}, 503)) as unknown as typeof fetch);
    await expect(
      broken.call("core_webservice_get_site_info"),
    ).rejects.toMatchObject({ code: "http_error" });
  });

  it("retries a transient failure a bounded number of times", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("connect ETIMEDOUT");
      }
      return jsonResponse({ sitename: "C&AI" });
    });

    await expect(
      createMoodleClient(config, fetchImpl as unknown as typeof fetch).call(
        "core_webservice_get_site_info",
      ),
    ).resolves.toMatchObject({ sitename: "C&AI" });
    expect(attempts).toBe(moodleMaxAttempts);

    const alwaysDown = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    await expect(
      createMoodleClient(config, alwaysDown as unknown as typeof fetch).call(
        "core_webservice_get_site_info",
      ),
    ).rejects.toMatchObject({ code: "unreachable" });
    expect(alwaysDown).toHaveBeenCalledTimes(moodleMaxAttempts);
  });

  it("does not retry a rejected token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        errorcode: "invalidtoken",
        exception: "moodle_exception",
        message: "Invalid token - token not found",
      }),
    );

    await expect(
      createMoodleClient(config, fetchImpl as unknown as typeof fetch).call(
        "core_webservice_get_site_info",
      ),
    ).rejects.toMatchObject({ code: "invalidtoken" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("encodes nested parameters the way Moodle expects", () => {
    const body = encodeMoodleParams({
      field: "ids",
      options: { ids: [3, 4] },
    });

    expect(body.get("field")).toBe("ids");
    expect(body.get("options[ids][0]")).toBe("3");
    expect(body.get("options[ids][1]")).toBe("4");
  });

  it("redacts the token anywhere it appears", () => {
    expect(
      redactToken(`a ${config.token} b ${config.token}`, config.token),
    ).toBe("a [redacted] b [redacted]");
    expect(redactToken("no token here", "")).toBe("no token here");
  });
});
