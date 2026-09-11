"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth";
import { MoodleError } from "@/lib/moodle/client";
import { runMoodleSync } from "@/lib/moodle/sync";

/**
 * Admin-triggered "Sync Now". Failures are surfaced as a short, token-free
 * message on the page.
 */
export async function syncMoodleNowAction(formData: FormData) {
  await requireAdmin();

  const target =
    typeof formData.get("returnTo") === "string"
      ? String(formData.get("returnTo"))
      : "/admin/community-impact";
  const safeTarget = target.startsWith("/admin/community-impact")
    ? target
    : "/admin/community-impact";
  const separator = safeTarget.includes("?") ? "&" : "?";

  try {
    const result = await runMoodleSync("full", "admin");

    revalidatePath("/admin/community-impact");

    const message =
      result.status === "skipped"
        ? "A Moodle synchronization is already running."
        : `Synchronized ${result.learnersSeen} learners across ${result.coursesSeen} courses.`;

    redirect(`${safeTarget}${separator}message=${encodeURIComponent(message)}`);
  } catch (error) {
    if (error instanceof MoodleError) {
      redirect(
        `${safeTarget}${separator}error=${encodeURIComponent(`Moodle sync failed (${error.code}).`)}`,
      );
    }

    throw error;
  }
}
