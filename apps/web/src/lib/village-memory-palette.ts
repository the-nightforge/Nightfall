import type { VillageAccent, VillageEffect } from "./village-memory";

/**
 * Bảng màu của "Hồi ức Ngôi Làng".
 *
 * MODULE RIÊNG, và đó là cả lý do nó tồn tại. Bản đầu để bảng màu ở đầu
 * `village-memory-webgl.ts` cùng với hàm dựng cảnh, rồi
 * `VillageMemoryExperience` `import` hai hằng số từ đó cho viền thẻ. Một import
 * tĩnh là một cạnh trong đồ thị module, và bundler không cắt file làm đôi: cả
 * nghìn dòng dựng Three.js đi thẳng vào chunk của Experience - tức là vào lượt
 * tải của MỌI người bấm nút, kể cả người rơi về bản 2D vì máy không có WebGL2.
 *
 * Nên ranh giới ở đây là một ranh giới thật: file này không biết Three.js tồn
 * tại, không `import` gì ngoài kiểu, và là thứ duy nhất mà lớp React được phép
 * `import` tĩnh. `buildVillageScene` chỉ đi qua `import()` động trong
 * `VillageMemoryCanvas`.
 *
 * Đổi lại, bản dự phòng 2D và bản 3D vẫn dùng CHUNG một bảng màu, không phải
 * hai bảng phải giữ cho khớp nhau.
 */

/**
 * Sắc theo vai.
 *
 * Chỉ là lớp thứ hai của thông tin: nhà nào của ai, còn sống hay đã chết, phe
 * nào - tất cả đều có nhãn chữ trong lớp phủ DOM. Người không phân biệt được
 * đỏ với lục vẫn đọc được đủ, và đó là điều kiện để bảng màu này được phép tồn
 * tại.
 */
export const ACCENT_HEX: Record<VillageAccent, number> = {
  wolf: 0x8f1220,
  guard: 0x2f6fd0,
  seer: 0xb9a8e8,
  witch: 0x3fbf7a,
  hunter: 0xd08a3a,
  villager: 0x6b7a94,
  // Hổ phách, đứng riêng khỏi cả sắc đỏ của Sói lẫn sắc xám-lam của làng - đúng
  // sắc mà bộ bài, thẻ vai và màn kết thúc đang dùng cho phe trung lập.
  jester: 0xd9a521,
};

/** Sắc chủ đạo của từng hiệu ứng. Bản 2D dùng đúng bảng này cho viền thẻ. */
export const EFFECT_HEX: Record<VillageEffect, number> = {
  WOLF_ATTACK: 0x8f1220,
  SHIELD_SAVE: 0x4a9cf0,
  WITCH_HEAL: 0x3fbf7a,
  WITCH_POISON: 0x8a3fbf,
  SEER_BEAM: 0xd8d8f0,
  HUNTER_SHOT: 0xffcf7a,
  LYNCH: 0xc23a3a,
  TRIAL_SCALES: 0xe0c07a,
  CURSED_MOON: 0xc0403a,
  LONE_LIGHT: 0xffd98a,
  GENERIC: 0x7f92b0,
};

export const hexToCss = (hex: number) => `#${hex.toString(16).padStart(6, "0")}`;

/**
 * Màu của bản dựng cảnh.
 *
 * Cả bảng nằm trong một dải xanh đêm hẹp, và nó KHÔNG đơn sắc một cách tình cờ:
 * mái, tường và cây phải khác nhau đủ để mắt tách được ba khối chồng lên nhau
 * trong bóng tối. Bản đầu cho cả ba cùng một dải độ sáng, nên ở khung hình thật
 * chúng dính thành một mảng đen duy nhất - lỗi đó chữa bằng màu và ánh sáng,
 * không phải bằng cách kéo cả cảnh sáng lên.
 *
 * `WINDOW_LIT` là điểm ẤM DUY NHẤT của cảnh. Nó tương phản với nền lạnh chứ
 * không tranh sáng với nó, và đó là lý do một ô cửa nhỏ xíu vẫn đọc được từ xa.
 */
export const SCENE_HEX = {
  /** Nền trời, và cũng là màu sương xa - hai thứ phải bằng nhau thì rìa cảnh mới tan được. */
  sky: 0x060b16,
  /** Đất ngoài cùng, tối nhất. */
  groundOuter: 0x0c1526,
  /** Vành đất giữa, sáng hơn một nấc để cảnh có lớp. */
  groundMid: 0x122036,
  /** Quảng trường. */
  square: 0x1b2b48,
  /** Quầng sáng rất nhạt loang quanh quảng trường. */
  squareGlow: 0x2c4f86,

  wall: 0x3a4d74,
  /** Mặt khuất sáng của tường - dùng cho mặt sau và phần chân nhà. */
  wallShade: 0x22304d,
  roof: 0x202c4c,
  /** Ống khói: khối sáng nhất của nếp nhà, và là thứ phá đường mái phẳng. */
  chimney: 0x4d5f8c,
  windowLit: 0xffc46b,
  windowDark: 0x0a0f18,

  treeNear: 0x18303a,
  treeFar: 0x101f2c,
  /** Đá của điểm neo giữa quảng trường. */
  stone: 0x46536e,
  stoneShade: 0x232e46,

  moon: 0xe6ecff,
  moonHalo: 0x9fb6ee,
  /** Ánh trăng rọi xuống làng. */
  moonLight: 0xaec4f5,
  /** Viền lạnh hắt từ phía sau. */
  rimLight: 0x6f9ad6,
  /** Trời/đất của đèn bán cầu - đủ để đọc mặt bên của nhà, không hơn. */
  fillSky: 0x33507f,
  fillGround: 0x0e1524,
  ambient: 0x1d2b48,

  fog: 0x8fa8cc,
  contactShadow: 0x02040a,
  star: 0xc9d8ff,

  letterAmber: 0xf0b429,
  letterSeal: 0xb03030,
} as const;

/** Trăng bị nguyền: lõi, quầng và ánh môi trường đều ngả đỏ, có kiểm soát. */
export const CURSED_HEX = {
  moon: 0xe08a7a,
  moonHalo: 0xb8402f,
  moonLight: 0xc98878,
  rimLight: 0x9a4a44,
  ambient: 0x3a2231,
} as const;
