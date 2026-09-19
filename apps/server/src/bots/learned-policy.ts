import { readFileSync } from "node:fs";
import {
  loadMlpPolicy,
  type BotRuntimeOptions,
  type LearnedDecisions,
  type LearnedPolicy,
} from "@masoi/game-engine";
import { config, DEFAULT_BOT_POLICY_TEMPERATURE } from "../config";

/**
 * Cầu nối giữa file weights huấn luyện (PPO) và bot production.
 *
 * Cấu hình nằm ở MỘT biến môi trường `BOT_POLICY_FILE`: không đặt là heuristic
 * thuần như mọi khi, đặt là CẢ BÀN (làng lẫn sói) dùng policy cho phiếu, hành
 * động đêm, phiên toà và phát bắn Thợ Săn. village-ppo-0001 (spec 2026-09-17) so
 * với village-bc-0002, cả bàn, bốn lượt: làng +4.0, sói +15.3 điểm. Rollout lẫn rollback đều
 * là việc của env, không phải của code.
 *
 * File đặt mà KHÔNG đọc được, KHÔNG phải JSON, hoặc LỆCH schema encoder thì
 * `resolveBotPolicy` ném ngay: gọi lúc boot, server không kịp lên là biết -
 * cùng kỷ luật với `resolveVoiceConfig`. Rơi im lặng về heuristic là cái bẫy
 * kinh điển ở đây: benchmark +3.44 biến mất mà không một dòng log nào than.
 */
export function resolveBotPolicy(
  path: string | null | undefined,
  temperature: number = DEFAULT_BOT_POLICY_TEMPERATURE,
): ResolvedBotPolicy {
  if (!path) return { enabled: false };

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(
      `BOT_POLICY_FILE="${path}" không đọc được: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `BOT_POLICY_FILE="${path}" không phải JSON hợp lệ: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // `loadMlpPolicy` so featureNames/actionNames/obsSize với encoder hiện hành:
  // model huấn luyện trên một phiên bản quan sát khác sẽ bị từ chối ở cửa này
  // thay vì ra quyết định ngu ngơ giữa ván.
  const policy = loadMlpPolicy(json);
  return { enabled: true, policy, modelId: policy.id, seats: "all", temperature };
}

/** Ghế nào được giao policy. Production dùng "all"; "village" giữ cho rollback bằng code. */
export type BotPolicySeats = "all" | "village";

export type ResolvedBotPolicy =
  | { enabled: false }
  | {
      enabled: true;
      policy: LearnedPolicy;
      modelId: string;
      seats: BotPolicySeats;
      /** Nhiệt độ lấy mẫu; 0 = argmax. Xem `BOT_POLICY_TEMPERATURE`. */
      temperature: number;
    };

/**
 * Nạp policy từ `config` đúng một lần. `session-registry` dựng runtime cho từng
 * BOT riêng lẻ và có thể được gọi lúc boot lẫn giữa chừng (restore); cache ở
 * đây cho mọi đường dùng chung một đối tượng, và boot `index.ts` gọi sớm để
 * file hỏng nổ ngay lúc khởi động.
 */
let cached: ResolvedBotPolicy | null = null;

export function botPolicy(): ResolvedBotPolicy {
  if (cached === null) cached = resolveBotPolicy(config.botPolicyFile, config.botPolicyTemperature);
  return cached;
}

/**
 * Object để spread vào constructor `BotRuntime` cho ghế ĐƯỢC giao policy.
 * Ghế không thuộc phe thì `BotSession` spread object rỗng - `BotRuntime`
 * không có `learnedPolicy` là đường heuristic hiện hành, byte một, và đó
 * chính là phía đối chứng của benchmark.
 */
export function learnedRuntimeOptions(
  resolved: ResolvedBotPolicy,
): Partial<BotRuntimeOptions> {
  if (!resolved.enabled) return {};
  return {
    learnedPolicy: resolved.policy,
    // > 0 = lấy mẫu từ softmax (dự án con C: bot bớt tất định); 0 = argmax.
    // RNG là RNG có seed của từng bot, nên ván vẫn replay được.
    learnedTemperature: resolved.temperature,
    // Mọi lượt có nhãn trong dataset: phiếu, đêm, phiên toà, phát bắn.
    learnedDecisions: ["vote", "night", "final", "hunter"] satisfies LearnedDecisions,
  };
}

/**
 * Ghế này có được policy không? `isWolf` chưa biết (`undefined` - session tạo
 * ở sảnh chờ, hoặc ảnh chụp cũ trước khi lưu phe) thì KHÔNG giao: rủi ro duy
 * nhất là bot đó chơi heuristic, an toàn hơn chết người giao nhầm sói dùng
 * model phe làng. seats=village chỉ giao khi BIẾT chắc ghế không thuộc bầy
 * sói (`isWolf === false`).
 */
export function policyAppliesToSeat(
  resolved: ResolvedBotPolicy,
  isWolf: boolean | undefined,
): boolean {
  if (!resolved.enabled) return false;
  if (resolved.seats === "village") return isWolf === false;
  return true;
}
