import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { SubmitButton } from "@/components/forms";
import { createStudentSupportTicketAction } from "@/lib/actions/support-tickets";
import { requireStudent } from "@/lib/auth";
import { labFamilies, supportCategories } from "@/lib/support-tickets";
import { createAdminClient } from "@/lib/supabase/admin";

type NewSupportTicketPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewSupportTicketPage({
  searchParams,
}: NewSupportTicketPageProps) {
  const [{ user, roles }, params] = await Promise.all([
    requireStudent(),
    searchParams,
  ]);
  const supabase = createAdminClient();
  const [{ data: profile }, { data: assignment }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("student_cohort_assignments")
      .select("pod_name, seat_number")
      .eq("user_id", user.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return (
    <AppShell roles={roles} title="Open Support Ticket">
      {params.error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {params.error}
        </p>
      ) : null}
      <Link
        className="inline-flex w-fit items-center gap-2 text-sm font-bold text-cyan-100 hover:text-white"
        href="/student/support"
      >
        <ArrowLeft aria-hidden="true" size={16} />
        Back to tickets
      </Link>
      <section className="grid gap-5 border-y border-cyan-200/15 py-5 sm:grid-cols-3">
        <div>
          <p className="text-xs font-bold text-slate-500">Student</p>
          <p className="mt-1 text-sm font-bold">
            {profile?.full_name || user.email}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold text-slate-500">Email</p>
          <p className="mt-1 break-all text-sm font-bold">
            {profile?.email || user.email}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold text-slate-500">Assigned pod</p>
          <p className="mt-1 text-sm font-bold">
            {assignment?.pod_name ||
              (assignment?.seat_number
                ? `Pod${String(assignment.seat_number).padStart(2, "0")}`
                : "Not assigned")}
          </p>
        </div>
      </section>

      <form
        action={createStudentSupportTicketAction}
        className="grid max-w-4xl gap-5"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold">
            Issue category
            <select className="input" defaultValue="" name="category" required>
              <option disabled value="">
                Select a category
              </option>
              {supportCategories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-bold">
            Lab family
            <select className="input" defaultValue="" name="labFamily">
              <option value="">Not tied to a lab family</option>
              {labFamilies.map((family) => (
                <option key={family} value={family}>
                  {family}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="grid gap-2 text-sm font-bold">
          Short subject
          <input
            className="input"
            maxLength={120}
            name="subject"
            placeholder="Example: AC progress is not updating"
            required
          />
        </label>
        <label className="grid gap-2 text-sm font-bold">
          What happened?
          <textarea
            className="input min-h-40 resize-y"
            maxLength={5000}
            minLength={20}
            name="description"
            placeholder="Include the page or lab step, what you expected, what happened instead, and the exact error message."
            required
          />
        </label>
        <label className="grid gap-2 text-sm font-bold">
          Screenshot{" "}
          <span className="font-normal text-slate-400">Optional</span>
          <input
            accept="image/png,image/jpeg,image/webp"
            className="input file:mr-3 file:rounded-md file:border-0 file:bg-cyan-300 file:px-3 file:py-1 file:font-bold file:text-slate-950"
            name="screenshot"
            type="file"
          />
          <span className="text-xs font-normal text-slate-500">
            PNG, JPEG, or WebP. Maximum 3 MB.
          </span>
        </label>
        <div className="flex items-start gap-2 border-t border-cyan-200/10 pt-5 text-sm text-amber-100">
          <LockKeyhole
            aria-hidden="true"
            className="mt-0.5 shrink-0"
            size={16}
          />
          Never include your password, invitation link, or recovery code.
        </div>
        <div>
          <SubmitButton>Open support ticket</SubmitButton>
        </div>
      </form>
    </AppShell>
  );
}
