import { LAST_LETTER_MAX_LENGTH } from "@masoi/shared";
import type { LastLetterView, OpenedLastLetter } from "@masoi/shared";
import type { Room } from "../rooms/store";

/**
 * Add-on "Phong thư sau cùng" - toàn bộ luật, ở một chỗ.
 *
 * VÌ SAO NẰM Ở ROOM CHỨ KHÔNG Ở ENGINE. Lá thư không đổi luật thắng thua, không
 * có nhánh nào của máy trạng thái đọc nó, và nó phải sống được khi add-on tắt
 * (tức là không tồn tại). Nhét vào `GameState` sẽ buộc `gameStateSchema` mọc
 * thêm trường BẮT BUỘC - và một trường bắt buộc mới là mọi snapshot Redis đã
 * ghi trước bản này trượt schema ngay lúc deploy, tức giết sạch các ván đang
 * chạy. Ở đây nó là sổ sách của server, đúng chỗ của `discussionSkipVotes`.
 *
 * VÌ SAO KHÔNG DÙNG CHUNG GÌ VỚI `DEAD_CAN_SPEAK`. Hai cơ chế nghe giống nhau
 * ("người chết nói một câu") nhưng ngược nhau ở đúng điểm quan trọng: Tiếng
 * Vọng là MỘT lượt ẩn danh do engine bốc, còn phong thư là của riêng từng người,
 * ghi danh, và chỉ mở khi họ chết. Gộp trạng thái hay gộp lượt sẽ làm một trong
 * hai cái im lặng khi cái kia đã tiêu lượt.
 */

/** Bản nháp của MỘT người. Mỗi người tối đa một bản chưa mở. */
export interface LastLetterDraft {
  text: string;
  /** Vòng bản này được ghi/sửa lần cuối; cũng là vòng niêm phong khi mở ra. */
  updatedRound: number;
}

export interface LastLetterRoomState {
  /** playerId -> bản nháp chưa mở. Xoá khỏi đây ngay khi mở. */
  drafts: Record<string, LastLetterDraft>;
  /** Thư đã mở, theo đúng thứ tự mở. Từ lúc nằm ở đây nó là dữ liệu công khai. */
  opened: OpenedLastLetter[];
  /**
   * CHỐT chống mở trùng, và là thứ được kiểm TRƯỚC mọi lần mở.
   *
   * Nghe như thừa vì `opened` cũng suy ra được, nhưng nó phủ đúng ca mà `opened`
   * không phủ: một bản nháp sống lại từ một snapshot Redis cũ hơn lần mở. Dãy id
   * này đi cùng snapshot, nên sau khi khôi phục thì một lá thư đã mở không bao
   * giờ mở lần thứ hai - kể cả khi bản nháp của nó quay lại.
   */
  openedAuthorIds: string[];
}

export function createLastLetterState(): LastLetterRoomState {
  return { drafts: {}, opened: [], openedAuthorIds: [] };
}

/**
 * Trạng thái thư của phòng, tạo lười nếu chưa có.
 *
 * Trường trong `Room` là OPTIONAL, nên phòng dựng từ một snapshot cũ - hoặc từ
 * một fixture test viết trước tính năng này - vẫn chạy được mà không phải sửa
 * bốn mươi chỗ khởi tạo.
 */
export function lastLetterStateOf(room: Room): LastLetterRoomState {
  room.lastLetters ??= createLastLetterState();
  return room.lastLetters;
}

/** Add-on có bật cho phòng này không. Một chỗ hỏi, mọi nhánh đọc lại từ đây. */
export function lastLetterEnabled(room: Room): boolean {
  return room.config.lastLetter === true;
}

/** Xoá sạch dữ liệu thư. Gọi khi bắt đầu ván mới và khi về sảnh chờ. */
export function clearLastLetters(room: Room): void {
  room.lastLetters = createLastLetterState();
}

function isAlive(room: Room, playerId: string): boolean {
  return room.engine?.state.players.find((player) => player.id === playerId)?.alive === true;
}

/** Người xem có được sửa thư ngay bây giờ không. Server tính, web không tự suy. */
function canEditNow(room: Room, viewerId: string): boolean {
  if (!lastLetterEnabled(room)) return false;
  if (!room.engine) return false;
  if (room.engine.state.phase !== "DAY_DISCUSSION") return false;
  return isAlive(room, viewerId);
}

/**
 * Phần phong thư trong snapshot của MỘT người xem cụ thể.
 *
 * Đây là cổng bảo mật duy nhất của tính năng, và nó nằm ở tầng dựng snapshot
 * chứ không ở React: bản nháp của người khác không bao giờ được đặt lên dây, nên
 * mở devtools cũng không đọc được. `mine` là trường DUY NHẤT mang nội dung nháp,
 * và nó chỉ được lấp từ đúng `viewerId`.
 *
 * `opened` thì ngược lại: đã mở là công khai, mọi người xem nhận cùng một mảng.
 */
export function lastLetterViewFor(room: Room, viewerId: string): LastLetterView | null {
  if (!lastLetterEnabled(room)) return null;

  const state = lastLetterStateOf(room);
  const draft = state.drafts[viewerId];

  return {
    enabled: true,
    mine: {
      text: draft?.text ?? null,
      updatedRound: draft?.updatedRound ?? null,
      canEdit: canEditNow(room, viewerId),
    },
    opened: state.opened,
  };
}

/**
 * Lưu hoặc xoá bản nháp. Trả `null` là xong, trả chuỗi là LỖI tiếng Việt.
 *
 * Không tin một chữ nào từ client: pha, trạng thái sống và tư cách thành viên
 * đều đọc lại từ `room`/`engine`. `text === null` là lệnh XOÁ thật, không phải
 * payload thiếu.
 *
 * Trần độ dài được kiểm LẦN NỮA ở đây dù schema đã chặn: schema là biên của một
 * client trung thực, hàm này là biên của mọi client.
 */
export function submitLastLetter(room: Room, playerId: string, text: string | null): string | null {
  if (!room.members.some((member) => member.playerId === playerId)) {
    return "Bạn không ở trong phòng này";
  }
  if (!lastLetterEnabled(room)) return "Phòng này không bật Phong thư sau cùng";
  if (!room.engine) return "Không có trận đấu đang chạy";
  if (!isAlive(room, playerId)) return "Người đã chết không viết được phong thư";
  if (room.engine.state.phase !== "DAY_DISCUSSION") {
    return "Chỉ viết được phong thư trong lúc thảo luận";
  }

  const state = lastLetterStateOf(room);

  if (text === null) {
    delete state.drafts[playerId];
    return null;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) return "Phong thư không được để trống";
  if (trimmed.length > LAST_LETTER_MAX_LENGTH) {
    return `Phong thư tối đa ${LAST_LETTER_MAX_LENGTH} ký tự`;
  }

  state.drafts[playerId] = { text: trimmed, updatedRound: room.engine.state.round };
  return null;
}

/**
 * Thứ tự tử vong theo cách ENGINE đã ghi lại.
 *
 * Ba nguồn, xếp đúng trình tự chúng xảy ra trong một vòng: chết đêm (đã có sẵn
 * thứ tự trong `lastNightDeaths`), bị treo, rồi phát bắn của Thợ Săn - phát bắn
 * luôn là PHẢN ỨNG với một cái chết trước đó, nên nó đứng sau.
 *
 * Ai không nằm trong ba nguồn đó (chết vì một cơ chế thêm sau chẳng hạn) vẫn có
 * thứ tự ổn định: rơi về vị trí trong `state.players`, dịch xuống dưới mọi cái
 * chết đã được ghi nhận. Không có nhánh nào cho ra thứ tự phụ thuộc đồng hồ hay
 * thứ tự duyệt object.
 */
function deathRanks(room: Room): Map<string, number> {
  const ranks = new Map<string, number>();
  const state = room.engine?.state;
  if (!state) return ranks;

  const push = (playerId: string | undefined | null): void => {
    if (!playerId || ranks.has(playerId)) return;
    ranks.set(playerId, ranks.size);
  };

  for (const death of state.lastNightDeaths) push(death.playerId);
  push(state.lastEliminated?.playerId);
  for (const shot of state.hunterShots) push(shot.target?.id);

  const base = ranks.size;
  state.players.forEach((player, index) => {
    if (!ranks.has(player.id)) ranks.set(player.id, base + index);
  });
  return ranks;
}

/**
 * HÀM TẬP TRUNG: mở thư của mọi người đã chết mà chưa được mở.
 *
 * Cố ý KHÔNG diff "ai vừa chết" so với lần gọi trước. Nó là một hàm THUẦN THEO
 * TRẠNG THÁI HIỆN TẠI - "ai đang chết, đang có thư, và chưa được mở" - nên nó
 * idempotent, và một process mới đọc phòng lên từ Redis cho ra đúng kết quả như
 * process cũ. Một bộ nhớ "ai đã chết ở lần gọi trước" thì ngược lại: nó là thứ
 * KHÔNG có trong snapshot, nên sau restart mọi người chết đều trông như vừa mới
 * chết, và cả loạt thư sẽ mở lại lần thứ hai.
 *
 * Vì vậy mọi nguyên nhân chết đều được phủ mà không cần một nhánh riêng nào:
 * Sói cắn, Phù Thuỷ dùng độc, treo cổ sau FINAL_VOTE, Thợ Săn bắn, Linh Mục
 * phản đòn, Tử Thủ, và bất cứ cơ chế nào thêm sau này. Cái duy nhất chúng phải
 * làm là đặt `alive = false` - thứ chúng vốn đã làm.
 *
 * Trả về các lá thư VỪA mở trong lần gọi này, theo thứ tự tử vong của engine.
 */
export function openLastLettersForDeaths(room: Room): OpenedLastLetter[] {
  if (!lastLetterEnabled(room) || !room.engine) return [];

  const state = lastLetterStateOf(room);
  const alreadyOpened = new Set(state.openedAuthorIds);
  const ranks = deathRanks(room);
  const round = room.engine.state.round;
  const now = Date.now();

  const pending = room.engine.state.players
    .filter((player) => !player.alive)
    .filter((player) => !alreadyOpened.has(player.id))
    .filter((player) => state.drafts[player.id] !== undefined)
    .sort(
      (a, b) =>
        (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );

  const justOpened: OpenedLastLetter[] = [];
  for (const player of pending) {
    const draft = state.drafts[player.id]!;
    const letter: OpenedLastLetter = {
      // Ổn định theo tác giả: mỗi người đúng một lá thư cả ván, nên id này cũng
      // là khoá khử trùng ở phía web khi xếp hàng đợi hiển thị.
      id: `last-letter:${player.id}`,
      authorId: player.id,
      authorName: player.name,
      text: draft.text,
      sealedRound: draft.updatedRound,
      openedRound: round,
      openedAt: now,
    };
    state.opened.push(letter);
    state.openedAuthorIds.push(player.id);
    // Bản nháp hết vai trò ngay khi mở: giữ lại chỉ tạo ra một bản sao thứ hai
    // của cùng nội dung, và một bản sao thì sẽ có ngày đi ra nhầm đường.
    delete state.drafts[player.id];
    justOpened.push(letter);
  }

  return justOpened;
}
