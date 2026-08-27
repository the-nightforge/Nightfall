import { io } from "socket.io-client";
const SERVER = "http://localhost:4100";

async function makePlayer(n: string) {
  const res = await fetch(`${SERVER}/api/players`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: n }),
  });
  return res.json();
}

async function main() {
  const a = await makePlayer("Debug A");
  const b = await makePlayer("Debug B");

  const sa = io(SERVER, { auth: a, transports: ["websocket"] });
  sa.onAny((ev, ...args) => console.log("[A]", ev, JSON.stringify(args).slice(0, 200)));
  await new Promise((r) => sa.once("connect", r));
  const snap = await new Promise<any>((resolve) => sa.once("room:snapshot", resolve));
  console.log("created room", snap.code);

  const sb = io(SERVER, { auth: b, transports: ["websocket"] });
  sb.onAny((ev, ...args) => console.log("[B]", ev, JSON.stringify(args).slice(0, 300)));
  await new Promise((r) => sb.once("connect", r));
  sb.emit("room:join", { code: snap.code });
  await new Promise((r) => setTimeout(r, 4000));
  process.exit(0);
}

main();
