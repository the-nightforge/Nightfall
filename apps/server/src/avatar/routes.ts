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
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_UPLOAD_BYTES, files: 1 },
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
      next(err);
      return;
    }
    next();
  });
}

/** Đổi avatar là thao tác nặng (giải mã + resize), nên khoá chặt hơn chat. */
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
