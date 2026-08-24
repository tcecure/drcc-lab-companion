import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { readLabOpsConfig } from "@/lib/labops/config";
import {
  authorize,
  type LabOpsCapability,
  type LabOpsIdentity,
  type LabOpsRole,
} from "@/lib/labops/policy";
import { createClient } from "@/lib/supabase/server";

const knownRoles: readonly LabOpsRole[] = [
  "student",
  "approver",
  "admin",
  "super_admin",
  "lab_admin",
  "developer",
  "support_analyst",
];

export async function getLabOpsIdentity(): Promise<LabOpsIdentity | null> {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("user_roles")
    .select("roles(role_name)")
    .eq("user_id", user.id);

  const roles = (data ?? [])
    .map((row) => row.roles?.role_name)
    .filter((role): role is LabOpsRole =>
      knownRoles.includes(role as LabOpsRole),
    );

  return { userId: user.id, email: user.email ?? null, roles };
}

export type AuthorizationFailure = {
  status: 401 | 403;
  reason: string;
};

/**
 * Server-side gate for every LabOps AI route handler. The browser is never trusted with
 * this decision, and a missing session is reported as 401 rather than redirected so the
 * gateway API stays machine-readable.
 */
export async function authorizeLabOpsRequest(
  capability: LabOpsCapability,
): Promise<
  | { ok: true; identity: LabOpsIdentity }
  | { ok: false; failure: AuthorizationFailure }
> {
  const identity = await getLabOpsIdentity();

  if (!identity) {
    return { ok: false, failure: { status: 401, reason: "Sign in required." } };
  }

  const ownerEmail = (() => {
    try {
      return readLabOpsConfig().LABOPS_OWNER_EMAIL;
    } catch {
      return null;
    }
  })();

  const decision = authorize(capability, identity, { ownerEmail });

  if (!decision.allowed) {
    return { ok: false, failure: { status: 403, reason: decision.reason } };
  }

  return { ok: true, identity };
}
