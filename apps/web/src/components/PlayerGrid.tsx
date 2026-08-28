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
    // Lưới này giờ chỉ nằm ở cột nội dung - cột phụ dùng RosterPanel - nên từ lg
    // trở lên nó thật sự rộng ra và cần thêm cột, nếu không mỗi ô phình tới hơn
    // 200px. Dưới lg vẫn ba cột như trên điện thoại.
    <div className="grid grid-cols-3 gap-2 lg:grid-cols-4">
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
