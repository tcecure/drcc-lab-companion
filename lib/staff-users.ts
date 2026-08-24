import "server-only";

import type { User } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

export const staffRoles = ["admin", "approver"] as const;
export type StaffRole = (typeof staffRoles)[number];

export type StaffUser = {
  authStatus: "active" | "disabled" | "invited";
  email: string;
  fullName: string;
  id: string;
  lastSignInAt: string | null;
  role: StaffRole;
};

function userMetadataString(user: User, key: string) {
  const value = user.user_metadata?.[key];

  return typeof value === "string" ? value : "";
}

function isCurrentlyBanned(user: User) {
  if (!user.banned_until) {
    return false;
  }

  const bannedUntil = new Date(user.banned_until).getTime();

  return Number.isFinite(bannedUntil) && bannedUntil > Date.now();
}

export function isStaffRole(role: string): role is StaffRole {
  return role === "admin" || role === "approver";
}

export async function listStaffUsers(): Promise<StaffUser[]> {
  const supabase = createAdminClient();
  const { data: roleRows, error: roleError } = await supabase
    .from("roles")
    .select("id, role_name")
    .in("role_name", [...staffRoles]);

  if (roleError) {
    throw new Error(roleError.message);
  }

  const roleById = new Map(
    (roleRows ?? []).map((role) => [role.id, role.role_name]),
  );
  const roleIds = [...roleById.keys()];

  if (roleIds.length === 0) {
    return [];
  }

  const { data: assignments, error: assignmentError } = await supabase
    .from("user_roles")
    .select("user_id, role_id")
    .in("role_id", roleIds);

  if (assignmentError) {
    throw new Error(assignmentError.message);
  }

  const rolesByUser = new Map<string, Set<StaffRole>>();

  for (const assignment of assignments ?? []) {
    const role = roleById.get(assignment.role_id);

    if (!role || !isStaffRole(role)) {
      continue;
    }

    const roles = rolesByUser.get(assignment.user_id) ?? new Set<StaffRole>();
    roles.add(role);
    rolesByUser.set(assignment.user_id, roles);
  }

  const userIds = [...rolesByUser.keys()];

  if (userIds.length === 0) {
    return [];
  }

  const [{ data: profiles, error: profileError }, authResults] =
    await Promise.all([
      supabase.from("profiles").select("*").in("id", userIds),
      Promise.all(
        userIds.map((userId) => supabase.auth.admin.getUserById(userId)),
      ),
    ]);

  if (profileError) {
    throw new Error(profileError.message);
  }

  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );
  const staffUsers: StaffUser[] = [];

  for (const result of authResults) {
    if (result.error) {
      throw new Error(result.error.message);
    }

    const authUser = result.data.user;

    if (!authUser) {
      continue;
    }

    const profile = profileById.get(authUser.id);
    const roles = rolesByUser.get(authUser.id);
    const role = roles?.has("admin") ? "admin" : "approver";
    const disabled =
      profile?.account_status === "disabled" || isCurrentlyBanned(authUser);

    staffUsers.push({
      authStatus: disabled
        ? "disabled"
        : authUser.email_confirmed_at
          ? "active"
          : "invited",
      email: authUser.email ?? profile?.email ?? "Email unavailable",
      fullName:
        profile?.full_name ||
        userMetadataString(authUser, "full_name") ||
        "Name not set",
      id: authUser.id,
      lastSignInAt: authUser.last_sign_in_at ?? null,
      role,
    });
  }

  return staffUsers.sort((left, right) =>
    left.fullName.localeCompare(right.fullName),
  );
}
