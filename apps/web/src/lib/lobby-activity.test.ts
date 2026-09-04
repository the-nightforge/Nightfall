import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  captureLobbyPresence,
  deriveLobbyActivity,
  lobbyWaitingLine,
} from "./lobby-activity";

function presence(
  players: Array<{
    id: string;
    name: string;
    ready?: boolean;
    connected?: boolean;
    isBot?: boolean;
  }>,
  hostId = "host",
) {
  return {
    hostId,
    players: players.map((player) => ({
      ready: false,
      connected: true,
      isBot: false,
      ...player,
    })),
  };
}

describe("deriveLobbyActivity", () => {
  it("thông báo người thật vừa vào nhưng không biến bot mới thành hoạt động xã hội", () => {
    const before = captureLobbyPresence(presence([{ id: "host", name: "Lan" }]));
    const after = captureLobbyPresence(
      presence([
        { id: "host", name: "Lan" },
        { id: "minh", name: "Minh" },
        { id: "bot", name: "Bot 1", isBot: true, connected: false },
      ]),
    );

    assert.deepEqual(deriveLobbyActivity(before, after), ["Minh vừa bước vào làng."]);
  });

  it("phân biệt ready, mất kết nối và quay lại", () => {
    const before = captureLobbyPresence(
      presence([
        { id: "host", name: "Lan" },
        { id: "minh", name: "Minh" },
        { id: "an", name: "An", connected: false },
      ]),
    );
    const after = captureLobbyPresence(
      presence([
        { id: "host", name: "Lan" },
        { id: "minh", name: "Minh", ready: true, connected: false },
        { id: "an", name: "An", connected: true },
      ]),
    );

    assert.deepEqual(deriveLobbyActivity(before, after), [
      "Minh đã sẵn sàng.",
      "Minh bị mất kết nối.",
      "An đã quay lại làng.",
    ]);
  });

  it("nêu tên chủ phòng mới và người vừa rời", () => {
    const before = captureLobbyPresence(
      presence([
        { id: "host", name: "Lan" },
        { id: "minh", name: "Minh" },
      ]),
    );
    const after = captureLobbyPresence(presence([{ id: "minh", name: "Minh" }], "minh"));

    assert.deepEqual(deriveLobbyActivity(before, after), [
      "Lan đã rời khỏi làng.",
      "Minh đã trở thành chủ phòng.",
    ]);
  });
});

describe("lobbyWaitingLine", () => {
  it("ưu tiên điều kiện còn thiếu người", () => {
    assert.equal(
      lobbyWaitingLine({ playerCount: 4, minimumPlayers: 6, unreadyCount: 0 }),
      "Đang chờ thêm 2 dân làng...",
    );
  });

  it("đếm người chưa sẵn sàng khi đã đủ bàn", () => {
    assert.equal(
      lobbyWaitingLine({ playerCount: 8, minimumPlayers: 6, unreadyCount: 2 }),
      "Còn 2 người chưa sẵn sàng.",
    );
  });

  it("xác nhận cả làng đã sẵn sàng", () => {
    assert.equal(
      lobbyWaitingLine({ playerCount: 8, minimumPlayers: 6, unreadyCount: 0 }),
      "Mọi người đã sẵn sàng. Đêm đang đến gần.",
    );
  });
});
