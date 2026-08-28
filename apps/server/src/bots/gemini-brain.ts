import type { RoomSnapshot } from "@masoi/shared";
import type {
  Attempt,
  BotBrain,
  DaySpeechDecision,
  SpeechRequest,
  DefenseDecision,
} from "./types";
import { failed, nothingToDo } from "./types";
import { buildDaySpeechPrompt, buildDefensePrompt, type PromptSpec } from "./prompt";
import { BotGovernor, Cooldown, withTimeout } from "./governor";
import {
  DEFAULT_CHAT_MAX,
  interpretDaySpeech,
  interpretDefense,
  type CallOutcome,
  type LogOutcome,
} from "./decide";

export type GeminiFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface GeminiOptions {
  apiKey: string;
  model: string;
  governor: BotGovernor;
  /** Riêng cho nhà cung cấp này; không dùng chung với nhà cung cấp khác. */
  cooldown: Cooldown;
  timeoutMs: number;
  fetchImpl?: GeminiFetch;
  /** Cắt lời chat còn tối đa bấy nhiêu ký tự. Nên khớp config.chatMaxLength. */
  chatMaxLength?: number;
}

/**
 * Đủ cho { think<=200 ký tự, action, chat<=300 ký tự, targetId } dưới dạng JSON,
 * cộng đệm cho token hoá tiếng Việt (dấu tách âm tiết thành nhiều token hơn ASCII).
 */
const MAX_OUTPUT_TOKENS = 500;

interface CallResult {
  raw: unknown | null;
  reason: CallOutcome;
  /**
   * Chi tiết thô đi kèm reason để log sản xuất phân biệt được các nguyên nhân
   * cùng gộp vào "bad_json". Không chứa prompt, key hay think - chỉ mã HTTP và
   * thông báo lỗi của Google (đã cắt ngắn).
   */
  detail?: string;
  startedAt: number;
}

type CallBody = { raw: unknown; reason: CallOutcome; detail?: string };

/**
 * Thời gian Google bảo hãy chờ trước khi gọi lại. Ưu tiên header Retry-After
 * (giây), sau đó tới google.rpc.RetryInfo trong thân lỗi, dạng "27s"/"1.5s".
 * Trả undefined khi không có gì đọc được - chỗ gọi sẽ dùng mặc định của mình.
 */
async function retryAfterMs(res: Response): Promise<number | undefined> {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1_000;

  try {
    const body = (await res.json()) as {
      error?: { details?: { "@type"?: string; retryDelay?: string }[] };
    };
    const info = body.error?.details?.find((d) => d["@type"]?.endsWith("RetryInfo"));
    const secs = Number(String(info?.retryDelay ?? "").replace(/s$/, ""));
    return Number.isFinite(secs) && secs > 0 ? secs * 1_000 : undefined;
  } catch {
    return undefined;
  }
}

export class GeminiBrain implements BotBrain {
  readonly name = "gemini";

  constructor(private readonly opts: GeminiOptions) {}

  private get fetchImpl(): GeminiFetch {
    return this.opts.fetchImpl ?? ((u, i) => fetch(u, i));
  }

  /**
   * Gọi Gemini và trả JSON thô kèm mã lý do ở tầng mạng (chưa qua Zod/hợp lệ).
   * Trả null (không gọi được, hết ngân sách) nếu bị chặn trước khi gọi — nhánh
   * đó không log vì chưa có gì để đo độ trễ.
   */
  private async call(roomCode: string, spec: PromptSpec): Promise<CallResult | null> {
    if (this.opts.cooldown.active() || !this.opts.governor.canCall(roomCode)) return null;
    this.opts.governor.recordCall(roomCode);

    // Key đi trong header, không nằm trong URL - tránh mọi nguy cơ lọt vào log
    // proxy hay error cause dù hiện tại chưa nơi nào log URL này.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.opts.model}:generateContent`;

    const startedAt = Date.now();
    const result = await withTimeout<CallBody>(async (signal) => {
      const res = await this.fetchImpl(url, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.opts.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: spec.system }] },
          contents: [{ role: "user", parts: [{ text: spec.user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: spec.schema,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            // Ghim thay vì để mặc định (không công bố, đổi theo model). Đo được:
            // nhỉnh hơn một chút về đa dạng lời thoại, không lệch persona. Đây chỉ
            // là đòn bẩy phụ - thứ thực sự chống lặp là đánh dấu lời của chính bot
            // trong chatBlock, vì riêng nâng temperature gần như không ăn thua.
            temperature: 1.2,
            // Giữ suy luận ở mức thấp: output đã ngắn (schema ép cấu trúc), suy
            // luận ngầm chỉ tốn thời gian và có thể đẩy request vượt deadline 8s
            // rồi âm thầm rơi về RandomBrain.
            //
            // Dòng 3.x bỏ thinkingBudget và thay bằng thinkingLevel: gửi
            // thinkingBudget: 0 tới gemini-3.5-flash-lite là 400 INVALID_ARGUMENT
            // cho *mọi* request, tức Gemini không bao giờ chạy. API có validate
            // giá trị (chuỗi bịa cũng trả 400), nên "LOW" là mức thật, không phải
            // field bị bỏ qua âm thầm. Đo thực tế: thoughtsTokenCount = 0, ~1.5s.
            thinkingConfig: { thinkingLevel: "LOW" },
          },
        }),
      });

      if (res.status === 429) {
        const wait = await retryAfterMs(res);
        this.opts.cooldown.backOff(wait);
        return {
          raw: null,
          reason: "429",
          detail: `backoff_${this.opts.cooldown.remainingMs()}ms`,
        };
      }
      // Bốn nguyên nhân rất khác nhau cùng gộp vào "bad_json" (HTTP lỗi, thân
      // không phải JSON, thiếu trường text, text không parse được). Gộp thì tiện
      // đọc log nhưng khiến sự cố không chẩn đoán được từ xa, nên mỗi nhánh kèm
      // "detail" để phân biệt - đặc biệt là mã HTTP và thông báo của Google, thứ
      // duy nhất nói được schema hay key mới là chỗ sai.
      if (!res.ok) {
        let detail = `http_${res.status}`;
        try {
          const err = (await res.json()) as { error?: { message?: string } };
          if (err?.error?.message) detail += ` ${err.error.message.slice(0, 160)}`;
        } catch {
          // Thân lỗi không phải JSON: giữ nguyên mã status là đủ.
        }
        return { raw: null, reason: "bad_json", detail };
      }

      let body: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        return { raw: null, reason: "bad_json", detail: "body_not_json" };
      }

      // Thiếu text thường là finishReason MAX_TOKENS (suy luận ngầm ăn hết
      // maxOutputTokens) hoặc SAFETY - hai chuyện phải sửa theo hai hướng khác nhau.
      const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return { raw: null, reason: "bad_json", detail: "no_text" };

      try {
        return { raw: JSON.parse(text) as unknown, reason: "ok" };
      } catch {
        return { raw: null, reason: "bad_json", detail: "text_not_json" };
      }
    }, this.opts.timeoutMs);

    // withTimeout trả null khi hết hạn chót HOẶC khi work ném lỗi (mạng lỗi, bị
    // huỷ) — ở tầng này không phân biệt được nguyên nhân cụ thể nên gộp vào "timeout".
    const { raw, reason, detail } = result ?? { raw: null, reason: "timeout" as const };
    return { raw, reason, detail, startedAt };
  }

  private logger(startedAt: number): LogOutcome {
    return (outcome, detail) => {
      const suffix = detail ? ` detail=${detail}` : "";
      console.log(`[bot] ${this.name} ${Date.now() - startedAt}ms reason=${outcome}${suffix}`);
    };
  }

  async renderDaySpeech(request: SpeechRequest): Promise<Attempt<DaySpeechDecision>> {
    const spec = buildDaySpeechPrompt(request);

    const result = await this.call(request.roomCode, spec);
    // Bị governor chặn trước khi gọi (hết ngân sách hoặc đang nghỉ vì 429) là
    // một lượt hỏng: đúng lúc cần thử nhà cung cấp khác nhất.
    if (!result) return failed();

    const log = this.logger(result.startedAt);
    if (result.raw === null) {
      log(result.reason, result.detail);
      return failed();
    }
    return interpretDaySpeech(result.raw, this.opts.chatMaxLength ?? DEFAULT_CHAT_MAX, log);
  }

  async decideDefense(view: RoomSnapshot): Promise<Attempt<DefenseDecision>> {
    const spec = buildDefensePrompt(view);
    if (!spec) return nothingToDo();

    const result = await this.call(view.code, spec);
    if (!result) return failed();

    const log = this.logger(result.startedAt);
    if (result.raw === null) {
      log(result.reason, result.detail);
      return failed();
    }
    return interpretDefense(view, result.raw, this.opts.chatMaxLength ?? DEFAULT_CHAT_MAX, log);
  }
}
