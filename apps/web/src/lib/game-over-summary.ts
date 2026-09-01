import {
  ROLE_META,
  type CaseFile,
  type CaseHighlight,
  type RoomSnapshot,
  type Team,
  type Winner,
} from "@masoi/shared";
import { roleLabel } from "./cursed";

/**
 * Phần tóm tắt của màn kết thúc.
 *
 * Thuần tính toán, không React. Màn kết thúc phải trả lời ba câu hỏi trong vài
 * giây đầu - phe nào thắng, TÔI thắng hay thua, và ván này ngoặt ở đâu - còn
 * bảng vai trò đầy đủ mới là thứ tra cứu sau. Ba hàm dưới đây là ba câu trả lời
 * đó, tách ra khỏi JSX để test được mà không cần dựng DOM.
 *
 * KHÔNG hàm nào ở đây đọc lại luật thắng thua: phe thắng lấy thẳng từ
 * `snapshot.winner` (server chốt), phe của người chơi lấy từ `ROLE_META` theo
 * vai CUỐI ván - đúng nguồn mà `GameOverView` vẫn dùng để chia hai bảng.
 */

export interface WinnerCopy {
  team: Team;
  /** "Ma Sói" / "Dân Làng" - dùng để ghép câu, không kèm chữ "Phe". */
  teamName: string;
  /** Câu tiêu đề đầy đủ của màn kết thúc. */
  headline: string;
}

export function winnerCopy(winner: Exclude<Winner, null>): WinnerCopy {
  const teamName = winner === "wolves" ? "Ma Sói" : "Dân Làng";
  return { team: winner, teamName, headline: `Phe ${teamName} chiến thắng` };
}

export interface PersonalOutcome {
  won: boolean;
  team: Team;
  teamName: string;
  /** Tên vai đã tính cả Kẻ Nguyền Rủa đã hoá Sói. */
  roleName: string;
  alive: boolean;
  /**
   * Nhãn chữ cho thắng/thua và sống/chết.
   *
   * Có mặt ở đây chứ không nằm trong JSX vì đó là cách màn này KHÔNG phụ thuộc
   * vào màu: đỏ và xanh nói cùng một điều với chữ, nhưng chỉ chữ mới đọc được
   * khi người chơi mù màu hoặc khi ảnh chụp bị chuyển sang xám.
   */
  verdict: string;
  statusLabel: string;
}

/**
 * Kết quả của CHÍNH người đang xem.
 *
 * Trả `null` khi snapshot chưa lộ vai của viewer - người mới vào xem giữa chừng
 * hoặc server cũ không gửi `you.role`. Chỗ gọi phải chịu được điều đó thay vì
 * đoán bừa một phe.
 */
export function personalOutcome(snapshot: RoomSnapshot): PersonalOutcome | null {
  const you = snapshot.you;
  if (!you || !you.role || !snapshot.winner) return null;

  const team = ROLE_META[you.role].team;
  const won = team === snapshot.winner;
  return {
    won,
    team,
    teamName: team === "wolves" ? "Ma Sói" : "Dân Làng",
    roleName: roleLabel(you),
    alive: you.alive,
    verdict: won ? "Bạn thắng" : "Bạn thua",
    statusLabel: you.alive ? "Sống sót" : "Đã bị loại",
  };
}

const PHASE_RANK: Record<CaseHighlight["phase"], number> = { night: 0, day: 1 };

/**
 * Điểm ngoặt đáng kể nhất của ván.
 *
 * `file.highlights` đã được xếp theo THỜI GIAN để đọc thành một câu chuyện, nên
 * phần tử đầu tiên không phải phần tử quan trọng nhất. Thứ tự phá hoà ở đây lặp
 * đúng thứ tự của `selectHighlights` trong shared, để hai chỗ không bao giờ chỉ
 * vào hai sự kiện khác nhau.
 *
 * Trả `null` với ván `fallback`: lúc đó highlight duy nhất chỉ là câu "ván này
 * không có điểm ngoặt rõ ràng", và quảng cáo nó thành "bước ngoặt" là nói dối.
 */
export function decisiveHighlight(file: CaseFile): CaseHighlight | null {
  if (file.fallback) return null;
  let best: CaseHighlight | null = null;
  for (const item of file.highlights) {
    if (
      !best ||
      item.importance > best.importance ||
      (item.importance === best.importance &&
        (item.round < best.round ||
          (item.round === best.round &&
            (PHASE_RANK[item.phase] < PHASE_RANK[best.phase] ||
              (PHASE_RANK[item.phase] === PHASE_RANK[best.phase] && item.type < best.type)))))
    ) {
      best = item;
    }
  }
  return best;
}
