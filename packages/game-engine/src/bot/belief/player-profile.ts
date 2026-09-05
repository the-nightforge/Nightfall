import type { BotBrainState, PlayerProfile } from "../types";

/**
 * Hồ sơ TRONG VÁN về từng người chơi: người này hay khai láo không, hay tố
 * người khác không, phán đoán có đúng không.
 *
 * Đây là phần "nhớ người" mà bot thiếu: belief nhớ SỰ KIỆN (ai làm gì ở vòng
 * mấy) và nguội nhanh, còn hồ sơ nhớ NGƯỜI và nguội chậm. Một người bị bắt
 * quả tang khai láo ở vòng 2 vẫn là một người từng khai láo ở vòng 6, kể cả
 * khi mọi bằng chứng của vòng 2 đã phai.
 *
 * Ba tính chất bắt buộc:
 *
 * 1. Khởi tạo TRUNG TÍNH, cập nhật TẤT ĐỊNH từ những gì bot đã thấy - không
 *    rút RNG, không đọc đồng hồ. Replay cùng seed ra cùng hồ sơ.
 * 2. Chỉ sống trong ván. Hồ sơ qua nhiều ván là việc của server (ngoài engine)
 *    và không được nhét vào replay seed.
 * 3. Mỗi quan sát là một MẪU, và sức nặng của cả hồ sơ là `samples /
 *    (samples + prior)`: một lần bắt quả tang chưa thành định kiến, ba lần
 *    thì có.
 *
 * `samples` là TỔNG số quan sát trên mọi trục, và mỗi tỉ lệ cập nhật với bước
 * `1 / (samples + 1)`. Nó không phải tần suất chính xác của riêng trục đó, và
 * đó là chủ ý: một người đã được quan sát nhiều thì mọi tỉ lệ về họ đều cứng
 * hơn, dù bằng chứng đến từ trục nào. Mẫu cũ nguội dần (xem `decayProfiles`)
 * nên quan sát mới kéo tỉ lệ nhanh hơn quan sát cũ từng kéo.
 */

export const NEUTRAL_PROFILE: Readonly<Pick<PlayerProfile, "bluffRate" | "aggroRate" | "accuracy">> =
  Object.freeze({ bluffRate: 0, aggroRate: 0, accuracy: 0.5 });

export function neutralProfile(): PlayerProfile {
  return { ...NEUTRAL_PROFILE, samples: 0, lastUpdatedRound: 0 };
}

/** Hồ sơ của một người, tạo mới trung tính nếu chưa có (roster đổi giữa ván). */
export function profileFor(state: BotBrainState, playerId: string): PlayerProfile {
  const existing = state.profiles[playerId];
  if (existing) return existing;
  const created = neutralProfile();
  state.profiles[playerId] = created;
  return created;
}

export type ProfileSignal = "bluff" | "aggro" | "accuracy";

const FIELD: Record<ProfileSignal, "bluffRate" | "aggroRate" | "accuracy"> = {
  bluff: "bluffRate",
  aggro: "aggroRate",
  accuracy: "accuracy",
};

/**
 * Ghi một mẫu `0..1` vào một trục của hồ sơ.
 *
 * Bước `1 / (samples + 1)`: với hồ sơ trắng, mẫu đầu tiên đặt tỉ lệ ĐÚNG BẰNG
 * mẫu đó (một lần khai láo -> bluffRate 1), và `profileStrength` là thứ giữ
 * cho một mẫu đơn lẻ không thành định kiến.
 *
 * Bot không lập hồ sơ về chính mình, cùng lý do `applyEvidence` bỏ qua self.
 */
export function observeProfile(
  state: BotBrainState,
  playerId: string,
  signal: ProfileSignal,
  sample: number,
  round: number,
): void {
  if (playerId === state.playerId) return;
  const profile = profileFor(state, playerId);
  const field = FIELD[signal];
  const clamped = Math.min(1, Math.max(0, sample));
  profile[field] = (profile[field] * profile.samples + clamped) / (profile.samples + 1);
  profile.samples += 1;
  profile.lastUpdatedRound = round;
}

/**
 * Làm nguội mọi hồ sơ không được củng cố kể từ `lastUpdatedRound`.
 *
 * Cả sức nặng (`samples`) lẫn tỉ lệ (kéo về trung tính) cùng nguội theo
 * `rate ** age`. Ghi lại mốc để lần gọi sau không nhân tiếp phần vừa nhân -
 * cùng lý do với `decayEntry` ở `belief-state.ts`: `observe()` chạy nhiều lần
 * một vòng, và số vòng bot "quên" một người không được phụ thuộc vào việc
 * scheduler gọi mấy lần.
 */
export function decayProfiles(state: BotBrainState, round: number, rate: number): void {
  for (const profile of Object.values(state.profiles)) {
    const age = Math.max(0, round - profile.lastUpdatedRound);
    if (age === 0) continue;
    const factor = rate ** age;
    profile.samples *= factor;
    profile.bluffRate = NEUTRAL_PROFILE.bluffRate + (profile.bluffRate - NEUTRAL_PROFILE.bluffRate) * factor;
    profile.aggroRate = NEUTRAL_PROFILE.aggroRate + (profile.aggroRate - NEUTRAL_PROFILE.aggroRate) * factor;
    profile.accuracy = NEUTRAL_PROFILE.accuracy + (profile.accuracy - NEUTRAL_PROFILE.accuracy) * factor;
    profile.lastUpdatedRound = round;
  }
}
