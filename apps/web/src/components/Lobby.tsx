"use client";

import { useRef, useState } from "react";
import {
  MAX_PLAYERS_PER_ROOM,
  ROLE_META,
  applyDeck,
  validateRoomConfig,
  type Role,
  type RoomConfig,
  type RoomSnapshot,
} from "@masoi/shared";
import type { Identity } from "@/lib/identity";
import { generateWarnings, PRESET_DECKS } from "@/lib/balance";
import { balanceCopy } from "@/lib/balance-copy";
import {
  CONFIG_KEY,
  NEUTRAL_ROLES,
  VILLAGE_ROLES,
  WOLF_SPECIAL_ROLES,
  deckCounts,
  deckStage,
  isPresetDeck,
  startBlock,
  type StartBlock,
} from "@/lib/lobby-summary";
import { lastLetterToggle } from "@/lib/last-letter";
import { useDockHeight } from "@/lib/useDockHeight";
import { ROLE_ICON_PATHS } from "@/lib/role-art";
import { BalanceMeter } from "./BalanceMeter";
import { LobbyActivity } from "./LobbyActivity";
import { RoleDeckPanel } from "./RoleDeckPanel";

interface Props {
  snapshot: RoomSnapshot;
  identity: Identity;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onAddBot: () => void;
  onUpdateConfig: (config: RoomConfig) => void;
}

/**
 * Số liệu dẫn xuất dùng chung cho khối điều khiển và nhóm thiết lập.
 *
 * Hai khối đó đã tách làm hai component (xem `Lobby`), nhưng chúng vẫn phải nói
 * cùng một chuyện: thẻ vai đọc ra "Ranked" thì ô chế độ bên dưới cũng phải sáng
 * ở Ranked, và cảnh báo cân bằng phải là ĐÚNG cảnh báo đang chặn nút Bắt đầu.
 * Tính lại ở mỗi nơi một kiểu là hai nguồn sự thật; gom vào đây thì chỉ còn một.
 */
function lobbyModel(snapshot: RoomSnapshot, identity: Identity) {
  const config = snapshot.config;
  const count = snapshot.players.length;
  const mode = config.mode ?? "ranked";
  return {
    config,
    count,
    mode,
    isHost: snapshot.hostId === identity.playerId,
    // Ưu tiên kết quả server; generateWarnings chỉ để xem trước tức thì lúc host
    // vừa gạt một công tắc và snapshot mới chưa về.
    balance: snapshot.balanceWarning ?? generateWarnings(config, count),
    stage: deckStage(count),
  };
}

/**
 * Khối điều khiển của phòng chờ: đội hình, diễn biến và nút bắt đầu.
 *
 * Danh sách người chơi KHÔNG ở đây - nó là cả cột bên trái. Tên cảnh, chủ
 * phòng và sĩ số cũng không: chúng là đầu của chính bảng người chơi
 * (`LobbyHeader`). Mã phòng thì lên thanh đầu trang. Nên thẻ này chỉ còn nói
 * đúng ba chuyện của phút chờ: BỘ BÀI nào, phòng đang ra sao, và bấm được
 * chưa.
 *
 * Bày theo lớp: thẻ này trả lời đúng câu hỏi của phút đầu tiên - "bấm bắt đầu
 * được chưa, và nếu chưa thì vướng gì" - còn mười ba thẻ vai, năm ô thời gian
 * và công tắc voice lui vào `LobbySettings`. Bản cũ trải hết ra cùng lúc và
 * trên điện thoại nó dài hơn ba màn hình, trong đó phần host thực sự cần đọc
 * chiếm chưa tới một phần tư. Host lâu năm vẫn chỉnh được đúng mọi thứ như cũ,
 * chỉ thêm một cú bấm mở mục.
 *
 * `LobbySettings` là một component RIÊNG chứ không phải mấy thẻ nữa dưới đáy
 * component này: nó không còn nằm trong dòng chảy của thanh điều khiển mà sống
 * trong lớp phủ "Luật và vai trò" (`LobbySettingsDrawer`), mở ra từ một cái nút
 * ở chân thanh. Thanh điều khiển xếp dọc: khối này, rồi voice, rồi chat, rồi
 * nút mở thiết lập - và cả bốn phải cùng nằm trong một màn `100dvh`.
 *
 * Nút "Rời phòng" KHÔNG còn ở đây. Bản cũ có hai cái - một ở thanh đầu trang,
 * một chiếm trọn chiều ngang ngay dưới "Bắt đầu trận đấu" - và cái thứ hai có
 * đúng hình dáng của CTA nên nó cạnh tranh với chính nút mà nó nằm dưới. Giờ
 * chỉ còn một, ở thanh đầu trang, cỡ chữ thường.
 */
export function Lobby({
  snapshot,
  identity,
  onReady,
  onStart,
  onAddBot,
  onUpdateConfig,
}: Props) {
  const { config, count, mode, isHost, balance, stage } = lobbyModel(snapshot, identity);
  const me = snapshot.players.find((p) => p.id === identity.playerId);
  const myReady = me?.ready ?? false;
  const unreadyGuests = snapshot.players.filter(
    (player) => !player.isBot && player.id !== snapshot.hostId && !player.ready,
  );

  const counts = deckCounts(config, count);
  const onPreset = isPresetDeck(config, count);
  const activeRoles: Role[] = [
    "WEREWOLF",
    ...WOLF_SPECIAL_ROLES.filter((role) => config[CONFIG_KEY[role]]),
    ...VILLAGE_ROLES.filter((role) => config[CONFIG_KEY[role]]),
    ...NEUTRAL_ROLES.filter((role) => config[CONFIG_KEY[role]]),
    ...(stage.rated && counts.villagers > 0 ? (["VILLAGER"] as Role[]) : []),
  ];
  /*
   * Bốn thẻ vai, không phải năm.
   *
   * Thẻ này đứng trong một cột rộng khoảng 22rem ở 1024px, và ở bề ngang đó
   * thẻ thứ năm luôn rơi xuống một hàng thứ ba - 37px chỉ để nói thêm đúng một
   * cái tên vai, lấy thẳng từ chiều cao của khung chat ngay bên dưới. Bốn thẻ
   * cộng phù hiệu "+n" vừa hai hàng ở mọi bề ngang mà cột này từng có, và
   * người muốn xem đủ mười ba vai đã có "Luật và vai trò" ở chân thanh.
   */
  const visibleRoles = activeRoles.slice(0, 4);

  /*
   * Thanh hành động dính đáy trên điện thoại tự khai báo chiều cao của nó.
   *
   * Xem `useDockHeight`: trang chừa đệm đáy theo con số này, còn nút chat nổi
   * và dock voice nhấc mình lên khỏi nó. Không có gì phải đồng bộ bằng tay.
   */
  const dockRef = useRef<HTMLDivElement>(null);
  useDockHeight(dockRef);

  // Cùng bộ đầu vào và cùng thứ tự ưu tiên mà `RoomService.start` dùng -
  // startBlock chỉ gói lại chứ không đổi luật nào.
  const configError = validateRoomConfig(config, count);
  const block = startBlock({
    playerCount: count,
    configError,
    balanceBlocking: balance.blocking,
    mode,
    unreadyNames: unreadyGuests.map((player) => player.name),
  });

  /*
   * Lối thoát cho hai lý do chặn mà bộ bài gây ra, ĐẶT NGAY DƯỚI NÚT.
   *
   * "Bộ bài cần 8 người, phòng đang có 10" và "Đội hình chưa đủ cân bằng" đều
   * sửa được bằng đúng một cú bấm - áp preset của cỡ bàn hiện tại - nhưng cái
   * nút làm việc đó nằm trong lớp phủ "Luật và vai trò", sau một cú bấm nữa và
   * một cuộn nữa. Host nhìn thấy một nút xám, một dòng đỏ, và không có gì để
   * bấm: đó là một ngõ cụt, và nó xảy ra ở đúng tình huống thường gặp nhất -
   * mở phòng 8 người rồi thêm bot cho vui.
   *
   * Cùng một hành động với nút trong lớp phủ, cùng `applyDeck` nên cũng chỉ
   * thay BỘ BÀI: Chaos, voice, Phong thư và bộ giây của phòng giữ nguyên.
   */
  /*
   * "Thêm bot" đứng ở một trong hai chỗ, tuỳ nó có phải LỐI THOÁT hay không.
   *
   * Khối ghim dưới nút Bắt đầu chỉ chứa ba thứ: nút, lý do đang chặn, và cách
   * sửa đúng lý do đó. Phòng chưa đủ người thì cách sửa chính là thêm bot, nên
   * nó ở đó. Phòng đã đủ người thì nó là một hành động phụ - và mỗi pixel của
   * khối ghim là một pixel lấy khỏi phần tóm tắt cuộn được ngay trên nó: ở
   * 1280x800, với cả nút áp preset đang hiện, phần tóm tắt chỉ còn 135px và
   * dòng diễn biến biến mất hẳn. Cho nó xuống cuối phần cuộn được thì tóm tắt
   * lấy lại 52px, mà lối vào vẫn nằm ngay dưới bộ bài - đúng chỗ host đang đọc
   * khi họ nghĩ tới chuyện thêm người.
   */
  const canAddBot = isHost && count < MAX_PLAYERS_PER_ROOM;
  const addBotIsTheFix = block?.kind === "need-players";

  const presetForCount = PRESET_DECKS[count];
  const fixDeck =
    isHost &&
    stage.rated &&
    !!presetForCount &&
    !onPreset &&
    (block?.kind === "config" || block?.kind === "balance")
      ? () => onUpdateConfig(applyDeck(config, presetForCount))
      : null;

  return (
    <section className="lobby-command-panel">
      {/*
        * Phần TÓM TẮT cuộn được, nút bấm thì không.
        *
        * Trên desktop thẻ này là hàng đầu của một thanh điều khiển cao đúng
        * bằng màn hình, và ở 1024x768 - màn thấp nhất còn dựng hai cột - nó
        * phải nhường chỗ cho khung chat bên dưới. Nhường bằng cách nào là câu
        * hỏi thật: để cả thẻ tự co thì thứ bị đẩy ra khỏi khung nhìn là cái
        * nằm CUỐI, tức đúng nút Bắt đầu. Nên chỗ co nằm ở đây, quanh phần tóm
        * tắt bộ bài và diễn biến - hai thứ đọc một lần rồi thôi - còn nút thì
        * đứng ngoài và không bao giờ trôi đi đâu.
        *
        * Ở 1440x900 và 1920x1080 không có gì cuộn: thẻ vừa đủ chỗ của nó.
        */}
      <div className="lobby-command-summary">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-white">Vai trò</h2>
          <span className={`lobby-mode-pill ${mode === "ranked" ? "is-ranked" : "is-chaos"}`}>
            {mode === "ranked" ? "Ranked" : "Chaos"}
          </span>
        </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {visibleRoles.map((role) => {
          const amount =
            role === "WEREWOLF"
              ? config.werewolves
              : role === "VILLAGER"
                ? counts.villagers
                : 1;
          return (
            <span key={role} className="lobby-role-chip">
              <svg viewBox="0 0 512 512" aria-hidden="true"><path d={ROLE_ICON_PATHS[role]} /></svg>
              <span>{amount}</span>
              <span className="truncate">{ROLE_META[role].name}</span>
            </span>
          );
        })}
        {activeRoles.length > visibleRoles.length && (
          <span className="lobby-role-chip text-mist/85">+{activeRoles.length - visibleRoles.length}</span>
        )}
      </div>

      <p className="mt-2.5 text-[13px] leading-relaxed text-mist/85">
        {stage.rated
          ? `${onPreset ? "Đội hình chuẩn" : "Đội hình tuỳ chỉnh"} cho ${count} người.`
          : stage.summary}
      </p>

      <div className="mt-3 border-t border-white/[0.08] pt-3">
        <LobbyActivity snapshot={snapshot} />
      </div>

      {/* Đủ người rồi thì "Thêm bot" xuống ĐÂY, trong phần cuộn được. Lý do ở
        * chỗ khai `addBotIsTheFix`. */}
      {canAddBot && !addBotIsTheFix && <AddBotButton onAddBot={onAddBot} />}
      </div>

      <div ref={dockRef} className="lobby-primary-action mt-3">
        {isHost ? (
          <button className="btn-cta w-full" onClick={onStart} disabled={block !== null}>
            <span aria-hidden="true">◐</span>
            Bắt đầu trò chơi
          </button>
        ) : (
          <button
            className={`btn-cta w-full ${myReady ? "is-ready" : ""}`}
            onClick={() => onReady(!myReady)}
            aria-pressed={myReady}
          >
            <span aria-hidden="true">{myReady ? "✓" : "○"}</span>
            {myReady ? "Đã sẵn sàng" : "Sẵn sàng"}
          </button>
        )}
        <BlockReason block={block} isHost={isHost} onFixDeck={fixDeck} count={count} />
        {/* Phòng chưa đủ người thì "Thêm bot" chính là cách sửa lý do đang
          * chặn, nên nó ở lại trong khối GHIM cùng nút Bắt đầu. */}
        {canAddBot && addBotIsTheFix && <AddBotButton onAddBot={onAddBot} />}
      </div>
    </section>
  );
}

/** Một nút, hai chỗ đứng - xem `addBotIsTheFix` trong `Lobby`. */
function AddBotButton({ onAddBot }: { onAddBot: () => void }) {
  return (
    <button
      type="button"
      className="btn-tertiary lobby-add-bot mx-auto mt-2 flex min-h-11"
      onClick={onAddBot}
    >
      + Thêm bot để chơi thử
    </button>
  );
}

/**
 * Ba mục mở ra được của phòng chờ: luật phòng, bộ bài và cài đặt nâng cao.
 *
 * Nội dung của lớp phủ "Luật và vai trò" - `LobbySettingsDrawer` là thứ dựng
 * cái nút và cái lớp phủ, còn đây là ruột. Ba mục này là thứ host chỉnh một
 * lần rồi quên, còn chat và nút Bắt đầu là thứ cả phòng nhìn liên tục trong
 * lúc chờ đủ người; đứng thẳng trong thanh điều khiển thì chúng đẩy đúng hai
 * thứ kia xuống dưới mép màn hình.
 *
 * Vẫn là `<details>` xếp dọc chứ không phải tab: lớp phủ đã tự cuộn, và một
 * mạch đọc từ trên xuống là thứ dùng được y hệt nhau trên điện thoại lẫn
 * desktop.
 */
export function LobbySettings({
  snapshot,
  identity,
  onUpdateConfig,
}: Pick<Props, "snapshot" | "identity" | "onUpdateConfig">) {
  const { config, count, mode, isHost, balance, stage } = lobbyModel(snapshot, identity);
  // Chế độ đi vào đây để thẻ cảnh báo biết mình đang CHẶN hay chỉ đang nhắc:
  // Chaos bỏ qua chặn cân bằng, đúng như server.
  const copy = balanceCopy(balance, count, mode);
  const presetForCount = PRESET_DECKS[count];
  /*
   * Nút "Áp dụng đội hình chuẩn" đi theo BỘ BÀI, không đi theo thẻ cảnh báo.
   *
   * Bản cũ đặt nó bên trong thẻ cảnh báo cân bằng, nên nó chỉ có mặt khi engine
   * có gì để phàn nàn - và biến mất đúng lúc host cần nó nhất: phòng 8 người áp
   * preset 8, người thứ 9 vào, điểm vẫn 50 nên không cảnh báo, nhưng nút Bắt
   * đầu xám với "Bộ bài cần 8 người, phòng đang có 9". Cùng chuyện với bộ bài
   * mặc định ở bàn 11-14 người. Giờ nút có mặt hễ bộ bài khác preset của cỡ bàn
   * hiện tại, ở một chỗ cố định ngay dưới thanh cân bằng.
   */
  const offerPreset = isHost && stage.rated && !!presetForCount && !isPresetDeck(config, count);

  return (
    <div className="space-y-3">
      <Disclosure
        summary={isHost ? "Thiết lập ván" : "Luật của phòng"}
        hint="Chế độ, cân bằng và add-on"
      >
        <div className="space-y-4">
          <ModeToggle
            mode={mode}
            isHost={isHost}
            onChange={(next) => onUpdateConfig({ ...config, mode: next })}
          />
          {stage.rated ? (
            <BalanceMeter score={balance.score} />
          ) : (
            <p data-testid="balance-pending" className="text-[13px] leading-relaxed text-mist-strong">
              {stage.pending}
            </p>
          )}
          {offerPreset && (
            <button
              type="button"
              // Chỉ thay BỘ BÀI. Preset mang sẵn `mode: "ranked"` và bộ giây gốc,
              // nên gửi nguyên nó là kéo phòng Chaos về Ranked, tắt voice và tắt
              // Phong thư sau cùng - đúng những thứ host vừa chỉnh một phút trước.
              onClick={() => onUpdateConfig(applyDeck(config, presetForCount))}
              className="btn-secondary w-full text-sm"
              data-testid="apply-preset"
            >
              Áp dụng đội hình chuẩn cho {count} người
            </button>
          )}
          {stage.rated && copy.advice.length > 0 && (
            <div
              data-testid="balance-warning"
              className={`rounded-xl px-3.5 py-3 ${
                copy.blocksStart ? "bg-blood-600/15" : "bg-amber-500/10"
              }`}
            >
              <p className={`text-sm font-bold ${copy.blocksStart ? "text-blood-400" : "text-amber-200"}`}>
                {copy.headline}
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-mist/90">
                {copy.advice.map((line, index) => <li key={index}>{line}</li>)}
              </ul>
              <TechnicalDetail lines={copy.technical} score={balance.score} />
            </div>
          )}
          <div className="border-t border-white/[0.08] pt-4">
            <AddonConfig snapshot={snapshot} identity={identity} onSave={onUpdateConfig} />
          </div>
        </div>
      </Disclosure>

      <Disclosure
        summary={isHost ? "Chỉnh sửa vai trò" : "Xem toàn bộ vai trò"}
        hint={isHost ? "Bật, tắt hoặc đổi số Ma Sói" : "Đội hình do chủ phòng chọn"}
      >
        <RoleDeckPanel snapshot={snapshot} isHost={isHost} onUpdateConfig={onUpdateConfig} />
      </Disclosure>

      {isHost && (
        <Disclosure summary="Cài đặt nâng cao" hint="Thời gian và trò chuyện giọng nói">
          <div className="space-y-4">
            {snapshot.voice?.available && <VoiceConfig config={config} onSave={onUpdateConfig} />}
            <TimingConfig config={config} onSave={onUpdateConfig} />
          </div>
        </Disclosure>
      )}
    </div>
  );
}

/**
 * Bản gốc của engine, gấp lại.
 *
 * Không xoá hẳn: khi host báo "nó không cho tôi bắt đầu" thì con số và ngưỡng
 * chính xác là thứ duy nhất tra ra được chuyện gì đã xảy ra, và nó phải khớp
 * từng chữ với thứ server đang chặn.
 */
function TechnicalDetail({ lines, score }: { lines: string[]; score: number }) {
  if (lines.length === 0) return null;
  return (
    <details className="group mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-mist/85 transition hover:text-white">
        <span aria-hidden="true" className="transition group-open:rotate-90">
          ▸
        </span>
        Chi tiết kỹ thuật
      </summary>
      <ul className="mt-1.5 space-y-0.5 pl-4 text-[11px] leading-snug text-mist/85">
        <li>Điểm cân bằng: {score}/100 (cân là 45-55)</li>
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Mục mở ra được.
 *
 * `<details>` của trình duyệt chứ không phải một cái nút tự dựng: nó mở được
 * bằng bàn phím sẵn, tìm-trong-trang của trình duyệt tự bung nó ra, và trạng
 * thái đóng/mở không phải thêm một state nữa để giữ cho đúng.
 */
function Disclosure({
  summary,
  hint,
  children,
}: {
  summary: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <details className="lobby-disclosure group">
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 transition hover:bg-white/[0.04] hover:text-white">
        <span>
          <span className="text-[15px] font-bold text-white">{summary}</span>
          <span className="mt-0.5 block text-[13px] text-mist/85">{hint}</span>
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 text-lg text-mist/85 transition group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-white/[0.08] px-4 py-4">{children}</div>
    </details>
  );
}

/**
 * Chỉ hiện ĐÚNG lý do đang chặn, theo thứ tự người chơi gặp phải.
 *
 * Đứng ngay dưới nút để mắt không phải đi tìm: nút xám là câu hỏi, dòng này là
 * câu trả lời, và hai thứ đó cách nhau 10px. Lời rủ gửi mã phòng cho bạn bè đã
 * nằm ở `LobbyHeader` cùng thanh tiến độ, nên ở đây không nhắc lại.
 */
function BlockReason({
  block,
  isHost,
  onFixDeck,
  count,
}: {
  block: StartBlock;
  isHost: boolean;
  /** Áp preset của cỡ bàn hiện tại; null khi không phải lối thoát đúng. */
  onFixDeck: (() => void) | null;
  count: number;
}) {
  if (!block) return null;
  if (block.kind === "need-players") {
    return (
      <p className="lobby-block-reason text-center text-sm text-mist/85" data-testid="start-block">
        Cần thêm <b className="text-white">{block.missing}</b> người để bắt đầu.
      </p>
    );
  }
  /*
   * Lý do này trước đây KHÔNG tồn tại ở client.
   *
   * Server từ chối `room:start` bằng BALANCE_UNSTABLE khi đội hình mất cân bằng
   * và phòng đang ở Ranked, nhưng nút vẫn sáng - host bấm và nhận về một dòng
   * lỗi đỏ chép nguyên văn cảnh báo của engine. Câu ở đây nói ra cả hai lối
   * thoát mà server chấp nhận.
   */
  if (block.kind === "balance" || block.kind === "config") {
    return (
      <>
        <p className="lobby-block-reason text-center text-sm text-blood-400" data-testid="start-block">
          {block.kind === "balance"
            ? "Đội hình chưa đủ cân bằng để bắt đầu Ranked. Hãy sửa bộ bài hoặc chuyển sang Chaos."
            : block.message}
        </p>
        {onFixDeck && (
          <button
            type="button"
            className="btn-secondary lobby-fix-deck w-full text-sm"
            data-testid="fix-deck"
            onClick={onFixDeck}
          >
            Áp dụng đội hình chuẩn cho {count} người
          </button>
        )}
      </>
    );
  }
  // Khách không cần đọc danh sách người chưa sẵn sàng: họ không bấm bắt đầu.
  if (!isHost) return null;
  return (
    <p className="lobby-block-reason text-center text-sm text-amber-200" data-testid="start-block">
      Chờ {block.names.join(", ")} bấm sẵn sàng.
    </p>
  );
}

function ModeToggle({
  mode,
  isHost,
  onChange,
}: {
  mode: "ranked" | "chaos";
  isHost: boolean;
  onChange: (mode: "ranked" | "chaos") => void;
}) {
  const options = [
    {
      id: "ranked" as const,
      label: "Ranked",
      hint: "Sự kiện hiếm",
      title: "Sự kiện chỉ kích hoạt khi một phe bị lấn lướt mạnh",
      // Viền đặc + nền đậm + chữ sáng: ở bản cũ ô được chọn chỉ khác ô kia ở
      // sắc chữ, và trên nền xanh đen thì amber/65 với amber/100 nhìn gần như
      // nhau - không đọc kỹ thì không biết đang ở chế độ nào.
      on: "border-amber-400/70 bg-amber-500/25 text-amber-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]",
    },
    {
      id: "chaos" as const,
      label: "Chaos",
      hint: "Sự kiện mỗi vòng",
      title: "Sự kiện bất ngờ ngẫu nhiên kích hoạt mỗi vòng",
      on: "border-purple-400/70 bg-purple-500/25 text-purple-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]",
    },
  ];
  return (
    <div
      className="flex items-stretch gap-1.5 rounded-xl border border-night-600/70 bg-night-900/60 p-1.5"
      role="group"
      aria-label="Chế độ sự kiện"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={!isHost}
          onClick={() => onChange(option.id)}
          title={option.title}
          aria-pressed={mode === option.id}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold transition ${
            mode === option.id
              ? option.on
              : "border-transparent text-mist/85 hover:bg-white/[0.06] hover:text-white"
          } ${isHost ? "cursor-pointer" : "cursor-default"}`}
        >
          <span className="block">{option.label}</span>
          {/* 11px là cỡ chữ nhỏ nhất trên trang này và nó nằm ngay dưới nhãn
            * đậm 14px - ở khoảng cách ngồi chơi thật thì nó chỉ còn là một vệt
            * xám. Lên 12px và bớt mờ đi một nấc. */}
          <span className="mt-0.5 block text-xs font-medium opacity-90">{option.hint}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Khu Add-on: những luật thêm, bật/tắt cho từng ván.
 *
 * Công tắc bị `disabled` với người không phải chủ phòng chứ không bị ẩn đi -
 * `lastLetterToggle` trả về hai cờ tách bạch đúng cho việc này, và server vẫn
 * là nơi chặn thật (`updateConfig` đòi chủ phòng và đòi phòng chưa vào trận).
 */
function AddonConfig({
  snapshot,
  identity,
  onSave,
}: {
  snapshot: RoomSnapshot;
  identity: Identity;
  onSave: (c: RoomConfig) => void;
}) {
  const config = snapshot.config;
  const letter = lastLetterToggle(snapshot, identity.playerId);

  return (
    <div className="flex flex-col gap-2">
      <label
        className={`flex items-center justify-between gap-3 ${
          letter.canToggle ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <span className="font-semibold text-white">Phong thư sau cùng</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-blood-500 disabled:opacity-50"
          checked={letter.on}
          disabled={!letter.canToggle}
          onChange={(e) => onSave({ ...config, lastLetter: e.target.checked })}
        />
      </label>
      <p className="text-sm text-mist/85">
        Người chơi có thể để lại một thông điệp bí mật, chỉ được mở sau khi họ chết.
      </p>
      {!letter.canToggle && (
        <p className="text-xs text-mist/85">
          {snapshot.phase === "LOBBY"
            ? "Chỉ chủ phòng đổi được add-on."
            : "Không đổi được add-on khi trận đã bắt đầu."}
        </p>
      )}
    </div>
  );
}

/**
 * Công tắc voice chỉ hiện khi máy chủ có cấu hình LiveKit - `snapshot.voice`
 * vắng mặt nghĩa là server chưa bật, và khi đó gạt công tắc chẳng có tác dụng
 * gì ngoài gây khó hiểu.
 */
function VoiceConfig({
  config,
  onSave,
}: {
  config: RoomConfig;
  onSave: (c: RoomConfig) => void;
}) {
  const on = config.voice === true;
  return (
    <div className="flex flex-col gap-2 border-b border-white/[0.08] pb-4">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="font-semibold text-white">Trò chuyện bằng giọng nói</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-blood-500"
          checked={on}
          onChange={(e) => onSave({ ...config, voice: e.target.checked })}
        />
      </label>
      <p className="text-sm text-mist/85">
        Chỉ dùng được ban ngày. Ban đêm và phe Sói vẫn nhắn bằng chữ.
      </p>
      {on && (
        <p className="text-sm text-amber-200/90">
          Lưu ý: giọng nói làm lộ bạn là ai, kể cả khi vai của bạn còn bí mật.
        </p>
      )}
    </div>
  );
}

/** Mốc thời gian từng pha: thứ chỉnh một lần rồi quên, không phải thứ cả phòng cần nhìn. */
function TimingConfig({
  config,
  onSave,
}: {
  config: RoomConfig;
  onSave: (c: RoomConfig) => void;
}) {
  const [draft, setDraft] = useState<RoomConfig>(config);
  const [dirty, setDirty] = useState(false);

  const set = (patch: Partial<RoomConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  return (
    <div>
      <p className="font-semibold text-white">Thời gian từng pha</p>
      {/* Bảng cài đặt là cột hẹp: chia cột theo bề ngang thật của khung
          chứ không theo breakpoint màn hình, nếu không ba cột sẽ chen vào
          chỗ chỉ vừa hai và nhãn bị ngắt dòng. */}
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3">
        {(
          [
            // Khoảng hợp lệ phải khớp roomConfigSchema; đặc biệt finalVoteSeconds
            // có cận dưới 15 vì chuỗi não bot mất tới 13 giây.
            ["nightSeconds", "Đêm", 15, 120],
            ["discussionSeconds", "Thảo luận", 30, 300],
            ["voteSeconds", "Bỏ phiếu sơ bộ", 15, 120],
            ["defenseSeconds", "Biện hộ", 10, 60],
            ["finalVoteSeconds", "Bỏ phiếu xác nhận", 15, 60],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key} className="flex h-full flex-col gap-1 text-sm">
            <span className="text-mist/90">
              {label}{" "}
              <span className="whitespace-nowrap text-mist/85">
                ({min}-{max}s)
              </span>
            </span>
            {/* mt-auto: nhãn một dòng hay hai dòng thì ô nhập vẫn thẳng hàng nhau. */}
            <input
              type="number"
              className="input mt-auto"
              min={min}
              max={max}
              value={draft[key]}
              onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<RoomConfig>)}
            />
          </label>
        ))}
      </div>
      <button
        className="btn-primary mt-3 w-full sm:w-auto"
        disabled={!dirty}
        onClick={() => {
          onSave(draft);
          setDirty(false);
        }}
      >
        Lưu thời gian
      </button>
    </div>
  );
}
