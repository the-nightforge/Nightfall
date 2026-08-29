import { describe, expect, it } from "vitest";
import { speechDefaults } from "./helpers/speech-request";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { buildDaySpeechPrompt, buildDefensePrompt, personaFor } from "../src/bots/prompt";
import { interpretDaySpeech } from "../src/bots/decide";
import type { SpeechRequest } from "../src/bots/types";

/** Snapshot của Dân Làng: đã lọc, không ai lộ vai */
function villagerView(): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "v",
    phase: "DAY_DISCUSSION",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 2,
    phaseEndsAt: null,
    you: { id: "v", name: "Vân", ready: true, connected: true, role: "VILLAGER", alive: true },
    players: [
      { id: "v", name: "Vân", alive: true, isBot: true },
      { id: "w", name: "Wolf", alive: true, isBot: false },
      { id: "s", name: "Sang", alive: true, isBot: false },
    ],
    night: null,
    hunterShot: null,
    trial: null,
    lastTrial: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    serverNow: 0,
    discussionSkip: null,
    votesRevealed: false,
    dayVoteHistory: [],
    nightHistory: [],
    hunterShots: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [
      { id: "1", channel: "day", playerId: "s", playerName: "Sang", text: "Tôi nghi Wolf", at: 1 },
    ],
    log: [],
  };
}

/** Bị cáo đang được nói lời bào chữa: nhánh còn lại vẫn đọc chat thô. */
function defenseView(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    ...villagerView(),
    phase: "DEFENSE",
    trial: {
      accusedId: "v",
      accusedName: "Vân",
      guiltyVotes: 0,
      innocentVotes: 0,
      guiltyRequired: 2,
      canVote: false,
      hasVoted: false,
      myVote: null,
      canSpeak: true,
    },
    ...over,
  };
}

/** Một ý định ban ngày ĐÃ CHỐT, đúng hình dạng mà lõi deterministic phát ra. */
function speechRequest(over: Partial<SpeechRequest> = {}): SpeechRequest {
  return {
    roomCode: "ABCDE",
    speaker: { id: "v", name: "Vân" },
    ...speechDefaults(),
    intention: {
      kind: "ACCUSE",
      targetId: "w",
      confidence: 0.8,
      evidence: [
        {
          id: "ev-1",
          kind: "LATE_SWITCH",
          sourceId: "vote:late-switch:2",
          actorId: "w",
          targetId: "s",
          weight: 7,
          confidence: 0.6,
          round: 2,
          summary: "đổi phiếu sát giờ chót",
        },
      ],
    },
    evidence: [{ sourceId: "vote:late-switch:2", summary: "đổi phiếu sát giờ chót" }],
    targetName: "Wolf",
    recentSpeechSourceIds: [],
    ...over,
  };
}

describe("ranh giới bảo mật của prompt", () => {
  it("prompt ban ngày không chứa vai trò của bất kỳ ai, kể cả của chính bot", () => {
    const spec = buildDaySpeechPrompt(speechRequest());
    const text = `${spec.system}\n${spec.user}`;

    expect(text).not.toContain("WEREWOLF");
    expect(text).not.toContain("SEER");
    expect(text).not.toContain("WITCH");
    expect(text).not.toContain("GUARD");
    // prompt.ts chỉ render vai bằng văn xuôi tiếng Việt nên 4 dòng trên không
    // bao giờ đỏ dù prompt.ts có bị sửa để nhận thẳng state chưa lọc - assert
    // này nhắm đúng dấu hiệu tiếng Việt mà code thực sự phát ra cho đồng bọn Sói,
    // để một hồi quy như vậy còn có cái gì đó bắt được.
    expect(text).not.toContain("đồng bọn Sói");
    expect(text).not.toContain("Vai của bạn");
  });

  it("prompt ban ngày không nêu ai ngoài mục tiêu đã chốt", () => {
    // Nhà cung cấp không thấy Sang thì nó không có cách nào chuyển hướng sang Sang.
    const spec = buildDaySpeechPrompt(speechRequest());
    const text = `${spec.system}\n${spec.user}`;

    expect(text).toContain("Wolf");
    expect(text).not.toContain("Sang");
  });

  it("prompt ban ngày không mang theo chat thô của người chơi", () => {
    // Chat thô là bề mặt prompt-injection lớn nhất. Ban ngày đã deterministic
    // nên nhà cung cấp không còn lý do gì để đọc nó.
    const spec = buildDaySpeechPrompt(speechRequest());

    expect(spec.user).not.toContain("<chat>");
    expect(spec.user).not.toContain("Tôi nghi Wolf");
  });

  it("chat của người chơi được bọc là dữ liệu, không phải chỉ thị", () => {
    // Các pha còn dùng snapshot (bào chữa, phiếu xác nhận) vẫn phải bọc chat.
    const spec = buildDefensePrompt(defenseView());
    expect(spec!.user).toContain("<chat>");
    expect(spec!.user).toContain("</chat>");
    expect(spec!.user).toContain("Tôi nghi Wolf");
  });
});

describe("chống lặp lời", () => {
  // Trước đây bot đọc lại chat để biết mình đã nói gì. Giờ căn cứ đã nói được
  // lõi ghi lại theo source ID, nên lời nhắc bám vào đúng luận điểm chứ không
  // bám vào câu chữ - đó là thứ thực sự lặp.
  it("có nhắc đừng lặp căn cứ đã dùng, kèm đúng source ID", () => {
    const user = buildDaySpeechPrompt(
      speechRequest({ recentSpeechSourceIds: ["vote:bandwagon:1"] }),
    ).user;

    expect(user).toContain("đừng lặp lại");
    expect(user).toContain("vote:bandwagon:1");
  });

  it("chưa nói lần nào thì không thêm nhắc nhở thừa", () => {
    const user = buildDaySpeechPrompt(speechRequest()).user;

    expect(user).not.toContain("đừng lặp lại");
    expect(user).toContain("lượt nói đầu");
  });

  it("liệt kê đúng bằng chứng được phép nhắc tới, kèm source ID", () => {
    const user = buildDaySpeechPrompt(speechRequest()).user;

    expect(user).toContain("vote:late-switch:2");
    expect(user).toContain("đổi phiếu sát giờ chót");
    // Phase 4 tách một câu cấm thành hai câu, mỗi câu một điều cấm: bịa sự
    // kiện và đổi mục tiêu là hai lỗi khác nhau và đáng nói riêng.
    expect(user).toContain("Không được bịa ra sự kiện");
    expect(user).toContain("Không được đổi mục tiêu");
  });

  it("ý định WITHHOLD không nêu tên ai", () => {
    const user = buildDaySpeechPrompt(
      speechRequest({
        intention: { kind: "WITHHOLD", confidence: 0.2, evidence: [] },
        evidence: [],
        targetName: null,
      }),
    ).user;

    expect(user).not.toContain("Wolf");
    // Nhà cung cấp phải được nói rõ là KHÔNG có gì để nêu, kèm lệnh cấm bịa -
    // nếu không nó sẽ tự dựng một sự kiện cho câu nói nghe có trọng lượng.
    expect(user).toContain("chưa có bằng chứng nào");
    expect(user).toContain("đừng bịa");
  });
});

describe("responseSchema", () => {
  // Ban ngày nhà cung cấp chỉ được trả về CÂU CHỮ. Còn một trường mục tiêu nào
  // trong schema là còn một đường để nó lái gameplay.
  it("prompt ngày chỉ có think/chat, không còn trường mục tiêu nào", () => {
    const spec = buildDaySpeechPrompt(speechRequest());

    expect(spec.schema.properties).toHaveProperty("chat");
    expect(spec.schema.properties).not.toHaveProperty("voteTargetId");
    expect(spec.schema.properties).not.toHaveProperty("targetId");
    expect(Object.keys(spec.schema.properties).sort()).toEqual(["chat", "think"]);
    expect(spec.schema.required).toEqual(["think", "chat"]);
  });

  it("interpreter từ chối phản hồi ngày có thêm trường mục tiêu", () => {
    const outcome = interpretDaySpeech(
      { think: "nghi Wolf", chat: "Tôi nghi Wolf", voteTargetId: "s" },
      300,
      () => undefined,
    );

    expect(outcome).toEqual({ ok: false });
  });
});

describe("personaFor", () => {
  it("cùng một id luôn ra cùng persona", () => {
    expect(personaFor("bot-1")).toBe(personaFor("bot-1"));
  });

  it("id khác nhau phủ được nhiều persona", () => {
    const seen = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(personaFor));
    expect(seen.size).toBeGreaterThan(1);
  });
});
