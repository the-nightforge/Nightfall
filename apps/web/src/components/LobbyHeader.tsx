"use client";

import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START, type RoomSnapshot } from "@masoi/shared";

interface Props {
  snapshot: RoomSnapshot;
}

/**
 * Đầu bảng người chơi: tên cảnh, chủ phòng, sĩ số và tiến độ tối thiểu.
 *
 * Khối này KHÔNG còn là một thẻ riêng vắt ngang đầu trang. Nó nằm bên trong
 * `.lobby-player-board` như phần đầu của chính bảng đó, và cả lý do là chiều
 * cao: bản cũ là một thẻ 150-180px đứng trên lưới người chơi, nên trên màn
 * 1024x768 danh sách người chơi - thứ đáng nhìn nhất của phòng chờ - bắt đầu ở
 * quá nửa màn hình. Gộp vào đầu bảng thì cùng bấy nhiêu chữ chỉ còn tốn một
 * hàng, và phần diện tích trả lại rơi hết vào lưới.
 *
 * Mã phòng và hai nút mời đã lên thanh đầu trang (xem trang phòng): chúng là
 * việc của cả phòng chứ không riêng bảng người chơi, và ở đó chúng đứng cùng
 * hàng với "Rời phòng" và nút âm thanh thay vì chiếm thêm một tầng.
 *
 * Nút đổi ảnh đại diện KHÔNG còn ở đây. Nó từng đứng một mình bên phải hàng
 * chữ nhỏ này, và trên iPhone hàng đó xuống dòng nên nút trôi ra thành một
 * dòng chữ lẻ dưới một khoảng trống. Giờ nó dán lên góc ảnh của chính người
 * xem trong lưới - xem `LobbyPlayerGrid` - đúng chỗ mà cái nó thay đổi đang
 * nằm. Đầu bảng nhờ vậy không còn state nào.
 */
export function LobbyHeader({ snapshot }: Props) {
  const count = snapshot.players.length;
  const missing = Math.max(0, MIN_PLAYERS_TO_START - count);
  const freeSeats = Math.max(0, MAX_PLAYERS_PER_ROOM - count);
  const host = snapshot.players.find((player) => player.id === snapshot.hostId);
  // Thanh tiến độ đo tới mốc BẮT ĐẦU được, không tới sức chứa phòng: câu hỏi
  // của phút này là "bấm được chưa", không phải "phòng đầy chưa".
  const progress = Math.min(100, Math.round((count / MIN_PLAYERS_TO_START) * 100));

  return (
    <header className={`lobby-board-head ${missing > 0 ? "has-progress" : ""}`}>
      <div className="lobby-board-heading">
        <span className="lobby-room-moon" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <path d="M25.7 21.2A11.8 11.8 0 0 1 10.8 6.3 11.8 11.8 0 1 0 25.7 21.2Z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="lobby-kicker">Phòng Ma Sói</p>
          <h1 className="font-display text-[22px] font-semibold leading-tight text-white sm:text-[26px]">
            Trước giờ trăng lên
          </h1>
        </div>
        {/* Sĩ số đứng cạnh tiêu đề chứ không dưới nó: đây là con số cả phòng
          * liếc lại nhiều lần nhất trong lúc chờ, và một hàng riêng cho nó là
          * một hàng lấy khỏi lưới người chơi. */}
        <p className="shrink-0 text-right leading-none">
          <strong className="font-display text-2xl font-semibold text-amber-100">{count}</strong>
          <span className="text-sm text-mist/70"> / {MAX_PLAYERS_PER_ROOM}</span>
        </p>
      </div>

      <div className="lobby-board-meta">
        <span className="min-w-0 truncate">
          Chủ phòng: <b className="text-amber-100">{host?.name ?? "Đang chuyển giao"}</b>
        </span>
        {/*
          * Lời rủ chỉ hiện khi CÒN THIẾU người và còn ghế trống.
          *
          * Nó KHÔNG nhắc lại con số còn thiếu: con số đó đã đứng ngay dưới nút
          * Bắt đầu (`BlockReason`), là chỗ mắt tìm tới khi nút xám - và trên
          * iPhone cả hai dòng lọt vào cùng một khung nhìn, cùng một câu in hai
          * lần. Ở đây chỉ còn việc cần LÀM: gửi mã phòng. Thanh tiến độ bên
          * dưới vẫn mang đủ số qua aria.
          *
          * Dấu chấm và câu chữ nằm trong CÙNG một span: hàng này được phép
          * xuống dòng, và khi tách rời thì dấu chấm ở lại cuối hàng trên còn
          * chữ rơi xuống hàng dưới - một cái chấm lẻ sau tên chủ phòng.
          */}
        {missing > 0 && freeSeats > 0 && (
          <span className="inline-flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-amber-300/50" />
            <span className="min-w-0">Gửi mã phòng cho bạn bè để đủ người</span>
          </span>
        )}
      </div>

      {/*
        * Tiến độ tối thiểu chỉ hiện khi CÒN THIẾU người.
        *
        * Đủ người rồi mà vẫn để một thanh đầy 100% nằm đó thì nó thành trang
        * trí, và mắt vẫn phải dừng lại đọc xem nó đang đo cái gì.
        */}
      {missing > 0 && (
        <div
          className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuenow={count}
          aria-valuemin={0}
          aria-valuemax={MIN_PLAYERS_TO_START}
          aria-label={`${count} trên ${MIN_PLAYERS_TO_START} người tối thiểu`}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-300 transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </header>
  );
}
