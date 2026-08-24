export type PortalRole = "student" | "approver" | "admin";

export const managerRoles = [
  "admin",
  "approver",
] as const satisfies PortalRole[];

export function canManage(roles: readonly PortalRole[]) {
  return managerRoles.some((role) => roles.includes(role));
}

export function getDefaultPortalPath(roles: readonly PortalRole[]) {
  return canManage(roles) ? "/admin" : "/student";
}
