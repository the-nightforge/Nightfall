import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db";
import { sha256 } from "./util";

export interface PlayerRequest extends Request {
  player?: { id: string };
}

/**
 * Xác thực Bearer token và gắn `req.player`.
 *
 * Tách ra khỏi /players/me/matches vì giờ có nhiều hơn một endpoint cần nó, và
 * hai bản sao của cùng một đoạn kiểm token là hai chỗ để quên sửa.
 *
 * Token gốc chỉ client giữ; DB chỉ có SHA-256 của nó.
 */
export async function requirePlayer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Thiếu thông tin xác thực" });
    return;
  }

  try {
    const player = await prisma.player.findUnique({ where: { tokenHash: sha256(token) } });
    if (!player) {
      res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });
      return;
    }
    (req as PlayerRequest).player = { id: player.id };
    next();
  } catch (err) {
    console.error("[api] Xác thực thất bại:", err);
    res.status(500).json({ error: "Không thể xác thực lúc này" });
  }
}

/**
 * Như `requirePlayer` nhưng KHÔNG chặn: token thiếu hay hỏng thì đi tiếp với
 * `player` để trống. Cho những endpoint công khai muốn nói thêm một câu riêng
 * với người đã đăng nhập - bảng xếp hạng là một.
 *
 * Lỗi DB thì vẫn là 500: đó không phải "ẩn danh", đó là không trả lời được.
 */
export async function optionalPlayer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    next();
    return;
  }
  try {
    const player = await prisma.player.findUnique({ where: { tokenHash: sha256(token) } });
    if (player) (req as PlayerRequest).player = { id: player.id };
    next();
  } catch (err) {
    console.error("[api] Xác thực thất bại:", err);
    res.status(500).json({ error: "Không thể xác thực lúc này" });
  }
}
