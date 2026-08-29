/**
 * Runs once when the Node server starts.
 *
 * Its only job is investigation restart recovery: a gateway restart severs the relay to
 * every running investigation, so any container still on the host is unsupervised and any
 * run the database still calls active can never finish. `reconcileInvestigations` ends
 * those runs and destroys their workspaces, and a periodic sweep afterwards enforces the
 * wall-clock limit — measured from the run's own start time, so it survives restarts — and
 * reaps containers whose run is already terminal.
 *
 * Nothing here can start work, spend budget or write to a ticket.
 */

const SWEEP_INTERVAL_MS = 60_000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { readLabOpsConfig } = await import("@/lib/labops/config");

  // The portal runs the same image without LabOps configured; recovery is a no-op there.
  try {
    readLabOpsConfig();
  } catch {
    return;
  }

  const { runDeps } = await import("@/lib/labops/gateway");
  const { enforceRunDeadlines, reconcileInvestigations } = await import("@/lib/labops/runs");

  const report = (stage: string, error: unknown) => {
    console.error(
      `[labops] ${stage} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  };

  try {
    const outcome = await reconcileInvestigations(runDeps());

    if (outcome.endedRuns.length || outcome.reapedWorkspaces.length) {
      console.warn(
        `[labops] restart recovery ended ${outcome.endedRuns.length} investigation(s) and reaped ${outcome.reapedWorkspaces.length} workspace(s)`,
      );
    }
  } catch (error) {
    report("restart recovery", error);
  }

  const timer = setInterval(() => {
    void enforceRunDeadlines(runDeps()).catch((error) => report("deadline sweep", error));
  }, SWEEP_INTERVAL_MS);

  timer.unref();
}
