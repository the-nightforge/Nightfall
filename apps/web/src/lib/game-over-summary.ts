import {
  PERSONAL_WIN_LABELS,
  ROLE_META,
  TEAM_LABELS,
  type CaseFile,
  type CaseHighlight,
  type PersonalWin,
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
  const teamName = TEAM_LABELS[winner];
  return { team: winner, teamName, headline: `Phe ${teamName} chiến thắng` };
}

/**
 * Nhãn của một thắng lợi CÁ NHÂN, để màn kết thúc phân biệt được nó với phe
 * thắng. Hai câu, không phải một: "Phe Dân Làng chiến thắng" và "Thắng cá nhân:
 * Thằng Hề - bị treo cổ" đều đúng trong cùng một ván, và trộn chúng lại sẽ
 * buộc màn hình phải chọn một cái để nói dối.
 */
export function personalWinLabel(win: PersonalWin): string {
  return `Thắng cá nhân: ${PERSONAL_WIN_LABELS[win.condition]}`;
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
  /**
   * Thắng lợi cá nhân của chính người xem; `null` khi không có.
   *
   * Tách khỏi `won` chứ không gộp: `won` trả lời "tôi thắng hay thua", còn
   * trường này trả lời "thắng bằng đường nào" - và màn kết thúc phải nói được
   * cả hai, vì phe thắng chung có thể là một phe mà người này không thuộc về.
   */
  personalWin: PersonalWin | null;
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
  /*
   * HAI đường thắng, và chúng độc lập với nhau.
   *
   * Phe thắng là đường cũ. Đường thứ hai là sổ thắng lợi cá nhân: một Thằng Hề
   * bị treo đã thắng rồi, và nó thắng bất kể sau đó Dân hay Sói về nhất - đúng
   * như engine ghi nhận. Chỉ đọc `team === winner` sẽ báo "Bạn thua" cho một
   * người vừa đạt được đúng điều họ chơi cả ván để đạt.
   */
  const personalWin = (snapshot.personalWins ?? []).find((win) => win.playerId === you.id) ?? null;
  const won = personalWin !== null || team === snapshot.winner;
  return {
    won,
    team,
    teamName: TEAM_LABELS[team],
    roleName: roleLabel(you),
    alive: you.alive,
    personalWin,
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
