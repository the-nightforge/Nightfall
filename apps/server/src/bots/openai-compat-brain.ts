import type { RoomSnapshot } from "@masoi/shared";
import type {
  Attempt,
  BotBrain,
  DaySpeechDecision,
  SpeechRequest,
  DefenseDecision,
  FinalVoteDecision,
  HunterShotDecision,
  NightDecision,
} from "./types";
import { failed, nothingToDo } from "./types";
import {
  buildDaySpeechPrompt,
  buildDefensePrompt,
  buildFinalVotePrompt,
  buildHunterPrompt,
  buildNightPrompt,
  type PromptSpec,
} from "./prompt";
import { BotGovernor, Cooldown, withTimeout } from "./governor";
import {
  DEFAULT_CHAT_MAX,
  interpretDaySpeech,
  interpretDefense,
  interpretFinalVote,
  interpretHunterShot,
  interpretNight,
  type CallOutcome,
  type LogOutcome,
} from "./decide";

export type CompatFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Cách ép mô hình trả JSON. Không phải endpoint OpenAI-compatible nào cũng thật
 * sự cài đặt response_format: đo trên proxy đang dùng thì json_schema bị bỏ qua
 * lặng lẽ và mô hình trả văn xuôi. Nên chế độ phải khai báo rõ theo từng nhà
 * cung cấp, không suy đoán.
 */
export type JsonMode = "json_schema" | "prompt";

export interface OpenAiCompatOptions {
  /** Base URL kèm /v1, không có dấu / cuối. */
  baseUrl: string;
  apiKey: string;
  model: string;
  governor: BotGovernor;
  /** Riêng cho nhà cung cấp này; không dùng chung với nhà cung cấp khác. */
  cooldown: Cooldown;
  timeoutMs: number;
  jsonMode: JsonMode;
  fetchImpl?: CompatFetch;
  chatMaxLength?: number;
  /**
   * Tên tham số giới hạn độ dài output. "OpenAI-compatible" không có nghĩa là
   * giống nhau: dòng gpt-5.x từ chối thẳng "max_tokens" và đòi
   * "max_completion_tokens", trả 400 cho mọi lời gọi chứ không âm thầm bỏ qua.
   */
  maxTokensParam?: "max_tokens" | "max_completion_tokens";
  /**
   * Bỏ trống để dùng mặc định của model. gpt-5.x chỉ chấp nhận đúng giá trị 1 và
   * trả 400 với mọi giá trị khác, nên không đặt cứng ở đây được.
   */
  temperature?: number;
  /** Tên hiển thị trong log, để phân biệt hai nhà cung cấp cùng dùng lớp này. */
  label?: string;
}

const MAX_OUTPUT_TOKENS = 500;

/**
 * Parse khoan dung cho chế độ "prompt": mô hình hay bọc JSON trong rào ```json
 * hoặc kèm một câu dẫn. Cắt lấy khối { } ngoài cùng thay vì từ chối thẳng.
 */
export function tolerantJsonParse(text: string | null | undefined): unknown | null {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const open = t.indexOf("{");
  const close = t.lastIndexOf("}");
  if (open !== -1 && close > open) t = t.slice(open, close + 1);
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return null;
  }
}

interface CallResult {
  raw: unknown | null;
  reason: CallOutcome;
  detail?: string;
  startedAt: number;
}

type CallBody = { raw: unknown; reason: CallOutcome; detail?: string };

/** Thời gian nhà cung cấp bảo hãy chờ: header Retry-After (giây) nếu có. */
function retryAfterMs(res: Response): number | undefined {
  const header = Number(res.headers.get("retry-after"));
  return Number.isFinite(header) && header > 0 ? header * 1_000 : undefined;
}

export class OpenAiCompatBrain implements BotBrain {
  readonly name: string;

  constructor(private readonly opts: OpenAiCompatOptions) {
    this.name = opts.label ?? opts.model;
  }

  private get fetchImpl(): CompatFetch {
    return this.opts.fetchImpl ?? ((u, i) => fetch(u, i));
  }

  private body(spec: PromptSpec) {
    const messages = [
      { role: "system", content: spec.system },
      {
        role: "user",
        content:
          this.opts.jsonMode === "prompt" ? `${spec.user}\n\n${jsonInstruction(spec)}` : spec.user,
      },
    ];

    return {
      model: this.opts.model,
      messages,
      // Proxy mặc định trả SSE; ép non-streaming để đọc một lần cho xong.
      stream: false,
      [this.opts.maxTokensParam ?? "max_tokens"]: MAX_OUTPUT_TOKENS,
      ...(this.opts.temperature === undefined ? {} : { temperature: this.opts.temperature }),
      ...(this.opts.jsonMode === "json_schema"
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "bot_decision", strict: true, schema: strictSchema(spec) },
            },
          }
        : {}),
    };
  }

  private async call(roomCode: string, spec: PromptSpec): Promise<CallResult | null> {
    if (this.opts.cooldown.active() || !this.opts.governor.canCall(roomCode)) return null;
    this.opts.governor.recordCall(roomCode);

    const startedAt = Date.now();
    const result = await withTimeout<CallBody>(async (signal) => {
      const res = await this.fetchImpl(`${this.opts.baseUrl}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify(this.body(spec)),
      });

      if (res.status === 429) {
        this.opts.cooldown.backOff(retryAfterMs(res));
        return {
          raw: null,
          reason: "429",
          detail: `backoff_${this.opts.cooldown.remainingMs()}ms`,
        };
      }

      if (!res.ok) {
        let detail = `http_${res.status}`;
        try {
          const err = (await res.json()) as { error?: { message?: string } | string };
          const msg = typeof err.error === "string" ? err.error : err.error?.message;
          if (msg) detail += ` ${msg.slice(0, 160)}`;
        } catch {
          // Thân lỗi không phải JSON: giữ nguyên mã status là đủ.
        }
        return { raw: null, reason: "bad_json", detail };
      }

      let body: { choices?: { message?: { content?: string } }[] };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        return { raw: null, reason: "bad_json", detail: "body_not_json" };
      }

      const text = body.choices?.[0]?.message?.content;
      if (!text) return { raw: null, reason: "bad_json", detail: "no_text" };

      const parsed = tolerantJsonParse(text);
      if (parsed === null) return { raw: null, reason: "bad_json", detail: "text_not_json" };
      return { raw: parsed, reason: "ok" };
    }, this.opts.timeoutMs);

    const { raw, reason, detail } = result ?? { raw: null, reason: "timeout" as const };
    return { raw, reason, detail, startedAt };
  }

  private logger(startedAt: number): LogOutcome {
    return (outcome, detail) => {
      const suffix = detail ? ` detail=${detail}` : "";
      console.log(`[bot] ${this.name} ${Date.now() - startedAt}ms reason=${outcome}${suffix}`);
    };
  }

  async decideNight(view: RoomSnapshot): Promise<Attempt<NightDecision>> {
    const spec = buildNightPrompt(view);
    if (!spec) return nothingToDo();

    const result = await this.call(view.code, spec);
    // Bị governor chặn trước khi gọi (hết ngân sách hoặc đang nghỉ vì 429) là
    // một lượt hỏng: đúng lúc cần thử nhà cung cấp khác nhất.
    if (!result) return failed();

    const log = this.logger(result.startedAt);
    if (result.raw === null) {
      log(result.reason, result.detail);
      return failed();
    }
    return interpretNight(view, result.raw, log);
  }

  async renderDaySpeech(request: SpeechRequest): Promise<Attempt<DaySpeechDecision>> {
    const spec = buildDaySpeechPrompt(request);

    const result = await this.call(request.roomCode, spec);
    if (!result) return failed();

    const log = this.logger(result.startedAt);
    if (result.raw === null) {
      log(result.reason, result.detail);
      return failed();
    }
    return interpretDaySpeech(result.raw, this.opts.chatMaxLength ?? DEFAULT_CHAT_MAX, log);
  }

  async decideHunterShot(view: RoomSnapshot): Promise<Attempt<HunterShotDecision>> {
    const spec = buildHunterPrompt(view);
    if (!spec) return nothingToDo();

    const result = await this.call(view.code, spec);
    if (!result) return failed();

    const log = this.logger(result.startedAt);
    if (result.raw === null) {
      log(result.reason, result.detail);
      return failed();
    }
    return interpretHunterShot(view, result.raw, log);
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

  async decideFinalVote(view: RoomSnapshot): Promise<Attempt<FinalVoteDecision>> {
    const spec = buildFinalVotePrompt(view);
    if (!spec) return nothingToDo();

    const result = await this.call(view.code, spec);
    if (!result) return failed();

    const log = this.logger(result.startedAt);
    if (result.raw === null) {
      log(result.reason, result.detail);
      return failed();
    }
    return interpretFinalVote(view, result.raw, log);
  }
}

/** Schema strict của OpenAI: mọi field phải nằm trong required và cấm field lạ. */
function strictSchema(spec: PromptSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spec.schema.properties)) {
    const prop = value as { type?: string; enum?: string[]; description?: string };
    const optional = !spec.schema.required.includes(key);
    properties[key] = {
      ...prop,
      // strict không cho field tuỳ chọn: thứ vốn có thể vắng mặt phải thành nullable.
      ...(optional ? { type: [prop.type ?? "string", "null"] } : {}),
      ...(optional && prop.enum ? { enum: [...prop.enum, null] } : {}),
    };
  }
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/** Chế độ "prompt": mô tả hình dạng JSON ngay trong lời nhắc. */
function jsonInstruction(spec: PromptSpec): string {
  const fields = Object.entries(spec.schema.properties).map(([key, value]) => {
    const prop = value as { enum?: string[]; description?: string };
    const optional = !spec.schema.required.includes(key);
    const allowed = prop.enum
      ? ` (chọn một trong: ${prop.enum.join(", ")}${optional ? ", hoặc null" : ""})`
      : "";
    const note = prop.description ? ` - ${prop.description}` : "";
    return `  "${key}": ...${allowed}${note}`;
  });
  return [
    "CHỈ trả về một object JSON hợp lệ, không markdown, không giải thích thêm.",
    "Đúng các khoá sau:",
    "{",
    fields.join(",\n"),
    "}",
  ].join("\n");
}
