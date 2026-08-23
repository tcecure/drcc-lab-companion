import Link from "next/link";

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-cyan-200/15 bg-slate-950/85 backdrop-blur-xl">
      <div className="mx-auto flex min-h-18 w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link className="flex items-center gap-3" href="/">
          <span className="brand-mark">DR</span>
          <span>
            <span className="block font-bold">DigitalRCC</span>
            <span className="block text-xs text-slate-400">Lab Companion</span>
          </span>
        </Link>
        <nav
          aria-label="Public navigation"
          className="flex items-center justify-end gap-1 text-sm"
        >
          <Link
            className="hidden min-h-10 items-center rounded-md px-3 font-semibold text-slate-300 hover:bg-white/5 hover:text-white sm:inline-flex"
            href="/support"
          >
            Support
          </Link>
          <Link
            className="hidden min-h-10 items-center rounded-md px-3 font-semibold text-slate-300 hover:bg-white/5 hover:text-white md:inline-flex"
            href="/request-access"
          >
            Request access
          </Link>
          <Link className="button" href="/login">
            Log in
          </Link>
        </nav>
      </div>
    </header>
  );
}
