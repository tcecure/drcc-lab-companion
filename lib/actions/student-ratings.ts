"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const ratingSchema = z.object({
  cohortNumber: z.coerce.number().int().min(1),
  // 0 clears the rating; 1-5 stores it.
  rating: z.coerce.number().int().min(0).max(5),
  userId: z.string().uuid(),
});

function message(input: string) {
  return encodeURIComponent(input);
}

export async function setStudentRatingAction(formData: FormData) {
  const { user: actor } = await requireManager();
  const parsed = ratingSchema.safeParse({
    cohortNumber: formData.get("cohortNumber"),
    rating: formData.get("rating"),
    userId: formData.get("userId"),
  });

  if (!parsed.success) {
    redirect(`/admin/progress?error=${message("That rating is not valid.")}`);
  }

  const { cohortNumber, rating, userId } = parsed.data;
  const supabase = createAdminClient();
  const { error } = rating
    ? await supabase.from("student_cohort_ratings").upsert(
        {
          cohort_number: cohortNumber,
          rated_by: actor.id,
          rating,
          user_id: userId,
        },
        { onConflict: "user_id,cohort_number" },
      )
    : await supabase
        .from("student_cohort_ratings")
        .delete()
        .eq("user_id", userId)
        .eq("cohort_number", cohortNumber);

  if (error) {
    redirect(
      `/admin/progress?cohort=${cohortNumber}&error=${message(error.message)}`,
    );
  }

  revalidatePath("/admin/progress");
  redirect(`/admin/progress?cohort=${cohortNumber}`);
}
