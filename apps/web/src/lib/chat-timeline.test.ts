import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage, RoomSnapshot } from "@masoi/shared";
import {
  buildChatTimeline,
  isNearBottom,
  nextPhaseMarkers,
  type PhaseMarker,
} from "./chat-timeline";

function message(id: string, at: number): ChatMessage {
  return { id, channel: "day", playerId: "a", playerName: "An", text: id, at };
}

function snapshot(patch: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    phase: "DEFENSE",
    round: 2,
    phaseEndsAt: 30_000,
    trial: { accusedId: "hai-yen", accusedName: "Hải Yến" },
    ...patch,
  } as unknown as RoomSnapshot;
}

describe("nextPhaseMarkers", () => {
  it("đặt mốc mang tên người biện hộ khi vào pha biện hộ", () => {
    const markers = nextPhaseMarkers([], snapshot(), 5_000);

    assert.equal(markers.length, 1);
    assert.equal(markers[0].label, "Hải Yến bắt đầu biện hộ");
    assert.equal(markers[0].at, 5_000);
  });

  it("không đặt mốc thứ hai cho cùng một lần vào pha", () => {
    const first = nextPhaseMarkers([], snapshot(), 5_000);
    // Server đẩy snapshot vài lần một giây trong pha cao điểm; mảng phải giữ
    // nguyên THAM CHIẾU để khung chat không render lại theo.
    assert.equal(nextPhaseMarkers(first, snapshot(), 6_000), first);
  });

  it("phiên xử thứ hai trong cùng vòng vẫn có mốc riêng", () => {
    const first = nextPhaseMarkers([], snapshot(), 5_000);
    const second = nextPhaseMarkers(first, snapshot({ phaseEndsAt: 90_000 }), 60_000);

    assert.equal(second.length, 2);
  });

  it("bỏ qua những pha không đổi quyền nói", () => {
    assert.deepEqual(nextPhaseMarkers([], snapshot({ phase: "VOTING" }), 1_000), []);
    assert.deepEqual(nextPhaseMarkers([], snapshot({ phase: "ELIMINATION" }), 1_000), []);
  });

  it("mốc pha thường mang cả nhãn vòng", () => {
    const markers = nextPhaseMarkers([], snapshot({ phase: "NIGHT", round: 3 }), 1_000);

    assert.equal(markers[0].label, "Ban đêm · Đêm thứ 3");
  });

  it("cắt bớt mốc cũ thay vì phình mãi", () => {
    let markers: PhaseMarker[] = [];
    for (let i = 0; i < 20; i += 1) {
      markers = nextPhaseMarkers(markers, snapshot({ phaseEndsAt: i }), i, 4);
    }

    assert.equal(markers.length, 4);
  });
});

describe("buildChatTimeline", () => {
  const markers: PhaseMarker[] = [{ id: "m1", label: "Hải Yến bắt đầu biện hộ", at: 100 }];

  it("chèn vạch ngăn ngay trước tin nhắn đầu tiên của pha mới", () => {
    const items = buildChatTimeline([message("cũ", 50), message("mới", 150)], markers);

    assert.deepEqual(
      items.map((item) => (item.kind === "divider" ? `[${item.label}]` : item.message.id)),
      ["cũ", "[Hải Yến bắt đầu biện hộ]", "mới"],
    );
  });

  it("không mở đầu danh sách bằng một vạch ngăn", () => {
    // Vạch ở dòng đầu không ngăn cách được gì, nó chỉ đẩy tin nhắn xuống.
    const items = buildChatTimeline([message("mới", 150)], markers);

    assert.deepEqual(items.map((item) => item.kind), ["message"]);
  });

  it("pha trôi qua mà không ai nói thì không để lại vạch nào", () => {
    const items = buildChatTimeline([message("cũ", 50)], markers);

    assert.deepEqual(items.map((item) => item.kind), ["message"]);
  });

  it("giữ nguyên thứ tự khi có nhiều mốc", () => {
    const items = buildChatTimeline(
      [message("a", 10), message("b", 120), message("c", 220)],
      [
        { id: "m2", label: "sau", at: 200 },
        { id: "m1", label: "trước", at: 100 },
      ],
    );

    assert.deepEqual(
      items.map((item) => (item.kind === "divider" ? item.label : item.message.id)),
      ["a", "trước", "b", "sau", "c"],
    );
  });

  it("không mốc nào thì trả về đúng danh sách tin nhắn", () => {
    const items = buildChatTimeline([message("a", 1)], []);

    assert.deepEqual(items.map((item) => item.kind), ["message"]);
  });
});

describe("isNearBottom", () => {
  it("coi là đang ở đáy khi chỉ lệch vài chục pixel", () => {
    assert.equal(isNearBottom({ scrollTop: 940, scrollHeight: 1_000, clientHeight: 40 }), true);
  });

  it("đang đọc lại đoạn cũ thì KHÔNG bị kéo xuống đáy", () => {
    assert.equal(isNearBottom({ scrollTop: 0, scrollHeight: 1_000, clientHeight: 400 }), false);
  });

  it("danh sách ngắn hơn khung luôn tính là ở đáy", () => {
    assert.equal(isNearBottom({ scrollTop: 0, scrollHeight: 120, clientHeight: 400 }), true);
  });
});
