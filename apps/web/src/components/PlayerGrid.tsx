"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { assignAvatars, tintFor } from "@/lib/avatar";
import { voteFlightsFor } from "@/lib/vote-motion";
import { usePlayerNotes } from "@/lib/player-notes";
import { speakingSeatIds } from "@/lib/seat-voice";
import { PlayerSeat } from "./PlayerSeat";
import { useSpeakers } from "./VoiceProvider";
import { VoteFlightLayer, type Point, type VoteFlightSpec } from "./VoteFlightLayer";

/** Không biết ai bỏ thì lá phiếu rơi từ đây xuống, tính từ tâm ghế đích. */
const ANONYMOUS_DROP_PX = 54;

interface Props {
  snapshot: RoomSnapshot;
  selectable?: boolean;
  selectedId?: string | null;
  selectedIds?: string[];
  /** Ô đang giữ lá phiếu ĐÃ GỬI của người xem; xem PlayerSeat.confirmed. */
  confirmedId?: string | null;
  onSelect?: (playerId: string) => void;
  disabledIds?: string[];
  /**
   * Vì sao những ô trong `disabledIds` không bấm được.
   *
   * Bỏ trống thì rơi về một câu chung. Câu chung đó đúng nhưng rỗng nghĩa ở
   * đúng chỗ cần nghĩa nhất: lưới đêm của phe Sói tắt ô của đồng đội, và một
   * con Sói mới chơi rê chuột vào đó chỉ đọc được "không thể chọn người này
   * lúc này" - không nói ra là ô đó KHÔNG BAO GIỜ chọn được, cũng không nói ra
   * người đó là đồng đội.
   */
  disabledIdsReason?: string;
  /** Bảo Vệ được tự bảo vệ mình, nên vài lưới đêm phải mở ô của chính người chơi. */
  allowSelf?: boolean;
}

export function PlayerGrid({
  snapshot,
  selectable,
  selectedId,
  selectedIds,
  confirmedId = null,
  onSelect,
  disabledIds = [],
  disabledIdsReason,
  allowSelf = false,
}: Props) {
  // snapshot.you thay cho getIdentity(): id của chính người xem đã nằm sẵn
  // trong snapshot, không việc gì phải đọc localStorage ở mỗi lần render.
  const meId = snapshot.you?.id ?? null;
  // Dấu ghi chú riêng của người xem; đổi dấu thì làm ở cột Người chơi.
  const { notes } = usePlayerNotes(snapshot.code);

  // Gán lại chỉ khi TẬP người chơi đổi. Lưới này render lại theo từng lá phiếu,
  // mà bảng ảnh đại diện thì không phụ thuộc vào phiếu.
  const roster = snapshot.players.map((p) => p.id).join(",");
  const avatars = useMemo(
    () => assignAvatars(roster ? roster.split(",") : []),
    [roster],
  );

  /*
   * Ai đang nói, lọc một lần cho cả lưới.
   *
   * Ở tầng này chứ không ở từng ô: `useSpeakers` đọc context và `speakingSeatIds`
   * duyệt cả danh sách, làm việc đó mười lăm lần cho mười lăm ô là mười lăm lần
   * duyệt thừa trên một component vốn đã render lại theo từng lá phiếu.
   *
   * Trả về `EMPTY` khi ở ngoài `VoiceProvider`, nên mọi lưới chưa nối voice -
   * và mọi test mount thẳng lưới - vẫn chạy y như trước.
   */
  const speakers = useSpeakers();
  const speakingIds = useMemo(
    () => speakingSeatIds({ speakers, players: snapshot.players, phase: snapshot.phase }),
    [speakers, snapshot.players, snapshot.phase],
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
    <div
      ref={gridRef}
      /*
       * Ô to hơn hẳn từ sm trở lên.
       *
       * 96px là cỡ của một danh sách, không phải của một cái bàn: ở đó tên
       * người chơi phải xuống 11px và huy hiệu số phiếu chỉ còn bằng đầu ngón
       * tay út.
       *
       * Sàn 120px ở xl là con số đo được chứ không phải chọn cho tròn: ở 1280px
       * - viewport hẹp nhất còn dùng bố cục ba cột - lưới ghế thật sự rộng
       * 544px sau khi trừ hai cột biên, đệm thẻ và thanh cuộn. 128px cho ra 3
       * cột (thiếu đúng vài pixel để thành 4), còn 120px cho 4 cột ô ~128px.
       */
      className="relative grid grid-cols-[repeat(auto-fit,minmax(94px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fit,minmax(112px,1fr))] sm:gap-3.5 xl:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]"
    >
      {snapshot.players.map((player) => {
          const isMe = player.id === meId;
          const wrongSide = !player.alive;
          const disabled =
            !selectable ||
            wrongSide ||
            (isMe && !allowSelf) ||
            disabledIds.includes(player.id);
          /*
           * Vì sao ô này bấm không được.
           *
           * Một ô tắt mà không nói lý do thì không phân biệt được với một ô
           * hỏng - nhất là ô của CHÍNH mình, thứ mà người chơi thử bấm đầu
           * tiên. Chỉ có lý do khi lưới đang ở chế độ chọn: ngoài pha bỏ phiếu
           * thì cả lưới vốn chỉ để xem, và lúc đó "không chọn được" không phải
           * một trạng thái cần giải thích.
           */
          const disabledReason = !selectable
            ? null
            : wrongSide
              ? "Người này đã chết"
              : isMe && !allowSelf
                ? "Không thể chọn chính mình"
                : disabledIds.includes(player.id)
                  ? disabledIdsReason ?? "Không thể chọn người này lúc này"
                  : null;
          const isSelected =
            selectedIds?.includes(player.id) ?? (selectedId === player.id);
          return (
            <PlayerSeat
              key={player.id}
              player={player}
              avatar={avatars[player.id]}
              tint={tintFor(player.id)}
              isMe={isMe}
              isHost={snapshot.hostId === player.id}
              selected={isSelected}
              confirmed={isSelected && player.id === confirmedId}
              disabled={disabled}
              disabledReason={disabledReason}
              mark={notes[player.id]}
              isSpeaking={speakingIds.has(player.id)}
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
