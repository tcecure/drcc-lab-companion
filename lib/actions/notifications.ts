"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireStudent } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function markAllNotificationsReadAction() {
  const { user } = await requireStudent();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) {
    redirect(
      `/student/notifications?error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath("/student/notifications");
  redirect(
    "/student/notifications?message=Notifications%20marked%20as%20read.",
  );
}
