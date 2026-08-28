"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { assignAvatars, tintFor } from "@/lib/avatar";
import { voteFlightsFor } from "@/lib/vote-motion";
import { PlayerSeat } from "./PlayerSeat";
import { VoteFlightLayer, type Point, type VoteFlightSpec } from "./VoteFlightLayer";

/** Không biết ai bỏ thì lá phiếu rơi từ đây xuống, tính từ tâm ghế đích. */
const ANONYMOUS_DROP_PX = 54;

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

  const gridRef = useRef<HTMLDivElement>(null);
  const seatEls = useRef(new Map<string, HTMLButtonElement>());
  const lastSnapshot = useRef<RoomSnapshot | null>(null);
  const flightSeq = useRef(0);
  const [flights, setFlights] = useState<VoteFlightSpec[]>([]);

  useEffect(() => {
    const previous = lastSnapshot.current;
    lastSnapshot.current = snapshot;

    const cast = voteFlightsFor(previous, snapshot);
    if (cast.length === 0) return;
    // Chuyển động này chỉ nhắc lại điều huy hiệu số phiếu đã nói, nên tắt hẳn
    // vẫn chơi đủ. Bỏ qua từ đây thay vì để MotionConfig hạ xuống fade tại chỗ:
    // một lá phiếu nhấp nháy đứng yên thì khó hiểu hơn là không có gì.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const grid = gridRef.current;
    if (!grid) return;
    const base = grid.getBoundingClientRect();
    const centerOf = (playerId: string): Point | null => {
      const el = seatEls.current.get(playerId);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left - base.left + rect.width / 2,
        y: rect.top - base.top + rect.height / 2,
      };
    };

    const spawned: VoteFlightSpec[] = [];
    for (const flight of cast) {
      // Ghế không có trong lưới này thì bỏ qua - "Không treo ai" là một nút
      // riêng bên dưới, và người đã rời phòng thì không còn ô nào.
      const to = centerOf(flight.targetKey);
      if (!to) continue;
      const from = (flight.voterId ? centerOf(flight.voterId) : null) ?? {
        x: to.x,
        y: to.y - ANONYMOUS_DROP_PX,
      };
      spawned.push({ id: (flightSeq.current += 1), from, to });
    }
    if (spawned.length > 0) setFlights((current) => [...current, ...spawned]);
  }, [snapshot]);

  const dropFlight = useCallback((id: number) => {
    setFlights((current) => current.filter((flight) => flight.id !== id));
  }, []);

  return (
    // Lưới này giờ chỉ nằm ở cột nội dung - cột phụ dùng RosterPanel - nên từ lg
    // trở lên nó thật sự rộng ra và cần thêm cột, nếu không mỗi ô phình tới hơn
    // 200px. Dưới lg vẫn ba cột như trên điện thoại.
    <div
      ref={gridRef}
      className="relative grid grid-cols-3 gap-2 lg:grid-cols-4 xl:grid-cols-5"
    >
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
            seatRef={(el) => {
              if (el) seatEls.current.set(player.id, el);
              else seatEls.current.delete(player.id);
            }}
          />
        );
      })}
      <VoteFlightLayer flights={flights} onLanded={dropFlight} />
    </div>
  );
}
