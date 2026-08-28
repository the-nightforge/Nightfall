import { ROLE_META, type Role } from "@masoi/shared";

export function getRoleLabel(role: Role): string {
  return ROLE_META[role]?.name ?? role;
}

export function getRoleDescription(role: Role): string {
  return ROLE_META[role]?.description ?? "";
}

export function getRoleTeam(role: Role): "wolves" | "village" {
  return ROLE_META[role]?.team ?? "village";
}
