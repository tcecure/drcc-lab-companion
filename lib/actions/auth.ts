"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getSafeRedirectPath } from "@/lib/redirects";
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

function formPath(value: FormDataEntryValue | null, fallback: string) {
  return getSafeRedirectPath(typeof value === "string" ? value : null, fallback);
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
    redirect(
      `${formPath(formData.get("loginPath"), "/login")}?error=${message(friendlyAuthError(error))}`,
    );
  }

  redirect(formPath(formData.get("next"), "/dashboard"));
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function setPasswordAction(formData: FormData) {
  await requireUser();
  const password = String(formData.get("password") ?? "");
  const passwordConfirmation = String(
    formData.get("passwordConfirmation") ?? "",
  );

  if (password.length < 12) {
    redirect(
      `/set-password?error=${message("Use a password with at least 12 characters.")}`,
    );
  }

  if (password !== passwordConfirmation) {
    redirect(`/set-password?error=${message("The passwords do not match.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect(`/set-password?error=${message(friendlyAuthError(error))}`);
  }

  redirect("/dashboard");
}
