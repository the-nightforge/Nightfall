export const PHASES = [
  "LOBBY",
  "ROLE_REVEAL",
  "NIGHT",
  "NIGHT_RESULT",
  "DAY_DISCUSSION",
  // VOTING giữ nguyên tên nhưng đổi nghĩa: nó ĐỀ CỬ bị cáo chứ không còn giết
  // ai. Mọi cái chết ban ngày đi qua FINAL_VOTE.
  "VOTING",
  "DEFENSE",
  "FINAL_VOTE",
  "ELIMINATION",
  "HUNTER_SHOT",
  "CHECK_WIN",
  "GAME_OVER",
] as const;

export type Phase = (typeof PHASES)[number];
export type GamePhase = Exclude<Phase, "LOBBY">;

/**
 * KẾT CỤC của một ván, không phải "phe nào mạnh hơn".
 *
 * Bốn giá trị, và chỉ hai trong số đó là một phe: `serial_killer` là một CON
 * NGƯỜI thắng một mình, còn `draw` là "không ai thắng". Vì vậy mọi chỗ đọc
 * trường này phải xử lý bốn nhánh chứ không được viết `winner === "wolves" ?
 * ... : ...` - với hai giá trị thì biểu thức đó còn đúng, với bốn thì nó gán
 * chiến thắng của Sát Nhân cho phe Dân Làng.
 *
 * `null` vẫn có nghĩa cũ và KHÔNG phải một kết cục: ván chưa xong.
 *
 * Khác hẳn `PersonalWin`: thắng lợi cá nhân của Thằng Hề được ghi vào sổ riêng
 * và ván chạy tiếp, còn một giá trị ở đây KẾT THÚC ván.
 */
export const WINNERS = ["wolves", "village", "serial_killer", "draw"] as const;

export type MatchOutcome = (typeof WINNERS)[number];

export type Winner = MatchOutcome | null;

/**
 * Chuỗi này có phải một kết cục mà bản build HIỆN TẠI hiểu không.
 *
 * Cùng lý do với `isRole`: cột `winner` của bảng `GameResult` là một chuỗi tự
 * do do một bản build nào đó ghi ra, nên lịch sử trận có thể mang một giá trị
 * mà bản này chưa biết. Ép kiểu thẳng sẽ đẩy chuỗi lạ đó vào một bảng nhãn và
 * làm hỏng TRANG CHỦ, đúng kiểu lỗi không tự thoát ra được.
 */
export function isMatchOutcome(value: unknown): value is MatchOutcome {
  return typeof value === "string" && (WINNERS as readonly string[]).includes(value);
}

export type RoomMode = "ranked" | "chaos";

/** Cấu hình số lượng vai trò do chủ phòng đặt. Dân Làng tự động lấp chỗ còn lại. */
export interface RoomConfig {
  werewolves: number;
  seer: boolean;
  guard: boolean;
  witch: boolean;
  hunter: boolean;
  cursed: boolean;
  wolfCub?: boolean;
  /**
   * Kẻ Phản Bội - thắng cùng phe Sói nhưng KHÔNG thuộc bầy.
   *
   * Optional và mặc định TẮT vì cùng lý do với mọi tuỳ chọn thêm sau: snapshot
   * Redis ghi trước bản này không có trường đó, và bắt buộc nó sẽ làm mọi ván
   * đang chạy trượt schema ngay lúc deploy.
   *
   * KHÔNG dùng chung cờ với `wolfCub`: hai lá cùng thắng với phe Sói nhưng Sói
   * Con nằm TRONG bầy còn lá này thì không, và đó chính là khác biệt mà cả vai
   * này tồn tại để tạo ra.
   */
  traitor?: boolean;
  apprenticeSeer?: boolean;
  detective?: boolean;
  guardianAngel?: boolean;
  priest?: boolean;
  mayor?: boolean;
  /**
   * Thằng Hề - vai TRUNG LẬP, tối đa một lá mỗi ván.
   *
   * Optional vì cùng lý do với mọi tuỳ chọn thêm sau: snapshot Redis và cấu
   * hình phòng ghi trước bản này không có trường đó, và bắt buộc nó sẽ làm mọi
   * ván đang chạy trượt schema ngay lúc deploy. Mặc định TẮT: không preset nào
   * chứa Thằng Hề, host phải tự bật trong bộ bài tuỳ chỉnh.
   */
  jester?: boolean;
  /**
   * Sát Nhân - vai TRUNG LẬP thứ hai, tối đa một lá mỗi ván.
   *
   * Optional và mặc định TẮT vì cùng ba lý do với `jester`: snapshot Redis ghi
   * trước bản này không có trường đó, không preset nào chứa vai này, và host
   * phải tự bật trong bộ bài tuỳ chỉnh.
   *
   * KHÔNG dùng chung cờ với `jester`: hai vai cùng nhãn `neutral` nhưng chơi
   * hai ván khác nhau, và gộp chúng vào một công tắc là bước đầu tiên để mọi
   * chỗ khác cũng bắt đầu coi chúng là một.
   */
  serialKiller?: boolean;
  /**
   * Kẻ Báo Thù - vai TRUNG LẬP thứ ba, tối đa một lá mỗi ván.
   *
   * Optional và mặc định TẮT vì cùng ba lý do với `jester` và `serialKiller`:
   * snapshot Redis ghi trước bản này không có trường đó, không preset nào chứa
   * vai này, và host phải tự bật trong bộ bài tuỳ chỉnh.
   *
   * Một công tắc RIÊNG, không dùng chung với hai vai kia: ba vai cùng mang nhãn
   * `neutral` nhưng chơi ba ván khác nhau, và gộp chúng vào một cờ là bước đầu
   * tiên để mọi chỗ khác cũng bắt đầu coi chúng là một.
   */
  executioner?: boolean;
  mode?: RoomMode;
  /**
   * Bật voice chat cho phòng. Mặc định tắt: phòng không bật thì không có gì
   * thay đổi so với trước khi có tính năng này.
   */
  voice?: boolean;
  /**
   * Add-on "Phong thư sau cùng": mỗi người sống được để lại một thông điệp bí
   * mật, chỉ mở ra khi họ chết.
   *
   * Mặc định TẮT, và tắt nghĩa là ván chạy đúng như trước khi có tính năng này -
   * không có state nào được dựng, không có snapshot nào mọc thêm trường.
   * Optional vì snapshot Redis ghi trước bản này không có nó.
   */
  lastLetter?: boolean;
  /** Trưởng Lão. Optional vì snapshot ghi trước bản này không có nó. */
  elder?: boolean;
  /** Bà Đồng. Optional vì snapshot ghi trước bản này không có nó. */
  medium?: boolean;
  /** Kẻ Song Trùng. Optional vì snapshot ghi trước bản này không có nó. */
  doppelganger?: boolean;
  /**
   * BIẾN THỂ LUẬT ĐANG ĐO, chưa phải một lựa chọn của phòng.
   *
   * Bật lên thì vai của người chết lộ ngay, thay vì giữ kín tới `GAME_OVER`.
   * Không có ở sảnh chờ và không nằm trong schema socket, nên phòng thật luôn
   * chạy với nó `undefined`; đường vào duy nhất là harness self-play.
   *
   * Lý do nó tồn tại: `ROLE_POWER` ghi lại rằng mọi preset đo ra 14-41% cho phe
   * làng, và quy hết cho "bot suy luận kém hơn người". Luật hiện tại lấy đi gần
   * hết nguồn XÁC NHẬN của phe làng - chết không lộ vai, trọng số Thị Trưởng
   * ẩn, phiếu Treo/Tha chỉ mở sau phán quyết - mà xác nhận thì phe làng sống
   * bằng nó còn phe Sói thì không cần. Cờ này tách hai giả thuyết đó ra bằng
   * `apps/server/scripts/reveal-ab.ts`, thay vì để phỏng đoán quyết hộ.
   *
   * ĐÃ ĐO XONG: Δ -1.2 điểm, tức luật không phải thủ phạm - xem phần KẾT QUẢ ĐO
   * trong script đó. Cờ ở lại vì bài đo còn phải chạy lại mỗi khi lõi bot đổi.
   */
  revealRoleOnDeath?: boolean;
  /** giây */
  nightSeconds: number;
  discussionSeconds: number;
  /** Vòng bỏ phiếu sơ bộ - chỉ chọn ra bị cáo, không loại ai. */
  voteSeconds: number;
  /** Cửa sổ bị cáo tự bào chữa. */
  defenseSeconds: number;
  /**
   * Vòng bỏ phiếu Treo/Tha. Cận dưới 15 giây là bắt buộc: chuỗi não bot mất tới
   * 13 giây ở trường hợp xấu nhất, cửa sổ ngắn hơn thì mọi bot đều rơi về
   * đường lui cục bộ.
   */
  finalVoteSeconds: number;
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: false,
  cursed: false,
  mode: "ranked",
  nightSeconds: 30,
  // Hạ từ 90 khi thêm phiên toà: vote sơ bộ giờ đã đóng vai trò vòng thảo luận
  // thứ hai, giữ 90 thì một ngày kéo dài gần ba phút.
  discussionSeconds: 60,
  voteSeconds: 30,
  defenseSeconds: 25,
  finalVoteSeconds: 20,
};

/**
 * Thời lượng các pha mà engine tự đặt hạn chót, không lấy từ RoomConfig.
 *
 * Engine đặt phaseEndsAt còn machine hẹn giờ chuyển pha từ CÙNG con số này.
 * Khai báo tách đôi thì sửa một bên là đồng hồ client và lịch server lệch nhau,
 * và người chơi thấy đồng hồ về 0 trong khi pha vẫn chưa đổi.
 */
export const ROLE_REVEAL_MS = 10_000;
export const RESULT_MS = 8_000;

/**
 * Trần độ dài lời nhắn của Tiếng Vọng Người Chết.
 *
 * Khai báo ở shared vì cả ba tầng đều phải đồng ý: web chặn ở ô nhập, schema
 * chặn ở biên socket, engine chặn lần cuối. Ba con số rời nhau thì tầng lỏng
 * nhất mới là luật thật.
 */
export const DEAD_MESSAGE_MAX_LENGTH = 120;

/**
 * Trần độ dài một Phong thư sau cùng, đo SAU khi trim.
 *
 * Cùng lý do với `DEAD_MESSAGE_MAX_LENGTH` ngay trên: web chặn ở ô nhập, schema
 * chặn ở biên socket, server chặn lần cuối. Ba con số rời nhau thì tầng lỏng
 * nhất mới là luật thật - và ở đây tầng lỏng hơn sẽ đẩy server tới chỗ từ chối
 * một lá thư mà người chơi tưởng đã lưu xong.
 */
export const LAST_LETTER_MAX_LENGTH = 100;

/**
 * Tác giả giả của lời nhắn ẩn danh.
 *
 * `ChatMessage` bắt buộc có `playerId`, nên lời nhắn phải mang MỘT cái id nào
 * đó. Nó phải là hằng số này chứ tuyệt đối không phải id thật: payload chat
 * được phát cho cả phòng, và một id thật nằm trong đó là lộ danh tính bất kể
 * client vẽ ra sao.
 */
export const GHOST_AUTHOR_ID = "__ghost__";
export const GHOST_AUTHOR_NAME = "Một linh hồn";

/**
 * Nâng từ 6 lên 8 vì luật, không vì sản phẩm.
 *
 * Ở 6 người, `checkWin` (`sói >= số người còn lại`) cho phe làng đúng HAI ca
 * chết trước khi chạm thế cân bằng, mà đêm đi trước nên đêm 1 đã tiêu mất một.
 * Làng vì thế phải treo trúng hai lần LIÊN TIẾP, lần đầu diễn ra trước khi có
 * bất kỳ thông tin nào. Đo self-play: 26% làng thắng, 1.97 vòng/ván.
 *
 * Và nó không sửa được bằng bộ bài: mọi cấu hình 2 Sói ở 6 người đều trần
 * khoảng 32% (thêm Phù Thuỷ 32.3%, thêm Thị Trưởng 25.7%), vì bàn đã hết ghế
 * để nhét thêm vai chức năng. Còn hạ xuống 1 Sói thì bật lên 60% - một ván mà
 * phe Sói gần như không thắng nổi. Không có điểm nào ở giữa.
 *
 * 8 là cỡ phòng nhỏ nhất mà preset đo ra quanh 50%.
 */
export const MIN_PLAYERS_TO_START = 8;

/**
 * 20, nâng từ 15.
 *
 * Trần này gác HAI thứ khác nhau, và chỉ một trong hai đi theo con số:
 *
 * 1. Số ghế trong phòng - `PRESET_DECKS` phải có bộ bài cho mọi cỡ từ
 *    `MIN_PLAYERS_TO_START` tới đây, nếu không `generateWarnings` phát
 *    "Không có preset cho N người chơi" ở đúng những cỡ phòng vừa mở ra.
 * 2. Số ẢNH ĐẠI DIỆN khác nhau mà một phòng cần. `AVATAR_IDS` đã lên 20 hình
 *    cùng lần sửa này, nên `assignAvatars` vẫn cấp được cho mỗi người một hình
 *    riêng. Nâng trần này lần nữa mà không thêm hình sẽ ĐI QUA test được -
 *    `assignAvatars` có đường lui cấp trùng - nhưng hai ô trùng hình chỉ còn
 *    phân biệt bằng sắc nền, và trong một game đoán người thì đó là một mất mát
 *    thật.
 */
export const MAX_PLAYERS_PER_ROOM = 20;

export const CHAT_CHANNELS = ["lobby", "day", "wolves", "dead"] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];
