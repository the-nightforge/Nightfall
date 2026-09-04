import { AVATAR_IDS, type AvatarId } from "./avatar-art";

/**
 * Bảng tra sprite sheet chân dung.
 *
 * Mỗi nhân vật là MỘT file bốn frame nằm ngang, không phải bốn file. Đây đúng
 * là lập luận đã viết trong `avatar-art.ts`: một phòng hiển thị tới 15 ô, tách
 * file là 15 lượt round-trip trên 4G. Phòng đầy = 15 request thay vì 60.
 *
 * Nguồn art và cách dựng lại nằm ở `public/characters/SOURCES.md`.
 */

/** Thứ tự frame trong sheet, trái sang phải. Đổi thứ tự là đổi luôn CSS. */
export const PORTRAIT_FRAMES = ["idle", "blink", "talk", "dead"] as const;

export type PortraitFrame = (typeof PORTRAIT_FRAMES)[number];

export const PORTRAIT_FRAME_COUNT = PORTRAIT_FRAMES.length;

export interface CharacterSheet {
  /** Đường dẫn từ gốc `public/`. */
  src: string;
  /**
   * Frame `blink` và `talk` có KHÁC frame `idle` thật không.
   *
   * Bộ art hiện tại là pack chân dung tĩnh, không có biến thể biểu cảm, nên
   * frame 1 và 2 là bản sao của frame 0 - đo được lệch trung bình 0.7-1.5 trên
   * 255, tức đúng bằng nhiễu nén WebP. Chạy animation để đổi sang một bức ảnh
   * y hệt là đốt pin của mười lăm ô đổi lấy con số không, nên CSS chỉ bật
   * animation khi cờ này bật.
   *
   * Ngày nào có sheet biến thể thật thì đổi `false` thành `true` ở đúng dòng
   * đó - nháy mắt và mấp máy tự sống dậy, không đụng một dòng code nào.
   */
  variants: boolean;
}

export const CHARACTER_SHEETS: Partial<Record<AvatarId, CharacterSheet>> = {
  farmer: { src: "/characters/farmer.webp", variants: false },
  cook: { src: "/characters/cook.webp", variants: false },
  blacksmith: { src: "/characters/blacksmith.webp", variants: false },
  miner: { src: "/characters/miner.webp", variants: false },
  monk: { src: "/characters/monk.webp", variants: false },
  mustache: { src: "/characters/mustache.webp", variants: false },
  jester: { src: "/characters/jester.webp", variants: false },
  ranger: { src: "/characters/ranger.webp", variants: false },
  captain: { src: "/characters/captain.webp", variants: false },
  viking: { src: "/characters/viking.webp", variants: false },
  pilgrim: { src: "/characters/pilgrim.webp", variants: false },
  turban: { src: "/characters/turban.webp", variants: false },
  sombrero: { src: "/characters/sombrero.webp", variants: false },
  cowled: { src: "/characters/cowled.webp", variants: false },
  hood: { src: "/characters/hood.webp", variants: false },
  beard: { src: "/characters/beard.webp", variants: false },
};

const IDS: ReadonlySet<string> = new Set(AVATAR_IDS);

/**
 * Sheet của một nhân vật, hoặc null nếu chưa có.
 *
 * Nhận `string` chứ không nhận `AvatarId` vì nơi gọi có thể đang cầm một URL
 * ảnh người chơi tự tải lên - xem `Avatar.tsx`, cùng một trường mang hai loại
 * giá trị. Chuỗi không phải AvatarId thì trả null, không ném.
 */
export function sheetFor(avatar: string): CharacterSheet | null {
  if (!IDS.has(avatar)) return null;
  return CHARACTER_SHEETS[avatar as AvatarId] ?? null;
}

export function hasSheet(avatar: string): boolean {
  return sheetFor(avatar) !== null;
}

/** Có đáng chạy animation cho nhân vật này không. */
export function hasVariants(avatar: string): boolean {
  return sheetFor(avatar)?.variants === true;
}
