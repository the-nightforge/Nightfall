import type { BotDecisionContext, BotEvidence, BotBrainState, BotRng } from "../types";
import type { DecisionProbe, TraceTerm } from "../trace/trace";

/**
 * Kết quả chấm điểm MỘT lựa chọn hành động.
 *
 * `terms` có tên để trace giải thích được (cùng hợp đồng với mọi bảng điểm
 * khác của lõi), `confidence` và `evidence` là những gì intention cuối cần.
 */
export interface ActionEvaluation {
  score: number;
  terms: TraceTerm[];
  confidence: number;
  evidence: BotEvidence[];
}

/**
 * Bối cảnh chấm điểm, đúng những gì `selectVote` hôm nay truyền vào từng ứng
 * viên — không thêm, không bớt. `rng` là RNG của bot: một scorer có jitter hợp
 * lệ phải tự rút từ đây, không được tạo RNG riêng.
 *
 * `frame` là dữ liệu dùng-chung-cả-bảng (trọng số, bias, danh sách alive) mà
 * vòng gọi tính sẵn một lần — generic để mỗi scorer khai báo hình dạng riêng.
 */
export interface StrategyContext<Frame = unknown> {
  context: BotDecisionContext;
  state: BotBrainState;
  rng: BotRng;
  frame?: Frame;
}

/**
 * Điểm cắm cho lớp hoạch định (spec BOT_AI_UPGRADE §12/§27).
 *
 * Hợp đồng: nhận các lựa chọn HỢP LỆ (vòng gọi đã lọc theo engine), chấm và trả
 * về `ActionEvaluation` cho từng lựa chọn. Việc chọn winner, áp ngưỡng,
 * hysteresis và dựng intention VẪN nằm ở vòng gọi — planner chỉ định giá số,
 * không cầm tay lái. Nhờ vậy một `StrategicPlanner` mới (look-ahead, RL) thay
 * được cách chấm điểm mà không đụng vào luồng quyết định đã được test pin.
 */
export interface StrategicPlanner<Frame = unknown> {
  readonly name: string;
  evaluate(candidate: string, context: StrategyContext<Frame>): ActionEvaluation;
}

/**
 * Planner hiện hành: gọi scorer sẵn có và bọc kết quả lại. Ban đầu chỉ là một
 * lớp dẫn (pass-through) — giá trị của nó là ĐIỂM CẮM, để bước sau cắm look-
 * ahead phía sau interface này mà không đổi call sites.
 */
export function immediateUtilityPlanner<Frame>(
  scorer: (candidate: string, context: StrategyContext<Frame>) => ActionEvaluation,
): StrategicPlanner<Frame> {
  return {
    name: "immediate-utility",
    evaluate(candidate, context) {
      return scorer(candidate, context);
    },
  };
}
