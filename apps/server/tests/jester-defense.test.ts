import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, type ChatMessage, type Role } from "@masoi/shared";
import type { Attempt, DaySpeechDecision, SpeechRequest } from "../src/bots/types";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

/**
 * Lượt tự bào chữa của BOT, chạy trên ĐƯỜNG THẬT.
 *
 * Đây là lớp mà self-play không với tới được: nhân mô phỏng bỏ qua hẳn pha
 * DEFENSE, nên mọi test self-play của Thằng Hề đều xanh trong khi con BOT thật
 * đứng trên giá treo và cãi để được sống. Vì vậy bài test này đi qua đúng ba
 * tầng đã sinh ra lỗi đó:
 *
 *   1. lõi quyết định (`BotRuntime.decideDefense`, THẬT),
 *   2. scheduler (`endVoting` → `scheduleDefenseBot` trong machine.ts, THẬT),
 *   3. diễn đạt (`renderBotSpeech`, THẬT - chỉ nhà cung cấp bị thay).
 *
 * Chỉ nhà cung cấp LLM bị thay, và nó bị thay theo hai cách: một bản ghi lại
 * `SpeechRequest` để đọc chỉ thị gửi đi, và một bản LUÔN HỎNG để ép cả đường
 * rơi về bảng mẫu tất định.
 */

const brainControl = vi.hoisted(() => ({
  requests: [] as SpeechRequest[],
  /** `null` nghĩa là nhà cung cấp hỏng - đường lui bảng mẫu phải gánh. */
  reply: null as string | null,
}));

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    botBrain: () => ({
      name: "test",
      renderDaySpeech: async (request: SpeechRequest): Promise<Attempt<DaySpeechDecision>> => {
        brainControl.requests.push(request);
        // `Attempt` chỉ có `{ ok: false }` - một lượt hỏng không mang lý do,
        // đúng như mọi nhà cung cấp thật khi timeout hay vỡ JSON.
        if (brainControl.reply === null) return { ok: false };
        return { ok: true, value: { chat: brainControl.reply } };
      },
    }),
  };
});

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));

const broadcast = vi.hoisted(() => ({ chats: [] as ChatMessage[] }));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: (_ids: string[], _event: string, message: ChatMessage) => {
    broadcast.chats.push(message);
  },
}));

vi.mock("../src/db", () => ({ prisma: {} }));

// Nạp machine để nó ĐĂNG KÝ bảng xử lý bước chuyển pha; `runPendingStep` ném
// nếu bảng còn trống. Đây cũng chính là thứ đang được kiểm, nên nó phải là
// module thật chứ không phải một bản mock.
await import("../src/game/machine");
const { armStep, runPendingStep } = await import("../src/game/steps");
const { clearBotSession, startBotSession } = await import("../src/bots/session-registry");

/**
 * Phòng đang bỏ phiếu, cả làng đã dồn phiếu vào `accusedId` (một con BOT).
 *
 * Vai gán TAY: bài test nói về việc một vai CỤ THỂ tự bào chữa ra sao, nên ai
 * cầm lá nào phải là hằng số chứ không phải kết quả một lần xáo bài.
 */
function votingRoom(accusedRole: Role, code: string): Room {
  const players = [
    { id: "p1", name: "Người 1", isBot: false },
    { id: "p2", name: "Bị Cáo", isBot: true },
    { id: "p3", name: "Người 3", isBot: false },
    { id: "p4", name: "Người 4", isBot: false },
    { id: "p5", name: "Người 5", isBot: false },
    { id: "p6", name: "Người 6", isBot: false },
  ];
  const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 1, jester: true };
  const engine = GameEngine.create(players, config, 1_000);
  engine.state.players[0].role = "WEREWOLF";
  engine.state.players[1].role = accusedRole;
  for (const player of engine.state.players.slice(2)) player.role = "VILLAGER";

  const room: Room = {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "p1",
    status: "IN_GAME",
    members: players.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: true,
      disconnectedAt: null,
      isBot: p.isBot,
      avatarUrl: null,
    })),
    config,
    engine,
    chatLog: [],
    createdAt: 1_000,
    gameId: "g1",
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };

  clearBotSession(code);
  startBotSession(room);

  engine.state.round = 2;
  engine.setPhase("VOTING", 30_000, 2_000);
  for (const voter of engine.alivePlayers()) {
    if (voter.id !== "p2") engine.submitVote(voter.id, "p2", 3_000);
  }
  return room;
}

/** Chạy đúng bước `endVoting` của machine, tức mở phiên toà thật. */
async function runDefense(room: Room): Promise<void> {
  armStep(room, { name: "endVoting" }, 0);
  runPendingStep(room, room.pendingStep!);
  // Lượt bào chữa là một promise nổi; nhường vòng lặp cho nó chạy xong.
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** `SpeechRequest` của lượt bào chữa vừa rồi. */
function defenseRequest(): SpeechRequest {
  const request = brainControl.requests.find((item) => item.defense !== null);
  if (!request) throw new Error("không có lượt bào chữa nào được gửi đi");
  return request;
}

/**
 * Mọi câu trong bể mẫu `HUMOR`, gộp mọi giọng.
 *
 * Đọc thẳng từ bảng mẫu của engine chứ không chép tay: nếu ai đó thêm vào bể
 * này một câu có thanh minh, test dưới đây vẫn xanh - nhưng đó là chuyện của
 * bể mẫu, và cái nó khoá ở đây là "câu bào chữa của Hề đến từ ĐÚNG bể này",
 * chứ không phải từ bể DISAGREE.
 */
const HUMOR_LINES: string[] = Object.values(
  (await import("@masoi/game-engine")).SPEECH_TEMPLATES.HUMOR,
).flat();

/** Toàn bộ chữ mà lời bào chữa đã phát ra phòng. */
function spokenText(): string {
  return broadcast.chats.map((message) => message.text).join(" ");
}

beforeEach(() => {
  brainControl.requests.length = 0;
  brainControl.reply = null;
  broadcast.chats.length = 0;
});

afterEach(() => {
  clearBotSession("JDEF1");
  clearBotSession("JDEF2");
  clearBotSession("JDEF3");
});

describe("Thằng Hề tự bào chữa", () => {
  it("KHÔNG được nhận chỉ thị thuyết phục làng đừng treo mình", async () => {
    /*
     * Ca hồi quy.
     *
     * Chuỗi lỗi: `decideChatClaim` trả `null` cho Hề (đúng - nó không khai
     * vai), machine thay `null` bằng một ý định DISAGREE cứng, rồi prompt gắn
     * thêm "Nói một hoặc hai câu để thuyết phục làng đừng treo bạn." Kết quả
     * là con BOT được bảo hãy làm đúng thứ phá hỏng điều kiện thắng của nó.
     */
    const room = votingRoom("JESTER", "JDEF1");
    await runDefense(room);

    const request = defenseRequest();
    expect(request.defense?.stance).toBe("INDIFFERENT");

    const { buildDaySpeechPrompt } = await import("../src/bots/prompt");
    const prompt = buildDaySpeechPrompt(request).user;
    expect(prompt).not.toContain("thuyết phục làng đừng treo bạn");
    expect(prompt).not.toContain("phản bác lại việc mình bị nghi ngờ");
  });

  it("ý định KHÔNG phải DISAGREE - nó không phản bác việc bị nghi", async () => {
    const room = votingRoom("JESTER", "JDEF1");
    await runDefense(room);

    expect(defenseRequest().intention.kind).not.toBe("DISAGREE");
  });

  it("không tiết lộ vai thật, và không xin bị treo", async () => {
    // Hai điều kiện cùng lúc: một con Hề hét "treo tôi đi" thì làng tha ngay,
    // còn một con Hề khai đúng vai thì cũng vậy.
    const room = votingRoom("JESTER", "JDEF1");
    await runDefense(room);

    const request = defenseRequest();
    expect(request.intention.claimedRole).toBeUndefined();

    const prompt = (await import("../src/bots/prompt")).buildDaySpeechPrompt(request).user;
    expect(prompt).not.toContain("Thằng Hề");
    expect(prompt.toLowerCase()).not.toContain("treo tôi");
  });

  it("đường lui KHÔNG dùng LLM cũng không cãi để được sống", async () => {
    /*
     * `brainControl.reply === null` nên nhà cung cấp hỏng ở mọi lượt: câu phát
     * ra đến từ bảng mẫu tất định. Đây là đường chạy thật của production mỗi
     * khi hết quota hoặc mạng lỗi, nên nó phải mang đúng thái độ - sửa mỗi
     * prompt là sửa một nửa.
     */
    const room = votingRoom("JESTER", "JDEF1");
    await runDefense(room);

    const text = spokenText();
    // Câu phải THẬT SỰ được phát ra: một khẳng định "không chứa từ X" là vô
    // nghĩa nếu câu đó tình cờ rỗng, và im lặng cũng không phải hành vi đúng ở
    // đây - một bị cáo câm trông như màn hình hỏng.
    expect(text.length).toBeGreaterThan(0);
    // Scheduler đa bot (Task 2): bị cáo được tối đa 2 lượt/phiên thay vì đúng
    // một như trước. Phòng này chỉ có một bot (chính bị cáo) nên mọi câu đều
    // của nó, và mọi câu đều phải giữ đúng thái độ Hề.
    expect(broadcast.chats.length).toBeLessThanOrEqual(2);

    // Và chúng phải đến từ đúng bể mẫu HUMOR, tức bể đã được đọc từng câu để
    // bảo đảm không câu nào thanh minh, cầu xin hay lộ vai.
    for (const message of broadcast.chats) {
      expect(message.playerId).toBe("p2");
      expect(HUMOR_LINES).toContain(message.text);
    }

    for (const begging of ["đừng treo", "không phải tôi", "phản đối", "oan", "tha cho"]) {
      expect(text.toLowerCase()).not.toContain(begging);
    }
    expect(text).not.toContain("Hề");
  });
});

describe("các vai khác giữ nguyên lượt bào chữa", () => {
  it("Dân Làng vẫn được bảo hãy thuyết phục làng đừng treo mình", async () => {
    const room = votingRoom("VILLAGER", "JDEF2");
    await runDefense(room);

    const request = defenseRequest();
    expect(request.defense?.stance).toBe("SURVIVE");
    expect(request.intention.kind).toBe("DISAGREE");

    const prompt = (await import("../src/bots/prompt")).buildDaySpeechPrompt(request).user;
    expect(prompt).toContain("thuyết phục làng đừng treo bạn");
  });

  it("vai chức năng vẫn lôi vai thật ra làm lá bài cuối", async () => {
    // Nhánh UNDER_FIRE của `decideChatClaim`, không được đụng tới.
    const room = votingRoom("GUARD", "JDEF3");
    await runDefense(room);

    const request = defenseRequest();
    expect(request.intention.kind).toBe("CLAIM_ROLE");
    expect(request.intention.claimedRole).toBe("GUARD");
    expect(request.defense?.stance).toBe("SURVIVE");
  });
});
