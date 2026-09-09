import type { Role, Winner } from "@masoi/shared";
import type { SelfPlayEvent, SelfPlayGame } from "./selfplay";

/**
 * PR 9 của `NIGHTFALL_BOT_COMMUNICATION_UPGRADE` (§27): biên bản một ván, viết
 * cho NGƯỜI ĐỌC chấm điểm.
 *
 * §27 đặt đúng một ràng buộc, và nó là ràng buộc quyết định cả thiết kế file
 * này: **"Người đánh giá không biết hidden roles."** Một biên bản để lộ vai
 * biến bài chấm thành bài đọc đáp án - người chấm sẽ thấy lời nói dối của Sói
 * là "vụng" chỉ vì họ đã biết đó là Sói.
 *
 * Vì vậy hàm ở đây KHÔNG đọc `game.roles`, KHÔNG đọc sự kiện ban đêm, và
 * KHÔNG mang seed. Cả ba đều có test khoá:
 *
 * - đổi TOÀN BỘ `game.roles` không làm biên bản đổi một ký tự;
 * - xoá mọi sự kiện riêng tư khỏi đầu vào cũng vậy;
 * - `label` là nhãn ẩn danh do chỗ gọi đặt, không phải seed - có seed thì người
 *   chấm chạy lại được ván và đọc ra vai.
 *
 * Kết cục ván (`winner`) cũng KHÔNG có trong biên bản: biết phe nào thắng là
 * suy ngược được vai của những người còn sống. Nó nằm ở `buildAnswerKey`, tờ
 * đáp án chỉ mở sau khi chấm xong.
 *
 * THUẦN: không I/O, không đồng hồ, không RNG.
 */

/** Khối mà một người ngồi ở bàn nhìn thấy. Không phải `Phase` của engine. */
export type TranscriptSection = "NIGHT" | "DAY" | "TRIAL";

export interface TranscriptEntry {
  round: number;
  section: TranscriptSection;
  /** Tên người nói, hoặc `null` với dòng hệ thống. */
  speaker: string | null;
  text: string;
}

export interface GameTranscript {
  /** Nhãn ẩn danh ("Ván A"). KHÔNG phải seed - xem chú thích đầu file. */
  label: string;
  playerCount: number;
  entries: TranscriptEntry[];
}

/** Tờ đáp án, chỉ mở SAU khi chấm xong. Đây là chỗ duy nhất có vai và kết cục. */
export interface TranscriptAnswerKey {
  label: string;
  seed: string;
  winner: Winner;
  roles: Record<string, Role>;
}

/**
 * Sự kiện mà cả bàn cùng thấy.
 *
 * Danh sách CHO PHÉP, không phải danh sách cấm: một loại sự kiện mới thêm vào
 * `SelfPlayEvent` sẽ mặc định bị loại khỏi biên bản thay vì mặc định lọt vào.
 * Với một file mà cả giá trị của nó nằm ở chỗ "không lộ gì", mặc định phải là
 * đóng.
 */
const PUBLIC_EVENTS: ReadonlySet<SelfPlayEvent["kind"]> = new Set<SelfPlayEvent["kind"]>([
  "PHASE",
  "SPEECH",
  "VOTE",
  "NOMINATION",
  "FINAL_VOTE",
  "DEATH",
]);

/**
 * Nguyên nhân chết, viết theo đúng những gì cả bàn ĐÃ BIẾT.
 *
 * `lynch` giữ nguyên vì cả làng vừa bỏ phiếu treo người đó - giấu đi thì biên
 * bản còn kém thông tin hơn cái phòng thật.
 *
 * Bốn nguyên nhân còn lại gộp hết thành một chữ "chết". `poison` nói rằng Phù
 * Thuỷ còn sống, `serial_killer` nói rằng bộ bài có Sát Nhân và nó chưa chết,
 * `hunter` gọi thẳng tên một vai. Cả ba là thông tin về VAI, đúng thứ §27 cấm.
 *
 * Cố ý kém thông tin hơn phòng thật ở nhánh `hunter` (phòng thật thấy phát súng
 * là một lần lộ vai công khai). Với một bài chấm CHẤT LƯỢNG HỘI THOẠI, thiếu
 * một chi tiết thì tệ nhất là mất một chút ngữ cảnh; thừa một chi tiết về vai
 * thì hỏng cả phép đo.
 */
function deathLine(playerName: string, cause: string): string {
  return cause === "lynch" ? `${playerName} bị treo cổ.` : `${playerName} đã chết.`;
}

function sectionOf(phase: string): TranscriptSection | null {
  if (phase === "NIGHT" || phase === "NIGHT_RESULT") return "NIGHT";
  if (phase === "DAY_DISCUSSION" || phase === "VOTING") return "DAY";
  if (phase === "DEFENSE" || phase === "FINAL_VOTE" || phase === "ELIMINATION") return "TRIAL";
  return null;
}

/**
 * Biên bản một ván, đã lọc.
 *
 * `names` ánh xạ id -> tên hiển thị. Tách khỏi `game` vì `SelfPlayGame` không
 * mang tên: nhân mô phỏng chỉ làm việc với id, còn tên là chuyện của tầng đọc.
 */
export function buildTranscript(
  game: Pick<SelfPlayGame, "events">,
  label: string,
  names: Record<string, string>,
): GameTranscript {
  const nameOf = (playerId: string): string => names[playerId] ?? playerId;

  const entries: TranscriptEntry[] = [];
  const seats = new Set<string>();

  let round = 0;
  let section: TranscriptSection = "NIGHT";
  /** Phiếu của vòng hiện tại, gom lại để in một dòng thay vì mỗi lá một dòng. */
  let ballots: string[] = [];

  const flushBallots = (): void => {
    if (ballots.length === 0) return;
    entries.push({
      round,
      section: "DAY",
      speaker: null,
      // "Diễn biến", không phải "kết quả": danh sách này gồm cả những lá ĐỔI
      // trong vòng, nên một người xuất hiện hai lần là chuyện thường - và
      // chính chỗ đổi ý đó là thứ người chấm cần thấy.
      text: `Diễn biến bỏ phiếu: ${ballots.join(", ")}.`,
    });
    ballots = [];
  };

  for (const event of game.events) {
    if (!PUBLIC_EVENTS.has(event.kind)) continue;

    switch (event.kind) {
      case "PHASE": {
        const next = sectionOf(event.phase);
        if (next === null) break;
        if (event.round !== round || next !== section) flushBallots();
        round = event.round;
        section = next;
        break;
      }

      case "SPEECH": {
        seats.add(event.actorId);
        entries.push({
          round: event.round,
          section,
          speaker: nameOf(event.actorId),
          // CHỈ văn bản. `speech`, `tone`, `targetId`, `claimedRole` là quyết
          // định NỘI BỘ của lõi; in chúng ra là mách người chấm biết BOT định
          // làm gì, và câu hỏi "câu này đọc có tự nhiên không" mất hết nghĩa.
          text: event.text,
        });
        break;
      }

      case "VOTE": {
        seats.add(event.voterId);
        ballots.push(
          `${nameOf(event.voterId)} -> ${
            event.targetId === null ? "không treo ai" : nameOf(event.targetId)
          }`,
        );
        break;
      }

      case "NOMINATION": {
        flushBallots();
        if (event.accusedId === null) break;
        entries.push({
          round: event.round,
          section: "TRIAL",
          speaker: null,
          text: `${nameOf(event.accusedId)} bị đưa ra xử.`,
        });
        break;
      }

      case "FINAL_VOTE": {
        seats.add(event.voterId);
        entries.push({
          round: event.round,
          section: "TRIAL",
          speaker: null,
          text: `${nameOf(event.voterId)} bỏ phiếu ${event.guilty ? "TREO" : "THA"}.`,
        });
        break;
      }

      case "DEATH": {
        flushBallots();
        seats.add(event.playerId);
        entries.push({
          round: event.round,
          section,
          speaker: null,
          text: deathLine(nameOf(event.playerId), event.cause),
        });
        break;
      }

      default:
        break;
    }
  }

  flushBallots();

  return { label, playerCount: seats.size, entries };
}

const SECTION_TITLE: Readonly<Record<TranscriptSection, string>> = Object.freeze({
  NIGHT: "Đêm",
  DAY: "Ngày",
  TRIAL: "Phiên toà",
});

/** Biên bản thành chữ, để dán vào tờ chấm. */
export function formatTranscript(transcript: GameTranscript): string {
  const lines: string[] = [`# ${transcript.label}`, "", `Số người: ${transcript.playerCount}`, ""];

  let header = "";
  for (const entry of transcript.entries) {
    const next = `## ${SECTION_TITLE[entry.section]} ${entry.round}`;
    if (next !== header) {
      // Dòng trống TRƯỚC tiêu đề: không có nó thì một tiêu đề ngay sau một dòng
      // hệ thống không được markdown nhận ra là tiêu đề.
      if (lines[lines.length - 1] !== "") lines.push("");
      lines.push(next, "");
      header = next;
    }
    lines.push(entry.speaker === null ? `_${entry.text}_` : `**${entry.speaker}:** ${entry.text}`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Tờ đáp án cho MỘT ván.
 *
 * Tách hẳn khỏi `buildTranscript` chứ không phải một trường optional của nó:
 * một trường optional là một trường ai đó sẽ vô tình bật lên, còn hai hàm khác
 * tên thì phải cố ý gọi mới có.
 */
export function buildAnswerKey(
  game: Pick<SelfPlayGame, "record" | "winner" | "roles">,
  label: string,
  names: Record<string, string>,
): TranscriptAnswerKey {
  const roles: Record<string, Role> = {};
  for (const [playerId, role] of Object.entries(game.roles).sort()) {
    roles[names[playerId] ?? playerId] = role;
  }
  return { label, seed: game.record.seed, winner: game.winner, roles };
}
