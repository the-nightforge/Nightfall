import { buildCaseFile } from "@masoi/shared";
import type { CaseFile } from "@masoi/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { buildSnapshot } from "../rooms/snapshot";
import type { Room } from "../rooms/store";

/**
 * Hồ sơ vụ án để lưu kèm kết quả ván.
 *
 * Dựng ở đây chứ không dựng lại lúc ĐỌC lịch sử: nguyên liệu (nightHistory,
 * dayVoteHistory, hunterShots) chỉ sống trong RAM của ván và không có trong DB,
 * nên qua lúc này là mất vĩnh viễn.
 *
 * Lấy snapshot của một thành viên bất kỳ là ĐỦ, không phải cẩu thả: ở GAME_OVER
 * mọi vai đã lộ với mọi người, và `case-file-contract.test.ts` khẳng định tường
 * minh rằng mọi thành viên dựng ra cùng một hồ sơ.
 *
 * KHÔNG đụng tới snapshot phát đi: hồ sơ vẫn do client tự dựng lúc chơi, đúng
 * như hợp đồng "không thêm byte nào lên dây". Đây là một đường riêng, chỉ để
 * xem lại về sau.
 */
function caseFileForHistory(room: Room): CaseFile | null {
  const viewer = room.members[0]?.playerId;
  if (!viewer) return null;
  try {
    return buildCaseFile(buildSnapshot(room, viewer));
  } catch {
    // Hồ sơ là phần thêm nếm. Hỏng nó không được làm mất luôn kết quả ván.
    return null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/**
 * Ghi kết quả ván đúng MỘT lần cho mỗi `gameId`.
 *
 * Đây là side effect duy nhất của ván nằm ngoài engine, nên nó là chỗ duy nhất
 * mà việc khôi phục sau restart có thể nhân đôi. Ba lớp chặn, mỗi lớp phủ một
 * khe thời gian khác nhau:
 *
 *  - `resultWritten` chặn lần gọi thứ hai trong CÙNG một process.
 *  - Unique index trên `gameId` chặn lần ghi thứ hai từ một process KHÁC, tức
 *    ca "chết ngay sau khi ghi nhưng trước khi kịp lưu snapshot".
 *  - Lỗi không phải trùng khoá thì KHÔNG đánh dấu đã ghi, nên lần khôi phục
 *    sau còn thử lại được - đó là ca "chết trước khi kịp ghi".
 *
 * Không `await` ở chỗ gọi trong luồng game: một lần ghi DB chậm không được làm
 * cả bàn đứng hình ở màn kết thúc.
 */
export async function writeGameResultOnce(room: Room): Promise<void> {
  if (room.resultWritten) return;
  if (!room.gameId) return;

  const state = room.engine?.getState();
  if (!state || !state.winner) return;

  try {
    await prisma.gameResult.create({
      data: {
        gameId: room.gameId,
        roomCode: room.code,
        round: state.round,
        winner: state.winner,
        // Prisma đòi `InputJsonValue`, kiểu này cần index signature mà một
        // interface đóng như `CaseFile` không có - dù giá trị là JSON hoàn toàn
        // hợp lệ. Ép đúng một lần, ngay tại biên vào DB.
        caseFile: (caseFileForHistory(room) ?? undefined) as Prisma.InputJsonValue | undefined,
        // `id` để nối được kết quả về đúng người chơi. Thiếu nó thì bảng này
        // chỉ ghi được chứ không tra ngược được - đó là lý do nó nằm im từ đầu.
        // `playerRoles` là cột Json nên thêm trường không cần migration; ván cũ
        // thiếu `id` đơn giản là không khớp truy vấn nào.
        playerRoles: state.players.map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          alive: p.alive,
        })),
        durationSec: Math.round((Date.now() - room.createdAt) / 1000),
      },
    });
    room.resultWritten = true;
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Một process khác đã ghi đúng ván này. Đó là thành công, không phải lỗi.
      room.resultWritten = true;
      return;
    }
    console.warn(
      JSON.stringify({ event: "game-result.write-failed", roomCode: room.code, gameId: room.gameId }),
    );
  }
}
