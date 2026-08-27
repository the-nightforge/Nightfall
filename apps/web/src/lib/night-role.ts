import { ROLE_META, type Role } from "@masoi/shared";

export function canActAtNight(role: Role | undefined): boolean {
  return role !== undefined && ROLE_META[role].nightOrder !== undefined;
}
