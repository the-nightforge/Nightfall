import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  MAX_AVATAR_BYTES,
  avatarUploadErrorMessage,
  validateAvatarFile,
} from "./avatar-upload";

test("file hợp lệ không có lỗi", () => {
  assert.equal(validateAvatarFile({ size: 100_000, type: "image/jpeg" }), null);
  assert.equal(validateAvatarFile({ size: 100_000, type: "image/png" }), null);
  assert.equal(validateAvatarFile({ size: 100_000, type: "image/webp" }), null);
});

test("file rỗng bị chặn", () => {
  assert.match(validateAvatarFile({ size: 0, type: "image/jpeg" }) ?? "", /rỗng/);
});

test("file quá 5MB bị chặn ngay ở trình duyệt, khỏi tốn công tải lên", () => {
  const message = validateAvatarFile({ size: MAX_AVATAR_BYTES + 1, type: "image/jpeg" });
  assert.match(message ?? "", /5MB/);
});

test("GIF bị chặn", () => {
  assert.match(validateAvatarFile({ size: 1000, type: "image/gif" }) ?? "", /JPG, PNG/);
});

test("thông điệp lỗi từ server được ưu tiên vì nó cụ thể hơn", () => {
  assert.equal(
    avatarUploadErrorMessage(400, { error: "Không đọc được ảnh này, hãy thử ảnh khác" }),
    "Không đọc được ảnh này, hãy thử ảnh khác",
  );
});

test("mất mạng (status 0) có thông điệp riêng", () => {
  assert.match(avatarUploadErrorMessage(0, null), /kết nối/);
});

test("mỗi mã lỗi có câu tiếng Việt riêng", () => {
  assert.match(avatarUploadErrorMessage(401, null), /phiên/i);
  assert.match(avatarUploadErrorMessage(413, null), /5MB/);
  assert.match(avatarUploadErrorMessage(429, null), /nhanh/);
  assert.match(avatarUploadErrorMessage(503, null), /thử lại/);
});

test("mã lạ vẫn ra câu tiếng Việt kèm mã để còn báo lỗi được", () => {
  assert.match(avatarUploadErrorMessage(418, null), /418/);
});
