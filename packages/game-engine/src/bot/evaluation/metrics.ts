import { roleTeam, roleWonOutcome, type Role, type Team, type Winner } from "@masoi/shared";
import { looksCasual } from "./casual-tone";
import { measureHumanChat } from "./human-chat";

/**
 * Mọi KẾT CỤC một ván có thể dừng ở.
 *
 * Bốn ô, và hai trong số đó không phải một phe: `serial_killer` là một người
 * thắng một mình, `draw` là không ai thắng. Chúng nằm ở đây - chứ không bị gộp
 * vào ô của Dân hay Sói - vì đó đúng là câu hỏi cần trả lời khi đọc bảng cân
 * bằng: bốn con số phải cộng lại bằng số ván đã kết thúc, và một ván Sát Nhân
 * thắng không được làm đẹp tỉ lệ của bên nào cả.
 */
type GameOutcome = Exclude<Winner, null>;

/**
 * Phe có ĐỘ CHÍNH XÁC PHIẾU để đo, hẹp hơn `GameOutcome` một cách có chủ đích.
 *
 * "Bỏ phiếu đúng" chỉ có nghĩa với hai phe có mục tiêu chung: với phe làng là
 * trúng một con Sói, với phe Sói là né đồng bọn. Người trung lập vẫn bỏ phiếu,
 * nhưng "đúng" với họ là một câu hỏi khác hẳn - và gộp họ vào đây làm bẩn đúng
 * chỉ số đang đo phe làng.
 */
type VotingTeam = "village" | "wolves";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { normalizeSpeechText, openingOf } from "../conversation/fingerprint";
import type {
  QuestionOutcome,
  SelfPlayEvent,
  SelfPlayGame,
  SpeechBlockReason,
} from "./selfplay";

/**
 * Chỉ số chất lượng chơi, gom từ nhiều ván.
 *
 * Nguyên tắc duy nhất, áp cho mọi con số ở đây: **một tỉ lệ luôn đi kèm mẫu số
 * của nó**. Một báo cáo nói "Dân bỏ phiếu đúng 62%" mà không nói 62% của bao
 * nhiêu lá phiếu là một con số không kiểm chứng được, và tệ hơn, nó trông y hệt
 * một con số đáng tin. Mẫu số 0 cho ra `null`, không phải `0` và không phải
 * `NaN` - "chưa đo được" và "bằng không" là hai kết luận khác hẳn nhau.
 */

export interface Ratio {
  /** `null` khi mẫu số bằng 0. */
  value: number | null;
  numerator: number;
  denominator: number;
}

function ratio(numerator: number, denominator: number): Ratio {
  return {
    value: denominator === 0 ? null : numerator / denominator,
    numerator,
    denominator,
  };
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface SelfPlayMetrics {
  games: number;
  finished: number;
  winRate: Record<GameOutcome, Ratio>;
  averageRounds: number | null;
  /** Phiếu chốt của một người phe làng nhắm trúng một con Sói thật. */
  villageVoteAccuracy: Ratio;
  /** Sói bỏ phiếu hoặc công khai tố đồng bọn. */
  wolfSelfSabotage: Ratio;
  /**
   * Lượt phản kích của Thợ Săn kết thúc bằng một phát bắn thật.
   *
   * Không bắn là một quyết định HỢP LỆ, nên chỉ số này không có mức "đúng" cố
   * định; nó chỉ có nghĩa khi đọc CÙNG `hunterShotAccuracy`. Riêng giá trị 0
   * thì luôn là một dấu hiệu xấu: nó nghĩa là ngưỡng bắn nằm ngoài tầm với của
   * thang belief, và cả cơ chế không tồn tại trong ván thật.
   */
  hunterShotRate: Ratio;
  /** Phát bắn trúng một con Sói thật. Mẫu số là số phát đã bắn. */
  hunterShotAccuracy: Ratio;
  /** Lượt Phù Thuỷ kết thúc bằng bình cứu. Mẫu số là mọi lượt cô ta được hỏi. */
  witchHealRate: Ratio;
  /**
   * Bình cứu dùng cho CHÍNH Phù Thuỷ.
   *
   * Tách khỏi `witchHealRate` vì hai nhánh trong chiến lược là khác hẳn nhau:
   * tự cứu đi qua một lối tắt vô điều kiện, còn cứu người khác phải vượt ngưỡng
   * tin tưởng. Tỉ lệ này bằng 1 nghĩa là nhánh thứ hai chưa từng chạy.
   */
  witchHealSelfRate: Ratio;
  /** Lượt Phù Thuỷ kết thúc bằng bình độc. Mẫu số là mọi lượt cô ta được hỏi. */
  witchPoisonRate: Ratio;
  /** Bình độc trúng một con Sói thật. Mẫu số là số bình độc đã dùng. */
  witchPoisonAccuracy: Ratio;
  /**
   * Ván có Phù Thuỷ mà bình độc còn nguyên tới khi ván kết thúc (hoặc cô ta
   * chết). Mẫu số là số ván có Phù Thuỷ. Đây là "ôm bình tới cuối" của P2.2.
   */
  witchPoisonUnusedRate: Ratio;
  /**
   * Ván có Tiên Tri mà Tiên Tri chết vào ĐÊM vòng 2 (cause khác lynch/hunter).
   * Mẫu số là số ván có Tiên Tri. Đây là "hô sớm chết đêm 2" của P2.1.
   */
  seerDiedNightTwoRate: Ratio;
  /** Ván có Tiên Tri mà Tiên Tri công khai khai vai ngay vòng 1. Cùng mẫu số. */
  seerClaimedRoundOneRate: Ratio;
  /**
   * Tiên Tri ĐÃ khai vòng 1 và còn sống bước vào đêm 2, rồi chết đêm đó.
   *
   * Mẫu số là số Tiên Tri đã khai vòng 1 VÀ không bị treo ngay vòng 1 - người
   * bị treo không có đêm 2 để mà chết. Đây là "nguy cơ chết sau khai vai"
   * đúng nghĩa; `seerDiedNightTwoRate` gộp cả người chưa khai nên không đo
   * được nó.
   */
  seerClaimedR1DiedNightTwoRate: Ratio;
  /**
   * Tiên Tri CHƯA khai vòng 1, còn sống bước vào đêm 2, rồi chết đêm đó.
   *
   * Đối chứng của chỉ số trên: nếu hai tỉ lệ này gần nhau thì khai sớm không
   * phải điều khiến Tiên Tri chết, và "hô sớm chết đêm 2" là một chẩn đoán sai.
   */
  seerUnclaimedR1DiedNightTwoRate: Ratio;
  /**
   * Tiên Tri khai ở vòng r (bất kỳ) và chết ngay đêm r+1 vì lý do KHÔNG phải
   * lynch/hunter. Mẫu số là số Tiên Tri đã khai và còn sống hết ngày khai.
   * Tổng quát hoá của chỉ số vòng 1, cho bàn mà Tiên Tri hay khai muộn.
   */
  seerDiedNightAfterClaimRate: Ratio;
  /**
   * Đêm Phù Thuỷ còn bình độc mà không dùng, VÀ người cô ta nghi nhất lúc đó
   * là một con Sói thật. Mẫu số là mọi đêm giữ bình (`WITCH_HOLD`).
   *
   * Đo độ lệch giữa belief và ngưỡng: cao nghĩa là cô ta đã chỉ đúng người
   * nhưng ngưỡng không cho phép - một tín hiệu về `witchPoisonSuspicion`,
   * không phải về belief.
   */
  witchHoldTopWolfRate: Ratio;
  /**
   * Khoảng cách trung bình `threshold - topSuspicion` ở những đêm giữ bình mà
   * người nghi nhất là Sói thật. `null` khi không có đêm nào như vậy.
   *
   * Đọc cùng `witchHoldTopWolfRate`: tỉ lệ đó cao mà khoảng cách này lớn nghĩa
   * là belief đúng hướng nhưng còn xa ngưỡng - không phải "bỏ lỡ", là "chưa đủ
   * bằng chứng". Khoảng cách nhỏ mới là chỗ đáng cân nhắc ngưỡng.
   */
  witchHoldWolfGapMean: number | null;
  /**
   * Đêm giữ bình mà CÓ mục tiêu đã vượt ngưỡng nghi ngờ nhưng bị veto vì tin
   * tưởng còn cao. Mẫu số là mọi đêm giữ bình. Đây là dạng "giữ" duy nhất là
   * một quyết định giữa hai tín hiệu mâu thuẫn, không phải thiếu bằng chứng.
   */
  witchHoldVetoedByTrustRate: Ratio;
  /**
   * Ba ngăn RỜI NHAU của "giữ bình tới cuối" (`witchPoisonUnusedRate`), cùng
   * mẫu số là số ván bình độc còn nguyên. Tổng ba tử số bằng đúng mẫu số.
   *
   * - `diedEarly`: chết trước khi ván xong và chưa đêm nào nghi nhất một con
   *   Sói - không có cơ hội nào, kể cả theo belief của chính cô ta.
   * - `noTarget`: sống tới cuối nhưng chưa đêm nào nghi nhất một con Sói -
   *   giữ bình là ĐÚNG, dùng là giết dân.
   * - `topWolfBelowBar`: có ít nhất một đêm người nghi nhất là Sói thật mà
   *   vẫn giữ. KHÔNG gọi đây là "quyết định sai": ở thang belief thật, điểm
   *   nghi nhất ở những đêm này thường chỉ là một linh cảm mờ (xem
   *   `witchHoldWolfGapMean`). Nó là ngăn duy nhất mà đổi ngưỡng có thể đổi
   *   kết quả, nên nó được tách riêng - để cân nhắc, không để kết tội.
   */
  witchPoisonUnusedDiedEarlyRate: Ratio;
  witchPoisonUnusedNoTargetRate: Ratio;
  witchPoisonUnusedTopWolfBelowBarRate: Ratio;
  /**
   * Ván có ít nhất một lá phiếu Sói -> Sói mà trước nó trong cùng vòng chưa ai
   * bầu con Sói đó (dấu vân tay của cuộc cãi giả P2.3; bussing cần phiếu có
   * sẵn nên không tạo ra hình dạng này). Mẫu số là số ván đã chạy.
   */
  wolfFakeFightRate: Ratio;
  /** Lá phiếu thay cho một lá đã bỏ trước đó trong cùng vòng. */
  voteChangeRate: Ratio;
  /** Mức đồng thuận trung bình: phiếu cho ứng viên dẫn đầu / số người bỏ phiếu. */
  consensus: number | null;
  /** Độ gắn kết trung bình của các nhóm mà BOT tự nhận ra. */
  coalitionCohesion: number | null;
  /** Bằng chứng đã quá cũ mà vẫn được mang theo một lá phiếu. */
  staleEvidenceRate: Ratio;
  /** PHẢI bằng 0. */
  knowledgeBoundaryViolations: number;
  /**
   * Nước đi lõi sinh ra mà engine TỪ CHỐI. Phải bằng 0.
   *
   * Tách khỏi `declinedTurns`: một lượt bị từ chối là lỗi của lõi, còn một lượt
   * chủ động bỏ là một quyết định. Gộp chúng lại thì Linh Mục giữ bình - nước đi
   * đúng của vai đó - sẽ được đếm y như một bug.
   */
  fallbackActions: number;
  /** Lượt mà vai CÓ hành động nhưng chủ động không dùng. Không phải lỗi. */
  declinedTurns: number;
  /**
   * Nói lại đúng `(kiểu, mục tiêu)` của lần mình nói liền trước.
   *
   * @deprecated Giữ để so dọc với Phase 3. Nó KHÔNG đo lặp câu chữ: với ba mẫu
   * câu cố định của Phase 3, hai lượt `ACCUSE` nhắm hai người khác nhau đọc lên
   * gần như y hệt mà chỉ số này báo "không lặp". Dùng `exactRepetitionRate`,
   * `normalizedRepetitionRate` và `semanticRepetitionRate` thay cho nó.
   */
  speechRepetitionRate: Ratio;
  roundLimitRate: Ratio;

  // ---- Hội thoại (Phase 4) ----
  //
  // Ba chỉ số lặp đầu tiên cố tình CHỒNG LẤN nhau và đo ba thứ khác nhau. Một
  // BOT lách được cái này bằng cách đổi chữ sẽ hiện lên ở cái kia; đọc cả ba
  // cùng lúc mới ra bức tranh thật.

  /** Câu trùng NGUYÊN VĂN một câu trước đó của CÙNG BOT trong cùng ván. */
  exactRepetitionRate: Ratio;
  /** Trùng sau khi hạ chữ thường, bỏ dấu câu và bỏ từ đệm đầu câu. */
  normalizedRepetitionRate: Ratio;
  /** Trùng Ý ĐỊNH: cùng loại, mục tiêu, câu được đáp, topic và tập bằng chứng. */
  semanticRepetitionRate: Ratio;
  /** Ba token mở đầu trùng câu LIỀN TRƯỚC của cùng BOT. */
  repeatedOpeningRate: Ratio;
  /**
   * Số cách mở đầu KHÁC NHAU trên số câu, cộng dồn theo từng BOT trong từng
   * ván. 1.0 là không câu nào của một bot mở đầu như câu khác của chính nó
   * trong ván; bảng mẫu bốn câu của Phase 4 cho khoảng 0.4.
   *
   * Khác `repeatedOpeningRate`: cái đó chỉ bắt hai câu LIỀN NHAU; cái này bắt
   * "mọi câu đều bắt đầu bằng tôi nghi" dù có xen câu khác ở giữa.
   */
  distinctOpeningRate: Ratio;
  /** Hai câu liên tiếp của cùng BOT nhắm cùng một người. */
  consecutiveSameTargetRate: Ratio;
  /** Câu có trả lời một message cụ thể. */
  replyRate: Ratio;
  /**
   * Câu hỏi nhắm thẳng vào ai đó và được người đó đáp lại.
   *
   * Không nên bằng 1: một quần thể trả lời mọi câu hỏi là một quần thể máy móc.
   */
  directQuestionResponseRate: Ratio;
  /** Trung bình số tin của một BOT trong một ngày mà nó CÓ nói. */
  messagesPerBotPerDay: number | null;
  /** Chuỗi đối đáp lồng nhau dài nhất thấy được. */
  maxDialogueChainLength: number;
  /** Lượt được mời nói mà BOT chọn im lặng. `null` khi không đo được. */
  silenceRate: Ratio;
  /**
   * Số phận từng câu hỏi trực tiếp, chia theo `QuestionOutcome`. Bảy tỉ lệ
   * cùng một mẫu số (số câu hỏi đã được chốt) và cộng lại bằng 1.
   *
   * `ANSWERED` ở đây và `directQuestionResponseRate` đo cùng một thứ theo hai
   * đường độc lập (harness chốt ở cuối vòng / tầng đo dò `replyToMessageId`);
   * lệch nhau là một lỗi ở một trong hai.
   */
  directQuestionOutcomes: Record<QuestionOutcome, Ratio>;
  /** Số câu bị PHÒNG chặn, theo lý do. Không phải tỉ lệ: đây là số đếm thô. */
  speechBlockedByRoom: Record<SpeechBlockReason, number>;
  /**
   * Câu do bảng mẫu sinh ra, đếm theo cờ `fromTemplate` trên từng câu.
   * Trong self-play luôn bằng 1 theo thiết kế; ở production đây là con số cần
   * theo dõi (một nhà cung cấp hỏng lặng lẽ trông y hệt một nhà cung cấp tốt
   * nếu không có nó).
   */
  fromTemplateRate: Ratio;
  /**
   * Câu đọc lên như người gõ trong phòng, chứ không như một đoạn văn.
   *
   * Xem `casual-tone.ts` cho định nghĩa và cho lý do nó tồn tại. Trong
   * self-play, con số này đo BẢNG MẪU; ở một bản ghi nhập từ production nó đo
   * chính nhà cung cấp, và đó mới là chỗ giọng thật sự trôi được.
   */
  casualToneRate: Ratio;

  // ---- Lời khai vai (Phase 5) ----

  /** Số lời khai trung bình mỗi ván. Thiết kế nhắm 2–4 ở bàn 12–14. */
  claimsPerGame: number | null;
  /** Tỉ lệ ván có ít nhất một lời phản bác. Phải `> 0` và `< 1`. */
  counterClaimRate: Ratio;
  /**
   * Phiếu chuyển sang người bị một lời khai chỉ mặt, trong vòng ngay sau đó.
   *
   * `≈ 0` nghĩa là mô hình uy tín chỉ là số chạy ngầm: người chơi sẽ không thấy
   * lời khai thay đổi được điều gì, và đó là hỏng đúng mục tiêu của Phase 5.
   */
  claimFollowRate: Ratio;
  /**
   * Trong những lần làng TIN một lời khai Tiên Tri, bao nhiêu lần người đó là
   * Tiên Tri thật.
   *
   * Chỉ số quan trọng nhất của Phase 5, và là chỉ số duy nhất chỉ tồn tại được
   * ở harness - chỉ đây mới biết vai thật để đối chiếu. Dưới 50% nghĩa là cơ
   * chế đang giúp Sói nhiều hơn giúp làng, tức phần Sói khai láo đã nuốt chửng
   * phần thông tin của làng.
   */
  claimAccuracy: Ratio;
  /**
   * Trong những lần một con SÓI khai láo Tiên Tri, bao nhiêu lần làng đi theo
   * lời khai đó (COMMUNICATION §17).
   *
   * Đây là chỉ số ĐÍCH của việc chấm điểm ghế khai láo: `wolfBluffCandidateScore`
   * tồn tại để bầy đẩy ra con nói dối *có sức thuyết phục hơn*, và không có
   * con số này thì "đã chọn ghế khác" chỉ nói rằng có gì đó đổi, không nói rằng
   * nó đổi theo chiều tốt hơn.
   *
   * Anh em với `claimAccuracy` nhưng ĐỘC LẬP với nó: mẫu số ở đây là lời khai
   * láo của Sói, còn `claimAccuracy` lấy mẫu số là những lời khai làng ĐÃ tin.
   * Một cơ chế đẩy chỉ số này lên sẽ kéo `claimAccuracy` xuống - đó là cùng một
   * sự việc nhìn từ hai phía, không phải hai kết quả mâu thuẫn.
   *
   * Chỉ tồn tại được ở harness: chỉ đây mới biết vai thật để đối chiếu.
   */
  wolfBluffBelievedRate: Ratio;

  // ---- Nghe người thật (P0.3) ----

  /**
   * Trên corpus câu người thật mẫu (`human-chat-corpus.ts`): bao nhiêu lời
   * buộc tội parser đọc ra ĐÚNG người. Mục tiêu > 0.8; trước P0 ước < 0.5.
   *
   * Không phụ thuộc ván: cùng parser thì cùng số. Nằm ở đây vì báo cáo
   * self-play là nơi người tune nhìn, và vì mọi con số khác trong báo cáo
   * chỉ có nghĩa với phòng thật khi bot nghe được người.
   */
  humanAccuseSeenRate: Ratio;
  humanDefendSeenRate: Ratio;
  humanClaimSeenRate: Ratio;
  /** Câu bẫy (đùa, hỏi, phủ định) parser bỏ qua đúng. Phải bằng 1. */
  humanTrapIgnoredRate: Ratio;
  /**
   * Câu hỏi / lời gọi đích danh mà parser đọc ra đúng người được hỏi
   * (`HUMAN_QUESTIONS`). Đây là mặt "corpus" của `directQuestionOutcomes.NOT_PARSED`:
   * ngăn kia đo trên câu bot sinh ra, ngăn này đo trên câu người gõ.
   */
  humanQuestionSeenRate: Ratio;
  /** Câu nêu tên nhưng không nói với ai (`HUMAN_ADDRESS_TRAPS`) mà parser bỏ qua đúng. Phải bằng 1. */
  humanAddressTrapIgnoredRate: Ratio;
}

export interface RoleMetrics {
  role: Role;
  /** Số ván có vai này trong bàn. */
  games: number;
  /** Số ván mà người mang vai này thuộc phe THẮNG. */
  wins: Ratio;
}

export interface TeamMetrics {
  team: VotingTeam;
  wins: Ratio;
  voteAccuracy: Ratio;
}

export interface SelfPlayMetricsBundle {
  overall: SelfPlayMetrics;
  byTeam: Record<VotingTeam, TeamMetrics>;
  byRole: RoleMetrics[];
}

/**
 * Bằng chứng được coi là *stale*.
 *
 * Không phải lỗi - trí nhớ dài là hợp lý, và một kết quả soi thì đáng nhớ mãi.
 * Nhưng tỉ lệ cao nghĩa là decay không làm việc, và BOT đang biện luận bằng
 * những chuyện không còn liên quan.
 */
const PERMANENT_KINDS = new Set([
  "SEER_RESULT_WOLF",
  "SEER_RESULT_CLEAR",
  "KNOWN_ALLY",
  "PROVEN_FALSE_CLAIM",
]);

/** Phiếu CHỐT của mỗi người trong mỗi vòng; các lá trước đó đã bị thay. */
function finalVotesByRound(
  events: readonly SelfPlayEvent[],
): Map<number, Map<string, Extract<SelfPlayEvent, { kind: "VOTE" }>>> {
  const byRound = new Map<number, Map<string, Extract<SelfPlayEvent, { kind: "VOTE" }>>>();
  for (const event of events) {
    if (event.kind !== "VOTE") continue;
    const round = byRound.get(event.round) ?? new Map();
    // Ghi đè: sự kiện sau trong cùng vòng là lá phiếu mới hơn của cùng người.
    round.set(event.voterId, event);
    byRound.set(event.round, round);
  }
  return byRound;
}

/**
 * Có lá phiếu nào ĐỔI sang `targetId`, trong vòng của lời khai hoặc vòng ngay
 * sau đó, mà người bỏ phiếu thuộc phe làng - hay không.
 *
 * Chỉ xét phiếu ĐỔI (`changed`): một lá phiếu giữ nguyên không phải là làng
 * "chuyển sang" ai cả, nó là một lá đã có từ trước lời khai. Chỉ xét phiếu của
 * phe làng: một con Sói bỏ phiếu theo mục tiêu của một lời khai (bussing, hay
 * chính lời khai đó là của Sói) không phải là làng bị thuyết phục - đưa cả hai
 * phe vào chung một mẫu số sẽ làm `claimAccuracy` không còn đo được điều nó cần
 * đo.
 *
 * Quét TỚI (không quét lùi) từ vị trí lời khai: chỉ phiếu xảy ra SAU lời khai
 * mới là làng phản ứng lại nó, không phải trùng hợp ngẫu nhiên trước đó.
 */
function claimWasFollowed(
  events: readonly SelfPlayEvent[],
  fromIndex: number,
  claimRound: number,
  targetId: string,
  roles: Record<string, Role>,
): boolean {
  for (let index = fromIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (event.kind !== "VOTE" || !event.changed) continue;
    if (event.targetId !== targetId) continue;
    if (event.round !== claimRound && event.round !== claimRound + 1) continue;
    const voterRole = roles[event.voterId];
    if (voterRole === undefined || roleTeam(voterRole) !== "village") continue;
    return true;
  }
  return false;
}

export function collectMetrics(
  games: readonly SelfPlayGame[],
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): SelfPlayMetricsBundle {
  const staleAfter = weights.recency.staleAfterRounds;
  const humanChat = measureHumanChat(weights);

  let finished = 0;
  let villageWins = 0;
  let killerWins = 0;
  let draws = 0;
  let wolfWins = 0;
  const roundCounts: number[] = [];

  let villageCorrect = 0;
  let villageVotes = 0;
  let wolfBetrayals = 0;
  let wolfSignals = 0;
  let voteChanges = 0;
  let voteTotal = 0;
  const consensusSamples: number[] = [];
  const cohesionSamples: number[] = [];
  let staleEvidence = 0;
  let evidenceTotal = 0;
  let boundaryViolations = 0;
  let fallbackActions = 0;
  let declinedTurns = 0;
  let speechRepeats = 0;
  let speechTotal = 0;
  let roundLimited = 0;
  let casualLines = 0;
  let exactRepeats = 0;
  let normalizedRepeats = 0;
  let semanticRepeats = 0;
  let openingRepeats = 0;
  let distinctOpenings = 0;
  let fromTemplateCount = 0;
  let sameTargetRuns = 0;
  let replies = 0;
  // Mẫu số / tử số của `wolfBluffBelievedRate` (§17).
  let wolfBluffClaims = 0;
  let wolfBluffBelieved = 0;
  let directQuestionTotal = 0;
  let directQuestionAnswered = 0;
  let chainMax = 0;
  let silenceOpportunities = 0;
  let silentBotDays = 0;
  const botDaySamples: number[] = [];

  // ---- Lời khai vai (Phase 5) ----
  const claimCounts: number[] = [];
  let counterClaimGames = 0;
  /** Lời khai có chỉ mặt ai đó (`targetId !== null`) - mẫu số của `claimFollowRate`. */
  let claimPointTotal = 0;
  let claimPointFollowed = 0;
  /** Lời khai Tiên Tri (`claimedRole === "SEER"`) mà làng đã TIN - mẫu số của `claimAccuracy`. */
  let seerClaimsBelieved = 0;
  let seerClaimsAccurate = 0;

  let hunterReactions = 0;
  let hunterShots = 0;
  let hunterShotsOnWolf = 0;
  let witchTurns = 0;
  let witchHeals = 0;
  let witchSelfHeals = 0;
  let witchPoisons = 0;
  let witchPoisonsOnWolf = 0;
  let witchGames = 0;
  let witchPoisonUnused = 0;
  let seerGames = 0;
  let seerDiedNightTwo = 0;
  let seerClaimedRoundOne = 0;
  let seerClaimedR1AliveNight2 = 0;
  let seerClaimedR1DiedNight2 = 0;
  let seerUnclaimedR1AliveNight2 = 0;
  let seerUnclaimedR1DiedNight2 = 0;
  let seerClaimedAliveNextNight = 0;
  let seerDiedNightAfterClaim = 0;
  let witchHolds = 0;
  let witchHoldTopWolf = 0;
  let witchHoldVetoed = 0;
  const witchHoldWolfGaps: number[] = [];
  let witchUnusedDiedEarly = 0;
  let witchUnusedNoTarget = 0;
  let witchUnusedMissedWolf = 0;
  let fakeFightGames = 0;
  const questionOutcomes: Record<QuestionOutcome, number> = {
    ANSWERED: 0,
    NOT_PARSED: 0,
    BLOCKED_ROOM: 0,
    NO_TURN: 0,
    DECLINED_SPOKE_OTHER: 0,
    DECLINED_SILENT: 0,
    UNDETERMINED: 0,
  };
  let questionOutcomeTotal = 0;
  const blockedByRoom: Record<SpeechBlockReason, number> = {
    BUDGET: 0,
    CHAIN_DEPTH: 0,
    REPLIES_PER_MESSAGE: 0,
  };

  const roleGames = new Map<Role, number>();
  const roleWins = new Map<Role, number>();
  // Chỉ hai phe có thể thắng, nên chỉ hai phe có độ chính xác phiếu để so.
  // Người chơi trung lập vẫn bỏ phiếu, nhưng "đúng" với họ không có nghĩa là
  // "trúng Sói" - gộp họ vào đây sẽ làm bẩn đúng chỉ số đang đo phe làng.
  const teamVoteCorrect: Record<VotingTeam, number> = { village: 0, wolves: 0 };
  const teamVoteTotal: Record<VotingTeam, number> = { village: 0, wolves: 0 };

  for (const game of games) {
    const teamOf = (playerId: string): Team | undefined => {
      const role = game.roles[playerId];
      return role === undefined ? undefined : roleTeam(role);
    };

    if (game.winner !== null) {
      finished += 1;
      // Bốn ô rời nhau: một ván đi vào ĐÚNG một ô, nên tổng bốn tử số luôn bằng
      // `finished`. Trộn Sát Nhân hay hoà vào ô của Dân/Sói sẽ làm cả bảng cân
      // bằng nói dối về đúng bộ bài mà nó được dựng ra để chấm.
      if (game.winner === "village") villageWins += 1;
      if (game.winner === "wolves") wolfWins += 1;
      if (game.winner === "serial_killer") killerWins += 1;
      if (game.winner === "draw") draws += 1;
      roundCounts.push(game.rounds);
    }

    if (game.violations.some((item) => item.id === "ROUND_LIMIT")) roundLimited += 1;

    // --- Vai chức năng (P2) ---
    {
      const isWolfRole = (id: string | null): boolean =>
        id !== null && (game.roles[id] === "WEREWOLF" || game.roles[id] === "WOLF_CUB");
      const witchId = Object.entries(game.roles).find(([, role]) => role === "WITCH")?.[0];
      if (witchId) {
        witchGames += 1;
        const poisoned = game.events.some(
          (e) => e.kind === "NIGHT_ACTION" && e.actorId === witchId && e.action === "POISON",
        );
        // Mọi đêm giữ bình, kể cả ở ván sau đó có dùng: `witchHoldTopWolfRate`
        // đo từng đêm, không đo từng ván.
        let everTopWolf = false;
        for (const e of game.events) {
          if (e.kind !== "WITCH_HOLD" || e.actorId !== witchId) continue;
          witchHolds += 1;
          if (e.vetoedByTrust) witchHoldVetoed += 1;
          if (isWolfRole(e.topSuspectId)) {
            witchHoldTopWolf += 1;
            witchHoldWolfGaps.push(e.threshold - e.topSuspicion);
            everTopWolf = true;
          }
        }
        if (!poisoned) {
          witchPoisonUnused += 1;
          const witchDied = game.events.some(
            (e) => e.kind === "DEATH" && e.playerId === witchId,
          );
          // Ba ngăn rời nhau, xét theo đúng thứ tự này: cơ hội bị bỏ lỡ được
          // ưu tiên, vì đó là ngăn duy nhất nói về một quyết định.
          if (everTopWolf) witchUnusedMissedWolf += 1;
          else if (witchDied) witchUnusedDiedEarly += 1;
          else witchUnusedNoTarget += 1;
        }
      }
      const seerId = Object.entries(game.roles).find(([, role]) => role === "SEER")?.[0];
      if (seerId) {
        seerGames += 1;
        const death = game.events.find((e) => e.kind === "DEATH" && e.playerId === seerId);
        const deathRound = death?.kind === "DEATH" ? death.round : null;
        const nightDeathRound =
          death?.kind === "DEATH" && death.cause !== "lynch" && death.cause !== "hunter"
            ? death.round
            : null;
        if (nightDeathRound === 2) seerDiedNightTwo += 1;

        const claimRounds = game.events
          .filter(
            (e) =>
              e.kind === "SPEECH" &&
              e.actorId === seerId &&
              (e.speech === "CLAIM_ROLE" || e.speech === "COUNTER_CLAIM") &&
              e.claimedRole === "SEER",
          )
          .map((e) => e.round);
        const claimedR1 = claimRounds.includes(1);
        if (claimedR1) seerClaimedRoundOne += 1;

        // "Còn sống bước vào đêm 2" = không chết ở vòng 1 (đêm 1 hay treo vòng
        // 1), và ván có vòng 2 để mà bước vào.
        const aliveIntoNight2 = (deathRound === null || deathRound >= 2) && game.rounds >= 2;
        if (aliveIntoNight2) {
          if (claimedR1) {
            seerClaimedR1AliveNight2 += 1;
            if (nightDeathRound === 2) seerClaimedR1DiedNight2 += 1;
          } else {
            seerUnclaimedR1AliveNight2 += 1;
            if (nightDeathRound === 2) seerUnclaimedR1DiedNight2 += 1;
          }
        }

        // Lời khai ĐẦU TIÊN mở cửa sổ rủi ro; khai lại không mở cửa sổ mới.
        // Đếm mỗi ván đúng một lần nên tử số không bao giờ vượt mẫu số.
        const firstClaim = claimRounds.length > 0 ? Math.min(...claimRounds) : null;
        if (
          firstClaim !== null &&
          (deathRound === null || deathRound > firstClaim) &&
          game.rounds > firstClaim
        ) {
          seerClaimedAliveNextNight += 1;
          if (nightDeathRound === firstClaim + 1) seerDiedNightAfterClaim += 1;
        }
      }
      for (const e of game.events) {
        if (e.kind === "QUESTION_OUTCOME") {
          questionOutcomes[e.outcome] += 1;
          questionOutcomeTotal += 1;
        } else if (e.kind === "SPEECH_BLOCKED") {
          blockedByRoom[e.reason] += 1;
        }
      }
      const wolves = new Set(
        Object.entries(game.roles)
          .filter(([, role]) => role === "WEREWOLF" || role === "WOLF_CUB")
          .map(([id]) => id),
      );
      const votersOn = new Map<string, Set<string>>();
      let fought = false;
      for (const e of game.events) {
        if (e.kind === "PHASE") {
          votersOn.clear();
          continue;
        }
        if (e.kind !== "VOTE" || e.targetId === null) continue;
        const seen = votersOn.get(e.targetId) ?? new Set<string>();
        if (
          wolves.has(e.voterId) &&
          wolves.has(e.targetId) &&
          [...seen].every((id) => id === e.voterId)
        ) {
          fought = true;
        }
        seen.add(e.voterId);
        votersOn.set(e.targetId, seen);
      }
      if (fought) fakeFightGames += 1;
    }
    boundaryViolations += game.violations.filter(
      (item) =>
        item.id === "ROLE_LEAK" ||
        item.id === "DEAD_ROLE_REVEALED" ||
        item.id === "WOLF_ALLY_SCOPE" ||
        item.id === "SEER_RESULT_SCOPE",
    ).length;
    fallbackActions += game.rejected;
    declinedTurns += game.skipped;

    // --- Vai và phe thắng ---
    //
    // Đếm theo VÁN, không theo người chơi. Một ván có hai con Sói không phải là
    // hai lần thắng của vai Sói; nếu đếm theo người thì tử số vượt mẫu số và
    // "tỉ lệ thắng" của vai Sói ra 200%.
    /*
     * Vai nào đã THẮNG RIÊNG trong ván này.
     *
     * Tra ngược qua `game.roles` chứ không đọc `win.role`: `seenRoles` ngay
     * dưới dựng từ `game.roles`, nên hai bên phải nói về cùng một bảng vai -
     * nếu không, một vai đã đổi giữa ván sẽ được cộng vào một khoá không có
     * trong mẫu số. `win.role` là đường lui khi bảng vai thiếu người đó.
     *
     * `?? []` vì `personalWins` là optional: báo cáo self-play ghi ra JSON
     * trước bản này không có trường đó, và một ván cũ đơn giản là không ai
     * thắng riêng - đúng sự thật của nó.
     */
    const personalWinRoles = new Set<Role>(
      (game.personalWins ?? []).map((win) => game.roles[win.playerId] ?? win.role),
    );

    const seenRoles = new Set<Role>(Object.values(game.roles));
    for (const role of seenRoles) {
      roleGames.set(role, (roleGames.get(role) ?? 0) + 1);
      /*
       * HAI đường thắng, và `Set` ở trên là thứ giữ cho chúng không cộng dồn:
       * một ván là một lần thắng của một vai, kể cả khi vai đó vừa thuộc phe
       * thắng vừa có thành tích riêng. Đó là cùng quy tắc "đếm theo VÁN" mà
       * chú thích ngay trên đã dựng ra - nếu không, tử số sẽ vượt mẫu số.
       *
       * Chỉ `roleWins` đọc thắng cá nhân. `winRate` ở trên KHÔNG, và không
       * được: nó trả lời "phe nào về nhất", một câu hỏi khác hẳn.
       */
      /*
       * `roleWonOutcome`, KHÔNG phải `roleTeam(role) === game.winner`.
       *
       * Phép so cũ đúng chừng nào mọi kết cục cũng là một `Team`. Với
       * `serial_killer` nó trả `false` cho chính kẻ vừa thắng (phe của vai đó
       * là `neutral`), và với `draw` thì nó cũng trả `false` cho mọi vai - vế
       * thứ hai là đúng và phải giữ, vế thứ nhất là một tỉ lệ thắng luôn bằng 0
       * cho vai duy nhất tự thắng được cả ván.
       */
      const wonByTeam = game.winner !== null && roleWonOutcome(role, game.winner);
      if (wonByTeam || personalWinRoles.has(role)) {
        roleWins.set(role, (roleWins.get(role) ?? 0) + 1);
      }
    }

    // --- Phiếu ---
    for (const event of game.events) {
      if (event.kind !== "VOTE") continue;
      voteTotal += 1;
      if (event.changed) voteChanges += 1;

      for (const item of event.evidence) {
        evidenceTotal += 1;
        if (PERMANENT_KINDS.has(item.kind)) continue;
        if (event.round - item.round > staleAfter) staleEvidence += 1;
      }
    }

    const byRound = finalVotesByRound(game.events);
    for (const [, voters] of byRound) {
      const tally = new Map<string, number>();
      for (const vote of voters.values()) {
        const key = vote.targetId ?? "\u0000none";
        tally.set(key, (tally.get(key) ?? 0) + 1);

        const voterTeam = teamOf(vote.voterId);
        if (voterTeam === undefined || vote.targetId === null) continue;
        /*
         * Vai TRUNG LẬP bị loại khỏi cả hai chỉ số phiếu, sau khi đã được tính
         * vào `tally` ở trên (đồng thuận là chuyện của cả bàn).
         *
         * Nhánh `else` ngay dưới đọc "không phải làng" thành "là Sói": nó cộng
         * phiếu của người bỏ vào `wolfSignals`. Để một Thằng Hề rơi vào đó thì
         * `wolfSelfSabotage` - chỉ số đo Sói có tự bán đồng bọn không - sẽ đếm
         * cả những lá phiếu chẳng liên quan gì tới bầy Sói.
         */
        if (voterTeam === "neutral") continue;
        const targetIsWolf = teamOf(vote.targetId) === "wolves";

        teamVoteTotal[voterTeam] += 1;
        if (targetIsWolf) teamVoteCorrect[voterTeam] += 1;

        if (voterTeam === "village") {
          villageVotes += 1;
          if (targetIsWolf) villageCorrect += 1;
        } else {
          wolfSignals += 1;
          if (targetIsWolf) wolfBetrayals += 1;
        }
      }

      if (voters.size > 0) {
        const leader = Math.max(...tally.values());
        consensusSamples.push(leader / voters.size);
      }
    }

    // --- Quyền năng dùng một lần (Phù Thuỷ, Thợ Săn) ---
    //
    // Bốn con số dưới đây đo thứ mà unit test không nhìn thấy được: test dựng
    // sẵn một belief đã vượt ngưỡng rồi kiểm nhánh, nên một ngưỡng KHÔNG BAO
    // GIỜ với tới trong ván thật vẫn cho test xanh. Chỉ tần suất đo trên ván
    // đầy đủ mới phân biệt được "hiếm vì đắt" với "chết vì bất khả thi".
    const wolfTargetsByRound = new Map<number, Set<string>>();
    for (const event of game.events) {
      if (event.kind !== "NIGHT_ACTION" || event.action !== "KILL") continue;
      if (event.targetId === null) continue;
      const bucket = wolfTargetsByRound.get(event.round) ?? new Set<string>();
      bucket.add(event.targetId);
      wolfTargetsByRound.set(event.round, bucket);
    }

    for (const event of game.events) {
      if (event.kind === "HUNTER_SHOT") {
        hunterReactions += 1;
        if (event.targetId !== null) {
          hunterShots += 1;
          if (teamOf(event.targetId) === "wolves") hunterShotsOnWolf += 1;
        }
        continue;
      }

      if (event.kind === "SKIP") {
        continue;
      }

      if (event.kind !== "NIGHT_ACTION") continue;

      if (game.roles[event.actorId] !== "WITCH") continue;
      // SKIP nằm TRONG mẫu số: nó là một lượt Phù Thuỷ đã được hỏi và đã trả
      // lời. Bỏ nó ra thì tỉ lệ dùng bình luôn bằng 1 và không đo được gì.
      if (event.action !== "HEAL" && event.action !== "POISON" && event.action !== "SKIP") {
        continue;
      }
      witchTurns += 1;

      if (event.action === "HEAL") {
        witchHeals += 1;
        // Engine không nhận mục tiêu cho bình cứu - nó luôn cứu nạn nhân đêm
        // đó - nên người được cứu phải suy ra từ mục tiêu của bầy Sói.
        if (wolfTargetsByRound.get(event.round)?.has(event.actorId)) witchSelfHeals += 1;
      }

      if (event.action === "POISON") {
        witchPoisons += 1;
        if (event.targetId !== null && teamOf(event.targetId) === "wolves") {
          witchPoisonsOnWolf += 1;
        }
      }
    }

    // --- Lời nói ---
    const lastSpeech = new Map<string, string>();
    /** Mọi câu một BOT đã nói trong ván này, theo ba dạng vân tay. */
    const saidExact = new Map<string, Set<string>>();
    const saidNormalized = new Map<string, Set<string>>();
    const saidSemantic = new Map<string, Set<string>>();
    const lastOpening = new Map<string, string | null>();
    /** Mọi cách mở đầu một BOT đã dùng trong ván này. */
    const openingsSeen = new Map<string, Set<string>>();
    const lastTarget = new Map<string, string | null>();
    /** Câu hỏi nhắm thẳng vào một người: messageId -> người được hỏi. */
    const directQuestions = new Map<string, string>();
    const answeredQuestions = new Set<string>();
    const perBotPerRound = new Map<string, number>();

    const remember = (
      table: Map<string, Set<string>>,
      actorId: string,
      key: string,
    ): boolean => {
      const seen = table.get(actorId) ?? new Set<string>();
      const repeated = seen.has(key);
      seen.add(key);
      table.set(actorId, seen);
      return repeated;
    };

    /** Ván này có ít nhất một lời phản bác (`COUNTER_CLAIM`) hay không. */
    let gameHasCounterClaim = false;
    let gameClaimCount = 0;

    for (const [eventIndex, event] of game.events.entries()) {
      if (event.kind === "SPEECH") {
        speechTotal += 1;
        const signature = `${event.speech}:${event.targetId ?? "-"}`;
        if (lastSpeech.get(event.actorId) === signature) speechRepeats += 1;
        lastSpeech.set(event.actorId, signature);

        // --- Lặp thật ---
        if (remember(saidExact, event.actorId, event.text)) exactRepeats += 1;
        if (remember(saidNormalized, event.actorId, normalizeSpeechText(event.text))) {
          normalizedRepeats += 1;
        }
        if (remember(saidSemantic, event.actorId, event.semanticFingerprint)) {
          semanticRepeats += 1;
        }

        const opening = openingOf(event.text);
        if (opening !== null && lastOpening.get(event.actorId) === opening) {
          openingRepeats += 1;
        }
        lastOpening.set(event.actorId, opening);
        if (opening !== null && !remember(openingsSeen, event.actorId, opening)) {
          distinctOpenings += 1;
        }
        // Báo cáo JSON lưu trước khi có cờ này không mang nó; thiếu cờ nghĩa là
        // self-play cũ, tức bảng mẫu.
        if (event.fromTemplate !== false) fromTemplateCount += 1;
        if (looksCasual(event.text)) casualLines += 1;

        if (event.targetId !== null && lastTarget.get(event.actorId) === event.targetId) {
          sameTargetRuns += 1;
        }
        lastTarget.set(event.actorId, event.targetId);

        // --- Mức độ đối thoại ---
        if (event.replyToMessageId !== null) {
          replies += 1;
          const asked = directQuestions.get(event.replyToMessageId);
          // Chỉ tính là ĐÃ ĐÁP khi đúng người được hỏi trả lời. Người thứ ba
          // xen vào không phải là câu hỏi được trả lời.
          if (asked === event.actorId) answeredQuestions.add(event.replyToMessageId);
        }
        if (
          (event.speech === "QUESTION" || event.speech === "ASK_EVIDENCE") &&
          event.targetId !== null
        ) {
          directQuestions.set(event.messageId, event.targetId);
        }

        chainMax = Math.max(chainMax, event.chainDepth);
        const dayKey = `${event.round}:${event.actorId}`;
        perBotPerRound.set(dayKey, (perBotPerRound.get(dayKey) ?? 0) + 1);

        // Sói công khai tố đồng bọn cũng là tự phá.
        const actorTeam = teamOf(event.actorId);
        if (
          actorTeam === "wolves" &&
          event.speech === "ACCUSE" &&
          event.targetId !== null &&
          teamOf(event.targetId) === "wolves"
        ) {
          wolfSignals += 1;
          wolfBetrayals += 1;
        } else if (actorTeam === "wolves" && event.speech === "ACCUSE") {
          wolfSignals += 1;
        }

        // --- Lời khai vai (Phase 5) ---
        if (event.speech === "CLAIM_ROLE" || event.speech === "COUNTER_CLAIM") {
          gameClaimCount += 1;
          if (event.speech === "COUNTER_CLAIM") gameHasCounterClaim = true;

          if (event.targetId !== null) {
            claimPointTotal += 1;
            const followed = claimWasFollowed(
              game.events,
              eventIndex,
              event.round,
              event.targetId,
              game.roles,
            );
            if (followed) claimPointFollowed += 1;

            // `claimAccuracy` chỉ xét lời khai TIÊN TRI - `claimedRole` là vai
            // được KHAI, không phải vai thật; một con Sói khai láo cũng mang
            // "SEER" ở đây, và đó chính xác là trường hợp cần đối chiếu.
            if (event.claimedRole === "SEER" && followed) {
              seerClaimsBelieved += 1;
              if (game.roles[event.actorId] === "SEER") seerClaimsAccurate += 1;
            }

            // §17: cùng một lời khai Tiên Tri, nhìn từ phía bầy Sói. Mẫu số là
            // MỌI lần Sói khai láo, kể cả lần không ai tin - nếu không thì một
            // cơ chế làm Sói khai ít đi mà chuẩn hơn sẽ đọc ra y hệt một cơ chế
            // làm Sói khai đúng bằng ấy lần mà thuyết phục hơn.
            if (event.claimedRole === "SEER" && teamOf(event.actorId) === "wolves") {
              wolfBluffClaims += 1;
              if (followed) wolfBluffBelieved += 1;
            }
          }
        }

        continue;
      }

      if (event.kind === "COALITION") cohesionSamples.push(event.cohesion);
    }

    claimCounts.push(gameClaimCount);
    if (gameHasCounterClaim) counterClaimGames += 1;

    directQuestionTotal += directQuestions.size;
    directQuestionAnswered += answeredQuestions.size;
    for (const count of perBotPerRound.values()) botDaySamples.push(count);

    // --- Im lặng ---
    //
    // Mẫu số là số cặp (vòng, người CÒN SỐNG), không phải số người trên bàn:
    // một người chết ở vòng 2 không "im lặng" ở vòng 5. Không lọc theo sống
    // chết thì chỉ số này chỉ đo được số người đã chết.
    const diedAtRound = new Map<string, number>();
    for (const event of game.events) {
      if (event.kind !== "DEATH") continue;
      if (!diedAtRound.has(event.playerId)) diedAtRound.set(event.playerId, event.round);
    }
    for (let round = 1; round <= game.rounds; round += 1) {
      for (const playerId of Object.keys(game.roles)) {
        const died = diedAtRound.get(playerId);
        if (died !== undefined && died < round) continue;
        silenceOpportunities += 1;
        if (!perBotPerRound.has(`${round}:${playerId}`)) silentBotDays += 1;
      }
    }
  }

  const overall: SelfPlayMetrics = {
    games: games.length,
    finished,
    winRate: {
      village: ratio(villageWins, finished),
      wolves: ratio(wolfWins, finished),
      serial_killer: ratio(killerWins, finished),
      draw: ratio(draws, finished),
    },
    averageRounds: mean(roundCounts),
    villageVoteAccuracy: ratio(villageCorrect, villageVotes),
    wolfSelfSabotage: ratio(wolfBetrayals, wolfSignals),
    hunterShotRate: ratio(hunterShots, hunterReactions),
    hunterShotAccuracy: ratio(hunterShotsOnWolf, hunterShots),
    witchHealRate: ratio(witchHeals, witchTurns),
    witchHealSelfRate: ratio(witchSelfHeals, witchHeals),
    witchPoisonRate: ratio(witchPoisons, witchTurns),
    witchPoisonAccuracy: ratio(witchPoisonsOnWolf, witchPoisons),
    witchPoisonUnusedRate: ratio(witchPoisonUnused, witchGames),
    seerDiedNightTwoRate: ratio(seerDiedNightTwo, seerGames),
    seerClaimedRoundOneRate: ratio(seerClaimedRoundOne, seerGames),
    seerClaimedR1DiedNightTwoRate: ratio(seerClaimedR1DiedNight2, seerClaimedR1AliveNight2),
    seerUnclaimedR1DiedNightTwoRate: ratio(
      seerUnclaimedR1DiedNight2,
      seerUnclaimedR1AliveNight2,
    ),
    seerDiedNightAfterClaimRate: ratio(seerDiedNightAfterClaim, seerClaimedAliveNextNight),
    witchHoldTopWolfRate: ratio(witchHoldTopWolf, witchHolds),
    witchHoldWolfGapMean: mean(witchHoldWolfGaps),
    witchHoldVetoedByTrustRate: ratio(witchHoldVetoed, witchHolds),
    witchPoisonUnusedDiedEarlyRate: ratio(witchUnusedDiedEarly, witchPoisonUnused),
    witchPoisonUnusedNoTargetRate: ratio(witchUnusedNoTarget, witchPoisonUnused),
    witchPoisonUnusedTopWolfBelowBarRate: ratio(witchUnusedMissedWolf, witchPoisonUnused),
    wolfFakeFightRate: ratio(fakeFightGames, games.length),
    voteChangeRate: ratio(voteChanges, voteTotal),
    consensus: mean(consensusSamples),
    coalitionCohesion: mean(cohesionSamples),
    staleEvidenceRate: ratio(staleEvidence, evidenceTotal),
    knowledgeBoundaryViolations: boundaryViolations,
    fallbackActions,
    declinedTurns,
    speechRepetitionRate: ratio(speechRepeats, speechTotal),
    roundLimitRate: ratio(roundLimited, games.length),

    exactRepetitionRate: ratio(exactRepeats, speechTotal),
    normalizedRepetitionRate: ratio(normalizedRepeats, speechTotal),
    semanticRepetitionRate: ratio(semanticRepeats, speechTotal),
    repeatedOpeningRate: ratio(openingRepeats, speechTotal),
    distinctOpeningRate: ratio(distinctOpenings, speechTotal),
    consecutiveSameTargetRate: ratio(sameTargetRuns, speechTotal),
    replyRate: ratio(replies, speechTotal),
    directQuestionResponseRate: ratio(directQuestionAnswered, directQuestionTotal),
    messagesPerBotPerDay: mean(botDaySamples),
    maxDialogueChainLength: chainMax,
    /**
     * Ngày mà một người còn sống không nói câu nào.
     *
     * Đo cùng lúc với các chỉ số lặp, và đó là điểm mấu chốt: cách dễ nhất để
     * ép mọi tỉ lệ lặp về 0 là bịt miệng BOT. Nếu `silenceRate` leo lên cùng
     * lúc các chỉ số lặp đẹp đi thì cơ chế chống lặp đang siết quá tay, và
     * không có chỉ số nào khác nhìn thấy điều đó.
     */
    silenceRate: ratio(silentBotDays, silenceOpportunities),
    directQuestionOutcomes: {
      ANSWERED: ratio(questionOutcomes.ANSWERED, questionOutcomeTotal),
      NOT_PARSED: ratio(questionOutcomes.NOT_PARSED, questionOutcomeTotal),
      BLOCKED_ROOM: ratio(questionOutcomes.BLOCKED_ROOM, questionOutcomeTotal),
      NO_TURN: ratio(questionOutcomes.NO_TURN, questionOutcomeTotal),
      DECLINED_SPOKE_OTHER: ratio(questionOutcomes.DECLINED_SPOKE_OTHER, questionOutcomeTotal),
      DECLINED_SILENT: ratio(questionOutcomes.DECLINED_SILENT, questionOutcomeTotal),
      UNDETERMINED: ratio(questionOutcomes.UNDETERMINED, questionOutcomeTotal),
    },
    speechBlockedByRoom: blockedByRoom,
    /**
     * Trong self-play, con số này luôn bằng 1 THEO THIẾT KẾ.
     *
     * Nhân mô phỏng là thuần và không gọi mạng, nên mọi câu đều do bảng mẫu
     * sinh ra. Đếm theo cờ trên từng câu chứ không viết hằng số, để một bản ghi
     * nhập từ production (nơi có nhà cung cấp để mà hỏng) đọc ra số thật.
     */
    fromTemplateRate: ratio(fromTemplateCount, speechTotal),
    casualToneRate: ratio(casualLines, speechTotal),

    claimsPerGame: mean(claimCounts),
    counterClaimRate: ratio(counterClaimGames, games.length),
    claimFollowRate: ratio(claimPointFollowed, claimPointTotal),
    claimAccuracy: ratio(seerClaimsAccurate, seerClaimsBelieved),
    wolfBluffBelievedRate: ratio(wolfBluffBelieved, wolfBluffClaims),

    humanAccuseSeenRate: ratio(humanChat.accuseSeen, humanChat.accuseTotal),
    humanDefendSeenRate: ratio(humanChat.defendSeen, humanChat.defendTotal),
    humanClaimSeenRate: ratio(humanChat.claimSeen, humanChat.claimTotal),
    humanTrapIgnoredRate: ratio(humanChat.trapIgnored, humanChat.trapTotal),
    humanQuestionSeenRate: ratio(humanChat.questionSeen, humanChat.questionTotal),
    humanAddressTrapIgnoredRate: ratio(humanChat.addressTrapIgnored, humanChat.addressTrapTotal),
  };

  const byTeam: Record<VotingTeam, TeamMetrics> = {
    village: {
      team: "village",
      wins: overall.winRate.village,
      voteAccuracy: ratio(teamVoteCorrect.village, teamVoteTotal.village),
    },
    wolves: {
      team: "wolves",
      wins: overall.winRate.wolves,
      voteAccuracy: ratio(teamVoteCorrect.wolves, teamVoteTotal.wolves),
    },
  };

  const byRole: RoleMetrics[] = [...roleGames.entries()]
    // Sắp xếp theo tên vai để hai lần chạy cho ra cùng thứ tự - thứ tự chèn của
    // Map phụ thuộc vào ván nào chạy trước, và đó là một nguồn khác biệt giả.
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, count]) => ({
      role,
      games: count,
      wins: ratio(roleWins.get(role) ?? 0, count),
    }));

  return { overall, byTeam, byRole };
}
