# BOT AI Phase 1: Memory, Belief và Vote Intelligence

Ngày: 2026-08-28

## Mục tiêu

Phase 1 thay quyết định bỏ phiếu ban ngày của BOT bằng một lõi deterministic có
trí nhớ, belief, social graph và reasoning dựa trên evidence thật. LLM chỉ diễn
đạt một quyết định đã được lõi AI chốt; LLM không còn được chọn mục tiêu vote.

Phase này đồng thời sửa luật bỏ phiếu để người chơi được đổi phiếu trong thời
gian `VOTING`, ghi lại toàn bộ chuỗi thay đổi, và công khai danh tính từng lá
phiếu sau khi vòng đề cử kết thúc. Role người chết vẫn bị ẩn tới `GAME_OVER`.

Không làm trong Phase 1:

- Hệ thống độ khó hoặc UI chọn độ khó.
- Strategy ban đêm theo role; phần này thuộc Phase 2.
- Bussing, distancing và manipulation đầy đủ của Sói; phần này thuộc Phase 3.
- Defense và final judgment deterministic; phần này thuộc Phase 4.
- Simulation cân bằng 1.000/5.000 ván; phần này thuộc Phase 5.

## Audit implementation hiện tại

`packages/game-engine` đang là trọng tài thuần, giữ authoritative state và lọc
thông tin bí mật qua `GameEngine.snapshotFor(viewerId)`. `apps/server` bổ sung
chat đã lọc bằng `buildSnapshot(room, viewerId)`.

BOT hiện nằm trong `apps/server/src/bots`. Mỗi lượt, `GeminiBrain` hoặc
`OpenAiCompatBrain` nhận `RoomSnapshot`, tự chọn hành động, phiếu và lời nói.
`FallbackBrain` thử provider kế tiếp khi lỗi; `RandomBrain` là đường lui cuối.
`machine.ts` quản lý timer và nộp kết quả vào engine.

Các phần đang làm tốt và cần giữ:

- Engine là trọng tài cuối cho mọi hành động.
- Snapshot được lọc theo người xem trước khi tới BOT.
- Provider có timeout, governor, cooldown và fallback.
- Scheduler loại kết quả đã cũ khi phase hoặc round thay đổi.
- Chat visibility do server quyết định.

Các vấn đề Phase 1 phải giải quyết:

- Không có private brain state theo BOT.
- Không có structured memory, suspicion/trust kèm lý do hoặc social graph.
- Personality hiện chỉ thay văn phong prompt, không ảnh hưởng decision-making.
- LLM đang quyết định gameplay trực tiếp.
- Snapshot chỉ có tổng phiếu, không có lịch sử ai vote ai.
- Engine cấm đổi phiếu nên không thể quan sát late switch hoặc save vote.
- `Math.random()` nằm rải rác trong fallback và scheduler, làm test BOT không
  deterministic.
- `RoomSnapshot` là contract phục vụ UI, không phải knowledge contract ổn định
  cho một decision engine.

Baseline tại thời điểm viết spec: 118 test game engine và 273 test server đều
pass, tổng cộng 391 test.

## Quyết định kiến trúc

Lõi deterministic nằm trong `packages/game-engine/src/bot/`, nhưng private brain
state không nằm trong `GameState`. `GameState` chỉ chứa sự thật và lịch sử công
khai của ván; `BotRuntime` chứa nhận thức có thể sai của từng BOT.

Server sở hữu vòng đời runtime bằng một registry:

```text
roomCode
  -> BotSession (seeded RNG, public-event cursor)
       -> botId -> BotRuntime -> BotBrainState
```

Ranh giới này giữ ba tính chất:

1. Game engine vẫn thuần, không phụ thuộc Redis, Prisma, Socket.IO hoặc provider.
2. Belief riêng của BOT không thể vô tình lọt vào snapshot authoritative.
3. Lõi AI có thể chạy độc lập trong unit test và simulation sau này.

State runtime tồn tại suốt một ván. Nó được tạo khi bắt đầu trận và được xóa khi
reset về lobby, game over hoặc phòng bị remove. Server hiện trả phòng đang chơi
về lobby sau restart, nên Phase 1 không persist brain riêng vào Redis.

## Cấu trúc module dự kiến

Tên file có thể điều chỉnh nhẹ khi lập implementation plan, nhưng ranh giới
trách nhiệm phải được giữ:

```text
packages/game-engine/src/
  bot/
    types.ts
    rng.ts
    knowledge.ts
    BotRuntime.ts
    memory/
      memory-store.ts
      memory-decay.ts
    belief/
      belief-state.ts
      evidence.ts
    personality/
      personality.ts
    analysis/
      vote-analysis.ts
      social-analysis.ts
      chat-analysis.ts
    decision/
      vote-decision.ts

apps/server/src/bots/
  session-registry.ts
  context.ts
  speech-renderer.ts
  legacy-provider-brain.ts
```

Không tạo giant switch-case. Mỗi module phân tích chỉ biến observations thành
evidence; belief layer áp dụng evidence; decision layer chỉ chấm điểm các hành
động hợp lệ từ belief hiện tại.

## Public vote history và luật đổi phiếu

### Vote mutation

Engine ghi một mutation cho mỗi thao tác vote:

```ts
interface VoteMutation {
  id: string;
  round: number;
  voterId: string;
  previousChoice: VoteChoice | null;
  choice: VoteChoice;
  castAt: number;
  phaseStartedAt: number;
  phaseEndsAt: number;
  sequence: number;
}

type VoteChoice =
  | { type: "PLAYER"; targetId: string }
  | { type: "NO_ELIMINATION" };
```

`previousChoice: null` nghĩa là lá phiếu đầu tiên của người đó trong vòng.
`submitVote` không còn từ chối người đã vote; nó thay lựa chọn hiện tại và thêm
mutation nếu lựa chọn mới khác lựa chọn cũ. Gửi lại đúng cùng lựa chọn là no-op,
không tạo event giả.

`castAt` được truyền vào engine với mặc định `Date.now`, còn test truyền đồng hồ
giả. Tỷ lệ thời gian còn lại được suy ra từ các mốc phase, không phụ thuộc đồng
hồ client.

### Công khai thông tin

Trong `VOTING`:

- Mọi người thấy tổng phiếu hiện tại như hiện nay.
- Người chơi vẫn thấy lựa chọn hiện tại của chính mình.
- Danh tính người đang vote cho ai chưa được công khai.
- Người chơi được gửi vote mới tới khi phase kết thúc.

Sau `resolveNomination`, engine tạo `DayVoteRecap` bất biến. Recap công khai:

- Chuỗi mutation theo thứ tự.
- Lựa chọn cuối của từng cử tri.
- Kết quả đề cử hoặc lý do không mở phiên tòa.
- Sau khi final vote kết thúc, danh tính từng phiếu `HANG`/`SPARE` và kết quả.

Recap không chứa role. `RoomSnapshot` gửi cùng recap cho người thật và BOT, nên
BOT không được dùng dữ liệu mà UI không có quyền hiển thị.

## Knowledge boundary

Mọi quyết định deterministic chỉ nhận `BotDecisionContext`. Không hàm decision
nào nhận raw `GameState` hoặc `Room`.

```ts
interface BotDecisionContext {
  knowledge: BotKnowledgeView;
  visibleChat: BotChatObservation[];
  legalActions: BotLegalActions;
}
```

`GameEngine.botKnowledgeFor(botId)` dựng `BotKnowledgeView` từ authoritative
state và áp dụng cùng nguyên tắc quyền với `snapshotFor`:

- BOT biết role và trạng thái sống của chính mình.
- Sói biết đồng đội Sói còn sống theo đúng luật hiện tại.
- Tiên Tri chỉ biết kết quả soi của chính mình.
- Không BOT sống nào biết role người khác hoặc role người chết chưa được reveal.
- Public vote recap, public deaths và public log giống nhau cho mọi người sống.
- Mục tiêu/hành động hợp lệ do engine cung cấp, không để BOT tự đoán luật.

Server bổ sung `visibleChatLog(room, botId)` đã được lọc. Context builder không
có quyền đọc thêm hidden role rồi gắn vào context. Test bảo mật phải dựng state
có đầy đủ hidden role và chứng minh chúng không xuất hiện trong knowledge view.

## Bot brain state

```ts
interface BotBrainState {
  playerId: string;
  personality: BotPersonality;
  suspicion: Record<string, BeliefEntry>;
  trust: Record<string, BeliefEntry>;
  knownInformation: KnownInformation;
  claims: RoleClaim[];
  memories: BotMemory[];
  relationships: Record<string, SocialEdge>;
  currentTheory: BotTheory | null;
  currentTargets: string[];
  confidence: number;
  previousVotes: PreviousBotVote[];
  speechMemory: SpeechMemory[];
  seenEventIds: string[];
}
```

Mỗi `BeliefEntry` có score `0–100`, reasons và mốc cập nhật. Mỗi reason trỏ tới
`EvidenceRef` có source event/message ID, loại evidence, weight và confidence.
Không có evidence không nguồn.

Suspicion khởi tạo trung lập cho người chưa biết. Self knowledge và known wolf
teammates không được biểu diễn bằng cách chỉnh số suspicion rồi coi đó là bằng
chứng công khai; chúng nằm trong `knownInformation` riêng để tránh LLM vô tình
nói ra bí mật.

## Personality và human-like error

Phase 1 dùng một profile cân bằng mặc định, không có difficulty abstraction hoặc
UI cấu hình. Bảy thuộc tính được tạo bằng RNG có seed:

- `aggressiveness`
- `talkativeness`
- `riskTolerance`
- `deceptionSkill`
- `analyticalSkill`
- `loyalty`
- `stubbornness`

Personality ảnh hưởng decision thật:

- `analyticalSkill` điều khiển xác suất nhận ra evidence phức tạp.
- `stubbornness` tạo inertia khi belief đổi hướng.
- `aggressiveness` hạ hoặc nâng confidence cần để accuse/vote.
- `riskTolerance` ảnh hưởng lựa chọn giữa mục tiêu chưa chắc và không treo.
- `loyalty` tạo penalty khi Sói cân nhắc vote known teammate trong Phase 1.
- `talkativeness` quyết định có phát lời hay im lặng.
- `deceptionSkill` được lưu từ Phase 1 nhưng chỉ được dùng đầy đủ ở Phase 3.

Human-like error không được tạo bằng lựa chọn ngẫu nhiên vô điều kiện. Lõi chỉ
có thể bỏ sót một evidence theo analytical skill hoặc thêm bounded score jitter.
Mọi nhiễu dùng RNG injected và tái lập được bằng seed.

## Structured memory

Memory tối thiểu của Phase 1 gồm:

- `VOTE_CAST`
- `VOTE_CHANGED`
- `LATE_VOTE`
- `NOMINATED`
- `FINAL_JUDGMENT`
- `PLAYER_DIED`
- `ROLE_CLAIM`
- `COUNTER_CLAIM`
- `ACCUSE`
- `DEFEND`
- `SEER_RESULT`
- `BOT_SPOKE`

Memory thường có `importance`, `round`, `phase`, actor, target, source ID và dữ
liệu tối thiểu. Không lưu toàn bộ raw chat. Tối đa khoảng 120 memory thường mỗi
BOT; khi vượt giới hạn, runtime gộp hoặc loại memory cũ có importance thấp.

Role claim, counter-claim và Seer result nằm trong kho pinned có giới hạn theo
số người chơi, nên không cạnh tranh với memory thường. Memory cũ giảm tác động
theo round; pinned facts không bị decay mất khỏi state.

`seenEventIds` hoặc cursor tương đương bảo đảm một event chỉ được áp dụng một
lần, kể cả context được dựng lại hoặc provider trả về muộn.

## Chat observation

Human chat được phân tích bảo thủ. Parser chỉ tạo structured observation khi:

- Actor có thật và message ID có thật.
- Target khớp duy nhất với tên/ngữ danh của một người chơi.
- Câu chứa mẫu claim, counter-claim, accuse hoặc defend rõ ràng.

Câu mơ hồ, target trùng tên hoặc không xác định bị bỏ qua. Parser không suy diễn
role hoặc ý định ngầm. BOT speech act được ghi trực tiếp từ `BotIntention`; hệ
thống không parse lại câu LLM đã viết.

Phase sau có thể thêm semantic extractor, nhưng extractor chỉ được tạo candidate
observation có source; decision engine vẫn deterministic và validation vẫn bắt
buộc. Phase 1 không phụ thuộc một LLM perception call.

## Vote analysis

Từ public vote recap, runtime tạo evidence cho:

- Vote đầu và lựa chọn cuối.
- Đổi vote trong 20% thời gian cuối.
- Đổi vote phá hòa hoặc tạo người dẫn đầu.
- Đổi vote cứu người đang dẫn đầu bằng cách đẩy người khác vượt lên.
- Bandwagon vào người đã dẫn phiếu; đây là evidence yếu, không tự đủ kết tội.
- Liên tục vote cùng một người hoặc cùng nhóm qua nhiều round.
- Vote alignment lặp lại giữa hai người.
- Final judgment khác với nomination và các pattern Treo/Tha lặp lại.

Do role người chết bị ẩn tới cuối ván, Phase 1 không có rule kiểu “người bị treo
là Dân nên tăng nghi ngờ người đã push”. Evidence chỉ dựa trên pattern công khai,
không dựa trên phe thật chưa được reveal.

Mỗi analyzer trả candidate evidence; `analyticalSkill` có thể làm BOT bỏ sót một
candidate theo RNG. Belief layer áp dụng trọng số, stubbornness và decay rồi
clamp score vào `0–100`.

## Social graph

Mỗi cạnh hướng giữa hai người giữ:

```ts
interface SocialEdge {
  support: number;
  hostility: number;
  voteAlignment: number;
  samples: number;
  reasons: EvidenceRef[];
}
```

Với tối đa 15 người, graph tối đa 225 cạnh và có thể giữ trong memory. Graph chỉ
gợi ý cặp phối hợp; nó không kết luận role. `possibleWolfPair` trong Phase 1 là
một score mềm dùng để bổ sung suspicion, không phải hard fact.

## Vote decision pipeline

Mỗi lần BOT cần bỏ hoặc đánh giá lại phiếu:

1. Nhận context đã lọc.
2. Ingest observations chưa thấy.
3. Cập nhật memory, belief và social graph.
4. Sinh mọi mục tiêu hợp lệ cùng `NO_ELIMINATION`.
5. Chấm điểm bằng suspicion, evidence quality, vote pattern, social signal và
   personality.
6. Áp dụng bounded RNG jitter.
7. So với confidence threshold và hysteresis của phiếu hiện tại.
8. Trả `BotIntention` có target, confidence và evidence thật.

Không hardcode một công thức duy nhất cho mọi analyzer. Mỗi analyzer trả score
đã chuẩn hóa cùng evidence; decision layer phối hợp chúng bằng config nội bộ có
tên rõ ràng và test riêng.

Nếu không mục tiêu nào đạt confidence tối thiểu, BOT chọn không treo. Nó không
vote random chỉ vì phải trả một target.

Trong Phase 1, Sói có teammate-safety penalty dựa trên known information và
`loyalty`. Chưa có bussing chủ động. Bussing, distancing và manipulation thay
penalty đơn giản này ở Phase 3.

## Lịch BOT trong ngày

`DAY_DISCUSSION`:

- BOT quan sát event/chat mới và cập nhật state.
- Nó chọn luận điểm cùng ý định vote sơ bộ.
- `talkativeness` có thể khiến BOT im lặng.
- Nếu nói, server gửi intention/evidence vào speech renderer.

`VOTING`:

- BOT nộp phiếu ban đầu ở một mốc lấy từ seeded scheduler RNG.
- BOT đánh giá lại tối đa hai lần: một lần giữa pha và một lần có thể nằm trong
  20% cuối.
- BOT chỉ đổi phiếu nếu mục tiêu mới vượt phiếu cũ một hysteresis đủ lớn hoặc
  tình thế phá hòa/cứu phiếu thay đổi đáng kể.
- Mọi lần nộp đều kiểm tra engine instance, phase, round và phase deadline.

Cơ chế này tạo vote change có nguyên nhân nhưng không làm BOT nhảy phiếu liên
tục. Người chơi thật và BOT cùng chịu đúng luật đổi phiếu của engine.

## LLM chỉ tạo lời nói

Schema ngày mới không chứa `voteTargetId`. Input speech generation gồm:

```ts
interface SpeechRequest {
  speaker: PublicBotIdentity;
  personalityStyle: string;
  intention: BotIntention;
  evidence: RenderableEvidence[];
  recentSpeechActs: SpeechMemory[];
}
```

LLM chỉ được diễn đạt target và evidence trong request. Response chỉ có `chat`.
Interpreter không thể trả target mới. Nếu provider timeout, JSON hỏng hoặc hết
quota, template renderer tạo câu từ cùng intention; quyết định gameplay không
thay đổi.

Speech memory lưu loại luận điểm và source IDs đã dùng. Runtime ưu tiên evidence
mới; nếu không có ý mới và personality không thích nói nhiều, BOT im lặng thay
vì lặp lại.

## Migration theo phase

Phase 1 chuyển nomination vote và day-discussion intention sang deterministic
core. Các quyết định sau tạm nằm sau `LegacyProviderBrain`:

- Night action tới Phase 2.
- Hunter strategy tới Phase 2 hoặc role-specific task tương ứng.
- Defense và final judgment tới Phase 4.

Đây là trạng thái migration có chủ đích. Legacy adapter không được dùng cho
nomination vote đã migrate. `RandomBrain` chỉ còn fallback cho các quyết định
chưa migrate.

`pendingVote` được thay bằng `BotSession`. Provider governor/cooldown và các cổng
validation hiện tại được giữ cho legacy calls và speech rendering.

Randomness thuộc BOT trong scheduler, fallback và runtime được gom sau injected
RNG của session. Randomness luật chơi đã có contract riêng như `lockWolves(rng)`
không bị trộn với BOT RNG.

## Xử lý lỗi và khôi phục

- Event/message mơ hồ: bỏ qua.
- Evidence thiếu source: từ chối trước belief update và speech rendering.
- Không có target đủ confidence: vote không treo.
- Provider lỗi: dùng template renderer, giữ nguyên intention.
- Runtime chưa tồn tại: tạo lại từ public recap, private knowledge hiện có và
  visible structured chat observations; không vote random.
- Context hoặc provider result về sau khi phase/round đổi: bỏ kết quả.
- Gửi lại cùng vote: engine no-op.
- State score vượt miền: clamp `0–100` tại belief boundary.

Rebuild runtime có thể mất các chat observation đã bị cắt khỏi `chatLog`; điều
này chấp nhận được trong Phase 1 vì server không khôi phục ván đang chơi sau
restart. Rebuild trong cùng process dùng registry bình thường và public history.

## Giới hạn tài nguyên

- Khoảng 120 memory thường mỗi BOT.
- Pinned facts bị giới hạn bởi số player/role claim/Seer check thực tế.
- Social graph tối đa `15 × 15` cạnh.
- Không copy raw chat vào brain state.
- Analyzer chạy trên event mới hoặc recap chưa thấy, không quét lại toàn bộ chat
  ở mọi decision.

## Kiểm thử

### Game engine và contract

- Người chơi được đổi vote trong `VOTING`.
- Gửi lại cùng lựa chọn là no-op.
- Current tally phản ánh lựa chọn mới nhất.
- Vote mutation giữ đúng previous/new choice, timestamp và sequence.
- Danh tính phiếu bị ẩn trong lúc vote và công khai sau khi chốt.
- Day recap không chứa role.
- Final judgment recap giữ danh tính `HANG`/`SPARE` sau khi chốt.

### Memory, belief và analysis

- Memory deduplicate theo source ID.
- Decay không xóa pinned facts.
- Pruning giữ memory quan trọng và tôn trọng giới hạn.
- Suspicion luôn nằm trong `0–100` và mọi reason có source.
- Nhận diện bandwagon, late switch, phá hòa, save vote và repeated alignment.
- Chat parser bỏ câu mơ hồ và chỉ nhận target khớp duy nhất.
- Social graph cập nhật theo evidence, không tạo hard role conclusion.

### Decision và human-like error

- Seeding giống nhau cộng event giống nhau cho state và quyết định giống nhau.
- Analytical skill thấp chỉ bỏ sót candidate evidence theo RNG xác định.
- Confidence thấp chọn không treo.
- Vote hiện tại chỉ đổi khi vượt hysteresis hoặc có tình thế quyết định.
- Sói Phase 1 áp dụng teammate-safety penalty.
- Không đường deterministic day-vote nào fallback sang random.

### Information security

- Villager knowledge không chứa role người sống khác.
- Villager knowledge không chứa role người chết.
- Sói chỉ thấy known teammates theo luật.
- Tiên Tri chỉ thấy kết quả của chính mình.
- Decision API không nhận `GameState` hoặc `Room`.
- Speech request chỉ chứa evidence đã validate và không thể đổi target.

### Scheduler và provider

- Kết quả cũ không lọt sang phase/round khác.
- Một checkpoint chỉ tạo tối đa một vote mutation.
- LLM lỗi dùng template nhưng giữ target/evidence.
- Brain/session được dọn khi reset, game over và remove room.
- Toàn bộ test engine/server hiện tại tiếp tục pass.

Phase 1 thêm một scenario runner nhỏ chạy nhiều seed để kiểm tra invariant và
determinism. Không dùng kết quả đó để tuyên bố cân bằng phe. Simulation win rate
1.000/5.000 ván chỉ có ý nghĩa sau khi role strategies đã deterministic ở Phase
2–4, nên được thực hiện ở Phase 5.

## Tiêu chí hoàn thành Phase 1

Phase 1 hoàn thành khi:

1. BOT nomination vote được quyết định hoàn toàn bởi deterministic core.
2. BOT giữ memory/belief/social state xuyên các ngày trong cùng ván.
3. Mọi suspicion reason và speech evidence trỏ tới sự kiện có thật.
4. Người thật và BOT có cùng quyền xem lịch sử phiếu.
5. Role người chết vẫn ẩn tới `GAME_OVER`.
6. Cùng seed và cùng observations cho cùng quyết định.
7. LLM chỉ tạo lời nói và không thể thay đổi gameplay intention.
8. Không còn `Math.random()` trong đường BOT đã migrate.
9. Baseline test và test Phase 1 đều pass.

## Thứ tự migration cấp cao

1. Thêm vote mutation/day recap và luật đổi phiếu trong engine.
2. Mở contract recap qua shared snapshot và UI.
3. Thêm knowledge boundary và security tests.
4. Thêm seeded RNG, personality và brain state.
5. Thêm memory/belief/vote/social analyzers.
6. Thêm deterministic vote decision và scenario tests.
7. Thêm BotSession, các checkpoint scheduler và lifecycle cleanup.
8. Chuyển day prompt thành speech-only với template fallback.
9. Chạy toàn bộ verification và ghi baseline mới cho Phase 2.
