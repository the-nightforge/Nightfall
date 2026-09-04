import type { RoomSnapshot } from "@masoi/shared";
import type { CinematicKind } from "./cinematic-transition";

/**
 * Phần LOGIC của "Phiên toà sống".
 *
 * Tách hẳn khỏi React và khỏi Three.js vì đúng lý do mà `village-memory-playback`
 * đã tách: bộ test của web chạy bằng `node:test` trên `src/lib/*.test.ts`, không
 * có DOM và không mount được component. Mọi quyết định dễ sai nhất của tính năng
 * này - phiên nào là phiên mới, snapshot này có đáng một nhịp hiệu ứng không,
 * phán quyết đã diễn chưa - đều nằm ở đây, nơi khẳng định được bằng test.
 *
 * Hai luật xuyên suốt cả file:
 *
 *   1. KHÔNG tự tính luật. Số phiếu, ngưỡng kết án, quyền nói, quyền bỏ phiếu và
 *      kết quả đều đọc nguyên từ snapshot. Ở đây chỉ có phép so hai snapshot với
 *      nhau để biết cái gì vừa đổi.
 *   2. KHÔNG suy ra thông tin server chưa gửi. `TrialView` cố ý không mang danh
 *      tính người bỏ phiếu xác nhận, nên không có hàm nào trong file này nhận
 *      `dayVoteHistory` để đi tìm chúng.
 */

/** Ba chặng của sân khấu. Không phải ba pha của game - xem `trialStageCandidate`. */
export type TrialStageAct = "DEFENSE" | "FINAL_VOTE" | "VERDICT";

export type TrialVerdict = "LYNCHED" | "SPARED";

export interface TrialStageView {
  /**
   * Định danh của MỘT phiên toà.
   *
   * KHÔNG phải `accusedId`. Một ván hoàn toàn có thể xử cùng một người hai lần
   * (được tha ở ngày 2, bị đưa ra toà lại ở ngày 4), và nếu khoá chỉ là id thì
   * phiên thứ hai thừa hưởng nguyên trạng thái "đã diễn phán quyết" của phiên
   * thứ nhất - tức là phiên thứ hai không có phán quyết nào cả.
   */
  key: string;
  act: TrialStageAct;
  accusedId: string;
  accusedName: string;
  /** Phiếu Treo đã đếm, ĐÃ TÍNH TRỌNG SỐ (Thị Trưởng x2). Không phải số người. */
  guilty: number;
  innocent: number;
  /**
   * Ngưỡng kết án, hoặc null khi không biết.
   *
   * `TrialRecap` của chặng phán quyết không mang trường này, nên ở đó nó được
   * bù từ trạng thái đã nhớ; null nghĩa là chưa từng thấy ngưỡng nào và dòng
   * chữ tương ứng phải biến mất chứ không được đoán ra một con số.
   */
  required: number | null;
  /** Chỉ là "đã chạm ngưỡng HIỆN TẠI", không phải "đã kết án" - xem chú thích dưới. */
  thresholdReached: boolean;
  /** Chỉ khác null ở chặng VERDICT, và chỉ khi server đã chốt. */
  verdict: TrialVerdict | null;
  /**
   * Chính trọng số ẩn của NGƯỜI ĐANG XEM đã lật bản án này.
   *
   * Chỉ có thể đúng ở chặng VERDICT, và chỉ với người vốn đã biết mình mang
   * trọng số đó - server không gửi nó cho ai khác. Đây là câu trả lời cho một
   * người xem duy nhất, không phải một thông báo cho cả làng: xem `TrialRecap`.
   */
  yourWeightDecided: boolean;
  canSpeak: boolean;
  canVote: boolean;
  hasVoted: boolean;
  myVote: boolean | null;
  /**
   * Số bóng người trong vòng khán giả của cảnh 3D.
   *
   * Lấy từ sĩ số phòng - một con số công khai, ai cũng thấy trong danh sách
   * người chơi - và CỐ Ý không liên quan gì tới phiếu: nó không đổi khi có
   * người bỏ phiếu, không đổi khi có người chết giữa phiên, nên không có cách
   * nào đọc ngược từ đám đông ra ai đã bỏ Treo hay Tha.
   */
  audience: number;
}

/** Khoá một phiên toà. Xem `TrialStageView.key` về việc vì sao không dùng riêng id. */
export function trialKey(snapshot: RoomSnapshot, accusedId: string): string {
  /*
   * Ba mảnh, và mảnh giữa mới là mảnh làm việc.
   *
   * `dayVoteHistory` được nối thêm một phần tử ở lúc CHỐT vòng đề cử, tức là
   * ngay trước khi phiên toà mở ra, và kết quả xác nhận sau đó ghi vào chính
   * phần tử ấy chứ không đẩy thêm cái mới. Nên độ dài của nó đứng yên suốt một
   * phiên toà (biện hộ → xác nhận → phán quyết) và nhích lên đúng một nấc ở
   * phiên sau - kể cả hai phiên trong cùng một ngày, cùng một bị cáo.
   */
  return `${snapshot.round}:${snapshot.dayVoteHistory.length}:${accusedId}`;
}

/**
 * Sân khấu NÊN hiển thị gì cho snapshot này, xét riêng snapshot đó.
 *
 * Trả null ở mọi pha khác - kể cả CHECK_WIN và HUNTER_SHOT, nơi `lastTrial` vẫn
 * còn dữ liệu. Đó là một lựa chọn có chủ đích: khi ván đã sang pha khác thì thao
 * tác của pha mới được ưu tiên ngay, và phần diễn còn lại của phiên toà bị huỷ.
 *
 * Chưa quyết định gì về hiệu ứng - đây mới là "trạng thái", còn "có đáng một
 * nhịp diễn không" là việc của `stepTrialStage`.
 */
export function trialStageCandidate(snapshot: RoomSnapshot | null): TrialStageView | null {
  if (!snapshot) return null;
  const audience = snapshot.players.length;

  if (snapshot.phase === "DEFENSE" || snapshot.phase === "FINAL_VOTE") {
    const trial = snapshot.trial;
    // Pha đúng mà `trial` rỗng là một snapshot không khớp nhau; không dựng bừa
    // một sân khấu không có bị cáo.
    if (!trial) return null;
    return {
      key: trialKey(snapshot, trial.accusedId),
      act: snapshot.phase,
      accusedId: trial.accusedId,
      accusedName: trial.accusedName,
      guilty: trial.guiltyVotes,
      innocent: trial.innocentVotes,
      required: trial.guiltyRequired,
      thresholdReached: trial.guiltyVotes >= trial.guiltyRequired && trial.guiltyRequired > 0,
      verdict: null,
      // Chưa chốt thì chưa có bản án nào để mà lật.
      yourWeightDecided: false,
      canSpeak: trial.canSpeak,
      canVote: trial.canVote,
      hasVoted: trial.hasVoted,
      myVote: trial.myVote,
      audience,
    };
  }

  if (snapshot.phase === "ELIMINATION") {
    const last = snapshot.lastTrial;
    // Không có phiên toà nào ở vòng này (hoà phiếu, hoặc "không treo ai" thắng):
    // ELIMINATION vẫn tới, nhưng không có gì để mà tuyên.
    if (!last) return null;
    return {
      key: trialKey(snapshot, last.accused.id),
      act: "VERDICT",
      accusedId: last.accused.id,
      accusedName: last.accused.name,
      guilty: last.guilty,
      innocent: last.innocent,
      // Recap không mang ngưỡng; `stepTrialStage` bù lại từ trạng thái đã nhớ.
      required: null,
      thresholdReached: false,
      verdict: last.lynched ? "LYNCHED" : "SPARED",
      // `=== true` chứ không phải truthiness: server cũ không gửi trường này, và
      // undefined ở đây nghĩa là "không biết", không phải "có".
      yourWeightDecided: last.yourWeightDecided === true,
      // Phiên đã xử xong: không còn ai nói, không còn ai bỏ phiếu.
      canSpeak: false,
      canVote: false,
      hasVoted: false,
      myVote: null,
      audience,
    };
  }

  return null;
}

/**
 * Một nhịp diễn mà sân khấu phải chạy.
 *
 * KHÔNG mang số liệu: mọi con số đều đọc thẳng từ `TrialStageView` và cập nhật
 * ngay ở DOM. Nhịp diễn chỉ nói "vừa có chuyện gì xảy ra", nên một hiệu ứng
 * chạy chậm hay bị bỏ qua cũng không bao giờ giữ lại một con số cũ trên màn.
 */
export type TrialStageBeat =
  | { kind: "OPENING" }
  /**
   * Một con dấu ẩn danh đi vào một bên cán cân.
   *
   * ĐÚNG MỘT con dấu cho mỗi lần một bên tăng, bất kể tăng mấy điểm. Phiếu Thị
   * Trưởng nặng gấp đôi, nên đếm con dấu theo điểm số sẽ biến một người thành
   * hai người bỏ phiếu - và ở một trò chơi mà cả ván xoay quanh việc đếm xem ai
   * còn lại, đó là một lời nói dối chứ không phải một hiệu ứng.
   */
  | { kind: "STAMP"; side: "guilty" | "innocent" }
  | { kind: "VERDICT"; verdict: TrialVerdict };

/**
 * Những gì sân khấu còn nhớ từ các snapshot trước.
 *
 * Sống ở LỚP TRÊN của component sân khấu và được bơm MỌI snapshot, kể cả những
 * snapshot không có phiên toà nào. Đó là điều kiện để `booted` có nghĩa: nếu chỉ
 * bơm lúc sân khấu đang hiện, thì snapshot đầu tiên luôn trùng với lúc phiên toà
 * mở ra và màn mở đầu sẽ không bao giờ chạy.
 */
export interface TrialStageMemory {
  /**
   * Đã xử lý ít nhất một snapshot trong phiên trình duyệt này.
   *
   * Cùng vai trò với `prev === null` ở `cinematicFor`: snapshot ĐẦU TIÊN không
   * có cạnh nào để so, nên nó chỉ được dựng trạng thái hiện tại. Đây chính là
   * thứ giữ cho người vừa F5 giữa phiên toà không bị dội lại màn mở đầu, và cho
   * người nối lại đúng lúc ELIMINATION không phải xem một phán quyết đã tuyên
   * từ trước khi họ tới.
   */
  booted: boolean;
  key: string | null;
  act: TrialStageAct | null;
  guilty: number;
  innocent: number;
  required: number | null;
  verdictPlayed: boolean;
}

export const EMPTY_TRIAL_STAGE_MEMORY: TrialStageMemory = {
  booted: false,
  key: null,
  act: null,
  guilty: 0,
  innocent: 0,
  required: null,
  verdictPlayed: false,
};

export interface TrialStageStep {
  memory: TrialStageMemory;
  /** null nghĩa là KHÔNG có sân khấu nào lúc này - bên gọi phải tháo hẳn nó. */
  view: TrialStageView | null;
  beats: TrialStageBeat[];
}

/** Quên hẳn phiên cũ, nhưng vẫn nhớ rằng mình đã chạy - `booted` không lùi lại. */
function forget(): TrialStageMemory {
  return { ...EMPTY_TRIAL_STAGE_MEMORY, booted: true };
}

/**
 * Ba tình huống đầu vào, và BA chứ không phải hai.
 *
 * Bản đầu chỉ có `TrialStageView | null`, nên "chưa nhận snapshot nào" và "một
 * snapshot hợp lệ của pha không có phiên toà" đi chung một nhánh. Hậu quả có
 * thật và đã tái hiện được: effect của hook chạy lần đầu lúc socket còn đang
 * bắt tay, `snapshot` khi ấy là `null`, nhánh chung kia bật `booted = true` -
 * và snapshot THẬT đầu tiên, dù là một phiên toà đã diễn từ trước khi người
 * chơi mở tab, lại bị coi là một cạnh mới và lĩnh trọn màn mở đầu.
 *
 * Tách làm ba thì mỗi tình huống nói đúng chuyện của nó: chưa có gì để so
 * (`NO_SNAPSHOT`), có snapshot nhưng không có phiên toà (`NO_TRIAL`), và có
 * phiên toà (`TRIAL`).
 */
export type TrialStageInput =
  | { kind: "NO_SNAPSHOT" }
  | { kind: "NO_TRIAL" }
  | { kind: "TRIAL"; view: TrialStageView };

export function trialStageInput(snapshot: RoomSnapshot | null): TrialStageInput {
  if (!snapshot) return { kind: "NO_SNAPSHOT" };
  const view = trialStageCandidate(snapshot);
  return view ? { kind: "TRIAL", view } : { kind: "NO_TRIAL" };
}

/**
 * Đưa một snapshot vào sân khấu.
 *
 * Hàm THUẦN: cùng (memory, input) cho cùng kết quả, không đọc đồng hồ, không
 * đọc `window`. Bên gọi thay `memory` bằng `step.memory` rồi vẽ `step.view` và
 * chạy `step.beats`.
 */
export function stepTrialStage(
  memory: TrialStageMemory,
  input: TrialStageInput,
): TrialStageStep {
  /*
   * Chưa có snapshot nào thì KHÔNG đụng vào trí nhớ.
   *
   * Đặc biệt là không bật `booted`: cờ đó có nghĩa "đã thấy ít nhất một trạng
   * thái thật của ván", và một lần render trước khi socket kịp trả lời không
   * phải một trạng thái nào cả.
   */
  if (input.kind === "NO_SNAPSHOT") return { memory, view: null, beats: [] };

  // Không còn phiên toà nào: bỏ hẳn bị cáo và kết quả cũ khỏi màn hình. Giữ lại
  // "cho đỡ trống" là cách chắc chắn nhất để một người vừa được tha vẫn đứng
  // trên bục trong lúc pha sau đã bắt đầu.
  if (input.kind === "NO_TRIAL") return { memory: forget(), view: null, beats: [] };

  const candidate = input.view;

  if (candidate.act === "VERDICT") {
    /*
     * Phán quyết chỉ diễn cho ĐÚNG phiên mà sân khấu này đang theo.
     *
     * Khoá không khớp có hai đường tới, và cả hai đều phải rơi vào cùng một chỗ:
     * người nối lại đúng lúc ELIMINATION (chưa từng thấy phiên toà), và một
     * snapshot lạc mô tả một phiên khác. Trong cả hai, dựng một sân khấu chỉ để
     * tuyên án một phiên chưa ai xem là bịa ra một cảnh chưa từng diễn.
     */
    if (memory.key !== candidate.key) return { memory: forget(), view: null, beats: [] };

    const view: TrialStageView = {
      ...candidate,
      // Ngưỡng của phiên này vẫn phải đọc được ở màn tuyên án: nó là con số mà
      // bản án vừa tuyên phải được đọc CẠNH nó. Lưu ý nó không phải lời giải
      // thích cho mọi bản án - 5 phiếu Treo trên ngưỡng 5 vẫn có thể thành "được
      // tha", và người duy nhất được biết vì sao là người mang trọng số ẩn đó.
      required: memory.required,
      thresholdReached: memory.required !== null && candidate.guilty >= memory.required,
    };
    const play = !memory.verdictPlayed && memory.booted;
    return {
      memory: {
        ...memory,
        booted: true,
        act: "VERDICT",
        guilty: candidate.guilty,
        innocent: candidate.innocent,
        verdictPlayed: true,
      },
      view,
      beats: play && candidate.verdict ? [{ kind: "VERDICT", verdict: candidate.verdict }] : [],
    };
  }

  // Phiên MỚI. Dựng thẳng trạng thái đang có, không phát lại từng lá phiếu đã
  // bỏ trước lúc mình tới - đó đúng là cái mà người vào giữa pha sẽ thấy.
  if (memory.key !== candidate.key) {
    return {
      memory: {
        booted: true,
        key: candidate.key,
        act: candidate.act,
        guilty: candidate.guilty,
        innocent: candidate.innocent,
        required: candidate.required,
        verdictPlayed: false,
      },
      view: candidate,
      // Màn mở đầu chỉ thuộc về CẠNH mở phiên toà: đã chạy rồi mới thấy phiên
      // này (`booted`), và thấy nó ngay từ lúc biện hộ. Bắt gặp giữa vòng xác
      // nhận thì phần mở màn đã trôi qua từ lâu.
      beats: memory.booted && candidate.act === "DEFENSE" ? [{ kind: "OPENING" }] : [],
    };
  }

  // Cùng phiên: chỉ còn phần đổi số.
  const beats: TrialStageBeat[] = [];
  // Chỉ TĂNG mới có con dấu. Tổng phiếu giảm là chuyện có thật - một cử tri chết
  // giữa phiên toà thì phiếu của họ rời khỏi bảng đếm - và lúc đó con số phải
  // đúng ngay, chứ không được diễn như thể vừa có ai bỏ thêm một phiếu.
  if (candidate.guilty > memory.guilty) beats.push({ kind: "STAMP", side: "guilty" });
  if (candidate.innocent > memory.innocent) beats.push({ kind: "STAMP", side: "innocent" });

  return {
    memory: {
      ...memory,
      booted: true,
      act: candidate.act,
      guilty: candidate.guilty,
      innocent: candidate.innocent,
      required: candidate.required,
    },
    view: candidate,
    beats,
  };
}

/**
 * Độ nghiêng của cán cân, -1 (Tha) đến 1 (Treo).
 *
 * TƯƠNG QUAN giữa hai bên, không phải tiến độ tới ngưỡng. Cán cân trả lời câu
 * "phe nào đang đông hơn"; còn "đã đủ để kết án chưa" là một câu khác hẳn và nó
 * có riêng một con số bằng chữ. Trộn hai câu đó vào một hình ảnh là cách nhanh
 * nhất để một cán cân nghiêng hết cỡ bị đọc thành một bản án.
 */
export function scaleTilt(guilty: number, innocent: number): number {
  const total = guilty + innocent;
  if (total <= 0) return 0;
  const tilt = (guilty - innocent) / total;
  return Math.max(-1, Math.min(1, tilt));
}

/** Nhãn chặng, dùng cho cả tiêu đề nhìn thấy lẫn thông báo trình đọc màn hình. */
export function actLabel(act: TrialStageAct): string {
  switch (act) {
    case "DEFENSE":
      return "Đang biện hộ";
    case "FINAL_VOTE":
      return "Bỏ phiếu xác nhận";
    case "VERDICT":
      return "Phán quyết";
  }
}

/**
 * Dòng tuyên án.
 *
 * "Được tha" dừng ở đúng chỗ đó và KHÔNG được nối thêm một chữ nào về vai trò
 * thật: làng vừa quyết định không treo người này, chứ làng không hề biết người
 * này là ai. Một câu như "hoá ra là Dân Làng" ở đây sẽ là thông tin mà không ai
 * trong ván được phép có.
 */
export function verdictOutcome(verdict: TrialVerdict): string {
  return verdict === "LYNCHED" ? "Treo cổ" : "Được tha";
}

export function verdictLabel(verdict: TrialVerdict): string {
  return `Phán quyết: ${verdictOutcome(verdict)}`;
}

/**
 * Lá phiếu của chính người xem, hoặc null khi họ chưa bỏ.
 *
 * Đọc `hasVoted` chứ KHÔNG dùng truthiness của `myVote`: `myVote === false` là
 * một phiếu Tha đã bỏ xong, và nhầm nó thành "chưa bỏ phiếu" sẽ khiến người vừa
 * bấm Tha nhìn thấy hai cái nút hiện lại như chưa có gì xảy ra.
 */
export function myVoteLabel(view: TrialStageView): string | null {
  if (!view.hasVoted) return null;
  return view.myVote ? "Treo cổ" : "Tha";
}

/**
 * Câu tóm tắt cho vùng aria-live.
 *
 * MỘT câu cho cả bảng số, không phải một thông báo cho mỗi lá phiếu: ở một phòng
 * 15 người, đọc từng phiếu một nghĩa là trình đọc màn hình nói suốt cả pha và
 * nuốt mất mọi thứ khác. Bên gọi còn tiết chế thêm bằng nhịp - xem `TrialStage`.
 */
export function tallyAnnouncement(view: TrialStageView): string {
  if (view.act === "DEFENSE") return `${view.accusedName} đang biện hộ.`;
  if (view.act === "VERDICT") {
    // "Phán quyết cho X: Treo cổ", KHÔNG phải "X: Phán quyết: Treo cổ" - nhãn
    // nhìn thấy đã mang sẵn chữ "Phán quyết", và ghép thẳng nó vào một câu có
    // tên người thì trình đọc màn hình đọc ra hai lần hai dấu hai chấm.
    return view.verdict ? `Phán quyết cho ${view.accusedName}: ${verdictOutcome(view.verdict)}.` : "";
  }
  const threshold =
    view.required === null
      ? ""
      : ` Cần ${view.required} phiếu Treo để kết án, nếu mọi lá phiếu đều nặng như nhau.`;
  return `Treo ${view.guilty}, Tha ${view.innocent}.${threshold}`;
}

/**
 * Cảnh chuyển pha này có thuộc về sân khấu "Phiên toà sống" không.
 *
 * Hai chỗ cùng biết vẽ một phiên toà, nên phải có ĐÚNG MỘT chỗ quyết định ai
 * sở hữu cảnh nào - và nó nằm ở đây, một hàm thuần, chứ không phải một điều kiện
 * lọt giữa thân một component. Hai cảnh `TRIAL` (mở phiên toà) và `VERDICT`
 * (tuyên án) là hai cảnh mà sân khấu tự diễn lấy; phát cả hai bản là hai màn mở
 * đầu chồng nhau rồi hai phán quyết chồng nhau.
 *
 * Rơi về bản 2D KHÔNG trả lại quyền: bản 2D của sân khấu vẫn tuyên án bằng chữ
 * và vẫn đổi ánh sáng, nên nó vẫn là chủ sở hữu. Đó là lý do hàm này không hỏi
 * gì về khả năng dựng 3D của máy - sân khấu luôn có mặt, chỉ là bằng chất liệu
 * nào.
 */
export function stageOwnsCinematic(kind: CinematicKind): boolean {
  return kind === "TRIAL" || kind === "VERDICT";
}

// ---------------------------------------------------------------------------
// Vòng đời của MỘT phiên trình duyệt, ở dạng thuần.
// ---------------------------------------------------------------------------

/**
 * Trạng thái mà `useLiveTrial` giữ giữa các lần render.
 *
 * Sống ở đây chứ không nằm trong hook vì hai lỗi tốn kém nhất của tính năng này
 * đều là lỗi VÒNG ĐỜI, không phải lỗi tính toán - và bộ test của web chạy bằng
 * `node:test`, không có DOM và không mount được React. Cái gì phải khẳng định
 * được thì phải là hàm thuần; hook chỉ còn là một lớp vỏ mỏng gọi vào đây.
 *
 * Hai lỗi ấy:
 *
 *   1. Effect chạy lần đầu lúc `snapshot` còn `null` và bật `booted` - xem
 *      `TrialStageInput`.
 *   2. Một lô nhịp diễn nằm lại trong state của hook sau khi đã phát. Tắt rồi
 *      bật sân khấu giữa chừng - hay chỉ cần xoay ngang điện thoại rồi xoay
 *      lại - là canvas được dựng lại và nhận LẠI đúng lô đó, rồi phát nó lần
 *      thứ hai với một mốc thời gian mới. `beatsId`/`consumedId` là chỗ chặn:
 *      một lô đã có người nhận thì không bao giờ được phát ra nữa.
 */
export interface LiveTrialSession {
  memory: TrialStageMemory;
  view: TrialStageView | null;
  /** Lô nhịp diễn gần nhất. Chỉ có nghĩa khi `beatsId > consumedId`. */
  beats: TrialStageBeat[];
  /** Số thứ tự lô; `0` là chưa từng có lô nào. */
  beatsId: number;
  /** Lô đã được sân khấu nhận, hoặc đã bị bỏ vì không ai nhận được. */
  consumedId: number;
  /**
   * Snapshot đã xử lý gần nhất, so bằng THAM CHIẾU.
   *
   * Hook chạy lại cả khi người chơi gạt công tắc chứ không riêng lúc có
   * snapshot mới; không có mốc này thì mỗi lần gạt là một lần bơm lại cùng một
   * snapshot vào máy trạng thái.
   */
  lastSnapshot: RoomSnapshot | null;
  /** Đường truyền ở lần xử lý trước. */
  connected: boolean;
  /**
   * Vừa nối lại sau khi rớt, và chưa nhận snapshot bù nào.
   *
   * Server không gửi luồng sự kiện, nó gửi lại TRẠNG THÁI - nên snapshot đầu
   * tiên sau khi nối lại có thể nhảy vọt vài lá phiếu. Đó là dữ liệu bù, không
   * phải chuyện vừa xảy ra, nên nó chỉ được dựng lại bảng số chứ không được
   * diễn. Cờ này sống qua nhiều lần gọi vì lúc socket báo nối lại thì snapshot
   * bù thường chưa tới.
   */
  resyncPending: boolean;
}

export const EMPTY_LIVE_TRIAL_SESSION: LiveTrialSession = {
  memory: EMPTY_TRIAL_STAGE_MEMORY,
  view: null,
  beats: [],
  beatsId: 0,
  consumedId: 0,
  lastSnapshot: null,
  connected: false,
  resyncPending: false,
};

export interface LiveTrialInputs {
  snapshot: RoomSnapshot | null;
  /** Socket đang nối. Từ `useRoomSocket`, không phải suy đoán. */
  connected: boolean;
}

/** Lô nhịp diễn còn chờ người nhận; rỗng khi đã có người nhận hoặc đã bị bỏ. */
export function pendingBeats(session: LiveTrialSession): TrialStageBeat[] {
  return session.beatsId > session.consumedId ? session.beats : [];
}

/**
 * Đánh dấu một lô đã có người nhận.
 *
 * Nhận `id` chứ không phải "lô hiện tại": sân khấu có thể gọi muộn một nhịp, và
 * lúc đó lô mới đã tới - đánh dấu bừa sẽ nuốt mất lô mới. Gọi lại với cùng `id`
 * là no-op, nên React chạy effect hai lần ở chế độ nghiêm ngặt cũng không sao.
 */
export function consumeLiveTrialBeats(session: LiveTrialSession, id: number): LiveTrialSession {
  if (id !== session.beatsId || session.consumedId >= id) return session;
  return { ...session, consumedId: id };
}

/**
 * Một lần hook chạy.
 *
 * Thứ tự các cửa ở đây là thứ tự của những thứ đã từng hỏng, nên đừng đảo:
 *
 *   1. Cùng một snapshot (so tham chiếu) thì không bước máy trạng thái. Hook
 *      chạy lại vì nhiều lý do khác ngoài "có snapshot mới".
 *   2. Snapshot bù sau khi nối lại chỉ dựng trạng thái, không diễn.
 */
export function advanceLiveTrial(
  session: LiveTrialSession,
  inputs: LiveTrialInputs,
): LiveTrialSession {
  const reconnected = !session.connected && inputs.connected && session.memory.booted;
  const resyncPending = session.resyncPending || reconnected;

  if (inputs.snapshot === session.lastSnapshot) {
    return { ...session, connected: inputs.connected, resyncPending };
  }

  const step = stepTrialStage(session.memory, trialStageInput(inputs.snapshot));
  // Lô chỉ được PHÁT khi nó mô tả một chuyện vừa xảy ra trước mắt người xem.
  // Ngoài điều đó thì nó vẫn được đếm số nhưng đánh dấu tiêu thụ luôn -
  // `beatsId` không bao giờ lùi, nên không có đường nào để một lô đã bỏ quay
  // lại.
  const play = step.beats.length > 0 && !resyncPending;
  const beatsId = step.beats.length > 0 ? session.beatsId + 1 : session.beatsId;

  return {
    memory: step.memory,
    view: step.view,
    beats: play ? step.beats : [],
    beatsId,
    consumedId: play ? session.consumedId : beatsId,
    lastSnapshot: inputs.snapshot,
    connected: inputs.connected,
    // Snapshot bù đã tới và đã được dựng; từ đây trở đi lại là chuyện đang xảy ra.
    resyncPending: false,
  };
}
