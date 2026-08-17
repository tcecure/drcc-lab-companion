import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { getUserRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const fallbackGuides = [
  {
    title: "CMMC Level 1 Lab Guide",
    description:
      "Core DigitalRCC CMMC Level 1 lab guide and student checklist.",
    slug: "cmmc-level-1-lab-guide",
  },
  {
    title: "Student01-20 Access Notes",
    description:
      "How to use the assigned student account and hands-on lab environment.",
    slug: "student-access-notes",
  },
];

export default async function GuidesPage() {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);
  const supabase = await createClient();
  const { data } = await supabase
    .from("resources")
    .select("title, slug, description, external_url, resource_type")
    .eq("status", "published")
    .in("resource_type", [
      "lab_guide",
      "student_guide",
      "checklist",
      "cmmc_reference",
    ])
    .order("title", { ascending: true });
  const guides = data?.length ? data : fallbackGuides;

  return (
    <AppShell roles={roles} title="Lab Guides">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {guides.map((guide) => (
          <Card eyebrow="Guide" title={guide.title} key={guide.slug}>
            <p className="min-h-20 text-sm leading-6 text-slate-300">
              {guide.description}
            </p>
            {"external_url" in guide && guide.external_url ? (
              <Link className="button mt-5" href={guide.external_url}>
                Open guide
              </Link>
            ) : (
              <span className="button secondary mt-5">Content pending</span>
            )}
          </Card>
        ))}
      </section>
    </AppShell>
  );
}
