import { redirect } from "next/navigation";

import { canManage, getUserRoles, requireUser } from "@/lib/auth";

export default async function DashboardPage() {
  await requireUser();
  const roles = await getUserRoles();

  redirect(canManage(roles) ? "/admin" : "/student");
}
