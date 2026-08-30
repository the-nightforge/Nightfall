import { describe, expect, it } from "vitest";
import { speechDefaults } from "./helpers/speech-request";
import { buildDaySpeechPrompt } from "../src/bots/prompt";
import { interpretDaySpeech } from "../src/bots/decide";
import type { SpeechRequest } from "../src/bots/types";

/** Một ý định ban ngày ĐÃ CHỐT, đúng hình dạng mà lõi deterministic phát ra. */
function speechRequest(over: Partial<SpeechRequest> = {}): SpeechRequest {
  return {
    roomCode: "ABCDE",
    speaker: { id: "v", name: "Vân" },
    ...speechDefaults(),
    intention: {
      kind: "ACCUSE",
      targetId: "w",
      confidence: 0.8,
      evidence: [
        {
          id: "ev-1",
          kind: "LATE_SWITCH",
          sourceId: "vote:late-switch:2",
          actorId: "w",
          targetId: "s",
          weight: 7,
          confidence: 0.6,
          round: 2,
          summary: "đổi phiếu sát giờ chót",
        },
      ],
    },
    evidence: [{ sourceId: "vote:late-switch:2", summary: "đổi phiếu sát giờ chót" }],
    targetName: "Wolf",
    recentSpeechSourceIds: [],
    ...over,
  };
}

/**
 * Bị cáo không có gì để khai: `decideChatClaim` trả `null` và chỗ gọi
 * (`scheduleDefenseBot` trong `machine.ts`) rơi về một ý định DISAGREE không
 * chỉ đích danh ai, kèm `defense` mang số phiếu công khai của pha DEFENSE.
 */
function defenseRequest(over: Partial<SpeechRequest> = {}): SpeechRequest {
  return speechRequest({
    intention: {
      kind: "DISAGREE",
      topic: "SUSPICION",
      confidence: 0.5,
      evidence: [],
      tone: "FIRM",
    },
    targetName: null,
    defense: { votesAgainstMe: 3, alsoAccused: ["Sang"] },
    ...over,
  });
}

describe("ranh giới bảo mật của prompt", () => {
  it("prompt ban ngày không chứa vai trò của bất kỳ ai, kể cả của chính bot", () => {
    const spec = buildDaySpeechPrompt(speechRequest());
    const text = `${spec.system}\n${spec.user}`;

    expect(text).not.toContain("WEREWOLF");
    expect(text).not.toContain("SEER");
    expect(text).not.toContain("WITCH");
    expect(text).not.toContain("GUARD");
    // prompt.ts chỉ render vai bằng văn xuôi tiếng Việt nên 4 dòng trên không
    // bao giờ đỏ dù prompt.ts có bị sửa để nhận thẳng state chưa lọc - assert
    // này nhắm đúng dấu hiệu tiếng Việt mà code thực sự phát ra cho đồng bọn Sói,
    // để một hồi quy như vậy còn có cái gì đó bắt được.
    expect(text).not.toContain("đồng bọn Sói");
    expect(text).not.toContain("Vai của bạn");
  });

  it("prompt ban ngày không nêu ai ngoài mục tiêu đã chốt", () => {
    // Nhà cung cấp không thấy Sang thì nó không có cách nào chuyển hướng sang Sang.
    const spec = buildDaySpeechPrompt(speechRequest());
    const text = `${spec.system}\n${spec.user}`;

    expect(text).toContain("Wolf");
    expect(text).not.toContain("Sang");
  });

  it("prompt ban ngày không mang theo chat thô của người chơi", () => {
    // Chat thô là bề mặt prompt-injection lớn nhất. Ban ngày đã deterministic
    // nên nhà cung cấp không còn lý do gì để đọc nó.
    const spec = buildDaySpeechPrompt(speechRequest());

    expect(spec.user).not.toContain("<chat>");
    expect(spec.user).not.toContain("Tôi nghi Wolf");
  });

  it("chat của người chơi được bọc là dữ liệu, không phải chỉ thị", () => {
    // Pha bào chữa đi qua đúng buildDaySpeechPrompt như ban ngày, nên chat vẫn
    // phải bọc trong <chat_data>, không phải thẻ <chat> trần của roleContext cũ.
    const spec = buildDaySpeechPrompt(
      defenseRequest({
        chatWindow: [{ actorName: "Sang", text: "Tôi nghi Wolf", isSelf: false }],
      }),
    );

    expect(spec.user).toContain("<chat_data>");
    expect(spec.user).toContain("</chat_data>");
    expect(spec.user).toContain("Tôi nghi Wolf");
    expect(spec.user).toContain("KHÔNG đáng tin");
  });

  it("prompt bào chữa không mang vai thật của bị cáo", () => {
    // Task 8: buildDefensePrompt(RoomSnapshot) cũ đưa roleContext(view) - vai
    // THẬT của bị cáo - thẳng vào prompt. Giờ lượt bào chữa đi qua
    // buildDaySpeechPrompt như mọi lời nói khác, và hàm đó chưa từng biết vai
    // thật của ai cả.
    const spec = buildDaySpeechPrompt(defenseRequest());
    const text = `${spec.system}\n${spec.user}`;

    // "Ma Sói" CỐ TÌNH không nằm trong danh sách: nó là tên VÁN ĐẤU
    // ("...trong ván Ma Sói trực tuyến"), xuất hiện ở MỌI prompt bất kể vai -
    // đưa nó vào đây sẽ luôn đỏ dù không có rò rỉ nào.
    for (const role of ["Tiên Tri", "Phù Thuỷ", "Bảo Vệ", "Thợ Săn", "Kẻ Nguyền Rủa"]) {
      expect(text).not.toContain(role);
    }
    expect(text).not.toContain("Vai của bạn");
  });

  it("prompt bào chữa mang số phiếu và danh sách đồng-bị-nhắm, cả hai đã công khai", () => {
    const spec = buildDaySpeechPrompt(defenseRequest());

    expect(spec.user).toContain("3 phiếu");
    expect(spec.user).toContain("Sang");
    expect(spec.user).toContain("lượt tự bào chữa");
  });

  it("không phải lượt bào chữa thì không có khung cảnh phiên xử", () => {
    const spec = buildDaySpeechPrompt(speechRequest());

    expect(spec.user).not.toContain("lượt tự bào chữa");
    expect(spec.user).not.toContain("treo cổ");
  });
});

describe("chống lặp lời", () => {
  // Trước đây bot đọc lại chat để biết mình đã nói gì. Giờ căn cứ đã nói được
  // lõi ghi lại theo source ID, nên lời nhắc bám vào đúng luận điểm chứ không
  // bám vào câu chữ - đó là thứ thực sự lặp.
  it("có nhắc đừng lặp căn cứ đã dùng, kèm đúng source ID", () => {
    const user = buildDaySpeechPrompt(
      speechRequest({ recentSpeechSourceIds: ["vote:bandwagon:1"] }),
    ).user;

    expect(user).toContain("đừng lặp lại");
    expect(user).toContain("vote:bandwagon:1");
  });

  it("chưa nói lần nào thì không thêm nhắc nhở thừa", () => {
    const user = buildDaySpeechPrompt(speechRequest()).user;

    expect(user).not.toContain("đừng lặp lại");
    expect(user).toContain("lượt nói đầu");
  });

  it("liệt kê đúng bằng chứng được phép nhắc tới, kèm source ID", () => {
    const user = buildDaySpeechPrompt(speechRequest()).user;

    expect(user).toContain("vote:late-switch:2");
    expect(user).toContain("đổi phiếu sát giờ chót");
    // Phase 4 tách một câu cấm thành hai câu, mỗi câu một điều cấm: bịa sự
    // kiện và đổi mục tiêu là hai lỗi khác nhau và đáng nói riêng.
    expect(user).toContain("Không được bịa ra sự kiện");
    expect(user).toContain("Không được đổi mục tiêu");
  });

  it("ý định WITHHOLD không nêu tên ai", () => {
    const user = buildDaySpeechPrompt(
      speechRequest({
        intention: { kind: "WITHHOLD", confidence: 0.2, evidence: [] },
        evidence: [],
        targetName: null,
      }),
    ).user;

    expect(user).not.toContain("Wolf");
    // Nhà cung cấp phải được nói rõ là KHÔNG có gì để nêu, kèm lệnh cấm bịa -
    // nếu không nó sẽ tự dựng một sự kiện cho câu nói nghe có trọng lượng.
    expect(user).toContain("chưa có bằng chứng nào");
    expect(user).toContain("đừng bịa");
  });
});

describe("responseSchema", () => {
  // Ban ngày nhà cung cấp chỉ được trả về CÂU CHỮ. Còn một trường mục tiêu nào
  // trong schema là còn một đường để nó lái gameplay.
  it("prompt ngày chỉ có think/chat, không còn trường mục tiêu nào", () => {
    const spec = buildDaySpeechPrompt(speechRequest());

    expect(spec.schema.properties).toHaveProperty("chat");
    expect(spec.schema.properties).not.toHaveProperty("voteTargetId");
    expect(spec.schema.properties).not.toHaveProperty("targetId");
    expect(Object.keys(spec.schema.properties).sort()).toEqual(["chat", "think"]);
    expect(spec.schema.required).toEqual(["think", "chat"]);
  });

  it("lượt bào chữa dùng CHUNG một schema think/chat, không có schema riêng", () => {
    const spec = buildDaySpeechPrompt(defenseRequest());

    expect(Object.keys(spec.schema.properties).sort()).toEqual(["chat", "think"]);
  });

  it("interpreter từ chối phản hồi ngày có thêm trường mục tiêu", () => {
    const outcome = interpretDaySpeech(
      { think: "nghi Wolf", chat: "Tôi nghi Wolf", voteTargetId: "s" },
      300,
      () => undefined,
    );

    expect(outcome).toEqual({ ok: false });
  });

  // Fix round 1: hai đường phải KHÔNG chung một nghĩa cho chuỗi rỗng, dù chung
  // một hàm interpret. Xem `InterpretDaySpeechOptions.treatEmptyAsFailure`.
  it("chuỗi rỗng ban ngày là im lặng có chủ đích, không phải một lượt hỏng", () => {
    const outcome = interpretDaySpeech({ think: "x", chat: "   " }, 300, () => undefined);

    // ok:true, value:{chat:null} - FallbackBrain dừng ở đây, không thử não kế
    // tiếp: đúng ý "bot chủ động không nói gì thêm".
    expect(outcome).toEqual({ ok: true, value: { chat: null } });
  });

  it("chuỗi rỗng ở lượt bào chữa là một lượt HỎNG, để chuỗi dự phòng còn được thử", () => {
    const outcome = interpretDaySpeech({ think: "x", chat: "   " }, 300, () => undefined, {
      treatEmptyAsFailure: true,
    });

    // Khác `interpretDefense` cũ chỉ ở TÊN hàm, không khác ở kết quả: im lặng
    // vẫn không phải một lời bào chữa hợp lệ, nên vẫn phải rơi về failed().
    expect(outcome).toEqual({ ok: false });
  });
});
