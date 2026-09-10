import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://my.digitalrcc.com"),
  title: {
    default: "DigitalRCC Lab Companion",
    template: "%s | DigitalRCC",
  },
  description:
    "Internal lab access, queue, progress, and guide companion for DigitalRCC.",
  applicationName: "DigitalRCC Lab Companion",
  openGraph: {
    description:
      "CMMC Level 1 lab access, guides, progress, and support in one place.",
    locale: "en_US",
    siteName: "DigitalRCC Lab Companion",
    title: "DigitalRCC Lab Companion",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    description:
      "CMMC Level 1 lab access, guides, progress, and support in one place.",
    title: "DigitalRCC Lab Companion",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
