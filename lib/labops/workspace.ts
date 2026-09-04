import "server-only";

/**
 * Per-investigation runtime. One container and one volume per run, created when the
 * investigation starts and destroyed when it ends.
 *
 * The gateway never speaks to the Docker API itself: every operation goes through
 * `platform/labops-ai/scripts/run-investigation.sh` on the host, which is the only thing
 * allowed to create a container and which fails closed if the sandbox it produced is
 * mis-provisioned (host mount, second network, published port). Keeping that in one root
 * script means the gateway process needs no Docker socket, and the arguments it may pass
 * are a run id and a subcommand.
 *
 * The container's address is resolved per call rather than configured, because a run's
 * container exists only for the duration of that run: there is no fixed agent URL to hold.
 */

import { execFile, type ExecFileException } from "node:child_process";

import { readLabOpsConfig, type LabOpsConfig } from "@/lib/labops/config";

/** Exit code the launcher uses for "no container for this run". */
const NOT_FOUND_EXIT = 68;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkspaceHandle = {
  runId: string;
  containerName: string;
  volumeName: string;
  imageDigest: string;
  /** `ip:port` on the internal labops-model network. Never published to the host. */
  endpoint: string;
  running: boolean;
};

export type WorkspaceRuntime = {
  /** Creates the container and volume for a run and returns its address. */
  start(runId: string): Promise<WorkspaceHandle>;
  /** Current state, or null when no container exists for the run. */
  inspect(runId: string): Promise<WorkspaceHandle | null>;
  /** Run ids that still have an investigation container on the host. */
  list(): Promise<string[]>;
  /** Removes the container and the workspace volume. Safe to call twice. */
  destroy(runId: string): Promise<void>;
};

export class WorkspaceRuntimeError extends Error {
  readonly exitCode: number | null;

  constructor(message: string, exitCode: number | null = null) {
    super(message);
    this.name = "WorkspaceRuntimeError";
    this.exitCode = exitCode;
  }
}

type ExecResult = { code: number; stdout: string; stderr: string };

/**
 * Runtime failures are reported to staff without host detail: the launcher path, its stderr and
 * raw spawn errors describe the gateway's internals, and the message reaches the investigation
 * list, the detail banner and the persisted `failure_reason`. The detail goes to the service
 * journal, which only a host operator can read.
 */
function runtimeFailure(message: string, detail: string, exitCode: number | null = null) {
  console.error(`[labops] ${message}: ${detail}`);

  return new WorkspaceRuntimeError(message, exitCode);
}

function run(
  command: string,
  args: readonly string[],
  options: { timeoutMs: number },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        timeout: options.timeoutMs,
        maxBuffer: 1024 * 1024,
        // A shell is never involved, and the launcher reads what it needs from
        // /etc/labops; nothing from the gateway's environment is inherited.
        env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", NODE_ENV: process.env.NODE_ENV },
        encoding: "utf8",
      },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }

        const code = error.code;

        if (typeof code === "number") {
          resolve({ code, stdout, stderr });
          return;
        }

        reject(
          runtimeFailure("The investigation runtime could not be invoked", error.message),
        );
      },
    );
  });
}

function assertRunId(runId: string) {
  if (!UUID.test(runId)) {
    throw new WorkspaceRuntimeError("A run id must be a uuid to name a workspace");
  }
}

function parseHandle(runId: string, stdout: string): WorkspaceHandle {
  let payload: unknown;

  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new WorkspaceRuntimeError("Investigation runtime returned unreadable output");
  }

  const row = payload as Record<string, unknown>;
  const endpoint = typeof row.endpoint === "string" ? row.endpoint : "";
  const containerName = typeof row.container === "string" ? row.container : "";
  const running = row.running === true;

  if (!containerName) {
    throw new WorkspaceRuntimeError("Investigation runtime reported no container");
  }

  // A stopped container has left the network and has no address; that is a valid state to
  // report, and callers refuse to talk to a workspace that is not running.
  if (running && !endpoint) {
    throw new WorkspaceRuntimeError("Investigation runtime reported no container address");
  }

  return {
    runId,
    containerName,
    volumeName: typeof row.volume === "string" ? row.volume : containerName,
    imageDigest: typeof row.image === "string" ? row.image : "",
    endpoint,
    running,
  };
}

export function createWorkspaceRuntime(
  config: LabOpsConfig = readLabOpsConfig(),
): WorkspaceRuntime {
  const launcher = config.LABOPS_RUNTIME_LAUNCHER;
  const timeoutMs = config.LABOPS_RUNTIME_TIMEOUT_S * 1_000;
  const invoke = (args: readonly string[], ms = timeoutMs) =>
    config.LABOPS_RUNTIME_SUDO
      ? run("/usr/bin/sudo", ["-n", launcher, ...args], { timeoutMs: ms })
      : run(launcher, args, { timeoutMs: ms });

  const failed = (action: string, result: ExecResult) =>
    runtimeFailure(
      `Investigation runtime failed to ${action}`,
      result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`,
      result.code,
    );

  return {
    async start(runId) {
      assertRunId(runId);

      const result = await invoke(["start", runId, "--json"]);

      if (result.code !== 0) {
        // A partially created sandbox must not be left behind for the reaper to find.
        await invoke(["stop", runId]).catch(() => undefined);
        throw failed("create the investigation workspace", result);
      }

      return parseHandle(runId, result.stdout);
    },

    async inspect(runId) {
      assertRunId(runId);

      const result = await invoke(["inspect", runId, "--json"], 30_000);

      if (result.code === NOT_FOUND_EXIT) {
        return null;
      }

      if (result.code !== 0) {
        throw failed("inspect the investigation workspace", result);
      }

      return parseHandle(runId, result.stdout);
    },

    async list() {
      const result = await invoke(["list"], 30_000);

      if (result.code !== 0) {
        throw failed("list investigation workspaces", result);
      }

      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => UUID.test(line));
    },

    async destroy(runId) {
      assertRunId(runId);

      const result = await invoke(["stop", runId], 60_000);

      if (result.code !== 0) {
        throw failed("destroy the investigation workspace", result);
      }
    },
  };
}

let cached: WorkspaceRuntime | null = null;

export function workspaceRuntime() {
  if (!cached) {
    cached = createWorkspaceRuntime();
  }

  return cached;
}
