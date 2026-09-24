"use client";

import { Check, Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { useState, useTransition } from "react";

import type { StudentCredentialResult } from "@/lib/actions/lab-credentials";

export function LabCredentialReveal({
  labUsername,
  reveal,
}: {
  labUsername: string;
  reveal: () => Promise<StudentCredentialResult>;
}) {
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function showPassword() {
    startTransition(async () => {
      const result = await reveal();

      if (result.ok) {
        setError(null);
        setPassword(result.password);
      } else {
        setPassword(null);
        setError(result.error);
      }
    });
  }

  function hidePassword() {
    setPassword(null);
    setCopied(false);
  }

  async function copyPassword() {
    if (!password) {
      return;
    }

    await navigator.clipboard.writeText(password);
    setCopied(true);
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <KeyRound aria-hidden="true" className="text-cyan-300" size={18} />
        <span>
          Sign in to the lab gateway as{" "}
          <strong className="text-white">{labUsername}</strong>
        </span>
      </div>

      {password ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code
            className="rounded-md border border-cyan-200/20 bg-slate-950/60 px-4 py-2 font-mono text-base text-cyan-100"
            data-testid="lab-password"
          >
            {password}
          </code>
          <button
            className="button secondary"
            onClick={copyPassword}
            type="button"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            className="button secondary"
            onClick={hidePassword}
            type="button"
          >
            <EyeOff size={16} />
            Hide
          </button>
        </div>
      ) : (
        <button
          className="button mt-4"
          disabled={pending}
          onClick={showPassword}
          type="button"
        >
          <Eye size={16} />
          {pending ? "Checking…" : "Show my lab password"}
        </button>
      )}

      {error ? (
        <p className="mt-3 text-sm leading-6 text-amber-200">{error}</p>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-slate-400">
        This password belongs to your pod only. Never share it, and never send
        it by email — staff can reissue it from the portal if it is ever
        exposed.
      </p>
    </div>
  );
}
