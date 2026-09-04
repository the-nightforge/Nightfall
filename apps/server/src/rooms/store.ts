import type { GameEngine } from "@masoi/game-engine";
import type { ChatMessage, RoomConfig } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { redis } from "../redis";
import {
  FINISHED_ROOM_TTL_SECONDS,
  ROOM_TTL_SECONDS,
  deleteEnvelope,
  loadEnvelope,
  saveEnvelope,
} from "../persistence/redis-store";
import { restoreRoomFromEnvelope } from "../persistence/restore";
import { serializeRoom } from "../persistence/serialize";
import { destroyVoiceRoom } from "../voice/service";
import { cleanupRoomBotState } from "../game/bot-room-state";
import { clearDiscussionSkipVotes } from "../game/discussion-skip";
import { createLastLetterState, type LastLetterRoomState } from "../game/last-letter";
import type { PendingStep } from "../game/pending-step";
import type { ArchivedChatMessage } from "../game/match-chat";

export interface RoomMember {
  playerId: string;
  name: string;
  ready: boolean;
  connected: boolean;
  /**
   * Mốc rớt mạng, null khi đang online. Cần mốc chứ không chỉ cần cờ connected
   * vì ngưỡng đồng thuận skip thảo luận phải phân biệt một lần refresh với một
   * người đã bỏ đi hẳn.
   */
  disconnectedAt?: number | null;
  isBot: boolean;
  avatarUrl?: string | null;
}

export type RoomStatus = "LOBBY" | "IN_GAME";

export interface Room {
  code: string;
  hostId: string | null;
  status: RoomStatus;
  members: RoomMember[];
  config: RoomConfig;
  engine: GameEngine | null;
  chatLog: ChatMessage[];
  createdAt: number;
  /**
   * Mốc bắt đầu VÁN đang chạy, đặt ở `startGame`.
   *
   * Tách khỏi `createdAt` vì hai câu hỏi khác nhau: `createdAt` là "phòng này
   * mở từ bao giờ" và nó đứng yên qua mọi lần chơi lại, còn cái này là "ván
   * này chạy từ bao giờ". `durationSec` trong `GameResult` cần vế thứ hai -
   * dùng vế thứ nhất thì ván thứ hai trong cùng phòng ghi vào lịch sử cả thời
   * gian chờ ở sảnh lẫn trọn ván trước, và sai số đó nằm lại trong DB vĩnh viễn.
   *
   * Optional vì phòng đọc lên từ ảnh chụp ghi trước bản này không có nó; chỗ
   * đọc rơi về `createdAt`.
   */
  startedAt?: number;
  /**
   * Khoá idempotency của MỘT ván, sinh ở `startGame`.
   *
   * Ghi `GameResult` là side effect duy nhất nằm ngoài engine, nên nó là chỗ
   * duy nhất mà khôi phục có thể nhân đôi. Khoá này đi kèm unique index trong
   * DB, nên một ván không thể có hai dòng kết quả dù process chết đúng vào khe
   * giữa lúc ghi và lúc lưu snapshot.
   */
  gameId: string | null;
  /** Đã ghi `GameResult` cho `gameId` hiện tại chưa. */
  resultWritten: boolean;
  /** Bước chuyển pha đang chờ; `null` khi phòng ở sảnh chờ hoặc ván đã xong. */
  pendingStep: PendingStep | null;
  /**
   * Tăng mỗi lần hẹn một bước mới. Là thành phần thứ ba của phase token, và là
   * thứ duy nhất phân biệt được hai chặng của cùng một pha đêm.
   */
  phaseSeq: number;
  /**
   * Ai đã bị chủ phòng đuổi khỏi phòng NÀY.
   *
   * Không có danh sách này thì `kick` chỉ là trang trí: nó gỡ người ta khỏi
   * `members`, nhưng phòng vẫn ở sảnh chờ nên lần `join` ngay sau đó rơi vào
   * nhánh "thành viên mới" và nhận họ lại. Bấm F5 là vào lại được.
   */
  kickedPlayerIds: string[];
  /**
   * Trạng thái add-on "Phong thư sau cùng": nháp theo playerId, thư đã mở, và
   * chốt chống mở trùng. Xem `game/last-letter.ts`.
   *
   * OPTIONAL vì đây là trường thêm sau: phòng dựng từ một snapshot ghi trước bản
   * này không có nó, và `lastLetterStateOf` tạo lười khi cần. Bắt buộc nó ở đây
   * là bắt mọi chỗ khởi tạo `Room` - kể cả hàng chục fixture test - phải sửa
   * cùng lúc, để đổi lấy đúng con số không.
   */
  lastLetters?: LastLetterRoomState;
  /**
   * Sổ chat ĐẦY ĐỦ của ván đang chạy, chờ ghi xuống DB một lần ở GAME_OVER.
   *
   * Tồn tại song song với `chatLog` chứ không thay nó, vì hai thứ này phục vụ
   * hai việc đối nghịch nhau: `chatLog` đi kèm MỌI snapshot nên phải bị cắt còn
   * 100 tin, còn sổ này phải giữ trọn ván mới có gì để đọc lại. Gộp chúng lại
   * là hoặc đẩy cả ván lên dây mỗi lần sync, hoặc lưu vào DB một mẩu cụt.
   *
   * OPTIONAL vì đây là trường thêm sau - cùng lý do với `lastLetters` ngay
   * trên: bắt buộc nó là bắt hàng chục fixture test và mọi snapshot đã ghi
   * trước bản này phải sửa cùng lúc. Chỗ ghi tạo lười khi cần.
   */
  matchChat?: ArchivedChatMessage[];
}

const rooms = new Map<string, Room>();
const roomTimers = new Map<string, NodeJS.Timeout[]>();

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function allRooms(): Room[] {
  return [...rooms.values()];
}

export function createRoom(code: string, host: RoomMember): Room {
  const room: Room = {
    code,
    hostId: host.playerId,
    status: "LOBBY",
    members: [host],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: Date.now(),
    gameId: null,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
    kickedPlayerIds: [],
    lastLetters: createLastLetterState(),
  };
  rooms.set(code, room);
  return room;
}

export function removeRoom(code: string): void {
  // Phòng biến mất thì room voice cũng phải biến mất. Đây là chốt chặn duy nhất
  // của việc xoá phòng, nên mọi lối vào tương lai đều được phủ.
  void destroyVoiceRoom(code, "phòng bị xoá");
  clearRoomTimers(code);
  clearAbandonCheckTimer(code);
  rooms.delete(code);
  // Không dọn thì pendingVote/pendingEndFinalVote và ngân sách governor tích luỹ
  // một entry cho mỗi phòng bị bỏ hoang trong suốt vòng đời process.
  cleanupRoomBotState(code);
  clearDiscussionSkipVotes(code);
}

// ---- Timers ----

export function addRoomTimer(code: string, timer: NodeJS.Timeout): void {
  const list = roomTimers.get(code) ?? [];
  list.push(timer);
  roomTimers.set(code, list);
}

export function clearRoomTimers(code: string): void {
  const list = roomTimers.get(code);
  if (list) {
    for (const t of list) clearTimeout(t);
  }
  roomTimers.delete(code);
}

export function setRoomTimer(code: string, fn: () => void, ms: number): void {
  addRoomTimer(code, setTimeout(() => fn(), ms));
}

// Bucket riêng cho check phòng bỏ hoang: phải sống sót qua các lần chuyển pha
// (mỗi lần đều gọi clearRoomTimers xoá sạch roomTimers ở trên), nên không thể
// dùng chung setRoomTimer/clearRoomTimers - chỉ dọn khi phòng thật sự bị xoá.
const abandonCheckTimers = new Map<string, NodeJS.Timeout>();

export function setAbandonCheckTimer(code: string, fn: () => void, ms: number): void {
  clearAbandonCheckTimer(code);
  abandonCheckTimers.set(code, setTimeout(fn, ms));
}

export function clearAbandonCheckTimer(code: string): void {
  const t = abandonCheckTimers.get(code);
  if (t) clearTimeout(t);
  abandonCheckTimers.delete(code);
}

// ---- Redis persistence (write-through) ----

/**
 * Số thứ tự lần ghi, theo từng phòng.
 *
 * Sống trong RAM vì nó chỉ cần đúng TRONG một process: mục đích là để một lời
 * ghi bất đồng bộ về muộn không đè lên một lời ghi mới hơn. Sau restart nó được
 * gieo lại từ chính snapshot vừa đọc, nên dãy số không bao giờ lùi.
 */
const opSeqs = new Map<string, number>();

function nextOpSeq(code: string): number {
  const next = (opSeqs.get(code) ?? 0) + 1;
  opSeqs.set(code, next);
  return next;
}

/**
 * Ghi snapshot của phòng.
 *
 * BEST-EFFORT có chủ đích: RAM là nguồn đang chạy, Redis là bản sao để sống sót
 * qua restart. Một lần ghi hỏng không được phép chặn ván - đó là quyết định vận
 * hành, và cái giá của nó (chết đúng lúc Redis cũng đang chết thì mất ván) được
 * ghi rõ trong tài liệu vận hành.
 */
export async function persistRoom(room: Room): Promise<void> {
  // Ván đã xong chỉ cần sống qua màn lật bài và vài phút bàn tán, không cần
  // chiếm chỗ sáu tiếng như một ván đang chạy.
  const ttl =
    room.engine?.state.phase === "GAME_OVER" ? FINISHED_ROOM_TTL_SECONDS : ROOM_TTL_SECONDS;

  await saveEnvelope(serializeRoom(room, nextOpSeq(room.code)), ttl);
}

export async function deletePersistedRoom(code: string): Promise<void> {
  opSeqs.delete(code);
  await deleteEnvelope(code);
}

export type RoomLoadOutcome =
  | { status: "ok"; room: Room }
  | { status: "missing" }
  | { status: "unavailable" }
  | { status: "corrupt"; reason: string };

/**
 * Nạp phòng từ Redis vào bộ nhớ, KHÔNG hẹn giờ và không chạy bước nào.
 *
 * Bốn kết quả được giữ tách bạch tới tận chỗ gọi. Gộp "Redis đang chết" vào
 * "không có phòng" chính là cách một lần chớp mắt của Redis xoá sổ một ván
 * đang chơi và đẩy người chơi vào một phòng trống.
 */
export async function loadRoomSnapshot(code: string): Promise<RoomLoadOutcome> {
  const result = await loadEnvelope(code);
  if (result.status !== "ok") return result;

  const room = restoreRoomFromEnvelope(result.envelope);
  // Nối tiếp dãy số ghi của process trước: lời ghi đầu tiên của process này
  // phải LỚN HƠN bản đang nằm trong Redis, nếu không compare-and-set sẽ bỏ nó.
  opSeqs.set(code, result.envelope.opSeq);
  rooms.set(code, room);

  return { status: "ok", room };
}

/**
 * Mã phòng đã có người dùng chưa.
 *
 * Chỉ hỏi sự tồn tại của khoá, KHÔNG dựng lại phòng: việc sinh mã cho một
 * phòng mới không có lý do gì để đánh thức một ván của người khác dậy.
 * Redis chết thì trả `false` - một va chạm mã là chuyện gần như không xảy ra,
 * còn chặn hẳn việc tạo phòng khi Redis chết thì trái với thoả thuận
 * "best-effort lúc chạy".
 */
export async function roomCodeTaken(code: string): Promise<boolean> {
  if (rooms.has(code)) return true;
  try {
    return (await redis.exists(`room:${code}`)) === 1;
  } catch {
    return false;
  }
}
