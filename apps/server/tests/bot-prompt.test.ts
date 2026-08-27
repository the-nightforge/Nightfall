import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { buildDayPrompt, buildNightPrompt, personaFor } from "../src/bots/prompt";

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
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: false,
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [
      { id: "1", channel: "day", playerId: "s", playerName: "Sang", text: "Tôi nghi Wolf", at: 1 },
    ],
    log: [],
  };
}

/** Snapshot của Sói: thấy đồng bọn, không thấy vai phe làng */
function wolfView(): RoomSnapshot {
  return {
    ...villagerView(),
    phase: "NIGHT",
    you: { id: "w", name: "Wolf", ready: true, connected: true, role: "WEREWOLF", alive: true },
    players: [
      { id: "v", name: "Vân", alive: true, isBot: false },
      { id: "w", name: "Wolf", alive: true, isBot: true, role: "WEREWOLF" },
      { id: "s", name: "Sang", alive: true, isBot: false, role: "WEREWOLF" },
    ],
    night: { canAct: true, acted: false, wolfTarget: null, seerResult: null },
  };
}

/** Snapshot của Phù Thuỷ còn cả hai bình: nhánh duy nhất có targetId không bắt buộc */
function witchView(): RoomSnapshot {
  return {
    ...villagerView(),
    phase: "NIGHT",
    you: { id: "v", name: "Vân", ready: true, connected: true, role: "WITCH", alive: true },
    night: {
      canAct: true,
      acted: false,
      wolfTarget: null,
      seerResult: null,
      healUsed: false,
      poisonUsed: false,
    },
  };
}

describe("ranh giới bảo mật của prompt", () => {
  it("prompt của Dân Làng không chứa vai trò của bất kỳ ai khác", () => {
    const spec = buildDayPrompt(villagerView());
    const text = `${spec!.system}\n${spec!.user}`;
    expect(text).not.toContain("WEREWOLF");
    expect(text).not.toContain("SEER");
    expect(text).not.toContain("WITCH");
    expect(text).not.toContain("GUARD");
    // prompt.ts chỉ render vai bằng văn xuôi tiếng Việt nên 4 dòng trên không
    // bao giờ đỏ dù prompt.ts có bị sửa để nhận thẳng state chưa lọc - assert
    // này nhắm đúng dấu hiệu tiếng Việt mà code thực sự phát ra cho đồng bọn Sói,
    // để một hồi quy như vậy còn có cái gì đó bắt được.
    expect(text).not.toContain("đồng bọn Sói");
  });

  it("prompt của Sói nêu đồng bọn nhưng không nêu vai phe làng", () => {
    const spec = buildNightPrompt(wolfView());
    const text = `${spec!.system}\n${spec!.user}`;
    expect(text).toContain("Sang");
    expect(text).toContain("đồng bọn Sói");
    expect(text).not.toContain("SEER");
    expect(text).not.toContain("WITCH");
  });

  it("chat của người chơi được bọc là dữ liệu, không phải chỉ thị", () => {
    const spec = buildDayPrompt(villagerView());
    expect(spec!.user).toContain("<chat>");
    expect(spec!.user).toContain("</chat>");
    expect(spec!.user).toContain("Tôi nghi Wolf");
  });
});

describe("chống lặp lời", () => {
  function withOwnLine(): RoomSnapshot {
    const base = villagerView();
    return {
      ...base,
      chatLog: [
        ...base.chatLog,
        { id: "2", channel: "day", playerId: "v", playerName: "Vân", text: "Từ từ đã", at: 2 },
      ],
    };
  }

  // Không có dấu này, mọi dòng đều trông như lời người khác nên bot không biết
  // mình đã nói gì - đó là lý do các persona kiệm lời lặp gần nguyên văn mỗi vòng.
  it("đánh dấu (bạn) đúng vào lời của chính bot, không đánh dấu lời người khác", () => {
    const user = buildDayPrompt(withOwnLine())!.user;
    expect(user).toContain("Vân (bạn): Từ từ đã");
    expect(user).toContain("Sang: Tôi nghi Wolf");
    expect(user).not.toContain("Sang (bạn)");
  });

  it("có nhắc đừng lặp khi bot đã từng nói", () => {
    expect(buildDayPrompt(withOwnLine())!.user).toContain("nói ý mới");
  });

  /** Chỉ phần trong <chat>, vì playerLines cũng dùng dấu "(bạn)" cho danh sách người chơi. */
  function chatSection(user: string): string {
    return user.slice(user.indexOf("<chat>"), user.indexOf("</chat>"));
  }

  it("chưa nói lần nào thì không thêm nhắc nhở thừa và không dòng chat nào bị đánh dấu", () => {
    const user = buildDayPrompt(villagerView())!.user;
    expect(user).not.toContain("nói ý mới");
    expect(chatSection(user)).not.toContain("(bạn)");
  });
});

describe("responseSchema", () => {
  it("enum mục tiêu đêm của Sói chỉ gồm người ngoài phe Sói", () => {
    const spec = buildNightPrompt(wolfView());
    const target = spec!.schema.properties.targetId as { enum: string[] };
    expect(target.enum).toEqual(["v"]);
  });

  // responseSchema chỉ nhận tập con OpenAPI 3.0, nơi "type" là giá trị đơn.
  // Mảng ["string","null"] là JSON Schema và bị trả về 400 INVALID_ARGUMENT,
  // khiến mọi prompt ngày và mọi prompt đêm của Phù Thuỷ hỏng im lặng.
  it("prompt ngày: voteTargetId là type đơn, không mã hoá nullable, và nằm ngoài required", () => {
    const spec = buildDayPrompt(villagerView());
    const vote = spec!.schema.properties.voteTargetId as {
      type: string;
      enum: string[];
      nullable?: boolean;
    };
    expect(vote.type).toBe("string");
    expect(vote.enum).toEqual(["w", "s"]);
    expect(vote.nullable).toBeUndefined();
    expect(spec!.schema.required).not.toContain("voteTargetId");
  });

  it("prompt đêm Phù Thuỷ: targetId là type đơn và nằm ngoài required", () => {
    const spec = buildNightPrompt(witchView());
    const target = spec!.schema.properties.targetId as { type: string; nullable?: boolean };
    expect(target.type).toBe("string");
    expect(target.nullable).toBeUndefined();
    expect(spec!.schema.required).not.toContain("targetId");
  });

  it("Dân Làng không có prompt đêm", () => {
    const v = { ...villagerView(), phase: "NIGHT" as const, night: null };
    expect(buildNightPrompt(v)).toBeNull();
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
