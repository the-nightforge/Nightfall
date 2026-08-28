"use client";

import { useMemo } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { assignAvatars, tintFor } from "@/lib/avatar";
import { PlayerSeat } from "./PlayerSeat";

interface Props {
  snapshot: RoomSnapshot;
  selectable?: boolean;
  selectedId?: string | null;
  onSelect?: (playerId: string) => void;
  disabledIds?: string[];
  /** Bảo Vệ được tự bảo vệ mình, nên vài lưới đêm phải mở ô của chính người chơi. */
  allowSelf?: boolean;
}

export function PlayerGrid({
  snapshot,
  selectable,
  selectedId,
  onSelect,
  disabledIds = [],
  allowSelf = false,
}: Props) {
  // snapshot.you thay cho getIdentity(): id của chính người xem đã nằm sẵn
  // trong snapshot, không việc gì phải đọc localStorage ở mỗi lần render.
  const meId = snapshot.you?.id ?? null;

  // Gán lại chỉ khi TẬP người chơi đổi. Lưới này render lại theo từng lá phiếu,
  // mà bảng ảnh đại diện thì không phụ thuộc vào phiếu.
  const roster = snapshot.players.map((p) => p.id).join(",");
  const avatars = useMemo(
    () => assignAvatars(roster ? roster.split(",") : []),
    [roster],
  );

  return (
    // Ba cột cố định: breakpoint sm/lg bám VIEWPORT chứ không bám container, mà
    // container thì luôn bị khoá ở max-w-lg - thêm cột chỉ làm ô teo lại trên
    // desktop chứ không tận dụng thêm được chỗ nào.
    <div className="grid grid-cols-3 gap-2">
      {snapshot.players.map((player) => {
        const isMe = player.id === meId;
        const disabled =
          !selectable ||
          !player.alive ||
          (isMe && !allowSelf) ||
          disabledIds.includes(player.id);
        return (
          <PlayerSeat
            key={player.id}
            player={player}
            avatar={avatars[player.id]}
            tint={tintFor(player.id)}
            isMe={isMe}
            isHost={snapshot.hostId === player.id}
            selected={selectedId === player.id}
            disabled={disabled}
            onSelect={onSelect ? () => onSelect(player.id) : undefined}
          />
        );
      })}
    </div>
  );
}
