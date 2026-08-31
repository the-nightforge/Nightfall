import { describe, expect, it } from "vitest";
import { resolveObjectStorageConfig } from "../src/storage/config";

const FULL: NodeJS.ProcessEnv = {
  OBJECT_STORAGE_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  OBJECT_STORAGE_REGION: "auto",
  OBJECT_STORAGE_BUCKET: "masoi-avatars",
  OBJECT_STORAGE_ACCESS_KEY_ID: "key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
  OBJECT_STORAGE_PUBLIC_BASE_URL: "https://pub-abc.r2.dev",
};

describe("resolveObjectStorageConfig", () => {
  it("không đặt biến nào thì storage tắt", () => {
    expect(resolveObjectStorageConfig({})).toEqual({ enabled: false });
  });

  it("copy .env.example (sáu khoá rỗng) cũng là tắt, không phải hỏng một nửa", () => {
    const blank: NodeJS.ProcessEnv = {
      OBJECT_STORAGE_ENDPOINT: "",
      OBJECT_STORAGE_REGION: "",
      OBJECT_STORAGE_BUCKET: "",
      OBJECT_STORAGE_ACCESS_KEY_ID: "",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "",
      OBJECT_STORAGE_PUBLIC_BASE_URL: "",
    };
    expect(resolveObjectStorageConfig(blank)).toEqual({ enabled: false });
  });

  it("đủ sáu biến thì bật", () => {
    expect(resolveObjectStorageConfig(FULL)).toEqual({
      enabled: true,
      endpoint: "https://acct.r2.cloudflarestorage.com",
      region: "auto",
      bucket: "masoi-avatars",
      accessKeyId: "key",
      secretAccessKey: "secret",
      publicBaseUrl: "https://pub-abc.r2.dev",
    });
  });

  it("thiếu public base URL thì ném lỗi thay vì âm thầm tắt", () => {
    const { OBJECT_STORAGE_PUBLIC_BASE_URL: _drop, ...rest } = FULL;
    expect(() => resolveObjectStorageConfig(rest)).toThrow(/OBJECT_STORAGE/);
  });

  it("thiếu bucket thì ném lỗi", () => {
    const { OBJECT_STORAGE_BUCKET: _drop, ...rest } = FULL;
    expect(() => resolveObjectStorageConfig(rest)).toThrow(/OBJECT_STORAGE/);
  });

  it("cắt dấu / thừa ở cuối public base URL", () => {
    const cfg = resolveObjectStorageConfig({
      ...FULL,
      OBJECT_STORAGE_PUBLIC_BASE_URL: "http://localhost:9000/masoi-avatars/",
      NODE_ENV: "development",
    });
    expect(cfg).toMatchObject({ publicBaseUrl: "http://localhost:9000/masoi-avatars" });
  });

  it("http:// chạy được ở dev (MinIO)", () => {
    const cfg = resolveObjectStorageConfig({
      ...FULL,
      OBJECT_STORAGE_ENDPOINT: "http://localhost:9000",
      OBJECT_STORAGE_PUBLIC_BASE_URL: "http://localhost:9000/masoi-avatars",
      NODE_ENV: "development",
    });
    expect(cfg.enabled).toBe(true);
  });

  it("http:// bị chặn ở production - avatarUrl phải là HTTPS", () => {
    expect(() =>
      resolveObjectStorageConfig({
        ...FULL,
        OBJECT_STORAGE_PUBLIC_BASE_URL: "http://cdn.example.com",
        NODE_ENV: "production",
      }),
    ).toThrow(/HTTPS/);
  });

  it("URL rác bị chặn ngay lúc khởi động", () => {
    expect(() =>
      resolveObjectStorageConfig({ ...FULL, OBJECT_STORAGE_ENDPOINT: "không-phải-url" }),
    ).toThrow(/OBJECT_STORAGE_ENDPOINT/);
  });
});
