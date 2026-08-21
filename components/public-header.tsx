import Link from "next/link";
import { LifeBuoy } from "lucide-react";

export function PublicHeader() {
  return (
    <header className="border-b border-cyan-200/15 bg-slate-950/75 backdrop-blur-xl">
      <div className="mx-auto flex min-h-18 w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link className="flex items-center gap-3" href="/">
          <span className="brand-mark">DR</span>
          <span>
            <span className="block font-bold">DigitalRCC</span>
            <span className="block text-xs text-slate-400">Lab Companion</span>
          </span>
        </Link>
        <nav
          aria-label="Public navigation"
          className="flex flex-wrap items-center justify-end gap-2 text-sm"
        >
          <Link
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 font-semibold text-slate-300 hover:bg-white/5 hover:text-white"
            href="/support"
          >
            <LifeBuoy aria-hidden="true" size={16} />
            Support
          </Link>
          <Link
            className="inline-flex min-h-10 items-center rounded-md px-3 font-semibold text-slate-300 hover:bg-white/5 hover:text-white"
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
