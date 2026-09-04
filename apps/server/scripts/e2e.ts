/**
 * E2E smoke test: mô phỏng 8 người chơi thật qua Socket.IO,
 * chơi trọn một ván Ma Sói từ tạo phòng đến GAME_OVER.
 * Chạy: npx tsx scripts/e2e.ts (cần server đang chạy)
 */
import { io, type Socket } from "socket.io-client";

const SERVER = process.env.SERVER_URL ?? "http://localhost:4100";
// 8 là `MIN_PLAYERS_TO_START` từ 2026-09-04; dưới ngưỡng đó server từ chối
// `room:start` nên kịch bản khói không chạy hết được.
const PLAYER_COUNT = 8;

interface Identity {
  playerId: string;
  token: string;
  nickname: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createPlayer(i: number): Promise<Identity> {
  const res = await fetch(`${SERVER}/api/players`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: `Tester ${i}` }),
  });
  if (!res.ok) throw new Error(`createPlayer failed: ${res.status}`);
  return res.json();
}

function connect(identity: Identity): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER, {
      auth: { playerId: identity.playerId, token: identity.token },
      transports: ["websocket"],
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (e) => reject(new Error(e.message)));
  });
}

function nextSnapshot(socket: Socket, timeoutMs = 120_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off("room:snapshot", onSnap);
      reject(new Error("Chờ snapshot quá lâu"));
    }, timeoutMs);
    const onSnap = (snap: any) => {
      clearTimeout(t);
      socket.off("room:snapshot", onSnap);
      resolve(snap);
    };
    socket.on("room:snapshot", onSnap);
  });
}

/** Chờ tới khi điều kiện thoả trên snapshot mới của player chỉ định */
async function waitForPhase(
  watcher: { socket: Socket; last: any },
  phase: string | string[],
  timeoutMs = 180_000,
): Promise<any> {
  const phases = Array.isArray(phase) ? phase : [phase];
  const deadline = Date.now() + timeoutMs;
  /*
   * ĐỌC `last`, không chờ sự kiện MỚI.
   *
   * `last` đã luôn là bản mới nhất nhờ listener thường trực, nên chờ một
   * snapshot KHÁC là tự dựng lại đúng cuộc đua vừa gỡ: bản đúng có thể đã tới
   * trong lúc kịch bản còn bận `await` một người khác, và khi đó không còn bản
   * nào sau nó để chờ.
   */
  while (Date.now() < deadline) {
    if (watcher.last && phases.includes(watcher.last.phase)) return watcher.last;
    await sleep(100);
  }
  throw new Error(`Timeout chờ phase ${phases.join("/")}`);
}

function actNight(snap: any, socket: Socket) {
  const me = snap.you;
  if (!me?.alive || !snap.night?.canAct || snap.night.acted) return;
  const aliveOthers = snap.players.filter(
    (p: any) => p.alive && p.id !== me.id && p.role !== "WEREWOLF",
  );
  const target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
  switch (me.role) {
    case "WEREWOLF":
      socket.emit("game:action", { type: "KILL", targetId: target.id });
      break;
    case "SEER":
      socket.emit("game:action", { type: "SEE", targetId: target.id });
      break;
    case "GUARD":
      socket.emit("game:action", { type: "GUARD", targetId: target.id });
      break;
    case "WITCH":
      // Phù Thuỷ chỉ hành động sau khi bầy Sói chốt, và chỉ cứu được nạn nhân thật
      if (!snap.night.healUsed && snap.night.wolfTarget)
        socket.emit("game:action", { type: "HEAL", targetId: null });
      else if (!snap.night.poisonUsed && Math.random() < 0.5)
        socket.emit("game:action", { type: "POISON", targetId: target.id });
      break;
  }
}

async function main() {
  console.log(`[e2e] Tạo ${PLAYER_COUNT} người chơi...`);
  const identities: Identity[] = [];
  for (let i = 1; i <= PLAYER_COUNT; i++) identities.push(await createPlayer(i));

  console.log("[e2e] Kết nối socket...");
  const sockets: Socket[] = [];
  for (const id of identities) sockets.push(await connect(id));

  // Theo dõi riêng player 0 để chờ phase
  const watchers = sockets.map((socket) => ({ socket, last: null as any }));

  /*
   * Listener THƯỜNG TRỰC, không phải một tiện nghi.
   *
   * Snapshot của host tới CÙNG LÚC với snapshot của người vừa vào phòng, mà
   * vòng join ngay dưới đang `await` đúng người đó - nên không ai nghe hộ
   * host và bản đó rơi mất. Khi bản cũ `await nextSnapshot(host.socket)` sau
   * vòng lặp, nó chờ một bản KHÁC mà server không có lý do gì để gửi: cả
   * kịch bản chết đứng ở đây, đúng 120 giây, trước khi ván kịp bắt đầu.
   *
   * Giữ `last` luôn là bản mới nhất cũng chính là hợp đồng mà `waitForPhase`
   * đã dựa vào - nó đọc `watcher.last` trước khi chịu chờ.
   */
  for (const watcher of watchers) {
    watcher.socket.on("room:snapshot", (snap: any) => {
      watcher.last = snap;
    });
  }

  /*
   * Lỗi phía server KHÔNG được nuốt.
   *
   * `RoomError`, `GameError` và `ZodError` cố ý không vào log của server -
   * chúng là lỗi ĐÃ LƯỜNG TRƯỚC. Với kịch bản này thì ngược lại: một lệnh bị
   * từ chối làm snapshot không bao giờ tới, và cái duy nhất hiện ra là
   * "Chờ snapshot quá lâu" sau 120 giây - đúng câu nói ít nhất về nguyên nhân.
   */
  for (const [i, watcher] of watchers.entries()) {
    watcher.socket.on("error", (err: any) => {
      console.error(`[e2e] server từ chối p${i}: ${err?.message ?? JSON.stringify(err)}`);
    });
  }

  // 1. Tạo phòng
  const host = watchers[0];
  const createdPromise = nextSnapshot(host.socket);
  host.socket.emit("room:create", {});
  const lobbySnap = await createdPromise;
  const CODE = lobbySnap.code;
  console.log(`[e2e] Phòng: ${CODE}`);

  // 2. Join các player còn lại
  for (let i = 1; i < PLAYER_COUNT; i++) {
    const p = nextSnapshot(watchers[i].socket);
    watchers[i].socket.emit("room:join", { code: CODE });
    watchers[i].last = await p;
  }
  if (host.last?.players.length !== PLAYER_COUNT) throw new Error("Sai số người trong phòng");
  console.log(`[e2e] Cả ${PLAYER_COUNT} người đã vào phòng`);

  // 3. Chat phòng chờ: mọi người nhận được
  const chatReceived = new Promise<any>((resolve) => {
    watchers[1].socket.once("chat:new", resolve);
  });
  sockets[0].emit("chat:send", { text: "Chào cả làng!" });
  const msg = await chatReceived;
  if (msg.text !== "Chào cả làng!") throw new Error("Chat lobby không đúng");
  console.log("[e2e] Chat lobby OK");

  // 4. Host cấu hình nhanh thời gian rồi bắt đầu
  const cfgSnapP = nextSnapshot(host.socket);
  host.socket.emit("room:update-config", {
    config: {
      werewolves: 2,
      seer: true,
      guard: true,
      witch: true,
      hunter: false,
      cursed: false,
      nightSeconds: 20,
      discussionSeconds: 30,
      voteSeconds: 20,
      defenseSeconds: 10,
      finalVoteSeconds: 15,
    },
  });
  host.last = await cfgSnapP;
  if (!host.last.phase.includes("LOBBY")) throw new Error("Không ở LOBBY sau cấu hình");

  /*
   * MỌI người chơi thật ngoài host phải bấm sẵn sàng - xem
   * `allRequiredPlayersReady`. Luật MVP cũ ("chỉ cần đủ người") đã bỏ, nhưng
   * kịch bản này vẫn bấm bắt đầu ngay và nhận về đúng một lời từ chối mà nó
   * không nghe: server không log RoomError, còn client thì chỉ thấy snapshot
   * không tới.
   */
  for (let i = 1; i < PLAYER_COUNT; i++) {
    watchers[i].socket.emit("room:set-ready", { ready: true });
  }
  const readyDeadline = Date.now() + 15_000;
  while (Date.now() < readyDeadline) {
    const others = (host.last?.players ?? []).filter((p: any) => p.id !== host.last.you?.id);
    if (others.length === PLAYER_COUNT - 1 && others.every((p: any) => p.ready)) break;
    await sleep(200);
  }

  const startedP = waitForPhase(host, "ROLE_REVEAL", 30_000);
  host.socket.emit("room:start", {});
  const roleSnap = await startedP;

  // Kiểm tra bí mật: mỗi người thấy đúng vai trò của mình, không thấy vai trò người khác (trừ sói thấy đồng bọn)
  for (let i = 1; i < PLAYER_COUNT; i++) {
    // Snapshot ROLE_REVEAL của mỗi người tới gần như cùng lúc với của host,
    // nhưng "gần như" là chưa đủ: đọc thẳng `last` ngay sau khi host đổi pha
    // sẽ bắt phải bản LOBBY cũ, và bản đó không có `you.role`.
    const s = await waitForPhase(watchers[i], ["ROLE_REVEAL", "NIGHT"], 30_000);
    if (!s.you?.role) throw new Error(`p${i} không thấy vai trò của mình`);
    for (const p of s.players) {
      if (p.id === s.you.id) continue;
      const allowed =
        p.role === undefined ||
        (s.you.role === "WEREWOLF" && p.role === "WEREWOLF");
      if (!allowed) throw new Error(`Lộ vai trò của ${p.id} cho ${s.you.id}`);
    }
  }
  console.log("[e2e] Chia vai trò bí mật OK:", identities.map((id, i) => `${i}:${(watchers[i].last.you.role ?? "").slice(0, 2)}`).join(" "));

  // 5. Vòng lặp game cho tới GAME_OVER
  const deadline = Date.now() + 8 * 60_000;
  let winnerSeen: string | null = null;
  // Một lượt bấm bỏ qua mỗi vòng mỗi người: `skip-discussion` chỉ cho 10 lượt
  // mỗi 3 giây, còn vòng lặp này quay lại sau mỗi snapshot.
  const skippedRound = new Array(PLAYER_COUNT).fill(-1);
  let loggedPhase = "";
  while (Date.now() < deadline) {
    // Mỗi player hành động theo phase hiện tại dựa vào snapshot mới nhất
    const snaps: any[] = [];
    for (let i = 0; i < PLAYER_COUNT; i++) {
      // lấy snapshot hiện tại bằng cách đợi ngắn sự kiện mới hoặc dùng last
      snaps.push(watchers[i].last);
    }

    const current = watchers[0].last;
    if (!current) {
      watchers[0].last = await nextSnapshot(host.socket);
      continue;
    }

    if (current.phase === "GAME_OVER") {
      winnerSeen = current.winner;
      break;
    }

    if (current.phase === "NIGHT") {
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const s = watchers[i].last;
        if (s?.phase === "NIGHT") actNight(s, sockets[i]);
      }
    } else if (current.phase === "VOTING") {
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const s = watchers[i].last;
        if (s?.phase !== "VOTING" || !s.you?.alive || s.hasVoted) continue;
        const targets = s.players.filter((p: any) => p.alive && p.id !== s.you.id);
        const t = targets[Math.floor(Math.random() * targets.length)];
        sockets[i].emit("game:vote", { targetId: t.id });
      }
    } else if (current.phase === "FINAL_VOTE") {
      // Không bỏ phiếu tính là Tha, nên bỏ qua nhánh này sẽ khiến không ai bị
      // treo suốt ván và e2e không bao giờ chạm tới đường chết ban ngày.
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const s = watchers[i].last;
        if (s?.phase !== "FINAL_VOTE" || !s.trial?.canVote) continue;
        sockets[i].emit("game:final-vote", { guilty: Math.random() < 0.7 });
      }
    } else if (current.phase === "DEFENSE") {
      const s = watchers[0].last;
      if (s?.trial?.canSpeak) sockets[0].emit("chat:send", { text: "Tôi là dân, đừng treo tôi!" });
    } else if (current.phase === "DAY_DISCUSSION") {
      if (Math.random() < 0.05) sockets[0].emit("chat:send", { text: "Tôi nghi ngờ ai đó..." });
      /*
       * Bấm bỏ qua, không ngồi hết đồng hồ.
       *
       * `discussionSeconds` tối thiểu là 30 và một vòng đầy đủ tốn khoảng 85
       * giây, nên một ván 8 người - thường 4 tới 5 vòng - dài hơn cả trần thời
       * gian của kịch bản. Đây cũng là cái nút thật của client, chứ không phải
       * một đường tắt riêng cho test.
       */
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const s = watchers[i].last;
        if (s?.phase !== "DAY_DISCUSSION" || !s.you?.alive) continue;
        if (skippedRound[i] === s.round) continue;
        skippedRound[i] = s.round;
        sockets[i].emit("game:skip-discussion", { skip: true });
      }
    }

    if (current.phase !== loggedPhase) {
      loggedPhase = current.phase;
      const alive = current.players.filter((p: any) => p.alive).length;
      console.log(`[e2e]   vòng ${current.round} ${current.phase} - còn sống ${alive}`);
    }

    // Đợi snapshot tiếp theo cho host
    watchers[0].last = await nextSnapshot(host.socket, 90_000);
    // Đồng bộ last của những người khác nếu có event pending (non-blocking)
    await sleep(50);
  }

  if (!winnerSeen) throw new Error("Game không kết thúc trong thời gian cho phép");
  console.log(`[e2e] Game kết thúc. Phe thắng: ${winnerSeen}`);

  // 6. Ở GAME_OVER mọi vai trò phải được công bố
  const over = watchers[0].last;
  if (over.players.some((p: any) => !p.role)) throw new Error("GAME_OVER nhưng chưa công bố vai trò");

  // 7. Host reset về phòng chờ
  const resetP = waitForPhase(host, "LOBBY", 15_000);
  host.socket.emit("room:reset", {});
  await resetP;
  console.log("[e2e] Reset về phòng chờ OK");

  for (const s of sockets) s.disconnect();
  console.log("[e2e] ✅ TOÀN BỘ LUỒNG PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error("[e2e] ❌ FAIL:", err.message);
  process.exit(1);
});
