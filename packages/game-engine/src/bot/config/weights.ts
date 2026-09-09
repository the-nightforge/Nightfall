import type { PublicEvidenceKind } from "../types";

/**
 * Toàn bộ hằng số điều chỉnh của lõi BOT, ở đúng một chỗ.
 *
 * Trước Phase 3, ~70 con số này nằm rải rác trong 20 file, với ba bảng weight
 * song song không đồng bộ và ít nhất sáu magic number bị nhân bản. Hệ quả không
 * phải là code xấu - nó là việc **không cân bằng được**: muốn hạ win-rate của
 * Sói xuống 5% thì không ai trả lời được là sửa số nào, ở file nào, và sửa xong
 * có làm hỏng vai khác không.
 *
 * Ba quy tắc của module này:
 *
 * 1. **Đọc-chỉ và được inject.** Không singleton ghi được. Một biến module có
 *    thể ghi sẽ biến hai ván chạy song song trong cùng process thành một nguồn
 *    không tất định, và đó đúng là thứ Phase 1 đã bỏ công gỡ bỏ.
 * 2. **Không import gì ngoài `types.ts`.** Đây là lá của đồ thị phụ thuộc, nên
 *    mọi module quyết định đều nhận được nó mà không tạo vòng.
 * 3. **Đổi một giá trị là đổi `version`.** Một con số win-rate không truy được
 *    về cấu hình sinh ra nó là một con số vô dụng.
 */

export interface EvidenceWeight {
  /** Điểm suspicion cộng vào trước khi nhân confidence và inertia. */
  readonly weight: number;
  /** `0..1`. Vừa nhân vào delta, vừa là đầu vào của bonus tin cậy khi chấm phiếu. */
  readonly confidence: number;
}

/**
 * Sức nặng của bằng chứng công khai.
 *
 * Đây là bảng DUY NHẤT; `chat-analysis` và `BotRuntime` trước đây giữ bản sao
 * riêng của cùng những con số này, và ba bản sao đã trôi lệch khỏi nhau.
 */
export type EvidenceWeightTable = Readonly<Record<PublicEvidenceKind, EvidenceWeight>>;

/**
 * Đóng băng cả bảng lẫn từng ô.
 *
 * `Object.freeze` là NÔNG. Mọi nhóm khác trong `BotWeights` đều phẳng nên một
 * lần freeze là đủ, `evidence` là ngoại lệ duy nhất: freeze bảng chỉ chặn việc
 * thay cả ô, không chặn `table.ACCUSE.weight = 999`. Không có hàm này thì một
 * dòng ở bất kỳ đâu trong process cũng làm hỏng vĩnh viễn `DEFAULT_BOT_WEIGHTS`
 * - đúng kiểu hỏng mà quy tắc 1 ở đầu file tuyên bố đã loại trừ.
 */
function freezeEvidenceTable(table: Record<PublicEvidenceKind, EvidenceWeight>): EvidenceWeightTable {
  for (const entry of Object.values(table)) Object.freeze(entry);
  return Object.freeze(table);
}

/** Độ quan trọng của memory. Quyết định cái gì bị quên trước khi cắt ngân sách. */
export interface MemoryImportanceWeights {
  roleClaim: number;
  counterClaim: number;
  accuse: number;
  defend: number;
  /** Dùng cho memory chat không khớp loại nào ở trên. */
  fallback: number;
  playerDied: number;
  seerResult: number;
  allyLost: number;
  roundSummary: number;
  voteCast: number;
  voteChanged: number;
  lateVote: number;
  nominated: number;
  finalJudgment: number;
  /**
   * Thấp có chủ đích.
   *
   * Một lời gọi tên hay một câu hỏi không phải bằng chứng về vai của ai; nó chỉ
   * cần sống đủ lâu để BOT kịp trả lời. Đặt ngang `ACCUSE` sẽ khiến chúng chiếm
   * chỗ của những quan sát thật sự có nội dung khi ngân sách memory bị cắt.
   */
  directAddress: number;
  directQuestion: number;
  /** Ghi nhận né tránh nhiều vòng; ngang `accuse` vì nó cũng là một nhận xét về người. */
  avoidance: number;
  /** Lời bào chữa bị chấm kém; nặng hơn `accuse` một chút vì hiếm và đáng nhớ. */
  defenseQuality: number;
}

/**
 * Thông tin riêng của vai.
 *
 * Dấu ÂM ở `seerClear` và `knownAlly` là bắt buộc, không phải quy ước tuỳ ý:
 * `applyTrustEvidence` đảo dấu weight trước khi cộng, nên một bằng chứng gỡ tội
 * phải mang weight âm thì mới làm TĂNG tin tưởng.
 */
export interface PrivateInfoWeights {
  seerWolf: number;
  seerClear: number;
  /**
   * Soi ra một mục tiêu thuộc phe TRUNG LẬP.
   *
   * Nhẹ hơn `seerClear` một cách có chủ đích, và không phải vì kết quả kém chắc
   * chắn - nó chắc chắn y hệt. Nó nói ÍT hơn: "không phải Sói" chứ không phải
   * "người của làng". Ghim tin tưởng lên trần cho một kẻ trung lập là đem uy
   * tín của Tiên Tri ra bảo lãnh cho một người không chơi cho làng.
   */
  neutralClear: number;
  /**
   * Điểm tin tưởng mà một kết quả soi TRUNG LẬP ghim vào.
   *
   * Phải là một giá trị TUYỆT ĐỐI chứ không phải một mức cộng thêm, và đó là
   * điều kiện để nó idempotent: `observe()` chạy nhiều lần mỗi vòng, nên một
   * số hạng cộng dồn sẽ khiến niềm tin phụ thuộc vào việc scheduler gọi mấy
   * lần - một biến số không liên quan gì tới ván đấu, và đủ để phá tính tái lập
   * theo seed. Hai kết quả soi kia đã ghim ở `MAX_BELIEF_SCORE` vì đúng lý do
   * đó; nhánh trung lập cần một mốc riêng chỉ vì nó KHÔNG được lên tới trần.
   *
   * 30 trên thang 100: đủ để BOT thôi nghi và không phí một ngày treo nhầm,
   * không đủ để nó đứng ra bảo lãnh cho một kẻ không chơi cho làng.
   */
  neutralClearTrust: number;
  /**
   * Nghi ngờ ghim vào một mục tiêu soi ra TRUNG LẬP, khi bộ bài của ván CÓ Sát
   * Nhân.
   *
   * Cùng một kết quả soi, hai kết luận trái ngược - và đó là đúng, vì câu hỏi
   * đã đổi. Trong một ván chỉ có Thằng Hề, "trung lập" nghĩa là "vô hại với
   * làng, đừng phí một ngày treo nó". Trong một ván có Sát Nhân, đúng cái nhãn
   * ấy là ứng viên số một cho kẻ đang giết người mỗi đêm - và một Tiên Tri đọc
   * ra "trung lập" rồi tuyên bố người đó an toàn là đang bảo lãnh cho hung thủ.
   *
   * Vì thế nhánh này KHÔNG cộng tin tưởng: nó ghim tin tưởng về 0 và ghim nghi
   * ngờ lên mốc này. Giá trị TUYỆT ĐỐI chứ không phải mức cộng thêm, cùng lý do
   * idempotent với `neutralClearTrust`.
   *
   * 55 trên thang 100: trên hẳn ngưỡng đề cử (`aggression.thresholdBase` sau
   * hiệu chỉnh v2 nằm quanh 6 trên thang belief THẬT, và một điểm ghim ở đây
   * vượt xa nó), nhưng vẫn dưới `MAX_BELIEF_SCORE` - một kết quả trung lập nói
   * "có thể là hung thủ", không nói "chính là hung thủ". Đúng một trong hai vai
   * trung lập giết người, và Tiên Tri không phân biệt được hai vai đó.
   */
  neutralKillerSuspicion: number;
  knownAlly: number;
  /** Xem chú thích ở `DEFAULT_BOT_WEIGHTS.privateInfo.provenFalseClaim`. */
  provenFalseClaim: number;
}

/**
 * Hành vi của BOT Thằng Hề.
 *
 * Tách thành nhóm riêng chứ không nhét vào `deceptionRisk`: nhóm kia mô tả
 * NGUY CƠ BỊ LỘ của một con Sói đang giấu mình, còn nhóm này mô tả một mục tiêu
 * ngược hẳn - cố tình bị lộ. Trộn chúng lại sẽ khiến việc hiệu chỉnh phe Sói
 * lặng lẽ kéo theo hành vi của Hề.
 */
export interface TraitorWeights {
  /**
   * Nhân với `suspicion` của mục tiêu, rồi đổi DẤU.
   *
   * Kẻ Phản Bội không biết Sói là ai, nhưng nó chạy cùng bộ não với làng - nên
   * người NÓ nghi nhất cũng là người làng sắp nghi nhất, tức con Sói có xác
   * suất cao nhất bàn. Số hạng này giữ nó khỏi tự tay giúp làng treo trúng.
   */
  suspectShield: number;
  /**
   * Nhân với `trust` của mục tiêu.
   *
   * Người được tin nhất bàn gần như luôn là một vai chức năng đã lộ - nguồn
   * xác nhận của làng, và đúng thứ bầy Sói cần dọn đi.
   */
  trustedTargetBonus: number;
}

export interface JesterWeights {
  /**
   * Nhân với `trust` của mục tiêu.
   *
   * Đây là lõi chiến thuật: chỉ vào đúng người mà cả làng đang tin nhất là
   * cách nhanh nhất để bị đọc thành Sói - tức là được đưa lên giá treo, đúng
   * thứ Hề đi tìm.
   */
  contrarianTrustBonus: number;
  /**
   * Trừ thẳng vào người đang dẫn phiếu.
   *
   * Hùa theo đám đông là hành vi an toàn nhất trên bàn, và an toàn là điều tệ
   * nhất với Hề: một ngày kết thúc bằng việc treo người khác là một ngày Hề
   * mất trắng.
   */
  bandwagonPenalty: number;
  /** Nhân với `suspicion`: tránh chỉ vào người cả làng đã nghi sẵn. */
  crowdSuspicionDamping: number;
  /** Xác suất Hề dám tung một lời khai láo, trước khi nhân tính cách. */
  bluffChance: number;
  /** Vòng sớm nhất Hề khai láo chủ động. */
  bluffFromRound: number;
}

/**
 * Sát Nhân: một chiến thuật SINH TỒN, ngược hẳn Thằng Hề.
 *
 * Hề đi tìm sự chú ý; Sát Nhân đi tìm sự vô hình. Nó thắng bằng cách còn lại
 * một mình, nên mọi tham số ở đây phục vụ đúng hai việc: giết đúng người vào
 * ban đêm, và không bị treo vào ban ngày.
 *
 * `nightThreatWeight === 0` TẮT toàn bộ nhóm và là cổng DUY NHẤT, đúng thói
 * quen của `claim.accusationWeight` và nhóm `jester`.
 */
export interface SerialKillerWeights {
  /**
   * Nhân với mức "nguy hiểm" của mục tiêu đêm.
   *
   * `0` TẮT cả nhóm: BOT Sát Nhân rơi về nước đi mặc định (đâm người bị nghi
   * ít nhất trong danh sách hợp lệ, phá hoà bằng id) và KHÔNG rút số ngẫu
   * nhiên nào.
   */
  nightThreatWeight: number;
  /**
   * Cộng vào điểm của người đang bị làng NGHI NHẤT.
   *
   * Âm là đúng, và đây là lõi chiến thuật đêm: người cả làng đang nghi sẽ bị
   * chính làng treo vào ngày mai, nên đâm họ là tiêu một đêm để làm hộ việc
   * người khác sắp làm miễn phí.
   */
  nightSuspicionDiscount: number;
  /**
   * Cộng vào điểm của người đang được làng TIN NHẤT.
   *
   * Người được tin là người lái được cuộc bỏ phiếu, và cũng là người khó bị
   * treo nhất - tức là kẻ mà Sát Nhân phải tự tay xử lý.
   */
  nightTrustWeight: number;
  /**
   * Cộng vào điểm của người đang công kích chính Sát Nhân.
   *
   * Đây là vế "tự vệ": ai đang kéo bàn về phía mình thì đêm nay là đêm cuối
   * của họ.
   */
  nightHostilityWeight: number;
  /**
   * Xác suất bỏ lượt đêm khi không ai đủ đáng giết, trước khi nhân tính cách.
   *
   * Không phải sự nhút nhát: một đêm bình yên giữa chuỗi đêm đẫm máu làm cả
   * làng tin rằng chỉ có một nguồn giết người trên bàn.
   */
  quietNightChance: number;
  /** Vòng sớm nhất Sát Nhân dám bỏ một đêm; trước đó luôn ra tay. */
  quietNightFromRound: number;
  /**
   * Trừ vào điểm bỏ phiếu ban ngày của người đang dẫn phiếu - tức là một phần
   * thưởng cho việc HÙA THEO.
   *
   * Ngược dấu với `jester.bandwagonPenalty`, và đó là toàn bộ chỗ khác nhau
   * giữa hai vai trung lập: đứng lạc lõng là cách Hề leo lên giá treo, và cũng
   * đúng là cách Sát Nhân bị treo theo.
   */
  bandwagonBonus: number;
  /** Trừ vào điểm của người mà Sát Nhân đã tự tay giết hụt/giết trượt. Xem `roles/serial-killer.ts`. */
  avoidOwnVictimWeight: number;
}

/**
 * Kẻ Báo Thù: một chiến thuật DỒN PHIẾU, không phải một chiến thuật đêm.
 *
 * Nó không có lượt đêm nào và không có bằng chứng nào - thứ duy nhất nó có là
 * một cái tên mà engine đưa cho, và một ngày để thuyết phục cả làng treo cái
 * tên đó. Vì vậy cả nhóm này chỉ nghiêng đúng một thứ: bảng điểm bỏ phiếu.
 *
 * `targetPush === 0` TẮT toàn bộ nhóm và là cổng DUY NHẤT, đúng thói quen của
 * nhóm `jester` và nhóm `serialKiller`.
 */
export interface ExecutionerWeights {
  /**
   * Cộng vào điểm bỏ phiếu của MỤC TIÊU.
   *
   * `0` TẮT cả nhóm: BOT Kẻ Báo Thù bỏ phiếu y hệt một Dân Làng và KHÔNG rút
   * số ngẫu nhiên nào, nên mọi ván tái lập theo cấu hình cũ vẫn đúng từng bit.
   */
  targetPush: number;
  /**
   * Trừ vào điểm của MỌI người khác.
   *
   * Cần vế thứ hai này vì `targetPush` một mình chỉ nâng mục tiêu lên; khi cả
   * làng đang dồn vào một người khác thì con số đó vẫn thua. Nhỏ hơn hẳn
   * `targetPush`: nó chỉ để kéo bàn về phía mục tiêu, không được biến BOT
   * thành kẻ phản đối mọi phiên toà - một người bênh tất cả trừ một người là
   * một người dễ đọc.
   */
  othersDamping: number;
  /**
   * Trừ vào điểm của mục tiêu khi mục tiêu đang được cả làng TIN.
   *
   * Không phải sự nhút nhát mà là nhịp: chỉ vào người cả làng vừa dựa vào, và
   * không có gì trong tay, là cách nhanh nhất để chính mình lên giá treo thay
   * họ. Nhân với `trust` của mục tiêu nên nó tự nhạt đi khi uy tín người đó
   * lung lay.
   */
  protectedTargetPenalty: number;
}

export interface SuspicionWeights {
  /** Bằng chứng chắc chắn đáng giá hơn cùng một điểm nghi ngờ không có lý do. */
  evidenceConfidenceBonus: number;
  /** Bị nhiều người công kích là tín hiệu xã hội, không phải bằng chứng cứng. */
  hostilityBonus: number;
  /** Đóng góp tối đa của social graph khi một cặp trông như đang phối hợp. */
  pairBonus: number;
  /** Nhỏ có chủ đích: cô lập là gợi ý, không được tự mình đẩy ai qua ngưỡng. */
  isolationBonus: number;
  /** Người bướng bỉnh đổi ý chậm hơn: `base + stubbornness * span`. */
  inertiaBase: number;
  inertiaStubbornSpan: number;
  /** Inertia chỉ làm CHẬM update, không bao giờ đảo dấu: `1 - inertia * scale`. */
  inertiaScale: number;
}

export interface TrustWeights {
  /** Trust kéo ngược suspicion nhưng không bao giờ triệt tiêu được nó. */
  damping: number;
}

export interface VoteHistoryWeights {
  /** Đổi phiếu trong phần đuôi này của vòng được coi là muộn. */
  lateSwitchRatio: number;
  /** Một wagon phải có sẵn bấy nhiêu phiếu thì nhảy vào mới là "theo đuôi". */
  minBandwagonLead: number;
  /**
   * Bấy nhiêu vòng LIÊN TIẾP né tránh thì thành một tín hiệu `AVOIDANCE`.
   *
   * Ba: hai vòng đầu ai cũng còn dò, và một người chỉ bỏ phiếu trắng qua hai
   * vòng chưa nói lên điều gì. Tới vòng thứ ba mà vẫn chưa đứng vào một cáo
   * buộc nào thì đó là một lựa chọn, không phải một sự thận trọng.
   */
  avoidanceRounds: number;
}

export interface SocialWeights {
  /** Một evidence nặng cỡ chừng này điểm là đủ kéo một cạnh từ 0 lên trần. */
  edgeStepDivisor: number;
  /** Chiết khấu Bayes cho số quan sát ít: `samples / (samples + prior)`. */
  priorStrength: number;
  alignmentMix: number;
  supportMix: number;
  hostilityMix: number;
  /** Dưới mức này thì hai người chỉ tình cờ trùng ý, không phải một phe. */
  minCohesion: number;
  /** "Ai muốn người đó chết": weight nhân với hostility của cạnh. */
  deathMotiveWeight: number;
  deathMotiveConfidence: number;
}

export interface RecencyWeights {
  /** Mỗi vòng, một niềm tin không được củng cố giữ lại bấy nhiêu sức nặng. */
  beliefDecayPerRound: number;
  /** Cùng ý tưởng nhưng cho importance của memory. */
  memoryDecayPerRound: number;
  /**
   * Tốc độ nguội của HỒ SƠ người chơi (`BotBrainState.profiles`), mỗi vòng.
   *
   * Cố ý CHẬM hơn `beliefDecayPerRound`: sự kiện nguội nhanh ("hôm qua anh
   * đổi phiếu muộn" hết quan trọng sau hai ngày), còn người nguội chậm ("anh
   * từng khai láo" vẫn đáng nhớ tới cuối ván). Hai tốc độ, hai thứ khác nhau.
   * `1` là không nguội.
   */
  profileDecayPerRound: number;
  /**
   * Evidence cũ hơn bấy nhiêu vòng bị coi là *stale* khi ĐO.
   *
   * Đây là ngưỡng của một METRIC, không phải một luật: dùng bằng chứng cũ không
   * sai, nhưng tỉ lệ cao nghĩa là decay không làm việc.
   */
  staleAfterRounds: number;
}

export interface SelfPreservationWeights {
  /*
   * Ba knob `guardSelf*` từng đứng ở đây để nuôi một khoản thưởng "Bảo Vệ tự
   * đỡ". Engine cấm tự đỡ, nên khoản thưởng ấy không bao giờ được cộng và ba
   * knob này không bao giờ được đọc - đã xoá cả bốn cùng lúc. Muốn mở lại thì
   * mở ở engine trước.
   */
  /** Đỡ người mình nghi là Sói thì vừa phí lượt vừa cứu nhầm phe. */
  guardSuspicionPenalty: number;
  /**
   * Phạt điểm khi đỡ lại một người đã từng đỡ.
   *
   * Bảo Vệ luôn chọn "người đáng tin nhất" sẽ đỡ đúng một người gần như mọi
   * đêm, và bầy Sói đọc được mẫu đó sau hai vòng. `0` để tắt.
   */
  guardRepeatPenalty: number;
}

export interface TeammateProtectionWeights {
  /** Bias ban ngày: Sói không bao giờ tự đề cử đồng bọn. */
  voteBiasPenalty: number;
  /** Phạt điểm khi chấm phiếu: `base + loyalty * loyaltySpan`. */
  penaltyBase: number;
  loyaltySpan: number;
}

export interface DeceptionRiskWeights {
  /**
   * Tỉ lệ phiếu đang dồn vào một đồng đội mà trên đó hy sinh nó RẺ HƠN bảo vệ.
   *
   * Đo bằng ÁP LỰC CÔNG KHAI (`currentVoteCounts`), không phải bằng nghi ngờ của
   * chính con Sói. Đó là chỗ bản đầu tiên sai: `applyPrivateInformation` ghim
   * suspicion của đồng đội về 0, nên một cổng dựa trên belief riêng KHÔNG BAO
   * GIỜ mở - hành vi tồn tại trên giấy và không lần nào chạy.
   *
   * Đặt `> 1` để tắt hoàn toàn.
   */
  bussingVoteShare: number;
  /**
   * Cùng ngưỡng ấy khi BÀN CÓ NGƯỜI THẬT (`isHumanTable`).
   *
   * Người thật dồn phiếu nhanh hơn bot: một cái tên được hai người nhắc là đã
   * thành đa số trong vài giây, và một con Sói còn đứng che lúc đó là con Sói
   * bị đọc ra đầu tiên. Bằng `bussingVoteShare` ở v1..v15 (không đổi gì);
   * v16 hạ xuống 0.15 để Sói bán sớm hơn một nhịp trước người.
   */
  bussingVoteShareHuman: number;
  /**
   * Xác suất một con Sói mở một cuộc CÃI GIẢ với đồng bọn ở vòng 1-2, trước
   * khi nhân `deceptionSkill`. Trong `[0, 1]`; `0` TẮT - đúng ở v1..v15.
   *
   * Hai con Sói bot không bao giờ đụng nhau, và người chơi đọc được điều đó
   * sau hai ván. Cuộc cãi giả là một lá phiếu nhẹ vào đồng bọn khi CHƯA AI
   * nghi một trong hai - lúc nó rẻ nhất - do một ghế hash chốt (không rút
   * RNG, không thêm state; xem `fakeFightTarget`). Không phải bussing: bussing
   * đi theo đám đông đã có, cãi giả tự mở màn khi chưa có đám đông nào.
   */
  fakeFightChance: number;
  /** Vòng cuối cùng còn được cãi giả. Sau đó bầu đồng bọn chỉ còn là bussing. */
  fakeFightUntilRound: number;
  /** Sói có `deceptionSkill` cao mới dám bán đồng đội. */
  bussingDeceptionScale: number;
  /**
   * Điểm cộng khi nhảy lên chuyến xe đang lăn.
   *
   * Bỏ phạt bảo vệ đồng đội là CHƯA ĐỦ: đồng đội có suspicion bằng 0 trong mắt
   * chính con Sói (bị ghim), nên nếu chỉ gỡ phạt thì nó vẫn không bao giờ được
   * chọn. Hành vi thật của bussing là *bỏ phiếu cùng đa số*, nên nó cần một số
   * hạng DƯƠNG tỉ lệ với số phiếu đang dồn vào.
   */
  bussingJoinBonus: number;
  /**
   * Vòng sớm nhất mà Tiên Tri chịu đính kết quả soi vào lời nói.
   *
   * Soi trúng Sói ngay đêm đầu rồi hô lên ở vòng 1 là cách nhanh nhất để chết ở
   * đêm 2: bầy Sói biết ngay ai là Tiên Tri. Đặt `0` để tắt (luôn nói ngay).
   */
  seerRevealRound: number;
  /**
   * Vòng sớm nhất Tiên Tri CHỦ ĐỘNG khai vai (kèm kết quả soi) khi bàn có
   * người thật - xem `humanTableThreshold`. `0` để tắt (dùng luật chung).
   *
   * Tách khỏi `seerRevealRound` vì hai quần thể khán giả trả hai cái giá khác
   * nhau cho cùng một lời khai. Trong bàn toàn bot, giấu tới vòng 2 làm làng
   * mất 4 điểm win-rate (thông tin lan quá chậm để một đêm sống thêm bù lại
   * được - chú thích ở v2). Trước người thật, khai ngày 1 là cách chắc nhất
   * để chết đêm 2: người thật đọc chat và cắn đúng con Tiên Tri.
   *
   * Chỉ chặn nhánh PROACTIVE của `decideChatClaim` và phần bằng chứng soi
   * trong lời nói; bị dồn phiếu (UNDER_FIRE) hay bị mạo danh (COUNTER) thì vẫn
   * khai như thường. Lá phiếu không đổi: Tiên Tri vẫn bầu đúng con Sói đã soi.
   */
  seerRevealRoundHuman: number;
  /**
   * Số người thật CÒN SỐNG tối thiểu để bàn được coi là "bàn có người".
   *
   * Không phải "có ít nhất một người": một người giữa năm bot vẫn là một bàn
   * bot về mặt tốc độ lan thông tin, và mọi số đo self-play vẫn đúng ở đó.
   */
  humanTableThreshold: number;
  /**
   * Ngưỡng vote hiệu dụng tăng thêm sau khi một Sói mất đồng đội.
   *
   * Mất đồng bọn thì đẩy phiếu lộ liễu là tự chỉ vào mình. `0` để tắt.
   */
  allyLostThresholdBonus: number;
  /**
   * Tỉ lệ người đã chết mà trên đó "không treo ai" trở thành nước thua.
   *
   * Ma Sói không có hoà: mỗi đêm làng mất một người, nên một ngày không treo ai
   * là một người mất trắng. Treo bừa có xác suất trúng Sói bằng
   * `số Sói / số còn sống`; không treo có xác suất bằng 0.
   */
  abstainPressureCeiling: number;
}

export interface AggressionWeights {
  /** Ngưỡng tối thiểu để dám đề cử: `base - aggressiveness*a - riskTolerance*r`. */
  thresholdBase: number;
  aggressivenessSpan: number;
  riskSpan: number;
  /**
   * Tỉ lệ người đã chết mà DƯỚI đó phe làng được bỏ phiếu trắng khi ứng viên
   * dẫn đầu KHÔNG CÓ BẰNG CHỨNG NÀO. `0` TẮT - v1..v18.
   *
   * Anh em với `deceptionRisk.abstainPressureCeiling` nhưng hẹp hơn hai bậc,
   * và sự hẹp đó là toàn bộ lý do ô này an toàn:
   *
   * 1. Cổng của Sói mở khi `score < threshold` HOẶC bằng chứng rỗng; cổng này
   *    chỉ mở khi RỖNG. Một ứng viên có lý do thật mà chưa đủ nặng vẫn bị nêu
   *    tên. Nếu nới ra "dưới ngưỡng", phần lớn vòng sớm sẽ không treo ai và ta
   *    rơi vào đúng vòng lặp chết đã ghi ở `decideFinalVote`: không ai bị kết
   *    án -> không có lịch sử phiếu -> không sinh bằng chứng -> không ai bị
   *    kết án. Harness ở Task 9 đo vòng lặp đó là làng thua 30/30.
   * 2. Nó chỉ mở khi làng còn đủ đông. Xem chú thích của
   *    `abstainPressureCeiling`: không treo ai là một ngày mất trắng, và cái
   *    giá đó tăng theo mỗi người đã chết.
   *
   * Vì sao vẫn đáng mở: một BOT nêu tên khi bảng belief RỖNG không phải là một
   * nước cờ, nó là một cáo buộc do jitter sinh ra. Bàn đọc được điều đó, và
   * một lá phiếu vô căn cứ cũng đầu độc chính `vote-analysis` của các BOT khác
   * - chúng học từ lịch sử phiếu.
   */
  villageAbstainPressureCeiling: number;
}

export interface ConfidenceWeights {
  /** Khoảng cách tối thiểu để bỏ mục tiêu đang bầu: `base + stubbornness*span`. */
  hysteresisBase: number;
  hysteresisStubbornSpan: number;
  /**
   * Cộng thêm vào hysteresis khi mục tiêu ĐANG BẦU đã nói từ
   * `talkerHysteresisLines` câu trở lên trong vòng này. `0` TẮT - v1..v16.
   *
   * Lật kèo vì nhiễu nhỏ trước một người vừa nói ba câu bào chữa bị đọc là
   * "bot ngu": người đó vừa dồn sức thuyết phục, và con bot đổi ý mà không có
   * lý do nào mới. Trước một người im lặng thì cùng cú lật ấy không ai để ý.
   * Không đổi `aggression.thresholdBase`: ngưỡng ĐỀ CỬ giữ nguyên, chỉ độ
   * dính của lá phiếu đã bầu là tăng. Bằng chứng mới đủ mạnh vẫn lật được.
   */
  talkerHysteresisBonus: number;
  /** Số câu (message parser hiểu được) trong vòng để một người là "nói nhiều". */
  talkerHysteresisLines: number;
  /**
   * Hệ số nhân vào `talkerHysteresisBonus` khi mục tiêu đang bầu vừa nhận
   * được bằng chứng GỠ TỘI mới trong vòng này (một `reason` weight âm, cùng
   * vòng, trong `suspicion[target]`): họ khai một vai quyền lực, hay có người
   * đứng ra bênh. Trong `[0, 1]`; `1` là bonus áp phẳng (v17), `0` là tắt hẳn
   * bonus trước người vừa có lý do mới để được tha (v18).
   *
   * Vì sao cần: v17 đếm CÂU, không đọc NỘI DUNG. Đo bằng kịch bản có kiểm soát
   * (`bot-persuasion.test.ts`): một người bị bầu nói ba câu có bằng chứng tốt
   * làm điểm mình giảm ~1.4, nhưng bonus +2 làm lá phiếu dính hơn ~2 - tức
   * nói có bằng chứng lại KHÓ thoát phiếu hơn im lặng. Bonus sinh ra để chống
   * lật kèo vì nhiễu, không phải để phạt người bào chữa có căn cứ; khi đã có
   * bằng chứng mới thì "đổi ý" không còn là nhiễu.
   *
   * Không đụng tới trường hợp bonus được thiết kế cho: ba câu "tôi là dân",
   * ba câu phản công vô căn cứ - không có reason âm nào sinh ra, bonus giữ
   * nguyên.
   */
  talkerHysteresisExculpatedScale: number;
  /** Phát bắn Thợ Săn phải chắc hơn một lá phiếu thường bấy nhiêu điểm. */
  hunterMargin: number;
  /** Biên tin tưởng cần có để THA một người cả làng vừa đưa ra xử. */
  spareTrustMargin: number;
  /** Biên độ nhiễu người-hoá, luôn từ RNG được inject: `±jitterSpan/2`. */
  jitterSpan: number;
}

export interface RoleThresholdWeights {
  witchHealTrust: number;
  witchPoisonSuspicion: number;
  /** Trên mức này thì dù nghi tới đâu cũng không độc. */
  witchPoisonTrustVeto: number;
  /**
   * Chiết khấu ngưỡng của kỹ năng dùng-một-lần khi LÀNG ĐÃ MỎNG
   * (`isThinVillage`): `witchPoisonSuspicion` trừ đi
   * bấy nhiêu. `0` TẮT - đúng ở v1..v14.
   *
   * Không ép xài: vẫn cần bằng chứng, chỉ là bằng chứng "vừa đủ" thì dùng
   * thay vì ôm tới cuối. Một bình còn nguyên khi ván kết thúc có giá trị bằng
   * 0, và nửa sau ván là lúc mỗi đêm mất một người nặng gấp đôi nửa đầu.
   * Trên thang belief thật (p90 ≈ 1.8, p99 ≈ 8.6), một nấc là 1.
   */
  witchPoisonLosingDiscount: number;
  /**
   * Cùng ý với `witchPoisonLosingDiscount`, cho bình cứu: `witchHealTrust`
   * trừ đi bấy nhiêu khi làng đã mỏng. Tách khoá vì hai thang khác nhau
   * (trust 1.5 so với suspicion 5). `0` TẮT.
   */
  witchHealLosingDiscount: number;
  /**
   * Làng "mỏng" khi `sống <= tổng x thinVillageShare`. Trong `[0, 1]`.
   *
   * 0.5 = đã mất một nửa bàn. Chỉ có nghĩa khi một trong hai chiết khấu trên
   * khác 0, nên giữ 0.5 ở mọi preset mà không đổi hành vi nào.
   */
  thinVillageShare: number;
  /** Giá trị thông tin cao nhất nằm ở giữa, không ở hai đầu. */
  seerMostInformativeSuspicion: number;
  seerUncertaintySlope: number;
  /** Sói: người tự nhận vai quyền lực phải chết trước, không cần tính gì thêm. */
  wolfClaimedPowerScore: number;
  wolfThreatBase: number;
  wolfTrustWeight: number;
  wolfHostilityWeight: number;
  /** Trừ suspicion: làng đang nghi sẵn thì để làng tự xử. */
  wolfSuspicionDiscount: number;
}

/** Confidence gắn vào intention. Là ĐẦU RA, không tham gia chấm điểm. */
export interface NightConfidenceWeights {
  seer: number;
  detective: number;
  guard: number;
  witchHeal: number;
  witchPoison: number;
  witchSkip: number;
  /** Confidence mặc định của một evidence do nước đi đêm sinh ra. */
  nightEvidence: number;
  tracker: number;
}

/** Mọi trait được rút i.i.d. từ `[min, max]`. */
export interface PersonalityRange {
  min: number;
  max: number;
}

/** Trần bộ nhớ. Không ảnh hưởng chất lượng chơi, nhưng ảnh hưởng chi phí. */
export interface MemoryLimits {
  beliefReasons: number;
  edgeReasons: number;
  /** Lịch sử phiếu và lịch sử phát ngôn giữ trong state. */
  history: number;
  pinned: number;
  memory: number;
  seenEvents: number;
  /** Số evidence tối đa mang theo một intention. */
  intentionEvidence: number;
  /**
   * Số nghi phạm đầu bảng ghi vào tóm tắt vòng.
   *
   * Trường riêng dù trùng giá trị với `intentionEvidence`: "bao nhiêu nghi phạm
   * vào bản tóm tắt" và "bao nhiêu bằng chứng đi kèm một nước đi" là hai câu
   * hỏi khác nhau, và gộp chúng khiến chỉnh cái này đổi luôn cái kia.
   */
  topSuspects: number;
}

/**
 * Hội thoại: bao nhiêu, bao lâu một lần, và khi nào thì im.
 *
 * Nhóm này KHÔNG chứa hằng số thời gian thật (mili giây). Server sở hữu timing;
 * đưa `minGapMs` vào đây sẽ kéo một khái niệm của đồng hồ vào một package tuyên
 * bố là thuần, và biến mọi test lõi thành test phụ thuộc lịch.
 */
export interface ConversationWeights {
  /** Số bản ghi phát ngôn giữ lại trong `BotBrainState`. */
  memoryWindow: number;
  /**
   * Cửa sổ chống lặp là KÉP: cả vòng lẫn số bản ghi.
   *
   * Chỉ theo vòng thì trong một vòng thảo luận dài BOT vẫn lặp được; chỉ theo
   * số bản ghi thì sang vòng mới vẫn còn bị khoá bởi chuyện đã cũ.
   */
  semanticCooldownRounds: number;
  semanticCooldownCount: number;
  /** Trần tin nhắn của MỘT bot trong MỘT vòng. */
  messagesPerBotPerRound: number;
  /** Trần tin nhắn BOT của cả phòng trong một vòng. */
  roomMessagesPerRound: number;
  /** Một câu chat kích hoạt được tối đa bấy nhiêu phản hồi. */
  maxRepliesPerMessage: number;
  /** Độ sâu chuỗi A→B→A tối đa. Chặn vòng lặp hai bot đáp qua đáp lại. */
  maxChainDepth: number;
  /** Sàn xác suất trả lời khi bị gọi tên hoặc bị hỏi thẳng. `[0,1]`. */
  directReplyFloor: number;
  /** Trần xác suất phản hồi. PHẢI < 1: không ai trả lời mọi câu. `[0,1]`. */
  replyCeiling: number;
  /** Câu cũ hơn bấy nhiêu vòng không còn đáng phản hồi. */
  triggerFreshnessRounds: number;
  /** Trust tối thiểu để coi một người là "người tôi tin" khi họ bị tố. */
  agreeTrustThreshold: number;
  /** Suspicion tối thiểu để coi một người là "người tôi nghi" khi họ được bênh. */
  disagreeSuspicionThreshold: number;
  /** Cơ hội pha trò khi không có gì đáng nói. `[0,1]`. */
  humorChance: number;
  /** Cơ hội buông một câu phản ứng ngắn. `[0,1]`. */
  reactionChance: number;
  /** Số dòng chat tối đa đưa vào prompt. */
  promptChatWindow: number;
  /** Số câu gần nhất của CHÍNH bot đưa vào prompt để nó không tự lặp. */
  promptRecentOwnLines: number;
  /** Số lượt thảo luận mỗi vòng trong self-play. */
  selfPlayTurnsPerRound: number;
  /**
   * Câu hỏi nhắm thẳng vào bot còn được coi là "đang nợ" trong bấy nhiêu vòng.
   * `0` TẮT hẳn danh sách.
   *
   * Rộng hơn `triggerFreshnessRounds` có chủ đích: hai con số trả lời hai câu
   * hỏi khác nhau — "có đáng đáp NGAY không" và "mình đang nợ ai câu nào".
   * Không ảnh hưởng RNG: `ConversationState` là một cái nhìn dẫn xuất.
   */
  unansweredQuestionRounds: number;
  /**
   * Phần `speechUrge` được cộng vào ngưỡng `talkativeness` khi bot cân nhắc tự
   * mở lời. `[0,1]`; `0` TẮT — ngưỡng quy về đúng hành vi Phase 3.
   *
   * Cộng vào NGƯỠNG chứ không thêm một lượt rút: đây là điều kiện để mọi preset
   * cũ replay từng bit.
   */
  urgencyBoost: number;
  /**
   * Ngưỡng tầm quan trọng để một câu hỏi đáng được đáp, `[0,1]`. Dưới ngưỡng
   * (và không bị dồn) thì BOT bỏ qua có chủ đích — spec §28 nói thẳng đừng tối
   * ưu tỉ lệ trả lời lên 100%.
   *
   * `0` TẮT toàn bộ chính sách trả lời câu hỏi (§13, §14) và quay về bậc thang
   * REPLY/ASK_EVIDENCE theo tính cách. Hai nghĩa ấy khớp nhau chứ không chỏi:
   * "không câu hỏi nào tầm thường tới mức bỏ qua" chính là hành vi cũ. Cùng
   * quy ước với `claim.accusationWeight` và `deceptionRisk.bussingVoteShare`.
   */
  questionIgnoreFloor: number;
}

/**
 * Lời khai vai và cách làng phân xử nó.
 *
 * `accusationWeight === 0` TẮT toàn bộ cơ chế, và nó là cổng DUY NHẤT — mọi
 * nhánh mới đều hỏi đúng nó rồi thoát ra trước khi rút số ngẫu nhiên. Tắt bằng
 * một giá trị ngoài miền có ích thay vì bằng một cờ boolean là đúng thói quen
 * đã có ở `deceptionRisk.bussingVoteShare`.
 *
 * Sức nặng ở đây nằm trên thang belief THẬT, nơi p90 ≈ 1.8 (xem
 * `docs/bot-ai-phase-3-verification.md` §4), không phải thang 0–100 trên giấy.
 * Đó chính là lỗi đã giết v1, nên đừng đọc những con số này như phần trăm.
 */
export interface ClaimWeights {
  /** Nghi ngờ dồn lên người bị một lời khai chỉ mặt. `0` TẮT cả cơ chế. */
  accusationWeight: number;
  /** Tin tưởng cộng cho chính người khai, trước khi nhân hệ số thời điểm. */
  claimantTrustWeight: number;
  /** Nhân vào cả hai giá trị trên khi lời khai bật ra lúc người khai đang dẫn phiếu. */
  underFireFactor: number;
  /** Nghi ngờ cộng cho CẢ HAI người cùng khai một vai. */
  collisionPenalty: number;
  /** Nhân thêm cho người khai ĐẾN SAU trong một cú va chạm. `>= 1`. */
  collisionLatePenaltyScale: number;
  /** Người khai vai chức năng chết ngay đêm sau: thưởng tin tưởng. */
  nightConfirmBonus: number;
  /** Người khai còn sống trong khi người khác chết đêm đó: phạt tin tưởng. */
  nightSurvivedPenalty: number;
  /** Khai "X là sói" mà vòng sau không bỏ phiếu X. */
  voteInconsistencyPenalty: number;
  /** Xác suất con Sói được chỉ định dám khai láo, trước khi nhân tính cách. */
  wolfBluffChance: number;
  /** Vòng sớm nhất Sói được khai láo chủ động. */
  wolfBluffFromRound: number;
  /**
   * Trừ sẵn vào phần thưởng tin cậy S1 của một người đã từng khai sai:
   * `knownBluffPenalty x bluffRate x profileStrength`. `0` TẮT.
   *
   * Đọc từ `BotBrainState.profiles` (P1.1). Không bao giờ đảo dấu phần
   * thưởng - một người từng khai láo được tin ÍT HƠN khi khai lại, chứ không
   * bị nghi thêm chỉ vì mở miệng.
   */
  knownBluffPenalty: number;
  /** Prior của `profileStrength`: hồ sơ phải có bấy nhiêu mẫu mới nặng bằng nửa. */
  profilePriorStrength: number;
}

export interface LookAheadWeights {
  /**
   * Hệ số áp lên áp lực sĩ số (0..1) trong số hạng `futureRisk` của nhánh làng.
   * Càng cuối ván, một án treo nhầm người vô tội càng đắt vì làng ít mạng hơn.
   * `0` TẮT số hạng này.
   */
  mislynchPressureScale: number;
  /**
   * Hệ số áp lên độ khan hiếm bằng chứng (0..1): tỉ lệ người còn sống khác
   * đang có bảng belief TRỐNG. Làng gần hết "nguồn dữ liệu" thì càng phải treo
   * đúng người có bằng chứng. `0` TẮT.
   */
  mislynchScarcityScale: number;
  /**
   * Nhánh Sói: thưởng khi treo nhầm người làng, nhân với áp lực. `0` TẮT —
   * v20 để 0 để chỉ đổi MỘT hành vi (nhánh làng) so với v18.
   */
  wolfMislynchGain: number;
}

export interface CounterfactualWeights {
  /**
   * Nhánh làng — teamValue: thưởng tối đa khi treo trúng phe Sói, nhân với
   * P(Sói) của mục tiêu (projection PR 1). `0` TẮT số hạng.
   */
  teamValueGain: number;
  /**
   * Nhánh làng — survivalValue: phạt khi treo nhầm, nhân P(vô tội) x áp lực
   * sĩ số. Cùng dạng `futureRisk` của v20 nhưng TÁCH thành phần riêng để
   * explainability; bật v21 thì term `futureRisk` của v20 không còn.
   */
  mislynchSurvivalCost: number;
  /**
   * Nhánh làng — informationValue: phạt khi mất một nguồn dữ liệu còn sống
   * (người có evidence reasons trong belief), nhân độ khan hiếm bằng chứng.
   */
  evidenceLossCost: number;
  /** Nhánh Sói — hệ số cho cả ba thành phần. `0` = Sói giữ bảng v18. */
  wolfSideGain: number;
}

export interface BotWeights {
  /** Semver. Đổi giá trị bất kỳ là phải đổi version. */
  readonly version: string;
  readonly evidence: EvidenceWeightTable;
  readonly memoryImportance: MemoryImportanceWeights;
  readonly privateInfo: PrivateInfoWeights;
  readonly suspicion: SuspicionWeights;
  readonly trust: TrustWeights;
  readonly voteHistory: VoteHistoryWeights;
  readonly social: SocialWeights;
  readonly recency: RecencyWeights;
  readonly selfPreservation: SelfPreservationWeights;
  readonly teammateProtection: TeammateProtectionWeights;
  readonly deceptionRisk: DeceptionRiskWeights;
  readonly aggression: AggressionWeights;
  readonly confidence: ConfidenceWeights;
  readonly roleThresholds: RoleThresholdWeights;
  readonly nightConfidence: NightConfidenceWeights;
  readonly personalityRange: PersonalityRange;
  readonly limits: MemoryLimits;
  readonly conversation: ConversationWeights;
  readonly claim: ClaimWeights;
  readonly traitor: TraitorWeights;
  readonly jester: JesterWeights;
  readonly serialKiller: SerialKillerWeights;
  readonly executioner: ExecutionerWeights;
  /**
   * Look-ahead một bước cho bảng điểm phiếu (spec §12). OPTIONAL vì v1..v19
   * không có nhóm này: vắng mặt = tắt, và `voteFutureRisk` trả 0.
   */
  readonly lookAhead?: LookAheadWeights;
  /**
   * Counterfactual có cấu trúc (spec CONTINUE §10). OPTIONAL; khi có mặt thì
   * planner counterfactual thay planner look-ahead v20 — ba term named
   * `survivalValue/informationValue/teamValue` thay term `futureRisk` gộp.
   */
  readonly counterfactual?: CounterfactualWeights;
}

/** Cho phép ghi đè từng nhánh mà không phải khai lại cả cây. */
export type BotWeightsOverride = {
  [K in keyof BotWeights]?: BotWeights[K] extends string
    ? BotWeights[K]
    : Partial<BotWeights[K]>;
};

/**
 * Trường phải nằm trong `[0, 1]`.
 *
 * Liệt kê tường minh chứ không đoán theo tên: một `0.5` hợp lệ ở chỗ này là một
 * lỗi ở chỗ khác, và đoán theo hậu tố sẽ bỏ sót đúng những chỗ nguy hiểm.
 */
const UNIT_INTERVAL_FIELDS: ReadonlyArray<[keyof BotWeights, string]> = [
  ["suspicion", "inertiaBase"],
  ["suspicion", "inertiaStubbornSpan"],
  ["suspicion", "inertiaScale"],
  ["trust", "damping"],
  ["voteHistory", "lateSwitchRatio"],
  ["social", "alignmentMix"],
  ["social", "supportMix"],
  ["social", "hostilityMix"],
  ["social", "minCohesion"],
  ["social", "deathMotiveConfidence"],
  ["recency", "beliefDecayPerRound"],
  ["recency", "memoryDecayPerRound"],
  ["recency", "profileDecayPerRound"],
  ["selfPreservation", "guardSuspicionPenalty"],
  ["conversation", "questionIgnoreFloor"],
  ["deceptionRisk", "abstainPressureCeiling"],
  ["aggression", "villageAbstainPressureCeiling"],
  // So THẲNG với một số trong [0, 1) sinh từ hash trong `fakeFightTarget`.
  ["deceptionRisk", "fakeFightChance"],
  ["roleThresholds", "thinVillageShare"],
  ["personalityRange", "min"],
  ["personalityRange", "max"],
  // `nightConfidence` được gán THẲNG vào `BotNightIntention.confidence` mà không
  // qua clamp nào. Một giá trị 1.5 ở đây sinh ra một intention có xác suất > 1,
  // và invariant `NUMERIC_SANITY` sẽ bắt nó ở tận vòng mô phỏng thứ n.
  ["nightConfidence", "seer"],
  ["nightConfidence", "detective"],
  ["nightConfidence", "guard"],
  ["nightConfidence", "witchHeal"],
  ["nightConfidence", "witchPoison"],
  ["nightConfidence", "witchSkip"],
  ["nightConfidence", "nightEvidence"],
  ["nightConfidence", "tracker"],
  // Bốn cái dưới đây được so THẲNG với `rng()`. Một giá trị 1.5 biến "đôi khi
  // trả lời" thành "luôn trả lời" mà không có lỗi nào để lần theo.
  ["conversation", "directReplyFloor"],
  ["conversation", "replyCeiling"],
  ["conversation", "humorChance"],
  ["conversation", "reactionChance"],
  // Hai cái này được so THẲNG với `rng()` hoặc nhân vào một sức nặng đã chuẩn
  // hoá. Một giá trị 1.5 ở đây không ném ở đâu cả, nó chỉ lặng lẽ làm sai.
  ["claim", "underFireFactor"],
  ["claim", "wolfBluffChance"],
  // Hệ số nhân vào một bonus hysteresis: 1.5 sẽ dính HƠN đúng lúc có lý do
  // để đổi ý, ngược hẳn ý nghĩa của trường.
  ["confidence", "talkerHysteresisExculpatedScale"],
  // Cùng lý do: so THẲNG với `rng()` trong `decideChatClaim`.
  ["jester", "bluffChance"],
  // Cùng lý do: so THẲNG với `rng()` trong `roles/serial-killer.ts`.
  ["serialKiller", "quietNightChance"],
];

/** Nhóm mà mọi kiểm tra sâu bên dưới giả định là có mặt. */
const REQUIRED_GROUPS: ReadonlyArray<keyof BotWeights> = [
  "evidence",
  "memoryImportance",
  "privateInfo",
  "suspicion",
  "trust",
  "voteHistory",
  "social",
  "recency",
  "selfPreservation",
  "teammateProtection",
  "deceptionRisk",
  "aggression",
  "confidence",
  "roleThresholds",
  "nightConfidence",
  "personalityRange",
  "limits",
  "conversation",
  "claim",
  "jester",
  "serialKiller",
  "executioner",
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Từ chối một cấu hình hỏng NGAY TẠI ĐIỂM CẤU HÌNH.
 *
 * Một `NaN` lọt qua đây sẽ không nổ; nó sẽ lặng lẽ làm mọi phép so sánh trả về
 * `false`, và BOT sẽ bỏ lượt suốt ván mà không có lỗi nào. Chi phí phát hiện
 * muộn là hàng trăm ván mô phỏng vô nghĩa.
 */
export function validateWeights(weights: BotWeights): string[] {
  const problems: string[] = [];

  if (typeof weights.version !== "string" || weights.version.trim() === "") {
    problems.push("version phải là chuỗi không rỗng");
  }

  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") return;
    if (isFiniteNumber(value)) return;
    if (typeof value === "number") {
      problems.push(`${path} không phải số hữu hạn (${String(value)})`);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
      return;
    }
    problems.push(`${path} có kiểu không hợp lệ (${typeof value})`);
  };
  for (const [group, value] of Object.entries(weights)) walk(value, group);

  // Dừng sớm khi HÌNH DẠNG đã sai.
  //
  // Các kiểm tra dưới đây truy cập thẳng vào nhóm con, nên một nhóm thiếu sẽ
  // ném `TypeError` thay vì trả về danh sách vấn đề - và đầu vào có khả năng
  // thiếu nhóm nhất chính là một file JSON do CLI nạp, tức đúng lúc người dùng
  // cần một thông báo đọc được nhất.
  const missingGroup = REQUIRED_GROUPS.some(
    (group) => weights[group] === null || typeof weights[group] !== "object",
  );
  if (missingGroup) {
    for (const group of REQUIRED_GROUPS) {
      if (weights[group] === null || typeof weights[group] !== "object") {
        problems.push(`thiếu nhóm bắt buộc "${String(group)}"`);
      }
    }
    return problems;
  }

  for (const [group, field] of UNIT_INTERVAL_FIELDS) {
    const value = (weights[group] as Record<string, unknown>)[field];
    if (!isFiniteNumber(value)) continue;
    if (value < 0 || value > 1) {
      problems.push(`${String(group)}.${field} phải nằm trong [0, 1] (đang là ${value})`);
    }
  }

  if (weights.personalityRange.min > weights.personalityRange.max) {
    problems.push("personalityRange.min không được lớn hơn max");
  }
  for (const [kind, entry] of Object.entries(weights.evidence)) {
    if (!isFiniteNumber(entry?.confidence)) continue;
    if (entry.confidence < 0 || entry.confidence > 1) {
      problems.push(`evidence.${kind}.confidence phải nằm trong [0, 1]`);
    }
  }

  return problems;
}

/**
 * Merge một nhánh vào bản gốc và trả về một cây MỚI.
 *
 * Không mutate `base`: `DEFAULT_BOT_WEIGHTS` là hằng số dùng chung của cả
 * process, và một lần mutate ở đây sẽ rò cấu hình của ván này sang ván sau.
 */
export function resolveWeights(
  over: BotWeightsOverride = {},
  base: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotWeights {
  const merged = { ...base } as Record<string, unknown>;
  let changedValues = false;

  for (const [group, patch] of Object.entries(over)) {
    if (patch === undefined) continue;
    if (typeof patch === "string") {
      merged[group] = patch;
      continue;
    }
    changedValues = true;
    merged[group] = { ...(base[group as keyof BotWeights] as object), ...patch };
  }

  // Đánh dấu cấu hình đã bị chỉnh, trừ khi caller tự đặt version.
  //
  // Quy tắc 3 của module là "đổi một giá trị là đổi version", và §4.3 của spec
  // giải thích vì sao: một con số win-rate không truy được về cấu hình sinh ra
  // nó là một con số vô dụng. Không có dòng này, `resolveWeights({trust:{...}})`
  // trả về một cấu hình vẫn tự xưng "1.0.0", và report của Task 7 - vốn khoá
  // theo `version` - sẽ gán số liệu của một bản chỉnh tay cho v1.
  if (changedValues && over.version === undefined) {
    merged.version = `${base.version}+custom`;
  }

  return merged as unknown as BotWeights;
}

/**
 * Cấu hình v1: ĐÚNG BẰNG hành vi Phase 2.
 *
 * Mọi con số ở đây được chép nguyên từ chỗ nó từng sống, không làm tròn và
 * không "sửa cho đẹp". Đó là điều kiện để Task 1 là refactor thuần và để v1
 * dùng được làm mốc so sánh vĩnh viễn cho mọi lần hiệu chỉnh sau này.
 */
export const BOT_WEIGHTS_V1: BotWeights = Object.freeze({
  version: "1.0.0",

  evidence: freezeEvidenceTable({
    TIE_BREAK: { weight: 10, confidence: 0.7 },
    SAVE_VOTE: { weight: 9, confidence: 0.65 },
    LATE_SWITCH: { weight: 7, confidence: 0.6 },
    BANDWAGON: { weight: 4, confidence: 0.35 },
    VOTE_ALIGNMENT: { weight: 3, confidence: 0.4 },
    ROLE_CLAIM: { weight: 5, confidence: 0.5 },
    COUNTER_CLAIM: { weight: 6, confidence: 0.5 },
    ACCUSE: { weight: 4, confidence: 0.45 },
    DEFEND: { weight: 3, confidence: 0.4 },
    // Nặng hơn mọi tín hiệu hành vi khác, và có lý do: đây là thứ DUY NHẤT
    // trong bảng đã được sự thật kiểm chứng, thay vì suy ra từ dáng vẻ của một
    // lá phiếu. Phán SAI nặng hơn phán ĐÚNG vì đẩy nhầm một người phe làng lên
    // giá treo cổ là việc Sói làm cả ván, còn treo trúng Sói thì nửa bàn cùng
    // bỏ phiếu nên nó không tách được ai ra khỏi đám đông.
    //
    // Hai ô này chỉ có người đọc khi biến thể luật `revealRoleOnDeath` bật
    // (xem `RoomConfig`), nên thêm chúng vào bảng gốc KHÔNG đổi hành vi của
    // v1..v6 ở phòng thật - vì vậy không có version bump nào ở đây.
    VERDICT_MISS: { weight: 14, confidence: 0.8 },
    VERDICT_HIT: { weight: 10, confidence: 0.7 },
    // TẮT ở v1..v10 (weight 0), và `analyzeAvoidance`/`analyzeDefense` thoát
    // ra TRƯỚC khi rút số ngẫu nhiên khi weight <= 0 - nên hai ô này không đổi
    // một bit nào của các preset cũ. v11 bật chúng; xem chú thích ở đó.
    AVOIDANCE: { weight: 0, confidence: 0.4 },
    DEFENSE_QUALITY: { weight: 0, confidence: 0.45 },
    // Nhẹ hơn mọi tín hiệu đã được sự thật kiểm chứng khác: "có ra tay" không
    // nói người đó thuộc phe nào.
    TRACKED_ACTIVE: { weight: 12, confidence: 0.8 },
    TRACKED_IDLE: { weight: -8, confidence: 0.8 },
  }),

  memoryImportance: Object.freeze({
    roleClaim: 8,
    counterClaim: 8,
    accuse: 4,
    defend: 3,
    fallback: 3,
    playerDied: 6,
    seerResult: 10,
    allyLost: 10,
    roundSummary: 9,
    voteCast: 4,
    voteChanged: 6,
    lateVote: 7,
    nominated: 7,
    finalJudgment: 6,
    directAddress: 2,
    directQuestion: 3,
    avoidance: 4,
    defenseQuality: 5,
  }),

  privateInfo: Object.freeze({
    seerWolf: 400,
    seerClear: -120,
    neutralClear: -40,
    neutralClearTrust: 30,
    neutralKillerSuspicion: 55,
    knownAlly: -80,
    /**
     * Người sống nhận một vai mà bot BIẾT CHẮC thuộc về người khác - Bà Đồng
     * đọc từ một cái xác, hoặc Tiên Tri Tập Sự được chỉ mặt Tiên Tri từ đêm 1.
     *
     * Nhẹ hơn hẳn `seerWolf` (400, ghim thẳng lên trần) vì nó KHÔNG phải bằng
     * chứng Sói: một Thằng Hề khai láo, hay một dân thường hoảng loạn tranh
     * claim, đều rơi vào đây. Nó chỉ chứng minh người đó nói dối.
     *
     * ĐÃ QUÉT, và kết quả là con số này KHÔNG QUAN TRỌNG. Preset 17 và 19,
     * 3000 ván mỗi giá trị, cùng bộ seed:
     *
     *   30 -> 61.6%   90 -> 61.5%   200 -> 61.6%   400 -> 61.6%
     *
     * Cả dải 13 lần chỉ trải 0.1 điểm, trong khi SE ở cỡ mẫu đó là ±0.9. Ở n=17
     * hai cặp (30, 90) và (200, 400) còn cho ra ĐÚNG cùng số ván thắng, tức
     * trọng số không lật được kết quả của một ván nào.
     *
     * Lý do đã đo được chứ không đoán: bằng chứng này chỉ chạm 1.9% số phiếu
     * (227 lần trên 100 ván preset 17-20). Nó cần một trùng hợp hẹp - phải có
     * người CÒN SỐNG đang khai đúng cái vai mà bot biết chắc thuộc về người
     * khác - nên dù nặng tới đâu nó cũng hiếm khi là lá phiếu quyết định.
     *
     * Giữ 90 vì nó nằm giữa dải đã quét, không phải vì nó tối ưu. Muốn lá này
     * đáng giá hơn thì chỗ sửa là TẦN SUẤT (cho bot nhiều nguồn xác nhận hơn),
     * không phải con số ở đây.
     */
    provenFalseClaim: 90,
  }),

  suspicion: Object.freeze({
    evidenceConfidenceBonus: 8,
    hostilityBonus: 6,
    pairBonus: 8,
    isolationBonus: 8,
    inertiaBase: 0.35,
    inertiaStubbornSpan: 0.45,
    inertiaScale: 0.5,
  }),

  trust: Object.freeze({ damping: 0.2 }),

  voteHistory: Object.freeze({ lateSwitchRatio: 0.8, minBandwagonLead: 2, avoidanceRounds: 3 }),

  social: Object.freeze({
    edgeStepDivisor: 20,
    priorStrength: 4,
    alignmentMix: 0.6,
    supportMix: 0.4,
    hostilityMix: 0.5,
    minCohesion: 0.15,
    deathMotiveWeight: 6,
    deathMotiveConfidence: 0.5,
  }),

  recency: Object.freeze({
    beliefDecayPerRound: 0.85,
    memoryDecayPerRound: 0.88,
    // 1 = không nguội ở v1..v12; v13 đặt 0.93. Hồ sơ không ảnh hưởng gì tới
    // v1..v11 (cổng `knownBluffPenalty = 0`), nên đây thuần là giữ v12 nguyên.
    profileDecayPerRound: 1,
    staleAfterRounds: 3,
  }),

  selfPreservation: Object.freeze({
    guardSuspicionPenalty: 0.5,
    // Tắt ở v1: Phase 2 không có hành vi này và v1 phải tái lập Phase 2 từng bit.
    guardRepeatPenalty: 0,
  }),

  teammateProtection: Object.freeze({
    voteBiasPenalty: -100,
    penaltyBase: 25,
    loyaltySpan: 30,
  }),

  deceptionRisk: Object.freeze({
    // Bốn giá trị dưới đây TẮT bốn hành vi mới của Phase 3. v1 phải tái lập
    // Phase 2 từng bit, nên chúng phải trung tính ở đây; v2 bật chúng lên.
    // `> 1` là cách tắt bussing mà không cần một cờ boolean riêng.
    bussingVoteShare: 2,
    // Bằng `bussingVoteShare` ở v1..v15; v16 tách hai ngưỡng. Cãi giả tắt
    // (chance 0) ở v1..v15, `fakeFightUntilRound` chỉ có nghĩa khi nó bật.
    bussingVoteShareHuman: 2,
    fakeFightChance: 0,
    fakeFightUntilRound: 2,
    bussingDeceptionScale: 0,
    bussingJoinBonus: 0,
    seerRevealRound: 0,
    // Tắt ở v1..v13 (0 = không chặn gì); v14 bật. Ngưỡng bàn có người là 4
    // ở mọi bản - nó chỉ có nghĩa khi `seerRevealRoundHuman > 0`.
    seerRevealRoundHuman: 0,
    humanTableThreshold: 4,
    allyLostThresholdBonus: 0,
    abstainPressureCeiling: 0.3,
  }),

  aggression: Object.freeze({
    thresholdBase: 58,
    aggressivenessSpan: 6,
    riskSpan: 4,
    // Tắt ở v1..v18; v19 bật. Xem `villageAbstainPressureCeiling`.
    villageAbstainPressureCeiling: 0,
  }),

  confidence: Object.freeze({
    hysteresisBase: 5,
    hysteresisStubbornSpan: 8,
    // Tắt ở v1..v16 (0); v17 bật. `talkerHysteresisLines` chỉ có nghĩa khi bật.
    talkerHysteresisBonus: 0,
    talkerHysteresisLines: 3,
    // 1 ở v1..v17 (bonus áp phẳng); v18 hạ về 0. Vô nghĩa khi bonus là 0.
    talkerHysteresisExculpatedScale: 1,
    hunterMargin: 20,
    spareTrustMargin: 15,
    jitterSpan: 6,
  }),

  roleThresholds: Object.freeze({
    witchHealTrust: 40,
    witchPoisonSuspicion: 85,
    witchPoisonTrustVeto: 50,
    // Tắt ở v1..v14 (0); v15 bật. `thinVillageShare` vô nghĩa khi chiết khấu 0.
    witchPoisonLosingDiscount: 0,
    witchHealLosingDiscount: 0,
    thinVillageShare: 0.5,
    seerMostInformativeSuspicion: 50,
    seerUncertaintySlope: 2,
    wolfClaimedPowerScore: 100,
    wolfThreatBase: 40,
    wolfTrustWeight: 0.4,
    wolfHostilityWeight: 20,
    wolfSuspicionDiscount: 0.35,
  }),

  nightConfidence: Object.freeze({
    seer: 0.7,
    detective: 0.65,
    guard: 0.6,
    witchHeal: 0.8,
    witchPoison: 0.75,
    witchSkip: 0.5,
    nightEvidence: 0.5,
    tracker: 0.7,
  }),

  personalityRange: Object.freeze({ min: 0.25, max: 0.9 }),

  limits: Object.freeze({
    beliefReasons: 12,
    edgeReasons: 8,
    history: 60,
    pinned: 60,
    memory: 120,
    seenEvents: 2_000,
    intentionEvidence: 3,
    topSuspects: 3,
  }),

  /**
   * TRUNG TÍNH: nhóm này có mặt vì `BotWeights` đòi nó, nhưng mọi giá trị ở đây
   * tái lập đúng hành vi Phase 3 — một tin mỗi bot mỗi ngày, không phản hồi ai,
   * một lượt thảo luận trong self-play.
   *
   * v1 là mốc so sánh vĩnh viễn. Một mốc đổi hành vi vì một phase sau đó không
   * còn là mốc.
   */
  conversation: Object.freeze({
    memoryWindow: 12,
    semanticCooldownRounds: 0,
    semanticCooldownCount: 0,
    messagesPerBotPerRound: 1,
    roomMessagesPerRound: 15,
    maxRepliesPerMessage: 0,
    maxChainDepth: 0,
    directReplyFloor: 0,
    replyCeiling: 0,
    triggerFreshnessRounds: 0,
    agreeTrustThreshold: 1,
    disagreeSuspicionThreshold: 1,
    humorChance: 0,
    reactionChance: 0,
    promptChatWindow: 20,
    promptRecentOwnLines: 4,
    selfPlayTurnsPerRound: 1,
    unansweredQuestionRounds: 0,
    urgencyBoost: 0,
    questionIgnoreFloor: 0,
  }),

  /**
   * TẮT toàn bộ ở v1. v1 phải tái lập Phase 2 từng bit, và v2/v3 kế thừa nhóm
   * này nguyên vẹn qua spread nên chúng cũng tắt — đó là điều kiện để bảng
   * win-rate của Phase 3 và Phase 4 còn so sánh được với v4.
   *
   * `collisionLatePenaltyScale: 1` chứ không phải `0`: nó là một HỆ SỐ NHÂN,
   * và một hệ số nhân bằng 0 là một giá trị vô nghĩa nằm chờ ai đó bật
   * `collisionPenalty` lên rồi không hiểu vì sao không có gì xảy ra.
   */
  claim: Object.freeze({
    accusationWeight: 0,
    claimantTrustWeight: 0,
    underFireFactor: 0,
    collisionPenalty: 0,
    collisionLatePenaltyScale: 1,
    nightConfirmBonus: 0,
    nightSurvivedPenalty: 0,
    voteInconsistencyPenalty: 0,
    wolfBluffChance: 0,
    wolfBluffFromRound: 0,
    // Tắt ở v1..v11; v12 bật. Không đổi một bit của preset cũ vì cổng `0`.
    knownBluffPenalty: 0,
    profilePriorStrength: 2,
  }),

  /**
   * TẮT toàn bộ ở v1, cùng lý do và cùng cách với nhóm `claim` ngay trên.
   *
   * v1-v6 là những mốc so sánh đã đo xong, và Thằng Hề chưa tồn tại khi chúng
   * được đo. Để nhóm này bằng 0 nghĩa là một con BOT Hề chạy dưới các cấu hình
   * đó chơi thụ động và KHÔNG rút một số ngẫu nhiên nào - tức mọi test tái lập
   * khoá theo v1/v2/v3 vẫn đúng từng bit. Bản bật thật là v7.
   */
  // Tắt ở v1 vì cùng lý do với nhóm `jester`: v1 phải tái lập Phase 2 từng bit,
  // và vai này chưa tồn tại ở đó.
  traitor: Object.freeze({
    suspectShield: 0,
    trustedTargetBonus: 0,
  }),

  jester: Object.freeze({
    contrarianTrustBonus: 0,
    bandwagonPenalty: 0,
    crowdSuspicionDamping: 0,
    bluffChance: 0,
    bluffFromRound: 0,
  }),

  /**
   * TẮT toàn bộ ở v1, cùng lý do và cùng cách với hai nhóm ngay trên.
   *
   * v1-v7 là những mốc so sánh đã đo xong, và Sát Nhân chưa tồn tại khi chúng
   * được đo. Với nhóm này bằng 0, một BOT Sát Nhân chạy dưới các cấu hình đó
   * đâm theo một luật tất định KHÔNG rút số ngẫu nhiên nào - nên mọi test tái
   * lập khoá theo v1/v2/v3 vẫn đúng từng bit. Bản bật thật là v8.
   */
  serialKiller: Object.freeze({
    nightThreatWeight: 0,
    nightSuspicionDiscount: 0,
    nightTrustWeight: 0,
    nightHostilityWeight: 0,
    quietNightChance: 0,
    quietNightFromRound: 0,
    bandwagonBonus: 0,
    avoidOwnVictimWeight: 0,
  }),

  /**
   * TẮT toàn bộ ở v1, cùng lý do và cùng cách với ba nhóm ngay trên.
   *
   * v1-v8 là những mốc so sánh đã đo xong, và Kẻ Báo Thù chưa tồn tại khi
   * chúng được đo. Với nhóm này bằng 0, một BOT Kẻ Báo Thù chạy dưới các cấu
   * hình đó bỏ phiếu y hệt một Dân Làng và KHÔNG rút số ngẫu nhiên nào - nên
   * mọi test tái lập khoá theo v1/v2/v3 vẫn đúng từng bit. Bản bật thật là v9.
   */
  executioner: Object.freeze({
    targetPush: 0,
    othersDamping: 0,
    protectedTargetPenalty: 0,
  }),
}) as BotWeights;

/**
 * Cấu hình v2 — kết quả hiệu chỉnh từ 300 ván, kiểm chéo trên ba seed base.
 *
 * v1 để Sói thắng **87%**. Chẩn đoán bằng đo đạc chứ không bằng phỏng đoán, và
 * phát hiện gốc là: **thang belief mà mọi ngưỡng dựa vào không bao giờ được
 * chạm tới.** Suspicion thật có p50 = 0, p90 = 1.8, p99 = 8.6 - trong khi
 * `voteThreshold` là 58, bình độc 85, Nước thánh 90. Mọi ngưỡng đó là chữ chết.
 *
 * Bốn thay đổi, mỗi thay đổi có số đo riêng (xem `docs/bot-ai-phase-3-verification.md`):
 *
 * 1. **Ngưỡng khớp thang thật.** `thresholdBase` 58 → 6, `spareTrustMargin`
 *    15 → 3, `hysteresis` 5/8 → 2/3. Ngưỡng của quyền năng thì GIỮ CAO (95):
 *    chỉ mục tiêu Tiên Tri đã ghim 100 mới kích hoạt được bình độc và Nước
 *    thánh, nên chúng chỉ bắn vào Sói đã xác nhận.
 * 2. **Bussing hoạt động** (`bussingVoteShare`, `bussingJoinBonus`). Riêng nó
 *    đưa làng từ 10% lên 20%.
 * 3. **Sói không còn bỏ phiếu trắng** (`abstainPressureCeiling` 0.3 → 0). Đây
 *    là đòn bẩy lớn nhất: 27% → 48%.
 * 4. **Tín hiệu xã hội nặng hơn** (`hostilityBonus` 6 → 20) và
 *    `social.minCohesion` 0.15 → 0.02 để chỉ số coalition có dữ liệu.
 *
 * Kết quả: làng thắng 38.7% / 45.0% / 48.0% trên ba seed base độc lập, độ chính
 * xác phiếu 35% → 45–49%.
 */
export const BOT_WEIGHTS_V2: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V1,
  version: "2.0.0",

  suspicion: Object.freeze({
    ...BOT_WEIGHTS_V1.suspicion,
    // Bị cả làng công kích là tín hiệu mạnh hơn nhiều so với đánh giá của v1,
    // vì các bằng chứng hành vi khác gần như không phân biệt được Sói.
    hostilityBonus: 20,
  }),

  aggression: Object.freeze({
    // Spread chứ không khai lại cả khối: v2 chỉ muốn đổi BA ô dưới đây, và một
    // khối khai trọn sẽ âm thầm nuốt mọi ô `aggression` thêm vào về sau (ô đó
    // thành `undefined` ở v2..v18 mà không preset nào báo lỗi).
    ...BOT_WEIGHTS_V1.aggression,
    // Ngưỡng phải nằm trong tầm với của thang belief thật, nếu không thì nhánh
    // "đủ căn cứ để đề cử" không bao giờ chạy và mọi lá phiếu chỉ là jitter.
    thresholdBase: 6,
    aggressivenessSpan: 2,
    riskSpan: 1,
  }),

  confidence: Object.freeze({
    ...BOT_WEIGHTS_V1.confidence,
    // Giữ CAO có chủ đích: chỉ mục tiêu Tiên Tri đã ghim 100 mới đáng một phát
    // bắn không ai kiểm lại được.
    hunterMargin: 80,
    spareTrustMargin: 3,
    hysteresisBase: 2,
    hysteresisStubbornSpan: 3,
  }),

  roleThresholds: Object.freeze({
    ...BOT_WEIGHTS_V1.roleThresholds,
    // 95 nghĩa là "chỉ Sói do Tiên Tri xác nhận". Bình độc dùng một lần cả ván
    // nên đây đúng là điều kiện để tiêu nó.
    witchPoisonSuspicion: 95,
  }),

  deceptionRisk: Object.freeze({
    bussingVoteShare: 0.2,
    bussingVoteShareHuman: 0.2,
    fakeFightChance: 0,
    fakeFightUntilRound: 2,
    bussingDeceptionScale: 3,
    bussingJoinBonus: 120,
    /**
     * `0` = Tiên Tri nói ngay.
     *
     * Trực giác nói nên giấu, và hành vi giấu ĐÃ được cài đặt và có test. Nhưng
     * số liệu bác bỏ nó: hoãn tới vòng 2 làm làng mất 4 điểm win-rate, tới vòng
     * 3 mất 9 điểm. Trong quần thể BOT này, thông tin của Tiên Tri lan quá chậm
     * để việc sống thêm một đêm bù lại được. Giữ cơ chế, tắt mặc định.
     */
    seerRevealRound: 0,
    seerRevealRoundHuman: 0,
    humanTableThreshold: 4,
    allyLostThresholdBonus: 6,
    /**
     * `0` = Sói không bao giờ chọn "không treo ai".
     *
     * Đây là đòn bẩy đơn lẻ lớn nhất trong cả đợt hiệu chỉnh (27% → 48%), và lý
     * do cần nói thẳng: bỏ phiếu trắng là một nước MẠNH QUÁ MỨC ở đây, không
     * phải vì nó hay, mà vì đòn đối trọng tự nhiên của nó chưa được mô hình hoá.
     * Ngoài đời, kẻ luôn bỏ phiếu trắng sẽ bị để ý ngay; ở đây lõi belief không
     * sinh ra nghi ngờ nào từ hành vi né tránh, nên Sói tiêu được một ngày của
     * làng mà không trả giá gì.
     *
     * Bật lại khi có bằng chứng "né tránh" trong `vote-analysis`.
     */
    abstainPressureCeiling: 0,
  }),

  selfPreservation: Object.freeze({
    ...BOT_WEIGHTS_V1.selfPreservation,
    // Không đo được lợi ích về win-rate, nhưng cũng không tốn gì, và nó bịt một
    // mẫu hành vi mà người chơi thật đọc ra được sau hai vòng.
    guardRepeatPenalty: 20,
  }),

  social: Object.freeze({
    ...BOT_WEIGHTS_V1.social,
    // 0.15 là ngưỡng KHÔNG BAO GIỜ với tới: điểm ghép cặp thật tối đa ~0.03,
    // nên `detectCoalitions` chưa từng trả về một nhóm nào trong ván thật.
    minCohesion: 0.02,
  }),
}) as BotWeights;

/**
 * Cấu hình v3 — Phase 4 bật hội thoại.
 *
 * Khác v2 ở ĐÚNG một nhóm: `conversation`. Mọi nhóm còn lại dùng chung tham
 * chiếu với v2, nên hiệu chỉnh cân bằng của Phase 3 không thể trôi lệch qua
 * đây, và chênh lệch win-rate giữa v2 và v3 (nếu có) chỉ có đúng một nguyên
 * nhân khả dĩ: BOT nói nhiều hơn nên quan sát được nhiều hơn.
 *
 * Vì sao các con số ở đây:
 *
 * - `messagesPerBotPerRound: 3` — trần trên của khoảng 2–3 mà thiết kế yêu cầu.
 *   Cao hơn thì một bàn 8 bot đẩy ra 24 tin mỗi ngày, đọc không kịp.
 * - `replyCeiling: 0.9` < 1 có chủ đích. Một BOT trả lời 100% số câu nhắm vào
 *   nó là một tổng đài, không phải người chơi.
 * - `maxChainDepth: 3` — A tố B, B đáp, A đáp lại. Tới đó là đủ một nhịp tranh
 *   luận; tầng thứ tư luôn là hai bot lặp lại nhau.
 * - `semanticCooldown` kép 2 vòng / 6 bản ghi — xem chú thích ở `ConversationWeights`.
 * - `agreeTrustThreshold` và `disagreeSuspicionThreshold` đặt trên thang belief
 *   THẬT (p90 ≈ 1.8, xem `docs/bot-ai-phase-3-verification.md` §4), không phải
 *   thang 0–100 trên giấy. Đây đúng là lỗi đã giết v1.
 */
export const BOT_WEIGHTS_V3: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V2,
  version: "3.0.0",

  conversation: Object.freeze({
    memoryWindow: 12,
    semanticCooldownRounds: 2,
    semanticCooldownCount: 6,
    messagesPerBotPerRound: 3,
    roomMessagesPerRound: 18,
    maxRepliesPerMessage: 2,
    maxChainDepth: 3,
    directReplyFloor: 0.75,
    replyCeiling: 0.9,
    triggerFreshnessRounds: 1,
    agreeTrustThreshold: 2,
    disagreeSuspicionThreshold: 2,
    humorChance: 0.12,
    reactionChance: 0.18,
    promptChatWindow: 12,
    promptRecentOwnLines: 4,
    /**
     * Bốn lượt, không phải hai.
     *
     * Đây là con số của TẦNG ĐO, không phải của production: server có lịch
     * riêng. Nó phải đủ lớn để mô phỏng CHẠM TỚI các giới hạn mà nó có nhiệm vụ
     * kiểm. Với hai lượt, chuỗi đối đáp không bao giờ vượt độ sâu 1 - lượt 1 là
     * phát biểu, lượt 2 là trả lời, và không có lượt nào để trả lời một câu trả
     * lời. `maxChainDepth = 3` khi đó là một luật chưa từng chạy.
     *
     * Đo trên 120 ván mỗi mức:
     *
     * | lượt | đáp câu hỏi | có trả lời | chuỗi sâu nhất | tin/bot/ngày | im lặng |
     * | ---- | ----------- | ---------- | -------------- | ------------ | ------- |
     * | 2    | 38.1%       | 25.9%      | 1              | 1.38         | 31.9%   |
     * | 3    | 56.9%       | 36.5%      | 2              | 1.84         | 23.6%   |
     * | 4    | 66.3%       | 40.8%      | 3              | 2.15         | 21.5%   |
     *
     * Mức 4 là mức đầu tiên chạm trần `maxChainDepth`, và vẫn nằm trong mọi
     * ngưỡng chất lượng. Cao hơn nữa chỉ tốn thời gian batch.
     */
    selfPlayTurnsPerRound: 4,
    /**
     * Danh sách câu nợ BẬT từ v3 (nó chỉ là một cái nhìn dẫn xuất, không rút
     * số), nhưng `urgencyBoost` vẫn TẮT: v3..v22 phải replay từng bit.
     */
    unansweredQuestionRounds: 3,
    urgencyBoost: 0,
    questionIgnoreFloor: 0,
  }),
}) as BotWeights;

/**
 * v4 — lời khai vai trong chat.
 *
 * Khác v3 ở ĐÚNG một nhóm: `claim`. Mọi nhóm còn lại dùng chung tham chiếu với
 * v3, nên chênh lệch win-rate giữa hai bản chỉ có đúng một nguyên nhân khả dĩ.
 *
 * Những con số này là GIÁ TRỊ KHỞI ĐẦU, không phải kết quả hiệu chỉnh. Task 7
 * đo `claimAccuracy` và `claimsPerGame` rồi chỉnh lại; đừng coi chúng là đã
 * chốt cho tới khi văn bản kiểm chứng nói vậy.
 *
 * - `accusationWeight: 12` — nặng gấp ba một `ACCUSE` trần (weight 4). Một lời
 *   khai đáng tin PHẢI lấn át tiếng ồn hành vi, nếu không cả cơ chế vô hình.
 * - `underFireFactor: 0.25` — khai lúc đang dẫn phiếu chỉ còn một phần tư sức
 *   nặng. Không về 0: người bị dồn oan vẫn có thể đang nói thật.
 * - `nightConfirmBonus` > `nightSurvivedPenalty` có chủ ý: chết sau khi khai là
 *   bằng chứng mạnh, còn sống sót thì mơ hồ vì Bảo Vệ bẻ gãy nó (spec §6.3).
 */
export const BOT_WEIGHTS_V4: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V3,
  version: "4.0.0",

  claim: Object.freeze({
    accusationWeight: 12,
    claimantTrustWeight: 6,
    underFireFactor: 0.25,
    collisionPenalty: 7,
    collisionLatePenaltyScale: 1.6,
    nightConfirmBonus: 14,
    nightSurvivedPenalty: 8,
    voteInconsistencyPenalty: 5,
    wolfBluffChance: 0.35,
    wolfBluffFromRound: 2,
    knownBluffPenalty: 0,
    profilePriorStrength: 2,
  }),
});

/**
 * v5 — ba ngưỡng của quyền năng dùng-một-lần được đưa về thang belief THẬT.
 *
 * v2 đã tìm ra và sửa đúng lỗi này cho `voteThreshold`, nhưng CỐ Ý chừa lại ba
 * ngưỡng ở đây, với lý do ghi rõ trong chú thích của nó: giữ cao để "chỉ mục
 * tiêu Tiên Tri đã ghim 100 mới kích hoạt được". Lập luận đó đúng với Nước
 * thánh của Linh Mục nhưng SAI với Phù Thuỷ và Thợ Săn, vì một lý do không ai
 * kiểm lại lúc đó: **hai vai này không bao giờ có một mục tiêu bị ghim.** Ghim
 * 100 chỉ đến từ `privateInfo.seerWolf`, tức từ lượt soi của CHÍNH mình. Phù
 * Thuỷ không soi. Thợ Săn không soi. Với họ, ngưỡng 95 và 80 không phải là
 * "cao" - chúng là bất khả thi.
 *
 * Đo trên 400 ván × 2 seed base độc lập (10 người, 2 Sói, có Thợ Săn):
 *
 * | | v4 | v5 |
 * | --- | --- | --- |
 * | Làng thắng | 61.0% / 59.3% | 65.3% / 63.5% |
 * | Thợ Săn bắn (trên mỗi lượt phản kích) | 0% | ~50% |
 * | Phát bắn trúng Sói | - | 30.1% / 30.3% |
 * | Bình độc mỗi ván | 0.00 | 0.24 / 0.27 |
 * | Bình độc trúng Sói | - | 36.1% / 37.0% |
 * | Bình cứu cứu NGƯỜI KHÁC | 0% | ~25% |
 *
 * Mốc so sánh cho hai cột "trúng Sói": chọn bừa một người còn sống cho ra
 * 22.7% với bình độc và 26.0% với phát bắn (đo trên cùng batch). Cả hai đều
 * nằm trên mốc đó, nên hai cơ chế này đang mang thông tin thật chứ không phải
 * đang gieo xúc xắc - đó là điều kiện để bật chúng lên.
 *
 * Chưa đụng tới: `priestSuspicion` (95) mắc ĐÚNG lỗi này. Nó ở lại v4 vì Linh
 * Mục cần batch đo riêng, không phải vì nó đã đúng.
 */
export const BOT_WEIGHTS_V5: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V4,
  version: "5.0.0",

  confidence: Object.freeze({
    ...BOT_WEIGHTS_V4.confidence,
    /**
     * `0`, không phải một số nhỏ.
     *
     * Bỏ hẳn khoảng cộng thêm biến ngưỡng bắn thành đúng `voteThreshold`, và
     * đó là một luật phát biểu được thành lời: *bắn người mà tôi đã có đủ căn
     * cứ để bỏ phiếu treo*. Một hằng số dương tuỳ ý ở đây thì không phát biểu
     * được như vậy, và mọi giá trị dương đã thử đều cho làng thắng thấp hơn.
     */
    hunterMargin: 0,
  }),

  roleThresholds: Object.freeze({
    ...BOT_WEIGHTS_V4.roleThresholds,
    /**
     * 5 nằm quanh p99 của thang suspicion thật (p50 = 0, p90 = 1.8, p99 = 8.6),
     * nên bình độc vẫn HIẾM - khoảng một phần tư số ván - chứ không thành một
     * nước đi mặc định. Hạ xuống 4 đẩy tần suất lên 0.58 bình/ván nhưng độ
     * chính xác rơi về 25.5%, tức ngang mức chọn bừa: đó là ranh giới của việc
     * "dùng bình" biến thành "vứt bình".
     */
    witchPoisonSuspicion: 5,
    /**
     * Nạn nhân đáng cứu phải có trust ĐO ĐƯỢC, và trên thang thật thì 1.5 đã
     * là một dấu hiệu rõ. Ở mức 40 cũ, nhánh này chưa từng chạy: bình cứu chỉ
     * còn kích hoạt qua lối tắt tự-cứu, nên Phù Thuỷ BOT không bao giờ cứu ai
     * ngoài chính mình.
     */
    witchHealTrust: 1.5,
    /**
     * Đưa về cùng thang với hai ngưỡng trên. Đo được: KHÔNG đổi kết quả nào
     * trên 800 ván - một mục tiêu vừa đủ đáng ngờ để bị độc vừa có trust ≥ 2
     * là trường hợp chưa từng xảy ra. Sửa vì ở mức 50 nó là một chốt chặn
     * không bao giờ chặn, chứ không phải vì nó đang chặn nhầm.
     */
    witchPoisonTrustVeto: 2,
  }),
});

/**
 * v6 — ngưỡng Nước thánh của Linh Mục, cùng lỗi thang đo với v5.
 *
 * LƯU Ý Task 6: Linh Mục đã bị xóa cứng (vai + strategy + hai ngưỡng). Toàn bộ
 * số đo dưới đây giữ lại làm lịch sử hiệu chỉnh, không còn khóa nào trỏ tới.
 *
 * `priestSuspicion: 95` là ngưỡng CUỐI CÙNG còn sót lại của nhóm mà v2 để lại
 * trên thang giấy, và nó hỏng theo đúng kiểu: Linh Mục không soi, nên không
 * bao giờ có mục tiêu bị ghim 100, nên bình Nước thánh chưa từng được ném
 * trong một ván thật nào.
 *
 * Nhưng con số thay thế KHÔNG phải là 5 như bình độc, vì kỹ năng này có phản
 * đòn: ném trúng Sói thì Sói chết, ném trúng Dân thì chính LINH MỤC chết còn
 * mục tiêu vẫn sống. Một phát ném ở mức chọn bừa không phải là "kém hiệu quả",
 * nó là làng tự mất một lá bài. Chú thích đầu `roles/priest.ts` đã nói ngưỡng
 * ở đây phải cao hơn bình độc; 8 so với 5 là đúng quan hệ đó, lần này trên
 * thang thật.
 *
 * Đo trên 500 ván × 2 seed base (12 người, 3 Sói, đủ Linh Mục/Phù Thuỷ/Thợ Săn):
 *
 * | ngưỡng | bình/ván | trúng Sói | mốc chọn bừa | làng thắng |
 * | ------ | -------- | --------- | ------------ | ---------- |
 * | 95 (v5)| 0.00     | -         | -            | 37.6 / 40.6 |
 * | 8      | 0.12     | 40.7 / 36.9% | ~29.7%    | 37.8 / 41.2 |
 * | 7      | 0.21     | 33.0 / 35.8% | ~29.2%    | 36.6 / 41.0 |
 * | 6      | 0.29     | 29.9 / 32.0% | ~28.4%    | 34.8 / 40.0 |
 *
 * Xuống dưới 8 là hỏng đều theo một chiều: độ chính xác tụt về đúng mốc chọn
 * bừa VÀ làng thắng đi xuống. 8 là mức duy nhất vừa nằm rõ trên mốc đó vừa
 * không lấy đi win-rate, nên nó là mức duy nhất tự trả được giá của mình.
 *
 * Cần nói thẳng một điều mà bảng trên không tự nói: 0.12 bình/ván nghĩa là
 * khoảng tám ván mới có một lần ném. Đó là HIẾM, và đó là đúng - nhưng ai đọc
 * chỉ số này để trả lời câu hỏi "vì sao BOT Linh Mục không làm gì" thì phải
 * biết trước rằng câu trả lời sẽ vẫn là "hiếm", chỉ khác là không còn "không
 * bao giờ".
 */
export const BOT_WEIGHTS_V6: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V5,
  version: "6.0.0",

  roleThresholds: Object.freeze({
    ...BOT_WEIGHTS_V5.roleThresholds,
    // Linh Mục đã bị xóa cứng ở Task 6 (vai + `roles/priest.ts` + hai ngưỡng
    // này). V6 từ đây chỉ còn là mốc số cho bình độc của Phù Thuỷ.
  }),
});

/**
 * v7 — Thằng Hề, vai TRUNG LẬP đầu tiên.
 *
 * Nhóm `jester` là nhóm DUY NHẤT đổi, và nó chỉ có tác dụng khi trên bàn thật
 * sự có một Thằng Hề. Không preset nào chứa vai này, nên mọi số liệu self-play
 * của v1-v6 vẫn so sánh được trực tiếp với v7.
 *
 * Các con số dưới đây đặt theo THANG đã biết (p90 ≈ 1.8, p99 ≈ 8.6 của
 * suspicion thật) và theo quan hệ với các ngưỡng đã đo, chứ KHÔNG qua một batch
 * quét tham số như v2/v5/v6. Cần nói thẳng điều đó ra để người hiệu chỉnh sau
 * biết chỗ nào còn dư địa.
 *
 * Thứ đã đo được (150 ván × bộ bài 9 người có Thợ Săn, một Thằng Hề mỗi ván):
 *
 * | | có Hề | không Hề |
 * | --- | --- | --- |
 * | Làng thắng | 48.0% | 51.3% |
 * | Hề bị TREO | 36.0% (54/150) | - |
 * | Hề chết vì nguyên nhân khác | 43.3% | - |
 * | Hề sống tới cuối (tức là thua) | 20.7% | - |
 * | Vi phạm bất biến | 0 | 0 |
 *
 * Hai điều bảng này nói. Thứ nhất, chiến thuật CHẠY: hơn một phần ba số ván
 * kết thúc bằng đúng cái giá treo mà Hề đi tìm, và mọi lần nó ra toà đều thành
 * bản án - nó không tự bào chữa. Thứ hai, nó KHÔNG lật cán cân: chênh lệch
 * 3.3% cho phe làng khớp với đúng thứ nó lấy đi trên bảng cân bằng, một ghế
 * Dân Làng.
 */
export const BOT_WEIGHTS_V7: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V6,
  version: "7.0.0",

  jester: Object.freeze({
    /**
     * 2.0 nhân với `trust`, trên thang belief THẬT (p90 ≈ 1.8).
     *
     * Đủ để lật thứ tự: nó át hẳn `trust.damping` (0.2) - số hạng duy nhất
     * khác trong `selectVote` có đọc `trust` - nên người được làng tin nhất
     * leo lên đầu bảng của Hề thay vì bị đẩy xuống. Không đặt cao hơn: mục
     * tiêu là một cáo buộc TRÔNG NHƯ suy luận tồi, không phải một hằng số nuốt
     * chửng mọi bằng chứng khác và biến Hề thành một cái máy bấm cùng một tên
     * suốt ván.
     */
    contrarianTrustBonus: 2,
    /**
     * 8 - trên p99 của thang suspicion (8.6) đúng một chút.
     *
     * Nó phải đủ nặng để thắng cả một nghi ngờ đã có bằng chứng: hùa theo đám
     * đông là nước đi duy nhất mà Hề tuyệt đối không được làm, vì một ngày kết
     * thúc bằng việc treo người khác là một ngày Hề mất trắng.
     */
    bandwagonPenalty: 8,
    /** Nhẹ, chỉ để phá hoà: người cả làng đã nghi thì Hề không cần chỉ thêm. */
    crowdSuspicionDamping: 1,
    /**
     * 0.5 trước khi nhân `deceptionSkill` × `riskTolerance`, tức cao hơn hẳn
     * `claim.wolfBluffChance` (0.35).
     *
     * Một con Sói khai láo là đang ĐÁNH CƯỢC: khai hớ thì chết. Hề thì ngược
     * hẳn - bị bắt bài chính là thắng, nên nó không có gì để mất khi mở miệng,
     * và một con Hề im lặng là một con Hề chắc chắn thua.
     */
    bluffChance: 0.5,
    /**
     * Vòng 1, sớm hơn Sói (vòng 2) đúng một vòng.
     *
     * Hề chỉ có chừng ấy ngày để bị treo, và mỗi đêm trôi qua là một cơ hội
     * nữa để nó chết vì một nhát cắn - cái chết KHÔNG tính cho nó. Đợi tới
     * vòng 2 là tự bỏ một phần ba số ngày của mình.
     */
    bluffFromRound: 1,
  }),
});


/**
 * v8 — Sát Nhân, vai TRUNG LẬP thứ hai và là bên thứ ba đầu tiên tranh phần
 * thắng CHUNG của ván.
 *
 * Nhóm `serialKiller` là nhóm DUY NHẤT đổi, và nó chỉ có tác dụng khi trên bàn
 * thật sự có một Sát Nhân. Không preset bộ bài nào chứa vai này, nên mọi số
 * liệu self-play của v1-v7 vẫn so sánh được trực tiếp với v8.
 *
 * Các con số đặt theo THANG đã biết (suspicion/trust thật có p90 ≈ 1.8,
 * p99 ≈ 8.6) và theo quan hệ với nhóm `roleThresholds` của Sói, chứ KHÔNG qua
 * một batch quét tham số như v2/v5/v6. Nói thẳng điều đó ra để người hiệu
 * chỉnh sau biết chỗ nào còn dư địa.
 *
 * Ba số hạng của bảng điểm đêm cố ý ĐỐI XỨNG với `threatScore` của bầy Sói
 * (`roles/werewolf.ts`): cùng đọc trust, hostility và suspicion, cùng trừ đi
 * mức nghi ngờ của làng. Hai vai có cùng một bài toán "ai nguy hiểm với tôi",
 * và giải nó bằng hai công thức khác nhau là tự chuốc lấy hai chỗ để trôi lệch.
 * Chỗ Sát Nhân KHÁC bầy Sói nằm ở mẫu số: nó không có đồng bọn để bảo vệ, nên
 * mọi người còn sống đều là mục tiêu hợp lệ - kể cả Sói.
 */
export const BOT_WEIGHTS_V8: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V7,
  version: "8.0.0",

  serialKiller: Object.freeze({
    /**
     * 1.0 - hệ số nhân của cả bảng điểm đêm, và cũng là CỔNG bật/tắt nhóm.
     *
     * Để ở 1 vì ba trọng số dưới đã nằm sẵn trên thang belief thật; nhân thêm
     * chỉ làm mờ quan hệ giữa chúng.
     */
    nightThreatWeight: 1,
    /**
     * 1.5 - lớn hơn hẳn `wolfSuspicionDiscount` của bầy Sói (xem
     * `roleThresholds`), và có lý do.
     *
     * Bầy Sói bỏ qua người bị nghi vì làng sẽ treo họ hộ. Sát Nhân có ĐÚNG lý
     * do đó CỘNG THÊM một lý do nữa: mỗi cái chết ban ngày là một người bớt đi
     * mà nó không phải trả giá bằng một đêm, và bàn càng nhỏ thì nó càng gần
     * đích. Vì vậy nó tránh mục tiêu "đang bị nghi" mạnh tay hơn.
     */
    nightSuspicionDiscount: 1.5,
    /**
     * 2.0 - số hạng nặng nhất, cùng mốc với `jester.contrarianTrustBonus`.
     *
     * Người được làng tin là người duy nhất làng sẽ KHÔNG treo, nên họ là
     * người duy nhất Sát Nhân buộc phải tự tay xử lý. Đây cũng là chỗ chiến
     * thuật "giảm sức mạnh bên đang dẫn trước" thật sự nằm: bên đang dẫn là
     * bên có người được tin nhất trên bàn, và Sát Nhân đọc điều đó từ hành vi
     * công khai chứ không từ một bảng vai mà nó không có.
     */
    nightTrustWeight: 2,
    /**
     * 1.2 - nhẹ hơn trust một chút.
     *
     * Bị công kích là một tín hiệu THẬT nhưng ồn: một lời tố lẻ ở vòng 2 không
     * đáng bằng cả làng dựa vào ai đó ở vòng 4. Nó chỉ được phá hoà, không được
     * tự mình chọn nạn nhân.
     */
    nightHostilityWeight: 1.2,
    /**
     * 0.25 trước khi nhân `riskTolerance` - thấp có chủ đích.
     *
     * Một đêm bình yên là một đòn đánh lừa đắt: nó tiêu mất đúng cái tài nguyên
     * mà vai này chỉ có mỗi đêm một lần. Ở mức này nó xảy ra vài lần trong một
     * batch chứ không thành thói quen, đủ để làng không đọc được nhịp.
     */
    quietNightChance: 0.25,
    /**
     * Vòng 3. Hai đêm đầu luôn ra tay: bàn còn đông nên một đêm bỏ trống gần
     * như không đổi được gì, trong khi hai mạng đầu là hai bước thật về đích.
     */
    quietNightFromRound: 3,
    /**
     * 3 - trên p90 của thang suspicion, dưới p99.
     *
     * Đủ để kéo Sát Nhân về phía đám đông trong phần lớn trường hợp, nhưng
     * KHÔNG đủ để nuốt một nghi ngờ đã có bằng chứng cứng: một kẻ luôn bấm theo
     * số đông bất kể lý lẽ cũng là một kẻ dễ đọc. Ngược dấu và nhẹ hơn
     * `jester.bandwagonPenalty` (8), đúng như hai vai chơi ngược nhau.
     */
    bandwagonBonus: 3,
    /**
     * 4 - trừ vào chính nạn nhân đêm qua của mình.
     *
     * Trường hợp này chỉ xảy ra khi nhát dao bị chặn (khiên, bình cứu), tức là
     * người đó SỐNG và Sát Nhân là người duy nhất trên bàn biết vì sao. Chỉ tay
     * vào họ ngay hôm sau là tự khai ra rằng mình biết một chuyện không ai
     * biết - đúng loại sơ hở mà mô hình uy tín của làng sinh ra để bắt.
     */
    avoidOwnVictimWeight: 4,
  }),
});

/**
 * v9 - Kẻ Báo Thù, vai TRUNG LẬP thứ ba.
 *
 * Nhóm `executioner` là nhóm DUY NHẤT đổi, và nó chỉ có tác dụng khi trên bàn
 * thật sự có một Kẻ Báo Thù. Không preset bộ bài nào chứa vai này, nên mọi số
 * liệu self-play của v1-v8 vẫn so sánh được trực tiếp với v9.
 *
 * Cùng cách đặt số với v8 và cùng lời cảnh báo: các con số đặt theo THANG đã
 * biết (suspicion/trust thật có p90 ≈ 1.8, p99 ≈ 8.6) và theo quan hệ với hai
 * nhóm trung lập kia, chứ KHÔNG qua một batch quét tham số. Nói thẳng điều đó
 * ra để người hiệu chỉnh sau biết chỗ nào còn dư địa.
 */
export const BOT_WEIGHTS_V9: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V8,
  version: "9.0.0",

  executioner: Object.freeze({
    /**
     * 6 - nặng, và nặng có chủ đích.
     *
     * Đây là ĐÒN BẨY DUY NHẤT của cả vai: không lượt đêm, không thông tin, chỉ
     * một lá phiếu và một ngày để lái nó. Con số nằm giữa p90 (1.8) và p99
     * (8.6) của thang suspicion - đủ để mục tiêu leo lên đầu bảng khi bàn chưa
     * có ai nổi bật, nhưng KHÔNG đủ để nuốt một kết quả soi đã ghim 100. Một
     * Kẻ Báo Thù bỏ qua cả một con Sói đã lộ mặt để chỉ vào mục tiêu của mình
     * là một Kẻ Báo Thù bị đọc vị trong đúng một vòng.
     */
    targetPush: 6,
    /**
     * 1.5 - nhỏ hơn `targetPush` bốn lần.
     *
     * Nó chỉ nghiêng bàn về phía mục tiêu khi hai ứng viên đang ngang nhau; nó
     * không được biến BOT thành người bênh vực mọi bị cáo.
     */
    othersDamping: 1.5,
    /**
     * 1.0 - nhân với `trust` của chính mục tiêu.
     *
     * Ở mức này, một mục tiêu đã được Tiên Tri soi sạch (trust ghim 100) kéo
     * `targetPush` xuống âm sâu, tức BOT tạm buông - đúng nước đi đúng, vì chỉ
     * vào người vừa được bảo lãnh công khai là tự nộp mình. Với một mục tiêu
     * chưa ai để ý (trust ≈ 0) thì số hạng này gần như không tồn tại.
     */
    protectedTargetPenalty: 1,
  }),
});

/**
 * Cấu hình v10 - hạ ngưỡng tha bổng để phiên toà thôi là một vụ hành quyết.
 *
 * MỘT giá trị đổi: `spareTrustMargin` 3 -> 0.
 *
 * Vấn đề nó sửa, đo ở n=12 với 900 ván: bị cáo bị treo **100.0%** số lần, và
 * 18% số phiên toà không có MỘT lá phiếu đề cử nào mang bằng chứng. Luật biểu
 * quyết là `guilty = trust < suspicion + spareTrustMargin` (`trial-decision.ts`),
 * mà thang suspicion thật có p50 = 0 và p90 = 1.8 - nên với ngưỡng 3, một bị
 * cáo trung bình (suspicion ~ 0-2, trust 0) luôn thoả `0 < 3`. Tha chỉ xảy ra
 * khi có kết quả soi ghim trust lên cao. "Treo, trừ khi có lý do tích cực để
 * tin là vô tội" - chủ ý của bản gốc - đã trôi thành "treo tất, trừ người được
 * Tiên Tri bảo lãnh".
 *
 * Hệ quả nặng nhất là LỜI BÀO CHỮA MẤT HẲN GIÁ TRỊ, và điều đó suy được bằng số
 * học chứ không cần đo: lời khai lúc đang bị xử luôn là `underFire`, nên nó ăn
 * `underFireFactor` 0.25 lên `claimantTrustWeight` 6, rồi qua `confidence` 0.5
 * và quán tính của `updateBelief`:
 *
 *   delta_trust = 6 x 0.25 x 0.5 x (1 - inertia x 0.5),  inertia thuộc [0.35, 0.80]
 *               = 0.45 ... 0.62
 *
 * Một lời bào chữa cấp tối đa 0.62 điểm tin tưởng, đứng trước một ngưỡng 3.0.
 * Nó KHÔNG BAO GIỜ đổi được một lá phiếu, dù bị cáo nói gì.
 *
 * Số đo, `speech: true`, 300 ván mỗi ô (cột phải là v10):
 *
 *   n  | làng        | tỉ lệ treo    | treo trúng Sói | khai vai -> bị treo
 *    8 | 48.3 -> 50.3 | 100.0 -> 71.0 | 44.2 -> 53.3  | 100.0 -> 61.9
 *   10 | 67.0 -> 62.7 |  99.9 -> 76.7 | 45.2 -> 50.5  | 100.0 -> 64.6
 *   11 | 36.3 -> 40.3 | 100.0 -> 78.4 | 45.0 -> 50.2  | 100.0 -> 66.7
 *   12 | 71.7 -> 72.3 | 100.0 -> 79.4 | 37.4 -> 43.3  | 100.0 -> 66.2
 *   13 | 51.0 -> 48.3 | 100.0 -> 83.9 | 40.6 -> 44.5  | 100.0 -> 72.8
 *   15 | 55.0 -> 59.0 | 100.0 -> 84.6 | 37.2 -> 42.3  | 100.0 -> 70.9
 *
 * Ba điều không có ngoại lệ nào trong sáu cỡ phòng:
 *
 * 1. **Tỉ lệ thắng của phe làng KHÔNG đổi**: Δ +2.0, -4.3, +4.0, +0.6, -2.7,
 *    +4.0 - trung bình +0.6, không có hướng. Đây là thứ làm bản này rẻ: nó
 *    không phải một cuộc đánh đổi giữa cân bằng và trải nghiệm.
 * 2. **Treo trúng Sói tăng ở mọi cỡ phòng**, +3.9 tới +9.1 điểm.
 * 3. **Lời khai vai bắt đầu cứu được người**: chênh lệch giữa bị cáo có khai và
 *    không khai đi từ 0 điểm (100% với 100%, ở mọi cỡ phòng) lên 20-28 điểm.
 *    Mô hình uy tín lời khai của `claim-credibility.ts` vốn đã chạy đúng; ngưỡng
 *    3 chỉ đang đặt cao hơn tầm với của nó.
 *
 * KHÔNG hạ tiếp xuống âm. Sweep tới -5 ở n=12 cho tỉ lệ treo 46.7% và làng tụt
 * còn 67.3%: dưới một mức nào đó, làng không treo đủ để thắng nữa. 0 là chỗ tỉ
 * lệ treo rời khỏi 100% mà tỉ lệ thắng chưa nhúc nhích.
 *
 * CẢNH BÁO khi đọc lại bảng trên: harness self-play KHÔNG chạy pha DEFENSE
 * (`runSelfPlay` đi thẳng `resolveNomination` -> `beginFinalVote`), nên cột
 * "khai vai" đếm lời khai BAN NGÀY chứ không phải lời tự bào chữa. Con số 20-28
 * điểm vì thế là CẬN DƯỚI của hiệu ứng thật trong phòng người chơi.
 */
export const BOT_WEIGHTS_V10: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V9,
  version: "10.0.0",

  /**
   * Kẻ Phản Bội - xem `roles/traitor.ts` cho lập luận của hai số hạng.
   *
   * 1.5 và 1.2, đọc trên thang belief THẬT (p90 ≈ 1.8), tức cùng bậc với
   * `jester.contrarianTrustBonus` (2.0) và cố ý NHẸ HƠN nó. Lý do: Thằng Hề
   * cần bị nhìn thấy, còn Kẻ Phản Bội cần KHÔNG bị nhìn thấy. Một thiên vị đủ
   * mạnh để lật bảng điểm sẽ khiến nó bỏ phiếu lệch khỏi cả làng mỗi ngày, và
   * hai ngày như vậy là đủ để bị đọc ra.
   */
  traitor: Object.freeze({
    suspectShield: 1.5,
    trustedTargetBonus: 1.2,
  }),

  confidence: Object.freeze({
    ...BOT_WEIGHTS_V9.confidence,
    spareTrustMargin: 0,
  }),
});

/**
 * Cấu hình v11 - bot bắt đầu đọc hai tín hiệu mà người chơi thật vẫn đọc.
 *
 * HAI ô đổi, cả hai từ 0 lên một giá trị dương: `evidence.AVOIDANCE` và
 * `evidence.DEFENSE_QUALITY`. Bản này tồn tại vì bot được tune bằng self-play
 * bot-vs-bot, và gặp người thì bị chê "ngu" theo cùng một cách: nó không nhận
 * ra người né tránh suốt ba vòng, và không nhận ra một bị cáo im lặng hay chỉ
 * biết chỉ sang người khác khi bị đưa lên xử.
 *
 * - `AVOIDANCE: 2` = 0.5 x `BANDWAGON` (4). Né tránh là tín hiệu YẾU HƠN theo
 *   đuôi: theo đuôi là một hành động, né tránh là sự vắng mặt của hành động,
 *   và người chơi mới cũng né. Confidence 0.4 - dưới `ACCUSE`, ngang
 *   `VOTE_ALIGNMENT`.
 * - `DEFENSE_QUALITY: 2` = 0.5 x `ACCUSE` (4). Nhẹ vì đây là bằng chứng về
 *   CÁCH nói chứ không phải về nội dung, và một người mới chơi cũng im lặng
 *   khi bị dồn. Confidence 0.45 - bằng `ACCUSE`.
 *
 * Cả hai đọc trên thang belief THẬT (p90 ≈ 1.8): một mảnh cộng vào khoảng
 * 0.5-0.6 sau confidence và quán tính, tức đủ để phá hoà giữa hai ứng viên
 * ngang nhau, không đủ để tự mình đưa ai lên giá treo cổ.
 *
 * Self-play KHÔNG đo được `DEFENSE_QUALITY`: harness đi thẳng từ
 * `resolveNomination` sang `beginFinalVote`, không có pha DEFENSE, nên không
 * có cửa sổ bào chữa nào để chấm. Ô đó chỉ chạy trong phòng thật.
 */
export const BOT_WEIGHTS_V11: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V10,
  version: "11.0.0",

  evidence: freezeEvidenceTable({
    ...BOT_WEIGHTS_V10.evidence,
    AVOIDANCE: { weight: 2, confidence: 0.4 },
    DEFENSE_QUALITY: { weight: 2, confidence: 0.45 },
  }),
});

/**
 * Cấu hình v12 - bot nhớ ai đã từng khai láo.
 *
 * MỘT ô đổi: `claim.knownBluffPenalty` 0 -> 1.2.
 *
 * 1.2 = 0.2 x `claimantTrustWeight` (6): hệ số khởi đầu NHỎ có chủ ý. Nó
 * nhân với `bluffRate` (0..1) và `profileStrength` (một mẫu: 1/3, ba mẫu:
 * 3/5), nên một người bị bắt quả tang khai láo đúng một lần mất 0.4 trong 6
 * điểm thưởng tin cậy khi khai lại - còn khai lúc đang bị dồn phiếu (thưởng
 * chỉ 1.5) thì mất hơn một phần tư. Ba lần thì mất 0.72. Không bao giờ lật
 * dấu: `Math.max(0, ...)` ở S1.
 *
 * Trong ván, hồ sơ bluff chỉ có mẫu khi vai được kiểm chứng: `revealRoleOnDeath`
 * bật, kết quả soi của chính bot, hoặc Sói nhìn đồng bọn. Nghĩa là ở luật mặc
 * định, ô này chủ yếu có tác dụng với BOT Tiên Tri - và với hồ sơ qua nhiều
 * ván do server nạp sau này.
 */
export const BOT_WEIGHTS_V12: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V11,
  version: "12.0.0",

  claim: Object.freeze({
    ...BOT_WEIGHTS_V11.claim,
    knownBluffPenalty: 1.2,
  }),
});

/**
 * Cấu hình v13 - hồ sơ người chơi nguội chậm hơn sự kiện.
 *
 * MỘT ô đổi: `recency.profileDecayPerRound` 1 -> 0.93.
 *
 * Belief nguội 0.85/vòng: sau ba vòng còn 61%, sau năm vòng còn 44% - đúng
 * cho một lá phiếu muộn hay một lời tố, những thứ mà ván đấu đã đi qua. Hồ sơ
 * nguội 0.93/vòng: sau năm vòng còn 70%. Một người bị bắt quả tang khai láo
 * ở vòng 2 vẫn là một người đáng ngờ khi khai lại ở vòng 6, dù mọi bằng
 * chứng của vòng 2 đã phai gần hết. Đó là cái "nhớ người" mà bot thiếu.
 *
 * Nguội cả `samples` (sức nặng) lẫn tỉ lệ (kéo về trung tính), cùng hệ số,
 * và chỉ trên tuổi tính từ `lastUpdatedRound` - gọi hai lần một vòng không
 * nguội gấp đôi, cùng cơ chế với `decayEntry`.
 */
export const BOT_WEIGHTS_V13: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V12,
  version: "13.0.0",

  recency: Object.freeze({
    ...BOT_WEIGHTS_V12.recency,
    profileDecayPerRound: 0.93,
  }),
});

/**
 * Cấu hình v14 - Tiên Tri giấu kết quả khi bàn có người thật.
 *
 * MỘT ô đổi: `deceptionRisk.seerRevealRoundHuman` 0 -> 2.
 *
 * `seerRevealRound` (bàn toàn bot) vẫn là 0, vì lý do v2 đã đo: trong quần thể
 * bot, thông tin của Tiên Tri lan quá chậm để một đêm sống thêm bù lại được
 * (giấu tới vòng 2 mất 4 điểm win-rate). Trước người thật thì ngược lại - từ
 * blind test: Tiên Tri bot hô kết quả ngày 1 và chết đêm 2 gần như mọi ván,
 * vì người thật đọc chat và cắn đúng nó. 2 = khai từ ngày 2 (engine đếm
 * `round` tăng mỗi đêm, nên ngày 1 là `round 1`): Tiên Tri có hai kết quả
 * soi trong tay khi mở miệng, và lời khai của nó nặng gấp đôi.
 *
 * Self-play KHÔNG đo được ô này: mọi ghế trong harness là bot, nên
 * `countHumansAlive` luôn 0 và nhánh không bao giờ mở. Đó là chủ ý - win-rate
 * self-play của v14 phải bằng v13 từng bit.
 */
export const BOT_WEIGHTS_V14: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V13,
  version: "14.0.0",

  deceptionRisk: Object.freeze({
    ...BOT_WEIGHTS_V13.deceptionRisk,
    seerRevealRoundHuman: 2,
  }),
});

/**
 * Cấu hình v15 - Phù Thuỷ và Linh Mục thôi ôm bình khi làng đã mỏng.
 *
 * HAI ô đổi: `roleThresholds.witchPoisonLosingDiscount` 0 -> 1 và
 * `roleThresholds.witchHealLosingDiscount` 0 -> 0.5.
 *
 * Từ blind test: Phù Thuỷ bot giữ cả hai bình tới khi ván kết thúc trong phần
 * lớn ván có người thật - ngưỡng 5 (p99 của thang belief) là đúng cho nửa
 * đầu ván, nhưng ở nửa sau, khi mỗi đêm mất một người là mất một phần năm
 * làng, một bình còn nguyên lúc GAME_OVER có giá trị bằng 0.
 *
 * Chiết khấu chỉ mở khi `sống <= tổng / 2` (`thinVillageShare`), và chỉ hạ
 * ngưỡng một nấc: độc 5 -> 4, Nước thánh 8 -> 7, cứu 1.5 -> 1.0. Cả ba mức
 * hạ đều còn nằm trên mốc chọn bừa theo bảng đo ở v5/v6 (độc ở 4: 25.5% so
 * với ~23% bừa; Nước thánh ở 7: 33-36% so với ~29%) - và ở làng mỏng mốc
 * chọn bừa còn cao hơn vì tỉ lệ Sói trên đầu người đã tăng. Không ép xài:
 * nghi 0 vẫn giữ bình. Không rút RNG: `isThinVillage` là một phép đếm.
 */
export const BOT_WEIGHTS_V15: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V14,
  version: "15.0.0",

  roleThresholds: Object.freeze({
    ...BOT_WEIGHTS_V14.roleThresholds,
    witchPoisonLosingDiscount: 1,
    witchHealLosingDiscount: 0.5,
  }),
});

/**
 * Cấu hình v16 - Sói diễn: cãi nhau giả ở vòng 1-2, bán đồng đội sớm hơn
 * trước người thật.
 *
 * HAI ô đổi: `deceptionRisk.fakeFightChance` 0 -> 0.3 và
 * `deceptionRisk.bussingVoteShareHuman` 0.2 -> 0.15.
 *
 * - Cãi giả: 0.3 x `deceptionSkill` (0.25..0.9) = 7-27% mỗi vòng cho đúng
 *   một ghế trong bầy, và chỉ khi chưa ai bầu hay công kích con Sói nào. Giá
 *   là một lá phiếu vào đồng bọn giữa lúc không ai khác bầu nó - gần như
 *   không bao giờ đủ để đưa lên xử - đổi lấy một cặp Sói có lịch sử từng nghi
 *   nhau. Số hạng `fakeFight` = 0.3 x `bussingJoinBonus` (36): đủ để thắng
 *   `trustDamping` (-20) của một đồng bọn bị ghim trust 100 khi bàn còn phẳng,
 *   không đủ để át một người đang bị cả bàn công kích (`hostility` x 20).
 * - Bán mềm: chỉ đổi khi `isHumanTable`, tức self-play (toàn bot) không đo
 *   được và cũng không bị ảnh hưởng.
 *
 * Self-play chỉ đo được vế cãi giả. Không rút RNG ở cả hai: cãi giả chốt bằng
 * hash trên (bầy, vòng, deceptionSkill) nên hai lần hỏi trong cùng vòng cho
 * cùng đáp án - con Sói không tự mâu thuẫn giữa lượt thảo luận và lượt bầu.
 */
export const BOT_WEIGHTS_V16: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V15,
  version: "16.0.0",

  deceptionRisk: Object.freeze({
    ...BOT_WEIGHTS_V15.deceptionRisk,
    fakeFightChance: 0.3,
    bussingVoteShareHuman: 0.15,
  }),
});

/**
 * Cấu hình v17 - phiếu dính hơn trước một mục tiêu đang nói nhiều.
 *
 * MỘT ô đổi: `confidence.talkerHysteresisBonus` 0 -> 2.
 *
 * Hysteresis thường là `2 + stubbornness x 3` (2.75..4.7 trên thang belief).
 * Cộng 2 khi mục tiêu đang bầu đã nói >= 3 câu trong vòng: một cú lật trước
 * người vừa bào chữa ba câu cần chênh lệch gần gấp rưỡi, còn một kết quả soi
 * (ghim 100) hay một cáo buộc dồn dập (hostility x 20) vẫn lật được như cũ.
 * `thresholdBase` không đổi.
 *
 * Đếm "câu" bằng số message của người đó sinh ra memory trong vòng
 * (`linesSpokenThisRound`): `visibleChat` không mang số vòng, còn memory thì
 * có - và một người nói ba câu mà parser không hiểu câu nào thì cũng không
 * phải người "đang thuyết phục" theo nghĩa bàn nhìn thấy.
 */
export const BOT_WEIGHTS_V17: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V16,
  version: "17.0.0",

  confidence: Object.freeze({
    ...BOT_WEIGHTS_V16.confidence,
    talkerHysteresisBonus: 2,
  }),
});

/**
 * Cấu hình v18 - bonus "nói nhiều" không áp lên người vừa có bằng chứng gỡ tội.
 *
 * MỘT ô đổi: `confidence.talkerHysteresisExculpatedScale` 1 -> 0.
 *
 * v17 cộng +2 hysteresis khi mục tiêu đang bầu đã nói >= 3 câu, để một cú lật
 * vì nhiễu không xảy ra ngay sau khi người đó vừa bào chữa. Nhưng nó đếm câu
 * chứ không đọc nội dung: kịch bản có kiểm soát (`tests/bot-persuasion.test.ts`)
 * cho thấy người bị bầu nói ba câu CÓ bằng chứng (khai Bảo Vệ, được bênh) làm
 * điểm mình giảm ~1.4 nhưng bị dính thêm +2 - nói có căn cứ lại khó thoát phiếu
 * hơn im lặng. Ở v18 bonus bị nhân 0 khi `suspicion[target]` có một reason
 * weight âm sinh trong vòng này; ba câu "tôi là dân" hay ba câu phản công vô
 * căn cứ không sinh reason âm nào nên vẫn dính như v17.
 *
 * Không đổi ngưỡng, không đổi bonus, không đổi cách đếm câu.
 */
export const BOT_WEIGHTS_V18: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V17,
  version: "18.0.0",

  confidence: Object.freeze({
    ...BOT_WEIGHTS_V17.confidence,
    talkerHysteresisExculpatedScale: 0,
  }),
});

/**
 * Cấu hình v19 - dân làng thôi bịa cáo buộc khi bảng belief còn trống.
 *
 * MỘT ô đổi: `aggression.villageAbstainPressureCeiling` 0 -> 0.25.
 *
 * KHÔNG PHẢI mặc định. `DEFAULT_BOT_WEIGHTS` vẫn là v18, và chú thích dưới đây
 * là lý do - đo trước, đổi sau.
 *
 * Vấn đề nó sửa là có thật: nhánh "không treo ai" trong `selectVote` bị khoá
 * sau `selfIsWolf`, còn trần của Sói về 0 từ v2, nên trước v19 KHÔNG BOT NÀO
 * bỏ phiếu trắng trong bất kỳ tình huống nào. Một BOT có bảng belief hoàn toàn
 * rỗng vẫn nêu tên người dẫn đầu, mà người dẫn đầu khi mọi điểm bằng nhau là
 * do jitter chọn. Bàn đọc ra điều đó ngay vòng 1.
 *
 * CÁI GIÁ, đo trên 300 ván, 8 người, bộ bài chuẩn, seed `abstain-bench`:
 *
 * | | v18 | v19 |
 * |---|---|---|
 * | làng thắng | 48.7% (146/300) | 36.3% (109/300) |
 * | voteAccuracy làng | 45.0% | 38.8% |
 * | tổng phiếu làng | 3837 | 3468 |
 *
 * -12.3 điểm, khoảng 4 sigma - không phải nhiễu. 369 lá phiếu biến thành phiếu
 * trắng, và độ chính xác của số phiếu CÒN LẠI cũng tụt: đúng vòng lặp chết mà
 * `decideFinalVote` đã ghi. Không ai bị treo ở vòng 1 nghĩa là không có lịch sử
 * phiếu, nghĩa là `vote-analysis` không có gì để đọc ở vòng 2.
 *
 * Hạ trần KHÔNG làm nó rẻ hơn: 0.25, 0.2 và 0.15 cho ra ba kết quả GIỐNG HỆT
 * nhau (36.3% / 38.8% / 3468). Ở bàn 8 người mọi lá phiếu trắng đều rơi vào lúc
 * 0-1 người chết, nên knob này gần như nhị phân - hoặc dân làng được bỏ trắng ở
 * vòng bầu đầu, hoặc không. Giữ 0.25 vì nó phát biểu rõ nhất ("tới một phần tư
 * bàn đã chết") và cùng thang với `abstainPressureCeiling` của Sói.
 *
 * Vậy dùng khi nào: khi ưu tiên là bàn có NGƯỜI THẬT và cái đang mua là sự
 * đáng tin của lời BOT nói, chứ không phải win-rate trong harness toàn bot.
 * Số đo trên là bàn 8 bot; nó không đo được cái giá của một cáo buộc vô căn cứ
 * trước mặt người chơi.
 *
 * Điều KHÔNG đổi, và đó là bài học đắt nhất của v2 được giữ lại: bằng chứng
 * mỏng-nhưng-có-thật vẫn phải ra một cái tên. Chỉ RỖNG mới được bỏ trắng.
 */
export const BOT_WEIGHTS_V19: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V18,
  version: "19.0.0",

  aggression: Object.freeze({
    ...BOT_WEIGHTS_V18.aggression,
    villageAbstainPressureCeiling: 0.25,
  }),
});

/**
 * Cấu hình v20 - look-ahead một bước cho phiếu của nhánh làng.
 *
 * MỘT nhóm mới: `lookAhead` (v18 KHÔNG có nhóm này nên byte-identical).
 *
 * BỊ THAY BỞI v21: khi preset khai nhóm `counterfactual`, planner
 * counterfactual (ba term named, dùng belief xác suất PR 1) THAY planner này —
 * chỉ một lớp counterfactual tại một thời điểm, nếu chồng nhau là đếm đôi.
 * v20 giữ nguyên làm mốc A/B của term `futureRisk` gộp.
 *
 * Số hạng `futureRisk` trả lời câu hỏi mà bảng điểm myopic bỏ sót (spec
 * BOT_AI_UPGRADE §12): "treo người này, nếu họ vô tội, pha sau làng trả giá
 * bao nhiêu?". Hai thành phần:
 *
 * - áp lực sĩ số (`mislynchPressureScale`): càng cuối ván, một án treo nhầm
 *   càng đắt vì làng ít mạng hơn. Đây là dạng lặp của `survivalPressure` mà
 *   `selectVote` đã dùng cho cổng abstain - dùng lại cùng một phép đo.
 * - độ khan hiếm bằng chứng (`mislynchScarcityScale`): tỉ lệ người còn sống
 *   khác đang có bảng belief TRỐNG. Làng sắp hết "nguồn dữ liệu" thì án treo
 *   phải bám vào người CÓ bằng chứng, không phải người nổi đầu nhờ jitter.
 *
 * Phạt = −scale x (1 − P(Sói)) x (áp lực + khan hiếm), CHỈ áp cho nhánh làng;
 * `wolfMislynchGain = 0` ở v20 nên bảng điểm Sói không đổi một bit.
 *
 * KHÔNG mặc định. `DEFAULT_BOT_WEIGHTS` vẫn là v18 cho đến khi bench ≥1.000
 * ván (spec §21) không tụt — cùng kỷ luật với v19 ngay trên.
 */
export const BOT_WEIGHTS_V20: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V18,
  version: "20.0.0",

  lookAhead: Object.freeze({
    mislynchPressureScale: 6,
    mislynchScarcityScale: 4,
    wolfMislynchGain: 0,
  }),
});

/**
 * Cấu hình v21 - counterfactual một bước CÓ CẤU TRÚC (CONTINUE §10/§11/§35).
 *
 * NÂNG CẤP v20: thay term `futureRisk` gộp bằng ba thành phần named, mỗi thành
 * phần một câu trả lời riêng:
 *
 * - `teamValue` (MỚI so v20): giá trị kỳ vọng ròng của một án treo —
 *   `teamValueGain × P(Sói)` trừ phần "treo nhầm người được làng tin". Đúng
 *   hình dạng §11: predicted outcome → next-phase evaluation, dùng XÁC SUẤT
 *   từ projection PR 1 chứ không dùng raw suspicion.
 * - `survivalValue` (= v20 mislynchPressureScale, đổi tên): mất một GHẾ khi
 *   làng đã mỏng thì càng đắt.
 * - `informationValue` (= v20 mislynchScarcityScale, mở rộng): mất một NGUỒN
 *   DỮ LIỆU (người có evidence reasons) khi làng khan bằng chứng.
 *
 * Sói vẫn `wolfSideGain = 0` — byte-identical với v18, nhánh Sói là PR 5.
 *
 * KHÔNG mặc định cho tới khi bench ≥1.000 ván không tụt (kỷ luật v19/v20).
 */
export const BOT_WEIGHTS_V21: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V18,
  version: "21.0.0",

  counterfactual: Object.freeze({
    teamValueGain: 5,
    mislynchSurvivalCost: 6,
    evidenceLossCost: 4,
    wolfSideGain: 0,
  }),
});

/**
 * Cấu hình v22 - counterfactual cho NHÁNH SÓI (PR 5b, CONTINUE §14-§17).
 *
 * MỘT ô đổi so v21: `counterfactual.wolfSideGain` 0 → 5.
 *
 * Nhánh Sói giờ có expectedOutcome thật, đo bằng bảng belief PR 1 (đồng bọn
 * ghim P=1 qua KNOWN_ALLY, người thường theo scalar — mọi số đều từ knowledge
 * view mà Sói hợp pháp thấy):
 *
 * - `teamValue = wolfSideGain × P(người không-Sói) × pressure`: bỏ phiếu người
 *   làng khi làng còn đông-thêm-được đưa Sói gần hoà số hơn.
 * - `survivalValue = −mislynchSurvivalCost × P(Sói) × pressure`: phiếu vào
 *   người có P(wolf) cao là rủi ro bộc lộ; tệ nhất là vào ĐỒNG BỌN (P=1).
 * - `informationValue = 0`: mất nguồn dữ liệu làng là tác dụng phụ, không phải
 *   lợi ích Sói được thưởng trực tiếp.
 *
 * KHÔNG mặc định — bench v22 so v21 trước, kỷ luật v19.
 */
export const BOT_WEIGHTS_V22: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V21,
  version: "22.0.0",

  counterfactual: Object.freeze({
    ...BOT_WEIGHTS_V21.counterfactual!,
    wolfSideGain: 5,
  }),
});

/**
 * Cấu hình v23 - SPEAK vs WAIT có chủ đích (COMMUNICATION §11, §12).
 *
 * MỘT ô đổi so v21: `conversation.urgencyBoost` 0 -> 0.35.
 *
 * Trước v23, cổng tự mở lời là đúng một dòng - `rng() > talkativeness` - nên
 * một con BOT vừa nhặt được bằng chứng mới và một con BOT không còn gì để nói
 * im lặng ngang nhau. Từ v23, ngưỡng đó được cộng thêm `urgencyBoost x
 * speechUrge(...)`, trong đó `speechUrge` gom bốn lý do nên nói (bằng chứng
 * chưa nói, áp lực đang dồn vào mình, câu hỏi còn nợ, bị cả bàn bỏ quên) và trừ
 * hai lý do không nên (đã nói đủ phần trong vòng, đang cầm trịch cả bàn).
 *
 * KHÔNG thêm một lượt rút nào: `speechUrge` là hàm thuần, và với
 * `urgencyBoost = 0` biểu thức quy về đúng ngưỡng cũ. Đó là lý do v1..v22
 * replay từng bit qua thay đổi này.
 *
 * KHÔNG mặc định - bench v23 so v21 trước, kỷ luật v19.
 */
export const BOT_WEIGHTS_V23: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V21,
  version: "23.0.0",

  conversation: Object.freeze({
    ...BOT_WEIGHTS_V21.conversation,
    urgencyBoost: 0.35,
  }),
});

/**
 * Cấu hình v24 - chiến lược trả lời câu hỏi (COMMUNICATION §13, §14).
 *
 * MỘT ô đổi so v23: `conversation.questionIgnoreFloor` 0 -> 0.45.
 *
 * Chồng LÊN v23 chứ không lên v21: hai PR nói về cùng một thứ - bot chọn nói gì
 * khi bị nói tới - và tách chúng thành hai nhánh song song thì không bản nào
 * đo được cả cụm. v23 vẫn là mốc A/B cho riêng SPEAK/WAIT.
 *
 * Trước v24, một câu hỏi nhắm vào BOT chỉ có hai đường ra (`REPLY` hoặc
 * `ASK_EVIDENCE`) chọn theo đúng một trait, nên "mày là sói phải ko" và "nghi
 * ai nhất" nhận cùng một cách xử. Từ v24, câu hỏi được `chat-analysis` gắn
 * nhãn lúc parse (7 loại) và `question-policy` chọn một trong 7 cách đáp.
 *
 * Hai luật cứng đi kèm, cả hai đều là luật AN TOÀN chứ không phải hiệu chỉnh:
 *
 * - Bị hỏi vai mà CHƯA khai thì không bao giờ trả lời thẳng. Lời khai là quyết
 *   định của `decideChatClaim`; để một câu hỏi moi được nó ra là giao nước đi
 *   nặng nhất của lời nói cho đối thủ.
 * - `IGNORE` là một kết quả hợp lệ. Spec §28 nói thẳng: đừng tối ưu tỉ lệ trả
 *   lời lên 100%.
 *
 * KHÔNG mặc định - bench v24 so v21 trước, kỷ luật v19.
 */
export const BOT_WEIGHTS_V24: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V23,
  version: "24.0.0",

  conversation: Object.freeze({
    ...BOT_WEIGHTS_V23.conversation,
    questionIgnoreFloor: 0.45,
  }),
});

/**
 * Cấu hình đang dùng cho production.
 *
 * Mọi API nhận `weights` đều mặc định về hằng số này, nên không call site nào
 * phải thay đổi chỉ vì cấu hình tồn tại - đây là cơ chế rollout: nâng
 * `DEFAULT_BOT_WEIGHTS` lên bản mới, và mọi `new BotRuntime({...})` không tự
 * truyền `weights` (bao gồm `session-registry.ts`, chỗ ván thật dựng runtime)
 * lập tức chạy bản mới mà không phải sửa. v5.0.0 và v6.0.0 đưa ngưỡng của ba
 * vai có quyền năng dùng-một-lần (Phù Thuỷ, Thợ Săn, Linh Mục) về thang belief
 * thật; v7.0.0 bật hành vi của Thằng Hề; v8.0.0 bật hành vi của Sát Nhân;
 * v9.0.0 bật hành vi của Kẻ Báo Thù; v10.0.0 hạ `spareTrustMargin` về 0 để
 * phiên toà thôi kết án 100% bị cáo và để lời khai vai có sức nặng; v11.0.0
 * bật hai tín hiệu né tránh và bào chữa kém; v12.0.0 trừ sẵn tin cậy của
 * người đã từng khai láo; v13.0.0 cho hồ sơ nguội chậm hơn belief; v14.0.0
 * cho Tiên Tri giấu kết quả tới ngày 2 khi bàn có người thật; v15.0.0 hạ
 * ngưỡng bình độc/bình cứu/Nước thánh một nấc khi làng đã mỏng; v16.0.0 cho
 * Sói cãi nhau giả ở vòng 1-2 và bán đồng đội sớm hơn trước người thật;
  * v17.0.0 cho phiếu dính hơn trước mục tiêu đang nói nhiều; v18.0.0 bỏ phần
  * dính thêm đó trước người vừa có bằng chứng gỡ tội mới.
  * v21.0.0 (CONTINUE PR 3) bật counterfactual một bước cho phiếu nhánh làng:
  * protocol 5×1.000 ván paired seeds đo được villageWR 51.98% → 54.04%
  * (+2,06 điểm, z=2,06) và villageVoteAccuracy 44.86% → 48.88% (+4,02 điểm,
  * z=14,35), không batch nào tụt quá −2,7 điểm — đạt tiêu chí §40 của
  * BOT_AI_CONTINUE_UPGRADE, nên mặc định nâng lên đây. v20/v22 tồn tại làm
  * mốc A/B (futureRisk gộp / wolfSideGain), chưa có protocol.
  * v1-v4 không bị ảnh hưởng - test tái lập của chúng luôn truyền preset đích
  * danh, không bao giờ dựa vào hằng số này.
  */
export const DEFAULT_BOT_WEIGHTS: BotWeights = BOT_WEIGHTS_V21;