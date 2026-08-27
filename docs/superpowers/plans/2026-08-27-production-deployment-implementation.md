# Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa các lỗi bảo mật/gameplay chặn phát hành và chuẩn bị monorepo Ma Sói Online để chạy frontend trên Vercel, backend trên Northflank, PostgreSQL trên Neon và Redis trên Upstash.

**Architecture:** Giữ Next.js frontend và Express/Socket.IO backend tách biệt trong cùng npm workspace. Backend chạy một instance lâu dài trên Northflank, giữ trạng thái nóng trong RAM và dùng Redis/PostgreSQL managed; frontend chỉ biết URL backend public qua biến môi trường.

**Tech Stack:** TypeScript, Next.js 14, React 18, Express 4, Socket.IO 4, Prisma 5, PostgreSQL, ioredis, Vitest 2, Docker, Vercel, Northflank, Neon, Upstash, GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-08-27-production-deployment-design.md`

## Global Constraints

- Repository GitHub phải là private và có tên `ma-soi-online`.
- Không commit `.env`, token, mật khẩu hoặc connection string thật.
- Frontend chỉ chạy trên Vercel; backend chỉ chạy trên Northflank.
- Backend dùng đúng một instance trong giai đoạn MVP.
- Server là nguồn dữ liệu duy nhất cho vai trò, hành động, chat và kết quả.
- Nếu backend restart giữa trận, phòng quay về lobby; không khôi phục timer hoặc hành động dở.
- Mọi bugfix phải theo red-green-refactor khi có thể kiểm thử tự động.
- Không thêm voice/video, matchmaking, ranking hoặc spectator mode.

---

### Task 1: Establish a Safe Git Baseline

**Files:**
- Verify: `.gitignore`
- Track: `package.json`, `package-lock.json`, `tsconfig.base.json`, `.env.example`, `docker-compose.yml`, `README.md`, `apps/**`, `packages/**`

**Interfaces:**
- Consumes: Existing local monorepo and design commit `208e4be`.
- Produces: A clean baseline commit containing all existing source files and no secrets/build artifacts.

- [ ] **Step 1: Inspect untracked and ignored files**

Run:

```powershell
git status --short --ignored
rg -n --hidden -g '!node_modules/**' -g '!dist/**' -g '!.next/**' "(postgresql|redis|rediss)://|token=|password=" .
```

Expected: generated directories are ignored; only `.env.example` contains documented development credentials; no real hosted credentials appear.

- [ ] **Step 2: Verify the untouched baseline**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: 24 game-engine tests pass, typecheck passes, and both server/web production builds succeed.

- [ ] **Step 3: Commit the source baseline**

```powershell
git add .gitignore package.json package-lock.json tsconfig.base.json .env.example docker-compose.yml README.md apps packages
git commit -m "chore: add ma soi online source baseline"
```

Expected: `git status --short` is empty except for this implementation plan if it has not yet been committed.

---

### Task 2: Deduplicate Night Deaths

**Files:**
- Modify: `packages/game-engine/tests/engine.test.ts`
- Modify: `packages/game-engine/src/engine.ts:210-257`

**Interfaces:**
- Consumes: `DeathInfo`, `GameEngine.resolveNight()`.
- Produces: `resolveNight()` returns at most one `DeathInfo` per `playerId`.

- [ ] **Step 1: Write the failing regression test**

Add to the night-action test suite:

```ts
it("không tính một người chết hai lần khi vừa bị Sói cắn vừa trúng độc", () => {
  const e = makeEngine(7);
  const wolf = findPlayersByRole(e, "WEREWOLF")[0];
  const witch = findPlayersByRole(e, "WITCH")[0];
  const target = e.state.players.find(
    (p) => p.alive && p.id !== wolf.id && p.id !== witch.id,
  )!;

  e.submitNightAction(wolf.id, "KILL", target.id);
  e.submitNightAction(witch.id, "POISON", target.id);
  const deaths = e.resolveNight();

  expect(deaths.filter((d) => d.playerId === target.id)).toHaveLength(1);
  expect(e.state.lastNightDeaths.filter((d) => d.playerId === target.id)).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test and verify red**

Run:

```powershell
npm test -- --run tests/engine.test.ts
```

Expected: FAIL because the same target appears twice.

- [ ] **Step 3: Implement unique death insertion**

Inside `resolveNight`, replace direct pushes with one local helper:

```ts
const deaths: DeathInfo[] = [];
const addDeath = (death: DeathInfo): void => {
  if (!deaths.some((item) => item.playerId === death.playerId)) {
    deaths.push(death);
  }
};
```

Use `addDeath(...)` for both wolf and poison deaths. Remove the unused `wolfVictim` variable.

- [ ] **Step 4: Verify green**

Run:

```powershell
npm test
npm run build:engine
```

Expected: all 25 engine tests pass and the engine builds.

- [ ] **Step 5: Commit**

```powershell
git add packages/game-engine/src/engine.ts packages/game-engine/tests/engine.test.ts
git commit -m "fix: deduplicate nightly deaths"
```

---

### Task 3: Filter Chat History per Viewer

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/vitest.config.ts`
- Create: `apps/server/tests/chat-visibility.test.ts`
- Modify: `apps/server/src/rooms/snapshot.ts:1-118`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `Room`, `ChatMessage`, `GameEngine.player()`, current room status and game phase.
- Produces: `visibleChatLog(room: Room, viewerId: string): ChatMessage[]`.

- [ ] **Step 1: Add the server test runner**

Add to `apps/server/package.json`:

```json
"test": "vitest run"
```

Add `vitest` version `^2.0.5` to server devDependencies, then run `npm install` to update the lockfile. Create `apps/server/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 2: Write failing authorization tests**

Create fixtures for a room with one living wolf, one living villager and one dead villager. Populate `chatLog` with one message for each of `lobby`, `day`, `wolves`, and `dead`. Assert:

```ts
expect(visibleChatLog(nightRoom, livingWolfId).map((m) => m.channel)).toEqual(["wolves"]);
expect(visibleChatLog(nightRoom, livingVillagerId)).toEqual([]);
expect(visibleChatLog(nightRoom, deadVillagerId).map((m) => m.channel)).toEqual(["dead"]);
expect(visibleChatLog(dayRoom, livingVillagerId).map((m) => m.channel)).toEqual(["day"]);
expect(visibleChatLog(lobbyRoom, livingVillagerId).map((m) => m.channel)).toEqual(["lobby"]);
```

- [ ] **Step 3: Run the server test and verify red**

Run:

```powershell
npm test --workspace @masoi/server
```

Expected: FAIL because `visibleChatLog` is not exported.

- [ ] **Step 4: Implement server-side history filtering**

Export `visibleChatLog`. It must return at most 60 messages and select exactly one authorized current channel:

```ts
export function visibleChatLog(room: Room, viewerId: string): ChatMessage[] {
  if (room.status === "LOBBY" || !room.engine || room.engine.state.phase === "GAME_OVER") {
    return room.chatLog.filter((m) => m.channel === "lobby").slice(-60);
  }
  const viewer = room.engine.player(viewerId);
  if (!viewer) return [];
  if (!viewer.alive) return room.chatLog.filter((m) => m.channel === "dead").slice(-60);
  if (room.engine.state.phase === "NIGHT") {
    return viewer.role === "WEREWOLF"
      ? room.chatLog.filter((m) => m.channel === "wolves").slice(-60)
      : [];
  }
  const dayPhases = ["ROLE_REVEAL", "NIGHT_RESULT", "DAY_DISCUSSION", "VOTING", "ELIMINATION"];
  return dayPhases.includes(room.engine.state.phase)
    ? room.chatLog.filter((m) => m.channel === "day").slice(-60)
    : [];
}
```

Replace `room.chatLog.slice(-60)` in `buildSnapshot` with `visibleChatLog(room, viewerId)`.

- [ ] **Step 5: Verify filtering and build**

Run:

```powershell
npm test --workspace @masoi/server
npm run lint
npm run build:server
```

Expected: authorization tests pass, typecheck passes, server builds.

- [ ] **Step 6: Commit**

```powershell
git add apps/server/package.json apps/server/vitest.config.ts apps/server/tests/chat-visibility.test.ts apps/server/src/rooms/snapshot.ts package-lock.json
git commit -m "fix: filter private chat history by viewer"
```

---

### Task 4: Enforce Room Entry and Readiness Rules

**Files:**
- Create: `apps/server/src/rooms/rules.ts`
- Create: `apps/server/tests/room-rules.test.ts`
- Modify: `apps/server/src/rooms/service.ts:37-211`
- Modify: `apps/web/src/components/Lobby.tsx:18-98`

**Interfaces:**
- Produces: `roomEntryError(currentRoomCode: string | null, targetCode: string, targetStatus: RoomStatus, alreadyMember: boolean): string | null`.
- Produces: `allRequiredPlayersReady(room: Room): boolean`.
- Consumers: `roomService.create`, `roomService.join`, `roomService.start`, and the lobby start-button state.

- [ ] **Step 1: Write failing pure rule tests**

Cover these cases:

```ts
expect(roomEntryError("AAAAA", "BBBBB", "LOBBY", false)).toMatch(/rời phòng/);
expect(roomEntryError(null, "BBBBB", "IN_GAME", false)).toMatch(/đang diễn ra/);
expect(roomEntryError("BBBBB", "BBBBB", "IN_GAME", true)).toBeNull();
expect(allRequiredPlayersReady(roomWithReadyGuests)).toBe(true);
expect(allRequiredPlayersReady(roomWithUnreadyGuest)).toBe(false);
```

The host and bots do not need to toggle ready; all other human members must be ready.

- [ ] **Step 2: Run tests and verify red**

```powershell
npm test --workspace @masoi/server
```

Expected: FAIL because `rooms/rules.ts` does not exist.

- [ ] **Step 3: Implement the pure rules**

Use exact error behavior:

```ts
export function roomEntryError(
  currentRoomCode: string | null,
  targetCode: string,
  targetStatus: RoomStatus,
  alreadyMember: boolean,
): string | null {
  if (currentRoomCode && currentRoomCode !== targetCode) {
    return "Bạn phải rời phòng hiện tại trước khi vào phòng khác";
  }
  if (targetStatus === "IN_GAME" && !alreadyMember) {
    return "Trận đấu đã bắt đầu";
  }
  return null;
}

export function allRequiredPlayersReady(room: Room): boolean {
  return room.members
    .filter((m) => !m.isBot && m.playerId !== room.hostId)
    .every((m) => m.ready);
}
```

- [ ] **Step 4: Apply the rules authoritatively in the service**

- In `create`, call `await roomService.findRoomOf(playerId)` and reject when non-null.
- In `join`, determine `existing` first, then reject using `roomEntryError` before adding a member.
- Update `findRoomOf` to check the in-memory index first and then `getPlayerRoom(playerId)` from Redis.
- In `start`, reject with `Chưa phải tất cả người chơi sẵn sàng` when `allRequiredPlayersReady(room)` is false.

- [ ] **Step 5: Reflect readiness in the lobby UI**

Compute the same public condition from `snapshot.players` and disable the host start button when a non-host, non-bot player is not ready. Show `Chờ tất cả người chơi sẵn sàng` below the button.

- [ ] **Step 6: Verify**

```powershell
npm test --workspace @masoi/server
npm run lint
npm run build
```

Expected: rule tests pass and the monorepo builds.

- [ ] **Step 7: Commit**

```powershell
git add apps/server/src/rooms/rules.ts apps/server/tests/room-rules.test.ts apps/server/src/rooms/service.ts apps/web/src/components/Lobby.tsx
git commit -m "fix: enforce room membership and readiness"
```

---

### Task 5: Restore Rooms through Redis on Reconnect

**Files:**
- Modify: `apps/server/src/ws.ts:80-94`
- Modify: `apps/server/src/redis.ts:44-63`
- Modify: `apps/server/src/rooms/store.ts:106-133`

**Interfaces:**
- Consumes: `getPlayerRoom(playerId)`, `getRoom(code)`, `loadRoomFromRedis(code)`, `updateSessionRoom(playerId, code)`.
- Produces: reconnect loads an existing persisted room, confirms membership, joins the Socket.IO room and broadcasts a filtered snapshot.

- [ ] **Step 1: Refactor reconnect into an exported async function**

Create in `ws.ts`:

```ts
export async function restoreRoomForPlayer(playerId: string): Promise<Room | null> {
  const code = getRoomSyncByPlayer(playerId) ?? (await getPlayerRoom(playerId));
  if (!code) return null;
  const room = getRoom(code) ?? (await loadRoomFromRedis(code));
  if (!room?.members.some((m) => m.playerId === playerId)) {
    await updateSessionRoom(playerId, null);
    return null;
  }
  return room;
}
```

Move this function to `apps/server/src/rooms/reconnect.ts` instead if importing `ws.ts` makes unit tests initialize Socket.IO dependencies.

- [ ] **Step 2: Write tests with mocked Redis/store dependencies**

Assert that the helper:

- returns the in-memory room without loading Redis;
- loads the room using the Redis mapping when RAM is empty;
- clears a stale player-room mapping when the member is absent.

- [ ] **Step 3: Verify red, implement, then verify green**

Run before and after implementation:

```powershell
npm test --workspace @masoi/server
```

Expected before: FAIL due to missing helper. Expected after: all server tests pass.

- [ ] **Step 4: Use the helper in the connection handler**

Replace the synchronous reconnect block with `restoreRoomForPlayer`. When a room is returned, mark the member connected, `await socket.join(room.code)`, persist the updated room, and broadcast.

- [ ] **Step 5: Verify and commit**

```powershell
npm run lint
npm run build:server
git add apps/server/src/ws.ts apps/server/src/redis.ts apps/server/src/rooms/store.ts apps/server/src/rooms/reconnect.ts apps/server/tests
git commit -m "fix: restore room membership on reconnect"
```

Only add `rooms/reconnect.ts` if that file was created.

---

### Task 6: Preserve the Full Night Action Window

**Files:**
- Modify: `apps/web/src/components/NightPanel.tsx:27-38`
- Modify: `apps/server/src/game/machine.ts:11-69,152-209`
- Modify: `apps/server/src/ws.ts:159-175`

**Interfaces:**
- Consumes: configured `nightSeconds` and the existing scheduled `endNight` timer.
- Produces: every night lasts until the configured timer fires; Guard receives the action UI.

- [ ] **Step 1: Fix Guard UI capability detection**

Change:

```ts
if (!meta?.nightOrder)
```

to:

```ts
if (meta?.nightOrder === undefined)
```

- [ ] **Step 2: Remove early-night scheduling**

- Delete `pendingEndNight` and `maybeEndNightEarly`.
- Remove calls to `maybeEndNightEarly` from websocket actions and bot actions.
- Keep the timer established in `beginNight` as the only route to `endNight`.
- Keep early voting completion unchanged.

- [ ] **Step 3: Verify behavior statically and through builds**

Run:

```powershell
rg -n "maybeEndNightEarly|pendingEndNight" apps packages
npm test
npm run lint
npm run build
```

Expected: ripgrep finds no references, tests pass, builds pass.

- [ ] **Step 4: Commit**

```powershell
git add apps/web/src/components/NightPanel.tsx apps/server/src/game/machine.ts apps/server/src/ws.ts
git commit -m "fix: preserve night action window"
```

---

### Task 7: Make the Backend Production-Host Ready

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/http.ts`
- Create: `apps/server/tests/config.test.ts`
- Create: `Dockerfile.server`
- Create: `.dockerignore`
- Modify: `.env.example`

**Interfaces:**
- Produces: `resolvePort(env: NodeJS.ProcessEnv): number`.
- Produces: container listening on `0.0.0.0:$PORT` with `/api/health`.

- [ ] **Step 1: Write the port-resolution test**

```ts
expect(resolvePort({ PORT: "10000", SERVER_PORT: "4100" })).toBe(10000);
expect(resolvePort({ SERVER_PORT: "4100" })).toBe(4100);
expect(resolvePort({})).toBe(4000);
```

- [ ] **Step 2: Run red, implement, run green**

Implement:

```ts
export function resolvePort(env: NodeJS.ProcessEnv): number {
  return Number(env.PORT ?? env.SERVER_PORT ?? 4000);
}
```

Use `resolvePort(process.env)` in config. Validate the result is an integer from 1 through 65535 and throw a startup error otherwise.

- [ ] **Step 3: Harden server startup and shutdown**

- Listen with `server.listen(config.port, "0.0.0.0", callback)`.
- Make shutdown idempotent.
- Close Socket.IO and HTTP server, then call `prisma.$disconnect()` and `redis.quit()`.
- Preserve the forced timeout fallback, but call `.unref()` on it.
- Return health status `503` with `{ ok: false, db: false }` when the database query fails; return `200` with `{ ok: true, db: true }` when it succeeds.

- [ ] **Step 4: Create the backend container**

`Dockerfile.server` must use Node 20 Alpine, run `npm ci`, run Prisma generate, build shared/engine/server, copy the workspace runtime files, expose port 10000, and start with:

```dockerfile
CMD ["sh", "-c", "npm run db:migrate --workspace @masoi/server && npm run start --workspace @masoi/server"]
```

`.dockerignore` must exclude `.git`, `.next`, all `dist`, all `.env*` except `.env.example`, coverage, and local `node_modules`.

- [ ] **Step 5: Document production environment names**

Add `PORT`, `CORS_ORIGIN`, `DATABASE_URL`, `REDIS_URL`, `NODE_ENV`, and chat-rate settings to `.env.example`, using only non-secret example values.

- [ ] **Step 6: Verify container and health locally**

Run:

```powershell
npm test --workspace @masoi/server
npm run lint
npm run build
docker build -f Dockerfile.server -t ma-soi-server:test .
```

Expected: tests/build succeed and Docker image builds.

- [ ] **Step 7: Commit**

```powershell
git add apps/server/src/config.ts apps/server/src/index.ts apps/server/src/http.ts apps/server/tests/config.test.ts Dockerfile.server .dockerignore .env.example
git commit -m "feat: prepare backend for managed hosting"
```

---

### Task 8: Prepare Vercel and Deployment Documentation

**Files:**
- Create: `vercel.json`
- Create: `apps/web/.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: Northflank public backend URL through `NEXT_PUBLIC_SERVER_URL`.
- Produces: reproducible Vercel build and exact dashboard configuration instructions.

- [ ] **Step 1: Add Vercel monorepo configuration**

Create `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "installCommand": "npm ci",
  "buildCommand": "npm run build:shared && npm run build:engine && npm run build:web",
  "outputDirectory": "apps/web/.next"
}
```

Create `apps/web/.env.example` containing:

```dotenv
NEXT_PUBLIC_SERVER_URL=https://ma-soi-server-example.code.run
```

The value is documentation only and not a live credential.

- [ ] **Step 2: Rewrite deployment sections in README**

Document exact fields:

- Neon: copy the pooled PostgreSQL connection string to `DATABASE_URL`.
- Upstash: copy the TLS Redis connection string to `REDIS_URL`.
- Northflank: build with `Dockerfile.server`, expose `$PORT` using HTTP/1.1, health path `/api/health`, one instance, environment `NODE_ENV=production`.
- Vercel: import the same GitHub repository, use root repository with `vercel.json`, set `NEXT_PUBLIC_SERVER_URL` to the Northflank HTTPS domain.
- After Vercel deploy: set Northflank `CORS_ORIGIN` to the exact Vercel origin and redeploy.
- Explain free-tier limits and the restart-to-lobby behavior.

- [ ] **Step 3: Verify frontend production build**

```powershell
npm run build:web
npm run lint
```

Expected: Vercel-equivalent frontend build succeeds.

- [ ] **Step 4: Commit**

```powershell
git add vercel.json apps/web/.env.example README.md docs/superpowers/plans/2026-08-27-production-deployment-implementation.md
git commit -m "docs: add managed deployment workflow"
```

---

### Task 9: Full Security and Release Verification

**Files:**
- Verify only unless a failing test reveals a defect in files already covered above.

**Interfaces:**
- Consumes: all completed tasks.
- Produces: evidence that the branch is ready to push.

- [ ] **Step 1: Run the complete automated suite**

```powershell
npm test
npm test --workspace @masoi/server
npm run lint
npm run build
```

Expected: every command exits 0.

- [ ] **Step 2: Scan for leaked secrets and tracked artifacts**

```powershell
git status --short --ignored
git ls-files
rg -n --hidden -g '!node_modules/**' -g '!dist/**' -g '!.next/**' "(postgresql|redis|rediss)://[^\" ]+|BEGIN [A-Z ]+PRIVATE KEY|ghp_[A-Za-z0-9]+" .
```

Expected: only example local URLs are found; no `.env`, `.next`, `dist`, token, or private key is tracked.

- [ ] **Step 3: Run local smoke checks without modifying hosted services**

With local Docker infrastructure and local server/web running, verify:

- `/api/health` reports healthy database;
- create room and add bots;
- Guard receives the night panel when assigned;
- the configured night timer is not cut short;
- private channel messages do not appear in an unauthorized snapshot;
- a new identity cannot join a room already in game.

- [ ] **Step 4: Request a code review**

Use the `requesting-code-review` skill. Address every P0/P1 finding, rerun the affected tests, and commit fixes in focused commits.

- [ ] **Step 5: Confirm a clean release branch**

```powershell
git status --short
git log --oneline --decorate -10
```

Expected: clean worktree and a readable sequence of focused commits.

---

### Task 10: Create the Private GitHub Repository and Push

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: clean local `main` branch and GitHub CLI authentication.
- Produces: private GitHub repository `ma-soi-online` with `origin/main` matching local `main`.

- [ ] **Step 1: Check GitHub authentication**

```powershell
gh auth status
```

If unauthenticated, stop and ask the user to complete `gh auth login`. Do not request, print, or store a personal access token in project files.

- [ ] **Step 2: Check whether the repository name already exists**

```powershell
gh repo view ma-soi-online
```

If it exists under the authenticated account, verify it is the intended empty/private destination before adding it as `origin`. Never overwrite an unrelated repository.

- [ ] **Step 3: Create and push when the name is available**

```powershell
gh repo create ma-soi-online --private --source . --remote origin --push
```

This external creation and push are authorized by the user's request. Do not change visibility to public.

- [ ] **Step 4: Verify remote state**

```powershell
git remote -v
git status --short --branch
gh repo view --json nameWithOwner,isPrivate,url,defaultBranchRef
```

Expected: `isPrivate` is true, default branch is `main`, and local branch tracks `origin/main`.

---

### Task 11: Hosted-Service Handoff

**Files:**
- No repository changes unless deployment validation reveals a configuration defect.

**Interfaces:**
- Consumes: GitHub repository URL and verified build artifacts.
- Produces: exact user-facing steps or completed deployments for Neon, Upstash, Northflank and Vercel.

- [ ] **Step 1: Create or connect managed services**

Use existing signed-in accounts when available. If account creation, login, payment information, or secret entry is required, pause at that step and ask the user to take over. Do not put credentials in chat, command output, screenshots, Git, or logs.

- [ ] **Step 2: Configure backend secrets**

Set these only in Northflank:

```text
DATABASE_URL = Neon pooled connection string
REDIS_URL = Upstash TLS Redis connection string
NODE_ENV = production
CORS_ORIGIN = exact Vercel HTTPS origin after frontend deployment
```

Leave `PORT` managed by Northflank.

- [ ] **Step 3: Configure frontend environment**

Set `NEXT_PUBLIC_SERVER_URL` in Vercel to the exact Northflank HTTPS origin and redeploy the frontend.

- [ ] **Step 4: Run public smoke verification**

Verify the backend health URL, load the Vercel frontend, inspect browser console errors, create one guest identity and room, and confirm Socket.IO connects through HTTPS. Do not run the destructive six-player E2E script against production unless the user explicitly authorizes test data creation.

- [ ] **Step 5: Report final URLs and free-tier limitations**

Return the exact GitHub, frontend and backend URLs, plus any step still waiting on user authentication. State clearly that free tiers are for MVP testing and that backend restart returns active rooms to lobby.
