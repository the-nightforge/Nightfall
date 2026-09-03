import { prisma } from "./db";
import { sha256 } from "./util";
import type { Socket, Server as SocketServer } from "socket.io";
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  socketAuthSchema,
  chatSendPayload,
  voiceTokenPayload,
  voiceReadyPayload,
  createRoomPayload,
  joinRoomPayload,
  kickPayload,
  setReadyPayload,
  updateConfigPayload,
  startGamePayload,
  resetGamePayload,
  gameActionPayload,
  votePayload,
  finalVotePayload,
  skipDiscussionPayload,
  addBotPayload,
  hunterShotPayload,
  dayOfTruthClaimPayload,
  deadMessagePayload,
  lastLetterSetPayload,
  updateAvatarPayload,
} from "@masoi/shared";
import { config } from "./config";
import { GameError } from "@masoi/game-engine";
import { roomService, RoomError, scheduleAbandonedRoomCheck } from "./rooms/service";
import { getRoomSyncByPlayer } from "./rooms/index-helpers";
import { getRoom, persistRoom } from "./rooms/store";
import { loadAndResumeRoom } from "./rooms/load";
import {
  trackSocket,
  untrackSocket,
  broadcastRoom,
  broadcastToPlayer,
  hasConnection,
} from "./rooms/broadcast";
import {
  maybeEndFinalVoteEarly,
  maybeEndWitchWindow,
  maybeLockWolvesEarly,
  scheduleDiscussionSkipRecheck,
  submitDiscussionSkip,
  submitGhostMessage,
  submitHunterShot,
} from "./game/machine";
import { submitLastLetter } from "./game/last-letter";
import { getPlayerRoom, updateSessionRoom } from "./redis";
import { reconnectPlayer } from "./rooms/reconnect";
import { allowAction } from "./rate-limit";
import { issueVoiceToken, syncVoiceForPlayer } from "./voice/service";
import { clearAvatar } from "./avatar/service";

interface AuthedSocket extends Socket {
  data: { playerId: string };
}

/**
 * Tách khỏi setupSocket để test được: handleError vốn là closure cục bộ trong
 * io.on("connection", ...), không có cách nào import thẳng vào test.
 *
 * ZodError nghĩa là payload không khớp schema hiện tại - client cũ đã cache
 * trên Vercel còn gửi hình dạng payload cũ (ví dụ room:update-avatar kèm một
 * chuỗi base64, từ trước khi schema bị siết lại chỉ còn nhận payload rỗng) là
 * đường THẬT dẫn tới đây, không phải lỗi lập trình. "Có lỗi xảy ra, vui lòng
 * thử lại" đúng nhưng vô dụng ở đây: bấm lại gửi lại đúng payload cũ đó, lỗi
 * lặp lại y hệt. Chỉ có tải lại trang (lấy bundle mới, đi cùng schema mới) mới
 * sửa được, nên nói thẳng điều đó thay vì câu chung chung.
 *
 * Nhận diện bằng err.name === "ZodError" thay vì instanceof ZodError: schema
 * (updateAvatarPayload,...) đến từ @masoi/shared, biên dịch/đóng gói riêng
 * với server - "zod" có bản build ESM (index.js) và CJS (index.cjs) tách
 * biệt, và tuỳ đường mỗi phía nạp module (import so với require) mà instanceof
 * xuyên hai bản build đó có thể sai dù cùng một package.json version. `name`
 * là chuỗi ổn định do chính lớp ZodError tự gán, không phụ thuộc identity của
 * class.
 */
export function socketErrorMessage(err: unknown): string {
  if (err instanceof RoomError || err instanceof GameError) return err.message;
  if (err instanceof Error && err.name === "ZodError") {
    return "Phiên bản trang đã cũ, hãy tải lại trang rồi thử lại";
  }
  return "Có lỗi xảy ra, vui lòng thử lại";
}

/** Dòng log cho một lỗi socket KHÔNG lường trước. */
export interface SocketErrorLogLine {
  event: "socket.unexpected-error";
  socketEvent: string;
  playerId: string;
  name: string;
  message: string;
  stack: string;
}

/** Cắt ngắn thông điệp của thư viện bên thứ ba trước khi cho vào log. */
const MAX_LOGGED_MESSAGE = 300;

/**
 * Lỗi này có đáng ghi lại không, và ghi lại thì ghi gì.
 *
 * Ba lối ra của `socketErrorMessage` ở trên KHÔNG cùng một loại sự việc, mà
 * cho tới nay cả ba đều im lặng như nhau:
 *
 *  - `RoomError`/`GameError` là LUẬT CHƠI. "Phòng đã đầy" xảy ra hàng trăm lần
 *    mỗi ngày và là hành vi đúng; ghi lại là tự dìm chết log của mình.
 *  - `ZodError` là CLIENT CŨ còn cache trên Vercel gửi hình dạng payload cũ -
 *    khó chịu nhưng không phải bug của bản đang chạy.
 *  - Nhánh cuối là LỖI LẬP TRÌNH. Một `TypeError` trong `submitNightAction` đi
 *    qua đây, hoá thành "Có lỗi xảy ra, vui lòng thử lại" gửi cho người chơi,
 *    rồi biến mất. Nói cách khác, đúng loại lỗi cần biết nhất lại là loại duy
 *    nhất không để lại dấu vết nào.
 *
 * Trả về DỮ LIỆU chứ không tự gọi `console.error`: như vậy test khẳng định
 * được cái gì bị ghi và cái gì không, mà không phải rình một hàm toàn cục.
 *
 * Chỉ nhận `socketEvent` và `playerId` - KHÔNG nhận payload. Đó là lý do chat,
 * token và prompt AI không có đường nào lọt vào log: chúng không được truyền
 * vào đây ngay từ chữ ký hàm. `message` là trường duy nhất có thể mang chữ từ
 * một thư viện bên dưới, nên nó bị cắt ngắn.
 */
export function socketErrorLog(
  socketEvent: string,
  playerId: string,
  err: unknown,
): SocketErrorLogLine | null {
  if (err instanceof RoomError || err instanceof GameError) return null;
  if (err instanceof Error && err.name === "ZodError") return null;

  const isError = err instanceof Error;
  return {
    event: "socket.unexpected-error",
    socketEvent,
    playerId,
    name: isError ? err.name : "UnknownThrown",
    message: (isError ? err.message : String(err)).slice(0, MAX_LOGGED_MESSAGE),
    stack: isError ? err.stack ?? "" : "",
  };
}

export function setupSocket(io: SocketServer): void {
  // Xác thực ngay khi kết nối: playerId + token từ localStorage client
  io.use(async (socket, next) => {
    const parsed = socketAuthSchema.safeParse(socket.handshake.auth ?? {});
    if (!parsed.success) {
      next(new Error("Thiếu thông tin xác thực"));
      return;
    }
    try {
      const tokenHash = sha256(parsed.data.token);
      const player = await prisma.player.findUnique({ where: { tokenHash } });
      if (!player || player.id !== parsed.data.playerId) {
        next(new Error("Phiên đăng nhập không hợp lệ"));
        return;
      }
      (socket as AuthedSocket).data.playerId = player.id;
      /*
       * `lastSeenAt` tồn tại từ đầu nhưng chưa từng được ghi, nên nó luôn bằng
       * `createdAt` và không trả lời được câu hỏi duy nhất nó sinh ra để trả
       * lời: tài khoản khách nào đã bỏ đi và dọn được.
       *
       * Đặt ở đây vì bắt tay socket là chỗ DUY NHẤT mọi phiên đều đi qua.
       * Không await: một lần ghi chậm không được làm chậm bắt tay, và mất một
       * lần cập nhật thì lần kết nối sau ghi đè lại.
       */
      void prisma.player
        .update({ where: { id: player.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
      next();
    } catch {
      next(new Error("Lỗi xác thực"));
    }
  });

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as AuthedSocket;
    const playerId = socket.data.playerId;

    trackSocket(playerId, socket);

    const handleError = (err: unknown, socketEvent: string): void => {
      const line = socketErrorLog(socketEvent, playerId, err);
      if (line) console.error(JSON.stringify(line));
      socket.emit(SERVER_EVENTS.ERROR, { message: socketErrorMessage(err) });
    };

    // Tự động rejo vào phòng cũ nếu còn session
    (async () => {
      const outcome = await reconnectPlayer(playerId, {
        findCachedRoom: (id) => {
          const roomCode = getRoomSyncByPlayer(id);
          return roomCode ? getRoom(roomCode) : undefined;
        },
        getPersistedRoomCode: getPlayerRoom,
        loadRoom: loadAndResumeRoom,
        clearPersistedRoom: (id) => updateSessionRoom(id, null),
        saveRoom: persistRoom,
      });

      if (outcome.status === "joined") {
        await socket.join(outcome.room.code);
        broadcastRoom(outcome.room.code);
        return;
      }

      // Hai trường hợp dưới đây phải NÓI ra. Im lặng thả người chơi về màn hình
      // trống là để họ tự đoán mình có còn ván hay không.
      if (outcome.status === "unavailable") {
        socket.emit(SERVER_EVENTS.ERROR, {
          message: "Máy chủ chưa đọc được dữ liệu phòng, thử tải lại sau ít giây",
        });
      } else if (outcome.status === "corrupt") {
        socket.emit(SERVER_EVENTS.ERROR, {
          message: "Ván trước không khôi phục được sau khi máy chủ khởi động lại",
        });
      }
    })().catch(() => undefined);

    const handler = (event: string, fn: (payload: unknown) => Promise<void> | void) => {
      socket.on(event, async (payload: unknown) => {
        try {
          await fn(payload);
        } catch (err) {
          handleError(err, event);
        }
      });
    };

    handler(CLIENT_EVENTS.ROOM_CREATE, async () => {
      createRoomPayload.parse({});
      if (!allowAction(`create:${playerId}`, 3, 10_000)) throw new RoomError("Thao tác quá nhanh");
      const player = await prisma.player.findUnique({ where: { id: playerId } });
      if (!player) throw new RoomError("Không tìm thấy người chơi");
      const room = await roomService.create(playerId, player.nickname);
      await socket.join(room.code);
    });

    handler(CLIENT_EVENTS.ROOM_JOIN, async (payload) => {
      const { code } = joinRoomPayload.parse(payload);
      if (!allowAction(`join:${playerId}`, 5, 10_000)) throw new RoomError("Thao tác quá nhanh");
      const player = await prisma.player.findUnique({ where: { id: playerId } });
      if (!player) throw new RoomError("Không tìm thấy người chơi");
      const room = await roomService.join(playerId, player.nickname, code);
      await socket.join(room.code);
    });

    handler(CLIENT_EVENTS.ROOM_LEAVE, async () => {
      await socket.leave(getRoomSyncByPlayer(playerId) ?? "");
      await roomService.leave(playerId);
    });

    handler(CLIENT_EVENTS.ROOM_SET_READY, async (payload) => {
      const { ready } = setReadyPayload.parse(payload);
      /*
       * NGƯỠNG DƯỚI ĐÂY LÀ ƯỚC LƯỢNG, chưa phải số đo.
       *
       * Đặt đủ rộng để không chạm thao tác của người chơi thật, đủ hẹp để một
       * vòng lặp emit không nhân tải lên theo số thành viên. Chốt lại bằng log
       * thật hoặc một vòng test tải rồi sửa ở đây - đừng coi chúng là đã xác nhận.
       */
      if (!allowAction(`ready:${playerId}`, 10, 3_000)) throw new RoomError("Thao tác quá nhanh");
      roomService.setReady(playerId, ready);
    });

    handler(CLIENT_EVENTS.ROOM_KICK, async (payload) => {
      const { targetId } = kickPayload.parse(payload);
      if (!allowAction(`kick:${playerId}`, 5, 10_000)) throw new RoomError("Thao tác quá nhanh");
      await roomService.kick(playerId, targetId);
    });

    handler(CLIENT_EVENTS.ROOM_UPDATE_CONFIG, async (payload) => {
      const { config: cfg } = updateConfigPayload.parse(payload);
      if (!allowAction(`config:${playerId}`, 10, 3_000)) throw new RoomError("Thao tác quá nhanh");
      roomService.updateConfig(playerId, cfg);
    });

    /*
     * Chỉ còn đường XOÁ. Ảnh đi lên qua PUT /api/players/me/avatar, nơi có
     * kiểm magic bytes và xử lý ảnh - gửi vài MB base64 qua socket thì snapshot
     * của cả phòng phình theo, đó chính là lỗi mà endpoint kia sinh ra để sửa.
     * Giữ sự kiện lại vì client cũ đã cache trên Vercel vẫn phải bấm Xóa được.
     */
    handler(CLIENT_EVENTS.ROOM_UPDATE_AVATAR, async (payload) => {
      updateAvatarPayload.parse(payload);
      // Cùng rổ `avatar:${playerId}` với PUT/DELETE /api/players/me/avatar
      // (xem routes.ts) - cửa sổ PHẢI khớp 60_000ms, không phải 10_000ms:
      // allowAction lọc theo cửa sổ truyền vào lúc GỌI, nên một cửa sổ ngắn
      // hơn ở đây cho phép khoảng 30 lượt clearAvatar/phút qua socket trong
      // khi đường HTTP chỉ cho 5 lượt/phút cho đúng việc đó.
      if (!allowAction(`avatar:${playerId}`, 5, 60_000)) throw new RoomError("Thao tác quá nhanh");
      await clearAvatar(playerId);
    });

    handler(CLIENT_EVENTS.ROOM_ADD_BOT, async (payload) => {
      addBotPayload.parse(payload);
      if (!allowAction(`add-bot:${playerId}`, 10, 5_000)) throw new RoomError("Thao tác quá nhanh");
      roomService.addBot(playerId);
    });

    handler(CLIENT_EVENTS.ROOM_START, async (payload) => {
      startGamePayload.parse(payload);
      if (!allowAction(`start:${playerId}`, 5, 10_000)) throw new RoomError("Thao tác quá nhanh");
      roomService.start(playerId);
    });

    handler(CLIENT_EVENTS.ROOM_RESET, async (payload) => {
      resetGamePayload.parse(payload);
      if (!allowAction(`reset:${playerId}`, 5, 10_000)) throw new RoomError("Thao tác quá nhanh");
      roomService.reset(playerId);
    });

    handler(CLIENT_EVENTS.GAME_ACTION, async (payload) => {
      const parsed = gameActionPayload.parse(payload);
      if (!allowAction(`act:${playerId}`, 15, 3_000)) throw new RoomError("Thao tác quá nhanh");
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");

      const primaryTarget = parsed.targetId ?? parsed.targetId1 ?? null;
      const secondaryTarget = parsed.targetId2 ?? null;

      room.engine.submitNightAction(
        playerId,
        parsed.type,
        primaryTarget,
        secondaryTarget,
      );
      // Sau `submitNightAction`, nên một lượt bị từ chối đã ném ra trước khi
      // tới đây. Hai hàm phủ hai chặng của đêm và loại trừ nhau qua
      // `wolvesLocked`.
      maybeLockWolvesEarly(room);
      maybeEndWitchWindow(room);
      broadcastRoom(roomCode);
      void persistRoom(room);
    });

    handler(CLIENT_EVENTS.GAME_VOTE, async (payload) => {
      const { targetId } = votePayload.parse(payload);
      if (!allowAction(`vote:${playerId}`, 10, 3_000)) throw new RoomError("Thao tác quá nhanh");
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");

      room.engine.submitVote(playerId, targetId);
      broadcastRoom(roomCode);
      void persistRoom(room);
    });

    handler(CLIENT_EVENTS.GAME_FINAL_VOTE, async (payload) => {
      const { guilty } = finalVotePayload.parse(payload);
      if (!allowAction(`final-vote:${playerId}`, 10, 3_000)) throw new RoomError("Thao tác quá nhanh");
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");

      room.engine.submitFinalVote(playerId, guilty);
      maybeEndFinalVoteEarly(room);
      broadcastRoom(roomCode);
      void persistRoom(room);
    });

    handler(CLIENT_EVENTS.GAME_SKIP_DISCUSSION, async (payload) => {
      const { skip } = skipDiscussionPayload.parse(payload);
      if (!allowAction(`skip-discussion:${playerId}`, 10, 3_000)) {
        throw new RoomError("Thao tác quá nhanh");
      }
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");

      const error = submitDiscussionSkip(room, playerId, skip);
      if (error) throw new RoomError(error);
    });

    handler(CLIENT_EVENTS.GAME_HUNTER_SHOT, async (payload) => {
      const { targetId } = hunterShotPayload.parse(payload);
      if (!allowAction(`hunter-shot:${playerId}`, 3, 3_000)) {
        throw new RoomError("Thao tác quá nhanh");
      }
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");

      submitHunterShot(room, playerId, targetId);
    });

    handler(CLIENT_EVENTS.GAME_DAY_OF_TRUTH_CLAIM, async (payload) => {
      const { role } = dayOfTruthClaimPayload.parse(payload);
      if (!allowAction(`day-of-truth:${playerId}`, 5, 3_000)) throw new RoomError("Thao tác quá nhanh");
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");
      room.engine.submitDayOfTruthClaim(playerId, role);
      broadcastRoom(roomCode);
      void persistRoom(room);
    });

    handler(CLIENT_EVENTS.GAME_DEAD_MESSAGE, async (payload) => {
      const { text } = deadMessagePayload.parse(payload);
      if (!allowAction(`dead-message:${playerId}`, 3, 3_000)) throw new RoomError("Thao tác quá nhanh");
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");
      // Cùng hàm mà BOT dùng: hai đường riêng sẽ trôi lệch, và ở đây trôi lệch
      // nghĩa là một cú lộ danh tính.
      submitGhostMessage(room, playerId, text);
    });

    /**
     * Lưu hoặc xoá Phong thư sau cùng.
     *
     * Payload mang ĐÚNG một trường `text`, và `null` là lệnh xoá. Không có
     * `round`, không có `playerId`, không có cờ "tôi còn sống": mọi thứ đó server
     * tự đọc từ `room`/`engine`, vì đó chính là những thứ mà một client sửa đổi
     * sẽ dùng để viết thư sau khi đã chết hoặc ngoài pha thảo luận.
     *
     * Chỉ đẩy snapshot cho CHÍNH người gửi. Không ai khác có gì thay đổi để
     * xem, và nội dung thư thì không được rời khỏi snapshot của chủ nhân.
     */
    handler(CLIENT_EVENTS.GAME_LAST_LETTER_SET, async (payload) => {
      const { text } = lastLetterSetPayload.parse(payload);
      // Rộng hơn `dead-message` (lượt duy nhất cả ván) và hẹp hơn chat: một
      // người sửa đi sửa lại thư trong một ngày là chuyện thường, nhưng mỗi lần
      // lưu vẫn là một lượt ghi Redis.
      if (!allowAction(`last-letter:${playerId}`, 6, 5_000)) {
        throw new RoomError("Thao tác quá nhanh");
      }
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");

      const error = submitLastLetter(room, playerId, text);
      if (error) throw new RoomError(error);

      broadcastToPlayer(roomCode, playerId);
      void persistRoom(room);
    });

    handler(CLIENT_EVENTS.CHAT_SEND, async (payload) => {
      const { text } = chatSendPayload.parse(payload);
      if (text.length > config.chatMaxLength) throw new RoomError("Tin nhắn quá dài");
      if (!allowAction(`chat:${playerId}`, config.chatRateLimitCount, config.chatRateLimitWindowMs)) {
        throw new RoomError("Bạn gửi tin nhắn quá nhanh, hãy chậm lại");
      }
      roomService.chat(playerId, text);
    });

    handler(CLIENT_EVENTS.VOICE_TOKEN, async (payload) => {
      voiceTokenPayload.parse(payload ?? {});
      if (!allowAction(`voice:${playerId}`, 5, 10_000)) {
        throw new RoomError("Thao tác quá nhanh");
      }
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room) throw new RoomError("Bạn chưa vào phòng nào");

      const result = await issueVoiceToken(room, playerId);
      if (!result.ok) throw new RoomError(result.error);
      socket.emit(SERVER_EVENTS.VOICE_TOKEN, {
        url: result.url,
        token: result.token,
        roomName: result.roomName,
      });
    });

    /**
     * Client báo đã vào room LiveKit xong.
     *
     * Bắt buộc phải có: token không mang quyền nói, nên nếu chỉ đồng bộ lúc
     * chuyển pha thì người bật mic giữa pha sẽ ngồi câm tới lần chuyển pha kế
     * tiếp - có thể là ba phút.
     */
    handler(CLIENT_EVENTS.VOICE_READY, async (payload) => {
      voiceReadyPayload.parse(payload ?? {});
      // Đường tra cứu ASYNC, không phải bản sync.
      //
      // Sự kiện này hay tới ngay sau khi socket nối lại, mà ngay sau một lần
      // server khởi động lại thì chưa phòng nào nằm trong RAM - bản sync trả
      // null và ta lặng lẽ bỏ qua, để người chơi kẹt vĩnh viễn ở quyền của
      // trước lúc restart. Bản async biết nạp lại phòng từ Redis.
      const roomCode = await roomService.findRoomOf(playerId);
      if (!roomCode) return;
      const room = getRoom(roomCode);
      // Client nói dối cũng vô hại: quyền vẫn do server tự tính từ pha và trạng
      // thái sống/chết, việc này chỉ nói "tôi đã ở trong room, hãy tính cho tôi".
      if (room) await syncVoiceForPlayer(room, playerId);
    });

    socket.on("disconnect", () => {
      untrackSocket(playerId, socket);
      const roomCode = getRoomSyncByPlayer(playerId);
      if (roomCode) {
        const room = getRoom(roomCode);
        const member = room?.members.find((m) => m.playerId === playerId);
        if (member) {
          // Một người có thể mở nhiều tab; chỉ coi là rớt khi không còn socket nào.
          member.connected = hasConnection(playerId);
          member.disconnectedAt = member.connected ? null : Date.now();
          if (room && !member.connected) {
            scheduleDiscussionSkipRecheck(room);
            scheduleAbandonedRoomCheck(room);
          }
        }
        broadcastRoom(roomCode);
      }
    });
  });
}
