export function getSafeRedirectPath(
  input: string | null | undefined,
  fallback = "/dashboard",
) {
  if (!input?.startsWith("/")) {
    return fallback;
  }

  const base = new URL("https://portal.invalid");
  const destination = new URL(input, base);

  if (destination.origin !== base.origin) {
    return fallback;
  }

  return `${destination.pathname}${destination.search}${destination.hash}`;
}
