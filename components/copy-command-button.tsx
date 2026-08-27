"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
  }

  const Icon = copied ? Check : Copy;

  return (
    <button
      aria-label={copied ? "Command copied" : "Copy command"}
      className="guide-copy-button"
      onClick={copyCommand}
      title={copied ? "Copied" : "Copy command"}
      type="button"
    >
      <Icon aria-hidden="true" size={16} />
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
