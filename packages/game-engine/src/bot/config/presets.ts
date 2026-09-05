import {
  BOT_WEIGHTS_V1,
  BOT_WEIGHTS_V2,
  BOT_WEIGHTS_V3,
  BOT_WEIGHTS_V4,
  BOT_WEIGHTS_V5,
  BOT_WEIGHTS_V6,
  BOT_WEIGHTS_V7,
  BOT_WEIGHTS_V8,
  BOT_WEIGHTS_V9,
  BOT_WEIGHTS_V10,
  BOT_WEIGHTS_V11,
  BOT_WEIGHTS_V12,
  BOT_WEIGHTS_V13,
  BOT_WEIGHTS_V14,
  BOT_WEIGHTS_V15,
  BOT_WEIGHTS_V16,
  DEFAULT_BOT_WEIGHTS,
  type BotWeights,
} from "./weights";

/**
 * Bảng phiên bản cấu hình.
 *
 * Mỗi entry là một điểm ĐÓNG BĂNG. `1.0.0` tái lập chính xác hành vi Phase 2 và
 * không bao giờ được sửa - nó là mốc so sánh cho mọi lần hiệu chỉnh về sau. Khi
 * một batch 300 ván nói "Sói thắng 62%", câu đó chỉ có nghĩa nếu truy được về
 * đúng bộ số đã sinh ra nó.
 */
export const BOT_WEIGHTS_PRESETS: Readonly<Record<string, BotWeights>> = Object.freeze({
  [BOT_WEIGHTS_V1.version]: BOT_WEIGHTS_V1,
  [BOT_WEIGHTS_V2.version]: BOT_WEIGHTS_V2,
  [BOT_WEIGHTS_V3.version]: BOT_WEIGHTS_V3,
  [BOT_WEIGHTS_V4.version]: BOT_WEIGHTS_V4,
  [BOT_WEIGHTS_V5.version]: BOT_WEIGHTS_V5,
  [BOT_WEIGHTS_V6.version]: BOT_WEIGHTS_V6,
  [BOT_WEIGHTS_V7.version]: BOT_WEIGHTS_V7,
  [BOT_WEIGHTS_V8.version]: BOT_WEIGHTS_V8,
  [BOT_WEIGHTS_V9.version]: BOT_WEIGHTS_V9,
  [BOT_WEIGHTS_V10.version]: BOT_WEIGHTS_V10,
  [BOT_WEIGHTS_V11.version]: BOT_WEIGHTS_V11,
  [BOT_WEIGHTS_V12.version]: BOT_WEIGHTS_V12,
  [BOT_WEIGHTS_V13.version]: BOT_WEIGHTS_V13,
  [BOT_WEIGHTS_V14.version]: BOT_WEIGHTS_V14,
  [BOT_WEIGHTS_V15.version]: BOT_WEIGHTS_V15,
  [BOT_WEIGHTS_V16.version]: BOT_WEIGHTS_V16,
});

export function weightsPreset(version: string): BotWeights {
  const preset = BOT_WEIGHTS_PRESETS[version];
  if (!preset) {
    const known = Object.keys(BOT_WEIGHTS_PRESETS).sort().join(", ");
    throw new Error(`Không có preset trọng số phiên bản "${version}". Đã biết: ${known}`);
  }
  return preset;
}

export {
  BOT_WEIGHTS_V1,
  BOT_WEIGHTS_V2,
  BOT_WEIGHTS_V3,
  BOT_WEIGHTS_V4,
  BOT_WEIGHTS_V5,
  BOT_WEIGHTS_V6,
  BOT_WEIGHTS_V7,
  BOT_WEIGHTS_V8,
  BOT_WEIGHTS_V9,
  BOT_WEIGHTS_V10,
  BOT_WEIGHTS_V11,
  BOT_WEIGHTS_V12,
  BOT_WEIGHTS_V13,
  BOT_WEIGHTS_V14,
  BOT_WEIGHTS_V15,
  BOT_WEIGHTS_V16,
  DEFAULT_BOT_WEIGHTS,
};
