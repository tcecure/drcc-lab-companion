import type { Database } from "@/lib/types";

export type SupportRequest =
  Database["public"]["Tables"]["support_requests"]["Row"];
export type SupportMessage =
  Database["public"]["Tables"]["support_messages"]["Row"];
export type SupportAttachment =
  Database["public"]["Tables"]["support_attachments"]["Row"];
export type SupportCategory = SupportRequest["category"];
export type SupportStatus = SupportRequest["status"];
export type LabFamily = NonNullable<SupportRequest["lab_family"]>;

export const supportCategories = [
  { value: "connectivity", label: "Connectivity" },
  { value: "guacamole", label: "Remote desktop" },
  { value: "vpn", label: "VPN access" },
  { value: "lab_guide", label: "Lab guide" },
  { value: "verification", label: "Progress verification" },
  { value: "course_platform", label: "Course platform" },
  { value: "other", label: "Something else" },
] as const satisfies ReadonlyArray<{
  value: Exclude<SupportCategory, "account_access">;
  label: string;
}>;

export const supportStatuses = [
  { value: "open", label: "New" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_on_student", label: "Waiting on student" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
] as const satisfies ReadonlyArray<{ value: SupportStatus; label: string }>;

export const labFamilies = ["AC", "IA", "SI", "SC", "MP", "PE"] as const;

export const allowedSupportImageTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const maximumSupportImageBytes = 3 * 1024 * 1024;

export function getTicketCode(id: string) {
  return `DRCC-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

export function getSupportCategoryLabel(category: SupportCategory) {
  if (category === "account_access") {
    return "Account access";
  }

  return (
    supportCategories.find((item) => item.value === category)?.label ??
    "Support"
  );
}

export function getSupportStatusLabel(status: SupportStatus) {
  return supportStatuses.find((item) => item.value === status)?.label ?? status;
}

export function isAllowedSupportImage(type: string) {
  return allowedSupportImageTypes.some((allowed) => allowed === type);
}

export function sanitizeSupportFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);

  return cleaned || "screenshot";
}
