import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, PRESET_DECKS, type RoomConfig, type RoomSnapshot } from "@masoi/shared";
import {
  GUIDE_DECK,
  GUIDE_PREP_MAX_ATTEMPTS,
  GUIDE_PREP_RETRY_MS,
  GUIDE_PREP_STALL_MS,
  GUIDE_TABLE_SIZE,
  hasGuideDeck,
  initialGuidePrepState,
  stepGuidePrep,
  type GuidePrepEmit,
  type GuidePrepState,
} from "./guide-prep";

/**
 * Một "server" tối giản cho máy trạng thái: giữ cấu hình + sĩ số, nhận đúng
 * hai sự kiện, và chỉ phát snapshot khi được bảo. Bài test tích hợp với
 * `roomService` THẬT nằm ở `apps/server/tests/guide-prep-integration.test.ts`;
 * ở đây là những đường mà server thật khó dựng: mất gói, chậm, lặp snapshot.
 */
class FakeRoom {
  config: RoomConfig = { ...DEFAULT_ROOM_CONFIG };
  count = 1;
  received: GuidePrepEmit[] = [];
  /** `false` để "nuốt" sự kiện: gửi đi mà server không bao giờ áp dụng. */
  apply = true;
  /** Đồng hồ server: mỗi thay đổi phát một snapshot mới hơn. */
  serverNow = 100;
  /** Sự kiện đã nhận nhưng server CHƯA xử lý (mô phỏng chậm). */
  delayed: GuidePrepEmit[] = [];

  send(emit: GuidePrepEmit): void {
    this.received.push(emit);
    if (!this.apply) return;
    this.applyNow(emit);
  }

  applyNow(emit: GuidePrepEmit): void {
    if (emit.event === "room:update-config") this.config = { ...emit.payload.config };
    else this.count += 1;
    this.serverNow += 1;
  }

  /** Xử lý mọi sự kiện đang chậm. */
  flush(): void {
    for (const emit of this.delayed.splice(0)) this.applyNow(emit);
  }

  snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
    return {
      code: "ABCDE",
      hostId: "me",
      phase: "LOBBY",
      config: { ...this.config },
      round: 0,
      phaseEndsAt: null,
      serverNow: this.serverNow,
      you: { id: "me", name: "Minh", ready: true, connected: true, alive: true },
      players: Array.from({ length: this.count }, (_, i) => ({
        id: i === 0 ? "me" : `bot-${i}`,
        name: `P${i}`,
        alive: true,
      })) as RoomSnapshot["players"],
      night: null,
      hunterShot: null,
      trial: null,
      lastTrial: null,
      hasVoted: false,
      myVote: null,
      noEliminationVoteCount: 0,
      discussionSkip: null,
      votesRevealed: false,
      dayVoteHistory: [],
      nightHistory: [],
      hunterShots: [],
      lastNightDeaths: [],
      lastEliminated: null,
      winner: null,
      chatLog: [],
      log: [],
      ...over,
    };
  }
}

/** Chạy tới khi máy dừng (không emit, không hẹn giờ) hoặc quá số vòng. */
function drive(
  room: FakeRoom,
  state: GuidePrepState,
  options: { isHost?: boolean; connected?: boolean; startAt?: number } = {},
): { state: GuidePrepState; rounds: number } {
  let now = options.startAt ?? 1_000;
  let rounds = 0;
  for (; rounds < 100; rounds += 1) {
    const step = stepGuidePrep(state, {
      snapshot: room.snapshot(),
      isHost: options.isHost ?? true,
      connected: options.connected ?? true,
      now,
    });
    state = step.state;
    if (step.emit) room.send(step.emit);
    if (!step.emit && step.wakeAt === null) break;
    // Có emit thì server phát snapshot mới "ngay"; không thì chờ tới giờ hẹn.
    now = step.emit ? now + 50 : step.wakeAt!;
  }
  return { state, rounds };
}

describe("guide-prep: luật chuẩn bị bàn ván hướng dẫn", () => {
  it("bộ bài ván hướng dẫn là preset của bàn 8 - có Thợ Săn và Thám Tử, khác bộ bài mặc định", () => {
    assert.equal(GUIDE_TABLE_SIZE, 8);
    assert.deepEqual(GUIDE_DECK, PRESET_DECKS[8]);
    assert.equal(GUIDE_DECK.hunter, true);
    assert.equal(GUIDE_DECK.detective, true);
    assert.equal(hasGuideDeck(DEFAULT_ROOM_CONFIG), false);
    assert.equal(hasGuideDeck(GUIDE_DECK), true);
    // Chỉ so phần BÀI: host đổi giây thảo luận không làm mất "bộ bài chuẩn".
    assert.equal(hasGuideDeck({ ...GUIDE_DECK, discussionSeconds: 90 }), true);
  });

  it("đường vui: cấu hình TRƯỚC (1 sự kiện), rồi bot cho tới 8 (7 sự kiện), rồi done", () => {
    const room = new FakeRoom();
    const { state } = drive(room, initialGuidePrepState(false));
    assert.equal(state.stage, "done");
    assert.equal(room.received[0]?.event, "room:update-config");
    assert.deepEqual((room.received[0] as { payload: { config: RoomConfig } }).payload.config, GUIDE_DECK);
    assert.equal(room.received.filter((e) => e.event === "room:add-bot").length, 7);
    assert.equal(room.received.length, 8);
    assert.equal(room.count, 8);
    assert.equal(hasGuideDeck(room.config), true);
  });

  it("cùng một snapshot đọc lại nhiều lần (re-render, StrictMode, reconnect phát lại) không gửi thêm", () => {
    const room = new FakeRoom();
    room.apply = false; // server chưa kịp trả snapshot mới
    let state = initialGuidePrepState(false);
    const now = 5_000;
    for (let i = 0; i < 10; i += 1) {
      const step = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now: now + i * 10 });
      state = step.state;
      if (step.emit) room.send(step.emit);
    }
    assert.equal(room.received.length, 1);
    assert.equal(state.stage, "config");
    assert.equal(state.pending?.attempt, 1);
  });

  it("không có snapshot xác nhận: gửi lại sau mỗi cửa sổ, tối đa N lần, rồi 'failed' - không lặp im lặng", () => {
    const room = new FakeRoom();
    room.apply = false;
    const { state } = drive(room, initialGuidePrepState(false));
    assert.equal(state.stage, "failed");
    assert.equal(room.received.length, GUIDE_PREP_MAX_ATTEMPTS);
    assert.ok(room.received.every((e) => e.event === "room:update-config"));
    // 'failed' là trạng thái dừng: không gửi gì nữa dù snapshot vẫn tới.
    const again = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now: 999_999 });
    assert.equal(again.emit, null);
    assert.equal(again.wakeAt, null);
  });

  it("gửi rồi rớt mạng: không gửi thêm khi đang mất kết nối; nối lại và snapshot đã áp dụng thì đi tiếp", () => {
    const room = new FakeRoom();
    let state = initialGuidePrepState(false);
    const first = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now: 1_000 });
    state = first.state;
    room.send(first.emit!);
    // Mất kết nối, nhưng server ĐÃ áp dụng và sẽ phát lại khi nối.
    const offline = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: false, now: 20_000 });
    assert.equal(offline.emit, null);
    const back = stepGuidePrep(offline.state, { snapshot: room.snapshot(), isHost: true, connected: true, now: 20_100 });
    assert.equal(back.emit?.event, "room:add-bot");
    assert.equal(back.state.pending?.attempt, 1);
  });

  it("chậm nhưng không mất: server áp dụng sau cửa sổ gửi lại thì lần gửi lại bị server coi là 'y hệt' và không hại gì", () => {
    const room = new FakeRoom();
    let state = initialGuidePrepState(false);
    const first = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now: 1_000 });
    state = first.state;
    // Server chưa áp dụng tới hết cửa sổ -> gửi lại lần 2.
    const retry = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now: 1_000 + GUIDE_PREP_RETRY_MS });
    assert.equal(retry.emit?.event, "room:update-config");
    assert.equal(retry.state.pending?.attempt, 2);
    // Giờ cả hai gói tới: cùng một cấu hình, server chỉ đổi một lần.
    room.send(first.emit!);
    room.send(retry.emit!);
    const after = stepGuidePrep(retry.state, { snapshot: room.snapshot(), isHost: true, connected: true, now: 1_000 + GUIDE_PREP_RETRY_MS + 50 });
    assert.equal(after.state.stage, "bots");
    assert.equal(after.emit?.event, "room:add-bot");
  });

  it("không phải host, hoặc chưa có snapshot: không gửi gì, không hẹn giờ", () => {
    const room = new FakeRoom();
    const notHost = stepGuidePrep(initialGuidePrepState(false), { snapshot: room.snapshot(), isHost: false, connected: true, now: 1 });
    assert.equal(notHost.emit, null);
    assert.equal(notHost.wakeAt, null);
    const noSnap = stepGuidePrep(initialGuidePrepState(false), { snapshot: null, isHost: true, connected: true, now: 1 });
    assert.equal(noSnap.emit, null);
    assert.equal(noSnap.wakeAt, null);
  });

  it("đã chuẩn bị xong (tải lại trang sau 'done'): host tự đổi bộ bài hay đuổi bot thì KHÔNG bị sửa lại", () => {
    const room = new FakeRoom();
    room.config = { ...GUIDE_DECK, hunter: false };
    room.count = 7;
    const step = stepGuidePrep(initialGuidePrepState(true), { snapshot: room.snapshot(), isHost: true, connected: true, now: 1 });
    assert.equal(step.emit, null);
    assert.equal(step.state.stage, "done");
  });

  it("phòng đã rời sảnh thì coi như xong: không gửi gì khi ván đang chạy", () => {
    const room = new FakeRoom();
    const step = stepGuidePrep(initialGuidePrepState(false), {
      snapshot: room.snapshot({ phase: "NIGHT" }),
      isHost: true,
      connected: true,
      now: 1,
    });
    assert.equal(step.emit, null);
    assert.equal(step.state.stage, "done");
  });

  it("bàn đã đủ 8 và đúng bộ bài từ đầu (bạn bè vào qua link): done ngay, không đụng gì", () => {
    const room = new FakeRoom();
    room.config = { ...GUIDE_DECK };
    room.count = 9;
    const { state } = drive(room, initialGuidePrepState(false));
    assert.equal(state.stage, "done");
    assert.equal(room.received.length, 0);
  });

  it("một bot bị nuốt giữa chừng: gửi lại đúng bước đó, không gửi cả bảy lần nữa", () => {
    const room = new FakeRoom();
    let state = initialGuidePrepState(false);
    let now = 1_000;
    // Cấu hình + 3 bot xong.
    for (let i = 0; i < 4; i += 1) {
      const step = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now });
      state = step.state;
      room.send(step.emit!);
      now += 50;
    }
    assert.equal(room.count, 4);
    // Bot thứ 4 bị nuốt; server vẫn sống và phát một snapshot mới (không đổi sĩ số).
    room.apply = false;
    const lost = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now });
    room.send(lost.emit!);
    state = lost.state;
    room.apply = true;
    room.serverNow += 1;
    const { state: finalState } = drive(room, state, { startAt: now + GUIDE_PREP_RETRY_MS });
    assert.equal(finalState.stage, "done");
    assert.equal(room.count, 8);
    // 1 cấu hình + 7 bot thật + 1 gói bị nuốt.
    assert.equal(room.received.length, 9);
  });

  it("add-bot KHÔNG được gửi lại theo hẹn giờ: server chậm hơn cửa sổ thì bàn vẫn dừng ở 8, không 9", () => {
    // `room:add-bot` không idempotent như update-config: gửi hai lần là hai bot.
    const room = new FakeRoom();
    room.config = { ...GUIDE_DECK };
    room.count = 7;
    let state = initialGuidePrepState(false);
    const t0 = 1_000;
    const first = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now: t0 });
    assert.equal(first.emit?.event, "room:add-bot");
    state = first.state;
    // Server nhận nhưng chưa xử lý; client không thấy snapshot mới nào.
    room.received.push(first.emit!);
    room.delayed.push(first.emit!);
    // Quá cửa sổ gửi lại: máy KHÔNG được gửi thêm add-bot.
    const late = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now: t0 + GUIDE_PREP_RETRY_MS + 10 });
    assert.equal(late.emit, null);
    state = late.state;
    // Server xử lý xong, phát snapshot 8 người.
    room.flush();
    const after = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now: t0 + GUIDE_PREP_RETRY_MS + 20 });
    assert.equal(after.state.stage, "done");
    assert.equal(after.emit, null);
    assert.equal(room.count, GUIDE_TABLE_SIZE);
    assert.equal(room.received.filter((e) => e.event === "room:add-bot").length, 1);
  });

  it("add-bot mất hẳn và server im: sau thời gian treo thì 'failed' với đúng MỘT add-bot đã gửi, không gửi mò", () => {
    const room = new FakeRoom();
    room.config = { ...GUIDE_DECK };
    room.count = 7;
    room.apply = false;
    const { state } = drive(room, initialGuidePrepState(false));
    assert.equal(state.stage, "failed");
    assert.equal(room.received.length, 1);
  });

  it("add-bot mất, nhưng có snapshot MỚI (server còn sống) mà sĩ số không tăng: gửi lại một lần sau cửa sổ", () => {
    const room = new FakeRoom();
    room.config = { ...GUIDE_DECK };
    room.count = 7;
    let state = initialGuidePrepState(false);
    const t0 = 1_000;
    const first = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now: t0 });
    state = first.state; // gói bị mất, không đưa vào room
    // Host bấm sẵn sàng -> server phát snapshot mới hơn, vẫn 7 người.
    room.serverNow += 1;
    const soon = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now: t0 + 500 });
    assert.equal(soon.emit, null, "chưa hết cửa sổ thì chưa gửi lại");
    state = soon.state;
    const retry = stepGuidePrep(state, { snapshot: room.snapshot(), isHost: true, connected: true, now: t0 + GUIDE_PREP_RETRY_MS + 10 });
    assert.equal(retry.emit?.event, "room:add-bot");
    assert.equal(retry.state.pending?.attempt, 2);
    room.send(retry.emit!);
    const after = stepGuidePrep(retry.state, { snapshot: room.snapshot(), isHost: true, connected: true, now: t0 + GUIDE_PREP_RETRY_MS + 60 });
    assert.equal(after.state.stage, "done");
    assert.equal(room.count, GUIDE_TABLE_SIZE);
  });

  it("thời gian treo dài hơn cửa sổ gửi lại", () => {
    assert.ok(GUIDE_PREP_STALL_MS > GUIDE_PREP_RETRY_MS);
  });
});
