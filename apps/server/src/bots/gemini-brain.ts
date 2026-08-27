import { z } from "zod";
import type { RoomSnapshot } from "@masoi/shared";
import type { BotBrain, DayDecision, NightDecision } from "./types";
import { legalNightTargets, legalVoteTargets, soloNightAction, witchActions } from "./targets";
import { buildDayPrompt, buildNightPrompt, type PromptSpec } from "./prompt";
import { BotGovernor, withTimeout } from "./governor";

export type GeminiFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface GeminiOptions {
  apiKey: string;
  model: string;
  governor: BotGovernor;
  timeoutMs: number;
  fetchImpl?: GeminiFetch;
  /** Cắt lời chat còn tối đa bấy nhiêu ký tự. Nên khớp config.chatMaxLength. */
  chatMaxLength?: number;
}

const nightSchema = z.object({
  think: z.string(),
  action: z.enum(["HEAL", "POISON", "SKIP"]).optional(),
  targetId: z.string().nullable().optional(),
});

const daySchema = z.object({
  think: z.string(),
  chat: z.string(),
  voteTargetId: z.string().nullable().optional(),
});

const DEFAULT_CHAT_MAX = 300;

/**
 * Đủ cho { think<=200 ký tự, action, chat<=300 ký tự, targetId } dưới dạng JSON,
 * cộng đệm cho token hoá tiếng Việt (dấu tách âm tiết thành nhiều token hơn ASCII).
 */
const MAX_OUTPUT_TOKENS = 500;

/**
 * Mã lỗi thô để phân biệt lý do fallback trong log sản xuất. Chỉ dùng để log,
 * không phải phân cấp lỗi — cố tình giữ thô: một chuỗi liệt kê nhỏ là đủ.
 */
type CallOutcome = "ok" | "429" | "timeout" | "bad_json" | "bad_shape" | "illegal_target";

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
    if (!this.opts.governor.canCall(roomCode)) return null;
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
        this.opts.governor.backOff(wait);
        return {
          raw: null,
          reason: "429",
          detail: `backoff_${this.opts.governor.cooldownRemainingMs()}ms`,
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

  /**
   * Chỉ log: model, độ trễ, kết quả cuối cùng, mã lỗi và chi tiết thô kèm theo.
   * Không log prompt/key/think.
   */
  private logOutcome(startedAt: number, reason: CallOutcome, detail?: string): void {
    const suffix = detail ? ` detail=${detail}` : "";
    console.log(`[bot] ${this.opts.model} ${Date.now() - startedAt}ms reason=${reason}${suffix}`);
  }

  async decideNight(view: RoomSnapshot): Promise<NightDecision | null> {
    const spec = buildNightPrompt(view);
    if (!spec) return null;

    const result = await this.call(view.code, spec);
    if (!result) return null;
    const { raw, reason, detail, startedAt } = result;

    const finish = (
      value: NightDecision | null,
      outcome: CallOutcome,
      det?: string,
    ): NightDecision | null => {
      this.logOutcome(startedAt, outcome, det);
      return value;
    };

    if (raw === null) return finish(null, reason, detail);

    const parsed = nightSchema.safeParse(raw);
    if (!parsed.success) return finish(null, "bad_shape");

    if (view.you?.role === "WITCH") {
      const action = parsed.data.action;
      // Cổng hợp lệ thứ hai: xác nhận hành động Phù Thuỷ chọn còn dùng được
      // (bình đã dùng thì engine sẽ từ chối) — không tin riêng Zod.
      if (!action || !witchActions(view).includes(action)) return finish(null, "illegal_target");
      if (action === "HEAL") return finish({ action: "HEAL", targetId: null }, "ok");
      if (action !== "POISON") return finish(null, "ok"); // SKIP: bot chủ động không làm gì
      const target = parsed.data.targetId ?? null;
      if (!target || !legalNightTargets(view, "POISON").includes(target)) {
        return finish(null, "illegal_target");
      }
      return finish({ action: "POISON", targetId: target }, "ok");
    }

    const action = soloNightAction(view.you?.role);
    if (!action) return finish(null, "illegal_target");
    const target = parsed.data.targetId ?? null;
    if (!target || !legalNightTargets(view, action).includes(target)) {
      return finish(null, "illegal_target");
    }
    return finish({ action, targetId: target }, "ok");
  }

  async decideDay(view: RoomSnapshot): Promise<DayDecision | null> {
    const spec = buildDayPrompt(view);
    if (!spec) return null;

    const result = await this.call(view.code, spec);
    if (!result) return null;
    const { raw, reason, detail, startedAt } = result;

    const finish = (
      value: DayDecision | null,
      outcome: CallOutcome,
      det?: string,
    ): DayDecision | null => {
      this.logOutcome(startedAt, outcome, det);
      return value;
    };

    if (raw === null) return finish(null, reason, detail);

    const parsed = daySchema.safeParse(raw);
    if (!parsed.success) return finish(null, "bad_shape");

    const vote = parsed.data.voteTargetId ?? null;
    const legal = vote && legalVoteTargets(view).includes(vote) ? vote : null;

    const chatMax = this.opts.chatMaxLength ?? DEFAULT_CHAT_MAX;
    return finish({ chat: parsed.data.chat.slice(0, chatMax), voteTargetId: legal }, "ok");
  }
}
