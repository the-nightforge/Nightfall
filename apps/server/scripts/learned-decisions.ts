import type { LearnedDecision, LearnedDecisions } from "@masoi/game-engine";

const FLAGS: readonly LearnedDecision[] = ["vote", "night", "final", "hunter"];

/**
 * `--learned-decisions` của mọi script: `both` (= vote+night, alias cũ) hoặc
 * CSV trong `vote,night,final,hunter`.
 *
 * Một nguồn duy nhất vì `rl_loop.py` truyền CÙNG một chuỗi cho rollout
 * (`selfplay.ts`) lẫn benchmark (`ai-benchmark.ts`); hai parser lệch nhau là
 * train một cấu hình rồi đo một cấu hình khác (spec 2026-09-17 D2).
 */
export function parseLearnedDecisions(value: string): LearnedDecisions {
  if (value === "both") return "both";
  const flags = value
    .split(",")
    .map((flag) => flag.trim())
    .filter((flag) => flag !== "");
  if (flags.length === 0) throw new Error("--learned-decisions rỗng");
  for (const flag of flags) {
    if (!(FLAGS as readonly string[]).includes(flag)) {
      throw new Error(
        `--learned-decisions cần ${FLAGS.join(" | ")} | both (cách nhau bằng dấu phẩy), nhận "${value}"`,
      );
    }
  }
  const unique = [...new Set(flags as LearnedDecision[])];
  return unique.length === 1 ? unique[0]! : unique;
}
