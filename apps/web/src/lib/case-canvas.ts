import type { MatchOutcome } from "@masoi/shared";
import type { CaseCardModel } from "./case-card";

/** Tỷ lệ 9:16, khớp khung ảnh dọc của mọi ứng dụng nhắn tin trên điện thoại. */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;

export interface CardFonts {
  display: string;
  sans: string;
}

/**
 * Bảng màu lấy nguyên từ `tailwind.config.ts`.
 *
 * Chép giá trị vào đây là có chủ đích: canvas không đọc được class Tailwind, và
 * một giá trị hằng đọc được vẫn hơn là rút màu ra khỏi DOM lúc chạy.
 */
const COLORS = {
  night950: "#070b14",
  night900: "#0b1120",
  night800: "#111a2e",
  night700: "#1a2743",
  mist: "#9db2d5",
  blood500: "#dc2640",
  blood400: "#f04760",
  emerald: "#34b28c",
  emeraldLight: "#6ee7b7",
  white: "#ffffff",
} as const;

const PADDING = 84;
const CONTENT_WIDTH = CARD_WIDTH - PADDING * 2;

/**
 * Ngắt dòng theo từ.
 *
 * Một "từ" dài hơn cả dòng (biệt danh viết liền, chuỗi lặp) vẫn phải xuống dòng
 * chứ không được tràn ra khỏi thẻ, nên có nhánh cắt cứng theo ký tự. Nhánh đó
 * cũng là thứ giữ cho vòng lặp luôn tiến - không có nó thì một từ quá dài làm
 * hàm chạy mãi không hết.
 */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";

  const hardWrap = (word: string): void => {
    let chunk = "";
    for (const char of Array.from(word)) {
      if (chunk && ctx.measureText(chunk + char).width > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(candidate).width <= maxWidth) {
      if (ctx.measureText(word).width > maxWidth && !current) {
        hardWrap(word);
        continue;
      }
      current = candidate;
      continue;
    }
    lines.push(current);
    if (ctx.measureText(word).width > maxWidth) {
      hardWrap(word);
    } else {
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

/**
 * Quầng sáng theo KẾT CỤC, bốn nhánh.
 *
 * Bản cũ là một biểu thức ba ngôi trên `winner === "wolves"`, nên mọi ván không
 * phải Sói thắng - kể cả ván Sát Nhân thắng và ván hoà - đều được tô sắc lục
 * của phe Dân Làng lên đúng tấm ảnh đem đi khoe.
 */
const CARD_GLOW: Record<MatchOutcome, string> = {
  wolves: "rgba(220, 38, 64, 0.30)",
  village: "rgba(52, 178, 140, 0.26)",
  serial_killer: "rgba(217, 165, 33, 0.28)",
  draw: "rgba(148, 163, 184, 0.20)",
};

/** Sắc chữ tiêu đề, cùng bốn nhánh và cùng lý do với `CARD_GLOW`. */
const CARD_ACCENT: Record<MatchOutcome, string> = {
  wolves: COLORS.blood400,
  village: COLORS.emeraldLight,
  serial_killer: "#fcd34d",
  draw: COLORS.mist,
};

function paintBackground(ctx: CanvasRenderingContext2D, winner: MatchOutcome): void {
  const base = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
  base.addColorStop(0, COLORS.night950);
  base.addColorStop(0.55, COLORS.night900);
  base.addColorStop(1, COLORS.night950);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Quầng sáng theo phe thắng, đúng thủ pháp mà GameOverView đang dùng trên web.
  const glow = ctx.createRadialGradient(CARD_WIDTH / 2, 340, 0, CARD_WIDTH / 2, 340, 900);
  glow.addColorStop(0, CARD_GLOW[winner]);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_WIDTH, 1200);
}

/** Vẽ thẻ hồ sơ 1080×1920. Chỉ được vẽ những gì đã có trong `model`. */
export function paintCaseCard(
  ctx: CanvasRenderingContext2D,
  model: CaseCardModel,
  fonts: CardFonts,
): void {
  const accent = CARD_ACCENT[model.winner];

  paintBackground(ctx, model.winner);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";

  ctx.fillStyle = COLORS.mist;
  ctx.font = `600 34px ${fonts.sans}`;
  ctx.fillText("HỒ SƠ VỤ ÁN", CARD_WIDTH / 2, 200);

  ctx.fillStyle = accent;
  ctx.font = `700 44px ${fonts.sans}`;
  ctx.fillText(model.caseId, CARD_WIDTH / 2, 262);

  ctx.fillStyle = COLORS.white;
  ctx.font = `800 96px ${fonts.display}`;
  ctx.fillText(model.headline, CARD_WIDTH / 2, 400);

  ctx.fillStyle = COLORS.mist;
  ctx.font = `500 40px ${fonts.sans}`;
  ctx.fillText(model.subline, CARD_WIDTH / 2, 464);

  ctx.fillStyle = accent;
  ctx.fillRect(CARD_WIDTH / 2 - 90, 512, 180, 3);

  // ---- Điểm ngoặt ----
  ctx.textAlign = "left";
  let y = 620;

  for (const line of model.lines) {
    ctx.fillStyle = accent;
    ctx.font = `700 32px ${fonts.sans}`;
    ctx.fillText(line.moment.toUpperCase(), PADDING, y);

    ctx.fillStyle = COLORS.white;
    ctx.font = `700 46px ${fonts.display}`;
    ctx.fillText(line.title, PADDING, y + 58);

    ctx.fillStyle = COLORS.mist;
    ctx.font = `400 34px ${fonts.sans}`;
    let textY = y + 112;
    for (const wrapped of wrapText(ctx, line.text, CONTENT_WIDTH)) {
      ctx.fillText(wrapped, PADDING, textY);
      textY += 46;
    }

    y = textY + 44;
    ctx.fillStyle = COLORS.night700;
    ctx.fillRect(PADDING, y - 26, CONTENT_WIDTH, 2);
  }

  // ---- Chân thẻ ----
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.night800;
  ctx.fillRect(0, CARD_HEIGHT - 230, CARD_WIDTH, 230);

  ctx.fillStyle = COLORS.white;
  ctx.font = `700 46px ${fonts.display}`;
  ctx.fillText(model.cta, CARD_WIDTH / 2, CARD_HEIGHT - 140);

  ctx.fillStyle = COLORS.mist;
  ctx.font = `400 34px ${fonts.sans}`;
  ctx.fillText(model.url, CARD_WIDTH / 2, CARD_HEIGHT - 82);
}
