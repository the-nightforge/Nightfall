import { SERVER_EVENTS } from "@masoi/shared";
import { judgeChainPosition, type GameEngine } from "@masoi/game-engine";
import { buildBotDecisionContext } from "../bots/context";
import { botSessionFor } from "../bots/session-registry";
import { renderBotSpeech } from "../bots/speech-renderer";
import { emitToPlayers } from "../rooms/broadcast";
import { pushChat, resolveChat } from "../rooms/snapshot";
import { persistRoom, setRoomTimer, type Room } from "../rooms/store";
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
/**
 * Nhịp nghỉ RIÊNG của mỗi BOT giữa hai câu của chính nó.
 *
 * `messagesPerBotPerRound` nói một con BOT được nói bao nhiêu câu một ngày,
 * nhưng không nói gì về khoảng cách giữa chúng - nên không có hằng số này, một
 * con BOT tiêu sạch hạn mức ngày của nó trong ba checkpoint liền nhau, tức
 * khoảng tám giây, rồi im suốt phần còn lại của pha. Đọc lên đó là một cái loa
 * vừa bật vừa tắt, không phải một người đang bàn bạc.
 *
 * Bảy giây ≈ 1,5 tới 2,8 checkpoint, nên giữa hai câu của cùng một BOT luôn có
 * chỗ cho một người khác chen vào. Con số sống ở đây chứ không ở
 * `ConversationWeights` vì đó là một bảng cố tình KHÔNG chứa mili giây: server
 * sở hữu đồng hồ.
 */
export const PER_BOT_COOLDOWN_MS = 7_000;

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
  /** Mốc phát gần nhất CỦA TỪNG BOT, cho nhịp nghỉ riêng. */
  lastSpokenAt: Map<string, number>;
  /**
   * Độ sâu chuỗi của từng câu scheduler đã phát.
   *
   * Chỉ chứa câu của BOT. Message vắng mặt - câu của người thật, câu có từ
   * trước khi phiên mở - ngầm hiểu là GỐC, tức độ sâu 0.
   */
  messageDepths: Map<string, number>;
  /** Số phản hồi mỗi message đã nhận, đếm theo `replyToMessageId`. */
  replyCounts: Map<string, number>;
}

const runs = new Map<string, DiscussionRun>();

/**
 * Bộ đếm của một phiên thảo luận, ở dạng lưu được.
 *
 * Phải sống sót qua restart vì id tin nhắn của BOT là TẤT ĐỊNH
 * (`bot-chat:{vòng}:{total}`). Mở lại phiên với `total = 0` sẽ sinh đúng những
 * id đã nằm trong `chatLog`, và `judgeChainPosition` cùng quan hệ `replyTo`
 * bám thẳng vào id đó. `spoken`/`lastSpokenAt` đi kèm vì thiếu chúng thì một
 * lần restart tự cấp lại hạn mức nói cho cả bàn trong cùng một vòng.
 */
export interface PersistedDiscussionRun {
  round: number;
  phaseEndsAt: number | null;
  total: number;
  lastAt: number;
  spoken: Record<string, number>;
  lastSpokenAt: Record<string, number>;
  messageDepths: Record<string, number>;
  replyCounts: Record<string, number>;
}

/** Ảnh chụp phiên đang mở của phòng; `null` khi không có phiên nào. */
export function serializeDiscussionRun(roomCode: string): PersistedDiscussionRun | null {
  const run = runs.get(roomCode);
  if (!run) return null;

  return {
    round: run.round,
    phaseEndsAt: run.phaseEndsAt,
    total: run.total,
    lastAt: run.lastAt,
    spoken: Object.fromEntries(run.spoken),
    lastSpokenAt: Object.fromEntries(run.lastSpokenAt),
    messageDepths: Object.fromEntries(run.messageDepths),
    replyCounts: Object.fromEntries(run.replyCounts),
  };
}

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

/**
 * `resumeFrom` là ảnh chụp của phiên vừa bị process chết cắt ngang. Nó chỉ được
 * dùng khi CÙNG VÒNG: một ảnh của vòng khác nói về một cuộc trò chuyện đã kết
 * thúc, và áp nó vào sẽ khoá miệng cả bàn bằng hạn mức của ngày hôm trước.
 */
export function runDiscussionScheduler(
  room: Room,
  resumeFrom?: PersistedDiscussionRun | null,
): void {
  cancelDiscussionScheduler(room.code);
  if (!room.engine || room.engine.state.phase !== "DAY_DISCUSSION") return;

  // Không có BOT thì không có việc gì để làm, và lối ra phải sạch: không đồng
  // hồ, không session, không ngoại lệ. Tám người thật ngồi với nhau là một ván
  // hợp lệ, không phải một trường hợp biên cần chống đỡ.
  const botMembers = room.members.filter((member) => member.isBot);
  if (botMembers.length === 0) return;

  const resumed = resumeFrom && resumeFrom.round === room.engine.state.round ? resumeFrom : null;

  const run: DiscussionRun = {
    cancelled: false,
    engine: room.engine,
    round: room.engine.state.round,
    phaseEndsAt: room.engine.state.phaseEndsAt,
    spoken: new Map(Object.entries(resumed?.spoken ?? {})),
    total: resumed?.total ?? 0,
    lastAt: resumed?.lastAt ?? 0,
    lastSpokenAt: new Map(Object.entries(resumed?.lastSpokenAt ?? {})),
    messageDepths: new Map(Object.entries(resumed?.messageDepths ?? {})),
    replyCounts: new Map(Object.entries(resumed?.replyCounts ?? {})),
  };
  runs.set(room.code, run);

  const session = botSessionFor(room);
  const pick = session.rngFor("__room__", `discussion:${run.round}`);
  // Đọc bảng hạn mức từ một BOT THẬT, không phải từ `members[0]`.
  //
  // `members[0]` là chủ phòng, và chủ phòng gần như luôn là người thật - nên
  // dòng cũ dựng cả một bộ não cho người không cần não, chỉ để với tới một bảng
  // hằng số. Nó cũng đổ vỡ ở một phòng không có thành viên nào.
  //
  // Đây là hạn mức của CĂN PHÒNG, và mọi BOT dùng chung một bảng; lấy ở con nào
  // cũng ra cùng một kết quả, và con này thì đằng nào cũng cần runtime.
  const weights = session.runtimeFor(botMembers[0]!.playerId).weights.conversation;

  const step = (): void => {
    if (run.cancelled || runs.get(room.code) !== run) return;

    const now = Date.now();
    const deadline = (run.phaseEndsAt ?? now) - DEADLINE_BUFFER_MS;
    if (now >= deadline) return;
    if (run.total >= weights.roomMessagesPerRound) return;

    // Ứng viên: BOT còn sống, chưa chạm hạn mức riêng. Sắp theo ID để lựa chọn
    // chỉ phụ thuộc RNG đã gieo hạt, không phụ thuộc thứ tự thành viên trong
    // phòng - thứ tự đó đổi theo ai vào phòng trước.
    const eligible = room.members
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

    // Không ai còn lượt nói trong vòng này. Đây là kết thúc THẬT: hết pha rồi
    // mới có thêm ngân sách, nên dừng hẳn hàng đợi.
    if (eligible.length === 0) return;

    const readyAt = (botId: string): number =>
      (run.lastSpokenAt.get(botId) ?? Number.NEGATIVE_INFINITY) + PER_BOT_COOLDOWN_MS;
    const candidates = eligible.filter((member) => readyAt(member.playerId) <= now);

    // Ai cũng đang trong nhịp nghỉ. KHÔNG phải lý do để dừng: chờ tới đúng lúc
    // con sớm nhất hết nghỉ rồi hỏi lại. Đợi đúng mốc chứ không thăm dò mỗi
    // giây, và không rút RNG - dòng RNG chỉ tiến khi có người thật sự nói.
    if (candidates.length === 0) {
      const wakeAt = Math.min(...eligible.map((member) => readyAt(member.playerId)));
      setRoomTimer(room.code, step, Math.max(wakeAt - now, 1));
      return;
    }

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

        // Hai trần của CHUỖI, xét TRƯỚC khi hỏi nhà cung cấp. Chúng tồn tại để
        // tiết kiệm cả sự chú ý của người chơi lẫn tiền gọi API; chặn sau khi
        // đã trả tiền viết câu thì chỉ còn tiết kiệm được một nửa. Luật lấy từ
        // `@masoi/game-engine` chứ không chép lại ở đây, nên harness self-play
        // và căn phòng thật hiểu "sâu 3" theo đúng một nghĩa.
        const position = judgeChainPosition(
          speech.replyToMessageId,
          { depthOf: run.messageDepths, repliesTo: run.replyCounts },
          weights,
        );
        if (position.blockedBy !== null) {
          // Báo cho lõi là chuyện này đã xử lý xong. Không có bước này, con BOT
          // sẽ thấy lại đúng trigger đó ở checkpoint sau và đề nghị đáp lần
          // nữa, mãi mãi.
          runtime.declineSpeech(speech);
          return;
        }

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
          // ID TẤT ĐỊNH, không phải UUID.
          //
          // Một ID ngẫu nhiên không chỉ là một cái tên: nó quay ngược vào chính
          // quyết định của BOT. `findConversationTriggers` phá hoà bằng
          // `messageId`, nên hai trigger cùng độ ưu tiên được xếp theo một con
          // số ngẫu nhiên - và cùng một ván, cùng một seed, cho ra hai cuộc hội
          // thoại khác nhau. Đó cũng là kiểu nguồn ngẫu nhiên toàn cục mà Phase
          // 1 đã bỏ công gỡ khỏi ban ngày.
          //
          // `(vòng, số thứ tự)` là đủ để duy nhất: `startGame` xoá sạch chatLog
          // và mở session mới, nên hai ván không bao giờ dùng chung một log.
          id: `bot-chat:${run.round}:${run.total}`,
          channel: resolved.channel,
          playerId: member.playerId,
          playerName: member.name,
          text: rendered.text,
          // Không hai câu nào trùng khoảnh khắc: hai BOT trả lời cùng một
          // mili giây đọc lên như một cái bot, không như hai người.
          at: Math.max(at, run.lastAt + 1),
        };
        pushChat(room, message);

        // Vào sổ SAU khi câu đã thật sự nằm trong log, không sớm hơn. Một câu
        // bị `resolveChat` chặn, hay về muộn quá hạn, mà đã kịp chiếm một suất
        // phản hồi thì nó bịt miệng người khác bằng một câu chưa ai nghe thấy.
        run.lastAt = message.at;
        run.lastSpokenAt.set(member.playerId, message.at);
        run.spoken.set(member.playerId, (run.spoken.get(member.playerId) ?? 0) + 1);
        run.total += 1;
        run.messageDepths.set(message.id, position.depth);
        if (speech.replyToMessageId !== undefined) {
          run.replyCounts.set(speech.replyToMessageId, position.parentReplies + 1);
        }

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
