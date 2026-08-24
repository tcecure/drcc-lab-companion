import type { ReactNode } from "react";

import { requireStudent } from "@/lib/auth";

export default async function StudentLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireStudent();

  return children;
}
