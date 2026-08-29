import type { ConversationWeights } from "../config/weights";

/**
 * Hai trần giữ một cuộc đối đáp khỏi biến thành một vòng lặp.
 *
 * `maxRepliesPerMessage` và `maxChainDepth` là luật của CĂN PHÒNG, không phải
 * của một con BOT: một BOT không biết - và không nên biết - cả phòng đã đáp một
 * câu bao nhiêu lần. Vì vậy chúng không sống trong `BotRuntime` mà ở chỗ nào
 * đang cầm sổ của phòng: harness self-play, và scheduler phía server.
 *
 * Hai chỗ đó có nhịp khác nhau và không dùng chung được kế toán, nhưng chúng
 * PHẢI dùng chung một định nghĩa. Nếu mỗi bên tự đếm lấy thì "chuỗi sâu nhất là
 * 3" trong báo cáo self-play không nói được điều gì về phòng thật - và đó chính
 * là chỗ đã sai một lần rồi.
 *
 * THUẦN: không RNG, không đồng hồ, không state ẩn.
 */

/** Sổ hội thoại của một vòng, do chỗ gọi giữ. */
export interface ChainLedger {
  /**
   * Độ sâu của những message đã phát.
   *
   * Vắng mặt nghĩa là GỐC (độ sâu 0), chứ không phải lỗi: câu của người thật và
   * câu có từ trước khi phiên mở đều không nằm trong sổ, và cả hai đều là gốc.
   */
  readonly depthOf: ReadonlyMap<string, number>;
  /** Số phản hồi mỗi message đã nhận. Vắng mặt nghĩa là chưa ai đáp. */
  readonly repliesTo: ReadonlyMap<string, number>;
}

export type ChainBlockReason = "CHAIN_DEPTH" | "REPLIES_PER_MESSAGE";

export interface ChainPosition {
  /** Độ sâu câu này SẼ có nếu được phát. Câu tự mở lời là 0. */
  depth: number;
  /** Số phản hồi cha đang có, để chỗ gọi cộng dồn mà không phải đếm lại. */
  parentReplies: number;
  /** `null` là được phát. */
  blockedBy: ChainBlockReason | null;
}

/**
 * Chỗ của một câu sắp nói trong cây hội thoại, và nó có được nói hay không.
 *
 * Gọi TRƯỚC khi hỏi nhà cung cấp. Trần tồn tại để tiết kiệm cả sự chú ý của
 * người chơi lẫn tiền gọi API; chặn sau khi đã trả tiền viết câu thì chỉ còn
 * tiết kiệm được một nửa.
 */
export function judgeChainPosition(
  replyToMessageId: string | undefined,
  ledger: ChainLedger,
  weights: ConversationWeights,
): ChainPosition {
  if (replyToMessageId === undefined) {
    // Tự mở lời: luôn là gốc, và không trần nào của CHUỖI áp được lên nó. Hạn
    // mức mỗi BOT và trần tổng của phòng là chuyện khác, do chỗ gọi giữ.
    return { depth: 0, parentReplies: 0, blockedBy: null };
  }

  const depth = (ledger.depthOf.get(replyToMessageId) ?? 0) + 1;
  const parentReplies = ledger.repliesTo.get(replyToMessageId) ?? 0;

  // Độ sâu xét trước: khi chạm cả hai trần thì đó là trần chặt hơn, và là lý do
  // đúng hơn để ghi vào log.
  if (depth > weights.maxChainDepth) {
    return { depth, parentReplies, blockedBy: "CHAIN_DEPTH" };
  }
  if (parentReplies >= weights.maxRepliesPerMessage) {
    return { depth, parentReplies, blockedBy: "REPLIES_PER_MESSAGE" };
  }
  return { depth, parentReplies, blockedBy: null };
}
