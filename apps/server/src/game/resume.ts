import type { GamePhase } from "@masoi/shared";
import type { Room } from "../rooms/store";
import { serializeDiscussionRun, runDiscussionScheduler } from "./discussion-scheduler";
import type { PersistedDiscussionRun } from "./discussion-scheduler";
import { writeGameResultOnce } from "./game-result";
import {
  scheduleDayOfTruthBots,
  scheduleDeadCanSpeakBot,
  scheduleFinalVoteBots,
  scheduleHunterBot,
  scheduleNightBots,
  scheduleVoteBots,
} from "./machine";
import { armStep, runPendingStep } from "./steps";

/**
 * Sàn thời gian khi mở lại một pha CẦN NGƯỜI CHƠI THAO TÁC.
 *
 * Không có nó, một người vừa nối lại sau restart có thể bị cắt lượt trong đúng
 * cái giây họ nhìn thấy màn hình: hạn chót cũ có thể chỉ còn 300ms, hoặc đã
 * trôi qua từ lâu trong lúc process nằm chết. Mười giây là đủ để đọc tình thế
 * và bấm một nút, và đủ ngắn để không ai thấy ván bị kéo dài vô cớ.
 */
export const RESUME_FLOOR_MS = 10_000;

/**
 * Pha mà người chơi phải làm gì đó. Chỉ những pha này được hưởng sàn thời gian.
 *
 * Các pha còn lại (`ROLE_REVEAL`, `NIGHT_RESULT`, `ELIMINATION`, `CHECK_WIN`)
 * là màn chuyển tiếp: kéo dài chúng sau restart chỉ làm người chơi ngồi nhìn
 * một màn hình họ đã xem xong, nên quá hạn là chạy bù NGAY.
 */
export const INTERACTIVE_PHASES: ReadonlySet<GamePhase> = new Set<GamePhase>([
  "NIGHT",
  "DAY_DISCUSSION",
  "VOTING",
  "DEFENSE",
  "FINAL_VOTE",
  "HUNTER_SHOT",
]);

/** Mở lại lịch nói/hành động của BOT trong đúng cửa sổ CÒN LẠI của pha. */
function rescheduleBots(room: Room, resumeRun: PersistedDiscussionRun | null): void {
  const phase = room.engine?.state.phase;

  switch (phase) {
    case "NIGHT":
      scheduleNightBots(room);
      break;
    case "DAY_DISCUSSION":
      runDiscussionScheduler(room, resumeRun);
      scheduleDayOfTruthBots(room);
      scheduleDeadCanSpeakBot(room);
      break;
    case "VOTING":
      scheduleVoteBots(room);
      break;
    case "FINAL_VOTE":
      scheduleFinalVoteBots(room);
      break;
    case "HUNTER_SHOT":
      scheduleHunterBot(room);
      break;
    default:
      // DEFENSE: lượt bào chữa của BOT là một lời gọi nhà cung cấp đã bay mất
      // cùng process cũ. Không gọi lại: bị cáo im lặng vài giây còn hơn là nói
      // hai lần, và pha vẫn tự kết thúc đúng hạn.
      break;
  }
}

export interface ResumeOutcome {
  /** Đã chạy bù một bước quá hạn ngay lập tức hay chưa. */
  caughtUp: boolean;
  /** Đã kéo dài hạn chót lên sàn hay chưa. */
  extended: boolean;
}

/**
 * Đưa một phòng vừa nạp từ snapshot trở lại trạng thái đang chạy.
 *
 * Ba đường ra, và chỉ ba:
 *
 *  1. Ván đã xong (hoặc phòng ở sảnh chờ): không hẹn gì. Ở `GAME_OVER` còn ghi
 *     bù `GameResult` nếu process trước chết trước khi kịp ghi.
 *  2. Bước chờ vẫn còn hạn: hẹn lại đúng phần thời gian CÒN LẠI, nên
 *     `phaseEndsAt` không đổi và đồng hồ của client vẫn đúng.
 *  3. Bước chờ đã quá hạn: pha thao tác thì kéo lên sàn; pha chuyển tiếp thì
 *     chạy bù ĐÚNG MỘT LẦN rồi để ván chạy tiếp bằng đồng hồ thật.
 *
 * "Đúng một lần" không phải lời hứa suông: bước chạy bù đi qua `runPendingStep`
 * như mọi bước khác, nên phase token chặn mọi lần chạy thứ hai kể cả khi một
 * timer khác cũng vừa được hẹn cho đúng bước đó.
 */
export function resumeRoom(room: Room): ResumeOutcome {
  const noop: ResumeOutcome = { caughtUp: false, extended: false };

  if (!room.engine || room.status !== "IN_GAME") return noop;

  const state = room.engine.state;

  if (state.phase === "GAME_OVER") {
    // Ván đã xong nhưng có thể chưa kịp ghi kết quả. `writeGameResultOnce` tự
    // lo phần "đúng một lần", nên gọi ở đây là an toàn kể cả khi process trước
    // đã ghi xong.
    void writeGameResultOnce(room);
    return noop;
  }

  const pending = room.pendingStep;
  if (!pending) {
    // Không có bước chờ mà ván chưa xong: snapshot được chụp đúng khe giữa hai
    // lần hẹn. Không đoán bước kế tiếp - chỉ mở lại lịch bot, và hạn chót của
    // pha vẫn hiển thị đúng cho người chơi.
    rescheduleBots(room, serializeDiscussionRun(room.code));
    return noop;
  }

  const now = Date.now();
  const remaining = pending.runAt - now;
  const interactive = INTERACTIVE_PHASES.has(state.phase);
  const resumeRun = serializeDiscussionRun(room.code);

  if (remaining > 0 && (!interactive || remaining >= RESUME_FLOOR_MS)) {
    armStep(room, { name: pending.name, source: pending.source }, remaining);
    rescheduleBots(room, resumeRun);
    return noop;
  }

  if (interactive) {
    // Dời hạn chót của ENGINE chứ không chỉ hẹn lại timer: `phaseEndsAt` là thứ
    // client vẽ đồng hồ, và hai con số lệch nhau nghĩa là người chơi thấy đồng
    // hồ về 0 trong khi pha vẫn còn mở.
    room.engine.extendPhase(RESUME_FLOOR_MS, now);
    armStep(room, { name: pending.name, source: pending.source }, RESUME_FLOOR_MS);
    rescheduleBots(room, resumeRun);
    return { caughtUp: false, extended: true };
  }

  // Pha chuyển tiếp đã quá hạn: chạy bù ngay. `runPendingStep` tự tiêu token,
  // nên bước này không thể chạy lần thứ hai từ bất kỳ đường nào khác.
  //
  // KHÔNG gọi `rescheduleBots` sau đó: bước vừa chạy đã mở pha mới và tự xếp
  // lịch cho pha đó. Gọi thêm ở đây là xếp lịch chồng - mỗi con BOT có hai
  // hàng đợi cho cùng một pha.
  runPendingStep(room, pending);
  return { caughtUp: true, extended: false };
}
