import { ROLE_META, type Role } from "@masoi/shared";

export function canActAtNight(role: Role | undefined, apprenticeAwakened = false): boolean {
  if (!role) return false;
  if (role === "APPRENTICE_SEER") return apprenticeAwakened;
  return ROLE_META[role].nightOrder !== undefined;
}

