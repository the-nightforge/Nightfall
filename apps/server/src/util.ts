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

const BOT_NAMES = [
  "MTP",
  "Phú Lê",
  "Jack",
  "Thanh Tú",
  "ChiPu",
  "Thầy Giáo Ba",
  "Độ Mixi",
  "Gia Huy",
  "Ngọc Lan",
  "Phương Linh",
  "Đức Thắng",
  "Khánh Vy",
  "Trung Hiếu",
  "Diệu Linh",
  "Thùy Dương",
  "Đăng Khoa",
  "Mai Chi",
  "Việt Hưng",
  "Hải Yến",
  "Nhật Minh",
];

export function botName(takenNames: string[]): string {
  const taken = new Set(takenNames.map((n) => n.trim().toLowerCase()));
  const free = BOT_NAMES.filter((n) => !taken.has(n.toLowerCase()));
  if (free.length > 0) {
    return free[Math.floor(Math.random() * free.length)];
  }
  for (let i = 2; ; i++) {
    const candidate = `${BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
