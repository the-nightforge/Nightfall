import type { BotPersonality } from "../types";

/**
 * Tính cách → cách nói.
 *
 * Trước Phase 4, giọng của BOT đến từ `personaFor(botId)`: bốn nhãn cứng gieo
 * từ ID, hoàn toàn tách rời `BotPersonality` mà lõi vẫn đang dùng để quyết
 * định. Hệ quả là một BOT "ít nói" theo nhãn có thể có `talkativeness = 0.9`,
 * và trong một bàn tám BOT thì trung bình hai con dùng chung một nhãn.
 *
 * Module này là hàm THUẦN của `BotPersonality`. Personality được sinh một lần
 * trong constructor của `BotRuntime` từ RNG đã gieo hạt, nên phong cách ổn định
 * suốt ván và tái lập được theo seed mà không cần lưu thêm state nào.
 *
 * **Không phải difficulty.** Mọi trường ở đây chỉ ảnh hưởng *cách nói* và *tần
 * suất nói*. Không module quyết định gameplay nào được import file này — có
 * test kiểm bằng đồ thị import.
 */

export interface BotSpeechStyle {
  /** Câu ngắn hay câu dài. */
  verbosity: "TERSE" | "NORMAL" | "TALKATIVE";
  /** Mềm mỏng hay lạnh lùng. */
  warmth: "COLD" | "NEUTRAL" | "WARM";
  /** Mức trang trọng. `CASUAL` cho phép từ đệm và câu cụt. */
  formality: "CASUAL" | "PLAIN";
  /** Cách xưng hô. */
  address: "TÔI_BẠN" | "TỚ_CẬU" | "MÌNH_ÔNG";
  /** Xu hướng pha trò. */
  humor: number;
  /** Gay gắt khi công kích. */
  harshness: number;
  /** Hay hỏi thay vì hay khẳng định. */
  inquisitive: number;
  /** Khả năng thừa nhận mình sai và đổi ý. */
  concession: number;
  /** Xác suất nền khi có người nói với mình. */
  responsiveness: number;
  /** Xu hướng tự mở lời khi không ai gọi tới. */
  initiative: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Ngưỡng ba mức.
 *
 * `0.35 / 0.65` chứ không `0.33 / 0.66`: `personalityRange` mặc định là
 * `[0.25, 0.9]`, nên chia đều theo `[0,1]` sẽ cho ra một phân bố lệch hẳn về
 * phía trên và gần như không BOT nào rơi vào mức thấp nhất.
 */
function band<T>(value: number, low: T, mid: T, high: T): T {
  if (value < 0.35) return low;
  if (value < 0.65) return mid;
  return high;
}

export function deriveSpeechStyle(personality: BotPersonality): BotSpeechStyle {
  const {
    aggressiveness,
    talkativeness,
    riskTolerance,
    deceptionSkill,
    analyticalSkill,
    loyalty,
    stubbornness,
  } = personality;

  // Ấm áp là hiệu của trung thành và hung hăng, quy về [0,1]. Một người vừa
  // trung thành vừa hung hăng thì trung tính - đúng như trực giác: họ nồng
  // nhiệt với phe mình và gay gắt với người ngoài.
  const warmthScore = clamp01(0.5 + (loyalty - aggressiveness) / 2);
  const humor = clamp01(riskTolerance * 0.5 + talkativeness * 0.5);

  return {
    verbosity: band(talkativeness, "TERSE", "NORMAL", "TALKATIVE"),
    warmth: band(warmthScore, "COLD", "NEUTRAL", "WARM"),
    // Người khéo che giấu nói năng chỉn chu hơn; người vụng nói thẳng tuột.
    formality: deceptionSkill >= 0.6 ? "PLAIN" : "CASUAL",
    address:
      warmthScore >= 0.6 && humor >= 0.5
        ? "TỚ_CẬU"
        : warmthScore < 0.35
          ? "TÔI_BẠN"
          : "MÌNH_ÔNG",
    humor,
    harshness: clamp01(aggressiveness),
    inquisitive: clamp01(analyticalSkill),
    concession: clamp01(1 - stubbornness),
    // Sàn 0.35: kể cả người kiệm lời nhất cũng đáp khi bị gọi thẳng tên. Không
    // có sàn thì một BOT `talkativeness` thấp câm suốt ván, và đó là bug chứ
    // không phải tính cách.
    responsiveness: clamp01(0.35 + talkativeness * 0.5 + analyticalSkill * 0.15),
    initiative: clamp01(talkativeness * 0.7 + aggressiveness * 0.3),
  };
}

const VERBOSITY_TEXT: Record<BotSpeechStyle["verbosity"], string> = {
  TERSE: "nói cụt lủn, thường chỉ một câu ngắn",
  NORMAL: "nói vừa phải, một hai câu",
  TALKATIVE: "nói nhiều, thích diễn giải thêm",
};

const WARMTH_TEXT: Record<BotSpeechStyle["warmth"], string> = {
  COLD: "giọng lạnh, ít khách sáo",
  NEUTRAL: "giọng bình thường",
  WARM: "giọng thân thiện, hay xoa dịu",
};

const ADDRESS_TEXT: Record<BotSpeechStyle["address"], string> = {
  TÔI_BẠN: 'xưng "tôi", gọi người khác là "bạn"',
  TỚ_CẬU: 'xưng "tớ", gọi người khác là "cậu"',
  MÌNH_ÔNG: 'xưng "mình", gọi người khác là "ông"',
};

/** Mô tả một mức bằng lời, hoặc bỏ qua khi mức đó không đáng nói. */
function trait(value: number, high: string, low?: string): string | null {
  if (value >= 0.7) return high;
  if (low !== undefined && value <= 0.3) return low;
  return null;
}

/**
 * Phong cách viết thành một câu tiếng Việt cho prompt.
 *
 * Đây là thứ DUY NHẤT mà nhà cung cấp được biết về tính cách. Cố tình không
 * chứa con số nào và không chứa tên trait tiếng Anh: chúng vô nghĩa với mô hình
 * và làm lộ cấu hình nội bộ ra một bề mặt không kiểm soát được.
 */
export function describeSpeechStyle(style: BotSpeechStyle): string {
  const bits: Array<string | null> = [
    VERBOSITY_TEXT[style.verbosity],
    WARMTH_TEXT[style.warmth],
    ADDRESS_TEXT[style.address],
    style.formality === "CASUAL" ? "nói suồng sã như chat game" : "nói gọn và thẳng",
    trait(style.humor, "hay pha trò", "không đùa"),
    trait(style.harshness, "công kích gay gắt", "tránh đối đầu"),
    trait(style.inquisitive, "thích chất vấn", "ít hỏi lại"),
    trait(style.concession, "sẵn sàng nhận mình sai", "rất khó đổi ý"),
  ];

  return bits.filter((bit): bit is string => bit !== null).join(", ");
}
