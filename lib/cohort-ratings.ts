import { createAdminClient } from "@/lib/supabase/admin";

export const maxStudentRating = 5;

/** Staff ratings for one cohort, keyed by student user id. */
export async function listCohortRatings(cohortNumber: number | null) {
  if (!cohortNumber) {
    return new Map<string, number>();
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("student_cohort_ratings")
    .select("user_id, rating")
    .eq("cohort_number", cohortNumber);

  if (error) {
    throw new Error(error.message);
  }

  return new Map<string, number>(
    (data ?? []).map((row) => [row.user_id, row.rating]),
  );
}
