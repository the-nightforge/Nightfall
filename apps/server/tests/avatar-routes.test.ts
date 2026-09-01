import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import sharp from "sharp";

const db = vi.hoisted(() => ({
  players: new Map<string, { id: string; avatarUrl: string | null; avatarKey: string | null }>(),
  tokenHashes: new Map<string, string>(),
}));

vi.mock("../src/db", () => ({
  prisma: {
    player: {
      findUnique: async ({ where }: { where: { id?: string; tokenHash?: string } }) => {
        if (where.tokenHash) {
          const id = db.tokenHashes.get(where.tokenHash);
          return id ? db.players.get(id) ?? null : null;
        }
        return db.players.get(where.id!) ?? null;
      },
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

import { avatarRouter } from "../src/avatar/routes";
import { resetRateLimit } from "../src/rate-limit";
import { sha256 } from "../src/util";
import { createMemoryStorage, type MemoryObjectStorage } from "../src/storage/memory";
import { resetObjectStorage, setObjectStorage } from "../src/storage";

const TOKEN = "token-hop-le-dai-hon-16-ky-tu";

let storage: MemoryObjectStorage;

function app() {
  const instance = express();
  instance.use("/api", avatarRouter);
  return instance;
}

async function jpeg(width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 60 } } })
    .jpeg()
    .toBuffer();
}

beforeEach(() => {
  db.players.clear();
  db.tokenHashes.clear();
  db.players.set("p1", { id: "p1", avatarUrl: null, avatarKey: null });
  db.tokenHashes.set(sha256(TOKEN), "p1");
  storage = createMemoryStorage("https://cdn.test/masoi");
  setObjectStorage(storage);
  resetRateLimit();
});

afterEach(() => {
  resetObjectStorage();
  resetRateLimit();
});

describe("PUT /api/players/me/avatar", () => {
  it("thiếu Bearer token thì 401", async () => {
    const res = await request(app())
      .put("/api/players/me/avatar")
      .attach("file", await jpeg(), "a.jpg");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/xác thực/i);
  });

  it("token sai thì 401", async () => {
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", "Bearer token-sai-nhung-du-dai-16")
      .attach("file", await jpeg(), "a.jpg");

    expect(res.status).toBe(401);
  });

  it("upload hợp lệ thì 200 và trả về URL object", async () => {
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", await jpeg(), "ảnh của tôi.jpg");

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toMatch(
      /^https:\/\/cdn\.test\/masoi\/avatars\/p1\/[0-9a-f]{32}\.webp$/,
    );
    // Tên file người dùng không được lọt vào khoá object.
    expect(res.body.avatarUrl).not.toContain("ảnh");
    expect(db.players.get("p1")!.avatarUrl).toBe(res.body.avatarUrl);
  });

  it("thiếu field file thì 400", async () => {
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .field("khác", "1");

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("file giả mạo MIME thì 400 và không có object nào được tạo", async () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", zip, { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(storage.objects.size).toBe(0);
  });

  it("file quá 5MB thì 413", async () => {
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1024, 0x41);
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", tooBig, "to.jpg");

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/5MB/);
  });

  it("gọi quá nhanh thì 429", async () => {
    const file = await jpeg();
    for (let i = 0; i < 5; i++) {
      await request(app())
        .put("/api/players/me/avatar")
        .set("authorization", `Bearer ${TOKEN}`)
        .attach("file", file, "a.jpg");
    }

    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", file, "a.jpg");

    expect(res.status).toBe(429);
  });

  it("storage chưa cấu hình thì 503 chứ không 500", async () => {
    resetObjectStorage();
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", await jpeg(), "a.jpg");

    expect(res.status).toBe(503);
  });
});

describe("DELETE /api/players/me/avatar", () => {
  it("xoá thành công thì 204 và object bị dọn", async () => {
    await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", await jpeg(), "a.jpg");

    const res = await request(app())
      .delete("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`);

    expect(res.status).toBe(204);
    expect(db.players.get("p1")!.avatarUrl).toBeNull();
    expect(storage.objects.size).toBe(0);
  });

  it("thiếu Bearer token thì 401", async () => {
    const res = await request(app()).delete("/api/players/me/avatar");
    expect(res.status).toBe(401);
  });
});
