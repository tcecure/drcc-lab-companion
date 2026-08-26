"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { readPublicEnv } from "@/lib/env";
import { getSafeRedirectPath } from "@/lib/redirects";
import { createClient } from "@/lib/supabase/server";

const emailSchema = z.string().trim().email();
const passwordRecoverySchema = z.object({
  tokenHash: z.string().trim().min(1),
  type: z.literal("recovery"),
});
const invitationSchema = z.object({
  tokenHash: z.string().trim().min(1),
  type: z.literal("invite"),
});

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

export async function requestPasswordResetAction(formData: FormData) {
  const email = emailSchema.safeParse(formData.get("email"));

  if (!email.success) {
    redirect(
      `/forgot-password?error=${message("Enter a valid email address.")}`,
    );
  }

  const env = readPublicEnv();
  const callbackUrl = new URL("/auth/callback", env.NEXT_PUBLIC_APP_URL);
  callbackUrl.searchParams.set("next", "/set-password");

  const supabase = await createClient();
  const { error } = await supabase.auth
    .resetPasswordForEmail(email.data, {
      redirectTo: callbackUrl.toString(),
    })
    .catch((error) => ({ error }));

  if (error) {
    redirect(`/forgot-password?error=${message(friendlyAuthError(error))}`);
  }

  redirect(
    `/forgot-password?message=${message("If an account exists for that email, a password reset link has been sent.")}`,
  );
}

export async function confirmPasswordRecoveryAction(formData: FormData) {
  const recovery = passwordRecoverySchema.safeParse({
    tokenHash: formData.get("tokenHash"),
    type: formData.get("type"),
  });

  if (!recovery.success) {
    redirect(
      `/login?error=${message("This password reset link is incomplete. Request a new link.")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: recovery.data.tokenHash,
    type: recovery.data.type,
  });

  if (error) {
    redirect(
      `/login?error=${message("This password reset link is invalid or has expired. Request a new link.")}`,
    );
  }

  redirect("/set-password");
}

export async function confirmInvitationAction(formData: FormData) {
  const invitation = invitationSchema.safeParse({
    tokenHash: formData.get("tokenHash"),
    type: formData.get("type"),
  });

  if (!invitation.success) {
    redirect(
      `/login?error=${message("This invitation link is incomplete. Ask the DigitalRCC team for a new invitation.")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: invitation.data.tokenHash,
    type: invitation.data.type,
  });

  if (error) {
    redirect(
      `/login?error=${message("This invitation is invalid or has expired. Ask the DigitalRCC team for a new invitation.")}`,
    );
  }

  redirect("/set-password");
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
