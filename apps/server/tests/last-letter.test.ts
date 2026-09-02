import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, LAST_LETTER_MAX_LENGTH } from "@masoi/shared";
import type { Role } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

vi.mock("../src/rooms/store", async () => {
  const actual = await vi.importActual<typeof import("../src/rooms/store")>("../src/rooms/store");
  return { ...actual, persistRoom: async () => undefined };
});

const {
  clearLastLetters,
  lastLetterStateOf,
  lastLetterViewFor,
  openLastLettersForDeaths,
  submitLastLetter,
} = await import("../src/game/last-letter");

/**
 * Luật của add-on "Phong thư sau cùng" ở tầng phòng.
 *
 * Trạng thái thư sống trong `Room`, không trong engine: nó không đổi luật thắng
 * thua và không có nhánh nào của máy trạng thái đọc nó, nên nhét vào `GameState`
 * chỉ để bắt `PERSISTENCE_VERSION` phải tăng và giết mọi ván đang chạy lúc deploy.
 *
 * Ba nhóm khẳng định, và nhóm giữa là nhóm quan trọng nhất:
 *   1. Ai được viết, khi nào.
 *   2. BẢN NHÁP KHÔNG BAO GIỜ RỜI KHỎI SNAPSHOT CỦA CHỦ NHÂN.
 *   3. Một lá thư mở đúng một lần, dù chết bằng đường nào.
 */

const NAMES = ["An", "Bình", "Cường", "Dũng", "Hạnh", "Khoa"] as const;
const ROLES: Role[] = ["WEREWOLF", "SEER", "GUARD", "HUNTER", "VILLAGER", "VILLAGER"];

interface RoomOptions {
  enabled?: boolean;
  phase?: "DAY_DISCUSSION" | "NIGHT" | "VOTING";
  deadIds?: string[];
}

function makeRoom(options: RoomOptions = {}): Room {
  const enabled = options.enabled ?? true;
  const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 1, hunter: true, lastLetter: enabled };
  const engine = GameEngine.create(
    NAMES.map((name, index) => ({ id: `p${index + 1}`, name, isBot: false })),
    config,
  );
  engine.state.players.forEach((player, index) => {
    player.role = ROLES[index];
    player.alive = !(options.deadIds ?? []).includes(player.id);
  });
  engine.state.round = 1;

  const phase = options.phase ?? "DAY_DISCUSSION";
  if (phase === "DAY_DISCUSSION") engine.startDay(60_000, Date.now(), () => 0, null);
  else engine.setPhase(phase, 30_000);

  return {
    ...ROOM_SCAFFOLD,
    code: "LTR01",
    hostId: "p1",
    status: "IN_GAME",
    members: engine.state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config,
    engine,
    chatLog: [],
    createdAt: 0,
  };
}

/** Đưa vòng tới `round` mà không phải chạy trọn một chu kỳ ngày/đêm. */
function advanceRound(room: Room, round: number): void {
  room.engine!.state.round = round;
}

function kill(room: Room, ...ids: string[]): void {
  for (const id of ids) room.engine!.player(id)!.alive = false;
}

beforeEach(() => {
  // Trạng thái thư nằm trong chính object `Room`, nhưng dọn tường minh vẫn rẻ
  // hơn là để một fixture rò sang bài kế.
  clearLastLetters(makeRoom());
});

describe("add-on tắt là không có gì thay đổi", () => {
  it("mặc định tắt", () => {
    expect(DEFAULT_ROOM_CONFIG.lastLetter).toBeUndefined();
  });

  it("snapshot không mang trường phong thư khi add-on tắt", () => {
    const room = makeRoom({ enabled: false });
    expect(lastLetterViewFor(room, "p1")).toBeNull();
  });

  it("không gửi được thư khi add-on tắt", () => {
    const room = makeRoom({ enabled: false });
    expect(submitLastLetter(room, "p1", "Tôi nghi Bình")).toMatch(/không bật/i);
    expect(lastLetterStateOf(room).drafts["p1"]).toBeUndefined();
  });

  it("người chết khi add-on tắt không sinh ra record nào", () => {
    const room = makeRoom({ enabled: false });
    kill(room, "p2");
    expect(openLastLettersForDeaths(room)).toEqual([]);
    expect(lastLetterStateOf(room).opened).toEqual([]);
  });
});

describe("ai được viết, và khi nào", () => {
  it("tạo, sửa rồi xoá được thư trong DAY_DISCUSSION", () => {
    const room = makeRoom();

    expect(submitLastLetter(room, "p1", "Bản đầu")).toBeNull();
    expect(lastLetterViewFor(room, "p1")!.mine.text).toBe("Bản đầu");

    expect(submitLastLetter(room, "p1", "Bản sửa")).toBeNull();
    expect(lastLetterViewFor(room, "p1")!.mine.text).toBe("Bản sửa");

    expect(submitLastLetter(room, "p1", null)).toBeNull();
    expect(lastLetterViewFor(room, "p1")!.mine.text).toBeNull();
    expect(lastLetterStateOf(room).drafts["p1"]).toBeUndefined();
  });

  it("mỗi người chỉ giữ MỘT bản nháp - lần lưu sau đè lần trước", () => {
    const room = makeRoom();
    submitLastLetter(room, "p1", "một");
    submitLastLetter(room, "p1", "hai");
    submitLastLetter(room, "p1", "ba");
    expect(Object.keys(lastLetterStateOf(room).drafts)).toEqual(["p1"]);
    expect(lastLetterStateOf(room).drafts["p1"]!.text).toBe("ba");
  });

  it("ghi lại vòng của bản cuối, và cập nhật khi sửa ở ngày sau", () => {
    const room = makeRoom();
    submitLastLetter(room, "p1", "viết vòng 1");
    expect(lastLetterViewFor(room, "p1")!.mine.updatedRound).toBe(1);

    advanceRound(room, 3);
    submitLastLetter(room, "p1", "sửa vòng 3");
    expect(lastLetterViewFor(room, "p1")!.mine.updatedRound).toBe(3);
  });

  it("người chết không viết được", () => {
    const room = makeRoom({ deadIds: ["p5"] });
    expect(submitLastLetter(room, "p5", "cho tôi nói với")).toMatch(/đã chết/i);
    expect(lastLetterStateOf(room).drafts["p5"]).toBeUndefined();
  });

  it("không viết được ngoài DAY_DISCUSSION", () => {
    for (const phase of ["NIGHT", "VOTING"] as const) {
      const room = makeRoom({ phase });
      expect(submitLastLetter(room, "p1", "sai pha")).toMatch(/thảo luận/i);
      expect(lastLetterStateOf(room).drafts["p1"]).toBeUndefined();
    }
  });

  it("người ngoài phòng không viết được", () => {
    const room = makeRoom();
    expect(submitLastLetter(room, "kẻ-lạ", "xin chào")).toMatch(/không ở trong phòng/i);
  });

  it("không viết được khi chưa có trận", () => {
    const room = makeRoom();
    room.engine = null;
    room.status = "LOBBY";
    expect(submitLastLetter(room, "p1", "sớm quá")).toMatch(/trận đấu/i);
  });

  it("cắt khoảng trắng và từ chối thư rỗng", () => {
    const room = makeRoom();
    expect(submitLastLetter(room, "p1", "   ")).toMatch(/trống/i);
    expect(lastLetterStateOf(room).drafts["p1"]).toBeUndefined();

    submitLastLetter(room, "p1", "  có chữ  ");
    expect(lastLetterStateOf(room).drafts["p1"]!.text).toBe("có chữ");
  });

  it("chặn thư quá dài ở tầng cuối, không tin schema là đủ", () => {
    const room = makeRoom();
    expect(submitLastLetter(room, "p1", "a".repeat(LAST_LETTER_MAX_LENGTH + 1))).toMatch(
      new RegExp(String(LAST_LETTER_MAX_LENGTH)),
    );
    expect(lastLetterStateOf(room).drafts["p1"]).toBeUndefined();
  });

  it("canEdit chỉ đúng khi còn sống và đang thảo luận", () => {
    const day = makeRoom({ deadIds: ["p5"] });
    expect(lastLetterViewFor(day, "p1")!.mine.canEdit).toBe(true);
    expect(lastLetterViewFor(day, "p5")!.mine.canEdit).toBe(false);

    const night = makeRoom({ phase: "NIGHT" });
    expect(lastLetterViewFor(night, "p1")!.mine.canEdit).toBe(false);
  });
});

describe("bí mật của bản nháp", () => {
  it("draft chỉ xuất hiện trong snapshot của chính chủ", () => {
    const room = makeRoom();
    submitLastLetter(room, "p1", "Bình rất khả nghi");

    expect(lastLetterViewFor(room, "p1")!.mine.text).toBe("Bình rất khả nghi");
    for (const other of ["p2", "p3", "p4", "p5", "p6"]) {
      expect(lastLetterViewFor(room, other)!.mine.text).toBeNull();
    }
  });

  it("snapshot người khác không chứa nội dung thư dưới BẤT KỲ dạng nào", () => {
    const room = makeRoom();
    const secret = "mật khẩu của tôi là con mèo";
    submitLastLetter(room, "p1", secret);

    const serialized = JSON.stringify(lastLetterViewFor(room, "p2"));
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("p1");
  });

  it("không tiết lộ AI đang có thư", () => {
    const room = makeRoom();
    submitLastLetter(room, "p1", "thư của An");
    submitLastLetter(room, "p3", "thư của Cường");

    const view = lastLetterViewFor(room, "p2")!;
    // Không có mảng, không có bộ đếm, không có cờ nào nói "p1 và p3 đã viết".
    expect(JSON.stringify(view)).not.toContain("p1");
    expect(JSON.stringify(view)).not.toContain("p3");
    expect(view.mine).toEqual({ text: null, updatedRound: null, canEdit: true });
  });

  it("người sống tới cuối ván không bị lộ thư, kể cả ở GAME_OVER", () => {
    const room = makeRoom();
    submitLastLetter(room, "p1", "tôi sống sót");
    kill(room, "p5", "p6");
    openLastLettersForDeaths(room);

    room.engine!.state.phase = "GAME_OVER";
    room.engine!.state.winner = "village";

    expect(lastLetterViewFor(room, "p2")!.opened).toEqual([]);
    expect(JSON.stringify(lastLetterViewFor(room, "p2"))).not.toContain("tôi sống sót");
    // Chính chủ vẫn đọc lại được bản nháp của mình - nó chỉ không công khai.
    expect(lastLetterViewFor(room, "p1")!.mine.text).toBe("tôi sống sót");
  });

  it("thư ĐÃ MỞ là dữ liệu công khai, ai cũng thấy như nhau", () => {
    const room = makeRoom();
    submitLastLetter(room, "p5", "hãy tin An");
    kill(room, "p5");
    openLastLettersForDeaths(room);

    const seen = ["p1", "p2", "p5"].map((id) => lastLetterViewFor(room, id)!.opened);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0][0].text).toBe("hãy tin An");
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
  });

  it("thư đã mở không mang vai của người viết", () => {
    const room = makeRoom();
    submitLastLetter(room, "p2", "tôi là ai không quan trọng");
    kill(room, "p2");
    const [letter] = openLastLettersForDeaths(room);

    expect(Object.keys(letter)).not.toContain("role");
    // p2 là SEER; không được có dấu vết nào của vai trong payload.
    expect(JSON.stringify(letter)).not.toContain("SEER");
  });
});

describe("mở thư khi người viết chết", () => {
  it("mở đúng một lần khi chết ban đêm", () => {
    const room = makeRoom();
    submitLastLetter(room, "p5", "đừng tin Cường");

    room.engine!.setPhase("NIGHT", 30_000);
    room.engine!.state.night.wolfVotes = { p1: "p5" };
    room.engine!.resolveNight(Date.now(), () => 0);
    expect(room.engine!.player("p5")!.alive).toBe(false);

    expect(openLastLettersForDeaths(room)).toHaveLength(1);
    expect(openLastLettersForDeaths(room)).toHaveLength(0);
    expect(lastLetterStateOf(room).opened).toHaveLength(1);
    expect(lastLetterStateOf(room).opened[0].text).toBe("đừng tin Cường");
  });

  it("mở đúng một lần khi bị treo sau FINAL_VOTE", () => {
    const room = makeRoom();
    submitLastLetter(room, "p6", "tôi vô tội");

    const engine = room.engine!;
    engine.setPhase("VOTING", 30_000);
    for (const voter of ["p1", "p2", "p3", "p4", "p5"]) engine.submitVote(voter, "p6");
    engine.resolveNomination(10_000);
    engine.beginFinalVote(10_000);
    for (const voter of ["p1", "p2", "p3", "p4", "p5"]) engine.submitFinalVote(voter, true);
    engine.resolveFinalVote();
    expect(engine.player("p6")!.alive).toBe(false);

    expect(openLastLettersForDeaths(room)).toHaveLength(1);
    expect(openLastLettersForDeaths(room)).toHaveLength(0);
    expect(lastLetterStateOf(room).opened[0].authorName).toBe("Khoa");
  });

  it("mở đúng một lần khi bị Thợ Săn bắn", () => {
    const room = makeRoom();
    submitLastLetter(room, "p3", "thư của Cường");

    const engine = room.engine!;
    // Thợ Săn (p4) chết ban đêm rồi bắn p3.
    engine.setPhase("NIGHT", 30_000);
    engine.state.night.wolfVotes = { p1: "p4" };
    engine.resolveNight(Date.now(), () => 0);
    engine.beginHunterShot(10_000);
    engine.submitHunterShot("p4", "p3");
    expect(engine.player("p3")!.alive).toBe(false);

    const opened = openLastLettersForDeaths(room);
    expect(opened).toHaveLength(1);
    expect(opened[0].authorId).toBe("p3");
    expect(openLastLettersForDeaths(room)).toHaveLength(0);
  });

  it("mở thư của cả Thợ Săn lẫn nạn nhân khi cả hai đều có thư", () => {
    const room = makeRoom();
    submitLastLetter(room, "p4", "thư thợ săn");
    submitLastLetter(room, "p3", "thư nạn nhân");

    const engine = room.engine!;
    engine.setPhase("NIGHT", 30_000);
    engine.state.night.wolfVotes = { p1: "p4" };
    engine.resolveNight(Date.now(), () => 0);
    engine.beginHunterShot(10_000);
    engine.submitHunterShot("p4", "p3");

    // Thợ Săn chết TRƯỚC (đêm), nạn nhân chết SAU (phát bắn) - đúng thứ tự engine.
    expect(openLastLettersForDeaths(room).map((letter) => letter.authorId)).toEqual(["p4", "p3"]);
  });

  it("nhiều người chết cùng lúc mở theo thứ tự tử vong của engine, ổn định qua nhiều lần chạy", () => {
    const order = () => {
      const room = makeRoom();
      submitLastLetter(room, "p5", "thư Hạnh");
      submitLastLetter(room, "p6", "thư Khoa");
      submitLastLetter(room, "p3", "thư Cường");

      const engine = room.engine!;
      engine.setPhase("NIGHT", 30_000);
      engine.state.night.wolfVotes = { p1: "p6" };
      engine.state.night.poisonTarget = "p5";
      engine.state.night.witchSkipped = true;
      engine.resolveNight(Date.now(), () => 0);

      const deathOrder = engine.state.lastNightDeaths.map((death) => death.playerId);
      const opened = openLastLettersForDeaths(room).map((letter) => letter.authorId);
      return { deathOrder, opened };
    };

    const first = order();
    expect(first.opened).toHaveLength(2);
    expect(first.opened).toEqual(first.deathOrder.filter((id) => first.opened.includes(id)));
    expect(order().opened).toEqual(first.opened);
  });

  it("người chết mà chưa từng viết thì không tạo record rỗng", () => {
    const room = makeRoom();
    kill(room, "p2", "p5");
    expect(openLastLettersForDeaths(room)).toEqual([]);
    expect(lastLetterStateOf(room).opened).toEqual([]);
  });

  it("người chết từ đêm đầu, chưa kịp viết, thì vĩnh viễn không có thư", () => {
    const room = makeRoom({ deadIds: ["p5"] });
    // Không được phép viết nữa, nên cũng không có gì để mở về sau.
    expect(submitLastLetter(room, "p5", "muộn rồi")).not.toBeNull();
    expect(openLastLettersForDeaths(room)).toEqual([]);
  });

  it("mở ra là niêm phong bản CUỐI, kèm vòng niêm phong", () => {
    const room = makeRoom();
    submitLastLetter(room, "p5", "bản vòng 1");
    advanceRound(room, 2);
    room.engine!.startDay(60_000, Date.now(), () => 0, null);
    submitLastLetter(room, "p5", "bản vòng 2");

    advanceRound(room, 3);
    kill(room, "p5");
    const [letter] = openLastLettersForDeaths(room);
    expect(letter.text).toBe("bản vòng 2");
    expect(letter.sealedRound).toBe(2);
    expect(letter.openedRound).toBe(3);
  });

  it("thư đã mở thì bản nháp biến mất - không còn gì để mở lần hai", () => {
    const room = makeRoom();
    submitLastLetter(room, "p5", "một lần thôi");
    kill(room, "p5");
    openLastLettersForDeaths(room);
    expect(lastLetterStateOf(room).drafts["p5"]).toBeUndefined();
  });
});

describe("dọn dẹp", () => {
  it("reset về sảnh chờ xoá sạch cả nháp lẫn thư đã mở", () => {
    const room = makeRoom();
    submitLastLetter(room, "p1", "còn sống");
    submitLastLetter(room, "p5", "sắp chết");
    kill(room, "p5");
    openLastLettersForDeaths(room);
    expect(lastLetterStateOf(room).opened).toHaveLength(1);

    clearLastLetters(room);

    const state = lastLetterStateOf(room);
    expect(state.drafts).toEqual({});
    expect(state.opened).toEqual([]);
    expect(state.openedAuthorIds).toEqual([]);
  });
});
