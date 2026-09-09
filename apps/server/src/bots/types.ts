import type { DefenseStance } from "@masoi/game-engine";
import type { BotSpeechIntention, BotSpeechStyle } from "@masoi/game-engine";
import type { SpeechSource } from "./speech-stats";

/**
 * Hành động đêm engine chấp nhận.
 *
 * Phải khớp ĐÚNG union của `GameEngine.submitNightAction`. Union này từng thiếu
 * `SKIP` — vô hại khi chỉ có provider sinh hành động, nhưng sai ngay khi lõi
 * deterministic tiếp quản, vì Phù Thuỷ chủ động bỏ lượt là một nước đi thật.
 *
 * `DETECTIVE_CHECK` và `SORCERER_CHECK` đến từ các vai mở rộng (Thám Tử, Sói
 * Pháp Sư), và `SERIAL_KILL` từ Sát Nhân - một mã RIÊNG, không dùng lại `KILL` của bầy Sói:
 * hai kỹ năng khác luật, khác nhịp và khác trạng thái, nên một mã dùng chung sẽ
 * buộc engine phân giải theo vai người gửi. `TRACK` từ Kẻ Theo Dõi.
 */
export type NightActionType =
  | "KILL"
  | "SEE"
  | "GUARD"
  | "HEAL"
  | "POISON"
  | "SKIP"
  | "DETECTIVE_CHECK"
  | "SORCERER_CHECK"
  | "SERIAL_KILL"
  | "TRACK";

export interface NightDecision {
  action: NightActionType;
  /** null với HEAL và SKIP, vì engine không nhận mục tiêu cho hai cái đó */
  targetId: string | null;
  /** Chỉ Thám Tử dùng (soi hai người); các hành động khác để trống. */
  secondaryTargetId?: string | null;
}

/**
 * Lá phiếu bot định bỏ. Là union chứ không phải một string nullable vì
 * "không treo ai" là một lựa chọn có chủ ý, ngang hàng với việc chọn một
 * người - gộp nó vào null sẽ lẫn với "chưa quyết được", và chỗ gọi phải xử
 * lý hai thứ đó khác nhau.
 */
export type PlannedVote =
  | { type: "PLAYER"; targetId: string }
  | { type: "NO_ELIMINATION" };

/**
 * Một mẩu bằng chứng đã được rút gọn để đọc thành lời. Chỉ có source ID và một
 * câu tóm tắt: LLM không cần - và không được - biết weight hay confidence.
 */
export interface RenderableEvidence {
  sourceId: string;
  summary: string;
}

/**
 * Yêu cầu diễn đạt một quyết định ĐÃ CHỐT.
 *
 * Cố tình KHÔNG chứa `RoomSnapshot`, bảng role hay danh sách mục tiêu hợp lệ:
 * nếu LLM không nhìn thấy lựa chọn nào khác thì nó không có gì để đổi. Mục tiêu
 * và bằng chứng ở đây đã do lõi deterministic quyết xong.
 */
export interface SpeechRequest {
  /** Chỉ để governor tính ngân sách theo phòng; không phải thông tin ván đấu. */
  roomCode: string;
  speaker: { id: string; name: string };
  /**
   * Phong cách nói, dẫn xuất từ `BotPersonality` THẬT.
   *
   * Thay `personalityStyle: string` của Phase 3, vốn là một trong bốn nhãn cứng
   * gieo từ `botId` và hoàn toàn tách rời tính cách mà lõi đang dùng để quyết
   * định. Trong một bàn tám BOT, trung bình hai con dùng chung một nhãn.
   */
  style: BotSpeechStyle;
  /** Cùng phong cách đó, viết thành một câu tiếng Việt cho prompt. */
  styleDescription: string;
  intention: BotSpeechIntention;
  evidence: RenderableEvidence[];
  /** Tên hiển thị của mục tiêu, hoặc null khi ý định không nhắm vào ai. */
  targetName: string | null;
  /** Câu chat cụ thể đang được trả lời, nếu có. */
  replyTo: { messageId: string; actorName: string; text: string } | null;
  /** Vài câu gần nhất của CHÍNH BOT, để nó không diễn đạt lại chính mình. */
  recentOwnLines: string[];
  /** Cửa sổ chat đã lọc, đủ để hiểu ngữ cảnh và không hơn. */
  chatWindow: Array<{ actorName: string; text: string; isSelf: boolean }>;
  /** Cách mở đầu cần tránh. */
  avoidOpenings: string[];
  /** Source đã dùng gần đây, đã CẮT theo cửa sổ chứ không phải cả ván. */
  recentSpeechSourceIds: string[];
  /**
   * Lập trường mà chính BOT đã CÔNG KHAI nêu về mục tiêu của lượt này, hoặc
   * `null` khi nó chưa từng nói gì về người đó (COMMUNICATION §15).
   *
   * Không phải thông tin riêng: nó được dựng lại từ chính những câu BOT đã phát
   * ra giữa phòng và những lá phiếu nó đã bỏ công khai. Cả bàn đã thấy hết.
   *
   * Có mặt trong prompt vì đây là chỗ DUY NHẤT chặn được lỗi mà §15 nêu đích
   * danh - mô hình viết "tôi tin A từ đầu" khi vòng trước chính nó đã tố A.
   * Lõi có thể chọn `CHANGE_MIND`, nhưng nó không kiểm soát được câu chữ; chỉ
   * một dòng trong prompt mới làm được.
   */
  priorStance: {
    /** Tên hiển thị của người đang được nói tới. */
    subjectName: string;
    stance: "trust" | "suspect";
    /** Vòng đầu tiên của mạch lập trường đó. */
    sinceRound: number;
  } | null;
  /** Lượt nói thứ mấy của BOT này; nguồn biến thiên của bảng mẫu. */
  seq: number;
  round: number;
  /**
   * Danh sách người chơi mà cổng `CLAIM_INTEGRITY` cần để chạy `analyzeChat`.
   *
   * Chỉ `{ id, name, alive }` — đúng cái parser đòi. Không mang vai, không
   * mang gì khác: đây là dữ liệu cho một phép kiểm ở server, và nó KHÔNG bao
   * giờ đi vào prompt.
   */
  players: Array<{ id: string; name: string; alive: boolean }>;
  /**
   * Khác `null` ĐÚNG ở lượt tự bào chữa (pha DEFENSE): số phiếu công khai đang
   * đè lên chính bị cáo, và tên những người khác cũng đang bị nhắm.
   *
   * Cả hai đã công khai ở pha này - `RoomSnapshot`/`BotKnowledgeView` lộ số
   * phiếu theo mục tiêu cho MỌI người chơi, không riêng gì bị cáo - nên đưa
   * chúng vào prompt không phải một rò rỉ. Khác hẳn `roleContext` cũ (đã bị bỏ
   * khỏi prompt bào chữa): cái đó đưa VAI THẬT vào, thứ không ai được thấy.
   */
  defense: {
    votesAgainstMe: number;
    alsoAccused: string[];
    /**
     * Bị cáo này có đang cố sống hay không - do LÕI quyết, không do prompt đoán.
     *
     * Trước đây trường này không tồn tại và tầng diễn đạt tự giả định
     * "SURVIVE": mọi lượt bào chữa đều kèm câu "hãy thuyết phục làng đừng treo
     * bạn". Với Thằng Hề, đó là chỉ thị làm hỏng đúng điều kiện thắng của nó.
     */
    stance: DefenseStance;
  } | null;
}

/** Kết quả một lượt diễn đạt, kèm nguồn gốc của câu chữ để còn đo được. */
export interface RenderedSpeech {
  text: string | null;
  /** `true` khi câu đến từ bảng mẫu chứ không phải nhà cung cấp. */
  fromTemplate: boolean;
  /**
   * Đường đã đi để ra được câu này - hoặc ra im lặng. Chi tiết hơn
   * `fromTemplate`: nói được VÌ SAO rơi về bảng mẫu. Xem `SpeechSource`.
   */
  source: SpeechSource;
}

/**
 * Kết quả duy nhất mà nhà cung cấp được trả về cho ban ngày: một câu nói.
 * Không có mục tiêu, không có phiếu - gameplay đã được chốt trước khi hỏi.
 */
export interface DaySpeechDecision {
  chat: string | null;
}

/**
 * Kết quả một lượt hỏi não bot.
 *
 * Trước đây cả hai tình huống dưới đây đều trả null, nên chỗ gọi không phân biệt
 * được. Điều đó vô hại khi chỉ có một não, nhưng thành sai ngay khi có não dự
 * phòng: "bot đã chết, không cần nói" mà bị coi là hỏng thì bot chết vẫn được
 * mang đi hỏi nhà cung cấp thứ hai - tốn tiền, thêm độ trễ, và có thể phát ra
 * lời thoại của người đáng lẽ im lặng.
 *
 *  - { ok: true, value: X }    quyết định được X
 *  - { ok: true, value: null } chủ động không làm gì (đã chết, không còn mục
 *                              tiêu hợp lệ, Phù Thuỷ chọn SKIP) - KHÔNG fallback
 *  - { ok: false }             gọi hỏng (429, timeout, JSON hỏng, mục tiêu bậy)
 *                              - chỗ gọi nên thử não kế tiếp
 */
export type Attempt<T> = { ok: true; value: T | null } | { ok: false };

/**
 * Kết quả của một não không thể hỏng (không gọi mạng). Vẫn gán được vào
 * BotBrain, nhưng chỗ gọi trực tiếp khỏi phải kiểm tra một nhánh không tồn tại.
 */
export type Always<T> = { ok: true; value: T | null };

// Trả Always chứ không phải Attempt: cả hai đều là nhánh thành công, nên não
// không thể hỏng vẫn dùng lại được chúng mà giữ nguyên kiểu hẹp.
export const nothingToDo = <T>(): Always<T> => ({ ok: true, value: null });
export const decided = <T>(value: T): Always<T> => ({ ok: true, value });
export const failed = <T>(): Attempt<T> => ({ ok: false });

/**
 * Bộ não của bot — CHỈ SINH LỜI NÓI.
 *
 * Từ Phase 2, interface này không còn method nào trả về một nước đi. Mọi quyết
 * định gameplay (hành động đêm, phát bắn Thợ Săn, phiếu Treo/Tha, phiếu đề cử)
 * do lõi deterministic trong `@masoi/game-engine` chốt trước, và nhà cung cấp
 * chỉ được diễn đạt lại.
 *
 * Đây là một ràng buộc về KIỂU, không phải một quy ước: không có chữ ký nào để
 * gọi, thì không có đường nào để một mô hình ngôn ngữ lái ván đấu.
 *
 * Lượt tự bào chữa KHÔNG còn method riêng (`decideDefense` cũ đã bỏ). Nó đi
 * qua đúng `renderDaySpeech`, như mọi lời nói khác: lõi quyết ý định (khai vai
 * hay không), gói nó vào một `SpeechRequest` bình thường - chỉ khác ở trường
 * `defense` - rồi hỏi nhà cung cấp CÙNG một hàm. Nhờ vậy cổng `CLAIM_INTEGRITY`
 * và bảng mẫu dự phòng ở `speech-renderer.ts` áp dụng cho cả lượt bào chữa,
 * thứ trước đây hoàn toàn đứng ngoài hai lớp phòng thủ này.
 */
export interface BotBrain {
  readonly name: string;
  /**
   * Diễn đạt một ý định đã chốt - ban ngày hay bào chữa đều qua đây. Thay cho
   * `decideDay` cũ: nhà cung cấp không còn được chọn mục tiêu hay lá phiếu nào
   * nữa.
   */
  renderDaySpeech(request: SpeechRequest): Promise<Attempt<DaySpeechDecision>>;
}
