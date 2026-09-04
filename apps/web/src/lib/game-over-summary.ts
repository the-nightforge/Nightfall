import {
  PERSONAL_WIN_LABELS,
  ROLE_META,
  TEAM_LABELS,
  outcomeHeadline,
  outcomeName,
  outcomeTeam,
  roleWonOutcome,
  type CaseFile,
  type CaseHighlight,
  type MatchOutcome,
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
  /**
   * Sắc dùng cho cả màn. `"draw"` KHÔNG phải một phe - nó là trạng thái "không
   * ai thắng", và cho nó mượn sắc của một phe nào đó là nói dối bằng màu.
   */
  tone: Team | "draw";
  /**
   * Phe của bên thắng; `null` khi hoà. Sát Nhân trả về `"neutral"` vì đó là
   * nhãn phe của vai đó - nhưng TÊN thì là tên vai, xem `name` ngay dưới.
   */
  team: Team | null;
  /**
   * "Phe Ma Sói" / "Phe Dân Làng" / "Sát Nhân" - đã gồm sẵn chữ "Phe" khi có,
   * vì Sát Nhân thắng MỘT MÌNH và "Phe Sát Nhân" là một phe không tồn tại.
   * `null` khi hoà.
   */
  name: string | null;
  /**
   * "Ma Sói" / "Dân Làng" / "Trung lập" - nhãn PHE trơn, không kèm chữ "Phe".
   * `null` khi hoà. Giữ lại vì các chỗ ghép câu theo phe vẫn cần nó.
   */
  teamName: string | null;
  /** Câu tiêu đề đầy đủ của màn kết thúc. */
  headline: string;
}

/**
 * Câu chữ cho MỘT kết cục.
 *
 * Bốn nhánh, không phải hai. Bản cũ nhận đúng `"wolves" | "village"` và tra
 * thẳng `TEAM_LABELS[winner]`; với kết cục thứ ba thì phép tra đó ra
 * `undefined` và tiêu đề màn kết thúc thành "Phe undefined chiến thắng".
 *
 * Câu chữ lấy từ `@masoi/shared` chứ không viết lại ở đây: hồ sơ vụ án, thẻ
 * chia sẻ và log của engine cũng gọi tên cùng bốn kết cục ấy, và bốn bảng nhãn
 * song song là bốn bảng sẽ trôi khỏi nhau.
 */
export function winnerCopy(winner: MatchOutcome): WinnerCopy {
  const team = outcomeTeam(winner);
  return {
    tone: team ?? "draw",
    team,
    name: outcomeName(winner),
    teamName: team === null ? null : TEAM_LABELS[team],
    headline: outcomeHeadline(winner),
  };
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

/**
 * Câu chú thích của một ván HOÀ.
 *
 * Hoà là kết cục duy nhất mà màn kết thúc phải nói hai điều cùng lúc, và bản cũ
 * chỉ nói được một: "không ai đạt được mục tiêu của mình" là câu đúng cho một
 * bàn chết sạch, nhưng nó PHỦ NHẬN thẳng khối "Thắng cá nhân" hiện ngay bên
 * dưới nó. Một Thằng Hề bị treo ở vòng hai rồi cả bàn chết theo vẫn thắng - và
 * engine đã ghi điều đó vào `personalWins` từ lúc búa gõ, trước cả khi ván có
 * kết cục. Hai khối cạnh nhau nói ngược nhau thì người chơi tin khối nào?
 *
 * Vì thế câu chữ rẽ theo đúng dữ liệu đang hiển thị chứ không theo kết cục
 * chung: vế "không ai thắng" chỉ được nói khi sổ thắng cá nhân THẬT SỰ rỗng.
 *
 * Nhận `personalWins` chứ không nhận cả `snapshot`: đây là một phép chọn câu
 * chữ, và buộc nó phụ thuộc vào toàn bộ snapshot chỉ làm nó khó gọi từ test hơn
 * mà không đọc thêm được gì.
 */
export function drawNote(personalWins: ReadonlyArray<PersonalWin>): string {
  if (personalWins.length === 0) {
    return "Không còn ai sống sót. Không phe nào và không ai đạt được mục tiêu của mình.";
  }
  return personalWins.length === 1
    ? "Không còn ai sống sót, nên không phe nào thắng - nhưng một người vẫn đạt được mục tiêu riêng của mình."
    : "Không còn ai sống sót, nên không phe nào thắng - nhưng vẫn có người đạt được mục tiêu riêng của mình.";
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
  /*
   * `roleWonOutcome`, KHÔNG phải `team === snapshot.winner`.
   *
   * Phép so cũ đúng chừng nào mọi kết cục cũng là một `Team`. Với
   * `serial_killer` nó trả `false` cho chính người vừa thắng cả ván - phe của
   * vai đó là `neutral`, không phải `serial_killer`. Với `draw` nó cũng trả
   * `false`, và vế đó thì đúng: hoà không được ghi thành thắng theo phe cho
   * bất kỳ ai.
   */
  const won = personalWin !== null || roleWonOutcome(you.role, snapshot.winner);
  return {
    won,
    team,
    teamName: TEAM_LABELS[team],
    roleName: roleLabel(you),
    alive: you.alive,
    personalWin,
    /*
     * "Bạn thua" là câu SAI cho một ván hoà: hoà không phải một ván có kẻ thắng
     * người thua. Người vừa đạt thắng lợi CÁ NHÂN trong một ván hoà vẫn đọc
     * "Bạn thắng" - thành tích của Thằng Hề được giữ bất kể kết cục chung.
     *
     * Nhánh hoà nói về VÁN, không về cả bàn. Bản cũ ghi "Không ai thắng", và
     * câu đó vượt quá điều nó được phép biết: nó tuyên bố hộ mọi người khác
     * trong khi `personalWins` có thể đang chứa một Thằng Hề bị treo - người
     * mà chính màn hình này liệt kê trong khối "Thắng cá nhân" ngay bên dưới,
     * và `drawNote` cũng vừa nhắc tới. Ba khối cạnh nhau thì không được có một
     * khối cãi hai khối kia.
     *
     * "Ván đấu hoà" nói đúng phạm vi mà `personalOutcome` nắm được: kết cục
     * CHUNG là hoà, còn ai đạt được gì thì đã có sổ riêng trả lời.
     */
    verdict: won ? "Bạn thắng" : snapshot.winner === "draw" ? "Ván đấu hoà" : "Bạn thua",
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
