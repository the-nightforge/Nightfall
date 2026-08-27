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
  startedAt: number;
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
    const result = await withTimeout<{ raw: unknown; reason: CallOutcome }>(async (signal) => {
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
            // Tắt suy luận mở rộng: output đã ngắn (schema ép cấu trúc), suy luận
            // ngầm chỉ tổ tốn thời gian và là nguyên nhân nhiều khả năng nhất khiến
            // request vượt deadline 8s rồi âm thầm rơi về RandomBrain.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });

      if (res.status === 429) {
        this.opts.governor.trip(roomCode);
        return { raw: null, reason: "429" };
      }
      // Mọi phản hồi không dùng được (mã lỗi khác 429, thân JSON hỏng, thiếu
      // trường text) đều gộp vào "bad_json" — chỉ cần đủ thô để phân biệt với
      // 429/timeout/bad_shape/illegal_target trong log, không cần chi tiết hơn.
      if (!res.ok) return { raw: null, reason: "bad_json" };

      let body: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        return { raw: null, reason: "bad_json" };
      }

      const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return { raw: null, reason: "bad_json" };

      try {
        return { raw: JSON.parse(text) as unknown, reason: "ok" };
      } catch {
        return { raw: null, reason: "bad_json" };
      }
    }, this.opts.timeoutMs);

    // withTimeout trả null khi hết hạn chót HOẶC khi work ném lỗi (mạng lỗi, bị
    // huỷ) — ở tầng này không phân biệt được nguyên nhân cụ thể nên gộp vào "timeout".
    const { raw, reason } = result ?? { raw: null, reason: "timeout" as const };
    return { raw, reason, startedAt };
  }

  /** Chỉ log: model, độ trễ, kết quả cuối cùng, mã lỗi. Không log prompt/key/think. */
  private logOutcome(startedAt: number, reason: CallOutcome): void {
    console.log(`[bot] ${this.opts.model} ${Date.now() - startedAt}ms reason=${reason}`);
  }

  async decideNight(view: RoomSnapshot): Promise<NightDecision | null> {
    const spec = buildNightPrompt(view);
    if (!spec) return null;

    const result = await this.call(view.code, spec);
    if (!result) return null;
    const { raw, reason, startedAt } = result;

    const finish = (value: NightDecision | null, outcome: CallOutcome): NightDecision | null => {
      this.logOutcome(startedAt, outcome);
      return value;
    };

    if (raw === null) return finish(null, reason);

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
    const { raw, reason, startedAt } = result;

    const finish = (value: DayDecision | null, outcome: CallOutcome): DayDecision | null => {
      this.logOutcome(startedAt, outcome);
      return value;
    };

    if (raw === null) return finish(null, reason);

    const parsed = daySchema.safeParse(raw);
    if (!parsed.success) return finish(null, "bad_shape");

    const vote = parsed.data.voteTargetId ?? null;
    const legal = vote && legalVoteTargets(view).includes(vote) ? vote : null;

    const chatMax = this.opts.chatMaxLength ?? DEFAULT_CHAT_MAX;
    return finish({ chat: parsed.data.chat.slice(0, chatMax), voteTargetId: legal }, "ok");
  }
}
