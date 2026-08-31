import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

interface Row {
  id: string;
  avatarUrl: string | null;
  avatarKey: string | null;
}

const db = vi.hoisted(() => ({
  players: new Map<string, { id: string; avatarUrl: string | null; avatarKey: string | null }>(),
  failUpdate: false,
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
        if (db.failUpdate) throw new Error("DB sập");
        const row = db.players.get(where.id);
        if (!row) return { count: 0 };
        if (where.avatarKey !== undefined && row.avatarKey !== where.avatarKey) {
          return { count: 0 };
        }
        row.avatarUrl = data.avatarUrl;
        row.avatarKey = data.avatarKey;
        return { count: 1 };
      },
    },
  },
}));

const applied = vi.hoisted(() => ({ fn: vi.fn(async () => undefined) }));
vi.mock("../src/rooms/apply-avatar", () => ({ applyAvatarToRoom: applied.fn }));

import { AvatarError } from "../src/avatar/errors";
import { avatarObjectKey, clearAvatar, setAvatar } from "../src/avatar/service";
import { createMemoryStorage, type MemoryObjectStorage } from "../src/storage/memory";
import { resetObjectStorage, setObjectStorage } from "../src/storage";

let storage: MemoryObjectStorage;

async function jpeg(color = { r: 200, g: 60, b: 60 }): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

function row(id: string): Row {
  return db.players.get(id)!;
}

beforeEach(() => {
  db.players.clear();
  db.failUpdate = false;
  db.players.set("p1", { id: "p1", avatarUrl: null, avatarKey: null });
  db.players.set("p2", { id: "p2", avatarUrl: null, avatarKey: null });
  storage = createMemoryStorage("https://cdn.test/masoi");
  setObjectStorage(storage);
  applied.fn.mockClear();
});

afterEach(() => {
  resetObjectStorage();
});

describe("avatarObjectKey", () => {
  it("không đoán được và không dùng tên file người dùng", () => {
    const a = avatarObjectKey("p1");
    const b = avatarObjectKey("p1");

    expect(a).toMatch(/^avatars\/p1\/[0-9a-f]{32}\.webp$/);
    expect(a).not.toBe(b);
  });
});

describe("setAvatar", () => {
  it("upload thành công thì DB lưu URL object và khoá object, không lưu base64", async () => {
    const { avatarUrl } = await setAvatar("p1", await jpeg());

    expect(avatarUrl).toMatch(/^https:\/\/cdn\.test\/masoi\/avatars\/p1\/[0-9a-f]{32}\.webp$/);
    expect(row("p1").avatarUrl).toBe(avatarUrl);
    expect(row("p1").avatarKey).toMatch(/^avatars\/p1\//);
    expect(row("p1").avatarUrl!.startsWith("data:")).toBe(false);
    expect(storage.objects.size).toBe(1);
  });

  it("object lưu ra là WebP 256x256", async () => {
    await setAvatar("p1", await jpeg());
    const stored = [...storage.objects.values()][0];
    const meta = await sharp(stored.body).metadata();

    expect(stored.contentType).toBe("image/webp");
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it("phát lại snapshot cho cả phòng sau khi upload", async () => {
    const { avatarUrl } = await setAvatar("p1", await jpeg());
    expect(applied.fn).toHaveBeenCalledWith("p1", avatarUrl);
  });

  it("đổi ảnh thì dọn object cũ và chỉ còn đúng một object", async () => {
    await setAvatar("p1", await jpeg({ r: 200, g: 60, b: 60 }));
    const firstKey = row("p1").avatarKey;

    await setAvatar("p1", await jpeg({ r: 60, g: 60, b: 200 }));

    expect(storage.objects.has(firstKey!)).toBe(false);
    expect(storage.objects.size).toBe(1);
    expect(storage.objects.has(row("p1").avatarKey!)).toBe(true);
  });

  it("file giả mạo MIME bị từ chối với mã 400", async () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

    await expect(setAvatar("p1", zip)).rejects.toMatchObject({ status: 400 });
    expect(row("p1").avatarUrl).toBeNull();
    expect(storage.objects.size).toBe(0);
  });

  it("ảnh hỏng bị từ chối với mã 400 và không để lại object", async () => {
    const png = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const broken = Buffer.concat([png.subarray(0, 40), Buffer.from("rác")]);

    await expect(setAvatar("p1", broken)).rejects.toMatchObject({ status: 400 });
    expect(storage.objects.size).toBe(0);
  });

  it("thông điệp lỗi cụ thể từ image.ts phải tới người gọi, không bị gộp chung", async () => {
    // GIF không nằm trong danh sách định dạng chấp nhận: sniffImageType trả về
    // null nên processAvatar (thật ra là service.storeAvatar, vì sniff đã chặn
    // trước khi tới processAvatar) phải ném đúng câu "chỉ chấp nhận..." - không
    // phải câu chung "Không đọc được ảnh này, hãy thử ảnh khác".
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

    await expect(setAvatar("p1", gif)).rejects.toMatchObject({
      status: 400,
      message: "Chỉ chấp nhận ảnh JPG, PNG hoặc WebP",
    });
  });

  it("storage lỗi thì DB không đổi - avatar cũ còn nguyên", async () => {
    await setAvatar("p1", await jpeg());
    const before = { ...row("p1") };

    storage.failNextPut();
    await expect(setAvatar("p1", await jpeg())).rejects.toMatchObject({ status: 503 });

    expect(row("p1")).toEqual(before);
    expect(storage.objects.has(before.avatarKey!)).toBe(true);
  });

  it("DB lỗi thì object vừa upload bị dọn và avatar cũ còn nguyên", async () => {
    await setAvatar("p1", await jpeg());
    const before = { ...row("p1") };

    db.failUpdate = true;
    await expect(setAvatar("p1", await jpeg())).rejects.toThrow();
    db.failUpdate = false;

    expect(row("p1")).toEqual(before);
    expect(storage.objects.size).toBe(1);
    expect(storage.objects.has(before.avatarKey!)).toBe(true);
  });

  it("hai upload đồng thời để lại đúng một object, không có object mồ côi", async () => {
    // Dựng SẴN cả hai buffer rồi mới gọi: nếu để `await jpeg(...)` trong mảng
    // của Promise.all thì lần gọi thứ hai chỉ bắt đầu sau khi buffer thứ hai
    // mã hoá xong, và hai luồng có thể không hề chồng nhau - test sẽ xanh mà
    // không hề chạm tới compare-and-swap.
    const [a, b] = [await jpeg({ r: 200, g: 60, b: 60 }), await jpeg({ r: 60, g: 200, b: 60 })];

    await Promise.all([setAvatar("p1", a), setAvatar("p1", b)]);

    expect(storage.objects.size).toBe(1);
    expect(storage.objects.has(row("p1").avatarKey!)).toBe(true);
    expect(row("p1").avatarUrl).toBe(storage.publicUrl(row("p1").avatarKey!));
  });

  it("storage chưa cấu hình thì báo 503 chứ không sập", async () => {
    resetObjectStorage();

    await expect(setAvatar("p1", await jpeg())).rejects.toMatchObject({ status: 503 });
    expect(row("p1").avatarUrl).toBeNull();
  });
});

describe("clearAvatar", () => {
  it("xoá object của chính mình và đặt DB về null", async () => {
    await setAvatar("p1", await jpeg());

    await clearAvatar("p1");

    expect(row("p1").avatarUrl).toBeNull();
    expect(row("p1").avatarKey).toBeNull();
    expect(storage.objects.size).toBe(0);
    expect(applied.fn).toHaveBeenCalledWith("p1", null);
  });

  it("KHÔNG bao giờ đụng tới object của người khác", async () => {
    await setAvatar("p1", await jpeg());
    await setAvatar("p2", await jpeg());
    const otherKey = row("p2").avatarKey!;

    await clearAvatar("p1");

    expect(storage.objects.has(otherKey)).toBe(true);
    expect(row("p2").avatarUrl).not.toBeNull();
  });

  it("storage chưa cấu hình vẫn xoá được - DB sạch là đủ để coi là thành công", async () => {
    db.players.set("p1", { id: "p1", avatarUrl: "data:image/webp;base64,AAA", avatarKey: null });
    resetObjectStorage();

    await expect(clearAvatar("p1")).resolves.toBeUndefined();
    expect(row("p1").avatarUrl).toBeNull();
  });

  it("xoá data URL cũ (không có avatarKey) chạy được", async () => {
    db.players.set("p1", { id: "p1", avatarUrl: "data:image/webp;base64,AAA", avatarKey: null });

    await clearAvatar("p1");

    expect(row("p1").avatarUrl).toBeNull();
  });
});

describe("AvatarError", () => {
  it("mang mã HTTP để route khỏi phải đoán", () => {
    const err = new AvatarError("Ảnh quá lớn", 413);
    expect(err.status).toBe(413);
    expect(err.message).toBe("Ảnh quá lớn");
  });
});
