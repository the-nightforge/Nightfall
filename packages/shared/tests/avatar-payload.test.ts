import { describe, expect, it } from "vitest";
import { updateAvatarPayload } from "../src/schemas";

describe("updateAvatarPayload", () => {
  it("chấp nhận null - client cũ vẫn bấm Xóa được", () => {
    expect(updateAvatarPayload.parse({ avatarUrl: null })).toEqual({ avatarUrl: null });
  });

  it("từ chối data URL - không còn đường tạo dữ liệu base64 mới", () => {
    expect(() => updateAvatarPayload.parse({ avatarUrl: "data:image/webp;base64,AAAA" })).toThrow();
  });

  it("từ chối cả URL https - ảnh chỉ đi qua endpoint upload, không qua socket", () => {
    expect(() => updateAvatarPayload.parse({ avatarUrl: "https://cdn.test/a.webp" })).toThrow();
  });
});
