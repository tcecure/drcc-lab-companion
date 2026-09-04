/**
 * Authorization policy for DigitalRCC LabOps AI.
 *
 * Pure functions only, so both the gateway route handlers and the tests exercise the
 * same decisions. Nothing here reads the network or the database: callers pass the
 * identity they already resolved from the Supabase session.
 */

export type LabOpsRole =
  | "student"
  | "approver"
  | "admin"
  | "super_admin"
  | "lab_admin"
  | "developer"
  | "support_analyst";

/** Roles allowed to read investigations, findings and audit history. */
export const labopsStaffRoles = [
  "admin",
  "approver",
  "super_admin",
  "lab_admin",
  "developer",
  "support_analyst",
] as const satisfies LabOpsRole[];

/** Roles allowed to decide an approval request raised by an investigation. */
export const labopsApproverRoles = [
  "admin",
  "approver",
  "super_admin",
] as const satisfies LabOpsRole[];

export type LabOpsIdentity = {
  userId: string;
  email: string | null;
  roles: readonly LabOpsRole[];
};

export type LabOpsCapability =
  | "read_investigations"
  | "start_investigation"
  | "cancel_investigation"
  | "confirm_agent_step"
  | "file_findings_note"
  | "decide_approval";

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

const allow: PolicyDecision = { allowed: true };

function deny(reason: string): PolicyDecision {
  return { allowed: false, reason };
}

export function isLabOpsStaff(roles: readonly LabOpsRole[]) {
  return labopsStaffRoles.some((role) => roles.includes(role));
}

export function canDecideApproval(roles: readonly LabOpsRole[]) {
  return labopsApproverRoles.some((role) => roles.includes(role));
}

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null;
}

/**
 * During the Phase 1 pilot exactly one operator may start or cancel an investigation,
 * identified by the portal email in LABOPS_OWNER_EMAIL. Holding a staff role is not
 * sufficient, and students are never eligible.
 */
export function isPilotOperator(
  identity: LabOpsIdentity,
  ownerEmail: string | null | undefined,
) {
  const owner = normalizeEmail(ownerEmail);
  const candidate = normalizeEmail(identity.email);

  if (!owner || !candidate || owner !== candidate) {
    return false;
  }

  return isLabOpsStaff(identity.roles);
}

export function authorize(
  capability: LabOpsCapability,
  identity: LabOpsIdentity,
  options: { ownerEmail?: string | null } = {},
): PolicyDecision {
  if (!isLabOpsStaff(identity.roles)) {
    return deny("LabOps AI is restricted to DigitalRCC staff accounts.");
  }

  switch (capability) {
    case "read_investigations":
      return allow;

    case "start_investigation":
    case "cancel_investigation":
      return isPilotOperator(identity, options.ownerEmail)
        ? allow
        : deny(
            "Only the pilot operator may start or cancel an investigation during Phase 1.",
          );

    // Every agent action is gated by the agent server's confirmation policy, so deciding
    // one is the same authority as starting the run: the pilot operator's.
    case "confirm_agent_step":
      return isPilotOperator(identity, options.ownerEmail)
        ? allow
        : deny("Only the pilot operator may allow or refuse an agent step during Phase 1.");

    // Writing a reviewed finding back onto a ticket stays with the pilot operator too:
    // it is the only ticket write the console can make.
    case "file_findings_note":
      return isPilotOperator(identity, options.ownerEmail)
        ? allow
        : deny("Only the pilot operator may file findings on a ticket during Phase 1.");

    case "decide_approval":
      return canDecideApproval(identity.roles)
        ? allow
        : deny("This account cannot decide approval requests.");
  }
}

/**
 * An approval may never be decided by the account that requested it, mirroring the
 * ai_approval_no_self_approval database constraint.
 */
export function canDecideSpecificApproval(
  identity: LabOpsIdentity,
  approval: { requestedBy: string },
): PolicyDecision {
  const base = authorize("decide_approval", identity);

  if (!base.allowed) {
    return base;
  }

  return identity.userId === approval.requestedBy
    ? deny("An investigation approval cannot be decided by its requester.")
    : allow;
}
