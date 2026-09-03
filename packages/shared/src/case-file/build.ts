import { isMatchOutcome } from "../phases";
import { roleTeam } from "../roles";
import type { RoomSnapshot } from "../snapshot";
import { collectCandidates, quietMatchHighlight, selectHighlights, type CaseData } from "./highlights";
import type { CaseFile, CaseFilePlayer, CaseLastLetter, CaseTimelineEntry } from "./types";

/** Crockford base32: bỏ I, L, O, U để mã đọc qua điện thoại không bị nhầm chữ. */
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Mã hồ sơ ổn định.
 *
 * Chỉ băm những trường BẤT BIẾN sau `finishGame` - tuyệt đối không `serverNow`
 * (đổi mỗi lần đẩy snapshot) hay `Date.now()`, nếu không thì mỗi lần reconnect
 * lại ra một mã khác cho cùng một ván.
 *
 * Mã phòng chỉ là đầu vào của hàm băm và không đi ra ngoài: chia sẻ một mã phòng
 * đã chết là gửi đi một lời mời gãy.
 */
function caseIdFor(roomCode: string, rounds: number, winner: string, cast: CaseFilePlayer[]): string {
  const canonical = [
    roomCode,
    String(rounds),
    winner,
    cast.map((player) => `${player.id}:${player.role}`).join(","),
  ].join("|");

  let value = fnv1a(canonical);
  let out = "";
  for (let index = 0; index < 5; index += 1) {
    out = BASE32[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return `HS-${out}`;
}

/**
 * Roster đã chuẩn hoá.
 *
 * Người chưa lộ vai bị LOẠI thay vì đoán: `role` chỉ vắng mặt khi snapshot tới
 * từ một server chưa mở khoá bài, và một hồ sơ đoán vai là một hồ sơ sai.
 */
function buildCast(snapshot: RoomSnapshot): CaseFilePlayer[] {
  const out: CaseFilePlayer[] = [];
  for (const player of snapshot.players) {
    if (!player.role) continue;
    out.push({
      id: player.id,
      name: player.name,
      role: player.role,
      // Phép ghi đè vai DUY NHẤT của engine là Kẻ Nguyền Rủa hoá Sói, nên cờ này
      // là đủ để suy ngược vai lúc chia bài.
      originRole: player.cursedTurned === true ? "CURSED" : player.role,
      team: roleTeam(player.role),
      alive: player.alive,
      isBot: player.isBot,
    });
  }
  return out;
}

/**
 * Thư đã mở, chép sang dạng lưu trữ.
 *
 * Nguồn là `snapshot.lastLetter.opened`, tức thứ server đã quyết định là công
 * khai. Hàm này KHÔNG có nhánh nào chạm tới bản nháp của người còn sống - danh
 * sách đó không tồn tại trong snapshot mà nó đọc.
 *
 * Trả `undefined` (không phải mảng rỗng) khi không có thư nào: một trường vắng
 * mặt đọc ra đúng nghĩa "ván này không có mục đó", và nó giữ hồ sơ của phòng
 * tắt add-on y hệt hồ sơ ghi trước khi có tính năng.
 */
function buildLastLetters(snapshot: RoomSnapshot): CaseLastLetter[] | undefined {
  const opened = snapshot.lastLetter?.opened ?? [];
  if (opened.length === 0) return undefined;
  return opened.map((letter) => ({
    authorId: letter.authorId,
    authorName: letter.authorName,
    text: letter.text,
    sealedRound: letter.sealedRound,
    openedRound: letter.openedRound,
  }));
}

/** Thứ tự trong một vòng: đêm trước, rồi tới ngày. */
const PHASE_RANK = { night: 0, day: 1 } as const;

function buildTimeline(data: CaseData): CaseTimelineEntry[] {
  const entries: Array<CaseTimelineEntry & { slot: number }> = [];

  for (const night of data.nights) {
    const turned = night.cursedTurned ?? null;
    if (turned) {
      entries.push({
        round: night.round,
        phase: "night",
        kind: "cursed-turned",
        playerId: turned.id,
        name: turned.name,
        slot: 0,
      });
    }
    for (const death of night.deaths ?? []) {
      entries.push({
        round: night.round,
        phase: "night",
        kind: "death",
        playerId: death.player.id,
        name: death.player.name,
        cause: death.cause,
        slot: 1,
      });
    }
  }

  for (const day of data.days) {
    if (day.nomination.kind !== "TRIAL" || !day.finalJudgment?.lynched) continue;
    const accusedId = day.nomination.accusedId;
    entries.push({
      round: day.round,
      phase: "day",
      kind: "death",
      playerId: accusedId,
      name: data.players.get(accusedId)?.name ?? "Người đã rời làng",
      cause: "lynch",
      slot: 0,
    });
  }

  for (const shot of data.shots) {
    // Không bắn ai thì không có gì xảy ra để mà ghi vào dòng thời gian.
    if (!shot.target) continue;
    entries.push({
      round: shot.round,
      phase: shot.source === "night" ? "night" : "day",
      kind: "death",
      playerId: shot.target.id,
      name: shot.target.name,
      cause: "hunter",
      // Sau cái chết đã kéo Thợ Săn vào cuộc: phát bắn là phản ứng, không phải
      // nguyên nhân đầu tiên của vòng đó.
      slot: 2,
    });
  }

  return entries
    .sort(
      (a, b) =>
        a.round - b.round ||
        PHASE_RANK[a.phase] - PHASE_RANK[b.phase] ||
        a.slot - b.slot ||
        (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
    )
    .map(({ slot: _slot, ...entry }) => entry);
}

/**
 * Dựng hồ sơ vụ án từ snapshot của một ván ĐÃ KẾT THÚC.
 *
 * Hàm thuần và tất định: cùng snapshot luôn cho ra cùng hồ sơ. Không đọc đồng
 * hồ, không random, không gọi IO.
 *
 * Trả `null` là CỔNG BẢO MẬT DUY NHẤT của tính năng này, và nó nằm ở dòng đầu:
 * không có nhánh nào dựng được một phần hồ sơ trước khi ván kết thúc. Giao diện
 * không tự kiểm tra pha - nó chỉ vẽ khi hàm này trả về khác `null`.
 */
export function buildCaseFile(snapshot: RoomSnapshot): CaseFile | null {
  if (snapshot.phase !== "GAME_OVER") return null;
  const winner = snapshot.winner;
  /*
   * Nhận CẢ BỐN kết cục, kể cả `draw`.
   *
   * Bản đầu chỉ nhận `wolves`/`village` và trả `null` cho mọi thứ khác. Khi
   * xuất hiện kết cục thứ ba, dòng đó lặng lẽ tắt hồ sơ vụ án, thẻ chia sẻ và
   * màn hồi ức 3D của đúng những ván ly kỳ nhất - một ván Sát Nhân sống tới
   * cuối, hoặc một đêm cả hai kẻ giết người cùng ngã xuống.
   *
   * `isMatchOutcome` chứ không phải một danh sách chép tay: đây là biên đọc dữ
   * liệu (snapshot có thể tới từ một server khác phiên bản), và một chuỗi lạ
   * phải rơi về `null` chứ không được đi tiếp vào bảng nhãn.
   */
  if (!isMatchOutcome(winner)) return null;

  const cast = buildCast(snapshot);
  const data: CaseData = {
    players: new Map(cast.map((player) => [player.id, player])),
    cast,
    // Web và server deploy rời nhau: server cũ có thể thiếu hẳn các mảng này.
    nights: snapshot.nightHistory ?? [],
    days: snapshot.dayVoteHistory ?? [],
    shots: snapshot.hunterShots ?? [],
    winner,
    rounds: snapshot.round,
  };

  const highlights = selectHighlights(collectCandidates(data));
  const fallback = highlights.length === 0;

  return {
    version: 1,
    caseId: caseIdFor(snapshot.code, data.rounds, winner, cast),
    winner,
    rounds: data.rounds,
    cast,
    highlights: fallback ? [quietMatchHighlight(data)] : highlights,
    timeline: buildTimeline(data),
    fallback,
    lastLetters: buildLastLetters(snapshot),
  };
}
