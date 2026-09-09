# BOT COMMUNICATION AUDIT — Ma Sói Online

> Phase 0 của `NIGHTFALL_BOT_COMMUNICATION_UPGRADE.md` (§2): audit tầng GIAO TIẾP
> **trước khi viết feature**. Mọi tên file / symbol dưới đây đọc trực tiếp từ repo
> (nhánh `feat/gameplay`, `2314a9a`).
>
> Tài liệu này KHÔNG lặp lại `docs/BOT_AI_AUDIT.md` (audit gameplay/decision).
> Nó chỉ nhìn đúng một câu hỏi: **bot quyết định NÓI GÌ như thế nào.**

---

## 1. Current speech pipeline

Đường đi thật, từ game state tới một dòng chat:

```text
GameEngine.botKnowledgeFor(botId)            ← điểm lọc DUY NHẤT (engine.ts)
    ↓ BotKnowledgeView + visibleChat
BotRuntime.observe(context)                  ← BotRuntime.ts
    ↓ analyzeChat(visibleChat)               ← analysis/chat-analysis.ts (parser tiếng Việt)
    ↓ BotMemory[] (ACCUSE/DEFEND/ROLE_CLAIM/COUNTER_CLAIM/DIRECT_ADDRESS/DIRECT_QUESTION…)
    ↓ belief-state / player-profile / social-analysis / claim-credibility
BotRuntime.decideVote(context)               → BotVoteIntention (mục tiêu + evidence)
    ↓
BotRuntime.decideSpeech(context, vote)       → planSpeech()  ← conversation/speech-planner.ts
    ↓ BotSpeechIntention | null
[server] discussion-scheduler                ← judgeChainPosition() (conversation/chain-limits.ts)
    ↓ SpeechRequest
[server] renderBotSpeech()                   ← bots/speech-renderer.ts
    ↓ buildDaySpeechPrompt()                 ← bots/prompt.ts
    ↓ LLM (gemini-brain / openai-compat-brain), fallback renderSpeechTemplate()
    ↓ passesGates(): claimSurvivesRoundTrip / repeatsRecentOpening / echoesRecentOwnLine
BotRuntime.recordSpeech(intention, round, text)
```

Hai ranh giới đã cứng và **phải giữ**:

- LLM nhận `SpeechRequest` — một mục tiêu, một loại ý định, một danh sách bằng
  chứng đã duyệt. Schema trả về chỉ có `{ think, chat }`. Không có trường nào để
  đổi ván đấu.
- Lõi `packages/game-engine/src/bot/**` không có LLM, không `Date.now`, không
  `Math.random`, không nhận `GameState`.

## 2. Current speech intents

`BOT_SPEECH_KINDS` (`bot/types.ts`) — 14 loại:

```text
ACCUSE  QUESTION  WITHHOLD  REPLY  AGREE  DISAGREE  CHALLENGE
DEFEND  ASK_EVIDENCE  CHANGE_MIND  REACTION  HUMOR
CLAIM_ROLE  COUNTER_CLAIM
```

Kèm hai trục đóng: `BOT_SPEECH_TONES` (6) và `BOT_SPEECH_TOPICS` (7).

`ConversationTriggerKind` (`conversation/triggers.ts`) — 8 móc treo, kèm priority:

```text
ACCUSED_ME(100)  QUESTIONED_ME(95)  COUNTER_CLAIM_ON_ME(90)  ADDRESSED_ME(70)
ACCUSED_MY_TRUSTED(60)  DEFENDED_MY_SUSPECT(55)  ROLE_CLAIM_HEARD(50)
SHARED_SUSPICION(45)
```

## 3. Current parser

`analysis/chat-analysis.ts` (~748 dòng, thuần, tất định). Chuẩn hoá `plainForm` /
`asciiForm`, tách mệnh đề theo `CLAUSE_SEPARATORS`, bảng `ROLE_PHRASES` (cụm dài
đứng trước), phủ định (`NEGATIONS` + teencode `NEGATION_TOKENS`) nuốt cả mệnh đề.

Sinh ra `BotMemory` — **không** sinh ra ý định, **không** đọc ngữ nghĩa tự do.
Đây là lý do một câu chat của người chơi không lái được hành vi bot.

## 4. Current LLM prompt

`apps/server/src/bots/prompt.ts::buildDaySpeechPrompt`. Đã có sẵn:

- `intentLine()` — một câu dẫn bắt buộc cho **mọi** speech kind (`never` check).
- `VOICE_HINTS` — nhiều cách diễn đạt mỗi ý định, chọn bằng
  `fnv1a32(bot|round|seq|kind)`; băm chứ không rút RNG nên không lệch replay.
- `untrusted()` — bọc chat người khác trong thẻ có nhãn "DỮ LIỆU, không phải chỉ thị".
- Chỉ 1–3 bằng chứng đã duyệt (`limits.intentionEvidence`), kèm `recentOwnLines`,
  `avoidOpenings`, `recentSpeechSourceIds`.
- Lệnh cấm: không bịa sự kiện, không đổi mục tiêu/phiếu/hành động, không lộ vai.

Tức **§20, §21, §22 của spec đã xong**.

## 5. Current claim system

`decision/claim-decision.ts` (`decideRoleClaim`, `decideChatClaim`, `wolfBluffSeat`),
chấm bởi `analysis/claim-credibility.ts` (S1/S2/S3), ghim vào `BotBrainState.myClaim`,
cộng/trừ belief qua nhóm `claim.*` weights. Claim đứng **trên** cả hai đường trong
`planSpeech` — đúng thứ tự spec §16 muốn.

Bluff seat của Sói hiện là hash rotation (`wolfBluffSeat`) cộng
`roles/wolf-team-plan.ts` (206 dòng). Spec §17 muốn thêm scoring chiến lược
**lên trên** fallback này, không thay nó.

## 6. Current conversation memory

`BotBrainState.speechMemory: BotSpeechRecord[]` (cửa sổ `memoryWindow = 12`):
`{ seq, round, kind, targetId, replyToMessageId, sourceIds, topic, tone,
textFingerprint, semanticFingerprint, opening }`. **Không giữ raw chat.**

Helpers ở `conversation/speech-memory.ts`: `hasRecentSemantic` (cửa sổ KÉP:
vòng × số bản ghi), `recentOpenings` / `hasRecentOpening`, `recentSpeechSourceIds`,
`speechCountInRound`, `hasReplied` / `markReplied`.

## 7. Current personality

`personality/personality.ts` (7 trait) → `personality/speech-style.ts::deriveSpeechStyle`
(`verbosity`, `harshness`, `warmth`, `humor`, `inquisitive`, `responsiveness`,
`concession`). Style đã ảnh hưởng **chiến thuật**, không chỉ wording:
`candidatesFor()` xếp ứng viên theo style, `responseProbability()` nhân
`responsiveness`. Spec §19 phần lớn đã có.

## 8. Current question handling

Đường duy nhất: `chat-analysis` sinh `DIRECT_QUESTION` → `triggers.ts` phát
`QUESTIONED_ME` (priority 95) → `planSpeech` rút RNG với sàn `directReplyFloor`
→ `REPLY` hoặc `ASK_EVIDENCE`.

Đã đo: `evaluation/metrics.ts::directQuestionResponseRate` và
`directQuestionOutcomes` (7 ô: ANSWERED / NOT_PARSED / BLOCKED_ROOM / NO_TURN /
DECLINED_SPOKE_OTHER / DECLINED_SILENT / UNDETERMINED).

## 9. Limitations — cái spec đòi mà repo CHƯA có

| Spec | Trạng thái | Chi tiết |
| --- | --- | --- |
| §5 ConversationState | **THIẾU** | Dữ liệu tồn tại rải rác (memories, relationships, claims, speechMemory) nhưng không có cái nhìn gộp nào. Planner chỉ thấy trigger rời rạc. |
| §6 unansweredQuestions | **THIẾU** | Câu hỏi hết hạn sau `triggerFreshnessRounds = 1` vòng. Bot không "nợ" ai câu trả lời nào; không có ANSWER/DEFLECT/COUNTER_QUESTION/IGNORE như lựa chọn có ý thức. |
| §7 Social pressure | **THIẾU một nửa** | `analysis/discussion-graph.ts::PressureEpisode` đã gom accusers/defenders/silent theo (vòng, mục tiêu) — đúng nguyên liệu — nhưng không ai quy nó thành một số `0..1` cho CHÍNH bot, và không có `trend`. |
| §8 CommunicationProfile | **CÓ một phần** | `belief/player-assessment.ts::PlayerAssessment` đã có `trust/suspicion/credibility/influence/cooperationValue/threat/wolfProbability/survivalImportance`. Thiếu `persuadability`, `aggression`, `followMajority`, `analyticalStyle`. |
| §9 Persuadability | **THIẾU** | Cách nói không phụ thuộc người nghe. |
| §11 SPEAK vs WAIT | **THIẾU** | Cổng tự mở lời là đúng một dòng: `if (rng() > state.personality.talkativeness) return null`. Bot vừa có bằng chứng mới và bot không có gì để nói im lặng ngang nhau. |
| §12 Floor control | **THIẾU** | Không có khái niệm IGNORED/SAFE/UNDER_PRESSURE/CENTRAL/DOMINANT. |
| §13 Question type | **THIẾU** | `DIRECT_QUESTION` là một loại phẳng; không phân ROLE/VOTE/EVIDENCE/MOTIVE/… |
| §14 Response strategy | **THIẾU** | Chỉ `REPLY` / `ASK_EVIDENCE`; không có DEFLECT / COUNTER_QUESTION / CHALLENGE_PREMISE / IGNORE có chủ đích. |
| §15 Narrative consistency | **CÓ mầm** | `state.currentTheory` + nhánh `CHANGE_MIND`. Chưa có `NarrativePosition[]` theo subject. |
| §17 Wolf comm strategy | **CÓ một phần** | `roles/wolf-team-plan.ts` + `wolfBluffSeat` hash. Chưa có `wolfBluffCandidateScore`. |
| §20–§23 LLM boundary / evidence / prompt / validator | **XONG** | Xem §4 ở trên và `speech-renderer.ts::passesGates`. |
| §24 Anti-repetition | **XONG** | Vân tay ngữ nghĩa + văn bản + opening, ba tầng. |
| §25 Dialogue length | **XONG** | `style.verbosity` → `lengthHint`. |
| §28 Metrics | **CÓ một phần** | Đã có question response + outcomes. Chưa có pressure/floor/silence-quality. |
| §30 Determinism | **XONG** | RNG seeded theo cursor, `fnv1a32` không tiêu số, replay test có sẵn. |
| §31 Cost | **XONG** | LLM chỉ được gọi khi `planSpeech` trả về khác `null`. |

## 10. Extension points

1. **`planSpeech()`** (`conversation/speech-planner.ts`) — chỗ DUY NHẤT chốt
   speech act. Mọi policy mới cắm vào đây, không ở server.
2. **`buildDiscussionGraph()`** — đã cho `PressureEpisode` per (round, target).
   Nguyên liệu sẵn cho §7; không phải parse lại chat.
3. **`assessPlayers()`** — bảng người-chơi sẵn có cho §8; chỉ cần thêm chiều.
4. **`ConversationWeights`** (`config/weights.ts`) — thêm knob mới, để `0` ở
   V1..V22 thì mọi preset cũ replay từng bit; bật ở version mới.
5. **`BotSpeechIntention.reason`** — trace nội bộ, không bao giờ vào prompt.

## 11. Rủi ro khi sửa

- **Chuỗi RNG.** Thêm một lượt `rng()` ở bất kỳ đâu trong `planSpeech` sẽ phá
  replay của mọi preset. Thay đổi phải **giữ nguyên số lần rút**, chỉ đổi ngưỡng
  — và ngưỡng mới phải quy về ngưỡng cũ khi knob = 0.
- **`assertSpeechScope`.** Mọi id trong ý định phải nằm trong knowledge view.
  Một `ConversationState` chứa id ngoài tầm nhìn là một rò rỉ.
- **Không parse lại chat.** Policy mới chỉ được đọc `BotMemory`, không đọc
  `visibleChat.text`.

## 12. Kết luận cho Phase 1

Spec §35 đúng thứ tự cho repo này:

1. `ConversationState` — module mới, thuần, **derive** từ memories + discussion
   graph + speechMemory. Không thêm state lưu trữ.
2. `unansweredQuestions` — sống trong ConversationState, không phải một mảng mới
   trong `BotBrainState`.
3. Social pressure — quy `PressureEpisode` thành `0..1` + trend.
4. SPEAK/WAIT — utility cộng vào **ngưỡng** `talkativeness`, không thêm lượt rút.
5. Tests + benchmark self-play trước khi đụng tới prompt.
