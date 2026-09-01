import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const db = vi.hoisted(() => ({
  players: new Map<string, { id: string; avatarUrl: string | null; avatarKey: string | null }>(),
}));

vi.mock("../src/db", () => ({
  prisma: {
    player: {
      findUnique: async ({ where }: { where: { id: string } }) => db.players.get(where.id) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; avatarKey?: string | null };
        data: { avatarUrl: string | null; avatarKey: string | null };
      }) => {
        const row = db.players.get(where.id);
        if (!row) return { count: 0 };
        if (where.avatarKey !== undefined && row.avatarKey !== where.avatarKey) return { count: 0 };
        row.avatarUrl = data.avatarUrl;
        row.avatarKey = data.avatarKey;
        return { count: 1 };
      },
    },
  },
}));

vi.mock("../src/rooms/apply-avatar", () => ({ applyAvatarToRoom: async () => undefined }));

import { resolveMemberAvatar } from "../src/avatar/legacy";
import { createMemoryStorage, type MemoryObjectStorage } from "../src/storage/memory";
import { resetObjectStorage, setObjectStorage } from "../src/storage";

let storage: MemoryObjectStorage;

async function dataUrl(): Promise<string> {
  const png = await sharp({
    create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

beforeEach(() => {
  db.players.clear();
  storage = createMemoryStorage("https://cdn.test/masoi");
  setObjectStorage(storage);
});

afterEach(() => {
  resetObjectStorage();
});

describe("resolveMemberAvatar", () => {
  it("không có bản ghi thì trả null", async () => {
    expect(await resolveMemberAvatar(null)).toBeNull();
  });

  it("URL https đi qua nguyên, không upload lại", async () => {
    const record = { id: "p1", avatarUrl: "https://cdn.test/masoi/a.webp" };

    expect(await resolveMemberAvatar(record)).toBe("https://cdn.test/masoi/a.webp");
    expect(storage.objects.size).toBe(0);
  });

  it("data URL cũ được di trú thành URL object và ghi lại vào DB", async () => {
    const legacy = await dataUrl();
    db.players.set("p1", { id: "p1", avatarUrl: legacy, avatarKey: null });

    const url = await resolveMemberAvatar({ id: "p1", avatarUrl: legacy });

    expect(url).toMatch(/^https:\/\/cdn\.test\/masoi\/avatars\/p1\/[0-9a-f]{32}\.webp$/);
    expect(db.players.get("p1")!.avatarUrl).toBe(url);
    expect(db.players.get("p1")!.avatarKey).toMatch(/^avatars\/p1\//);
    expect(storage.objects.size).toBe(1);
  });

  it("di trú xong thì lần sau không upload thêm lần nữa", async () => {
    const legacy = await dataUrl();
    db.players.set("p1", { id: "p1", avatarUrl: legacy, avatarKey: null });

    const first = await resolveMemberAvatar({ id: "p1", avatarUrl: legacy });
    const second = await resolveMemberAvatar({ id: "p1", avatarUrl: first });

    expect(second).toBe(first);
    expect(storage.objects.size).toBe(1);
  });

  it("storage CHƯA cấu hình thì data URL đi qua nguyên - dev vẫn chạy đủ", async () => {
    resetObjectStorage();
    const legacy = await dataUrl();

    expect(await resolveMemberAvatar({ id: "p1", avatarUrl: legacy })).toBe(legacy);
  });

  it("di trú hỏng thì trả null và KHÔNG chặn người chơi vào phòng", async () => {
    db.players.set("p1", { id: "p1", avatarUrl: "x", avatarKey: null });
    storage.failNextPut();
    const legacy = await dataUrl();

    await expect(resolveMemberAvatar({ id: "p1", avatarUrl: legacy })).resolves.toBeNull();
  });

  it("data URL rác (không giải mã được thành ảnh) trả null chứ không ném", async () => {
    db.players.set("p1", { id: "p1", avatarUrl: "x", avatarKey: null });

    await expect(
      resolveMemberAvatar({ id: "p1", avatarUrl: "data:image/png;base64,khôngphảiảnh" }),
    ).resolves.toBeNull();
  });
});
