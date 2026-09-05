import {
  analyzeChat,
  openingOf,
  renderSpeechTemplate,
  speechTextFingerprint,
} from "@masoi/game-engine";
import { botBrain } from "./index";
import { DEFAULT_CHAT_MAX } from "./decide";
import { speechStats, type SpeechStats } from "./speech-stats";
import type { BotBrain, RenderedSpeech, SpeechRequest } from "./types";

/**
 * Câu chữ cho một ý định đã chốt, không cần nhà cung cấp.
 *
 * KHÔNG dùng RNG: đây là đường lui, và một đường lui ngẫu nhiên sẽ làm hỏng
 * chính tính tái lập mà Phase 1 và Phase 3 được xây để có. Biến thiên đến từ
 * hàm băm của `(phòng, bot, vòng, lượt nói, vân tay ý định)`, nên hai lần chạy
 * cùng đầu vào cho cùng một câu, mà hai BOT cùng ý vẫn nói khác nhau.
 *
 * Bảng mẫu sống trong `@masoi/game-engine` chứ không ở đây: self-play cũng cần
 * nó, và engine phải thuần nên nó không thể import ngược lên server.
 */
/**
 * Loại ý định KHÔNG nói được nếu thiếu người để nói tới.
 *
 * Lõi luôn gắn mục tiêu cho những loại này, nên nhánh dưới là phòng thủ. Nhưng
 * phòng thủ đúng chỗ: im lặng còn hơn phát ra "Tôi nghi người đó." - một câu
 * đọc lên như phần mềm hỏng, ngay giữa một ván đấu.
 */
const NEEDS_SOMEONE = new Set([
  "ACCUSE",
  "QUESTION",
  "AGREE",
  "DISAGREE",
  "DEFEND",
  "CHANGE_MIND",
  "REPLY",
  "CHALLENGE",
  "ASK_EVIDENCE",
]);

export function speechTemplate(request: SpeechRequest): string | null {
  // Lượt tự bào chữa không có "author" cụ thể để DISAGREE nhắm tới - vote lộ AI
  // đang bị nhắm, không lộ AI đã bỏ phiếu (xem `intentLine` trong prompt.ts).
  // Bắt buộc có người ở đây thì một bị cáo không claim gì sẽ RƠI VỀ IM LẶNG mỗi
  // khi nhà cung cấp cũng hỏng - đúng thứ `random-brain.ts` từng tồn tại để
  // tránh ("một bị cáo im lặng trông như màn hình hỏng"). `fill()` đã có sẵn
  // chỗ trống chung ("người đó") cho đúng trường hợp thiếu target này.
  const exemptFromTarget = request.defense !== null && request.intention.kind === "DISAGREE";
  if (
    !exemptFromTarget &&
    NEEDS_SOMEONE.has(request.intention.kind) &&
    request.targetName === null &&
    request.replyTo === null
  ) {
    return null;
  }

  return renderSpeechTemplate({
    intention: request.intention,
    targetName: request.targetName,
    replyToName: request.replyTo?.actorName ?? null,
    seedTag: request.roomCode,
    botId: request.speaker.id,
    round: request.round,
    seq: request.seq,
    // Vân tay của chính những câu BOT vừa nói: mẫu trùng sẽ bị bỏ qua.
    avoidFingerprints: request.recentOwnLines.map(speechTextFingerprint),
    // Cách mở đầu vừa dùng: mẫu trùng mở đầu bị dịch qua khi còn mẫu khác.
    avoidOpenings: request.avoidOpenings,
  });
}

/**
 * Diễn đạt một ý định đã chốt thành một câu chat.
 *
 * Nhà cung cấp được ưu tiên vì nó nói tự nhiên hơn, nhưng nó chỉ đổi được CÂU
 * CHỮ: mục tiêu, loại ý định và bằng chứng nằm trong `request` và không bao giờ
 * được đọc ngược lại từ output. Mọi lỗi - timeout, JSON hỏng, hết quota,
 * provider ném - đều rơi về bảng mẫu, nên quyết định gameplay không đổi dù nhà
 * cung cấp có tồn tại hay không.
 *
 * Trả về cả `fromTemplate` để tầng đo biết bao nhiêu phần trăm lời thoại của
 * production đến từ đường lui. Không có con số đó thì một nhà cung cấp hỏng
 * lặng lẽ suốt một tuần trông y hệt một nhà cung cấp đang chạy tốt.
 */
export async function renderBotSpeech(
  request: SpeechRequest,
  brain: BotBrain = botBrain(),
  chatMaxLength = DEFAULT_CHAT_MAX,
  stats: SpeechStats = speechStats,
  now: () => number = Date.now,
): Promise<RenderedSpeech> {
  // Đo TRỌN lượt diễn đạt - cả hai lượt hỏi và cổng - vì đó là độ trễ mà
  // scheduler phải chờ trước khi phát. Ghi vào `stats` đúng một lần ở lối ra,
  // dù đi đường nào; `source` nói đường đó là đường nào.
  const startedAt = now();
  const rendered = await renderUnmeasured(request, brain, chatMaxLength);
  stats.record(rendered.source, now() - startedAt);
  return rendered;
}

async function renderUnmeasured(
  request: SpeechRequest,
  brain: BotBrain,
  chatMaxLength: number,
): Promise<RenderedSpeech> {
  // `try` chỉ bọc LỜI GỌI NHÀ CUNG CẤP, không bọc cổng chạy sau nó. Nhà cung
  // cấp hỏng (timeout, 429, JSON vỡ) là chuyện xảy ra hằng ngày và phải rơi êm
  // về bảng mẫu. Nhưng nếu `claimSurvivesRoundTrip`/`echoesRecentOwnLine` ném -
  // tức LỖI TRONG CHÍNH CỔNG, không phải trong nhà cung cấp - thì nuốt nó vào
  // cùng một catch sẽ khiến một cổng gãy trông y hệt một nhà cung cấp đang hỏng:
  // `fromTemplate` vẫn lên `true` như mọi khi, và một cổng gãy có thể chạy hàng
  // tuần không ai biết. Hai loại lỗi phải KHÔNG dùng chung một quan sát.
  const first = await askProvider(brain, request);
  if (first && passesGates(request, first)) {
    return { text: first.slice(0, chatMaxLength), fromTemplate: false, source: "provider" };
  }

  // Trượt cổng thì hỏi lại ĐÚNG MỘT lần, mang theo chính câu vừa bị từ chối.
  //
  // Chỉ khi nhà cung cấp đã trả về một câu THẬT mà cổng không nhận: nhại lại
  // chính mình, mở đầu như vài câu trước, hay nói sai lời khai. Nhà cung cấp
  // hỏng (timeout, hết quota, JSON vỡ) thì không hỏi lại - gọi thêm vào đúng
  // lúc nó đang hỏng chỉ đốt ngân sách. Lượt hỏi lại đi qua cùng `brain`, nên
  // governor đếm nó như mọi lượt khác; không có ngân sách riêng và
  // `BOT_AI_MAX_CALLS_PER_GAME` không đổi.
  //
  // Câu bị từ chối được gấp vào `recentOwnLines` và cách mở đầu của nó vào
  // `avoidOpenings`: prompt lần hai vì thế nói rõ "đừng nói câu này, đừng mở
  // đầu thế này", và cổng lần hai cũng so trên yêu cầu đã gấp - nhại lại chính
  // câu bị từ chối vẫn trượt.
  if (first) {
    const retryRequest = withRejectedLine(request, first);
    const second = await askProvider(brain, retryRequest);
    if (second && passesGates(retryRequest, second)) {
      return {
        text: second.slice(0, chatMaxLength),
        fromTemplate: false,
        source: "provider_retry",
      };
    }
  }

  // Đường lui cũng phải theo đúng luật vừa dùng để từ chối nhà cung cấp.
  //
  // `renderSpeechTemplate` quét cả bảng để né `avoidFingerprints`, nhưng khi cả
  // bảng đều đã nói gần đây thì nó CỐ TÌNH trả về một mẫu trùng - một lượt nói
  // trùng còn hơn một ngoại lệ chạy lên tầng scheduler. Và chuyện đó tới được
  // thật: bảng nhỏ nhất có 4 mẫu, mà `promptRecentOwnLines` cũng đúng bằng 4.
  //
  // Ở đây thì trùng là vô nghĩa: vừa từ chối câu của nhà cung cấp vì nó nhại
  // lại chính BOT, rồi tự nhại lại bằng đường khác. Im lặng mới là câu trả lời
  // đúng, và nó không tốn gì - scheduler không tính lượt cho một câu rỗng, nên
  // BOT giữ nguyên hạn mức và nói tiếp ở checkpoint sau.
  // Vì sao tới được đây: nhà cung cấp không trả câu nào, hay trả mà trượt cổng.
  // Hai chuyện phải sửa theo hai hướng khác nhau (hạ tầng / prompt), nên nhãn
  // phải khác nhau.
  const source = first ? "gate_rejected" : "provider_failed";
  const template = speechTemplate(request);
  if (template !== null && echoesRecentOwnLine(request, template)) {
    return { text: null, fromTemplate: true, source: "template_silent" };
  }
  return { text: template, fromTemplate: true, source };
}

/**
 * Một lượt hỏi nhà cung cấp; `null` cho mọi kiểu hỏng.
 *
 * `try` chỉ bọc LỜI GỌI NHÀ CUNG CẤP, không bọc cổng chạy sau nó - xem chú
 * thích ở `renderBotSpeech` về vì sao hai loại lỗi không được dùng chung một
 * quan sát.
 */
async function askProvider(brain: BotBrain, request: SpeechRequest): Promise<string | null> {
  try {
    const attempt = await brain.renderDaySpeech(request);
    return (attempt.ok ? attempt.value?.chat : null) || null;
  } catch {
    // Não ném lỗi ngoài dự kiến cũng chỉ là một lượt hỏng.
    return null;
  }
}

/** Yêu cầu mới cho lượt hỏi lại: câu bị từ chối vào cả hai danh sách "đừng". */
function withRejectedLine(request: SpeechRequest, rejected: string): SpeechRequest {
  const opening = openingOf(rejected);
  return {
    ...request,
    recentOwnLines: [...request.recentOwnLines, rejected],
    avoidOpenings:
      opening !== null && !request.avoidOpenings.includes(opening)
        ? [...request.avoidOpenings, opening]
        : request.avoidOpenings,
  };
}

/**
 * Ba cổng mà một câu của nhà cung cấp phải qua, theo thứ tự rẻ trước đắt sau:
 * không nhại lại chính mình, không mở đầu như vài câu vừa rồi, và nói đúng lời
 * khai đã chốt (hoặc không khai gì nếu lõi không khai).
 */
function passesGates(request: SpeechRequest, chat: string): boolean {
  return (
    !echoesRecentOwnLine(request, chat) &&
    !repeatsRecentOpening(request, chat) &&
    claimSurvivesRoundTrip(request, chat)
  );
}

/**
 * Câu này có mở đầu y hệt một trong vài câu vừa rồi của chính BOT không?
 *
 * `avoidOpenings` là ba token mở đầu (sau khi bỏ từ đệm) của năm lượt gần nhất,
 * do lõi ghi vào `BotSpeechRecord.opening` bằng đúng `openingOf`. Danh sách đó
 * đi vào prompt kèm lời dặn "đừng mở đầu giống những lần trước" - nhưng cũng
 * như `recentOwnLines`, lời dặn chỉ là đề nghị, và "mọi câu đều bắt đầu bằng
 * tôi nghi" là triệu chứng dễ nhận nhất của một bot. Bảng mẫu đã né bằng
 * `avoidOpenings`; nhà cung cấp phải chịu cùng một luật.
 *
 * Đệm "ủa"/"hmm" rồi mở đầu y hệt vẫn là trùng: `openingOf` bỏ từ đệm đầu câu.
 */
function repeatsRecentOpening(request: SpeechRequest, chat: string): boolean {
  if (request.avoidOpenings.length === 0) return false;
  const opening = openingOf(chat);
  return opening !== null && request.avoidOpenings.includes(opening);
}

/**
 * Câu này có phải là một câu BOT vừa nói không?
 *
 * `recentOwnLines` đi vào prompt kèm lời dặn "đừng diễn đạt lại", và bảng mẫu
 * thì bị chặn CỨNG bằng `avoidFingerprints`. Nhưng lời dặn trong prompt chỉ là
 * một đề nghị: một mô hình nhỏ, một lượt hỏng, một prompt bị cắt là đủ để nó
 * trả về nguyên văn câu cũ - và câu đó đi thẳng ra phòng, vì đường của nhà cung
 * cấp không có ai gác. Nói cách khác, chỗ dễ sai nhất lại là chỗ duy nhất không
 * bị kiểm.
 *
 * So bằng đúng vân tay mà bảng mẫu dùng, nên hai đường có cùng một định nghĩa
 * "trùng câu": khác mỗi dấu câu, chữ hoa hay từ đệm đầu câu vẫn là trùng.
 *
 * Trùng thì rơi về bảng mẫu chứ không hỏi lại. Hỏi lại tốn thêm một vòng mạng
 * ngay giữa pha thảo luận, mà bảng mẫu vốn đã tránh sẵn những câu này.
 *
 * Dùng cho CẢ HAI đường ra: câu của nhà cung cấp, và câu của bảng mẫu. Một luật
 * chống lặp chỉ gác một nửa số lối ra thì không phải là một luật.
 */
function echoesRecentOwnLine(request: SpeechRequest, chat: string): boolean {
  if (request.recentOwnLines.length === 0) return false;
  const fingerprint = speechTextFingerprint(chat);
  return request.recentOwnLines.some(
    (line) => speechTextFingerprint(line) === fingerprint,
  );
}

/**
 * Câu này có nói ĐÚNG lời khai mà lõi đã chốt không — và CHỈ đúng lời khai đó,
 * không hơn không kém?
 *
 * So BA lớp theo thứ tự, và trượt lớp nào thì hỏng luôn, không xét tiếp:
 *
 * 1. LOẠI. `analyzeChat` không biết ý định đang là gì — nó chỉ đọc chữ.
 *    `parseCounterClaim` so trên CẢ câu, chạy TRƯỚC mọi phân tích theo mệnh
 *    đề, và không quan tâm câu đó sinh ra từ ý định nào (`chat-analysis.ts`,
 *    hàm `analyzeChat`). Nghĩa là một câu cho ý định `CLAIM_ROLE` vẫn có thể
 *    đọc ra một `COUNTER_CLAIM` nếu nó tình cờ khớp mẫu "X không thể là Y,
 *    tôi mới là Y" — mang theo một mục tiêu lõi chưa từng chốt. Và một câu
 *    cho ý định `COUNTER_CLAIM` vẫn có thể đọc ra một `ROLE_CLAIM` trần, làm
 *    mất hẳn phần "ai bị phản bác" mà lõi đã quyết. Vì vậy loại memory đọc
 *    được phải khớp ĐÚNG loại ý định — `CLAIM_ROLE` đòi `ROLE_CLAIM`,
 *    `COUNTER_CLAIM` đòi `COUNTER_CLAIM` — trước khi so bất cứ trường nào bên
 *    trong nó. So field mà bỏ qua loại là so nhầm chỗ: vai có thể khớp trong
 *    khi cả CÂU vẫn là một phát ngôn khác hẳn cái lõi đã chốt.
 *
 *    Lớp này KHÔNG chịu tải như nhau ở hai chiều. Chiều `CLAIM_ROLE` → chữ đọc
 *    ra `COUNTER_CLAIM`: đây là lớp DUY NHẤT chặn được, vì vai vẫn có thể
 *    trùng - bỏ lớp này thì câu lọt. Chiều `COUNTER_CLAIM` → chữ đọc ra
 *    `ROLE_CLAIM` trần: lớp 3 (mục tiêu) đã tự chặn trước, vì một khai trần
 *    không bao giờ mang `targetId` để khớp - lớp này ở chiều đó chỉ là phòng
 *    thủ thêm, phòng khi hình dạng `ROLE_CLAIM` mà parser trả về đổi khác đi
 *    trong tương lai. Không xoá lớp này chỉ vì một chiều "có vẻ" thừa.
 * 2. VAI. `data.role` phải đúng `claimedRole` mà lõi đã chốt.
 * 3. MỤC TIÊU (chỉ `COUNTER_CLAIM`). Lõi chốt cả người bị phản bác
 *    (`intention.targetId`, từ `claim.counterTargetId` — `speech-planner.ts`),
 *    không chỉ vai. Bỏ qua lớp này thì cổng vẫn lọt một câu đổi được TÊN
 *    NGƯỜI BỊ TỐ dù loại và vai đều khớp.
 *
 * Vì sao cả ba lớp đều bắt buộc — hỏng theo hai chiều:
 *
 * 1. Ý định có khai mà chữ không khai đúng thứ (sai loại, sai vai, hoặc
 *    không khai gì) → lời khai bốc hơi trong im lặng. Người chơi đọc chat vẫn
 *    thấy BOT nói; các BOT khác thì không thấy gì, vì cái chúng đọc là
 *    `chat-analysis` chứ không phải ý định.
 * 2. Chữ khai ra một thứ mà ý định không hề khai — dù đúng vai, đúng người,
 *    chỉ khác loại — → nhà cung cấp vừa tự đi một nước cờ. Nó đặt cả bàn vào
 *    một lời khai hoặc một cáo buộc mà lõi chưa bao giờ quyết, không seed nào
 *    dựng lại được, và cả `ROLE_CLAIM` lẫn `COUNTER_CLAIM` đều được GHIM vĩnh
 *    viễn vào state.
 *
 * Chiều thứ hai là chiều nguy hiểm hơn, và nó đã mở sẵn từ trước Phase 5.
 *
 * Dùng chính `analyzeChat` chứ không so chuỗi: cổng phải hỏi đúng câu hỏi mà
 * các BOT khác sẽ hỏi. Một cổng có luật riêng sẽ trôi lệch khỏi parser, và nó
 * sẽ trôi lệch âm thầm.
 */
function claimSurvivesRoundTrip(request: SpeechRequest, chat: string): boolean {
  const { intention } = request;
  const intended =
    intention.kind === "CLAIM_ROLE" || intention.kind === "COUNTER_CLAIM"
      ? (intention.claimedRole ?? null)
      : null;

  const memories = analyzeChat(
    [{ id: "probe", actorId: request.speaker.id, text: chat, at: 0 }],
    request.players,
  );
  const spoken = memories.find(
    (memory) => memory.type === "ROLE_CLAIM" || memory.type === "COUNTER_CLAIM",
  );

  if (intended === null) return spoken === undefined;
  if (spoken === undefined) return false;

  // Lớp 1: loại memory phải khớp ĐÚNG loại ý định. `parseCounterClaim` không
  // quan tâm ý định gọi nó là gì, nên "đúng vai" không đủ để suy ra "đúng câu".
  const expectedType = intention.kind === "COUNTER_CLAIM" ? "COUNTER_CLAIM" : "ROLE_CLAIM";
  if (spoken.type !== expectedType) return false;

  // Lớp 2: vai.
  if (spoken.data.role !== intended) return false;

  // Lớp 3: chỉ COUNTER_CLAIM mới có mục tiêu để so.
  return intention.kind === "COUNTER_CLAIM" ? spoken.targetId === intention.targetId : true;
}
