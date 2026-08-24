"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function message(input: string) {
  return encodeURIComponent(input);
}

function friendlyAuthError(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message.includes("Unexpected token") ||
      error.message.includes("not valid JSON")
    ) {
      return "Supabase returned an unexpected response. Check the project URL and publishable key.";
    }

    return error.message;
  }

  return "Authentication failed. Check your credentials and try again.";
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.auth
    .signInWithPassword({ email, password })
    .catch((error) => ({
      error,
    }));

  if (error) {
    redirect(`/login?error=${message(friendlyAuthError(error))}`);
  }

  redirect("/dashboard");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
