import { describe, expect, it, vi } from "vitest";

import { readLabOpsConfig } from "@/lib/labops/config";
import { createWorkspaceRuntime } from "@/lib/labops/workspace";

const launcher = "/opt/labops/platform/labops-ai/scripts/run-investigation.sh";

function runtime() {
  process.env.LABOPS_RUNTIME_MODE = "per_run";
  process.env.LABOPS_RUNTIME_LAUNCHER = launcher;
  process.env.LABOPS_RUNTIME_SUDO = "false";
  process.env.LABOPS_RUNTIME_TIMEOUT_S = "5";
  process.env.LABOPS_MODEL_PROXY_TOKEN = "test-proxy-token";
  process.env.LABOPS_LLM_API_KEY = "via-model-proxy";
  process.env.LABOPS_OWNER_EMAIL = "owner@example.com";
  process.env.LABOPS_LLM_MODEL = "openai/gpt-5.5";
  process.env.LABOPS_AGENT_SERVER_API_KEY = "test-agent-key";

  return createWorkspaceRuntime(readLabOpsConfig());
}

describe("workspace runtime failures", () => {
  it("keeps the launcher path and the raw spawn error out of what staff can read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // Nothing is installed at the launcher path in a test environment, so this is the same
    // ENOENT the gateway hits on a host that was never bootstrapped.
    const failure = await runtime()
      .start("11111111-2222-4333-8444-555555555555")
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(Error);

    const message = (failure as Error).message;

    // The message is persisted as ai_runs.failure_reason and rendered to staff.
    expect(message).not.toContain(launcher);
    expect(message).not.toContain("ENOENT");
    expect(message).not.toContain("spawn");
    expect(message).toBe("The investigation runtime could not be invoked");

    // The detail an operator needs is not lost, only kept to the service journal.
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(launcher));

    logged.mockRestore();
  });

  it("refuses a run id that could name something other than its own workspace", async () => {
    await expect(runtime().start("../../etc/labops")).rejects.toThrow(/uuid/);
  });
});
