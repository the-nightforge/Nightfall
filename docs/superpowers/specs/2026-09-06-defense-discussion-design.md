# DEFENSE thảo luận tự do (free-for-all) + đo lại cân bằng

> **Ngày tạo:** 2026-09-06
> **Trạng thái:** Chờ review spec
> **Phạm vi:** `@masoi/shared` (ít), `@masoi/game-engine` (nhiều), `apps/server` (vừa), `apps/web` (ít)
> **Quyết định của user:** approach B (tự do, không chia lượt); đổi luật phòng thật; full sweep 300 ván speech-BẬT sau implement; spec hiệu chỉnh viết SAU khi có số mới.

---

## 1. Bối cảnh và vấn đề

Harness self-play hiện đi thẳng `resolveNomination` → `beginFinalVote`, `trialDefense: null`
(`bot/evaluation/selfplay.ts` contextFor + vòng chính). Mọi số `ROLE_POWER` và baseline
preset từng đo đều đo một ván mà bị cáo không được bào chữa và không ai được bàn về bản án
trước khi bỏ phiếu Treo/Tha — vai trò của info/điều phối (SEER, WITCH, DETECTIVE, MAYOR,
HUNTER, GUARD) bị đo thiếu có hệ thống.

Phía phòng thật hôm nay: voice/chat cho mọi người sống nói trong DEFENSE (`voice.ts`
`OPEN_TO_LIVING`, `resolveChat`), nhưng bot chỉ có bị cáo nói 1 phát (`scheduleDefenseBot`
accused-only), UI `TrialView.canSpeak` khóa ở bị cáo, và `ingestDefenseReview` chỉ nghe
lời bị cáo. Kết quả: DEFENSE là độc thoại, không phải thảo luận.

## 2. Luật mới (phòng thật + harness đo cùng một luật)

- Trong `DEFENSE`, mọi người chơi CÒN SỐNG (gồm bị cáo) được nói tự do tới hết
  `defenseSeconds`; sau đó `beginFinalVote` như cũ. Người chết vẫn cách ly.
- KHÔNG đổi luật vote: bị cáo không bỏ phiếu (`finalVoters` loại bị cáo giữ nguyên),
  `guiltyRequired = floor(eligible/2)+1`, hòa/bỏ = Tha.
- KHÔNG đổi `defenseSeconds` (không kéo dài ván). Công bằng đến từ giới hạn lượt nói,
  không phải chia slot.
- 3 vai trung lập (JESTER, SERIAL_KILLER, EXECUTIONER) KHÔNG chạy lúc đo: preset vốn đã
  `false` cả ba; harness assert fail-fast nếu một ván đo lọt vai trung lập.

## 3. Bot nói: scheduler đa người (thay accused-only một phát)

- Thay `scheduleDefenseBot` (machine.ts) accused-only bằng vòng lập lịch cho MỌI bot sống:
  mỗi bot tối đa 2 lượt/DEFENSE (0 cũng hợp lệ — bot chưa đủ tin thì im), thứ tự ngẫu nhiên (seeded), nội dung tái dùng
  `speech-planner` (`planSpeech`) với trigger ưu tiên nhắc tới bị cáo (buộc tội/bênh vực
  theo belief riêng của từng bot: sói lái Tha cho đồng bọn / Treo cho dân, dân theo
  suspicion/trust, Hề giữ INDIFERRENT/HUMOR như luật cũ của `defense-decision`).
- Chống spam/nhiễu số đo: tái dùng `chain-limits` + budget `messagesPerBotPerRound`;
  bot không vượt ngưỡng tin thì im (không bơm câu vô nghĩa). Không lượt nói ép buộc.
- JESTER giữ nguyên tính cách bào chữa cũ (INDIFFERENT, HUMOR, không claim, không evidence).

## 4. Bot nghe: mở rộng `ingestDefenseReview`

- Hôm nay: chỉ lọc `visibleChat` của bị cáo trong window + đòi `endedAt`.
- Mới: nghe TẤT CẢ actor trong window DEFENSE → `analyzeChat(phase:"DEFENSE")` →
  evidence `DEFENSE_QUALITY` vào `decideFinalVote` như cũ. GIỮ NGUYÊN trọng số evidence
  ở lần này (đo sẽ cho biết có cần chỉnh không — cấm chỉnh mù trước số).
- `decideFinalVote` giữ nguyên mọi nhánh đặc thù (sói-bênh-đồng-bọn, Hề Tha, SK Treo,
  Báo Thù Treo đúng mục tiêu, còn lại `trust < suspicion + spareTrustMargin`).

## 5. Engine + harness

- Self-play: bỏ `trialDefense: null`; sau `resolveNomination` ra TRIAL thì chạy vòng
  speech DEFENSE thật (emit qua `emitSpeech`, observe qua `BotRuntime.observe` từng bot,
  cùng seed) rồi mới `beginFinalVote`. Thêm cờ tường minh (vd `defense: true` trong
  `SelfPlayInput`/`SelfPlayBatchInput`, mặc định BẬT cho preset mới) để batch cũ/mới
  so sánh được và test khóa được hành vi.
- Không đổi shape snapshot nếu tránh được: dùng `visibleChat` + window DEFENSE có sẵn.
- Test khóa: harness bật defense sinh ra ≥1 speech phi-bị-cáo trong window; tắt defense
  giữ nguyên hành vi cũ byte-for-byte (trialDefense null, không speech).

## 6. UI/voice/server

- Voice: đã mở cho người sống trong DEFENSE — KHÔNG đụng.
- UI: mở `TrialView.canSpeak` từ bị-cáo-only → mọi người sống trong DEFENSE (đổi đúng
  cổng hiển thị, không đổi luật).
- Server machine: lập lịch bot đa người theo §3 (thay accused-only); giữ backstop timer
  lock + `allNightActionsDone` như cũ (không liên quan pha này nhưng không được đụng).

## 7. Đo lường (sau implement, trước spec hiệu chỉnh)

- Full sweep 14 TOGGLES × 300 ván/preset speech-BẬT, 3 luồng song song theo cỡ phòng
  (8–12 / 13–16 / 17–20), seed ghép cặp như `role-power.ts` hiện tại.
- Baseline preset 8–20 đo kèm (miễn phí từ cùng lượt chạy).
- Ra số rồi mới viết **spec hiệu chỉnh** riêng: hạ GUARD/DETECTIVE/MAYOR/SEER/WITCH,
  giảm phạt CURSED, vá preset 13–16 và 18/20 — mọi con số từ đo mới, tròn 0.5, cấm chép
  tay và cấm dùng số sweep cũ (luật đã đổi nên số cũ hết hiệu lực).

## 8. Rủi ro đã biết

- Bot ồn ào có thể làm baseline nhiễu hơn sweep cũ → ngưỡng tin fix-loop: |Δ| >> SE mới
  kết luận; ngân sách lượt nói (§3) là hàng rào chính.
- Phòng thật ồn hơn (nhiều người cùng nói) — chấp nhận theo approach B đã duyệt; lượt
  giới hạn 1–2/người là phanh duy nhất ở lần này.
