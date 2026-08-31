import crypto from "crypto";
import { prisma } from "../db";
import { applyAvatarToRoom } from "../rooms/apply-avatar";
import { objectStorage } from "../storage";
import type { StoredObject } from "../storage/types";
import { AvatarError } from "./errors";
import { AvatarImageError, processAvatar, sniffImageType } from "./image";

export const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Số lượt thử compare-and-swap trước khi bỏ cuộc. */
const SWAP_ATTEMPTS = 3;

/**
 * Khoá object: ngẫu nhiên 16 byte, không lấy gì từ tên file người dùng gửi lên.
 *
 * playerId nằm trong đường dẫn chỉ để soi bucket cho dễ. Nó KHÔNG tham gia phân
 * quyền - phân quyền hoàn toàn đến từ cột avatarKey trong DB, nên kể cả khi ai
 * đó đoán đúng đường dẫn của người khác cũng không có API nào nhận vào.
 */
export function avatarObjectKey(playerId: string): string {
  return `avatars/${playerId}/${crypto.randomBytes(16).toString("hex")}.webp`;
}

/**
 * Đổi avatar trong DB bằng compare-and-swap, rồi dọn object cũ.
 *
 * CAS chứ không phải đọc-rồi-ghi: hai upload đồng thời của cùng một người sẽ
 * cùng đọc avatarKey cũ là A, cùng xoá A, và để lại MỘT OBJECT MỒ CÔI vĩnh viễn
 * trong bucket. Với CAS, kẻ thua thấy count === 0, đọc lại khoá hiện tại rồi
 * thử lại, và object thua cuộc do chính nó dọn.
 *
 * KHÔNG dùng withPlayerRoomLock: đó là khoá trong tiến trình nên nó sai ngay
 * khi Render chạy nhiều instance, và nó sẽ nối hàng thao tác avatar phía sau
 * thao tác vào/ra phòng.
 *
 * Xoá object cũ luôn bọc catch: object mồ côi là rác đáng tiếc, còn ném lỗi ở
 * bước này là báo thất bại cho một thao tác đã thành công.
 */
async function swapAvatar(playerId: string, next: StoredObject | null): Promise<void> {
  for (let attempt = 0; attempt < SWAP_ATTEMPTS; attempt++) {
    const current = await prisma.player.findUnique({
      where: { id: playerId },
      select: { avatarKey: true },
    });
    if (!current) throw new AvatarError("Phiên đăng nhập không hợp lệ", 401);

    // Chốt giá trị cũ vào biến local NGAY tại đây, trước khi updateMany chạy.
    // current vẫn còn là tham chiếu tới cùng một row trong DB (thật hay giả
    // lập), nên đọc current.avatarKey SAU updateMany có thể đã thấy giá trị
    // MỚI nếu row bị cập nhật tại chỗ thay vì trả bản sao - lúc đó điều kiện
    // "khác khoá mới" luôn sai và object cũ không bao giờ bị dọn.
    const previousKey = current.avatarKey;

    const { count } = await prisma.player.updateMany({
      where: { id: playerId, avatarKey: previousKey },
      data: { avatarUrl: next?.url ?? null, avatarKey: next?.key ?? null },
    });

    if (count === 1) {
      if (previousKey && previousKey !== next?.key) {
        // try/catch, KHÔNG phải .catch(): nếu delete() ném ĐỒNG BỘ (không kịp
        // trả về promise) thì .catch() không bắt được gì, và lỗi đó thoát
        // khỏi swapAvatar SAU KHI dòng DB đã commit - rơi vào catch của
        // storeAvatar rồi xoá nhầm object mà DB vừa mới trỏ tới. Cả hai
        // adapter hiện có đều async, nhưng lời hứa ở đầu hàm này - dọn KHÔNG
        // được phép báo lỗi cho một thao tác đã thành công - phải đúng vô
        // điều kiện, không phụ thuộc adapter nào đang chạy.
        try {
          await objectStorage().delete(previousKey);
        } catch (err) {
          console.error("[avatar] Không dọn được object cũ:", err);
        }
      }
      return;
    }
  }

  throw new AvatarError("Ảnh đại diện vừa được đổi ở nơi khác, thử lại giúp nhé", 409);
}

/**
 * Kiểm, xử lý, upload và ghi DB. KHÔNG phát lại snapshot - phần đó nằm ở
 * setAvatar, để việc di trú data URL cũ (chạy ngay trước khi dựng RoomMember)
 * dùng lại được hàm này mà không phát một snapshot thừa.
 */
export async function storeAvatar(playerId: string, file: Buffer): Promise<string> {
  const storage = objectStorage();
  if (!storage.configured) {
    throw new AvatarError("Máy chủ chưa bật tính năng ảnh đại diện", 503);
  }

  if (file.length > MAX_AVATAR_UPLOAD_BYTES) {
    throw new AvatarError("Ảnh quá lớn, tối đa 5MB", 413);
  }
  if (!sniffImageType(file)) {
    throw new AvatarError("Chỉ chấp nhận ảnh JPG, PNG hoặc WebP", 400);
  }

  let processed: { data: Buffer };
  try {
    processed = await processAvatar(file);
  } catch (err) {
    // image.ts biết chính xác lý do (sai định dạng, ảnh quá lớn, buffer hỏng,
    // hay hết thang chất lượng) và đã đóng gói thành câu tiếng Việt cụ thể
    // trong AvatarImageError - đẩy nguyên câu đó lên chứ không gộp chung, vì
    // "ảnh 9000x9000 bị từ chối" và "file rác" cần lời khuyên khác nhau cho
    // người upload. Lỗi thô khác (không phải AvatarImageError) mới bị gộp lại,
    // vì đó là lỗi image.ts không lường trước và không nên rò ra ngoài.
    // image.ts cố ý không tự log, nên tầng này phải log thay.
    console.error("[avatar] Xử lý ảnh thất bại:", err);
    throw new AvatarError(
      err instanceof AvatarImageError ? err.message : "Không đọc được ảnh này, hãy thử ảnh khác",
      400,
    );
  }

  const key = avatarObjectKey(playerId);
  let stored: StoredObject;
  try {
    stored = await storage.put(key, processed.data, "image/webp");
  } catch (err) {
    console.error("[avatar] Upload lên object storage thất bại:", err);
    // put() ném không có nghĩa là object CHẮC CHẮN chưa lên bucket: với S3,
    // lỗi có thể chỉ nằm trên đường về (timeout đọc response) sau khi server
    // đã nhận xong request - dọn best-effort ở đây để không mồ côi vĩnh viễn
    // trong trường hợp đó. Sinh key TRƯỚC khi gọi put() (thay vì lấy từ giá
    // trị trả về) chính là điều cho phép làm việc này: put() thất bại thì
    // không có StoredObject nào để lấy .key từ đó.
    try {
      await storage.delete(key);
    } catch (cleanupErr) {
      console.error("[avatar] Không dọn được object upload lỗi:", cleanupErr);
    }
    throw new AvatarError("Không lưu được ảnh lúc này, thử lại sau ít phút", 503);
  }

  try {
    await swapAvatar(playerId, stored);
  } catch (err) {
    // Ghi DB hỏng thì object vừa lên là rác - dọn ngay. Thứ tự upload-trước,
    // ghi-DB-sau chính là thứ giữ cho avatar CŨ còn nguyên ở nhánh này.
    await storage
      .delete(stored.key)
      .catch((cleanupErr) => console.error("[avatar] Không dọn được object mới:", cleanupErr));
    throw err;
  }

  return stored.url;
}

export async function setAvatar(playerId: string, file: Buffer): Promise<{ avatarUrl: string }> {
  const avatarUrl = await storeAvatar(playerId, file);
  // DB và bucket đã cập nhật xong ở đây - phát lại snapshot chỉ để phòng khác
  // NHÌN THẤY avatar mới ngay, không phải điều kiện để coi upload là thành
  // công. Để nó ném thẳng ra thì client thấy lỗi cho một thao tác đã thành
  // công, rồi thử lại và tạo thêm một object thừa - bọc catch + log, cùng
  // hình dạng với việc dọn object cũ trong swapAvatar.
  await applyAvatarToRoom(playerId, avatarUrl).catch((err) =>
    console.error("[avatar] Phát lại snapshot phòng thất bại:", err),
  );
  return { avatarUrl };
}

/**
 * Xoá avatar. Chạy được cả khi storage chưa cấu hình: dọn object là việc
 * tốt-nếu-có, còn "avatar đã bị gỡ" là chuyện của DB. Ở môi trường dev chưa cấu
 * hình storage, người chơi vẫn phải gỡ được ảnh của mình.
 */
export async function clearAvatar(playerId: string): Promise<void> {
  await swapAvatar(playerId, null);
  await applyAvatarToRoom(playerId, null);
}
