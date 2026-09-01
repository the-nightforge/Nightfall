import { afterEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "../src/storage/memory";
import { StorageNotConfiguredError } from "../src/storage/types";
import {
  initObjectStorage,
  objectStorage,
  resetObjectStorage,
  setObjectStorage,
} from "../src/storage";

afterEach(() => {
  resetObjectStorage();
});

describe("Sổ đăng ký object storage", () => {
  it("mặc định là chưa cấu hình", () => {
    expect(objectStorage().configured).toBe(false);
  });

  it("chưa cấu hình thì put ném StorageNotConfiguredError chứ không sập process", async () => {
    await expect(
      objectStorage().put("a", Buffer.from("1"), "image/webp"),
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });

  it("chưa cấu hình thì delete im lặng bỏ qua - dọn rác không được làm hỏng luồng gọi", async () => {
    await expect(objectStorage().delete("a")).resolves.toBeUndefined();
  });

  it("setObjectStorage đổi được adapter đang dùng", () => {
    setObjectStorage(createMemoryStorage());
    expect(objectStorage().configured).toBe(true);
  });

  it("initObjectStorage với cấu hình tắt thì giữ nguyên trạng thái chưa cấu hình", () => {
    initObjectStorage({ enabled: false });
    expect(objectStorage().configured).toBe(false);
  });

  it("initObjectStorage với cấu hình đủ thì bật adapter S3", () => {
    initObjectStorage({
      enabled: true,
      endpoint: "https://acct.r2.cloudflarestorage.com",
      region: "auto",
      bucket: "masoi-avatars",
      accessKeyId: "key",
      secretAccessKey: "secret",
      publicBaseUrl: "https://pub-abc.r2.dev",
    });
    expect(objectStorage().configured).toBe(true);
    expect(objectStorage().publicUrl("avatars/p1/a.webp")).toBe(
      "https://pub-abc.r2.dev/avatars/p1/a.webp",
    );
  });
});
