"use client";

import { useEffect, useState } from "react";
import { isWolfPack, ROLE_META, type RoomSnapshot } from "@masoi/shared";
import { PlayerGrid } from "./PlayerGrid";
import { canActAtNight } from "@/lib/night-role";
import { seerReading } from "@/lib/seer-reading";
import {
  WOLF_TALLY_EMPTY,
  wolfBiteLabel,
  wolfSkipLabel,
  wolfTallyProgress,
} from "@/lib/wolf-action";
import { CursedNote } from "./RoleViews";
import { PHASE_ACTION_ATTR } from "@/lib/phase-action";

interface Props {
  snapshot: RoomSnapshot;
  onAction: (type: string, targetId?: string | null, secondaryTargetId?: string | null) => void;
}

export function NightPanel({ snapshot, onAction }: Props) {
  const role = snapshot.you?.role;
  const night = snapshot.night;
  const [selected, setSelected] = useState<string | null>(null);
  const [wolfSecondary, setWolfSecondary] = useState<string | null>(null);
  /** Người thứ hai của Bảo Vệ; chỉ dùng trong sự kiện Đêm Cảnh Giác. */
  const [guardSecondary, setGuardSecondary] = useState<string | null>(null);
  /** Người thứ hai của Tiên Tri; chỉ dùng trong sự kiện Màn Sương Tan. */
  const [seerSecondary, setSeerSecondary] = useState<string | null>(null);
  const [detectiveTarget1, setDetectiveTarget1] = useState<string | null>(null);
  const [detectiveTarget2, setDetectiveTarget2] = useState<string | null>(null);
  /** Mục tiêu kiểm tra dòng Tiên Tri của Sói Pháp Sư; riêng khỏi `selected`
   *  vì lá này MỖI ĐÊM CÓ HAI VIỆC: một phiếu cắn cùng bầy (dùng `selected`)
   *  và một lượt kiểm tra riêng - chung một ô chọn thì bấm bên này đổi bên kia. */
  const [sorcererTarget, setSorcererTarget] = useState<string | null>(null);
  const [poisoning, setPoisoning] = useState(false);
  /*
   * Phiếu cắn vừa gửi mà snapshot chưa xác nhận.
   *
   * Cùng cách xử lý với lá phiếu ban ngày (`DayView`): `game:action` là một
   * event socket không có phản hồi trực tiếp, nên bằng chứng duy nhất rằng máy
   * chủ đã nhận là snapshot kế tiếp. Không có trạng thái này thì bấm nhanh ba
   * cái là bắn ba event y hệt nhau, và người chơi không có dấu hiệu nào cho
   * biết cú bấm đầu đã đi.
   *
   * KHÔNG đổi payload, không đổi tên event, không đoán trước kết quả.
   */
  const [pendingWolfVote, setPendingWolfVote] = useState<{ target: string | null } | null>(null);

  const wolfVoteOnServer = snapshot.night?.acted ? (snapshot.night.myWolfVote ?? null) : undefined;
  useEffect(() => {
    if (!pendingWolfVote) return;
    // Snapshot đã mang đúng lá phiếu vừa gửi -> hết chờ.
    if (wolfVoteOnServer !== undefined && wolfVoteOnServer === pendingWolfVote.target) {
      setPendingWolfVote(null);
      return;
    }
    /*
     * Chốt chặn: máy chủ có thể từ chối phiếu (bầy vừa bị chốt, người chơi vừa
     * chết) và khi đó snapshot không bao giờ khớp. Thiếu hạn này thì nút kẹt ở
     * "đang gửi" tới hết đêm.
     */
    const timer = setTimeout(() => setPendingWolfVote(null), 4_000);
    return () => clearTimeout(timer);
  }, [pendingWolfVote, wolfVoteOnServer]);

  // Sang pha hoặc sang đêm khác thì mọi thứ đang chờ đều hết nghĩa.
  useEffect(() => setPendingWolfVote(null), [snapshot.phase, snapshot.round]);

  if (!snapshot.you?.alive) {
    return (
      <div className="card py-8 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-mist/85">Bạn đã chết</p>
        <h3 className="mt-2 font-display text-3xl font-bold text-mist/85">Khán đài</h3>
        <p className="mx-auto mt-2 max-w-xs text-sm text-mist-strong">
          Bạn xem được mọi kênh chat, kể cả kênh của Sói - nhưng chỉ nói được với
          những người đã chết.
        </p>
      </div>
    );
  }

  const meta = role ? ROLE_META[role] : null;
  const apprenticeAwakened = snapshot.night?.apprenticeAwakened ?? snapshot.apprenticeAwakened ?? false;

  // Dân thường hoặc vai không hành động đêm: chỉ ngủ
  if (!meta || !canActAtNight(role, apprenticeAwakened)) {
    return (
      <div className="card py-8 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-mist/85">Đêm thứ {snapshot.round}</p>
        <h3 className="mt-2 font-display text-3xl font-bold text-indigo-200">Bạn ngủ say</h3>
        {role === "APPRENTICE_SEER" && !apprenticeAwakened && (
          <p className="mx-auto mt-2 max-w-xs text-sm text-amber-300">
            Tiên Tri vẫn còn sống. Bạn đang trong giai đoạn tập sự và chưa thức tỉnh.
          </p>
        )}
        <p className="mx-auto mt-2 max-w-xs text-sm text-mist-strong">
          Không có gì để làm cho tới sáng. Hãy nghe ngóng xem sáng mai ai vắng mặt.
        </p>
        <div className="mt-4 text-left">
          <CursedNote snapshot={snapshot} />
        </div>
      </div>
    );
  }

  const acted = night?.acted ?? false;
  const locked = night?.wolvesLocked ?? false;
  const vigilantNight = snapshot.activeEvent?.id === "VIGILANT_NIGHT";
  const clearingMist = snapshot.activeEvent?.id === "CLEARING_MIST";
  const nameOf = (id: string | null | undefined) =>
    snapshot.players.find((p) => p.id === id)?.name ?? "?";
  const aliveOthers = (opts?: {
    selectable?: boolean;
    /** Ô sáng lên; bỏ trống thì dùng ý định đang chọn của người xem. */
    selectedId?: string | null;
    /** Ô mang lá phiếu ĐÃ gửi - dấu tích đổi từ "Đang chọn" sang "Phiếu của bạn". */
    confirmedId?: string | null;
    disabledIds?: string[];
    disabledIdsReason?: string;
    allowSelf?: boolean;
  }) => (
    <PlayerGrid
      snapshot={snapshot}
      selectable={opts?.selectable ?? !acted}
      selectedId={opts?.selectedId !== undefined ? opts.selectedId : selected}
      confirmedId={opts?.confirmedId ?? null}
      onSelect={setSelected}
      disabledIds={opts?.disabledIds}
      disabledIdsReason={opts?.disabledIdsReason}
      allowSelf={opts?.allowSelf}
    />
  );

  /*
   * Sói bỏ phiếu chứ không chốt, nên nhãn "Đã hành động" của các vai khác sẽ
   * nói sai. Sát Nhân cũng vậy nhưng vì lý do khác: nó đổi mục tiêu được tới
   * khi trời sáng, nên "đã hành động" đọc như một cánh cửa đã đóng.
   */
  const showActedBadge =
    acted &&
    role !== "WEREWOLF" &&
    role !== "WOLF_CUB" &&
    role !== "ALPHA_WOLF" &&
    role !== "SORCERER" &&
    role !== "SERIAL_KILLER";

  /*
   * Đồng đội trong phe Sói - những ô mà luật không cho nhắm tới.
   *
   * Lọc theo `ROLE_META[...].team` chứ không liệt kê tay từng vai Sói: bảng vai
   * là nơi duy nhất biết vai nào thuộc phe nào, và một vai Sói thêm vào sau này
   * sẽ tự được che ở đây thay vì lặng lẽ trở thành một mục tiêu bấm được.
   * `p.role` chỉ có mặt khi người xem LÀ Sói - snapshotFor giấu nó với mọi
   * người khác - nên danh sách này rỗng ở mọi vai khác, đúng như nó phải thế.
   */
  const wolfAllyIds = snapshot.players
    .filter((p) => p.role && ROLE_META[p.role].team === "wolves")
    .map((p) => p.id);

  const wolfSending = pendingWolfVote !== null;
  // Ô đang sáng: ý định chưa gửi, hoặc lá phiếu đã nằm trên bàn nếu chưa đổi ý.
  const wolfTargetId = selected ?? (acted ? night?.myWolfVote ?? null : null);
  const wolfTargetName = wolfTargetId ? nameOf(wolfTargetId) : null;
  // Đã bầu đúng người đang trỏ tới -> không còn gì để gửi. Mục tiêu phụ không
  // nằm trong `myWolfVote`, nên đêm cắn kép luôn cho gửi lại.
  const wolfBiteCast =
    acted && !wolfSecondary && wolfTargetId !== null && night?.myWolfVote === wolfTargetId;
  const wolfSkipCast = acted && (night?.myWolfVote ?? null) === null;

  const castWolfVote = (target: string | null, secondary?: string | null) => {
    if (wolfSending) return;
    setPendingWolfVote({ target });
    onAction(target === null ? "SKIP" : "KILL", target, secondary ?? null);
  };

  const toggleDetectiveTarget = (id: string) => {
    if (acted) return;
    if (detectiveTarget1 === id) {
      setDetectiveTarget1(null);
    } else if (detectiveTarget2 === id) {
      setDetectiveTarget2(null);
    } else if (!detectiveTarget1) {
      setDetectiveTarget1(id);
    } else if (!detectiveTarget2) {
      setDetectiveTarget2(id);
    } else {
      setDetectiveTarget2(id);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className={`card outline-none focus-visible:ring-2 focus-visible:ring-blood-500/60 ${acted ? "opacity-80" : ""}`}
        // Mốc cho nút "Hành động đêm" trong tấm trượt chat; xem `phase-action.ts`.
        {...{ [PHASE_ACTION_ATTR]: "" }}
        tabIndex={-1}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.3em] text-mist/85">Lượt của bạn</p>
            <h3
              className={`font-display text-2xl font-bold ${
                meta.team === "wolves" ? "text-blood-400" : "text-indigo-200"
              }`}
            >
              {meta.name}
            </h3>
            <p className="mt-1 text-sm text-mist-strong">{meta.description}</p>
          </div>
          {showActedBadge && (
            <span className="badge-phase shrink-0 bg-emerald-900/60 text-emerald-300">
              Đã hành động
            </span>
          )}
        </div>
        <div className="mb-3">
          <CursedNote snapshot={snapshot} />
        </div>

        {/*
          * Mọi vai trong bầy Sói cắn chung một phiếu: Ma Sói, Sói Con, Sói
          * Alpha và Sói Pháp Sư. Sói Pháp Sư ngoài phiếu cắn còn có một lượt
          * kiểm tra dòng Tiên Tri riêng ở khối bên dưới.
          */}
        {role && isWolfPack(role) && (
          <>
            <WolfTally snapshot={snapshot} nameOf={nameOf} />
            {role === "WOLF_CUB" && (
              <p className="mb-2 rounded-lg border border-blood-500/30 bg-blood-950/20 p-2 text-xs text-blood-300">
                🐾 Sói Con: Nếu bạn bị loại bỏ, đêm kế tiếp bầy Sói được cắn 2 nạn nhân!
              </p>
            )}
            {(night?.wolfCubRageTonight || snapshot.activeEvent?.id === "BLOODY_HUNT") && !locked && (
              <div className="mb-2 rounded-lg border border-blood-500/40 bg-blood-900/20 p-2">
                <p className="text-xs font-bold text-blood-300">
                  🩸 {night?.wolfCubRageTonight ? "Phẫn nộ Sói Con" : "Cuộc Săn Đẫm Máu"}: Chọn thêm 1 mục tiêu phụ!
                </p>
                <div className="mt-1 flex gap-1.5 text-xs">
                  <span className={`rounded px-2 py-1 ${selected ? "bg-blood-600 text-white" : "bg-night-800 text-mist/85"}`}>
                    Chính: {selected ? nameOf(selected) : "chưa chọn"}
                  </span>
                  <span className={`rounded px-2 py-1 ${wolfSecondary ? "bg-blood-600 text-white" : "bg-night-800 text-mist/85"}`}>
                    Phụ: {wolfSecondary ? nameOf(wolfSecondary) : "chưa chọn"}
                  </span>
                  {wolfSecondary && (
                    <button className="text-mist/85 hover:text-white" onClick={() => setWolfSecondary(null)}>
                      ✕
                    </button>
                  )}
                </div>
                {snapshot.activeEvent?.id === "BLOODY_HUNT" && (
                  <p className="mt-1 text-[11px] text-mist/85">Mục tiêu phụ chỉ có 50% tỉ lệ thành công.</p>
                )}
              </div>
            )}
            {night?.wolfSecondaryTarget && (
              <p className="mb-2 rounded-lg border border-blood-500/40 bg-blood-900/30 p-2 text-xs font-semibold text-blood-300">
                🩸 Đòn cắn kép đang kích hoạt!
              </p>
            )}
            {locked ? (
              <p className="mb-2 rounded-lg bg-night-800 p-2 text-sm text-blood-400">
                {night?.wolfTarget ? (
                  <>
                    Bầy Sói đã chốt: <b>{nameOf(night.wolfTarget)}</b>
                    {night.wolfSecondaryTarget && (
                      <>
                        {" "}và <b>{nameOf(night.wolfSecondaryTarget)}</b>
                      </>
                    )}
                    .
                  </>
                ) : (
                  "Bầy Sói đã chốt: đêm nay không cắn ai."
                )}
              </p>
            ) : (
              <>
                {(night?.wolfCubRageTonight || snapshot.activeEvent?.id === "BLOODY_HUNT") ? (
                  <>
                    <PlayerGrid
                      snapshot={snapshot}
                      selectable={true}
                      selectedIds={[selected, wolfSecondary].filter((v): v is string => !!v)}
                      onSelect={(id) => {
                        if (selected === id) setSelected(null);
                        else if (!selected) setSelected(id);
                        else if (wolfSecondary === id) setWolfSecondary(null);
                        else if (!wolfSecondary && id !== selected) setWolfSecondary(id);
                        else setSelected(id);
                      }}
                      disabledIds={wolfAllyIds}
                      disabledIdsReason="Đồng đội trong phe Sói"
                    />
                    <button
                      type="button"
                      className="btn-primary mt-3 w-full disabled:bg-white/[0.04] disabled:text-mist-strong disabled:opacity-100 disabled:shadow-none disabled:ring-1 disabled:ring-inset disabled:ring-white/10"
                      disabled={!selected || wolfSending}
                      aria-busy={wolfSending}
                      onClick={() => selected && castWolfVote(selected, wolfSecondary)}
                    >
                      {wolfSending && <span className="gate-spinner" aria-hidden="true" />}
                      <span className="min-w-0 truncate">
                        {wolfBiteLabel({
                          targetName: selected ? nameOf(selected) : null,
                          secondaryName: wolfSecondary ? nameOf(wolfSecondary) : null,
                          sending: wolfSending,
                        })}
                      </span>
                    </button>
                  </>
                ) : (
                  <>
                    {aliveOthers({
                      selectable: true,
                      selectedId: wolfTargetId,
                      confirmedId: wolfBiteCast ? wolfTargetId : null,
                      disabledIds: wolfAllyIds,
                      disabledIdsReason: "Đồng đội trong phe Sói",
                    })}
                    {/*
                      * Nút chính nói ĐÚNG trạng thái hiện tại, không phải một
                      * chữ "Bầu cắn mục tiêu" đứng yên qua mọi trạng thái:
                      *
                      *   chưa chọn ai -> xám,  "Chọn một người để cắn"
                      *   đã chọn      -> đỏ,   "Bầu chọn <tên>"
                      *   đang gửi     -> vòng quay, khoá lại để không bắn trùng
                      *   đã bầu xong  -> xanh, "Đã bầu chọn <tên>"
                      *
                      * Trạng thái tắt đổi hẳn sang nền trung tính thay vì dùng
                      * `disabled:opacity-40` của `.btn`: nền đỏ mờ đi đọc ra
                      * như một nút hỏng - cùng lý do đã ghi ở `DayView`.
                      */}
                    <button
                      type="button"
                      className={`mt-3 w-full ${
                        wolfBiteCast && !wolfSending
                          ? "btn border border-emerald-500/45 bg-emerald-600/15 text-emerald-200 disabled:cursor-default disabled:opacity-100"
                          : "btn-primary disabled:bg-white/[0.04] disabled:text-mist-strong disabled:opacity-100 disabled:shadow-none disabled:ring-1 disabled:ring-inset disabled:ring-white/10"
                      }`}
                      disabled={!wolfTargetId || wolfSending || wolfBiteCast}
                      aria-busy={wolfSending}
                      onClick={() => wolfTargetId && castWolfVote(wolfTargetId)}
                    >
                      {wolfSending && pendingWolfVote?.target !== null && (
                        <span className="gate-spinner" aria-hidden="true" />
                      )}
                      {wolfBiteCast && !wolfSending && <span aria-hidden="true">✓</span>}
                      {/* Tên tối đa 20 ký tự nhưng nút hẹp dần theo cột: cắt ở
                        * đây thay vì để nó đẩy toang thẻ. */}
                      <span className="min-w-0 truncate">
                        {wolfBiteLabel({
                          targetName: wolfTargetName,
                          sending: wolfSending && pendingWolfVote?.target !== null,
                          alreadyCast: wolfBiteCast,
                        })}
                      </span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={`mt-2 w-full ${
                    wolfSkipCast && !wolfSending
                      ? "btn border border-emerald-500/45 bg-emerald-600/15 text-emerald-200 disabled:cursor-default disabled:opacity-100"
                      : "btn-secondary"
                  }`}
                  disabled={wolfSending || wolfSkipCast}
                  aria-busy={wolfSending}
                  onClick={() => castWolfVote(null)}
                >
                  {wolfSending && pendingWolfVote?.target === null && (
                    <span className="gate-spinner" aria-hidden="true" />
                  )}
                  {wolfSkipCast && !wolfSending && <span aria-hidden="true">✓</span>}
                  {wolfSkipLabel({
                    sending: wolfSending && pendingWolfVote?.target === null,
                    alreadyCast: wolfSkipCast,
                  })}
                </button>
                <p className="mt-2 text-center text-[13px] text-mist-strong">
                  Phiếu chốt khi hết giờ. Hòa phiếu sẽ bốc ngẫu nhiên trong nhóm dẫn đầu.
                </p>
              </>
            )}
          </>
        )}

        {/* TIÊN TRI & TIÊN TRI TẬP SỰ (ĐÃ THỨC TỈNH) */}
        {(role === "SEER" || (role === "APPRENTICE_SEER" && apprenticeAwakened)) && (
          <>
            {role === "APPRENTICE_SEER" && (
              <p className="mb-2 rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-2 text-xs font-semibold text-emerald-300">
                ✨ Bạn đã thức tỉnh thừa kế Tiên Tri! Hãy soi phe một người chơi đêm nay.
              </p>
            )}
            {night?.seerResult && (
              <div className="mb-2 rounded-lg bg-night-800 p-2.5 text-sm">
                <p className="text-[13px] text-mist-strong">Kết quả soi gần nhất:</p>
                <p className="mt-1">
                  <b>{night.seerResult.targetName}</b> là{" "}
                  <b className={seerReading(night.seerResult.team, night.seerResult.isWolf).className}>
                    {seerReading(night.seerResult.team, night.seerResult.isWolf).label}
                  </b>
                </p>
                {night.seerResult.secondaryTargetName && (
                  <p className="mt-1">
                    Mục tiêu 2: <b>{night.seerResult.secondaryTargetName}</b> là{" "}
                    <b
                      className={
                        seerReading(
                          night.seerResult.secondaryTeam,
                          night.seerResult.secondaryIsWolf,
                        ).className
                      }
                    >
                      {
                        seerReading(
                          night.seerResult.secondaryTeam,
                          night.seerResult.secondaryIsWolf,
                        ).label
                      }
                    </b>
                  </p>
                )}
              </div>
            )}
            {clearingMist && !acted ? (
              /*
               * Màn Sương Tan: hai ô soi, cùng cách bấm với Đêm Cảnh Giác của
               * Bảo Vệ và đòn cắn kép của bầy Sói.
               *
               * Đường `secondaryTargetId` đã có trong engine từ đầu nhưng chưa
               * bao giờ có nút bấm, nên tới trước bản này chỉ BOT dùng được sự
               * kiện - một Tiên Tri người thật bốc trúng nó thì soi đúng một
               * người như mọi đêm và không hề biết mình vừa mất lượt thứ hai.
               */
              <>
                <div className="mb-2 rounded-lg border border-sky-500/40 bg-sky-900/20 p-2">
                  <p className="text-xs font-bold text-sky-300">
                    🌫️ Màn Sương Tan: bạn được soi 2 người!
                  </p>
                  <div className="mt-1 flex gap-1.5 text-xs">
                    <span className={`rounded px-2 py-1 ${selected ? "bg-sky-600 text-white" : "bg-night-800 text-mist/85"}`}>
                      Người 1: {selected ? nameOf(selected) : "chưa chọn"}
                    </span>
                    <span className={`rounded px-2 py-1 ${seerSecondary ? "bg-sky-600 text-white" : "bg-night-800 text-mist/85"}`}>
                      Người 2: {seerSecondary ? nameOf(seerSecondary) : "chưa chọn"}
                    </span>
                    {seerSecondary && (
                      <button className="text-mist/85 hover:text-white" onClick={() => setSeerSecondary(null)}>
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <PlayerGrid
                  snapshot={snapshot}
                  selectable={true}
                  selectedIds={[selected, seerSecondary].filter((v): v is string => !!v)}
                  onSelect={(id) => {
                    if (selected === id) setSelected(null);
                    else if (seerSecondary === id) setSeerSecondary(null);
                    else if (!selected) setSelected(id);
                    else if (!seerSecondary) setSeerSecondary(id);
                    else setSelected(id);
                  }}
                  allowSelf={false}
                />
                <button
                  className="btn-primary mt-3 w-full"
                  disabled={!selected || acted}
                  onClick={() => selected && onAction("SEE", selected, seerSecondary)}
                >
                  🔮 {seerSecondary ? "Soi hai người này" : "Soi người này"}
                </button>
              </>
            ) : (
              <>
                {aliveOthers()}
                <button
                  className="btn-primary mt-3 w-full"
                  disabled={!selected || acted}
                  onClick={() => selected && onAction("SEE", selected)}
                >
                  🔮 Soi người này
                </button>
              </>
            )}
          </>
        )}

        {/* THÁM TỬ */}
        {role === "DETECTIVE" && (
          <>
            <p className="mb-2 text-sm text-mist-strong">
              Chọn 2 người chơi còn sống để kiểm tra xem họ cùng phe hay khác phe.
            </p>
            {night?.detectiveResult && (
              <div className="mb-2 rounded-lg bg-night-800 p-2.5 text-sm">
                <p className="text-[13px] text-mist-strong">Kết quả điều tra gần nhất:</p>
                <p className="mt-1">
                  <b>{night.detectiveResult.target1.name}</b> và <b>{night.detectiveResult.target2.name}</b>:{" "}
                  <b className={night.detectiveResult.sameTeam ? "text-indigo-300" : "text-amber-300"}>
                    {night.detectiveResult.sameTeam ? "CÙNG PHE" : "KHÁC PHE"}
                  </b>
                </p>
              </div>
            )}
            <div className="mb-2 flex gap-2 text-xs">
              <span className={`rounded px-2 py-1 ${detectiveTarget1 ? "bg-indigo-900/60 text-indigo-200 border border-indigo-500/40" : "bg-night-800 text-mist/85"}`}>
                Mục tiêu 1: {detectiveTarget1 ? nameOf(detectiveTarget1) : "chưa chọn"}
              </span>
              <span className={`rounded px-2 py-1 ${detectiveTarget2 ? "bg-indigo-900/60 text-indigo-200 border border-indigo-500/40" : "bg-night-800 text-mist/85"}`}>
                Mục tiêu 2: {detectiveTarget2 ? nameOf(detectiveTarget2) : "chưa chọn"}
              </span>
            </div>
            <PlayerGrid
              snapshot={snapshot}
              selectable={!acted}
              selectedIds={[detectiveTarget1, detectiveTarget2].filter((v): v is string => !!v)}
              onSelect={(id) => {
                toggleDetectiveTarget(id);
              }}
            />
            <button
              className="btn-primary mt-3 w-full"
              disabled={!detectiveTarget1 || !detectiveTarget2 || acted}
              onClick={() => {
                if (detectiveTarget1 && detectiveTarget2) {
                  onAction("DETECTIVE_CHECK", detectiveTarget1, detectiveTarget2);
                }
              }}
            >
              🔍 Kiểm tra 2 người này
            </button>
          </>
        )}

        {/* THIÊN THẦN HỘ MỆNH */}
        {role === "GUARDIAN_ANGEL" && (
          <>
            <div className="mb-2 flex items-center justify-between gap-2 text-sm">
              <span className="text-mist/85">
                Lượt khiên còn lại: <b className="text-amber-300">{night?.guardianAngelCharges ?? 2}/2</b>
              </span>
              {night?.guardianAngelPrevious && (
                <span className="text-xs text-mist/85">
                  Đêm trước: <b>{nameOf(night.guardianAngelPrevious)}</b>
                </span>
              )}
            </div>
            <p className="mb-2 text-[13px] text-mist-strong">
              Bảo vệ 1 người khỏi mọi đòn giết ban đêm (tối đa 2 lần cả ván, không chọn cùng 1 người 2 đêm liền).
            </p>
            {aliveOthers({
              allowSelf: true,
              disabledIds: night?.guardianAngelPrevious ? [night.guardianAngelPrevious] : undefined,
            })}
            <button
              className="btn-primary mt-3 w-full"
              disabled={!selected || acted || (night?.guardianAngelCharges ?? 2) <= 0}
              onClick={() => selected && onAction("GUARDIAN_PROTECT", selected)}
            >
              🛡️ {(night?.guardianAngelCharges ?? 2) <= 0 ? "Đã hết lượt bảo vệ" : "Dùng khiên hộ mệnh"}
            </button>
          </>
        )}

        {/* SÓI PHÁP SƯ: lượt kiểm tra dòng Tiên Tri, ngoài phiếu cắn cùng bầy */}
        {role === "SORCERER" && (
          <>
            <p className="mb-2 text-[13px] text-mist-strong">
              Chọn 1 người còn sống để kiểm tra xem họ có thuộc{" "}
              <b className="text-violet-300">dòng Tiên Tri</b> (Tiên Tri, Tiên Tri
              Tập Sự) không. Mỗi đêm một lượt, chốt ngay lần đầu.
            </p>
            {night?.sorcererResult && (
              <div className="mb-2 rounded-lg bg-night-800 p-2.5 text-sm">
                <p className="text-[13px] text-mist-strong">Kết quả kiểm tra gần nhất:</p>
                <p className="mt-1">
                  <b>{night.sorcererResult.target.name}</b>{" "}
                  {night.sorcererResult.isSeerLine ? (
                    <>
                      thuộc <b className="text-amber-300">dòng Tiên Tri</b>
                    </>
                  ) : (
                    <>
                      <b className="text-emerald-300">không</b> thuộc dòng Tiên Tri
                    </>
                  )}
                </p>
              </div>
            )}
            {night?.sorcererResult ? (
              <p className="rounded-lg bg-night-800 p-3 text-center text-sm text-mist-strong">
                Bạn đã kiểm tra đêm nay. Phiếu cắn cùng bầy vẫn đổi được tới khi chốt.
              </p>
            ) : (
              <>
                <PlayerGrid
                  snapshot={snapshot}
                  selectable={true}
                  selectedId={sorcererTarget}
                  onSelect={setSorcererTarget}
                  allowSelf={false}
                />
                <button
                  className="btn-primary mt-3 w-full"
                  disabled={!sorcererTarget}
                  onClick={() => sorcererTarget && onAction("SORCERER_CHECK", sorcererTarget)}
                >
                  🔮 Kiểm tra người này
                </button>
              </>
            )}
          </>
        )}

        {/* BẢO VỆ */}
        {role === "GUARD" && (
          <>
            <p className="mb-2 text-sm text-mist-strong">
              Bạn không thể tự bảo vệ mình và không thể bảo vệ cùng một người hai đêm liên tiếp.
              {night?.guardPrevious && (
                <>
                  {" "}
                  Đêm trước bạn đã đỡ <b className="text-white">{nameOf(night.guardPrevious)}</b>.
                </>
              )}
            </p>
            {vigilantNight && !acted ? (
              /*
               * Đêm Cảnh Giác: hai ô che, chọn bằng chính lưới người chơi.
               *
               * Cùng cách bấm mà đòn cắn kép của bầy Sói đang dùng - ô trống kế
               * tiếp nhận người vừa bấm, bấm lại người đã chọn thì bỏ ra. Người
               * chơi không phải học hai thao tác cho cùng một việc.
               */
              <>
                <div className="mb-2 rounded-lg border border-emerald-500/40 bg-emerald-900/20 p-2">
                  <p className="text-xs font-bold text-emerald-300">
                    🛡️ Đêm Cảnh Giác: bạn được che 2 người!
                  </p>
                  <div className="mt-1 flex gap-1.5 text-xs">
                    <span className={`rounded px-2 py-1 ${selected ? "bg-emerald-600 text-white" : "bg-night-800 text-mist/85"}`}>
                      Người 1: {selected ? nameOf(selected) : "chưa chọn"}
                    </span>
                    <span className={`rounded px-2 py-1 ${guardSecondary ? "bg-emerald-600 text-white" : "bg-night-800 text-mist/85"}`}>
                      Người 2: {guardSecondary ? nameOf(guardSecondary) : "chưa chọn"}
                    </span>
                    {guardSecondary && (
                      <button className="text-mist/85 hover:text-white" onClick={() => setGuardSecondary(null)}>
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <PlayerGrid
                  snapshot={snapshot}
                  selectable={true}
                  selectedIds={[selected, guardSecondary].filter((v): v is string => !!v)}
                  onSelect={(id) => {
                    if (selected === id) setSelected(null);
                    else if (guardSecondary === id) setGuardSecondary(null);
                    else if (!selected) setSelected(id);
                    else if (!guardSecondary) setGuardSecondary(id);
                    else setSelected(id);
                  }}
                  disabledIds={night?.guardPrevious ? [night.guardPrevious] : undefined}
                  allowSelf={false}
                />
                <button
                  className="btn-primary mt-3 w-full"
                  disabled={!selected || acted}
                  onClick={() => selected && onAction("GUARD", selected, guardSecondary)}
                >
                  🛡️ {guardSecondary ? "Bảo vệ hai người này" : "Bảo vệ người này"}
                </button>
              </>
            ) : (
              <>
                {aliveOthers({
                  allowSelf: false,
                  disabledIds: night?.guardPrevious ? [night.guardPrevious] : undefined,
                })}
                <button
                  className="btn-primary mt-3 w-full"
                  disabled={!selected || acted}
                  onClick={() => selected && onAction("GUARD", selected)}
                >
                  🛡️ Bảo vệ người này
                </button>
              </>
            )}
          </>
        )}

        {/* SÁT NHÂN */}
        {role === "SERIAL_KILLER" && (
          <>
            <p className="mb-2 text-[13px] text-mist-strong">
              Chọn một người để giết đêm nay, hoặc bỏ qua. Bạn đi{" "}
              <b className="text-amber-300">một mình</b>: bầy Sói không phải đồng
              minh của bạn, và bạn nhắm được cả họ.
            </p>
            {night?.serialKillerSkipped ? (
              // Bỏ qua là quyết định CUỐI CÙNG của đêm (engine chặn mọi thao tác
              // sau đó), nên màn hình phải nói ra điều đó thay vì bày lại lưới
              // chọn người rồi để cú bấm bị từ chối.
              <p className="rounded-lg bg-night-800 p-3 text-center text-sm text-mist-strong">
                Bạn đã quyết định không ra tay đêm nay.
              </p>
            ) : (
              <>
                {aliveOthers({
                  allowSelf: false,
                  selectable: true,
                  // Mục tiêu đã gửi hiện dấu "Phiếu của bạn" thay vì "Đang chọn":
                  // đổi ý được tới hết đêm, nên người chơi phải phân biệt được
                  // "đang cân nhắc" với "đã chốt".
                  confirmedId: night?.serialKillerTarget ?? null,
                })}
                <button
                  className="btn-primary mt-3 w-full"
                  disabled={!selected}
                  onClick={() => selected && onAction("SERIAL_KILL", selected)}
                >
                  🔪{" "}
                  {night?.serialKillerTarget
                    ? `Đổi mục tiêu sang người này`
                    : "Ra tay với người này"}
                </button>
                <button
                  className="btn-secondary mt-2 w-full"
                  onClick={() => onAction("SKIP", null)}
                >
                  Không giết ai đêm nay
                </button>
                {night?.serialKillerTarget && (
                  <p className="mt-2 text-center text-[13px] text-mist-strong">
                    Mục tiêu đang chốt:{" "}
                    <b className="text-blood-400">{nameOf(night.serialKillerTarget)}</b>. Bạn
                    còn đổi ý được tới khi trời sáng.
                  </p>
                )}
              </>
            )}
          </>
        )}

        {/* PHÙ THỦY */}
        {role === "WITCH" && (
          <div className="space-y-3">
            <div className="flex gap-2 text-sm">
              <span
                className={`rounded px-2 py-1 ${night?.healUsed ? "bg-night-700 text-mist/85 line-through" : "bg-emerald-900/50 text-emerald-300"}`}
              >
                Bình cứu: {night?.healUsed ? "đã dùng" : "còn"}
              </span>
              <span
                className={`rounded px-2 py-1 ${night?.poisonUsed ? "bg-night-700 text-mist/85 line-through" : "bg-blood-600/30 text-blood-400"}`}
              >
                Bình độc: {night?.poisonUsed ? "đã dùng" : "còn"}
              </span>
            </div>

            {!locked ? (
              <p className="rounded-lg bg-night-800 p-3 text-center text-sm text-mist-strong">
                🌙 Bầy Sói đang chọn con mồi. Chờ chúng ra tay xong bạn mới quyết định
                có cứu hay không.
              </p>
            ) : (
              <>
                <p className="rounded-lg bg-night-800 p-2 text-sm">
                  {night?.wolfTarget ? (
                    <>
                      Đêm nay bầy Sói cắn <b className="text-blood-400">{nameOf(night.wolfTarget)}</b>.
                    </>
                  ) : (
                    "Đêm nay bầy Sói không cắn ai."
                  )}
                </p>

                {!night?.healUsed && night?.wolfTarget && (
                  <button
                    className="btn-secondary w-full border border-emerald-600/50"
                    disabled={acted}
                    onClick={() => onAction("HEAL", null)}
                  >
                    🧪 Cứu {nameOf(night.wolfTarget)}
                  </button>
                )}

                {!night?.poisonUsed && (
                  <>
                    {!poisoning ? (
                      <button
                        className="btn-secondary w-full border border-blood-500/50"
                        disabled={acted}
                        onClick={() => setPoisoning(true)}
                      >
                        ☠️ Chọn người để đầu độc
                      </button>
                    ) : (
                      <>
                        {aliveOthers()}
                        <div className="mt-3 flex gap-2">
                          <button
                            className="btn-primary flex-1"
                            disabled={!selected || acted}
                            onClick={() => selected && onAction("POISON", selected)}
                          >
                            Đầu độc
                          </button>
                          <button className="btn-secondary flex-1" onClick={() => setPoisoning(false)}>
                            Huỷ
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}

                <button
                  className="btn-secondary w-full"
                  disabled={acted}
                  onClick={() => onAction("SKIP", null)}
                >
                  Không dùng thuốc đêm nay
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Bảng phiếu cắn của bầy Sói: ai đang dẫn, còn bao nhiêu Sói chưa bầu. */
function WolfTally({
  snapshot,
  nameOf,
}: {
  snapshot: RoomSnapshot;
  nameOf: (id: string | null | undefined) => string;
}) {
  const night = snapshot.night;
  const counts = night?.wolfVoteCounts ?? {};
  const skip = night?.wolfSkipVotes ?? 0;
  const required = night?.wolfVotesRequired ?? 0;
  const cast = Object.values(counts).reduce((sum, n) => sum + n, 0) + skip;
  const voted = night?.acted === true;
  const rows = [
    ...Object.entries(counts).map(([id, count]) => ({
      label: nameOf(id),
      count,
      mine: voted && night?.myWolfVote === id,
    })),
    ...(skip > 0
      ? [{ label: "Không cắn", count: skip, mine: voted && night?.myWolfVote === null }]
      : []),
  ].sort((left, right) => right.count - left.count);

  return (
    <div className="mb-3 rounded-lg bg-night-800 p-2 text-sm">
      <p className="mb-1 text-[13px] font-semibold text-mist-strong">
        {wolfTallyProgress(cast, required)}
      </p>
      {rows.length === 0 ? (
        <p className="text-mist-strong">{WOLF_TALLY_EMPTY}</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((row) => (
            <li key={row.label} className="flex justify-between gap-2">
              <span className={row.mine ? "font-semibold text-blood-400" : "text-mist-strong"}>
                {row.label}
                {row.mine && " (phiếu của bạn)"}
              </span>
              <span className="font-semibold text-mist-bright">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
