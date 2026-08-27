import { createHash, randomBytes, randomUUID } from "crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function newId(): string {
  return randomUUID();
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

const BOT_NAMES = ["Bạc", "Sói Con", "Lúa", "Sương", "Gió", "Mưa", "Trăng", "Đom Đóm"];

export function botName(existingCount: number): string {
  const base = BOT_NAMES[existingCount % BOT_NAMES.length];
  return `${base} (Bot)`;
}
