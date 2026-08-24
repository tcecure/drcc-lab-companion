import { redirect } from "next/navigation";

import { getUserRoles, requireUser } from "@/lib/auth";
import { getDefaultPortalPath } from "@/lib/roles";

export default async function DashboardPage() {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);

  redirect(getDefaultPortalPath(roles));
}
