import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorage, type MemoryObjectStorage } from "../src/storage/memory";

let storage: MemoryObjectStorage;

beforeEach(() => {
  storage = createMemoryStorage("https://cdn.test/masoi");
});

describe("MemoryObjectStorage", () => {
  it("tự nhận là đã cấu hình - test không cần mạng", () => {
    expect(storage.configured).toBe(true);
  });

  it("put lưu byte và trả URL công khai đọc lại được", async () => {
    const body = Buffer.from("xin chao");
    const stored = await storage.put("avatars/p1/abc.webp", body, "image/webp");

    expect(stored).toEqual({
      key: "avatars/p1/abc.webp",
      url: "https://cdn.test/masoi/avatars/p1/abc.webp",
    });
    expect(storage.objects.get("avatars/p1/abc.webp")).toEqual({
      body,
      contentType: "image/webp",
    });
  });

  it("publicUrl ghép base với key, không thêm dấu / thừa", () => {
    expect(storage.publicUrl("avatars/p1/abc.webp")).toBe(
      "https://cdn.test/masoi/avatars/p1/abc.webp",
    );
  });

  it("delete xoá đúng key", async () => {
    await storage.put("a", Buffer.from("1"), "image/webp");
    await storage.put("b", Buffer.from("2"), "image/webp");
    await storage.delete("a");

    expect(storage.objects.has("a")).toBe(false);
    expect(storage.objects.has("b")).toBe(true);
  });

  it("xoá key không tồn tại không ném lỗi - dọn rác phải luôn an toàn khi chạy lại", async () => {
    await expect(storage.delete("không-có")).resolves.toBeUndefined();
  });

  it("failNextPut chỉ làm hỏng đúng một lần", async () => {
    storage.failNextPut("R2 sập");
    await expect(storage.put("a", Buffer.from("1"), "image/webp")).rejects.toThrow("R2 sập");
    expect(storage.objects.size).toBe(0);

    await expect(storage.put("a", Buffer.from("1"), "image/webp")).resolves.toMatchObject({
      key: "a",
    });
  });

  it("failNextDelete chỉ làm hỏng đúng một lần", async () => {
    await storage.put("a", Buffer.from("1"), "image/webp");
    storage.failNextDelete();
    await expect(storage.delete("a")).rejects.toThrow();
    expect(storage.objects.has("a")).toBe(true);

    await expect(storage.delete("a")).resolves.toBeUndefined();
    expect(storage.objects.has("a")).toBe(false);
  });
});
