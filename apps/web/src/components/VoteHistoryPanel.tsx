import type { DayVoteRecap, RoomSnapshot } from "@masoi/shared";
import { assignAvatars, tintFor } from "@/lib/avatar";
import { Avatar } from "./Avatar";
import { useMemo } from "react";

interface Props {
  recap: DayVoteRecap;
  players: RoomSnapshot["players"];
  /**
   * Bị cáo đang bị soi. Phiếu nhắm vào người này sáng lên, phần còn lại lùi ra
   * sau - trong pha biện hộ cả bảng lịch sử chỉ tồn tại để trả lời đúng câu
   * "vì sao lại là người đó", nên mọi dòng khác là nhiễu.
   */
  highlightTargetId?: string | null;
  /**
   * Bỏ vỏ thẻ và dòng tiêu đề.
   *
   * Dùng khi bảng này nằm trong phần bung ra của một thẻ khác: hai lớp `.card`
   * lồng nhau tạo ra hai đường viền cách nhau 16px và đọc ra như một lỗi dựng
   * hình, còn hai dòng tiêu đề chồng nhau thì nói cùng một chuyện hai lần.
   */
  bare?: boolean;
}

export function VoteHistoryPanel({ recap, players, highlightTargetId, bare }: Props) {
  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const avatars = useMemo(() => assignAvatars(players.map((p) => p.id)), [players]);

  const body = (
    <>
      {recap.mutations.length === 0 ? (
        <p className="text-sm text-mist-strong">Không có ai bỏ phiếu.</p>
      ) : (
        // Một vòng sôi nổi có thể có hai ba chục lần đổi phiếu. Cho nó cuộn
        // trong một vùng cao vừa phải thay vì đẩy cả cột dài thêm một màn hình.
        <div className="lobby-roster-scroll flex max-h-44 flex-wrap gap-1.5 overflow-y-auto overscroll-contain pr-1">
          {recap.mutations.map((m) => {
            const voter = playerMap.get(m.voterId);
            const isNoElim = m.choice.type === "NO_ELIMINATION";
            const targetId = m.choice.type === "PLAYER" ? m.choice.targetId : null;
            const target = targetId ? playerMap.get(targetId) : null;
            const hit = !!highlightTargetId && targetId === highlightTargetId;
            return (
              <div
                key={m.id}
                className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 ${
                  hit
                    ? "border-amber-400/50 bg-amber-500/[0.12]"
                    : highlightTargetId
                      ? // Không phải "làm mờ": chữ vẫn ở mist-strong, chỉ cái
                        // VỎ lùi lại. Một dòng dữ liệu bị hạ xuống dưới ngưỡng
                        // đọc được thì nó không còn là thông tin phụ nữa, nó
                        // là thông tin mất.
                        "border-white/[0.06] bg-night-800/50"
                      : "border-white/10 bg-night-800"
                }`}
              >
                <Avatar avatar={avatars[m.voterId]} tint={tintFor(m.voterId)} alive className="h-6 w-6 shrink-0" />
                <span className="max-w-[7rem] truncate text-[13px] font-semibold text-white">
                  {voter?.name ?? "?"}
                </span>
                <span aria-hidden="true" className="text-mist-strong">→</span>
                {isNoElim ? (
                  <span className="text-[13px] text-mist-strong" title="Không treo ai">
                    <span aria-hidden="true">🚫</span>
                    <span className="sr-only">Không treo ai</span>
                  </span>
                ) : (
                  <>
                    <Avatar avatar={avatars[targetId!]} tint={tintFor(targetId!)} alive className="h-6 w-6 shrink-0" />
                    <span
                      className={`max-w-[7rem] truncate text-[13px] ${
                        hit ? "font-semibold text-amber-100" : "text-mist-bright"
                      }`}
                    >
                      {target?.name ?? "?"}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {recap.finalJudgment && (
        <div className="border-t border-white/[0.08] pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-mist-bright">
            Phán quyết · {recap.finalJudgment.guilty} treo · {recap.finalJudgment.innocent} tha · {recap.finalJudgment.abstain} bỏ qua
          </p>
          {recap.finalJudgment.ballots.length === 0 ? (
            <p className="text-sm text-mist-strong">Không có phiếu xác nhận.</p>
          ) : (
            <div className="lobby-roster-scroll flex max-h-44 flex-wrap gap-1.5 overflow-y-auto overscroll-contain pr-1">
              {recap.finalJudgment.ballots.map((b) => {
                const voter = playerMap.get(b.voterId);
                return (
                  <div
                    key={b.voterId}
                    className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 ${
                      b.guilty ? "border-blood-500/20 bg-blood-950/20" : "border-emerald-500/20 bg-emerald-950/20"
                    }`}
                  >
                    <Avatar avatar={avatars[b.voterId]} tint={tintFor(b.voterId)} alive className="h-6 w-6 shrink-0" />
                    <span className="max-w-[7rem] truncate text-[13px] font-semibold text-white">
                      {voter?.name ?? "?"}
                    </span>
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        b.guilty ? "bg-blood-600 text-white" : "bg-emerald-600 text-white"
                      }`}
                      title={b.guilty ? "Bỏ phiếu Treo" : "Bỏ phiếu Tha"}
                      aria-label={b.guilty ? "Bỏ phiếu Treo" : "Bỏ phiếu Tha"}
                      role="img"
                    >
                      <span aria-hidden="true">{b.guilty ? "✕" : "✓"}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );

  if (bare) return <div className="space-y-3">{body}</div>;

  return (
    <section className="card space-y-3" aria-label="Lịch sử phiếu">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-mist-bright">Lịch sử bỏ phiếu</p>
        </div>
        <span className="rounded-full bg-night-800 px-2 py-0.5 text-[13px] font-semibold text-mist-bright ring-1 ring-white/10">
          Vòng {recap.round}
        </span>
      </div>
      {body}
    </section>
  );
}
