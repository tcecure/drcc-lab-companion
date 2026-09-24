"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, useTransition } from "react";

import type { StudentCredentialResult } from "@/lib/actions/lab-credentials";

export function StaffCredentialReveal({
  reveal,
  seatNumber,
}: {
  reveal: (seatNumber: number) => Promise<StudentCredentialResult>;
  seatNumber: number;
}) {
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (password) {
      setPassword(null);
      return;
    }

    startTransition(async () => {
      const result = await reveal(seatNumber);

      if (result.ok) {
        setError(null);
        setPassword(result.password);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        aria-label={`${password ? "Hide" : "Reveal"} the seat ${seatNumber} password`}
        className="button secondary"
        disabled={pending}
        onClick={toggle}
        type="button"
      >
        {password ? <EyeOff size={15} /> : <Eye size={15} />}
        {password ? "Hide" : "Reveal"}
      </button>
      {password ? (
        <code className="font-mono text-sm text-cyan-100">{password}</code>
      ) : null}
      {error ? <span className="text-sm text-amber-200">{error}</span> : null}
    </div>
  );
}
