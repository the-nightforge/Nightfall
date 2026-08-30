import { analyzeChat, renderSpeechTemplate, speechTextFingerprint } from "@masoi/game-engine";
import { botBrain } from "./index";
import { DEFAULT_CHAT_MAX } from "./decide";
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
  if (
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
): Promise<RenderedSpeech> {
  // `try` chỉ bọc LỜI GỌI NHÀ CUNG CẤP, không bọc cổng chạy sau nó. Nhà cung
  // cấp hỏng (timeout, 429, JSON vỡ) là chuyện xảy ra hằng ngày và phải rơi êm
  // về bảng mẫu. Nhưng nếu `claimSurvivesRoundTrip`/`echoesRecentOwnLine` ném -
  // tức LỖI TRONG CHÍNH CỔNG, không phải trong nhà cung cấp - thì nuốt nó vào
  // cùng một catch sẽ khiến một cổng gãy trông y hệt một nhà cung cấp đang hỏng:
  // `fromTemplate` vẫn lên `true` như mọi khi, và một cổng gãy có thể chạy hàng
  // tuần không ai biết. Hai loại lỗi phải KHÔNG dùng chung một quan sát.
  let chat: string | null | undefined;
  try {
    const attempt = await brain.renderDaySpeech(request);
    chat = attempt.ok ? attempt.value?.chat : null;
  } catch {
    // Não ném lỗi ngoài dự kiến cũng chỉ là một lượt hỏng.
    chat = null;
  }

  if (chat && !echoesRecentOwnLine(request, chat) && claimSurvivesRoundTrip(request, chat)) {
    return { text: chat.slice(0, chatMaxLength), fromTemplate: false };
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
  const template = speechTemplate(request);
  if (template !== null && echoesRecentOwnLine(request, template)) {
    return { text: null, fromTemplate: true };
  }
  return { text: template, fromTemplate: true };
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
 * Câu này có nói ĐÚNG lời khai mà lõi đã chốt không — và chỉ đúng lời khai đó?
 *
 * Gác HAI CHIỀU, vì hỏng theo hai chiều:
 *
 * 1. Ý định có khai mà chữ không khai → lời khai bốc hơi trong im lặng. Người
 *    chơi đọc chat vẫn thấy BOT nói; các BOT khác thì không thấy gì, vì cái
 *    chúng đọc là `chat-analysis` chứ không phải ý định.
 * 2. Ý định không khai mà chữ có khai → nhà cung cấp vừa tự đi một nước cờ.
 *    Nó đặt cả bàn vào một lời khai mà lõi chưa bao giờ quyết, không seed nào
 *    dựng lại được, và `ROLE_CLAIM` thì được GHIM vĩnh viễn vào state.
 *
 * Chiều thứ hai là chiều nguy hiểm hơn, và nó đã mở sẵn từ trước Phase 5.
 *
 * Dùng chính `analyzeChat` chứ không so chuỗi: cổng phải hỏi đúng câu hỏi mà
 * các BOT khác sẽ hỏi. Một cổng có luật riêng sẽ trôi lệch khỏi parser, và nó
 * sẽ trôi lệch âm thầm.
 *
 * `COUNTER_CLAIM` mang HAI thứ do lõi chốt, không phải một: vai tự nhận VÀ
 * người bị phản bác (`intention.targetId`, từ `claim.counterTargetId` -
 * `speech-planner.ts`). So mỗi vai mà bỏ qua mục tiêu thì cổng vẫn lọt một câu
 * đổi được TÊN NGƯỜI BỊ TỐ trong khi vai vẫn khớp - "Chi không thể là sói, tôi
 * mới là tiên tri" lọt qua khi lõi đã chốt mục tiêu là Bình. Đó là một cáo buộc
 * công khai mà lõi chưa bao giờ quyết, ghim vĩnh viễn vào mọi BOT đang nghe -
 * đúng lỗ mà cổng này tồn tại để chặn, chỉ là lệch sang trường target thay vì
 * trường role. `CLAIM_ROLE` (khai trần, không phản bác ai) thì không có mục
 * tiêu để so: `parseClause` không gắn `targetId` cho nó, và mệnh đề tố cáo có
 * thể đi kèm - nếu có - là một memory `ACCUSE` riêng, ngoài phạm vi cổng này.
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
  if (spoken === undefined || spoken.data.role !== intended) return false;

  return intention.kind === "COUNTER_CLAIM" ? spoken.targetId === intention.targetId : true;
}
