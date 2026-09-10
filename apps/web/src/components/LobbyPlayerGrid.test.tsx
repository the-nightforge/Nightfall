import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";

/**
 * Nút "Chuyển chủ phòng" trong bảng thao tác người chơi ở phòng chờ.
 *
 * Chủ phòng bấm vào ô của một thành viên thật thì ngoài "Mời khỏi phòng" còn
 * có "Chuyển chủ phòng"; bấm vào bot thì không - server từ chối chuyển cho
 * bot (`transferHost` ném "Không thể chuyển chủ phòng cho bot"), nên bày nút
 * ra đó chỉ để người ta bấm vào một lỗi đã biết trước.
 */

GlobalRegistrator.register({ url: "http://localhost:3000/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST_ID = "host-1";
const GUEST_ID = "guest-1";
const BOT_ID = "bot-1";

function snapshot(): RoomSnapshot {
  return {
    code: "TRANSF",
    hostId: HOST_ID,
    phase: "LOBBY",
    config: DEFAULT_ROOM_CONFIG,
    round: 0,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: HOST_ID, name: "Chủ", ready: true, connected: true, alive: true },
    players: [
      { id: HOST_ID, name: "Chủ", alive: true, isBot: false, ready: true },
      { id: GUEST_ID, name: "Khách", alive: true, isBot: false, ready: false },
      { id: BOT_ID, name: "Bot", alive: true, isBot: true, ready: true },
    ],
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
  } as RoomSnapshot;
}

async function mountGrid() {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { LobbyPlayerGrid } = await import("./LobbyPlayerGrid");

  const transferred: string[] = [];
  const kicked: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      React.createElement(LobbyPlayerGrid, {
        snapshot: snapshot(),
        isHost: true,
        onKick: (id: string) => kicked.push(id),
        onTransferHost: (id: string) => transferred.push(id),
      }),
    );
  });

  const openSheet = async (name: string) => {
    const tile = host.querySelector<HTMLButtonElement>(`[aria-label="Mở thao tác với ${name}"]`);
    assert.ok(tile, `không tìm thấy ô của ${name}`);
    await act(async () => {
      tile.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
  };
  const transferButton = () =>
    [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Chuyển chủ phòng");

  return {
    transferred,
    kicked,
    openSheet,
    transferButton,
    clickTransfer: async () => {
      const button = transferButton();
      assert.ok(button, "không tìm thấy nút Chuyển chủ phòng");
      await act(async () => {
        button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("LobbyPlayerGrid: chuyển chủ phòng", () => {
  it("ô thành viên thật có nút Chuyển chủ phòng, bấm là gửi đúng id", async () => {
    const view = await mountGrid();
    await view.openSheet("Khách");
    await view.clickTransfer();
    assert.deepEqual(view.transferred, [GUEST_ID]);
    await view.cleanup();
  });

  it("ô bot không có nút Chuyển chủ phòng", async () => {
    const view = await mountGrid();
    await view.openSheet("Bot");
    assert.equal(view.transferButton() !== undefined, false, "bot không được nhận nút chuyển host");
    await view.cleanup();
  });
});
