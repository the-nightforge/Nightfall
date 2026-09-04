import type { RoomSnapshot } from "@masoi/shared";
import { assignAvatars } from "./avatar";
import type { AvatarId } from "./avatar-art";
import type { CinematicKind } from "./cinematic-transition";

/**
 * Phần LOGIC của cảnh kill.
 *
 * Tách hẳn khỏi React và khỏi DOM đúng vì lý do `live-trial.ts` đã tách: bộ
 * test của web chạy trên hàm thuần, và ba quyết định dễ sai nhất của tính năng
 * này - ai lên hình, cắt ở mấy người, và chữ được phép nói gì - phải khẳng định
 * được bằng test chứ không nằm rải trong JSX.
 *
 * Ba luật xuyên suốt cả file, và cả ba đều là luật về THÔNG TIN chứ không phải
 * về hình ảnh:
 *
 *   1. Model hiển thị chỉ mang thứ đã CÔNG KHAI. Đúng ba trường: id, tên, ảnh.
 *      `players[]` trong snapshot của một con Sói có mang `role` của đồng bọn,
 *      nên "tiện tay" trả về cả PlayerView là đủ để một cảnh chuyển tiếp trở
 *      thành cửa hậu đọc vai qua devtools.
 *   2. Không một chữ nào ở đây được nói về NGUYÊN NHÂN. Client không hề nhận
 *      `cause`, nhưng nó vẫn đoán được: "Sói cắn" là suy luận hiển nhiên nhất
 *      của cả bàn, và một dòng chữ khẳng định hộ sẽ giết luôn pha thảo luận.
 *      Xem `deathCauseClause` - bảng nhãn đó phục vụ màn KẾT VÁN, không phục vụ
 *      chỗ này.
 *   3. Số nạn nhân không được đổi NHỊP. Cảnh này che mất bàn của cả phòng, nên
 *      trần thời lượng là một hằng số ở `KIND_META`, còn ở đây là trần số khuôn
 *      mặt. Tám người chết trong một đêm là chuyện có thật (Sói cắn kép + độc +
 *      dao), và nối tám đoạn phim là bắt mười lăm người ngồi chờ.
 */

/**
 * Bao nhiêu khuôn mặt được lên hình.
 *
 * Ba, và con số này đến từ bề ngang màn hình chứ không từ thẩm mỹ: ở 390px,
 * `px-6` của lớp phủ chừa lại 342px, ba khung 88px cộng hai khe 12px là 288px -
 * còn thở. Bốn khung thì phải bóp xuống dưới 72px, và ở cỡ đó khuôn mặt không
 * còn nhận ra được ai, tức là mất đúng cái thứ duy nhất cảnh này đem lại.
 *
 * Người thứ tư trở đi KHÔNG biến mất - họ đi vào con số ở `overflow`, và vào
 * câu đọc cho trình đọc màn hình.
 */
export const MAX_KILL_PORTRAITS = 3;

/** Đêm hay pháp trường. Hai cảnh, hai ngôn ngữ hình ảnh, hai luật thông tin. */
export type KillMode = "NIGHT" | "EXECUTION";

/**
 * Một nạn nhân, ở đúng dạng mà cảnh cần vẽ.
 *
 * Bốn trường và chỉ bốn. Xem luật 1 ở đầu file về việc vì sao đây không phải
 * một `PlayerView`.
 */
export interface KillVictim {
  playerId: string;
  name: string;
  /**
   * Khuôn mặt mặc định, ĐÃ CHỐT ở đây chứ không để chỗ vẽ tự tính.
   *
   * `assignAvatars` không phải một hàm băm thuần từ id: nó dò chỗ trống để
   * không ai trong phòng trùng mặt ai, nên kết quả cho MỘT id phụ thuộc vào cả
   * TẬP id đưa vào. Bản đầu để `KillScene` gọi lại hàm đó với riêng danh sách
   * nạn nhân, và bảng thu được khác hẳn bảng của bàn chơi - trong một phòng 20
   * người, sáu id đổi mặt, ví dụ `p4` là `bandit` trên lưới nhưng thành
   * `cultist` trong cảnh. Người vừa chết hiện lên với một khuôn mặt lạ, ở đúng
   * cái cảnh sinh ra để nói "người này là ai".
   *
   * Chốt ở đây, tính từ TOÀN BỘ `players[]`, thì chỉ còn một nguồn sự thật và
   * chỗ vẽ không còn quyền tính lại.
   */
  avatar: AvatarId;
  /** Ảnh người chơi tự tải lên, hoặc null để dùng `avatar`. */
  avatarUrl: string | null;
}

export interface KillSceneView {
  mode: KillMode;
  /** Những người LÊN HÌNH, tối đa `MAX_KILL_PORTRAITS`. */
  victims: KillVictim[];
  /**
   * Tên của TẤT CẢ nạn nhân, không cắt.
   *
   * Tách khỏi `victims` vì hai danh sách phục vụ hai giác quan khác nhau và chỉ
   * một trong hai bị màn hình chặn. `victims` dừng ở ba vì đó là số khuôn mặt
   * còn nhận ra được ở 390px; còn câu đọc cho trình đọc màn hình thì không có
   * màn hình nào để mà chật. Bản đầu dùng chung một danh sách, nên với năm
   * người chết, người dùng trình đọc màn hình chỉ nghe ba tên và một vế đếm -
   * họ không có đường nào biết hai người còn lại là ai, trong khi mọi người
   * khác chỉ cần nhìn xuống thẻ pha ngay bên dưới lớp phủ.
   */
  allVictimNames: string[];
  /** Số nạn nhân THẬT của mốc công bố này. Luôn >= `victims.length`. */
  total: number;
  /** `total - victims.length`. 0 nghĩa là không ai bị gộp vào chip đếm. */
  overflow: number;
}

/**
 * Cảnh nào dựng bằng chân dung người chơi.
 *
 * Một hàm riêng chứ không phải một điều kiện lọt giữa thân component, vì ba nơi
 * cùng phải hỏi câu này: `CinematicOverlay` (dựng gì), đường video (không bao
 * giờ), và đường 3D (cũng không bao giờ).
 */
export function isKillKind(kind: CinematicKind): boolean {
  return kind === "NIGHT_KILL" || kind === "EXECUTION";
}

function modeOf(kind: CinematicKind): KillMode | null {
  if (kind === "NIGHT_KILL") return "NIGHT";
  if (kind === "EXECUTION") return "EXECUTION";
  return null;
}

/**
 * Cảnh kill cho một kind + snapshot, hoặc null khi không có gì để dựng.
 *
 * Hàm THUẦN: cùng đầu vào cho cùng kết quả, không đọc đồng hồ, không đọc
 * `window`. Nó KHÔNG tự quyết định có phát hay không - việc đó đã xong từ
 * `cinematicFor`, nơi `NIGHT_KILL`/`EXECUTION` và `DAWN`/`VERDICT` loại trừ
 * nhau ngay tại chỗ chọn.
 *
 * Trả null vẫn là một kết quả hợp lệ và bên gọi phải chịu được: hai snapshot
 * lệch build có thể cho ra một cạnh `NIGHT_KILL` mà `lastNightDeaths` đã rỗng.
 */
export function killSceneFor(
  kind: CinematicKind,
  snapshot: RoomSnapshot,
): KillSceneView | null {
  const mode = modeOf(kind);
  if (!mode) return null;

  /*
   * Hai nguồn TÁCH HẲN nhau, không có nhánh nào đọc cả hai.
   *
   * `lastNightDeaths` còn nguyên trong `DAY_DISCUSSION`, và `lastEliminated`
   * còn nguyên trong `CHECK_WIN`. Một hàm "lấy người chết gần nhất" gộp hai
   * nguồn sẽ treo cổ nhầm nạn nhân của đêm hôm trước.
   */
  const deaths =
    mode === "NIGHT"
      ? snapshot.lastNightDeaths
      : snapshot.lastEliminated
        ? [snapshot.lastEliminated]
        : [];
  if (deaths.length === 0) return null;

  /*
   * Bảng mặt tính từ TOÀN BỘ players[], đúng cái roster mà `PlayerGrid` và
   * `TrialStage` đưa vào cùng hàm này.
   *
   * Đây là cả điểm của bản sửa: cùng một tập id thì `assignAvatars` cho cùng
   * một bảng trên mọi máy và ở mọi chỗ vẽ. Đưa vào một tập nhỏ hơn - chẳng hạn
   * riêng danh sách nạn nhân - là tính ra một bảng KHÁC, và người vừa chết đổi
   * mặt so với ô của chính họ trên lưới.
   */
  const table = assignAvatars(snapshot.players.map((player) => player.id));

  const victims: KillVictim[] = deaths.slice(0, MAX_KILL_PORTRAITS).map((death) => ({
    playerId: death.playerId,
    name: death.name,
    /*
     * Không tìm thấy trong `players[]` thì tự gán một mặt cho riêng id đó.
     *
     * Snapshot lệch nhau giữa hai lần deploy là chuyện có thật, và ở đó không
     * có "khuôn mặt trên bàn" nào để mà khớp - người này không có ô nào trên
     * lưới cả. Một khuôn mặt tất định còn hơn `undefined` đi thẳng vào
     * `CharacterPortrait`, và mất một khuôn mặt còn hơn mất cả mốc công bố.
     */
    avatar: table[death.playerId] ?? assignAvatars([death.playerId])[death.playerId],
    avatarUrl: snapshot.players.find((p) => p.id === death.playerId)?.avatarUrl ?? null,
  }));

  return {
    mode,
    victims,
    // Đủ tên, không cắt - xem `KillSceneView.allVictimNames`.
    allVictimNames: deaths.map((death) => death.name),
    total: deaths.length,
    overflow: deaths.length - victims.length,
  };
}

/**
 * Dòng nhỏ phía trên.
 *
 * Cùng câu chữ với thẻ pha nằm ngay dưới lớp phủ (`DayViews`, `EliminationView`):
 * lớp phủ tan sau 2,2 giây và người chơi đọc lại đúng chuyện đó bằng chữ, nên
 * hai chỗ nói khác nhau sẽ đọc ra như hai sự kiện.
 */
export function killEyebrow(view: KillSceneView): string {
  return view.mode === "NIGHT" ? "Trời đã sáng" : "Phán quyết của làng";
}

/**
 * Dòng chữ LỚN.
 *
 * Cảnh đêm nói một MỆNH ĐỀ trung tính - "không qua khỏi" chứ không phải "bị
 * giết": làng không biết ai ra tay, và dòng chữ to nhất màn hình không được
 * biết nhiều hơn làng. Cảnh treo thì ngược lại và được gọi thẳng tên hành động,
 * vì đó là việc cả làng vừa cùng nhau làm.
 */
export function killTitle(view: KillSceneView): string {
  if (view.mode === "EXECUTION") return "Đã bị treo cổ";
  return view.total === 1
    ? "Không qua khỏi đêm nay"
    : `${view.total} người không qua khỏi đêm nay`;
}

/**
 * Câu đầy đủ cho trình đọc màn hình.
 *
 * Lớp phủ là `role="dialog"` và trỏ `aria-labelledby` vào tiêu đề, nên đây là
 * thứ DUY NHẤT người dùng trình đọc màn hình nghe được về cảnh này. Vì vậy nó
 * phải gọi đủ tên - kể cả những người bị gộp vào chip đếm, những người mà mắt
 * thường cũng không thấy mặt. Không ai được biến mất chỉ vì màn hình hẹp.
 */
export function killAnnouncement(view: KillSceneView): string {
  /*
   * `allVictimNames`, KHÔNG phải `victims`.
   *
   * `victims` đã bị cắt còn ba từ trước - đó là trần của màn hình, không phải
   * trần của một câu nói. Duyệt nó ở đây là lý do bản đầu đọc ra "ba tên và 2
   * người nữa" cho một đêm chết năm người.
   */
  const names = joinNames(view.allVictimNames);

  if (view.mode === "EXECUTION") {
    return `${killEyebrow(view)}. ${names} đã bị treo cổ.`;
  }
  if (view.total === 1) {
    return `${killEyebrow(view)}. ${names} không qua khỏi đêm nay.`;
  }
  return `${killEyebrow(view)}. ${view.total} người không qua khỏi đêm nay: ${names}.`;
}

/**
 * Nối tên thành một danh sách đọc lên nghe được: "A, B và C".
 *
 * Dấu phẩy cho tất cả trừ vế cuối. Một chuỗi toàn dấu phẩy đọc lên bằng giọng
 * tổng hợp nghe như một danh sách chưa hết, và ở đây danh sách hết ở đâu là
 * thông tin thật - nó nói cả làng còn lại bao nhiêu người.
 */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} và ${names[names.length - 1]}`;
}
