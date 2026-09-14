import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG, PRESET_DECKS, type RoomConfig } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

const calls = vi.hoisted(() => ({ persist: 0, broadcast: 0 }));
const rooms = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../src/rooms/store", () => ({
  allRooms: () => (rooms.current ? [rooms.current] : []),
  getRoom: () => rooms.current,
  persistRoom: async () => {
    calls.persist++;
  },
  removeRoom: () => undefined,
  createRoom: () => {
    throw new Error("không dùng");
  },
  deletePersistedRoom: async () => undefined,
  setAbandonCheckTimer: () => undefined,
  clearRoomTimers: () => undefined,
  setRoomTimer: () => undefined,
  roomCodeTaken: async () => false,
}));
vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => {
    calls.broadcast++;
  },
  emitToPlayers: () => undefined,
}));
vi.mock("../src/db", () => ({ prisma: { player: { findUnique: async () => null } } }));
vi.mock("../src/redis", () => ({
  redis: { get: async () => null, set: async () => undefined, del: async () => undefined },
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));
vi.mock("../src/voice/service", () => ({
  destroyVoiceRoom: async () => undefined,
  syncVoicePermissions: async () => undefined,
  voiceViewFor: () => null,
  dropVoiceParticipant: async () => undefined,
}));

const { roomService } = await import("../src/rooms/service");

/**
 * Cổng cân bằng và cổng cỡ bàn của `updateConfig` chỉ được gác BỘ BÀI.
 *
 * Kịch bản thật: phòng 10 người áp preset 10, người thứ 11 vào. Bộ bài giờ
 * lệch (điểm 38, dưới ngưỡng 40) và thiếu một ghế. Chuyện đó đúng - host phải
 * sửa bộ bài trước khi bắt đầu, và `start` vẫn chặn. Nhưng bản cũ chấm cân
 * bằng cho MỌI lượt đổi cấu hình, nên ngay cả gạt Phong thư sau cùng hay đổi
 * giây thảo luận cũng bị từ chối bằng BALANCE_UNSTABLE - trong khi lỗi ấy hiện
 * ở cột chính, không ở lớp phủ thiết lập đang mở. Với host, công tắc chỉ đơn
 * giản là không ăn.
 */
function room(members: number, config: RoomConfig): Room {
  return {
    ...ROOM_SCAFFOLD,
    code: "GATE1",
    hostId: "host",
    status: "LOBBY",
    members: Array.from({ length: members }, (_, i) => ({
      playerId: i === 0 ? "host" : `p${i + 1}`,
      name: `P${i + 1}`,
      ready: true,
      connected: true,
      isBot: i > 0,
    })),
    config,
    engine: null,
    chatLog: [],
    createdAt: Date.now(),
  } as Room;
}

/** Preset 10 ở bàn 11 người: lệch về Sói VÀ thiếu ghế - cả hai cổng đều đỏ. */
const STALE_DECK: RoomConfig = { ...PRESET_DECKS[10], mode: "ranked" };

beforeEach(() => {
  calls.persist = 0;
  calls.broadcast = 0;
  rooms.current = room(11, STALE_DECK);
});

describe("updateConfig với bộ bài đang lệch (Ranked)", () => {
  it("vẫn cho gạt add-on Phong thư sau cùng", () => {
    expect(() => roomService.updateConfig("host", { ...STALE_DECK, lastLetter: true })).not.toThrow();
    expect((rooms.current as Room).config.lastLetter).toBe(true);
    expect(calls.persist).toBe(1);
  });

  it("vẫn cho đổi thời gian từng pha", () => {
    expect(() => roomService.updateConfig("host", { ...STALE_DECK, discussionSeconds: 120 })).not.toThrow();
    expect((rooms.current as Room).config.discussionSeconds).toBe(120);
  });

  it("vẫn cho bật voice", () => {
    expect(() => roomService.updateConfig("host", { ...STALE_DECK, voice: true })).not.toThrow();
    expect((rooms.current as Room).config.voice).toBe(true);
  });

  it("cho chuyển Chaos -> Ranked: nút Bắt đầu và thẻ cảnh báo mới là chỗ nói bộ bài lệch", () => {
    rooms.current = room(11, { ...STALE_DECK, mode: "chaos" });
    expect(() => roomService.updateConfig("host", { ...STALE_DECK, mode: "ranked" })).not.toThrow();
    expect((rooms.current as Room).config.mode).toBe("ranked");
  });

  it("vẫn CHẶN một bộ bài mới mà lệch, ở Ranked", () => {
    const worse: RoomConfig = { ...STALE_DECK, werewolves: 4 };
    expect(() => roomService.updateConfig("host", worse)).toThrow(/BALANCE_UNSTABLE/);
    expect(calls.persist).toBe(0);
  });

  it("vẫn CHẶN một bộ bài không còn chỗ cho Dân Làng", () => {
    const noVillager: RoomConfig = { ...PRESET_DECKS[11], villagers: 0 };
    expect(() => roomService.updateConfig("host", noVillager)).toThrow(/chỗ cho Dân Làng/);
    expect(calls.persist).toBe(0);
  });

  it("cho áp preset đúng cỡ bàn", () => {
    expect(() => roomService.updateConfig("host", { ...PRESET_DECKS[11], lastLetter: true })).not.toThrow();
    expect((rooms.current as Room).config.werewolves).toBe(PRESET_DECKS[11].werewolves);
    expect((rooms.current as Room).config.lastLetter).toBe(true);
  });
});

describe("updateConfig ở bàn 6-7 người", () => {
  it("cho gạt add-on dù chưa đủ người bắt đầu", () => {
    rooms.current = room(7, { ...DEFAULT_ROOM_CONFIG });
    expect(() => roomService.updateConfig("host", { ...DEFAULT_ROOM_CONFIG, lastLetter: true })).not.toThrow();
    expect((rooms.current as Room).config.lastLetter).toBe(true);
  });

  /*
   * Cổng cũ là `members.length >= 6` nhưng lại gọi `validateRoomConfig`, mà
   * dòng đầu của hàm đó chặn dưới `MIN_PLAYERS_TO_START` (8). Bàn 6-7 người vì
   * thế nhận lại "Cần ít nhất 8 người để bắt đầu" cho một thao tác chẳng liên
   * quan gì tới việc bắt đầu - và ô Dân Làng thì đứng im.
   */
  it("cho chỉnh số Dân Làng, không trả về câu lỗi của nút Bắt đầu", () => {
    const base: RoomConfig = { ...DEFAULT_ROOM_CONFIG, villagers: 3 };
    rooms.current = room(7, base);
    expect(() => roomService.updateConfig("host", { ...base, villagers: 4 })).not.toThrow();
    expect((rooms.current as Room).config.villagers).toBe(4);
  });
});

/**
 * Bảng xếp bài đổi ĐÚNG MỘT LÁ mỗi cú bấm.
 *
 * Bản cũ đòi bộ bài khớp đúng sĩ số ở mỗi lượt `update-config`, nên trạng thái
 * ngay sau mỗi cú bấm luôn lệch một người và luôn bị đá về: không có đường đi
 * nào giữa hai bộ bài hợp lệ. Với host thì hai ô +/− và cả mười mấy công tắc
 * vai đơn giản là không ăn - đó là lỗi mà cả file này gác.
 */
describe("chỉnh từng lá một trên bàn đã đủ người", () => {
  const P11 = PRESET_DECKS[11];

  beforeEach(() => {
    rooms.current = room(11, { ...P11, mode: "ranked" });
  });

  it("thêm một Dân Làng: bộ bài giờ cần 12 người, và server nhận", () => {
    const grown: RoomConfig = { ...P11, villagers: (P11.villagers ?? 1) + 1 };
    expect(() => roomService.updateConfig("host", grown)).not.toThrow();
    expect((rooms.current as Room).config.villagers).toBe((P11.villagers ?? 1) + 1);
  });

  it("bật thêm một vai: cũng chỉ lệch một người, cũng phải nhận", () => {
    expect(() => roomService.updateConfig("host", { ...P11, detective: true })).not.toThrow();
    expect((rooms.current as Room).config.detective).toBe(true);
  });

  it("lệch sĩ số vẫn CHẶN ở nút Bắt đầu, chỉ không chặn ở lối xếp bài", () => {
    const grown: RoomConfig = { ...P11, villagers: (P11.villagers ?? 1) + 1 };
    roomService.updateConfig("host", grown);
    expect(() => roomService.start("host")).toThrow(/Bộ bài cần 12 người, phòng đang có 11/);
  });

  it("thêm Sói vào bàn 11 vẫn bị cân bằng chặn, nhưng nói ra thành câu", () => {
    // Không phải im lặng: đây là luật cân bằng làm đúng việc của nó. Host mở
    // rộng bàn trước rồi thêm Sói sau - đường đó đi được, xem test kế tiếp.
    //
    // Đổi Thị Trưởng lấy Sói để bộ bài GIỮ 11 lá (điểm 30.5). Chỉ thêm Sói thì
    // bộ bài thành 12 lá và được chấm bằng preset 12 (`sized = deckSize`); từ
    // khi preset 12 nhận Kẻ Nguyền Rủa (2026-09-11) nó ra 53 và không bị chặn.
    expect(() =>
      roomService.updateConfig("host", { ...P11, werewolves: 3, mayor: false }),
    ).toThrow(/BALANCE_UNSTABLE/);
  });

  it("nới bàn rộng ra rồi mới thêm Sói thì đi được tới đích", () => {
    let cfg: RoomConfig = { ...P11, mode: "ranked" };
    for (const villagers of [2, 3, 4]) {
      cfg = { ...cfg, villagers };
      expect(() => roomService.updateConfig("host", cfg), `villagers ${villagers}`).not.toThrow();
    }
    cfg = { ...cfg, werewolves: 3 };
    expect(() => roomService.updateConfig("host", cfg)).not.toThrow();
    expect((rooms.current as Room).config.werewolves).toBe(3);
  });
});
