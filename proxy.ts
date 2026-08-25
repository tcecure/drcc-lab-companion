import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const protectedPrefixes = ["/admin", "/student", "/dashboard"] as const;
const authPaths = ["/login", "/labops"] as const;
const labopsConsole = "/admin/labops";
const labopsLogin = "/labops";

function value(input: string | undefined) {
  return input?.trim() || undefined;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabaseUrl =
    value(process.env.NEXT_PUBLIC_SUPABASE_URL) ??
    value(process.env.SUPABASE_URL);
  const supabaseKey =
    value(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    value(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ??
    value(process.env.SUPABASE_PUBLISHABLE_KEY) ??
    value(process.env.SUPABASE_ANON_KEY);

  if (!supabaseUrl || !supabaseKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });
  const pathname = request.nextUrl.pathname;
  const protectedPath = protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const authPath = authPaths.some((prefix) => pathname === prefix);
  const {
    data: { user },
  } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));

  const labopsPath =
    pathname === labopsConsole || pathname.startsWith(`${labopsConsole}/`);

  if (!user && protectedPath) {
    const url = request.nextUrl.clone();
    url.search = "";

    if (labopsPath) {
      url.pathname = labopsLogin;
      return NextResponse.redirect(url);
    }

    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  if (user && authPath) {
    const url = request.nextUrl.clone();
    url.pathname = pathname === labopsLogin ? labopsConsole : "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
