import {
  BOT_WEIGHTS_V1,
  BOT_WEIGHTS_V2,
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
});

export function weightsPreset(version: string): BotWeights {
  const preset = BOT_WEIGHTS_PRESETS[version];
  if (!preset) {
    const known = Object.keys(BOT_WEIGHTS_PRESETS).sort().join(", ");
    throw new Error(`Không có preset trọng số phiên bản "${version}". Đã biết: ${known}`);
  }
  return preset;
}

export { BOT_WEIGHTS_V1, BOT_WEIGHTS_V2, DEFAULT_BOT_WEIGHTS };
