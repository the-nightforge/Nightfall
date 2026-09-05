import { m } from "motion/react";
import { deathCauseClause, type NightRecap, type RoomConfig } from "@masoi/shared";
import { cursedTurnedText } from "@/lib/cursed";

import { rolesInRecap, sorcererChecksOf } from "@/lib/night-recap-roles";
import { listItemMotion } from "@/lib/motion";

/** Màu chip theo vai, dùng đúng bảng màu phe đang dùng ở mọi chỗ khác. */
const ACTOR_STYLE: Record<string, string> = {
  Sói: "bg-blood-600/25 text-blood-400",
  "Bảo Vệ": "bg-sky-900/50 text-sky-300",
  "Tiên Tri": "bg-indigo-900/50 text-indigo-300",
  "Phù Thủy": "bg-emerald-900/50 text-emerald-300",
  Nguyền: "bg-amber-900/50 text-amber-300",
  "Thiên Thần": "bg-cyan-900/50 text-cyan-300",
  "Thám Tử": "bg-violet-900/50 text-violet-300",
  "Sói Pháp Sư": "bg-violet-950/60 text-violet-300",
  // Đỏ thẫm ngả tím, cùng sắc mà màn hồi ức 3D dùng cho nếp nhà của Sát Nhân:
  // gần với Sói vì nó cũng giết, nhưng không phải sắc của bầy.
  "Sát Nhân": "bg-fuchsia-950/60 text-fuchsia-300",
};

/**
 * Vế KẾT QUẢ của một dòng, tách khỏi vế hành động bằng gạch ngang.
 *
 * Bản cũ dùng mũi tên "→" giữa câu: đó là ký hiệu của một bảng tra, không phải
 * của một câu kể, và khi đọc thành tiếng thì không có gì để đọc. Gạch ngang dài
 * đọc được thành một nhịp ngắt, nên "Tiên Tri soi Nhật Minh — không phải Ma
 * Sói." là một câu hoàn chỉnh chứ không phải một dòng dữ liệu.
 *
 * Màu vẫn theo nghĩa: xanh là tin lành cho phe làng, đỏ là tin dữ, hổ phách
 * dành cho kết quả không ngả về bên nào (Thám Tử báo "cùng phe" chỉ nói hai
 * người đó giống nhau, không nói giống nhau ở phe NÀO).
 */
function Verdict({ tone, children }: { tone: "good" | "bad" | "warn"; children: React.ReactNode }) {
  const color =
    tone === "bad" ? "text-blood-400" : tone === "warn" ? "text-amber-300" : "text-emerald-300";
  return (
    <span className={color}>
      <span aria-hidden="true">— </span>
      {children}.
    </span>
  );
}

/**
 * Dòng Phù Thủy.
 *
 * Hai bình được kể trong MỘT câu, và chỉ kể bình nào có chuyện. Bản cũ luôn in
 * đủ hai vế, nên một đêm Phù Thủy ngồi im ra thành "không dùng bình cứu, không
 * dùng bình độc" - hai lần phủ định nối bằng dấu phẩy, đọc như một biên bản
 * kiểm kho. Ngồi im giờ là một câu: "không sử dụng Bình Cứu hoặc Bình Độc."
 *
 * Tên hai bình viết hoa như tên riêng của vật phẩm.
 */
function WitchLine({ witch }: { witch: NightRecap["witch"] }) {
  const heal = witch.usedHeal ? (
    witch.healedTarget ? (
      <>
        dùng Bình Cứu cho <b className="text-white">{witch.healedTarget.name}</b>
      </>
    ) : (
      <>dùng Bình Cứu nhưng không có nạn nhân để cứu</>
    )
  ) : null;

  const poison = witch.poisonTarget ? (
    <>
      dùng Bình Độc lên <b className="text-white">{witch.poisonTarget.name}</b>
    </>
  ) : null;

  if (!heal && !poison) return <>không sử dụng Bình Cứu hoặc Bình Độc.</>;

  return (
    <>
      {heal}
      {heal && poison ? ", " : null}
      {poison}.
    </>
  );
}

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
 *
 * `config` quyết định vai nào có dòng. Không truyền cũng chạy được - server cũ
 * deploy lệch thì `rolesInRecap` rơi về đúng những vai đã để lại dấu vết.
 *
 * MỘT khuôn câu cho mọi dòng: VAI (chip) + hành động + mục tiêu + kết quả, kết
 * bằng dấu chấm.
 *
 *   Sói        cắn Nhật Minh.
 *   Bảo Vệ     bảo vệ Hải Yến.
 *   Tiên Tri   Hải Yến soi Nhật Minh — không phải Ma Sói.
 *   Thám Tử    Minh kiểm tra Nhật Minh và Đức Thắng — khác phe.
 *   Phù Thủy   không sử dụng Bình Cứu hoặc Bình Độc.
 *
 * Bản cũ trộn ba lối viết trong cùng một khối: có dòng là câu ("cứu X"), có
 * dòng là mục từ điển ("→ không phải Ma Sói"), có dòng là ô bảng ("Nhật Minh
 * (bị Sói cắn)"). Mỗi lối một mình thì đọc được, nhưng xếp chồng lên nhau thì
 * mắt phải đổi cách đọc ở từng dòng.
 *
 * Câu sinh từ DỮ LIỆU trận, không có tên người hay tên vai nào viết cứng ở đây.
 */
export function NightRecapTimeline({
  nights,
  config,
}: {
  nights: NightRecap[];
  config?: RoomConfig;
}) {
  const roles = rolesInRecap(nights, config);
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
            const sorcererChecks = sorcererChecksOf(night);
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
                          .
                        </>
                      ) : (
                        "không chọn được mục tiêu."
                      )}
                    </Line>
                    {roles.guard && (
                      <Line actor="Bảo Vệ">
                        {night.guardTarget ? (
                          <>bảo vệ <b className="text-white">{night.guardTarget.name}</b>.</>
                        ) : (
                          "không bảo vệ ai."
                        )}
                      </Line>
                    )}
                    {roles.guardianAngel && (
                      <Line actor="Thiên Thần">
                        {night.guardianAngelTarget ? (
                          <>
                            dùng khiên hộ mệnh cho{" "}
                            <b className="text-white">{night.guardianAngelTarget.name}</b>.
                          </>
                        ) : (
                          "không dùng khiên hộ mệnh."
                        )}
                      </Line>
                    )}
                    {roles.seer &&
                      (night.seerChecks.length > 0 ? (
                        night.seerChecks.map((check) => (
                          <Line key={`${check.seer.id}-${check.target.id}`} actor="Tiên Tri">
                            {check.seer.name} soi <b className="text-white">{check.target.name}</b>{" "}
                            {/* `team` mới nói đủ: "không phải Ma Sói" đúng với
                              * một vai trung lập nhưng đọc ra như một lời bảo
                              * lãnh cho phe làng, và dòng thời gian này là bản
                              * kể lại chính xác của ván vừa xong. Ván ghi trước
                              * bản này không có `team` và rơi về câu cũ. */}
                            <Verdict
                              tone={
                                check.team === "neutral" ? "warn" : check.isWolf ? "bad" : "good"
                              }
                            >
                              {check.team === "neutral"
                                ? "thuộc phe trung lập"
                                : check.isWolf
                                  ? "là Ma Sói"
                                  : "không phải Ma Sói"}
                            </Verdict>
                            {check.secondaryTarget && (
                              <>
                                {" "}Soi thêm <b className="text-white">{check.secondaryTarget.name}</b>{" "}
                                <Verdict tone={check.secondaryIsWolf ? "bad" : "good"}>
                                  {check.secondaryIsWolf ? "là Ma Sói" : "không phải Ma Sói"}
                                </Verdict>
                              </>
                            )}
                          </Line>
                        ))
                      ) : (
                        <Line actor="Tiên Tri">không soi ai.</Line>
                      ))}
                    {roles.detective &&
                      ((night.detectiveChecks?.length ?? 0) > 0 ? (
                        night.detectiveChecks?.map((check) => (
                          <Line key={`${check.detective.id}-${check.target1.id}`} actor="Thám Tử">
                            {check.detective.name} kiểm tra <b className="text-white">{check.target1.name}</b> và{" "}
                            <b className="text-white">{check.target2.name}</b>{" "}
                            <Verdict tone={check.sameTeam ? "warn" : "good"}>
                              {check.sameTeam ? "cùng phe" : "khác phe"}
                            </Verdict>
                          </Line>
                        ))
                      ) : (
                        <Line actor="Thám Tử">không kiểm tra ai.</Line>
                      ))}
                    {roles.witch && (
                      <Line actor="Phù Thủy">
                        <WitchLine witch={night.witch} />
                      </Line>
                    )}
                    {roles.sorcerer &&
                      (sorcererChecks.length > 0 ? (
                        sorcererChecks.map((check) => (
                          <Line key={`${check.sorcerer.id}-${check.target.id}`} actor="Sói Pháp Sư">
                            {check.sorcerer.name} kiểm tra{" "}
                            <b className="text-white">{check.target.name}</b>{" "}
                            <Verdict tone={check.isSeerLine ? "bad" : "good"}>
                              {check.isSeerLine
                                ? "thuộc dòng Tiên Tri"
                                : "không thuộc dòng Tiên Tri"}
                            </Verdict>
                          </Line>
                        ))
                      ) : (
                        <Line actor="Sói Pháp Sư">không kiểm tra ai.</Line>
                      ))}
                    {roles.serialKiller && (
                      <Line actor="Sát Nhân">
                        {night.serialKillerTarget ? (
                          <>
                            ra tay với{" "}
                            <b className="text-white">{night.serialKillerTarget.name}</b>.
                          </>
                        ) : (
                          "không ra tay đêm nay."
                        )}
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
                          .map(({ player, cause }) => `${player.name} ${deathCauseClause(cause)} và đã chết.`)
                          .join(" ")
                      : "Không ai chết trong đêm này."}
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
