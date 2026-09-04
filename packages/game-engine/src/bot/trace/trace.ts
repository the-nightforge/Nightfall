import type { Phase, Role } from "@masoi/shared";
import type { BotPersonality, BotRng } from "../types";

/**
 * Vì sao BOT chọn nước này.
 *
 * Không có trace, cách duy nhất để hiểu một ván trông sai là đọc lại toàn bộ
 * `BotBrainState` bằng debugger - và `BotBrainState` không nói gì về việc điểm
 * số đã được cộng ra sao.
 *
 * Ba ràng buộc định hình module này:
 *
 * 1. **Mặc định TẮT.** Không sink thì không object nào được cấp phát và không
 *    lần rút RNG nào bị bọc. Production trả đúng chi phí bằng không.
 * 2. **Trace ⊆ knowledge view của chính bot đó.** Ràng buộc KHÔNG phải "trace
 *    không chứa role": Sói có quyền biết đồng bọn, và trace của nó phải giải
 *    thích được vì sao nó không bầu đồng bọn. Ràng buộc đúng là trace không
 *    được chứa nhiều hơn thứ engine đã cho bot thấy.
 * 3. **`terms` phải cộng lại BẰNG `score`.** Một trace giải thích sai còn tệ
 *    hơn không có trace: nó khiến người đọc đi sửa nhầm chỗ. Có test riêng.
 */

/** Một số hạng trong tổng điểm, kèm đóng góp thật của nó. */
export interface TraceTerm {
  name: string;
  value: number;
}

export interface TraceCandidate {
  targetId: string;
  score: number;
  /** Tổng của `value` phải bằng `score`. */
  terms: TraceTerm[];
  evidenceIds: string[];
}

export type TraceDecisionKind = "VOTE" | "NIGHT" | "FINAL_VOTE" | "HUNTER_SHOT" | "SPEECH";

/** Ảnh chụp belief; hai bản trước/sau cho thấy quan sát vừa rồi đã đổi gì. */
export type BeliefSnapshot = Record<string, { suspicion: number; trust: number }>;

/**
 * Ảnh chụp knowledge ĐÃ LỌC.
 *
 * Mọi trường ở đây là bản sao của `BotKnowledgeView`, thứ engine đã lọc theo
 * quyền của chính bot. Không trường nào được dựng lại từ nguồn khác - đó là
 * cách duy nhất để ràng buộc 2 ở trên đúng theo kiến trúc chứ không theo kỷ luật.
 */
export interface TraceKnowledgeSnapshot {
  aliveIds: string[];
  legalChoices: string[];
  knownRoles: Record<string, Role>;
  seerResult: { targetId: string; isWolf: boolean } | null;
}

export interface BotDecisionTrace {
  botId: string;
  round: number;
  phase: Phase;
  decision: TraceDecisionKind;
  /**
   * `reason` là `BotSpeechIntention.reason`, thứ được ghi rõ trong `types.ts` là
   * "giải thích nội bộ, cho trace và log" - và cho tới trước công cụ này nó
   * chưa từng tới được một trace nào. Không có nó, một `SPEECH` thành công chỉ
   * nói được bot đã nói GÌ; lý do nó mở miệng thì chỉ hiện ra khi nó im lặng
   * (qua `fallbackReason`), tức đúng nửa câu trả lời sai.
   *
   * Nằm trong ranh giới 2: `reason` là lý lẽ của CHÍNH bot đó, rút từ knowledge
   * view của chính nó. Nó có thể nhắc tới vai thật của người nói, y như
   * `knowledgeSnapshot.knownRoles` đã làm.
   */
  chosen: { targetId: string | null; label: string; reason?: string };
  candidates: TraceCandidate[];
  /** Belief lúc bắt đầu lần `observe` gần nhất. */
  beliefBefore: BeliefSnapshot;
  /** Belief sau lần `observe` đó, tức đầu vào thật của quyết định này. */
  beliefAfter: BeliefSnapshot;
  personality: BotPersonality;
  /** Mọi lần rút RNG trong quyết định này, theo đúng thứ tự. */
  rngDraws: number[];
  fallbackReason: string | null;
  knowledgeSnapshot: TraceKnowledgeSnapshot;
}

export interface BotTraceSink {
  record(trace: BotDecisionTrace): void;
}

export interface BotTraceCollector extends BotTraceSink {
  readonly traces: BotDecisionTrace[];
  clear(): void;
}

export function createTraceCollector(): BotTraceCollector {
  const traces: BotDecisionTrace[] = [];
  return {
    traces,
    record(trace) {
      traces.push(trace);
    },
    clear() {
      traces.length = 0;
    },
  };
}

/**
 * Đầu thu mà tầng quyết định ghi vào.
 *
 * Tách khỏi `BotTraceSink` vì hai thứ khác nhau: sink nhận một quyết định ĐÃ
 * HOÀN CHỈNH, còn probe nhận từng mảnh trong lúc quyết định đang hình thành.
 * Hàm quyết định không biết gì về `BotDecisionTrace` - nó chỉ biết mình đã chấm
 * những ai và vì sao bỏ cuộc.
 */
export interface DecisionProbe {
  candidate(candidate: TraceCandidate): void;
  fallback(reason: string): void;
}

export interface DecisionProbeCollector extends DecisionProbe {
  readonly candidates: TraceCandidate[];
  readonly fallbackReason: string | null;
}

export function createDecisionProbe(): DecisionProbeCollector {
  const candidates: TraceCandidate[] = [];
  let reason: string | null = null;
  return {
    candidates,
    get fallbackReason() {
      return reason;
    },
    candidate(item) {
      candidates.push(item);
    },
    fallback(text) {
      // Giữ lý do ĐẦU TIÊN: nó là nguyên nhân, những lý do sau là hệ quả.
      if (reason === null) reason = text;
    },
  };
}

/**
 * Cộng các số hạng theo ĐÚNG thứ tự đã dùng để tính điểm.
 *
 * Bắt đầu từ 0 là an toàn theo IEEE-754: `0 + x === x` với mọi `x` hữu hạn, nên
 * chuỗi cộng dồn này giống hệt biểu thức viết tay mà nó thay thế. Đó là điều
 * kiện để `terms` vừa giải thích được vừa không làm dịch kết quả một chút nào.
 */
export function sumTerms(terms: readonly TraceTerm[]): number {
  let total = 0;
  for (const term of terms) total += term.value;
  return total;
}

/**
 * Bọc RNG để ghi lại từng lần rút.
 *
 * Chỉ dùng khi trace bật. Tắt trace thì không có wrapper, nên đường chạy
 * production không đi qua một lời gọi hàm thừa nào.
 */
export function wrapRngForTrace(rng: BotRng, draws: number[]): BotRng {
  return () => {
    const value = rng();
    draws.push(value);
    return value;
  };
}
