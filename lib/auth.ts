import "server-only";

import { redirect } from "next/navigation";

import { canManage, type PortalRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export { canManage, managerRoles } from "@/lib/roles";
export type { PortalRole } from "@/lib/roles";

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));

  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function getUserRoles(userId?: string): Promise<PortalRole[]> {
  const user = userId ? { id: userId } : await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_roles")
    .select("roles(role_name)")
    .eq("user_id", user.id);

  return (data ?? [])
    .map((row) => row.roles?.role_name)
    .filter(
      (role): role is PortalRole =>
        role === "student" || role === "approver" || role === "admin",
    );
}

export async function requireManager() {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);

  if (!canManage(roles)) {
    redirect("/student");
  }

  return { user, roles };
}

export async function requireStudent() {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);

  if (canManage(roles)) {
    redirect("/admin");
  }

  return { user, roles };
}

export async function getProfile(userId?: string) {
  const user = userId ? { id: userId } : await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  return data;
}
