import { m } from "motion/react";
import type { NightRecap } from "@masoi/shared";
import { cursedTurnedText } from "@/lib/cursed";
import { listItemMotion } from "@/lib/motion";

const causeLabel = (cause: "wolf" | "poison" | "priest" | "priest_backfire") => {
  switch (cause) {
    case "wolf":
      return "bị Sói cắn";
    case "poison":
      return "trúng độc của Phù Thủy";
    case "priest":
      return "bị Linh Mục thanh tẩy bằng Nước thánh";
    case "priest_backfire":
      return "chết do phản phệ Nước thánh";
    default:
      return "tử vong trong đêm";
  }
};

/** Màu chip theo vai, dùng đúng bảng màu phe đang dùng ở mọi chỗ khác. */
const ACTOR_STYLE: Record<string, string> = {
  Sói: "bg-blood-600/25 text-blood-400",
  "Bảo Vệ": "bg-sky-900/50 text-sky-300",
  "Tiên Tri": "bg-indigo-900/50 text-indigo-300",
  "Phù Thủy": "bg-emerald-900/50 text-emerald-300",
  Nguyền: "bg-amber-900/50 text-amber-300",
  "Thiên Thần": "bg-cyan-900/50 text-cyan-300",
  "Thám Tử": "bg-violet-900/50 text-violet-300",
  "Linh Mục": "bg-rose-900/50 text-rose-300",
};

function Line({ actor, children }: { actor: string; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2">
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
          ACTOR_STYLE[actor] ?? "bg-night-700 text-mist-bright"
        }`}
      >
        {actor}
      </span>
      <span className="min-w-0 text-mist-strong">{children}</span>
    </li>
  );
}

/**
 * Diễn biến từng đêm.
 *
 * Chip vai thay cho emoji đầu dòng: emoji không có màu theo phe, không thẳng
 * hàng, và ở cỡ chữ nhỏ thì 🧪 với ☠️ gần như không phân biệt được trên điện
 * thoại. Chip thì quét mắt xuống cột trái là ra ngay ai làm gì.
 */
export function NightRecapTimeline({ nights }: { nights: NightRecap[] }) {
  return (
    <div className="card">
      <h3 className="mb-3 font-display text-lg font-bold text-white">Diễn biến các đêm</h3>
      {nights.length === 0 ? (
        <p className="text-sm text-mist-strong">Ván đấu kết thúc trước khi có diễn biến ban đêm.</p>
      ) : (
        // Thanh dọc bên trái nối các đêm thành một mạch thời gian thay vì mấy
        // khối rời nhau.
        <ol className="relative space-y-3 border-l border-night-600/70 pl-4">
          {nights.map((night, index) => {
            const died = night.deaths.length > 0;
            return (
              <m.li
                key={night.round}
                {...listItemMotion(index, nights.length)}
                className="relative"
              >
                <span
                  className={`absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full ring-4 ring-night-900 ${
                    died ? "bg-blood-500" : "bg-emerald-500/70"
                  }`}
                />
                <section className="rounded-lg border border-white/[0.04] bg-night-800/50 px-3 py-2.5 text-sm">
                  <h4 className="mb-2 font-display text-base font-bold text-mist">
                    Đêm {night.round}
                  </h4>
                  <ul className="space-y-1.5">
                    <Line actor="Sói">
                      {night.wolfTarget ? (
                        <>
                          cắn <b className="text-white">{night.wolfTarget.name}</b>
                          {night.wolfSecondaryTarget && (
                            <>
                              {" "}và <b className="text-white">{night.wolfSecondaryTarget.name}</b> (cắn kép)
                            </>
                          )}
                        </>
                      ) : (
                        "không chọn được mục tiêu"
                      )}
                    </Line>
                    <Line actor="Bảo Vệ">
                      {night.guardTarget ? (
                        <>đỡ cho <b className="text-white">{night.guardTarget.name}</b></>
                      ) : (
                        "không hành động"
                      )}
                    </Line>
                    {night.guardianAngelTarget && (
                      <Line actor="Thiên Thần">
                        bảo vệ <b className="text-white">{night.guardianAngelTarget.name}</b>
                      </Line>
                    )}
                    {night.seerChecks.length > 0 ? (
                      night.seerChecks.map((check) => (
                        <Line key={`${check.seer.id}-${check.target.id}`} actor="Tiên Tri">
                          {check.seer.name} soi <b className="text-white">{check.target.name}</b>{" "}
                          <span className={check.isWolf ? "text-blood-400" : "text-emerald-300"}>
                            {check.isWolf ? "→ là Ma Sói" : "→ không phải Ma Sói"}
                          </span>
                          {check.secondaryTarget && (
                            <>
                              , soi thêm <b className="text-white">{check.secondaryTarget.name}</b>{" "}
                              <span className={check.secondaryIsWolf ? "text-blood-400" : "text-emerald-300"}>
                                {check.secondaryIsWolf ? "→ là Ma Sói" : "→ không phải Ma Sói"}
                              </span>
                            </>
                          )}
                        </Line>
                      ))
                    ) : (
                      <Line actor="Tiên Tri">không hành động</Line>
                    )}
                    {night.detectiveChecks?.map((check) => (
                      <Line key={`${check.detective.id}-${check.target1.id}`} actor="Thám Tử">
                        {check.detective.name} kiểm tra <b className="text-white">{check.target1.name}</b> và{" "}
                        <b className="text-white">{check.target2.name}</b>{" "}
                        <span className={check.sameTeam ? "text-amber-300" : "text-emerald-300"}>
                          {check.sameTeam ? "→ cùng phe" : "→ khác phe"}
                        </span>
                      </Line>
                    ))}
                    <Line actor="Phù Thủy">
                      {night.witch.usedHeal
                        ? night.witch.healedTarget
                          ? <>cứu <b className="text-white">{night.witch.healedTarget.name}</b></>
                          : "đốt bình cứu nhưng không có nạn nhân"
                        : "không dùng bình cứu"}
                      {night.witch.poisonTarget ? (
                        <>
                          , đầu độc <b className="text-white">{night.witch.poisonTarget.name}</b>
                        </>
                      ) : (
                        ", không dùng bình độc"
                      )}
                    </Line>
                    {night.priest && (
                      <Line actor="Linh Mục">
                        {night.priest.priest.name} dùng Nước thánh lên{" "}
                        <b className="text-white">{night.priest.target.name}</b>{" "}
                        <span className={night.priest.isWolf ? "text-blood-400" : "text-emerald-300"}>
                          {night.priest.isWolf
                            ? "→ là Ma Sói, đã bị thanh tẩy"
                            : "→ không phải Ma Sói, nước thánh phản phệ"}
                        </span>
                      </Line>
                    )}
                    {(() => {
                      const turned = cursedTurnedText(night);
                      return turned ? <Line actor="Nguyền">{turned}</Line> : null;
                    })()}
                  </ul>

                  <p
                    className={`mt-2.5 border-t border-white/[0.06] pt-2 text-sm font-semibold ${
                      died ? "text-blood-400" : "text-emerald-300"
                    }`}
                  >
                    {died
                      ? night.deaths
                          .map(({ player, cause }) => `${player.name} (${causeLabel(cause)})`)
                          .join(", ")
                      : "Không ai chết trong đêm này"}
                  </p>
                </section>
              </m.li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
