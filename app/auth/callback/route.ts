import { NextResponse, type NextRequest } from "next/server";

import { getSafeRedirectPath } from "@/lib/redirects";
import { createClient } from "@/lib/supabase/server";

function loginError(requestUrl: URL, message: string) {
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("error", message);
  return NextResponse.redirect(loginUrl);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = getSafeRedirectPath(url.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return loginError(
        url,
        "This account link is invalid or has expired. Request a new password reset link.",
      );
    }
  } else {
    return loginError(
      url,
      "This account link is incomplete. Request a new password reset link.",
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
