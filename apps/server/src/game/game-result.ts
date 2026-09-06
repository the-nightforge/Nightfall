import { buildCaseFile } from "@masoi/shared";
import type { CaseFile } from "@masoi/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { invalidateLeaderboard } from "../leaderboard";
import { buildSnapshot } from "../rooms/snapshot";
import type { Room } from "../rooms/store";
import { MAX_ARCHIVED_MESSAGES } from "./match-chat";

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

/**
 * Sổ chat của ván, dựng thành payload nested-create của Prisma.
 *
 * Cắt theo `MAX_ARCHIVED_MESSAGES` một lần nữa ở đây là CỐ Ý dư thừa: sổ trong
 * RAM đã tự dừng ở trần đó, nhưng sổ đọc lên từ một envelope cũ thì không đi
 * qua đường ghi nào của process này, và một dòng INSERT dài vô hạn là thứ duy
 * nhất trong hàm này có thể làm hỏng cả việc lưu kết quả.
 *
 * Sắp theo `seq` chứ không theo `at`: nhiều BOT nói trong cùng một mili giây là
 * chuyện thường, và mốc thời gian không phân biệt nổi chúng.
 */
function matchChatForHistory(room: Room): Prisma.MatchChatMessageCreateWithoutMatchInput[] {
  return [...(room.matchChat ?? [])]
    .sort((a, b) => a.seq - b.seq)
    .slice(0, MAX_ARCHIVED_MESSAGES)
    .map((message) => ({
      seq: message.seq,
      channel: message.channel,
      actorId: message.actorId,
      actorName: message.actorName,
      text: message.text,
      round: message.round,
      phase: message.phase,
      createdAt: new Date(message.at),
    }));
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
        /*
         * `personalWin` đi CHUNG vào cột Json này thay vì một cột riêng, và đó
         * là lý do nó không cần migration - đúng cách `id` đã được thêm vào
         * trước đây. Ván cũ không có trường này đọc lên thành `undefined`, tức
         * "không có thắng lợi cá nhân nào", đúng sự thật của chúng.
         *
         * Không mang `playerId`/`name`/`role`: ba trường đó đã nằm ngay trên
         * cùng object, và một bản sao thứ hai là một chỗ để chúng lệch nhau.
         */
        playerRoles: state.players.map((p) => {
          const win = (state.personalWins ?? []).find((item) => item.playerId === p.id);
          return {
            id: p.id,
            name: p.name,
            role: p.role,
            alive: p.alive,
            ...(win ? { personalWin: { condition: win.condition, round: win.round } } : {}),
          };
        }),
        // `startedAt`, KHÔNG phải `createdAt`: xem chú thích của trường đó
        // trong `rooms/store.ts`. Rơi về `createdAt` cho phòng đọc lên từ ảnh
        // chụp ghi trước khi có trường này - một con số hơi rộng vẫn tốt hơn NaN.
        durationSec: Math.round((Date.now() - (room.startedAt ?? room.createdAt)) / 1000),
        /*
         * Chat đi xuống CÙNG một lệnh với kết quả, nên Prisma gói cả hai vào
         * một transaction: hoặc có cả kết quả lẫn log, hoặc không có gì. Đây
         * cũng là lý do không ghi từng tin lúc người ta gõ - bàn đang chơi là
         * đường nóng, và một INSERT chậm ở đó làm cả phòng đứng hình.
         *
         * Ván không ai nói câu nào cho ra mảng rỗng, và Prisma bỏ qua nó chứ
         * không sinh lệnh thừa.
         */
        chat: { create: matchChatForHistory(room) },
      },
    });
    room.resultWritten = true;
    // Ván vừa ghi có thể đổi ngôi trên bảng xếp hạng; đừng bắt người vừa
    // thắng chờ hết một phút cache mới thấy mình lên.
    invalidateLeaderboard();
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
