import type { BotDecisionTrace } from "./trace";
import { sumTerms } from "./trace";

/**
 * Định dạng trên đĩa của trace: một dòng JSON = một `BotDecisionTrace`.
 *
 * Không có dòng tiêu đề và không có phong bì phiên bản. Đó là chủ ý: mọi công
 * cụ đọc file này - `trace-view`, một lệnh `jq`, hay một ô notebook viết vội -
 * đều chỉ cần biết đúng một luật, và luật đó là "parse từng dòng ra một trace".
 * Thứ duy nhất một dòng KHÔNG mang theo là seed của ván, và seed sống ở TÊN
 * FILE, vì seed là thứ dùng để chạy lại ván chứ không phải để đọc một quyết
 * định.
 *
 * Module này thuần: không `fs`, không `process`. Việc mở file là của
 * `apps/server/scripts`.
 *
 * MỘT chỗ chuyến đi qua đĩa KHÔNG khứ hồi nguyên vẹn: `-0` đọc lại thành `0`.
 * `JSON.stringify(-0)` cho `"0"`, và không có cách nào diễn đạt `-0` trong
 * JSON. Bảng điểm sinh ra `-0` khá thường xuyên (một số hạng âm nhân với 0).
 * Vô hại theo IEEE-754 - `-0 === 0`, và `sumTerms` bắt đầu từ `0` nên tổng
 * không đổi - nhưng nó là lý do một khẳng định `toEqual` trần trên cặp
 * trước/sau sẽ đỏ, và test ghi rõ điều đó thay vì làm tròn nó đi.
 */

/**
 * Một trace thành một dòng.
 *
 * `JSON.stringify` giữ nguyên thứ tự chèn khoá, và `beliefBefore`/`beliefAfter`
 * đã được `BotRuntime.snapshotBelief` dựng theo id đã sắp xếp, nên cùng một
 * trace luôn cho ra cùng một chuỗi byte. Đó là điều kiện để `git diff` trên một
 * file fixture nói đúng thứ đã đổi thay vì nhấp nháy theo thứ tự khoá.
 */
export function serializeTrace(trace: BotDecisionTrace): string {
  return JSON.stringify(trace);
}

export function serializeTraces(traces: readonly BotDecisionTrace[]): string {
  // Kết thúc bằng `\n`: một file JSONL thiếu newline cuối làm `wc -l` đếm thiếu
  // một dòng và làm mọi lệnh nối file sinh ra một dòng hỏng.
  return traces.map(serializeTrace).join("\n") + (traces.length > 0 ? "\n" : "");
}

/** Ném kèm số dòng: một file nghìn dòng mà báo lỗi không có vị trí là vô dụng. */
export function parseTraceLine(line: string, lineNumber: number): BotDecisionTrace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`dòng ${lineNumber}: JSON hỏng (${detail})`);
  }

  const problems = traceShapeProblems(parsed);
  if (problems.length > 0) {
    throw new Error(`dòng ${lineNumber}: ${problems.join("; ")}`);
  }
  return parsed as BotDecisionTrace;
}

/** Bỏ qua dòng trắng; mọi dòng khác phải parse được, không có đường im lặng. */
export function parseTraceJsonl(text: string): BotDecisionTrace[] {
  const traces: BotDecisionTrace[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    traces.push(parseTraceLine(line, i + 1));
  }
  return traces;
}

/**
 * Kiểm hình dạng, không phải kiểm kiểu đầy đủ.
 *
 * Chỉ khẳng định những trường mà viewer thật sự đọc. Một bộ validate đầy đủ ở
 * đây sẽ là bản sao thứ hai của `BotDecisionTrace` và sẽ trôi lệch khỏi bản
 * gốc; thứ cần chặn là "file này không phải trace" chứ không phải "trace này
 * thiếu một trường phụ".
 */
function traceShapeProblems(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["không phải một object"];
  }
  const trace = value as Partial<BotDecisionTrace>;
  const problems: string[] = [];
  if (typeof trace.botId !== "string") problems.push("thiếu botId");
  if (typeof trace.round !== "number") problems.push("thiếu round");
  if (typeof trace.decision !== "string") problems.push("thiếu decision");
  if (!Array.isArray(trace.candidates)) problems.push("thiếu candidates");
  if (typeof trace.chosen !== "object" || trace.chosen === null) problems.push("thiếu chosen");
  return problems;
}

export interface TermSumProblem {
  botId: string;
  round: number;
  decision: string;
  targetId: string;
  score: number;
  sum: number;
}

/**
 * Các số hạng có còn cộng lại bằng điểm sau một vòng đĩa không.
 *
 * Bất biến này đúng theo cấu tạo trong bộ nhớ (`score` được TÍNH bằng
 * `sumTerms`), nên thứ đang được kiểm ở đây là chuyến đi qua JSON: một lần làm
 * tròn hay một số bị `JSON.stringify` biến thành `null` sẽ hiện ra ở đây chứ
 * không hiện ra ở một buổi tuning lúc 2 giờ sáng.
 *
 * Dung sai theo tỉ lệ: `sumTerms` cộng dồn theo thứ tự nên sai số IEEE-754 tỉ
 * lệ với độ lớn của các số hạng, không phải một hằng số tuyệt đối.
 */
export function termSumProblems(traces: readonly BotDecisionTrace[]): TermSumProblem[] {
  const problems: TermSumProblem[] = [];
  for (const trace of traces) {
    for (const candidate of trace.candidates) {
      const sum = sumTerms(candidate.terms);
      const scale = Math.max(1, Math.abs(candidate.score), Math.abs(sum));
      if (Math.abs(sum - candidate.score) > scale * 1e-9) {
        problems.push({
          botId: trace.botId,
          round: trace.round,
          decision: trace.decision,
          targetId: candidate.targetId,
          score: candidate.score,
          sum,
        });
      }
    }
  }
  return problems;
}

/**
 * Tên file cho trace của một ván: seed đã được làm sạch, đuôi `.jsonl`.
 *
 * Seed do người dùng đặt (`--seed`) nên nó có thể chứa `/`, `:` hay khoảng
 * trắng. Thay bằng `-` chứ không cắt bỏ: hai seed khác nhau phải cho hai tên
 * khác nhau, và giữ nguyên độ dài là cách rẻ nhất để điều đó đúng.
 */
export function traceFileName(seed: string): string {
  const safe = seed.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${safe}.jsonl`;
}
