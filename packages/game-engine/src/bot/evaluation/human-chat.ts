import { analyzeChat } from "../analysis/chat-analysis";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotChatObservation, BotMemory, BotPlayerKnowledge } from "../types";
import {
  HUMAN_ACCUSATIONS,
  HUMAN_CHAT_PLAYERS,
  HUMAN_CLAIMS,
  HUMAN_DEFENCES,
  HUMAN_TRAPS,
  type HumanChatSample,
} from "./human-chat-corpus";

/**
 * Đo parser trên corpus câu người thật (`human-chat-corpus.ts`).
 *
 * Không phụ thuộc ván nào: cùng một corpus, cùng một parser, cùng một con số
 * ở mọi lần chạy. Nó nằm trong báo cáo self-play vì đó là nơi người tune nhìn
 * vào, và vì "bot nghe được người" là điều kiện tiên quyết để mọi con số
 * khác trong báo cáo có ý nghĩa với phòng thật.
 *
 * `humanAccuseSeenRate` = số lời buộc tội parser đọc ra ĐÚNG NGƯỜI / tổng
 * số lời buộc tội trong corpus. Đọc ra sai người tính là bỏ sót - một cáo
 * buộc gán nhầm còn tệ hơn một cáo buộc bị bỏ qua.
 */
export interface HumanChatMeasure {
  accuseSeen: number;
  accuseTotal: number;
  defendSeen: number;
  defendTotal: number;
  claimSeen: number;
  claimTotal: number;
  /** Câu bẫy mà parser đúng là không đọc ra bằng chứng nào. */
  trapIgnored: number;
  trapTotal: number;
  /** Để in ra khi cần biết parser trượt ở đâu; không vào JSON báo cáo. */
  missed: string[];
  leaked: string[];
}

const PLAYERS: readonly BotPlayerKnowledge[] = HUMAN_CHAT_PLAYERS.map((player) => ({
  ...player,
  alive: true,
}));

/** Ba loại memory sinh bằng chứng; `DIRECT_*` chỉ là móc treo hội thoại. */
const EVIDENCE_TYPES = new Set<BotMemory["type"]>([
  "ACCUSE",
  "DEFEND",
  "ROLE_CLAIM",
  "COUNTER_CLAIM",
]);

function parse(text: string, index: number, weights: BotWeights): BotMemory[] {
  const message: BotChatObservation = { id: `corpus-${index}`, actorId: "me", text, at: index };
  return analyzeChat([message], PLAYERS, { weights }).filter((memory) =>
    EVIDENCE_TYPES.has(memory.type),
  );
}

function matches(sample: HumanChatSample, memories: readonly BotMemory[]): boolean {
  const want = sample.expect;
  return memories.some((memory) => {
    if (memory.type !== want.type) return false;
    if (want.type === "ROLE_CLAIM") return memory.data.role === want.role;
    return memory.targetId === want.targetId;
  });
}

export function measureHumanChat(weights: BotWeights = DEFAULT_BOT_WEIGHTS): HumanChatMeasure {
  const measure: HumanChatMeasure = {
    accuseSeen: 0,
    accuseTotal: HUMAN_ACCUSATIONS.length,
    defendSeen: 0,
    defendTotal: HUMAN_DEFENCES.length,
    claimSeen: 0,
    claimTotal: HUMAN_CLAIMS.length,
    trapIgnored: 0,
    trapTotal: HUMAN_TRAPS.length,
    missed: [],
    leaked: [],
  };

  let index = 0;
  const score = (samples: readonly HumanChatSample[], hit: () => void) => {
    for (const sample of samples) {
      index += 1;
      if (matches(sample, parse(sample.text, index, weights))) hit();
      else measure.missed.push(sample.text);
    }
  };
  score(HUMAN_ACCUSATIONS, () => (measure.accuseSeen += 1));
  score(HUMAN_DEFENCES, () => (measure.defendSeen += 1));
  score(HUMAN_CLAIMS, () => (measure.claimSeen += 1));

  for (const trap of HUMAN_TRAPS) {
    index += 1;
    const found = parse(trap, index, weights);
    if (found.length === 0) measure.trapIgnored += 1;
    else measure.leaked.push(`${trap} -> ${found.map((m) => `${m.type}:${m.targetId ?? m.data.role}`).join(", ")}`);
  }

  return measure;
}
