import {
  analyzeChat,
  openingOf,
  renderSpeechTemplate,
  speechShapeFingerprint,
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

/**
 * Khung câu mà cả phòng vừa dùng, đọc từ `chatWindow`.
 *
 * `chatWindow` đã là cửa sổ chat ĐÃ LỌC theo tầm nhìn của chính BOT này và đã
 * đi thẳng vào prompt, nên đọc lại nó ở đây không mở thêm đường nhìn nào. Nó
 * cũng chứa câu của NGƯỜI THẬT, và né phrasing của người thật là đúng ý.
 *
 * Xoá tên bằng danh sách ĐẦY ĐỦ của phòng (`request.players`), còn
 * `renderSpeechTemplate` xoá bằng đúng hai cái tên câu của nó có thể chứa. Hai
 * bên vẫn ra cùng một khung - xem chú thích `ownNames` trong `templates.ts`.
 */
function roomShapes(request: SpeechRequest): string[] {
  const names = request.players.map((player) => player.name);
  return request.chatWindow.map((line) => speechShapeFingerprint(line.text, names));
}

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
    // Khung câu CẢ PHÒNG vừa dùng. Nguồn là `chatWindow` - cửa sổ chat đã lọc
    // theo tầm nhìn, thứ vốn đã đi vào prompt - nên không có dữ liệu mới nào
    // được đưa vào tầng này, và không có gì để rò rỉ.
    avoidShapes: roomShapes(request),
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

  // HAI đường dẫn tới im lặng, và cả hai đều là `template_silent`.
  //
  // `null` là bảng mẫu TỪ CHỐI dựng câu: một ý định thuộc `NEEDS_SOMEONE` mà
  // không có ai để nói tới (xem `speechTemplate`). Trước đây nhánh đó rơi xuống
  // dòng cuối và trả về `text: null` mang nhãn `provider_failed`/`gate_rejected`
  // - tức một lượt IM bị đếm y như một lượt CÓ phát câu mẫu. `template_silent`
  // vì thế đếm thiếu, và `bySource` trên `/api/health` nói sai về chuyện bot có
  // mở miệng hay không - đúng thứ mà `speech-stats` tồn tại để trả lời.
  //
  // Hai nguyên nhân KHÁC nhau (không có mục tiêu / cả bảng đều vừa nói) nhưng
  // dùng CHUNG một nhãn, và đó là chủ ý: nhãn này trả lời "bot có nói không",
  // còn nhánh `null` thì theo chú thích của `speechTemplate` là phòng thủ cho
  // một tình huống lõi không được phép tạo ra. Nó nổ lên khác 0 nghĩa là có lỗi
  // ở LÕI, và chỗ để nhìn thấy điều đó là con số này khác 0 - không phải một
  // nhãn thứ sáu cho một nhánh lẽ ra không bao giờ chạy.
  if (template === null || echoesRecentOwnLine(request, template)) {
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
 * Bốn cổng mà một câu của nhà cung cấp phải qua, theo thứ tự rẻ trước đắt sau:
 * không nhại lại chính mình, không mở đầu như vài câu vừa rồi, nói đúng lời
 * khai đã chốt (hoặc không khai gì nếu lõi không khai), và không tố/bênh một
 * người mà lõi chưa từng chốt.
 */
function passesGates(request: SpeechRequest, chat: string): boolean {
  return (
    !echoesRecentOwnLine(request, chat) &&
    !repeatsRecentOpening(request, chat) &&
    claimSurvivesRoundTrip(request, chat) &&
    targetSurvivesRoundTrip(request, chat)
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
 * Câu này có tố / bênh ĐÚNG người mà lõi đã chốt không (COMMUNICATION §23)?
 *
 * Lỗ hổng mà cổng này bịt, và là lỗ hổng DUY NHẤT trong danh sách §23 mà ba cổng
 * kia không chạm tới: **lệch mục tiêu**. Lõi chốt "tố Chi", mô hình viết "tôi
 * nghi Bình". Không cổng nào cũ bắt được - không phải lời khai, không nhại câu
 * cũ, không trùng cách mở đầu - nên câu đó đi thẳng ra phòng, và mọi BOT khác
 * `analyzeChat` nó thành một cáo buộc nhắm vào một người mà lõi CHƯA BAO GIỜ
 * chọn. Belief của cả bàn dịch theo một nước đi không seed nào dựng lại được.
 *
 * Đó đúng là điều §20 cấm ("Do not change selected intent") và §33 gọi tên
 * ("do NOT ask LLM to choose votes") - chỉ khác là nó lọt qua đường LỜI NÓI
 * thay vì đường hành động.
 *
 * Luật: mọi `ACCUSE`/`DEFEND` mà câu chữ đọc ra phải trỏ ĐÚNG `intention.targetId`.
 * Ý định không nhắm ai (`HUMOR`, `REACTION`, `WITHHOLD`, một lời khai trần) thì
 * không được đọc ra cáo buộc nào cả.
 *
 * Chỉ xét memory mà câu THẬT SỰ sinh ra: một câu không tố ai vẫn hợp lệ. Cổng
 * này nói "đừng tố nhầm người", không nói "phải tố".
 *
 * Như ba cổng kia, nó chỉ gác đường NHÀ CUNG CẤP. Bảng mẫu có luật riêng của
 * nó (`avoidFingerprints`, và một test quét toàn bảng), và cho bảng mẫu đi qua
 * đây thì một lần trượt sẽ không còn đường lui nào.
 */
function targetSurvivesRoundTrip(request: SpeechRequest, chat: string): boolean {
  const approved = request.intention.targetId ?? null;

  const memories = analyzeChat(
    [{ id: "probe", actorId: request.speaker.id, text: chat, at: 0 }],
    request.players,
  );

  return memories
    .filter((memory) => memory.type === "ACCUSE" || memory.type === "DEFEND")
    .every((memory) => memory.targetId === approved);
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
