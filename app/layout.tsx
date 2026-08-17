import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DigitalRCC Lab Companion",
    template: "%s | DigitalRCC",
  },
  description:
    "Internal lab access, queue, progress, and guide companion for DigitalRCC.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
