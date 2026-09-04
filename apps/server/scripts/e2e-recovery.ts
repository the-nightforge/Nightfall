/**
 * E2E khôi phục ván sau khi backend restart.
 *
 * Khác với `e2e.ts` (cần một server đang chạy sẵn), script này TỰ khởi động và
 * TỰ giết server: đó là toàn bộ điểm của nó. Cái chết phải là SIGKILL chứ không
 * phải shutdown lịch sự - shutdown lịch sự sẽ cho process cơ hội dọn dẹp, và
 * như vậy là kiểm một tình huống dễ hơn hẳn tình huống thật.
 *
 * Cần Postgres + Redis đang chạy: `npm run dev:infra`.
 * Chạy: `npm run test:e2e:recovery`
 */
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { io, type Socket } from "socket.io-client";

const PORT = Number(process.env.RECOVERY_PORT ?? 4155);
const SERVER = `http://localhost:${PORT}`;
const SERVER_DIR = path.resolve(__dirname, "..");
const BOT_COUNT = 7;

interface Identity {
  playerId: string;
  token: string;
  nickname: string;
}

interface Snapshot {
  code: string;
  phase: string;
  round: number;
  phaseEndsAt: number | null;
  players: Array<{ id: string; alive: boolean; role?: string }>;
  you?: { id: string; role?: string; alive: boolean };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startServer(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    /*
     * Gọi THẲNG node, không qua `npx` và không qua shell.
     *
     * Với `shell: true` trên Windows, `child.pid` là cái shell còn server thật
     * là cháu của nó: `kill("SIGKILL")` giết đúng cái vỏ và để server sống
     * tiếp, ôm nguyên cổng. Lần khởi động thứ hai vì thế chết vì EADDRINUSE -
     * nhưng cái hỏng nặng hơn là cú SIGKILL mà cả kịch bản này dựng lên để mô
     * phỏng một cú crash chưa từng chạm tới tiến trình cần crash.
     */
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: SERVER_DIR,
      env: { ...process.env, PORT: String(PORT) },
    });

    const timer = setTimeout(() => reject(new Error("Server không khởi động kịp")), 60_000);
    const onData = (chunk: Buffer): void => {
      const line = chunk.toString();
      if (process.env.RECOVERY_VERBOSE) process.stdout.write(`[server] ${line}`);
      if (line.includes("đang chạy tại")) {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        resolve(child);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (chunk: Buffer) => {
      if (process.env.RECOVERY_VERBOSE) process.stderr.write(`[server!] ${chunk.toString()}`);
    });
    child.once("exit", (code) => reject(new Error(`Server thoát sớm với mã ${code}`)));
  });
}

/** Giết KHÔNG thương tiếc: đây là mô phỏng một cú crash, không phải một lần deploy. */
async function killServer(child: ChildProcess): Promise<void> {
  child.removeAllListeners("exit");
  const dead = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await Promise.race([dead, sleep(5_000)]);
}

async function createPlayer(nickname: string): Promise<Identity> {
  const res = await fetch(`${SERVER}/api/players`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  if (!res.ok) throw new Error(`Tạo người chơi hỏng: ${res.status}`);
  return (await res.json()) as Identity;
}

function connect(identity: Identity): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER, {
      auth: { playerId: identity.playerId, token: identity.token },
      transports: ["websocket"],
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (error) => reject(new Error(error.message)));
  });
}

function nextSnapshot(socket: Socket, timeoutMs = 30_000): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("room:snapshot", onSnapshot);
      reject(new Error("Chờ snapshot quá lâu"));
    }, timeoutMs);
    const onSnapshot = (snapshot: Snapshot): void => {
      clearTimeout(timer);
      socket.off("room:snapshot", onSnapshot);
      resolve(snapshot);
    };
    socket.on("room:snapshot", onSnapshot);
  });
}

async function waitForPhase(socket: Socket, phase: string, timeoutMs = 90_000): Promise<Snapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await nextSnapshot(socket, Math.min(deadline - Date.now(), 30_000));
    if (snapshot.phase === phase) return snapshot;
  }
  throw new Error(`Hết giờ chờ pha ${phase}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  console.log("[recovery] Khởi động server lần 1...");
  let server = await startServer();

  try {
    const identity = await createPlayer(`Recovery ${Date.now() % 100000}`);
    let socket = await connect(identity);

    const created = nextSnapshot(socket);
    socket.emit("room:create", {});
    const lobby = await created;
    const code = lobby.code;
    console.log(`[recovery] Phòng ${code}`);

    for (let i = 0; i < BOT_COUNT; i += 1) {
      socket.emit("room:add-bot", {});
      await sleep(120);
    }

    socket.emit("room:update-config", {
      config: {
        werewolves: 2,
        seer: true,
        guard: true,
        witch: true,
        hunter: false,
        cursed: false,
        // Đêm dài để cú restart chắc chắn rơi vào GIỮA pha, không phải vào khe
        // chuyển pha - khe chuyển pha là một tình huống khác và dễ hơn.
        nightSeconds: 90,
        discussionSeconds: 60,
        voteSeconds: 30,
        defenseSeconds: 15,
        finalVoteSeconds: 15,
      },
    });
    await sleep(300);

    socket.emit("room:start", {});
    const night = await waitForPhase(socket, "NIGHT");
    console.log(`[recovery] Đang ở NIGHT vòng ${night.round}, hạn chót ${night.phaseEndsAt}`);

    const before = {
      round: night.round,
      role: night.you?.role,
      alive: night.players.filter((p) => p.alive).length,
      phaseEndsAt: night.phaseEndsAt ?? 0,
    };
    assert(before.role, "Không nhận được vai của chính mình trước khi restart");

    console.log("[recovery] SIGKILL server...");
    socket.disconnect();
    await killServer(server);

    console.log("[recovery] Khởi động server lần 2...");
    server = await startServer();

    socket = await connect(identity);
    const after = await nextSnapshot(socket, 30_000);

    assert(after.code === code, `Vào nhầm phòng: ${after.code}`);
    assert(after.phase === "NIGHT", `Sau restart phải vẫn ở NIGHT, đang ở ${after.phase}`);
    assert(after.round === before.round, `Vòng đổi: ${before.round} -> ${after.round}`);
    assert(after.you?.role === before.role, `Vai đổi: ${before.role} -> ${after.you?.role}`);
    assert(
      after.players.filter((p) => p.alive).length === before.alive,
      "Số người còn sống đổi sau restart",
    );
    assert(
      (after.phaseEndsAt ?? 0) >= Date.now(),
      "Hạn chót sau khi khôi phục đã nằm trong quá khứ",
    );
    // Không lộ vai người khác cho một người chơi thường.
    if (after.you.role !== "WEREWOLF") {
      const leaked = after.players.filter((p) => p.id !== after.you!.id && p.role !== undefined);
      assert(leaked.length === 0, `Snapshot sau khôi phục lộ vai của ${leaked.length} người`);
    }

    console.log(
      `[recovery] Sau restart: pha ${after.phase}, vòng ${after.round}, vai ${after.you.role}, ` +
        `còn ${Math.round(((after.phaseEndsAt ?? 0) - Date.now()) / 1000)}s`,
    );

    socket.disconnect();
    console.log("[recovery] ✅ KHÔI PHỤC SAU RESTART PASS");
  } finally {
    await killServer(server);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error("[recovery] ❌ FAIL:", error.message);
    process.exit(1);
  });
