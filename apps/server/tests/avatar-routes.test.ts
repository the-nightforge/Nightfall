import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import sharp from "sharp";

const db = vi.hoisted(() => ({
  players: new Map<string, { id: string; avatarUrl: string | null; avatarKey: string | null }>(),
  tokenHashes: new Map<string, string>(),
  // Bật để giả lập DB sập giữa lúc đổi ảnh - lỗi thô (không phải AvatarError)
  // dùng để chứng minh route không để lộ nó ra client.
  forceUpdateError: false,
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
        if (db.forceUpdateError) {
          throw new Error("Lỗi CSDL giả lập - KHÔNG được lộ câu này ra client");
        }
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

// Đếm số lần setAvatar (tầng service, có kiểm byte riêng ở storeAvatar) thực
// sự được gọi tới - vẫn chạy code thật bên dưới (importOriginal), chỉ thêm bộ
// đếm. Dùng để phân biệt một 413 đến từ multer.limits.fileSize (chặn TRƯỚC khi
// route handler chạy, nên setAvatar không hề được gọi) với một 413 đến từ
// nhánh `file.length > MAX_AVATAR_UPLOAD_BYTES` bên trong storeAvatar (phải
// gọi setAvatar rồi mới biết). Hai đường cho ra cùng status và cùng câu chữ
// nên không thể phân biệt bằng response - phải soi vào việc service có được
// chạm tới hay không.
const serviceSpies = vi.hoisted(() => ({ setAvatarCalls: 0 }));

vi.mock("../src/avatar/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/avatar/service")>();
  return {
    ...actual,
    setAvatar: async (...args: Parameters<typeof actual.setAvatar>) => {
      serviceSpies.setAvatarCalls++;
      return actual.setAvatar(...args);
    },
  };
});

import { avatarRouter } from "../src/avatar/routes";
import { resetRateLimit } from "../src/rate-limit";
import { sha256 } from "../src/util";
import { createMemoryStorage, type MemoryObjectStorage } from "../src/storage/memory";
import { resetObjectStorage, setObjectStorage } from "../src/storage";

const TOKEN = "token-hop-le-dai-hon-16-ky-tu";

let storage: MemoryObjectStorage;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

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
  db.forceUpdateError = false;
  serviceSpies.setAvatarCalls = 0;
  db.players.set("p1", { id: "p1", avatarUrl: null, avatarKey: null });
  db.tokenHashes.set(sha256(TOKEN), "p1");
  storage = createMemoryStorage("https://cdn.test/masoi");
  setObjectStorage(storage);
  resetRateLimit();
  // Hai test dưới đây (lỗi CSDL thô, thiếu boundary multipart) cố tình đi qua
  // nhánh log lỗi - câm ở đây theo đúng nếp avatar-service.test.ts, không đụng
  // vào code sản phẩm.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetObjectStorage();
  resetRateLimit();
  consoleErrorSpy.mockRestore();
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

  it("gửi field văn bản thay vì file thì 400 (limits.fields: 0 chặn ngay từ field đầu tiên)", async () => {
    // Trước khi limits.fields: 0 được thêm vào, request này lọt qua parser
    // (field "khác" bị multer gom vào req.body), req.file rỗng, và route tự
    // trả "Thiếu file ảnh". Giờ busboy chặn luôn ở field đầu tiên bằng
    // LIMIT_FIELD_COUNT - vẫn 400, nhưng KHÔNG còn cùng lý do: một request với
    // hàng trăm field văn bản sẽ bị chặn ở đây, chứ không còn được multer gom
    // hết vào req.body trước khi route kịp từ chối.
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .field("khác", "1");

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("nhiều field văn bản (giả lập tấn công OOM) bị chặn ở tầng parser, không bị gom vào body", async () => {
    // limits.fields: 0 làm busboy ném fieldsLimit ngay ở field văn bản đầu
    // tiên, bất kể sau đó còn bao nhiêu field nữa - nên request với hàng trăm
    // field 1MB/field (thứ multer trước đây sẽ gom hết vào req.body vì fields
    // mặc định là Infinity) không bao giờ được cấp phát đủ bộ nhớ để trở thành
    // vấn đề.
    let req = request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`);
    for (let i = 0; i < 500; i++) {
      req = req.field(`f${i}`, "x".repeat(1024));
    }
    const res = await req;

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

  it("413 đến từ multer.limits.fileSize (tầng parser), không phải kiểm byte riêng trong storeAvatar", async () => {
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1024, 0x41);
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", tooBig, "to.jpg");

    expect(res.status).toBe(413);
    // Nếu multer.limits.fileSize từng bị gỡ khỏi routes.ts, request 5MB+1KB
    // này sẽ lọt qua parser, chạy tới setAvatar, và bị storeAvatar tự chặn ở
    // đó thay - assertion dưới đây sẽ fail trong tình huống đó, chứng minh cái
    // 413 hiện tại KHÔNG đến từ nhánh service.
    expect(serviceSpies.setAvatarCalls).toBe(0);
  });

  it("gọi quá nhanh thì 429", async () => {
    const file = await jpeg();
    for (let i = 0; i < 5; i++) {
      const res = await request(app())
        .put("/api/players/me/avatar")
        .set("authorization", `Bearer ${TOKEN}`)
        .attach("file", file, "a.jpg");
      // Rate limit chạy TRƯỚC khi parse, nên 5 lượt upload lỗi cũng tiêu hết
      // đúng ngần ấy hạn mức - phải chốt cả 5 lượt đầu thành công thì lượt 429
      // dưới đây mới thật sự chứng minh "giới hạn tốc độ", chứ không phải
      // đang đo một quota-lỗi trùng hợp có cùng con số.
      expect(res.status).toBe(200);
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

  it("service ném lỗi thô (không phải AvatarError) thì trả 500 chung, không lộ chi tiết", async () => {
    db.forceUpdateError = true;
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", await jpeg(), "a.jpg");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Không đổi được ảnh đại diện lúc này");
    // Câu lỗi giả lập ở tầng DB không được lọt ra ngoài dưới bất kỳ hình thức nào.
    expect(JSON.stringify(res.body)).not.toContain("Lỗi CSDL giả lập");
  });

  it("thiếu boundary trong Content-Type multipart thì vẫn trả JSON tiếng Việt, không phải stack trace", async () => {
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .set("Content-Type", "multipart/form-data")
      .send("khong-co-boundary-nen-busboy-nem-loi");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Không đọc được file tải lên" });
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
