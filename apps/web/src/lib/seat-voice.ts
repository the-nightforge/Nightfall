import { voiceCanPublish, type Phase, type PlayerView } from "@masoi/shared";

/**
 * Hai quyết định thuần của ô người chơi: viền nào, và ai đang nói.
 *
 * Tách khỏi component vì cùng lý do đã tách `voice-state.ts` khỏi SDK LiveKit:
 * thứ tự ưu tiên màu viền là một luật, và một luật nằm trong JSX thì không ai
 * kiểm chứng được nó có bị một trạng thái mới chen ngang hay không.
 */

/**
 * Viền của ô, theo đúng thứ tự ưu tiên đã có: đang chọn > đã chết > là mình >
 * bình thường. Màu viền chỉ nói MỘT chuyện tại một thời điểm; chồng nhiều màu
 * lên cùng một ô thì không màu nào còn nghĩa.
 *
 * "Ô của tôi" và "ô tôi đang chọn" phải trông KHÁC HẲN nhau. Bản trước dùng
 * chung một ngôn ngữ cho cả hai - viền đặc cộng một vòng `ring` - chỉ khác màu
 * chàm với đỏ. Trên nền tối, ở đuôi mắt, hai cái đó đọc ra như nhau, và ô "Bạn"
 * bị hiểu thành ứng viên đang bị nhắm. Nên tách hẳn hai NGÔN NGỮ hình:
 *
 *   - đang chọn / đã bỏ phiếu -> viền đặc + vòng cứng + dấu tích ở góc
 *   - chính mình              -> quầng sáng mềm, không viền cứng, không vòng
 *
 * `isSpeaking` CỐ Ý không phải tham số ở đây, và đó là cả điểm của hàm này.
 * Trạng thái nói là ngôn ngữ hình thứ BA - quầng động ở ngoài khung - nên nó
 * không bao giờ được phép cướp màu của ô đang bị nhắm: một ô vừa được chọn vừa
 * có người nói thì viền vẫn phải đỏ, nếu không thì lá phiếu đang nhắm vào ai đó
 * biến mất khỏi màn hình đúng lúc người đó lên tiếng.
 */
export interface SeatFrameInput {
  selected: boolean;
  dead: boolean;
  isMe: boolean;
}

export function seatFrame({ selected, dead, isMe }: SeatFrameInput): string {
  if (selected) return "border-blood-500 bg-blood-600/25 ring-2 ring-blood-500";
  if (dead) return "border-night-600/60 bg-night-950/70";
  if (isMe)
    return "border-indigo-400/60 bg-indigo-500/[0.07] shadow-[0_0_22px_-8px_rgba(129,140,248,0.9)]";
  return "border-night-600/70 bg-night-800/40";
}

/**
 * Ô này có được phép sáng "đang nói" không.
 *
 * Hai cửa chặn, cả hai đều là chuyện hình ảnh chứ không phải chuyện luật:
 *
 *   - ô đã chết mang một ngôn ngữ riêng (nghiêng, gạch chéo, chữ gạch ngang).
 *     Quầng sáng động chồng lên đó đọc ra như người chết vừa sống lại.
 *   - ô đang tắt là ô "không phải mục tiêu bấm được"; làm nó nổi bật hơn mọi ô
 *     bấm được xung quanh là mời người chơi bấm vào đúng chỗ không bấm được.
 *
 * Hệ quả cần biết: trong pha bỏ phiếu, ô của CHÍNH người xem đang tắt (luật cấm
 * tự bầu), nên họ không thấy quầng sáng của mình. Trạng thái mic của bản thân
 * đã nằm ở bảng điều khiển thoại, chỗ nó thuộc về.
 */
export interface SeatSpeakingInput {
  isSpeaking: boolean;
  dead: boolean;
  disabled: boolean;
}

export function seatShowsSpeaking({ isSpeaking, dead, disabled }: SeatSpeakingInput): boolean {
  return isSpeaking && !dead && !disabled;
}

const NOBODY: ReadonlySet<string> = new Set();

/**
 * Lọc danh sách "đang phát tiếng" của LiveKit xuống những ô ĐƯỢC PHÉP sáng.
 *
 * Identity của LiveKit chính là playerId nên đối chiếu thẳng, không cần bảng
 * ánh xạ - xem `VoiceState.speakers`.
 *
 * Dùng chung cho MỌI chỗ vẽ trạng thái nói: lưới ghế ở cột giữa (`PlayerGrid`)
 * và cột Người chơi (`RosterPanel`). Hai chỗ vẽ hai hình khác nhau nhưng phải
 * trả lời cùng một câu hỏi, và một bản sao luật thứ hai là bản sao sẽ trôi.
 *
 * Cửa lọc là `voiceCanPublish`, tức ĐÚNG hàm mà server dùng để cấp quyền. Không
 * chép lại luật ở đây, và nhất là không viết cứng một luật riêng cho pha nào:
 * LiveKit báo về theo mức âm thanh, còn một khe hở giữa lúc server thu quyền và
 * lúc SDK cập nhật là đủ để một người vừa mất quyền còn sáng thêm vài khung
 * hình. Lọc bằng chính luật của server thì khe đó đóng lại, và luật đổi ở một
 * chỗ là cả hai bên đổi theo.
 *
 * LƯU Ý về pha DEFENSE: theo `packages/shared/src/voice.ts` hiện tại, biện hộ
 * MỞ cho mọi người còn sống chứ không còn là lượt nói độc quyền của bị cáo -
 * đó là một đánh đổi có chủ ý được ghi thẳng trong file luật. Vì vậy hàm này
 * cho mọi người sống đang nói được sáng ở DEFENSE; muốn chỉ bị cáo sáng thì
 * phải sửa luật ở `voiceCanPublish` trước, chứ không phải bịa thêm một luật thứ
 * hai ở tầng giao diện.
 */
export interface SpeakingSeatsInput {
  speakers: ReadonlySet<string>;
  players: ReadonlyArray<Pick<PlayerView, "id" | "alive">>;
  phase: Phase;
}

export function speakingSeatIds({
  speakers,
  players,
  phase,
}: SpeakingSeatsInput): ReadonlySet<string> {
  // Đường thường gặp nhất: không ai nói. Trả hằng số để mọi ô nhận cùng một
  // tham chiếu và không render lại chỉ vì một Set rỗng mới.
  if (speakers.size === 0) return NOBODY;

  const speaking = new Set<string>();
  for (const player of players) {
    if (!speakers.has(player.id)) continue;
    if (!voiceCanPublish({ phase, alive: player.alive })) continue;
    speaking.add(player.id);
  }
  return speaking;
}
