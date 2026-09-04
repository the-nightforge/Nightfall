import type {
  BeliefSnapshot,
  BotDecisionTrace,
  TraceCandidate,
  TraceTerm,
} from "./trace";

/**
 * Đọc một file trace bằng mắt người.
 *
 * Câu hỏi mà module này tồn tại để trả lời trong hai phút: "sao ván này bot
 * treo nhầm An?". Trả lời được câu đó cần đúng ba thứ, và đây là ba khối in ra
 * cho mỗi quyết định:
 *
 *   1. Quan sát vừa rồi đẩy nghi ngờ của ai lên - `beliefBefore` so `beliefAfter`.
 *   2. Người được chọn hơn người đứng nhì ở SỐ HẠNG NÀO - không phải hơn bao
 *      nhiêu điểm. Một chênh lệch 40 điểm không nói được gì; "belief +44,
 *      hostility +8" thì chỉ thẳng vào trọng số cần sửa.
 *   3. Khi bot không làm gì: lý do bỏ cuộc, nguyên văn.
 *
 * Thuần: không `fs`, không màu ANSI. Đầu ra là văn bản để `less`, để `grep`, và
 * để dán vào một issue.
 */

export interface TraceViewOptions {
  /** Chỉ in timeline của một bot. Bỏ trống là in mọi bot. */
  botId?: string | null;
  /** Số số hạng in cho mỗi ứng viên (mặc định 4). */
  terms?: number;
  /** Số người được nêu tên trong khối belief (mặc định 4). */
  movers?: number;
  /** Tên file, in ở tiêu đề. */
  source?: string | null;
}

const RULE = "─".repeat(74);

/**
 * Dưới ngưỡng này thì không in.
 *
 * Bằng đúng nửa đơn vị cuối của `toFixed(1)`: mọi số bị bỏ đi ở đây đằng nào
 * cũng in ra thành "0.0", và một màn hình đầy "+0.0" che mất đúng cú nhảy 30
 * điểm mà người đọc đang đi tìm.
 */
const NOISE = 0.05;

export function formatTraceTimeline(
  traces: readonly BotDecisionTrace[],
  options: TraceViewOptions = {},
): string {
  const termLimit = options.terms ?? 4;
  const moverLimit = options.movers ?? 4;
  const wanted = options.botId ?? null;

  const lines: string[] = [];
  lines.push(...header(traces, options, wanted));

  const selected = wanted ? traces.filter((trace) => trace.botId === wanted) : traces;
  if (selected.length === 0) {
    const known = [...new Set(traces.map((trace) => trace.botId))].sort().join(", ");
    lines.push(
      wanted
        ? `Không có quyết định nào của "${wanted}". Bot có trong file: ${known || "(không có)"}`
        : "File không có quyết định nào.",
    );
    return `${lines.join("\n")}\n`;
  }

  // Nhóm theo bot chứ không theo thời gian toàn ván: một timeline trộn 8 bot
  // đọc như một log server, và không ai lần được mạch suy nghĩ của một con nào.
  // Thứ tự TRONG mỗi bot vẫn là thứ tự gốc, tức thứ tự nó đã quyết định thật.
  for (const botId of [...new Set(selected.map((trace) => trace.botId))]) {
    const own = selected.filter((trace) => trace.botId === botId);
    lines.push("", RULE, `BOT ${botId} · ${own.length} quyết định`, personalityLine(own[0]!), RULE);

    // Khối belief chỉ đổi ở `observe`, nên nhiều quyết định trong cùng một pha
    // dùng chung một cặp ảnh. In lại nguyên khối đó ba lần liền chỉ làm loãng
    // đúng thứ đáng đọc, nên chỉ in khi cặp ảnh THẬT SỰ khác lần in trước.
    let lastBelief = "";
    for (const trace of own) {
      lines.push("", headline(trace));

      const key = `${JSON.stringify(trace.beliefBefore)}|${JSON.stringify(trace.beliefAfter)}`;
      if (key !== lastBelief) {
        lastBelief = key;
        const belief = beliefLine(trace.beliefBefore, trace.beliefAfter, moverLimit);
        if (belief) lines.push(`  ${belief}`);
      }

      // Hai lý do khác nhau và cùng có mặt là chuyện bình thường: `reason` nói
      // vì sao bot làm ĐIỀU NÓ ĐÃ LÀM, `fallbackReason` nói nhánh nào đã bỏ
      // cuộc TRƯỚC đó. Gộp chúng lại sẽ xoá mất trình tự này.
      if (trace.chosen.reason) lines.push(`  ↳ vì: ${trace.chosen.reason}`);
      if (trace.fallbackReason) lines.push(`  ↳ bỏ cuộc: ${trace.fallbackReason}`);
      lines.push(...candidateBlock(trace, termLimit));
      if (trace.rngDraws.length > 0) lines.push(`  rng: ${trace.rngDraws.length} lần rút`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function header(
  traces: readonly BotDecisionTrace[],
  options: TraceViewOptions,
  wanted: string | null,
): string[] {
  const bots = new Set(traces.map((trace) => trace.botId));
  const rounds = traces.map((trace) => trace.round);
  const span =
    rounds.length > 0 ? `vòng ${Math.min(...rounds)}-${Math.max(...rounds)}` : "không có vòng nào";
  const lines = [
    options.source ? `trace: ${options.source}` : "trace: (stdin)",
    `${traces.length} quyết định · ${bots.size} bot · ${span}`,
  ];
  if (wanted) lines.push(`lọc: --bot ${wanted}`);
  return lines;
}

function personalityLine(trace: BotDecisionTrace): string {
  const entries = Object.entries(trace.personality)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([name, value]) => `${name} ${value.toFixed(2)}`);
  return `tính cách: ${entries.join(" · ")}`;
}

function headline(trace: BotDecisionTrace): string {
  const at = `[v${trace.round} ${trace.phase}]`;
  const target = trace.chosen.targetId ? ` ${trace.chosen.targetId}` : "";
  return `${at} ${trace.decision} → ${trace.chosen.label}${target}`;
}

/**
 * Ai bị quan sát vừa rồi đẩy đi, và đi bao xa.
 *
 * In cả `trust` chứ không chỉ `suspicion`: `trustDamping` là một số hạng có
 * thật trong bảng điểm, nên một cú tụt tin tưởng cũng là một lời giải thích
 * hợp lệ cho việc ai đó leo lên đầu danh sách.
 */
function beliefLine(before: BeliefSnapshot, after: BeliefSnapshot, limit: number): string | null {
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const moved = ids
    .map((id) => ({
      id,
      suspicion: (after[id]?.suspicion ?? 0) - (before[id]?.suspicion ?? 0),
      trust: (after[id]?.trust ?? 0) - (before[id]?.trust ?? 0),
      to: after[id]?.suspicion ?? 0,
      from: before[id]?.suspicion ?? 0,
    }))
    // Bỏ những chuyển động dưới ngưỡng nhiễu: phần lớn là decay.
    .filter((entry) => Math.abs(entry.suspicion) >= NOISE || Math.abs(entry.trust) >= NOISE)
    .sort((a, b) => Math.abs(b.suspicion) - Math.abs(a.suspicion) || a.id.localeCompare(b.id));

  if (moved.length === 0) return null;

  const shown = moved.slice(0, limit).map((entry) => {
    const trust = Math.abs(entry.trust) >= NOISE ? ` tin ${signed(entry.trust)}` : "";
    // Một người lọt vào danh sách chỉ vì `trust` đổi thì phần nghi ngờ của nó
    // là "+0.0", và "+0.0" đọc như một thay đổi bằng không được in ra vì lý do
    // gì đó. Bỏ hẳn nửa đó đi thì dòng chỉ còn nói đúng thứ đã đổi.
    const suspicion =
      Math.abs(entry.suspicion) >= NOISE
        ? ` ${signed(entry.suspicion)} (${entry.from.toFixed(1)}→${entry.to.toFixed(1)})`
        : ` nghi ${entry.to.toFixed(1)}`;
    return `${entry.id}${suspicion}${trust}`;
  });
  const rest = moved.length - shown.length;
  return `belief: ${shown.join(" · ")}${rest > 0 ? ` · +${rest} người nữa` : ""}`;
}

/**
 * Bảng điểm, xếp hạng, và quan trọng nhất: chênh lệch với người đứng nhì.
 *
 * Người đứng nhì là đối chứng duy nhất có sẵn. "p5 được 61 điểm" không phải một
 * lời giải thích; "p5 hơn p2 vì belief +44" thì đã là một chỗ để sửa.
 */
function candidateBlock(trace: BotDecisionTrace, termLimit: number): string[] {
  if (trace.candidates.length === 0) return [];

  const ranked = [...trace.candidates].sort(
    (a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId),
  );
  const lines: string[] = [];

  const top = ranked[0]!;
  const runnerUp = ranked[1];
  lines.push(`  #1 ${top.targetId}  ${top.score.toFixed(1)}${chosenMark(trace, top)}`);
  lines.push(`       ${termList(top.terms, termLimit)}`);

  if (runnerUp) {
    lines.push(
      `  #2 ${runnerUp.targetId}  ${runnerUp.score.toFixed(1)}` +
        ` (kém ${(top.score - runnerUp.score).toFixed(1)})${chosenMark(trace, runnerUp)}`,
    );
    lines.push(`       ${termList(runnerUp.terms, termLimit)}`);
    lines.push(`  hơn nhau ở: ${termList(termDiff(top.terms, runnerUp.terms), termLimit)}`);
  }

  const rest = ranked.slice(2);
  if (rest.length > 0) {
    lines.push(
      `  còn lại: ${rest.map((item) => `${item.targetId} ${item.score.toFixed(1)}`).join(" · ")}`,
    );
  }

  // Nước đã chọn không phải người dẫn đầu bảng là chuyện đáng dừng lại: nghĩa
  // là có một luật nằm NGOÀI bảng điểm đã can thiệp, và trace phải nói ra điều
  // đó thay vì để người đọc tự phát hiện bằng cách so hai con số.
  const chosenId = trace.chosen.targetId;
  if (chosenId && !ranked.slice(0, 2).some((item) => item.targetId === chosenId)) {
    const chosen = ranked.find((item) => item.targetId === chosenId);
    lines.push(
      chosen
        ? `  ⚠ chọn ${chosenId} (${chosen.score.toFixed(1)}) dù không dẫn đầu bảng`
        : `  ⚠ chọn ${chosenId}, không có trong bảng điểm`,
    );
  }

  return lines;
}

function chosenMark(trace: BotDecisionTrace, candidate: TraceCandidate): string {
  return trace.chosen.targetId === candidate.targetId ? "  ← chọn" : "";
}

/** Số hạng nặng nhất trước, vì đó là thứ người đọc đang tìm. */
function termList(terms: readonly TraceTerm[], limit: number): string {
  const sorted = [...terms]
    .filter((term) => Math.abs(term.value) >= NOISE)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.name.localeCompare(b.name));
  if (sorted.length === 0) return "(không số hạng nào đáng kể)";
  const shown = sorted.slice(0, limit).map((term) => `${term.name} ${signed(term.value)}`);
  const rest = sorted.length - shown.length;
  return `${shown.join(" · ")}${rest > 0 ? ` · +${rest} số hạng` : ""}`;
}

/**
 * Hiệu từng số hạng giữa hai ứng viên.
 *
 * Một số hạng chỉ có ở một bên (ví dụ `teammateProtection` của Sói) vẫn phải
 * hiện ra, với bên kia coi như 0 - chính sự VẮNG MẶT của nó là lời giải thích.
 */
function termDiff(top: readonly TraceTerm[], other: readonly TraceTerm[]): TraceTerm[] {
  const names = [...new Set([...top, ...other].map((term) => term.name))];
  const valueOf = (terms: readonly TraceTerm[], name: string): number =>
    terms.find((term) => term.name === name)?.value ?? 0;
  return names.map((name) => ({ name, value: valueOf(top, name) - valueOf(other, name) }));
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}
