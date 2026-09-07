"use client";

import type { RoomSnapshot } from "@masoi/shared";
import { eventGlyph } from "@/lib/event-art";
import { EventGlyph } from "./EventGlyph";

interface Props {
  snapshot: RoomSnapshot | null;
}

export function RightMetaPanel({ snapshot }: Props) {
  if (!snapshot || snapshot.phase === "LOBBY" || snapshot.phase === "GAME_OVER") return null;

  const hasEvent = !!snapshot.activeEvent;
  /*
   * Đêm vừa rồi chỉ nhắc lại ở những pha KHÔNG tự nói ra nó.
   *
   * Ở NIGHT_RESULT và DAY_DISCUSSION, thẻ giữa màn hình đã in đúng danh sách
   * người chết bằng cỡ chữ lớn; in lại ở đây là bắt người chơi đọc hai lần rồi
   * đi so xem hai bên có khác nhau chỗ nào không.
   */
  const hasNight =
    snapshot.lastNightDeaths.length > 0 &&
    snapshot.phase !== "NIGHT_RESULT" &&
    snapshot.phase !== "DAY_DISCUSSION";

  /*
   * Khối "Phiếu hiện tại" đã bị gỡ hẳn.
   *
   * Nó nói đúng ba việc: đang đề cử bao nhiêu phiếu (thanh pha đã có, kèm cả
   * mẫu số), ai là bị cáo và tỉ số Treo/Tha (TrialPanel ở cột giữa in cả hai
   * bằng cỡ chữ lớn hơn nhiều). Giữ lại chỉ là một bản sao mờ của thứ đang
   * đứng cách đó vài trăm pixel.
   */
  if (!hasEvent && !hasNight) return null;

  /*
   * Dải này là CHÂN của khu chơi, không còn là một thẻ trong cột chat.
   *
   * `mt-auto` đẩy nó xuống đáy cột: phần trống giữa thẻ bỏ phiếu và dải này
   * đọc ra thành khoảng thở có chủ đích của một cái bàn, thay vì một mảng
   * trống bỏ lửng ở nửa dưới màn hình. Nằm ngang thay vì xếp dọc vì ở đây bề
   * ngang mới là thứ dư dả.
   */
  return (
    <div className="hidden lg:mt-auto lg:flex lg:flex-wrap lg:items-start lg:gap-x-8 lg:gap-y-2 rounded-xl border border-night-600/50 bg-night-900/60 px-4 py-2.5 backdrop-blur">
      {/*
        * Chỉ NHẮC là có sự kiện, không chép lại nó.
        *
        * Bản cũ in đủ tên, mô tả và thông báo ở đây trong khi EventBanner cách
        * đó 300px đang in y hệt - người chơi đọc hai lần cùng một đoạn chữ rồi
        * đi tìm xem hai bên có khác nhau chỗ nào không. Toàn văn nằm ở thẻ sự
        * kiện, bấm vào là bung ra.
        */}
      {hasEvent && snapshot.activeEvent && (
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-300/90">Sự kiện</p>
          <p className="truncate text-sm font-semibold text-amber-200">
            <EventGlyph
              name={eventGlyph(snapshot.activeEvent.id)}
              className="mr-1 inline-block h-4 w-4 align-[-0.15em]"
            />
            {snapshot.activeEvent.name}
          </p>
          <p className="text-[13px] leading-snug text-mist-strong">
            {beneficiaryLabel(snapshot.activeEvent.beneficiary)}
          </p>
        </div>
      )}
      {hasNight && (
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-mist-strong">Đêm vừa rồi</p>
          <p className="truncate text-sm font-semibold text-blood-400">
            {snapshot.lastNightDeaths.map((d) => d.name).join(" · ")}{" "}
            <span className="font-normal text-mist-strong">đã mất</span>
          </p>
          {snapshot.lastEliminated && (
            <p className="truncate text-[13px] text-mist-strong">
              Treo cổ: <b className="text-white">{snapshot.lastEliminated.name}</b>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Ai được lợi, gọn trong một dòng. Chi tiết vì sao thì ở thẻ sự kiện. */
function beneficiaryLabel(beneficiary: "wolves" | "village" | "neutral"): string {
  if (beneficiary === "wolves") return "Có lợi cho phe Sói";
  if (beneficiary === "village") return "Có lợi cho phe Dân";
  return "Không nghiêng về phe nào";
}
