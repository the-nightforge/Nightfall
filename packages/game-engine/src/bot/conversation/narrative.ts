import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotBrainState, BotSpeechKind } from "../types";

/**
 * PR 5 của `NIGHTFALL_BOT_COMMUNICATION_UPGRADE` (§15): BOT đã CÔNG KHAI nói gì
 * về ai, và lượt này nó có đang tự mâu thuẫn không.
 *
 * Đây là trí nhớ về LỜI NÓI, không phải về niềm tin. `suspicion`/`trust` trong
 * `BotBrainState` đổi liên tục và đổi trong im lặng - đó là chuyện riêng của
 * BOT, và đổi ý trong đầu không phải một sự bất nhất. Cái cả bàn nhớ, và cái
 * §15 nói tới, là những gì BOT đã NÓI RA. Vì vậy module này chỉ đọc
 * `speechMemory` (lượt nói đã phát) và `previousVotes` (lá phiếu đã bỏ).
 *
 * DẪN XUẤT, không lưu trữ: không thêm một byte nào vào `BotBrainState`. Cùng lý
 * do với `conversation-state.ts` - một bản sao thứ hai của lịch sử phát ngôn là
 * một bản sao sẽ trôi lệch khỏi lịch sử thật.
 *
 * THUẦN: không RNG, không đồng hồ, không I/O.
 */

/**
 * Lập trường công khai về một người.
 *
 * `"neutral"` KHÔNG bao giờ được lưu thành một `NarrativePosition`: một lập
 * trường trung lập không phải một điều đã nói ra, nó là sự vắng mặt của điều
 * đã nói. Nó chỉ xuất hiện làm giá trị trả về của `liveStanceOn`.
 */
export type NarrativeStance = "trust" | "suspect" | "neutral";

export interface NarrativePosition {
  subjectId: string;
  /** Không bao giờ `"neutral"`. Xem `NarrativeStance`. */
  stance: Exclude<NarrativeStance, "neutral">;
  /** Đã nói ra tới mức nào, `0..1`. Nói một lần khác hẳn nói ba vòng liền. */
  strength: number;
  /** `sourceId` của bằng chứng đã nêu KÈM lập trường này. */
  reasonIds: string[];
  /** Vòng ĐẦU TIÊN của mạch lập trường hiện tại, không phải của cả ván. */
  createdAtRound: number;
  lastStatedRound: number;
}

/**
 * Speech kind nào là một lập trường CÔNG KHAI về phe của một người.
 *
 * Danh sách cố tình HẸP. Hai loại bị bỏ, và cả hai đều bị bỏ vì cùng một lý do:
 * một lập trường ghi sai còn tệ hơn một lập trường thiếu, vì nó sẽ bịt miệng
 * BOT ở một lượt hoàn toàn hợp lệ.
 *
 * - `AGREE` mơ hồ theo mục tiêu: đồng tình ở `SHARED_SUSPICION` là đồng tình
 *   NGHI, còn ở `ROLE_CLAIM_HEARD` là đồng tình TIN. Cùng một kind, hai lập
 *   trường ngược nhau.
 * - `CHALLENGE` không nói gì về phe. Từ PR 4, `CHALLENGE_PREMISE` nhắm vào
 *   NGƯỜI HỎI - bẻ lại một câu hỏi không có nghĩa là tố người đó là Sói.
 */
const STANCE_OF: Readonly<Partial<Record<BotSpeechKind, "trust" | "suspect">>> =
  Object.freeze({
    ACCUSE: "suspect",
    CHANGE_MIND: "suspect",
    COUNTER_CLAIM: "suspect",
    DEFEND: "trust",
  });

/** Nói bấy nhiêu lần thì lập trường đạt sức nặng tối đa. */
const FULL_STRENGTH_AT = 3;

/**
 * Lập trường công khai hiện tại về từng người.
 *
 * Duyệt theo thứ tự THỜI GIAN và lấy cái CUỐI: một người đổi ý giữa ván thì
 * lập trường của họ là cái mới, còn cái cũ là thứ họ phải giải thích. Trong
 * cùng một vòng, lời nói đứng trước lá phiếu - phiếu chốt ở cuối vòng thảo
 * luận, nên nó là tiếng nói sau cùng.
 *
 * ponytail: cửa sổ của `speechMemory` (`conversation.memoryWindow`, mặc định
 * 12) là trần trên thật sự ở đây - một lập trường nêu từ quá lâu sẽ rơi khỏi
 * cửa sổ và BOT "quên mất mình đã nói", trong khi cả bàn thì vẫn nhớ. Nới
 * `memoryWindow` nếu chuyện đó đo được; đừng dựng một mảng lưu trữ thứ hai.
 */
export function buildNarrative(
  state: BotBrainState,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): Record<string, NarrativePosition> {
  interface Statement {
    round: number;
    order: number;
    subjectId: string;
    stance: "trust" | "suspect";
    sourceIds: string[];
  }

  const statements: Statement[] = [];

  for (const record of state.speechMemory) {
    const stance = STANCE_OF[record.kind];
    if (!stance || record.targetId === null) continue;
    statements.push({
      round: record.round,
      order: record.seq,
      subjectId: record.targetId,
      stance,
      sourceIds: record.sourceIds,
    });
  }

  for (const vote of state.previousVotes) {
    // Bỏ phiếu trắng không nói gì về một người cụ thể.
    if (vote.choice.type !== "PLAYER") continue;
    statements.push({
      round: vote.round,
      // Sau MỌI lượt nói của cùng vòng: `seq` là bộ đếm trong ván nên không so
      // trực tiếp được với thứ tự phiếu; `Infinity` nói đúng ý "cuối vòng".
      order: Number.POSITIVE_INFINITY,
      subjectId: vote.choice.targetId,
      stance: "suspect",
      sourceIds: [],
    });
  }

  statements.sort(
    (left, right) =>
      left.round - right.round ||
      left.order - right.order ||
      left.subjectId.localeCompare(right.subjectId),
  );

  const positions: Record<string, NarrativePosition> = {};

  for (const statement of statements) {
    const current = positions[statement.subjectId];

    // Đổi lập trường thì mạch cũ khép lại: `createdAtRound` tính từ đây, và
    // sức nặng đếm lại từ đầu. Giữ lại số cũ sẽ nói dối rằng BOT đã nói điều
    // này suốt từ vòng đó.
    if (!current || current.stance !== statement.stance) {
      positions[statement.subjectId] = {
        subjectId: statement.subjectId,
        stance: statement.stance,
        strength: Math.min(1, 1 / FULL_STRENGTH_AT),
        reasonIds: [...statement.sourceIds],
        createdAtRound: statement.round,
        lastStatedRound: statement.round,
      };
      continue;
    }

    const merged = new Set([...current.reasonIds, ...statement.sourceIds]);
    positions[statement.subjectId] = {
      ...current,
      strength: Math.min(
        1,
        current.strength + 1 / FULL_STRENGTH_AT,
      ),
      reasonIds: [...merged].sort().slice(0, weights.limits.intentionEvidence),
      lastStatedRound: statement.round,
    };
  }

  return positions;
}

/**
 * Lập trường còn CÒN HIỆU LỰC về một người, hoặc `"neutral"`.
 *
 * "Còn hiệu lực" là một cửa sổ theo vòng, không phải mãi mãi. Một lời tố từ
 * vòng 1 không buộc BOT phải im lặng ở vòng 6: cả bàn cũng đã quên nó rồi, và
 * một luật bất biến trọn ván sẽ khoá cứng BOT vào lập trường đầu tiên nó lỡ
 * nói ra.
 */
export function liveStanceOn(
  narrative: Record<string, NarrativePosition>,
  subjectId: string,
  round: number,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): NarrativeStance {
  const window = weights.conversation.narrativeMemoryRounds;
  if (window <= 0) return "neutral";

  const position = narrative[subjectId];
  if (!position) return "neutral";
  if (round - position.lastStatedRound >= window) return "neutral";
  return position.stance;
}

/**
 * Lượt này có ĐẢO NGƯỢC một lập trường đã nói không.
 *
 * Chỉ đảo ngược mới tính. Nói lại điều đã nói là nhất quán, và nói về một người
 * chưa từng nhắc tới thì không có gì để mâu thuẫn.
 */
export function contradictsNarrative(
  narrative: Record<string, NarrativePosition>,
  subjectId: string,
  next: Exclude<NarrativeStance, "neutral">,
  round: number,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): boolean {
  const prior = liveStanceOn(narrative, subjectId, round, weights);
  return prior !== "neutral" && prior !== next;
}

/** Lập trường mà một ý định sắp công bố, hoặc `null` nếu nó không nêu lập trường nào. */
export function stanceOfKind(kind: BotSpeechKind): "trust" | "suspect" | null {
  return STANCE_OF[kind] ?? null;
}
