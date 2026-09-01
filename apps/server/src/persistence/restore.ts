import { GameEngine } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";
import { restoreBotBudget } from "../bots";
import { clearBotSession, restoreBotSession } from "../bots/session-registry";
import { clearDiscussionSkipVotes, discussionSkipVotes } from "../game/discussion-skip";
import type { Room } from "../rooms/store";
import type { RoomEnvelopeV1 } from "./schema";

/**
 * Cấu hình của phòng lưu trước khi một tuỳ chọn ra đời sẽ thiếu hẳn khoá của
 * tuỳ chọn đó. Mặc định an toàn là "role tắt, mốc thời gian lấy giá trị chuẩn":
 * một ván cũ không bao giờ tự dưng mọc thêm vai khi được nạp lại, và
 * `roomConfigSchema` là `.strict()` nên thiếu trường sẽ làm lần cập nhật cấu
 * hình kế tiếp hỏng.
 */
function normalizeConfig(stored: RoomConfig): RoomConfig {
  return {
    ...stored,
    hunter: stored.hunter ?? false,
    cursed: stored.cursed ?? false,
    defenseSeconds: stored.defenseSeconds ?? DEFAULT_ROOM_CONFIG.defenseSeconds,
    finalVoteSeconds: stored.finalVoteSeconds ?? DEFAULT_ROOM_CONFIG.finalVoteSeconds,
  };
}

/**
 * Dựng lại phòng trong RAM từ một envelope ĐÃ QUA VALIDATION.
 *
 * Hàm này chỉ dựng state; nó KHÔNG hẹn giờ và không chạy bước nào. Việc đó là
 * của `resumeRoom`, tách ra vì hai lý do: dựng state là thuần và test được mà
 * không cần đồng hồ, còn resume thì phải quyết định về thời gian - và đó là
 * chỗ duy nhất được phép chạy một bước chuyển pha.
 */
export function restoreRoomFromEnvelope(envelope: RoomEnvelopeV1): Room {
  const data = envelope.room;
  const config = normalizeConfig(data.config);

  const room: Room = {
    code: data.code,
    hostId: data.hostId,
    status: data.status,
    // Sau khi process khởi động lại thì chưa ai kịp nối lại: cho tất cả một
    // khoảng ân hạn MỚI thay vì coi như họ đã rớt từ lâu. Nếu không, ngưỡng
    // đồng thuận skip thảo luận và việc dọn phòng bỏ hoang sẽ kích hoạt ngay
    // giây đầu tiên sau restart.
    members: data.members.map((member) => ({
      ...member,
      connected: false,
      disconnectedAt: Date.now(),
    })),
    config,
    engine: data.engineState
      ? new GameEngine({ ...data.engineState, config })
      : null,
    chatLog: data.chatLog,
    createdAt: data.createdAt,
    gameId: data.gameId,
    resultWritten: data.resultWritten,
    pendingStep: data.pendingStep,
    phaseSeq: data.phaseSeq,
  };

  if (data.botSession) {
    restoreBotSession(room.code, data.botSession);
  } else {
    // Không có session trong ảnh nghĩa là ván này chưa từng có BOT nào nghĩ
    // gì. Dọn session cũ đang lởn vởn trong process để không có con BOT nào
    // mang trí nhớ của một ván khác.
    clearBotSession(room.code);
  }

  restoreBotBudget(room.code, data.governorCalls);

  clearDiscussionSkipVotes(room.code);
  if (data.discussionSkipVotes.length > 0) {
    discussionSkipVotes.set(room.code, new Set(data.discussionSkipVotes));
  }

  return room;
}
