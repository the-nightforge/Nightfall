import { botBudgetUsed } from "../bots";
import { serializeBotSession } from "../bots/session-registry";
import { serializeDiscussionRun } from "../game/discussion-scheduler";
import { discussionSkipVotes } from "../game/discussion-skip";
import { lastLetterStateOf } from "../game/last-letter";
import type { Room } from "../rooms/store";
import { PERSISTENCE_VERSION, type RoomEnvelopeV1 } from "./schema";

/**
 * Ảnh chụp toàn bộ một phòng, đủ để dựng lại ván ở một process khác.
 *
 * Cố ý KHÔNG có mặt ở đây:
 *
 *  - `NodeJS.Timeout`: một handle không tuần tự hoá được và cũng không có
 *    nghĩa ở process khác. Thay nó là `pendingStep.runAt`, một mốc tuyệt đối.
 *  - Kết nối voice: người chơi lấy token LiveKit mới khi nối lại, nên lưu lại
 *    chỉ tạo ra một trạng thái chắc chắn sai.
 *  - `pendingEndFinalVote`: cờ chống hẹn giờ trùng cho một timer 800ms không
 *    còn tồn tại sau restart. `false` là giá trị đúng, không phải giá trị mất.
 *
 * `opSeq` do chỗ gọi cấp: nó thuộc về THỨ TỰ GHI chứ không thuộc về nội dung
 * phòng, và compare-and-set ở tầng Redis dựa vào nó.
 */
export function serializeRoom(room: Room, opSeq: number): RoomEnvelopeV1 {
  return {
    persistenceVersion: PERSISTENCE_VERSION,
    savedAt: Date.now(),
    opSeq,
    room: {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      members: room.members.map((member) => ({ ...member })),
      config: { ...room.config },
      chatLog: room.chatLog,
      createdAt: room.createdAt,
      startedAt: room.startedAt,
      engineState: room.engine ? room.engine.getState() : null,
      gameId: room.gameId,
      resultWritten: room.resultWritten,
      pendingStep: room.pendingStep,
      phaseSeq: room.phaseSeq,
      // Session của BOT chỉ có nghĩa khi ván đang chạy; một phòng ở sảnh chờ
      // mang theo brain của ván trước sẽ hồi sinh nghi ngờ về những người đã
      // đổi vai.
      botSession: room.status === "IN_GAME" ? serializeBotSession(room.code) : null,
      governorCalls: botBudgetUsed(room.code),
      discussionSkipVotes: [...(discussionSkipVotes.get(room.code) ?? [])],
      discussionRun: serializeDiscussionRun(room.code),
      kickedPlayerIds: room.kickedPlayerIds,
      // Cả bản nháp lẫn dãy id đã mở. Bỏ bản nháp đi thì một lần khởi động lại
      // xoá lượt duy nhất của cả ván; bỏ dãy id đi thì mọi lá thư đã mở sẽ mở
      // lại lần nữa ngay khi process mới chạy hàm mở đầu tiên.
      lastLetters: lastLetterStateOf(room),
      // Sổ chat của ván. Mất nó qua một lần restart là ván đó chỉ lưu được
      // phần nói SAU khi process mới lên - tức đúng đoạn ít người đọc nhất.
      matchChat: room.matchChat,
    },
  };
}
