"use server";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";

function message(input: string) {
  return encodeURIComponent(input);
}

export async function requestAccessAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const organization = String(formData.get("organization") ?? "").trim();
  const notes = String(formData.get("message") ?? "").trim();

  if (!name || !email || !organization) {
    redirect(
      `/request-access?error=${message("Name, email, and organization are required.")}`,
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("pre_registration_interests").insert({
    name,
    email,
    organization,
    interest: "cmmc_level_1_training",
    message: notes || "CMMC Level 1 lab access request.",
    status: "new",
  });

  if (error) {
    redirect(`/request-access?error=${message(error.message)}`);
  }

  redirect("/request-access/received");
}
