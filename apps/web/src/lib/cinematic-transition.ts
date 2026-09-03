import type { GameEventId, GameEventView, Phase, RoomSnapshot } from "@masoi/shared";
import { eventIcon } from "./event-art";
import { WEBGL_KINDS } from "./cinematic-webgl";

/**
 * Chuyển cảnh giữa hai snapshot.
 *
 * Cùng nguyên tắc với `cuesFor` bên audio-cues: cinematic được chọn từ CẠNH
 * giữa hai snapshot chứ không từ trạng thái của snapshot mới. Server chỉ đẩy
 * snapshot chứ không có luồng sự kiện, nên xét theo trạng thái sẽ khiến mỗi lần
 * resync sau khi rớt mạng phát lại một đoạn chuyển cảnh của việc đã xảy ra từ
 * lâu - đúng lúc người chơi vừa nối lại và đang cần nhìn bàn.
 *
 * Module này KHÔNG đụng gì tới React hay DOM: nó chỉ trả lời "cạnh này đáng một
 * đoạn chuyển cảnh nào", còn phát hay bỏ qua là việc của CinematicOverlay.
 */

export const CINEMATIC_KINDS = [
  "NIGHTFALL",
  "DAWN",
  "TRIAL",
  "VERDICT",
  "VILLAGE_WIN",
  "WOLVES_WIN",
  "KILLER_WIN",
  "DRAW",
  "WOLF_THREAT",
  "VILLAGE_BOON",
  "RULE_CHANGE",
  "SPIRIT",
] as const;

export type CinematicKind = (typeof CINEMATIC_KINDS)[number];

export interface Cinematic {
  kind: CinematicKind;
  /**
   * Khoá định danh của ĐÚNG lần chuyển cảnh này.
   *
   * Overlay nhớ khoá vừa phát và bỏ qua khoá trùng. Nhờ vậy hai snapshot cùng
   * mô tả một cạnh (server đẩy lại, hoặc một trường phụ đổi giữa pha) không làm
   * màn hình chớp thêm một lần nữa.
   */
  key: string;
  /** Tên file trong /cinematics, không kèm phần mở rộng. */
  clip: string;
  durationMs: number;
  /**
   * Nhãn của HỌ hình ảnh - "Luật làng thay đổi", "Màn đêm buông xuống".
   *
   * Đây là tên của đoạn phim, không phải tên của chuyện vừa xảy ra. Với cạnh
   * pha thì hai thứ đó là một; với sự kiện thì không, và chỗ hiển thị chính là
   * `title` chứ không phải trường này.
   */
  label: string;
  /**
   * Dòng chữ LỚN trên màn hình.
   *
   * Với sự kiện đây là tên thật lấy từ snapshot ("Giới Nghiêm"), không phải nhãn
   * họ. Bản cũ in `label` cho cả hai, nên năm sự kiện trong họ RULE_CHANGE đều
   * hiện đúng một dòng "Luật làng thay đổi" - người chơi xem xong đoạn chuyển
   * cảnh vẫn không biết luật nào vừa đổi, và phải đi tìm thẻ sự kiện để đọc lại.
   */
  title: string;
  /**
   * Dòng phụ ngắn dưới tên: `announcement` nếu sự kiện có kết quả công khai,
   * không thì là mô tả. Đã cắt ngắn - xem `EVENT_DETAIL_MAX`.
   */
  detail: string | null;
  /** Ký hiệu sự kiện. Cạnh pha không có sự kiện nào nên là null. */
  icon: string | null;
}

/**
 * Bốn "họ" hình ảnh cho 15 sự kiện.
 *
 * Mỗi sự kiện một đoạn phim riêng là 15 clip phải dựng, phải tải, và phải giữ
 * cho khớp mỗi lần thêm sự kiện mới. Tên, icon và nội dung sự kiện vẫn lấy
 * nguyên từ snapshot; họ hình ảnh chỉ nói giúp đúng một câu - chuyện vừa xảy ra
 * nghiêng về phía ai.
 *
 * Record<GameEventId, ...> chứ không phải object thường: thêm sự kiện mới vào
 * GameEventId mà quên khai báo ở đây là lỗi biên dịch, thay vì một sự kiện âm
 * thầm rơi về họ mặc định.
 */
const EVENT_FAMILY: Record<GameEventId, CinematicKind> = {
  MOONLESS_NIGHT: "WOLF_THREAT",
  BLOODY_HUNT: "WOLF_THREAT",
  HOWL_OF_THE_PACK: "WOLF_THREAT",
  BLOOD_MOON: "WOLF_THREAT",
  WOLF_SHADOW: "WOLF_THREAT",

  CLEARING_MIST: "VILLAGE_BOON",
  PEACEFUL_NIGHT: "VILLAGE_BOON",
  MORNING_REPORT: "VILLAGE_BOON",
  JUDGMENT_DAY: "VILLAGE_BOON",

  CURFEW: "RULE_CHANGE",
  SILENT_NIGHT: "RULE_CHANGE",
  AMNESTY_DAY: "RULE_CHANGE",
  LAST_STAND: "RULE_CHANGE",
  DAY_OF_TRUTH: "RULE_CHANGE",

  DEAD_CAN_SPEAK: "SPIRIT",
};

interface KindMeta {
  clip: string;
  durationMs: number;
  label: string;
}

/**
 * Thời lượng đo bằng thứ người chơi MẤT, không phải thứ họ được xem.
 *
 * Đồng hồ của pha chạy ở server và overlay không hoãn state một mili giây nào -
 * nhưng nó che mất bàn. Một giây đủ để mắt hiểu cảnh vừa đổi; hai giây trong
 * lúc đang phải chọn người là đã đắt. Chỉ màn kết thúc được dài hơn, vì lúc đó
 * không còn gì phải bấm nữa.
 */
const KIND_META: Record<CinematicKind, KindMeta> = {
  NIGHTFALL: { clip: "nightfall", durationMs: 1200, label: "Màn đêm buông xuống" },
  DAWN: { clip: "dawn", durationMs: 1200, label: "Trời sáng trên ngôi làng" },
  TRIAL: { clip: "trial", durationMs: 1000, label: "Phiên toà bắt đầu" },
  VERDICT: { clip: "verdict", durationMs: 1100, label: "Làng đã có phán quyết" },
  VILLAGE_WIN: { clip: "village-win", durationMs: 2000, label: "Dân Làng chiến thắng" },
  WOLVES_WIN: { clip: "wolves-win", durationMs: 2000, label: "Ma Sói chiến thắng" },
  /*
   * Hai cảnh này CHƯA có clip trong `public/cinematics`, và đó là một trạng
   * thái hợp lệ chứ không phải một thiếu sót đang chờ sửa: overlay luôn dựng
   * bản CSS trước rồi mới mờ chồng clip lên khi trình duyệt báo phát được, nên
   * thiếu file cho ra đúng bản CSS - không màn hình đen, không chặn ván nào.
   * Xem `public/cinematics/README.md`.
   *
   * Chúng cũng KHÔNG nằm trong `nextClips`: tải trước một file không tồn tại là
   * một lượt 404 cho mọi người chơi ở mỗi vòng.
   */
  KILLER_WIN: { clip: "killer-win", durationMs: 2000, label: "Sát Nhân chiến thắng" },
  DRAW: { clip: "draw", durationMs: 2000, label: "Không ai còn sống" },
  WOLF_THREAT: { clip: "event-wolf-threat", durationMs: 900, label: "Bầy Sói trỗi dậy" },
  VILLAGE_BOON: { clip: "event-village-boon", durationMs: 900, label: "Vận may đến với làng" },
  RULE_CHANGE: { clip: "event-rule-change", durationMs: 900, label: "Luật làng thay đổi" },
  SPIRIT: { clip: "event-spirit", durationMs: 900, label: "Linh hồn lên tiếng" },
};

export function cinematicMeta(kind: CinematicKind): KindMeta {
  return KIND_META[kind];
}

/** Mọi tên file cần có trong /public/cinematics; README ở đó liệt kê đúng danh sách này. */
export const CINEMATIC_CLIPS: string[] = CINEMATIC_KINDS.map((kind) => KIND_META[kind].clip);

/**
 * Định danh của MỘT lần một sự kiện kích hoạt.
 *
 * Sự kiện nằm trong `activeEvent` suốt cả pha nó tác dụng, nên chỉ so id là
 * không đủ: cùng một sự kiện ở hai vòng khác nhau là hai lần kích hoạt khác
 * nhau, còn cùng id + cùng vòng + cùng pha đích thì luôn là một lần duy nhất.
 */
function eventKey(event: GameEventView | null | undefined): string | null {
  return event ? `${event.id}:${event.round}:${event.targetPhase}` : null;
}

/**
 * Trần độ dài dòng phụ.
 *
 * Mô tả sự kiện dài nhất trong game là hai câu, và đoạn chuyển cảnh chỉ sống
 * 900ms. Ở 390px một dòng chứa được khoảng 40 ký tự, nên 96 ký tự là hai dòng
 * rưỡi - vừa đủ để liếc, chưa đủ để đoạn chữ phủ kín màn hình và che mất chính
 * cái cảnh nó đang chú thích. Ai muốn đọc kỹ đã có thẻ EventBanner ở lại cả
 * vòng ngay sau đó.
 */
export const EVENT_DETAIL_MAX = 96;

/** Cắt một đoạn mô tả về đúng một dòng phụ, cắt ở khoảng trắng gần nhất. */
export function shortDetail(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= EVENT_DETAIL_MAX) return trimmed;
  const cut = trimmed.slice(0, EVENT_DETAIL_MAX);
  const space = cut.lastIndexOf(" ");
  // Cắt giữa từ ra "Giới Nghiê..."; lùi về khoảng trắng gần nhất, trừ khi cả
  // đoạn không có khoảng trắng nào (không xảy ra với tiếng Việt, nhưng đây là
  // chuỗi từ server nên không hứa trước được gì).
  return `${(space > EVENT_DETAIL_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function build(kind: CinematicKind, key: string, event?: GameEventView): Cinematic {
  const meta = KIND_META[kind];
  return {
    kind,
    key,
    clip: meta.clip,
    durationMs: meta.durationMs,
    label: meta.label,
    // Sự kiện nói tên của chính nó; cạnh pha thì nhãn họ đã là tên rồi.
    title: event?.name?.trim() || meta.label,
    // announcement trước description: nó là thứ VỪA xảy ra ("Kết quả Thám Tử:
    // ..."), còn description chỉ nhắc lại luật chung của sự kiện.
    detail: event ? shortDetail(event.announcement ?? event.description) : null,
    icon: event ? eventIcon(event.id) : null,
  };
}

/**
 * Đoạn chuyển cảnh cho cạnh prev -> next, hoặc null nếu cạnh này không đáng một
 * đoạn nào.
 *
 * Thứ tự ưu tiên khi một cạnh chạm nhiều luật cùng lúc:
 *
 *  1. Kết thúc ván - không còn gì phía sau để mà nhường.
 *  2. Sự kiện vừa kích hoạt - hiếm, bất ngờ, và là thứ người chơi phải biết
 *     ngay. Sự kiện gần như luôn rơi đúng vào lúc sang pha, nên nếu nhường cho
 *     cạnh pha thì nó sẽ không bao giờ được thông báo lớn lần nào.
 *  3. Cạnh pha thường lệ.
 */
export function cinematicFor(prev: RoomSnapshot | null, next: RoomSnapshot): Cinematic | null {
  // Snapshot đầu tiên không có cạnh nào để so. Đây cũng chính là thứ giữ cho
  // người vào phòng giữa pha (F5, mở tab mới) không bị dội một đoạn chuyển cảnh
  // của chuyện đã xong từ trước khi họ tới.
  if (!prev) return null;

  if (next.phase === "GAME_OVER" && prev.phase !== "GAME_OVER" && next.winner) {
    /*
     * Bốn kết cục, bốn cảnh. Biểu thức hai nhánh cũ chiếu màn "Dân Làng chiến
     * thắng" lên đúng những ván mà cả làng vừa chết sạch.
     */
    const kind: CinematicKind = {
      wolves: "WOLVES_WIN",
      village: "VILLAGE_WIN",
      serial_killer: "KILLER_WIN",
      draw: "DRAW",
    }[next.winner] as CinematicKind;
    return build(kind, `over:${next.winner}:${next.round}`);
  }

  const activeKey = eventKey(next.activeEvent);
  if (next.activeEvent && activeKey && activeKey !== eventKey(prev.activeEvent)) {
    return build(EVENT_FAMILY[next.activeEvent.id], `event:${activeKey}`, next.activeEvent);
  }

  const kind = phaseKind(prev.phase, next.phase);
  if (!kind) return null;
  return build(kind, `phase:${kind}:${next.round}:${next.phase}`);
}

function phaseKind(from: Phase, to: Phase): CinematicKind | null {
  if (from === to) return null;
  if (to === "NIGHT") return "NIGHTFALL";
  // NIGHT_RESULT chỉ vào được từ NIGHT, nhưng viết theo "vừa bước vào" thay vì
  // "đi từ NIGHT sang" để chèn thêm một pha đệm sau này không âm thầm mất cảnh.
  if (to === "NIGHT_RESULT") return "DAWN";
  // Riêng phiên toà phải xét cả pha nguồn: DEFENSE -> FINAL_VOTE là đi TIẾP
  // trong cùng một phiên toà, không phải mở một phiên toà mới.
  if (from === "VOTING" && (to === "DEFENSE" || to === "FINAL_VOTE")) return "TRIAL";
  if (from === "FINAL_VOTE" && to === "ELIMINATION") return "VERDICT";
  return null;
}

/**
 * Clip nên nạp sẵn khi đang ở pha này.
 *
 * Không nạp cả mười: người chơi đang trong đêm sẽ không gặp màn phiên toà trong
 * ít nhất vài phút nữa, và tải trước 10MB trên 4G để dùng 1MB là trả tiền hộ
 * nhà mạng. Chỉ lấy đúng những cảnh có thể tới ngay sau pha hiện tại.
 */
export function nextClips(phase: Phase): string[] {
  const kinds = ((): CinematicKind[] => {
    switch (phase) {
      case "LOBBY":
      case "ROLE_REVEAL":
        return ["NIGHTFALL"];
      case "NIGHT":
        return ["DAWN"];
      case "NIGHT_RESULT":
      case "DAY_DISCUSSION":
      case "VOTING":
        return ["TRIAL"];
      case "DEFENSE":
      case "FINAL_VOTE":
        return ["VERDICT"];
      // Sau khi có người ngã xuống, ván hoặc kết thúc ngay hoặc sang đêm mới.
      case "ELIMINATION":
      case "CHECK_WIN":
      case "HUNTER_SHOT":
        return ["NIGHTFALL", "WOLVES_WIN", "VILLAGE_WIN"];
      case "GAME_OVER":
        return [];
    }
  })();
  return kinds.map((kind) => KIND_META[kind].clip);
}

/** Bốn clip của bốn họ sự kiện. */
export const EVENT_CLIPS: string[] = ["WOLF_THREAT", "VILLAGE_BOON", "RULE_CHANGE", "SPIRIT"].map(
  (kind) => KIND_META[kind as CinematicKind].clip,
);

/**
 * Clip của những cảnh đã có bản 3D.
 *
 * Suy ra từ `WEBGL_KINDS` chứ không chép tay tên file: thêm một cảnh 3D thì
 * danh sách này tự đúng theo.
 */
const WEBGL_CLIPS = new Set<string>(
  [...WEBGL_KINDS].map((kind) => KIND_META[kind].clip),
);

export interface PrefetchInputs {
  phase: Phase;
  /** Kết quả của `playbackMode`. Chỉ chế độ "video" mới tải file. */
  mode: "video" | "css" | "none";
  saveData: boolean;
  /** `navigator.connection.effectiveType`, hoặc null nếu trình duyệt không có. */
  effectiveType: string | null;
  /**
   * Máy này sẽ dựng cảnh 3D cho những kind có bản WebGL.
   *
   * Không tải clip của một cảnh sẽ không dùng tới clip. Là OPTIONAL để mọi chỗ
   * gọi cũ giữ nguyên hành vi.
   */
  webgl?: boolean;
}

export interface PrefetchPlan {
  /** Nạp ngay: clip có thể tới ngay sau pha hiện tại. */
  now: string[];
  /** Nạp lúc máy rảnh: bốn clip sự kiện. Không bao giờ được tranh băng thông với `now`. */
  idle: string[];
}

/** Mạng chậm tới mức không đáng tải thêm thứ chỉ CÓ THỂ dùng tới. */
function tooSlow(effectiveType: string | null): boolean {
  return effectiveType === "2g" || effectiveType === "slow-2g";
}

/**
 * Những clip đáng nạp trước khi đang ở pha này.
 *
 * Sự kiện là chỗ khó nhất của toàn bộ hệ prefetch. Nó không nằm trên một cạnh
 * pha nào đoán trước được - nó nổ giữa ván, và đoạn chuyển cảnh của nó chỉ dài
 * 900ms. Bản cũ chỉ nạp theo pha, nên bốn clip `event-*` bắt đầu tải đúng lúc
 * thẻ <video> được dựng: trên 4G một file 1MB mất hơn 900ms, nghĩa là clip sự
 * kiện gần như KHÔNG BAO GIỜ kịp hiện, và cái người chơi luôn thấy là bản CSS.
 *
 * Nên bốn clip đó phải có mặt từ trước. Nhưng chúng cũng chỉ là "có thể cần":
 * cả ván có khi không có sự kiện nào. Vì vậy chúng đi ở luồng `idle`, sau khi
 * ván đã bắt đầu, và biến mất hoàn toàn trên mạng đo được là chậm.
 */
export function prefetchPlan(inputs: PrefetchInputs): PrefetchPlan {
  const empty: PrefetchPlan = { now: [], idle: [] };
  // Save-Data đã khiến playbackMode trả "css" nên nhánh này gần như không tới -
  // nhưng "gần như" không đủ cho một cái cờ mà người dùng bật lên để KHÔNG bị
  // tải hộ. Xét lại ở đây để chính sách prefetch tự đứng được, kể cả khi ai đó
  // gọi nó từ chỗ khác.
  if (inputs.mode !== "video" || inputs.saveData) return empty;

  const now = nextClips(inputs.phase).filter(
    (clip) => !(inputs.webgl === true && WEBGL_CLIPS.has(clip)),
  );
  // Trang chủ không dựng CinematicOverlay nên không có gì tải từ đó; LOBBY là
  // trong phòng nhưng chưa vào ván, còn GAME_OVER thì không còn sự kiện nào nổ
  // được nữa. Hai chỗ đó chỉ nạp theo pha.
  const started = inputs.phase !== "LOBBY" && inputs.phase !== "GAME_OVER";
  if (!started || tooSlow(inputs.effectiveType)) return { now, idle: [] };
  return { now, idle: EVENT_CLIPS.filter((clip) => !now.includes(clip)) };
}
