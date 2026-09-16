import { analyzeChat } from "./chat-analysis";
import type { BotMemoryType, BotPlayerKnowledge, BotSpeechKind } from "../types";

/**
 * "Câu vừa phát ra có được chính parser đọc lại thành đúng việc lõi vừa chốt
 * không" - một định nghĩa, ba nơi đọc.
 *
 * # Vì sao câu hỏi này cần một chỗ ở riêng
 *
 * BOT khác chỉ biết một lời tố qua `analyzeChat`, KHÔNG qua
 * `BotSpeechIntention`. Nên một câu `ACCUSE` mà parser đọc ra rỗng là một lời
 * tố không ai nghe thấy: belief của cả bàn không dịch, phiếu không đổi, và
 * vector observation mà tầng train đọc được dựng từ đúng belief đó. Nó hỏng
 * theo cách khó thấy nhất - người đọc chat vẫn thấy BOT nói.
 *
 * Đo được trước khi có file này (60 ván self-play): ACCUSE 16%, DEFEND 39%,
 * REPLY 23%. Không test nào đỏ, không chỉ số nào nhúc nhích.
 *
 * # Ba nơi đọc, và vì sao chúng phải dùng CHUNG
 *
 * - `evaluation/selfplay.ts` đóng dấu `heard` lên từng sự kiện `SPEECH`.
 * - `evaluation/metrics.ts` cộng chúng thành `speechHeardRate`.
 * - `apps/server/src/bots/speech-renderer.ts` hỏi cùng câu đó về câu của NHÀ
 *   CUNG CẤP - đường duy nhất ở production, và là đường bảng mẫu không gác.
 *
 * Ba bản sao của bảng dưới sẽ trôi lệch khỏi nhau, và sẽ trôi lệch âm thầm:
 * hai con số cùng tên nói hai chuyện khác nhau là tệ hơn một con số thiếu.
 */

/**
 * Loại nói CÓ MỤC TIÊU → loại memory mà một người nghe phải đọc ra.
 *
 * Vắng mặt = loại đó KHÔNG nói thay lõi (`AGREE`, `DISAGREE`, `CHANGE_MIND`,
 * `WITHHOLD`, `REACTION`, `HUMOR`). Chúng không có memory type tương ứng, nên
 * "nghe được" không phải một câu hỏi có nghĩa với chúng - và ép chúng sinh ra
 * memory là mở đúng cái lỗ mà `targetSurvivesRoundTrip` tồn tại để bịt.
 *
 * Nhiều lựa chọn vì một câu hỏi và một lời gọi đích danh đều đặt người kia vào
 * thế phải đáp: `triggers.ts` treo móc trên cả `DIRECT_QUESTION` lẫn
 * `DIRECT_ADDRESS`, nên với tầng nghe hai cái đó là một.
 */
export const HEARD_AS: Partial<Record<BotSpeechKind, readonly BotMemoryType[]>> = {
  ACCUSE: ["ACCUSE"],
  DEFEND: ["DEFEND"],
  CLAIM_ROLE: ["ROLE_CLAIM"],
  COUNTER_CLAIM: ["COUNTER_CLAIM"],
  QUESTION: ["DIRECT_QUESTION", "DIRECT_ADDRESS"],
  ASK_EVIDENCE: ["DIRECT_QUESTION", "DIRECT_ADDRESS"],
  CHALLENGE: ["DIRECT_QUESTION", "DIRECT_ADDRESS"],
  REPLY: ["DIRECT_ADDRESS", "DIRECT_QUESTION"],
};

/** Loại nói nào có một loại memory NGƯỢC DẤU - phát ra là hỏng hơn im lặng. */
const HEARD_OPPOSITE: Partial<Record<BotSpeechKind, BotMemoryType>> = {
  ACCUSE: "DEFEND",
  DEFEND: "ACCUSE",
};

/**
 * `true` = người nghe đọc ra đúng việc; `false` = không; `null` = loại này
 * không nói thay lõi nên câu hỏi không áp dụng.
 *
 * THUẦN và tất định: cùng câu, cùng bàn → cùng kết quả. Không đọc đồng hồ,
 * không rút RNG.
 *
 * Một câu đọc ra loại NGƯỢC DẤU là `false` kể cả khi nó cũng đọc ra loại đúng:
 * "đẩy X hoài, X ổn mà" sinh ra CẢ `ACCUSE` lẫn `DEFEND`, và một lời bênh kèm
 * một lời tố vào chính người được bênh thì tệ hơn im lặng.
 */
export function speechIsHeard(
  kind: BotSpeechKind,
  text: string,
  actorId: string,
  players: readonly BotPlayerKnowledge[],
): boolean | null {
  const wanted = HEARD_AS[kind];
  if (wanted === undefined) return null;

  const types = analyzeChat(
    [{ id: "heard-probe", actorId, text, at: 0 }],
    players,
  ).map((memory) => memory.type);

  const opposite = HEARD_OPPOSITE[kind];
  if (opposite !== undefined && types.includes(opposite)) return false;
  return wanted.some((want) => types.includes(want));
}
