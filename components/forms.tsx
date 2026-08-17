"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function SubmitButton({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={`button ${className}`} disabled={pending} type="submit">
      {pending ? "Working..." : children}
    </button>
  );
}
