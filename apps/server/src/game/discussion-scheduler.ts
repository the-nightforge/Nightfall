import { SERVER_EVENTS } from "@masoi/shared";
import {
  analyzeChat,
  judgeChainPosition,
  planDefenseCommentary,
  planDefenseSpeakers,
  shouldSpeakInDefense,
  DEFENSE_MAX_SPEECHES_PER_BOT,
  type GameEngine,
} from "@masoi/game-engine";
import { buildBotDecisionContext } from "../bots/context";
import { botSessionFor } from "../bots/session-registry";
import { renderBotSpeech } from "../bots/speech-renderer";
import { emitToPlayers } from "../rooms/broadcast";
import { pushChat, resolveChat } from "../rooms/snapshot";
import { persistRoom, setRoomTimer, type Room } from "../rooms/store";
import { toSpeechRequest } from "./machine";
import { noteBotBlocked, noteBotObserved, noteBotSpeechTurn, noteBotSpoke } from "./bot-speech-log";
import type { BotSpeechIntention } from "@masoi/game-engine";
import type { SpeechRequest } from "../bots/types";

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
  /**
   * Câu của người thật đã được TRAO một lượt ưu tiên; `null` là chưa có câu nào.
   *
   * Mỗi câu chỉ mua được ĐÚNG MỘT lượt. Không có sổ này thì checkpoint kế tiếp
   * lại thấy đúng câu hỏi đó ở cuối log, lại chọn đúng con BOT vừa từ chối -
   * và một con BOT không muốn đáp sẽ khoá miệng cả bàn tới hết pha.
   *
   * KHÔNG nằm trong `PersistedDiscussionRun`: sau restart, cùng lắm một câu hỏi
   * cũ mua thêm một lượt ưu tiên nữa. Đó là một lượt nói, không phải một sai
   * lệch kế toán như `spoken` hay `total`.
   */
  aimedAt: string | null;
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

/**
 * Loại lời nói nhắm THẲNG vào một người.
 *
 * Đúng bằng `DIRECT_TRIGGERS` của lõi (`conversation/speech-planner.ts`) đọc
 * ngược về loại memory sinh ra chúng: `ACCUSE` → `ACCUSED_ME`,
 * `DIRECT_QUESTION` → `QUESTIONED_ME`, `DIRECT_ADDRESS` → `ADDRESSED_ME`,
 * `COUNTER_CLAIM` → `COUNTER_CLAIM_ON_ME`.
 *
 * Dùng chung một định nghĩa là chủ ý. Rộng hơn lõi thì scheduler trao lượt cho
 * một con BOT mà lõi không thấy có gì để đáp, và lượt đó thành lượt trống.
 */
const AIMED_AT_SOMEONE: ReadonlySet<string> = new Set([
  "ACCUSE",
  "DIRECT_QUESTION",
  "DIRECT_ADDRESS",
  "COUNTER_CLAIM",
]);

/**
 * Con BOT mà câu MỚI NHẤT của một người thật đang nhắm tới, nếu có.
 *
 * Vì sao luật này tồn tại: *ai* nói ở checkpoint kế tiếp vốn do RNG của phòng
 * chọn ĐỀU trên mọi BOT đủ điều kiện. Pha thảo luận mặc định 60 giây với nhịp
 * 2,5-6,5 giây cho khoảng 13 checkpoint chia cho cả bàn, nên một người thật gõ
 * "An ơi sao im thế" có tầm 1/n cơ hội mỗi lượt để nghe chính An trả lời - phần
 * còn lại là một con BOT khác nói chuyện khác. Lõi đã có sẵn `QUESTIONED_ME`
 * (priority 95) và một sàn xác suất trả lời riêng cho lời nhắm thẳng, nhưng nó
 * không bao giờ được hỏi tới. Đây là tầng XẾP LƯỢT, nên chỗ chữa nằm ở đây.
 *
 * Ba ràng buộc:
 *
 * - Chỉ câu của NGƯỜI THẬT. Luật này để phục vụ người chơi; cho câu của BOT
 *   kích hoạt nó thì hai con gọi tên nhau sẽ khoá lượt của cả bàn vào một cặp.
 *   Tiếng Vọng Người Chết cũng rơi vào nhánh này: `GHOST_AUTHOR_ID` không phải
 *   thành viên nào, nên `isBot` đọc ra `undefined` và câu đó không mua được gì.
 * - Chỉ câu MỚI NHẤT của kênh `day`. Nó tự giới hạn theo thời gian mà không cần
 *   một cái đồng hồ nào: BOT vừa nói xong thì câu cũ hết hiệu lực ngay.
 * - Đọc bằng chính `analyzeChat`, không tự so tên. Một luật riêng ở đây sẽ trôi
 *   lệch khỏi parser, và lúc đó scheduler trao lượt cho một con BOT mà lõi
 *   không hề thấy mình bị gọi.
 *
 * THUẦN: không rút RNG, không đụng đồng hồ.
 */
function aimedBot(
  room: Room,
  candidates: readonly Room["members"][number][],
): { messageId: string; member: Room["members"][number] } | null {
  if (!room.engine) return null;

  // `findLast` cần lib es2023; `chatLog` bị cắt ở 100 dòng nên một bản đảo
  // ngược rẻ hơn hẳn việc nới target của cả workspace vì đúng một lời gọi.
  const last = [...room.chatLog].reverse().find((message) => message.channel === "day");
  if (!last) return null;
  if (room.members.find((member) => member.playerId === last.playerId)?.isBot !== false) {
    return null;
  }

  const memories = analyzeChat(
    [{ id: last.id, actorId: last.playerId, text: last.text, at: last.at }],
    room.engine.state.players.map((player) => ({
      id: player.id,
      name: player.name,
      alive: player.alive,
    })),
  );
  const aimed = new Set(
    memories
      .filter((memory) => AIMED_AT_SOMEONE.has(memory.type) && memory.targetId !== undefined)
      .map((memory) => memory.targetId),
  );

  // `candidates` đã sắp theo id, nên một câu gọi tên hai con BOT cho ra cùng một
  // lựa chọn ở mọi lần chạy.
  const member = candidates.find((entry) => aimed.has(entry.playerId));
  return member ? { messageId: last.id, member } : null;
}

/**
 * Phần RIÊNG của một pha, cắm vào hàng đợi chung.
 *
 * Hàng đợi giữ mọi thứ về NHỊP - thứ tự tuần tự, khoảng cách, nhịp nghỉ riêng
 * mỗi bot, chừa cuối pha, dấu thời gian không trùng, trần tin cả phòng, sổ huỷ.
 * Pha chỉ nói ai được nói và nói cái gì.
 *
 * Vì sao gộp: trước đây DEFENSE có hàng đợi riêng ở `machine.ts`, và nó không
 * có MỘT thứ nào trong danh sách trên - mọi lượt được bắn ra trong cùng một
 * vòng lặp đồng bộ, nên cả bàn phát trong một mili giây, có tin trùng khít dấu
 * thời gian. Hai hàng đợi cho cùng một việc là hai chỗ sẽ trôi lệch, và đó là
 * chỗ đã trôi lệch.
 */
interface TurnPlan {
  phase: "DAY_DISCUSSION" | "DEFENSE";
  /** Tiền tố id tin nhắn; id đầy đủ là `{prefix}:{vòng}:{số thứ tự}`. */
  idPrefix: string;
  maxPerBot: number;
  maxRoom: number;
  /** Nguồn ngẫu nhiên đã gieo hạt của phòng, dùng cho khoảng cách và lựa chọn. */
  rng: () => number;
  /** Điều kiện hợp lệ RIÊNG của pha, ngoài pha/vòng/`phaseEndsAt`. */
  stillOn?: (state: GameEngine["state"]) => boolean;
  /**
   * Ai nói lượt này. `null` = hết, dừng hàng đợi.
   *
   * Được gọi MỘT lần cho mỗi lượt và có quyền tiêu suất: DEFENSE rút một ô khỏi
   * danh sách lượt ngay tại đây, nên một BOT chọn im vẫn mất suất đó thay vì
   * được hỏi lại mãi.
   */
  choose: (candidates: Room["members"], run: DiscussionRun) => Room["members"][number] | null;
  /** Nói gì. `null` = bỏ lượt này. */
  speak: (
    runtime: ReturnType<ReturnType<typeof botSessionFor>["runtimeFor"]>,
    context: ReturnType<typeof buildBotDecisionContext>,
    member: Room["members"][number],
  ) => { speech: BotSpeechIntention; defense: SpeechRequest["defense"] } | null;
}

/** Tình thế vẫn đúng như lúc lên lịch. Kiểm cả trước lẫn sau khi `await`. */
function stillValid(
  room: Room,
  run: DiscussionRun,
  botId: string,
  plan: TurnPlan,
): boolean {
  if (run.cancelled) return false;
  if (runs.get(room.code) !== run) return false;
  if (!room.engine || room.engine !== run.engine) return false;

  const state = room.engine.state;
  if (state.phase !== plan.phase) return false;
  if (state.round !== run.round) return false;
  if (state.phaseEndsAt !== run.phaseEndsAt) return false;
  if (plan.stillOn && !plan.stillOn(state)) return false;

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
/**
 * Hàng đợi lượt nói của một pha: tuần tự, có nhịp, có trần, huỷ được.
 *
 * `resumeFrom` là ảnh chụp của phiên vừa bị process chết cắt ngang. Nó chỉ được
 * dùng khi CÙNG VÒNG: một ảnh của vòng khác nói về một cuộc trò chuyện đã kết
 * thúc, và áp nó vào sẽ khoá miệng cả bàn bằng hạn mức của ngày hôm trước.
 */
function startTurnQueue(
  room: Room,
  plan: TurnPlan,
  resumeFrom?: PersistedDiscussionRun | null,
): void {
  cancelDiscussionScheduler(room.code);
  if (!room.engine || room.engine.state.phase !== plan.phase) return;
  if (plan.stillOn && !plan.stillOn(room.engine.state)) return;

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
    aimedAt: null,
  };
  runs.set(room.code, run);

  const session = botSessionFor(room);
  const weights = session.runtimeFor(botMembers[0]!.playerId).weights.conversation;

  const step = (): void => {
    if (run.cancelled || runs.get(room.code) !== run) return;

    const now = Date.now();
    const deadline = (run.phaseEndsAt ?? now) - DEADLINE_BUFFER_MS;
    if (now >= deadline) return;
    if (run.total >= plan.maxRoom) return;

    // Ứng viên: BOT còn sống, chưa chạm hạn mức riêng. Sắp theo ID để lựa chọn
    // chỉ phụ thuộc RNG đã gieo hạt, không phụ thuộc thứ tự thành viên trong
    // phòng - thứ tự đó đổi theo ai vào phòng trước.
    const eligible = room.members
      .filter((member) => member.isBot)
      .filter(
        (member) =>
          room.engine!.state.players.find((p) => p.id === member.playerId)?.alive === true,
      )
      .filter((member) => (run.spoken.get(member.playerId) ?? 0) < plan.maxPerBot)
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

    const member = plan.choose(candidates, run);
    if (member === null) return;

    const gap = MIN_GAP_MS + Math.floor(plan.rng() * JITTER_MS);

    void (async () => {
      try {
        if (!stillValid(room, run, member.playerId, plan)) return;

        const runtime = session.runtimeFor(member.playerId);
        const context = buildBotDecisionContext(room, member.playerId);
        runtime.observe(context);
        noteBotObserved(room, member.playerId, context.visibleChat, runtime.state.memories);
        // Chỉ pha thảo luận mới đếm lượt: self-play không gọi `noteSpeechTurn`
        // trong phiên xử, và hai bên phải hiểu "được lượt" theo một nghĩa.
        if (plan.phase === "DAY_DISCUSSION") noteBotSpeechTurn(room, member.playerId);

        const planned = plan.speak(runtime, context, member);
        if (!planned) return;
        const { speech, defense } = planned;

        // Hai trần của CHUỖI, xét TRƯỚC khi hỏi nhà cung cấp. Chúng tồn tại để
        // tiết kiệm cả sự chú ý của người chơi lẫn tiền gọi API; chặn sau khi
        // đã trả tiền viết câu thì chỉ còn tiết kiệm được một nửa. Luật lấy từ
        // `@masoi/game-engine` chứ không chép lại ở đây, nên harness self-play
        // và căn phòng thật hiểu "sâu 3" theo đúng một nghĩa.
        //
        // Ý định của DEFENSE không mang `replyToMessageId`, nên ở pha đó hàm
        // này luôn trả về gốc và không chặn gì - chạy vô điều kiện rẻ hơn một
        // nhánh `if` theo pha, và sẽ tự đúng nếu sau này lời bào chữa biết trả
        // lời một câu cụ thể.
        const position = judgeChainPosition(
          speech.replyToMessageId,
          { depthOf: run.messageDepths, repliesTo: run.replyCounts },
          weights,
        );
        if (position.blockedBy !== null) {
          // Báo cho lõi là chuyện này đã xử lý xong. Không có bước này, con BOT
          // sẽ thấy lại đúng trigger đó ở checkpoint sau và đề nghị đáp lần
          // nữa, mãi mãi.
          noteBotBlocked(room, member.playerId, run.round, speech, position.blockedBy);
          runtime.declineSpeech(speech);
          return;
        }

        const rendered = await renderBotSpeech({
          ...toSpeechRequest(room, member, context, speech),
          defense,
        });

        // Kiểm LẠI sau khi await: nhà cung cấp có thể mất vài giây, và trong
        // khoảng đó pha có thể đã đổi hoặc BOT có thể đã chết.
        if (!stillValid(room, run, member.playerId, plan)) return;
        if (!rendered.text) return;

        const at = Date.now();
        if (at >= (run.phaseEndsAt ?? at) - DEADLINE_BUFFER_MS) return;

        const resolved = resolveChat(room, member.playerId);
        // Vẫn đi qua `resolveChat`, nên `SILENT_NIGHT`, luật kênh và luật bào
        // chữa được tôn trọng mà không phải chép lại ở đây. Kênh `day` là kênh
        // DUY NHẤT hợp lệ cho cả hai pha: người còn sống ở DAY_DISCUSSION và ở
        // DEFENSE đều rơi vào cùng một nhánh của `resolveChat`, và mọi kênh
        // khác nghĩa là tình thế đã đổi.
        if (!resolved.ok || resolved.channel !== "day") return;

        const message = {
          // ID TẤT ĐỊNH, không phải UUID.
          //
          // Một ID ngẫu nhiên không chỉ là một cái tên: nó quay ngược vào chính
          // quyết định của BOT. `findConversationTriggers` phá hoà bằng
          // `messageId`, nên hai trigger cùng độ ưu tiên được xếp theo một con
          // số ngẫu nhiên - và cùng một ván, cùng một seed, cho ra hai cuộc hội
          // thoại khác nhau. Đó cũng là kiểu nguồn ngẫu nhiên toàn cục mà Phase
          // 1 đã bỏ công gỡ khỏi ban ngày. Lượt bào chữa TỪNG dùng `newId()`,
          // tức đúng thứ đó, ở đường riêng cũ trong `machine.ts`.
          //
          // `(vòng, số thứ tự)` là đủ để duy nhất: `startGame` xoá sạch chatLog
          // và mở session mới, nên hai ván không bao giờ dùng chung một log.
          // Tiền tố tách hai pha ra, để một phiên xử không sinh trùng id với
          // phiên thảo luận cùng vòng.
          id: `${plan.idPrefix}:${run.round}:${run.total}`,
          channel: resolved.channel,
          playerId: member.playerId,
          playerName: member.name,
          text: rendered.text,
          // Không hai câu nào trùng khoảnh khắc: hai BOT trả lời cùng một
          // mili giây đọc lên như một cái bot, không như hai người.
          at: Math.max(at, run.lastAt + 1),
        };
        pushChat(room, message);
        noteBotSpoke(room, {
          botId: member.playerId,
          round: run.round,
          messageId: message.id,
          text: rendered.text,
          speech,
          chainDepth: position.depth,
          fromTemplate: rendered.fromTemplate,
        });

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

/** Pha thảo luận ban ngày. */
export function runDiscussionScheduler(
  room: Room,
  resumeFrom?: PersistedDiscussionRun | null,
): void {
  if (!room.engine || room.engine.state.phase !== "DAY_DISCUSSION") return;

  const botMembers = room.members.filter((member) => member.isBot);
  if (botMembers.length === 0) return;

  const session = botSessionFor(room);
  // Đọc bảng hạn mức từ một BOT THẬT, không phải từ `members[0]`.
  //
  // `members[0]` là chủ phòng, và chủ phòng gần như luôn là người thật - nên
  // dòng cũ dựng cả một bộ não cho người không cần não, chỉ để với tới một bảng
  // hằng số. Nó cũng đổ vỡ ở một phòng không có thành viên nào.
  const weights = session.runtimeFor(botMembers[0]!.playerId).weights.conversation;
  const pick = session.rngFor("__room__", `discussion:${room.engine.state.round}`);

  startTurnQueue(
    room,
    {
      phase: "DAY_DISCUSSION",
      idPrefix: "bot-chat",
      maxPerBot: weights.messagesPerBotPerRound,
      maxRoom: weights.roomMessagesPerRound,
      rng: pick,
      choose: (candidates, run) => {
        // RNG chứ không phải xoay vòng: xoay vòng cho ra đúng một thứ tự nói
        // mỗi ngày, và "các BOT nghe giống nhau" chính là thứ Phase 4 phải chữa.
        const random = candidates[Math.floor(pick() * candidates.length)]!;

        // Người thật vừa gọi đích danh một con BOT thì con đó nói, không phải
        // con mà may rủi chỉ vào.
        //
        // `pick()` ở trên vẫn được TIÊU dù kết quả có bị ghi đè hay không: dòng
        // RNG của phòng vì thế không lệch một bit nào khi luật này không nổ.
        //
        // Ghi sổ cả khi rơi về `random`: câu đó đã có lượt của nó rồi.
        const aimed = aimedBot(room, candidates);
        const chosen =
          aimed !== null && aimed.messageId !== run.aimedAt ? aimed.member : random;
        if (aimed !== null) run.aimedAt = aimed.messageId;
        return chosen;
      },
      speak: (runtime, context) => {
        // Lá phiếu do lõi chốt TRƯỚC khi hỏi nhà cung cấp, và KHÔNG được nộp ở
        // đây: pha bỏ phiếu sẽ hỏi lại chính lõi này với ngữ cảnh mới nhất. Một
        // phiếu đóng băng từ lúc thảo luận là phiếu bỏ qua mọi thứ xảy ra sau.
        const vote = runtime.decideVote(context);
        const speech = runtime.decideSpeech(context, vote);
        return speech ? { speech, defense: null } : null;
      },
    },
    resumeFrom,
  );
}

/**
 * Phiên xử: bị cáo tự bào chữa, cả bàn bàn về bị cáo.
 *
 * Trước khi gộp, pha này có hàng đợi RIÊNG trong `machine.ts` và nó không có
 * một thứ nào của hàng đợi trên: mọi lượt được bắn ra trong cùng một vòng lặp
 * đồng bộ, không hẹn giờ. Đo được trên đường thật: cả bàn phát trong **1 mili
 * giây**, có hai cặp cách nhau 0ms và có tin trùng khít dấu thời gian - đúng
 * thứ mà chú thích `at: Math.max(at, run.lastAt + 1)` nói là "đọc lên như một
 * cái bot, không như hai người".
 *
 * Gộp vào đây thì phiên xử được thừa hưởng nguyên bộ: tuần tự, khoảng cách
 * 2,5-6,5 giây, nhịp nghỉ riêng mỗi bot, chừa cuối pha, dấu thời gian không
 * trùng, id tất định, và sổ huỷ dùng chung với `cancelDiscussionScheduler`.
 *
 * Hệ quả phải biết trước: pha xử dài 25 giây, nên có nhịp nghĩa là **ít tin
 * hơn** - khoảng 4-6 câu thay vì "mọi bot × 2 lượt". Đó là ý muốn, không phải
 * tác dụng phụ; một phiên xử mà cả bàn nói xong trong một khoảnh khắc thì
 * người thật không đọc kịp một dòng nào.
 */
export function runDefenseScheduler(room: Room, accusedId: string): void {
  if (!room.engine || room.engine.state.phase !== "DEFENSE") return;

  const botMembers = room.members.filter((member) => member.isBot);
  if (botMembers.length === 0) return;

  const aliveBotIds = botMembers
    .filter(
      (member) =>
        room.engine!.state.players.find((p) => p.id === member.playerId)?.alive === true,
    )
    .map((member) => member.playerId);
  if (aliveBotIds.length === 0) return;

  const session = botSessionFor(room);
  const orderRng = session.rngFor("__room__", `defense:${room.engine.state.round}`);
  const slots = planDefenseSpeakers(
    aliveBotIds,
    accusedId,
    orderRng,
    DEFENSE_MAX_SPEECHES_PER_BOT,
  );

  /**
   * Bị cáo nói TRƯỚC.
   *
   * `planDefenseSpeakers` cố ý không bảo đảm điều này ("bị cáo luôn có suất
   * nhưng KHÔNG nhất thiết đầu tiên"), và trước khi gộp thì không sao: không
   * có nhịp nên mọi suất đều được dùng hết. Có nhịp rồi thì thứ tự thành thứ
   * quyết định ai kịp nói trước khi hết 25 giây - và một phiên xử mà bị cáo
   * không kịp mở miệng là hỏng luật chơi, không phải hỏng nhịp.
   *
   * Đổi ở ĐÂY chứ không trong `planDefenseSpeakers`: hàm đó dùng chung với
   * harness self-play, và sửa nó sẽ dịch mọi số đo đã có.
   */
  const first = slots.indexOf(accusedId);
  if (first > 0) {
    slots.splice(first, 1);
    slots.unshift(accusedId);
  }

  startTurnQueue(room, {
    phase: "DEFENSE",
    idPrefix: "defense-chat",
    maxPerBot: DEFENSE_MAX_SPEECHES_PER_BOT,
    maxRoom: slots.length,
    rng: orderRng,
    // Phiên xử khác đổi bị cáo giữa chừng là một phiên xử khác.
    stillOn: (state) => state.trial?.accusedId === accusedId,
    choose: (candidates) => {
      /*
       * Ô đầu tiên còn dùng được, và TIÊU nó ngay tại đây.
       *
       * Tiêu lúc chọn chứ không lúc phát: một BOT chưa đủ tin sẽ im
       * (`shouldSpeakInDefense`), và nếu ô của nó vẫn còn thì hàng đợi hỏi lại
       * đúng con đó ở mốc sau, mãi mãi - cùng cái bẫy mà `run.aimedAt` chữa
       * cho đường ban ngày.
       *
       * Chỉ tiêu ô ĐƯỢC CHỌN, không tiêu những ô bị bỏ qua: một BOT đang trong
       * nhịp nghỉ không có mặt trong `candidates`, và nó vẫn phải giữ suất của
       * mình cho mốc sau.
       */
      const index = slots.findIndex((id) =>
        candidates.some((member) => member.playerId === id),
      );
      if (index < 0) return null;
      const speakerId = slots.splice(index, 1)[0]!;
      return candidates.find((member) => member.playerId === speakerId) ?? null;
    },
    speak: (runtime, context, member) => {
      const isAccused = member.playerId === accusedId;
      const isJester = context.knowledge.selfRole === "JESTER";

      if (isAccused || isJester) {
        /*
         * TOÀN BỘ lượt bào chữa do lõi quyết, kể cả đường lui.
         *
         * (Giữ nguyên chú thích cũ: đường lui DISAGREE cứng từng nằm ở tầng IO
         * và dựng mọi bị cáo thành người muốn sống, kể cả Thằng Hề. Giờ nó sống
         * trong lõi nên Hề giữ đúng thái độ INDIFFERENT/HUMOR.)
         *
         * `stance` đi cùng ý định và được chuyển thẳng xuống prompt: tầng diễn
         * đạt không được phép tự đoán bị cáo này muốn gì.
         */
        const decided = runtime.decideDefense(context);

        // Số phiếu và danh sách đồng-bị-nhắm đã công khai ở pha DEFENSE - khác
        // hẳn vai thật, thứ `roleContext` từng đưa vào prompt và đã bị bỏ hẳn.
        const votesAgainstMe =
          context.knowledge.currentVoteCounts.players[member.playerId] ?? 0;
        const alsoAccused = context.knowledge.players
          .filter(
            (p) =>
              p.alive &&
              p.id !== member.playerId &&
              (context.knowledge.currentVoteCounts.players[p.id] ?? 0) > 0,
          )
          .map((p) => p.name);

        return {
          speech: decided.intention,
          defense: { votesAgainstMe, alsoAccused, stance: decided.stance },
        };
      }

      // Bot phi-bị-cáo: bàn theo đúng phán quyết sắp bỏ; chưa đủ tin thì im.
      const verdict = runtime.decideFinalVote(context);
      if (!shouldSpeakInDefense(verdict.confidence)) return null;

      return {
        speech: planDefenseCommentary({
          context,
          guilty: verdict.guilty,
          accusedId,
          confidence: verdict.confidence,
          evidence: verdict.evidence,
          style: runtime.style,
        }),
        defense: null,
      };
    },
  });
}
