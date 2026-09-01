import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { requirePlayer, type PlayerRequest } from "../auth";
import { allowAction } from "../rate-limit";
import { AvatarError } from "./errors";
import { MAX_AVATAR_UPLOAD_BYTES, clearAvatar, setAvatar } from "./service";

export const avatarRouter = Router();

/**
 * memoryStorage: ảnh chỉ sống trong RAM đủ lâu để sharp xử lý rồi đi thẳng lên
 * bucket - không có file tạm nào trên đĩa Render để mà quên dọn.
 *
 * Trần 5MB đặt ngay ở tầng parser: multer ngắt luồng khi vượt, nên một request
 * 500MB không bao giờ được cấp phát đủ bộ nhớ để trở thành vấn đề.
 *
 * fileSize/files chỉ khoá PHẦN FILE. Busboy - thứ multer dùng bên dưới - mặc
 * định fields và parts là Infinity, còn fieldSize là 1MB: một request với 500
 * field văn bản 1MB mỗi field vẫn bị multer gom hết vào req.body, không đụng
 * tới fileSize ở trên. Endpoint này chỉ cần Bearer token hợp lệ (mint được từ
 * POST /api/players đang mở), nên một request như vậy đủ sức OOM cả server -
 * fields: 0 buộc busboy ném fieldsLimit ngay ở field văn bản đầu tiên (client
 * hợp lệ chỉ gửi đúng phần file, không gửi field nào khác), còn parts: 2 chặn
 * luôn ở tầng part bất kể loại part là gì.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_UPLOAD_BYTES, files: 1, fields: 0, parts: 2 },
});

function uploadSingleFile(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "Ảnh quá lớn, tối đa 5MB" });
        return;
      }
      res.status(400).json({ error: "Không đọc được file tải lên" });
      return;
    }
    if (err) {
      // KHÔNG next(err) ở đây: request multipart do client tự tay ghép có thể
      // khiến Busboy ném lỗi đồng bộ ngay từ hàm dựng (thiếu boundary trong
      // Content-Type - một header là đủ, không cần body) hoặc giữa chừng đọc
      // luồng (form cắt cụt, request bị huỷ). Không có error middleware nào
      // bọc /api trước những request này (đây chính là tầng phân tích
      // multipart), nên next(err) rơi thẳng vào finalhandler mặc định của
      // Express: trả nguyên err.stack khi NODE_ENV !== production, hoặc HTML
      // "Internal Server Error" khi production - cả hai đều không phải
      // { error: "..." } tiếng Việt, và endpoint này không yêu cầu người gọi
      // phải hợp phòng để kích hoạt (chỉ cần Bearer token hợp lệ).
      console.error("[api] Đọc multipart thất bại:", err);
      res.status(400).json({ error: "Không đọc được file tải lên" });
      return;
    }
    next();
  });
}

/**
 * Đổi avatar là thao tác nặng (giải mã + resize), nên khoá chặt hơn chat.
 *
 * PUT và DELETE dùng chung một rổ `avatar:${playerId}` - cố ý: cả hai đều đi
 * qua compare-and-swap và đụng object storage, nên 5 lượt xoá cũng tiêu hết
 * hạn mức của 5 lượt tải lên kế tiếp, không phải hai quota tách biệt.
 */
function rateLimitAvatar(req: Request, res: Response, next: NextFunction): void {
  const playerId = (req as PlayerRequest).player!.id;
  if (!allowAction(`avatar:${playerId}`, 5, 60_000)) {
    res.status(429).json({ error: "Bạn đổi ảnh quá nhanh, chờ một chút rồi thử lại" });
    return;
  }
  next();
}

function fail(res: Response, err: unknown, fallback: string): void {
  if (err instanceof AvatarError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("[api] Thao tác avatar thất bại:", err);
  res.status(500).json({ error: fallback });
}

avatarRouter.put(
  "/players/me/avatar",
  requirePlayer,
  rateLimitAvatar,
  uploadSingleFile,
  async (req, res) => {
    // req.file có kiểu nhờ @types/multer bổ sung vào Express.Request.
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Thiếu file ảnh" });
      return;
    }

    try {
      const { avatarUrl } = await setAvatar((req as PlayerRequest).player!.id, file.buffer);
      res.json({ avatarUrl });
    } catch (err) {
      fail(res, err, "Không đổi được ảnh đại diện lúc này");
    }
  },
);

avatarRouter.delete("/players/me/avatar", requirePlayer, rateLimitAvatar, async (req, res) => {
  try {
    await clearAvatar((req as PlayerRequest).player!.id);
    res.status(204).end();
  } catch (err) {
    fail(res, err, "Không xoá được ảnh đại diện lúc này");
  }
});
