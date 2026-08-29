import { SERVER_EVENTS } from "@masoi/shared";
import type { GameEngine } from "@masoi/game-engine";
import { buildBotDecisionContext } from "../bots/context";
import { botSessionFor } from "../bots/session-registry";
import { renderBotSpeech } from "../bots/speech-renderer";
import { emitToPlayers } from "../rooms/broadcast";
import { pushChat, resolveChat } from "../rooms/snapshot";
import { persistRoom, setRoomTimer, type Room } from "../rooms/store";
import { newId } from "../util";
import { toSpeechRequest } from "./machine";

/**
 * Ai nói, lúc nào, và bao nhiêu là đủ.
 *
 * Trước Phase 4 mỗi BOT có đúng một `setTimeout` mỗi ngày, nên nó phát biểu
 * đúng một lần rồi im - không có cách nào để nó trả lời ai. Ở đây thay bằng
 * nhiều CHECKPOINT: tại mỗi mốc, scheduler chọn ĐÚNG MỘT con BOT đủ điều kiện,
 * hỏi lõi, rồi phát. Một hàng đợi tuần tự, không phải mấy chục timer song song.
 *
 * Phân chia trách nhiệm, giữ nguyên từ Phase 2:
 *
 * - **Lõi** (`@masoi/game-engine`) quyết ai nói gì. Thuần, tái lập được.
 * - **File này** quyết lúc nào và bao nhiêu. Có đồng hồ, có I/O.
 * - **Nhà cung cấp** chỉ viết câu chữ, và có thể vắng mặt hoàn toàn.
 *
 * *Ai* được chọn lấy từ RNG đã gieo hạt của session, nên test khẳng định được
 * thứ tự người nói. *Khi nào* dùng đồng hồ thật, và test không khẳng định
 * mili giây.
 */

/** Cách nhau tối thiểu giữa hai câu, để người thật kịp đọc. */
const MIN_GAP_MS = 2_500;
/** Biên độ ngẫu nhiên cộng thêm, gieo từ RNG của phòng. */
const JITTER_MS = 4_000;
/** Chừa cuối pha: một câu về muộn hơn mốc này là một câu của tình thế đã qua. */
const DEADLINE_BUFFER_MS = 2_000;
/** Không bắt đầu ngay khi trời vừa sáng; để người thật lên tiếng trước. */
const OPENING_DELAY_MS = 2_000;

interface DiscussionRun {
  cancelled: boolean;
  /** Engine của đúng ván và đúng pha đã mở phiên này. */
  engine: GameEngine;
  round: number;
  phaseEndsAt: number | null;
  /** Số tin mỗi BOT đã phát trong vòng này. */
  spoken: Map<string, number>;
  total: number;
  /** Mốc phát gần nhất, để không hai câu nào trùng khoảnh khắc. */
  lastAt: number;
}

const runs = new Map<string, DiscussionRun>();

/**
 * Dừng mọi phản hồi đang chờ của một phòng.
 *
 * Gọi khi pha đổi, khi cả làng bấm bỏ qua thảo luận, hoặc khi ván kết thúc.
 * Đặt cờ chứ không xoá timer: một lời gọi nhà cung cấp đang bay không huỷ được,
 * nên thứ phải huỷ là việc PHÁT kết quả của nó.
 */
export function cancelDiscussionScheduler(roomCode: string): void {
  const run = runs.get(roomCode);
  if (run) run.cancelled = true;
  runs.delete(roomCode);
}

/** Tình thế vẫn đúng như lúc lên lịch. Kiểm cả trước lẫn sau khi `await`. */
function stillValid(room: Room, run: DiscussionRun, botId: string): boolean {
  if (run.cancelled) return false;
  if (runs.get(room.code) !== run) return false;
  if (!room.engine || room.engine !== run.engine) return false;

  const state = room.engine.state;
  if (state.phase !== "DAY_DISCUSSION") return false;
  if (state.round !== run.round) return false;
  if (state.phaseEndsAt !== run.phaseEndsAt) return false;

  // BOT chết giữa chừng: kiểm lại ở CẢ hai đầu của lời gọi nhà cung cấp. Chặn
  // một đầu là chưa đủ - một BOT có thể chết trong lúc câu của nó đang được
  // viết, và `resolveChat` sẽ vui vẻ đẩy câu đó vào kênh người chết.
  return state.players.find((player) => player.id === botId)?.alive === true;
}

export function runDiscussionScheduler(room: Room): void {
  cancelDiscussionScheduler(room.code);
  if (!room.engine || room.engine.state.phase !== "DAY_DISCUSSION") return;

  const run: DiscussionRun = {
    cancelled: false,
    engine: room.engine,
    round: room.engine.state.round,
    phaseEndsAt: room.engine.state.phaseEndsAt,
    spoken: new Map(),
    total: 0,
    lastAt: 0,
  };
  runs.set(room.code, run);

  const session = botSessionFor(room);
  const pick = session.rngFor("__room__", `discussion:${run.round}`);
  const weights = session.runtimeFor(room.members[0]!.playerId).weights.conversation;

  const step = (): void => {
    if (run.cancelled || runs.get(room.code) !== run) return;

    const now = Date.now();
    const deadline = (run.phaseEndsAt ?? now) - DEADLINE_BUFFER_MS;
    if (now >= deadline) return;
    if (run.total >= weights.roomMessagesPerRound) return;

    // Ứng viên: BOT còn sống, chưa chạm hạn mức riêng. Sắp theo ID để lựa chọn
    // chỉ phụ thuộc RNG đã gieo hạt, không phụ thuộc thứ tự thành viên trong
    // phòng - thứ tự đó đổi theo ai vào phòng trước.
    const candidates = room.members
      .filter((member) => member.isBot)
      .filter(
        (member) =>
          room.engine!.state.players.find((p) => p.id === member.playerId)?.alive === true,
      )
      .filter(
        (member) =>
          (run.spoken.get(member.playerId) ?? 0) < weights.messagesPerBotPerRound,
      )
      .sort((left, right) => left.playerId.localeCompare(right.playerId));

    if (candidates.length === 0) return;

    // RNG chứ không phải xoay vòng: xoay vòng cho ra đúng một thứ tự nói mỗi
    // ngày, và "các BOT nghe giống nhau" chính là thứ Phase 4 phải chữa.
    const member = candidates[Math.floor(pick() * candidates.length)]!;
    const gap = MIN_GAP_MS + Math.floor(pick() * JITTER_MS);

    void (async () => {
      try {
        if (!stillValid(room, run, member.playerId)) return;

        const runtime = session.runtimeFor(member.playerId);
        const context = buildBotDecisionContext(room, member.playerId);
        runtime.observe(context);

        // Lá phiếu do lõi chốt TRƯỚC khi hỏi nhà cung cấp, và KHÔNG được nộp ở
        // đây: pha bỏ phiếu sẽ hỏi lại chính lõi này với ngữ cảnh mới nhất. Một
        // phiếu đóng băng từ lúc thảo luận là phiếu bỏ qua mọi thứ xảy ra sau.
        const vote = runtime.decideVote(context);
        const speech = runtime.decideSpeech(context, vote);
        if (!speech) return;

        const rendered = await renderBotSpeech(
          toSpeechRequest(room, member, context, speech),
        );

        // Kiểm LẠI sau khi await: nhà cung cấp có thể mất vài giây, và trong
        // khoảng đó pha có thể đã đổi hoặc BOT có thể đã chết.
        if (!stillValid(room, run, member.playerId)) return;
        if (!rendered.text) return;

        const at = Date.now();
        if (at >= (run.phaseEndsAt ?? at) - DEADLINE_BUFFER_MS) return;

        const resolved = resolveChat(room, member.playerId);
        // Vẫn đi qua `resolveChat`, nên `SILENT_NIGHT`, luật kênh và luật bào
        // chữa được tôn trọng mà không phải chép lại ở đây. Kênh `day` là kênh
        // DUY NHẤT hợp lệ cho pha này; mọi kênh khác nghĩa là tình thế đã đổi.
        if (!resolved.ok || resolved.channel !== "day") return;

        const message = {
          id: newId(),
          channel: resolved.channel,
          playerId: member.playerId,
          playerName: member.name,
          text: rendered.text,
          // Không hai câu nào trùng khoảnh khắc: hai BOT trả lời cùng một
          // mili giây đọc lên như một cái bot, không như hai người.
          at: Math.max(at, run.lastAt + 1),
        };
        run.lastAt = message.at;
        run.spoken.set(member.playerId, (run.spoken.get(member.playerId) ?? 0) + 1);
        run.total += 1;

        pushChat(room, message);
        emitToPlayers(resolved.recipients, SERVER_EVENTS.CHAT_NEW, message);
        void persistRoom(room);
        runtime.recordSpeech(speech, run.round, rendered.text);
      } catch {
        /* não bot lỗi (mạng, JSON hỏng,...) không được kéo sập cả tiến trình */
      } finally {
        // Hàng đợi TUẦN TỰ: mốc kế tiếp chỉ được đặt sau khi mốc này xong, nên
        // không bao giờ có hai lượt hỏi chạy song song trong một phòng.
        if (!run.cancelled && runs.get(room.code) === run) {
          setRoomTimer(room.code, step, gap);
        }
      }
    })();
  };

  setRoomTimer(room.code, step, OPENING_DELAY_MS);
}
