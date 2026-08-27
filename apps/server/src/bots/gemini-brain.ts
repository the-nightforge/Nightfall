import { z } from "zod";
import type { RoomSnapshot } from "@masoi/shared";
import type { BotBrain, DayDecision, NightDecision } from "./types";
import { legalNightTargets, legalVoteTargets, soloNightAction } from "./targets";
import { buildDayPrompt, buildNightPrompt, type PromptSpec } from "./prompt";
import { BotGovernor, withTimeout } from "./governor";

export type GeminiFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface GeminiOptions {
  apiKey: string;
  model: string;
  governor: BotGovernor;
  timeoutMs: number;
  fetchImpl?: GeminiFetch;
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

const CHAT_MAX = 300;

export class GeminiBrain implements BotBrain {
  readonly name = "gemini";

  constructor(private readonly opts: GeminiOptions) {}

  private get fetchImpl(): GeminiFetch {
    return this.opts.fetchImpl ?? ((u, i) => fetch(u, i));
  }

  /** Trả về JSON đã parse, hoặc null cho mọi nhánh thất bại. */
  private async call(roomCode: string, spec: PromptSpec): Promise<unknown | null> {
    if (!this.opts.governor.canCall(roomCode)) return null;
    this.opts.governor.recordCall(roomCode);

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${this.opts.model}:generateContent?key=${this.opts.apiKey}`;

    const started = Date.now();
    const raw = await withTimeout(async (signal) => {
      const res = await this.fetchImpl(url, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: spec.system }] },
          contents: [{ role: "user", parts: [{ text: spec.user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: spec.schema,
          },
        }),
      });

      if (res.status === 429) {
        this.opts.governor.trip(roomCode);
        return null;
      }
      if (!res.ok) return null;

      const body = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
      return text ? (JSON.parse(text) as unknown) : null;
    }, this.opts.timeoutMs);

    // Không log prompt, không log think, không log key
    console.log(`[bot] ${this.opts.model} ${Date.now() - started}ms ${raw ? "ok" : "fallback"}`);
    return raw;
  }

  async decideNight(view: RoomSnapshot): Promise<NightDecision | null> {
    const spec = buildNightPrompt(view);
    if (!spec) return null;

    const raw = await this.call(view.code, spec);
    if (raw === null) return null;

    const parsed = nightSchema.safeParse(raw);
    if (!parsed.success) return null;

    if (view.you?.role === "WITCH") {
      const action = parsed.data.action;
      if (action === "HEAL") return { action: "HEAL", targetId: null };
      if (action !== "POISON") return null;
      const target = parsed.data.targetId ?? null;
      if (!target || !legalNightTargets(view, "POISON").includes(target)) return null;
      return { action: "POISON", targetId: target };
    }

    const action = soloNightAction(view.you?.role);
    if (!action) return null;
    const target = parsed.data.targetId ?? null;
    if (!target || !legalNightTargets(view, action).includes(target)) return null;
    return { action, targetId: target };
  }

  async decideDay(view: RoomSnapshot): Promise<DayDecision | null> {
    const spec = buildDayPrompt(view);
    if (!spec) return null;

    const raw = await this.call(view.code, spec);
    if (raw === null) return null;

    const parsed = daySchema.safeParse(raw);
    if (!parsed.success) return null;

    const vote = parsed.data.voteTargetId ?? null;
    const legal = vote && legalVoteTargets(view).includes(vote) ? vote : null;

    return { chat: parsed.data.chat.slice(0, CHAT_MAX), voteTargetId: legal };
  }
}
