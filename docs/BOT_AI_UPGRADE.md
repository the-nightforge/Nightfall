# BOT AI UPGRADE SPEC — Ma Sói Online

> Mục tiêu: nâng cấp bot Ma Sói hiện tại thành bot có khả năng suy luận, ghi nhớ, cập nhật niềm tin theo diễn biến game và có hành vi đa dạng hơn, đồng thời giữ nguyên luật/game engine hiện tại.
>
> **Quan trọng:** Claude Code phải đọc và hiểu codebase thực tế trước khi sửa. Không được giả định tên file, interface, event, role hoặc API nếu chúng không tồn tại trong repo.

---

## 0. Mục tiêu tổng thể

Nâng bot từ dạng:

```text
Rule / heuristic
+ memory đơn giản
+ belief đơn giản
+ LLM diễn đạt
```

thành:

```text
Game State
    ↓
Observation Builder
    ↓
Memory / Event History
    ↓
Belief & Suspicion Model
    ↓
Candidate Action Generator
    ↓
Action Scoring / Strategic Planner
    ↓
Role-specific Decision
    ↓
LLM Dialogue Verbalization
```

Mục tiêu cuối:

1. Bot hiểu được lịch sử game thay vì chỉ phản ứng event hiện tại.
2. Bot duy trì xác suất nghi ngờ theo từng player.
3. Bot biết cập nhật belief sau claim, vote, death, reveal, night action và kết quả.
4. Bot có chiến thuật khác nhau theo role.
5. Bot biết cân nhắc hành động ngắn hạn và dài hạn.
6. Bot không "cheat": chỉ được dùng thông tin mà role hiện tại hợp pháp được biết.
7. Có deterministic seed/replay nếu hệ thống hiện tại đã hỗ trợ.
8. Không phụ thuộc LLM để quyết định action hợp lệ.
9. LLM chỉ tạo lời nói/giải thích dựa trên decision đã được engine chọn.
10. Có benchmark để đo bot mới tốt hơn bot cũ.

---

# 1. Quy tắc bất biến

Claude Code MUST:

- Không sửa luật game nếu task không yêu cầu.
- Không thay đổi protocol socket/API/frontend nếu không cần.
- Không cho bot đọc hidden state của player khác.
- Không để LLM tự quyết định action trực tiếp.
- Không bypass validation của game engine.
- Không dùng random không kiểm soát nếu hệ thống hiện tại có seed.
- Không xóa implementation cũ trước khi có test thay thế.
- Không hard-code player IDs, role IDs hoặc số người chơi.
- Không thêm dependency nặng nếu có thể giải quyết bằng code hiện tại.
- Ưu tiên backward compatibility.
- Mọi thay đổi behavior phải có test.

---

# 2. Phase 0 — Audit codebase trước khi sửa

Claude phải tự thực hiện:

```bash
git status
git branch --show-current
find . -maxdepth 3 -type f | sort
```

Sau đó tìm:

```bash
rg -n "bot|Bot|brain|decision|strategy|belief|memory|werewolf|wolf|seer|guard|vote|kill|heal|protect|poison" .
```

Xác định:

- Bot entry point.
- Bot state.
- Bot decision engine.
- Role strategies.
- Memory/belief implementation.
- LLM provider/service.
- Game state interfaces.
- Game event model.
- Action model.
- Validation layer.
- Test suite.
- Bot simulation / bot-only mode nếu có.

### Deliverable của Phase 0

Tạo file:

```text
docs/BOT_AI_AUDIT.md
```

Nội dung:

```text
Current architecture
Relevant files
Current decision flow
Current information available to bot
Current memory model
Current belief model
Current role strategies
Current LLM responsibilities
Current weaknesses
Recommended extension points
Risks
```

Không được sửa behavior lớn trước khi hoàn thành audit.

---

# 3. Target Architecture

Kiến trúc mục tiêu:

```text
                    ┌──────────────────┐
                    │    Game Engine   │
                    └────────┬─────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │ Observation Builder  │
                  └──────────┬──────────┘
                             │
                    legal visible state
                             │
                             ▼
                  ┌─────────────────────┐
                  │    Event Memory      │
                  │                       │
                  │ claims                │
                  │ votes                 │
                  │ deaths                │
                  │ actions              │
                  │ phase transitions    │
                  │ reveals              │
                  └──────────┬────────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │ Belief Engine        │
                  │                       │
                  │ P(role | evidence)  │
                  │ suspicion score      │
                  │ confidence           │
                  └──────────┬────────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │ Candidate Generator  │
                  └──────────┬────────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │ Strategic Scorer     │
                  │                       │
                  │ immediate value      │
                  │ survival             │
                  │ team value           │
                  │ information value    │
                  │ deception value      │
                  │ future risk          │
                  └──────────┬────────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │ Role Policy          │
                  │ Wolf / Villager ...  │
                  └──────────┬────────────┘
                             │
                             ▼
                       Selected Action
                             │
                    ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
              Game Engine         LLM Dialogue
                                  (verbalize only)
```

---

# 4. Observation Layer

Tạo hoặc refactor thành một abstraction tương đương:

```ts
interface BotObservation {
  self: {
    playerId: string;
    role: string;
    alive: boolean;
  };

  phase: string;
  day: number;

  visiblePlayers: VisiblePlayer[];

  publicEvents: PublicGameEvent[];

  privateInformation: PrivateInformation;

  legalActions: LegalAction[];

  currentDiscussion?: DiscussionContext;
}
```

Tên interface phải được điều chỉnh theo codebase thực tế.

### Nguyên tắc

Bot chỉ nhận:

- public information;
- thông tin riêng của role;
- lịch sử mà player hợp pháp có thể biết.

Không truyền raw full game state nếu raw state chứa secret information.

---

# 5. Event Memory

Cần có memory theo event, không chỉ lưu text cuối cùng.

Ví dụ:

```ts
interface BotMemoryEvent {
  gameTick: number;
  phase: string;
  type: string;
  actorId?: string;
  targetId?: string;
  payload: Record<string, unknown>;
  visibility: "public" | "private";
}
```

Lưu ít nhất:

### Discussion

```text
player A claim Seer
player B accuse A
player C defend B
```

### Voting

```text
A -> B
B -> C
C -> B
```

### Death

```text
Player C died
```

### Reveal

```text
Player C was Seer
```

### Night actions

Bot chỉ lưu những gì player hiện tại biết hợp pháp.

---

# 6. Belief Engine

Đây là nâng cấp quan trọng nhất.

Bot cần maintain:

```text
P(role = Werewolf | evidence)
P(role = Seer | evidence)
P(role = Villager | evidence)
...
```

Ví dụ:

```json
{
  "player-2": {
    "werewolf": 0.72,
    "seer": 0.18,
    "villager": 0.10
  },
  "player-5": {
    "werewolf": 0.16,
    "seer": 0.62,
    "villager": 0.22
  }
}
```

Có thể bắt đầu bằng heuristic Bayesian-like update, chưa cần ML.

### Evidence cần tính

- claim role;
- counter claim;
- voting pattern;
- target selection;
- consistency giữa lời nói và hành động;
- thay đổi vote;
- bảo vệ player đáng nghi;
- accuse nhưng không vote;
- vote theo majority;
- timing của claim;
- prediction đúng/sai;
- reaction khi teammate chết;
- night kill pattern;
- confirmed role reveal.

### Không được

Dùng giá trị tuyệt đối kiểu:

```text
if player accused X => X is wolf
```

Belief phải là cumulative evidence.

---

# 7. Evidence Model

Tạo abstraction tương đương:

```ts
interface Evidence {
  sourceEventId: string;
  subjectPlayerId: string;
  kind: string;
  direction: "wolf" | "innocent" | "roleSpecific";
  weight: number;
  confidence: number;
  reason: string;
}
```

Ví dụ:

```text
Player A claims Seer
→ evidence: possible_seer
→ weight +0.25

Player B counter-claims Seer
→ A seer probability decreases
→ B seer probability increases

Player A's claimed inspection later matches confirmed role
→ increase A credibility
```

Weights phải tập trung trong config/strategy constants, không rải magic numbers khắp code.

---

# 8. Suspicion Model

Belief không chỉ là role probability.

Cần có:

```ts
interface PlayerAssessment {
  suspicion: number;       // 0..1
  trust: number;           // 0..1
  roleProbabilities: Record<string, number>;
  credibility: number;     // 0..1
  threat: number;          // 0..1
  teammateProbability?: number;
  reasons: AssessmentReason[];
}
```

Ví dụ:

```text
suspicion = 0.81
trust = 0.18
credibility = 0.34
threat = 0.90
```

### Phân biệt:

- suspicion: có khả năng là wolf hay không;
- threat: nếu để sống thì nguy hiểm đến mức nào;
- credibility: lời nói của player có đáng tin không;
- trust: bot có muốn hỗ trợ player đó không.

---

# 9. Role-specific Strategy

Không được dùng một decision algorithm cho mọi role.

## Werewolf

Mục tiêu:

```text
1. survive
2. kill high-value role
3. hide wolf team
4. shape voting
5. avoid exposing wolf team
6. manipulate belief
```

Bot cần cân nhắc:

```text
kill target score =
  role value
+ threat
+ influence
+ information risk
- kill attribution risk
- teammate exposure risk
```

### Quan trọng

Không phải lúc nào kill player "nguy hiểm nhất" cũng đúng.

Ví dụ:

```text
Seer = high value
Leader = high influence
Quiet villager = low influence
```

Có thể lựa chọn Leader thay Seer nếu:

- Seer chưa có credibility;
- Leader đang gom vote;
- giết Leader khiến village chia rẽ;
- kill Seer quá dễ bị suy ra.

---

## Villager

Mục tiêu:

```text
1. find wolves
2. avoid mislynch
3. protect high-confidence good players
4. extract information
5. vote coherently
```

Vote score:

```text
voteScore =
  suspicion
+ threat
+ contradiction
+ suspicious voting
+ suspicious protection
+ failed claims
- credibility
- confirmed-good evidence
```

---

## Seer

Mục tiêu:

```text
1. maximize information value
2. survive long enough
3. decide when to reveal
4. build credible claim
```

Target inspection:

```text
inspectionValue =
  wolfProbabilityUncertainty
  * futureImpact
  * survivalOpportunity
```

Không phải lúc nào inspect player có suspicion cao nhất cũng tốt.

---

## Guardian

Mục tiêu:

```text
protect expected high-value target
```

Score:

```text
protectScore =
  expectedRoleValue
+ wolfTargetProbability
+ influence
+ survivalImportance
```

---

## Các role khác

Phải đọc role definitions thực tế trong repo và tạo strategy tương ứng.

Nếu role chưa có strategy riêng:

```text
fallback → generic decision engine
```

không crash.

---

# 10. Candidate Action Generator

Thay vì:

```text
if wolf => killMostSuspicious()
```

hãy tạo candidates:

```text
[
  {
    action: "KILL",
    target: "player-2"
  },
  {
    action: "KILL",
    target: "player-5"
  },
  {
    action: "KILL",
    target: "player-7"
  }
]
```

Sau đó score từng candidate.

Generic:

```ts
interface CandidateAction {
  action: LegalAction;
  score: number;
  reasons: string[];
  confidence: number;
}
```

---

# 11. Strategic Scoring

Tạo scorer có thể mở rộng:

```ts
scoreAction({
  candidate,
  observation,
  assessments,
  memory,
  roleStrategy,
})
```

Score nên gồm:

```text
Immediate Utility
+
Survival Utility
+
Information Utility
+
Team Utility
+
Deception Utility
-
Future Risk
-
Exposure Risk
```

Không hard-code một công thức duy nhất cho tất cả roles.

---

# 12. Long-term Planning

Ít nhất phải có look-ahead đơn giản:

```text
action
→ predicted outcome
→ next phase risk
```

Ví dụ Werewolf:

```text
KILL Seer
→ Seer dies
→ but death is highly attributable to wolf strategy
→ tomorrow village suspicion increases on player X
```

Do đó score action phải có future consequence.

Không cần MCTS ở phase đầu.

Có thể để abstraction mở:

```ts
interface StrategicPlanner {
  evaluate(action: CandidateAction, context: StrategyContext): ActionEvaluation;
}
```

Sau này mới thay implementation bằng MCTS/RL/value model.

---

# 13. Communication Strategy

LLM KHÔNG quyết định game action.

Pipeline:

```text
Decision Engine
    ↓
Selected action
    ↓
Reason / intent
    ↓
LLM
    ↓
Natural language
```

Ví dụ engine:

```json
{
  "action": "VOTE",
  "target": "player-5",
  "confidence": 0.78,
  "reasons": [
    "late role claim",
    "voting contradiction",
    "defended player-2 without evidence"
  ]
}
```

LLM được yêu cầu:

```text
Generate a natural Vietnamese statement that supports this decision.

Rules:
- do not invent hidden information
- do not reveal internal probability numbers
- do not claim certainty if evidence is weak
- do not change the chosen action
- sound like a player in a social deduction game
```

---

# 14. Bot Personality

Bot nên có personality profile để tránh tất cả bot nói giống nhau.

Ví dụ:

```ts
interface BotPersonality {
  aggression: number;
  verbosity: number;
  skepticism: number;
  leadership: number;
  deception: number;
  consistency: number;
  emotionality: number;
}
```

Các archetype:

```text
Analyst
Leader
Aggressive
Quiet
Skeptic
Manipulator
Defensive
Chaotic
```

Personality chỉ ảnh hưởng:

- communication style;
- tie-break preference;
- risk preference;
- discussion behavior.

Không được làm personality phá luật.

---

# 15. Deception cho Werewolf

Werewolf cần khả năng:

```text
- claim role
- soft claim
- defend teammate
- distance teammate
- intentionally agree with village
- fabricate plausible reasoning
```

Nhưng tất cả phải được giới hạn bởi strategy engine.

Ví dụ:

```text
Engine:
  Claim = SEER
  Claimed target = Player 5
  Report = "good"

LLM:
  diễn đạt claim
```

LLM không tự tạo hidden target.

---

# 16. Information Integrity

Tạo test để đảm bảo:

### Villager không biết

```text
wolf identities
seer private inspections
wolf chat
wolf planned kill
```

### Wolf biết

```text
teammate wolves
legal night information
```

### Seer biết

```text
own inspection results
```

### Guardian biết

```text
own protection action
```

Các quyền này phải được enforce từ observation builder.

---

# 17. Determinism

Nếu project đã có seed:

```text
same game seed
+ same bot version
+ same inputs
=
same decisions
```

Không để `Math.random()` rải khắp decision code.

Tạo RNG dependency:

```ts
interface BotRandom {
  next(): number;
  pick<T>(items: T[]): T;
}
```

---

# 18. Backward Compatibility

Giữ API public hiện tại.

Có thể expose:

```ts
BotBrainV2
```

nhưng adapter về interface cũ:

```text
Existing Bot Interface
        ↓
BotBrainV2 adapter
```

Không sửa toàn bộ server nếu không cần.

---

# 19. Testing

Bắt buộc có unit tests cho:

## Belief

```text
claim
counter claim
confirmed role
vote evidence
death evidence
```

## Strategy

```text
werewolf kill selection
villager vote selection
seer inspection
guardian protection
```

## Information leakage

```text
villager cannot access wolf identities
seer cannot access wolf chat
```

## Decision determinism

```text
same seed => same result
```

## Regression

```text
old bot behavior tests still pass
```

---

# 20. Simulation Harness

Nếu chưa có thì tạo command tương đương:

```bash
npm run simulate -- --games 1000
```

Có thể thêm:

```bash
npm run simulate -- --games 10000 --bot-version=v2
```

Output:

```json
{
  "games": 10000,
  "villageWinRate": 0.53,
  "wolfWinRate": 0.47,
  "averageGameLength": 7.2,
  "seerSurvivalRate": 0.41,
  "wolfVoteAccuracy": 0.62
}
```

Tên command phải theo package manager/codebase thực tế.

---

# 21. Benchmark Bot V1 vs V2

Bắt buộc giữ baseline.

Chạy:

```text
V1 vs V1
V2 vs V2
V1 mixed V2
```

Ít nhất:

```text
1,000 games
```

trước khi kết luận.

Metrics:

```text
overall win rate
win rate by role
average survival
correct wolf detection
mislynch rate
successful deception
night target quality
role survival
vote concentration
```

Nếu có bot-only engine thì benchmark không cần frontend.

---

# 22. Anti-cheat / Hidden State Audit

Claude phải search toàn bộ đường dữ liệu:

```text
game state
→ bot constructor
→ bot decision
→ prompt builder
```

Đảm bảo prompt LLM cũng không chứa hidden state trái phép.

Đặc biệt:

```text
FULL_GAME_STATE
ALL_ROLES
PRIVATE_WOLF_STATE
```

không được đưa vào generic prompt.

---

# 23. Logging / Explainability

Mỗi quyết định bot nên có internal debug record:

```json
{
  "phase": "DAY_VOTE",
  "action": "VOTE",
  "target": "player-5",
  "confidence": 0.78,
  "topReasons": [
    "late role claim",
    "inconsistent vote",
    "low credibility"
  ]
}
```

Không nhất thiết hiển thị cho user.

Production log có thể disable verbose reasoning.

---

# 24. Performance

Không được làm:

```text
LLM call cho mọi internal calculation
```

LLM chỉ gọi khi cần lời thoại hoặc interaction.

Belief/strategy phải chạy local và nhanh.

Mục tiêu:

```text
Decision latency < 50ms
```

cho deterministic layer trong điều kiện bình thường.

LLM latency không tính vào target này.

---

# 25. Persistence

Bot memory chỉ sống theo game.

Không được vô tình leak memory:

```text
game A
→ game B
```

Mỗi game:

```text
new BotMemory()
new BeliefState()
```

Nếu có persistent learning sau này, phải tách hoàn toàn khỏi runtime memory.

---

# 26. Không train ML ngay ở phase này

Phase này chưa cần:

```text
PyTorch
TensorFlow
RL
GPU training
```

Hãy tạo architecture để sau này có thể thay:

```text
HeuristicBeliefEngine
```

bằng:

```text
LearnedBeliefModel
```

và:

```text
StrategicScorer
```

bằng:

```text
RLPolicy
```

Interface phải được thiết kế để thay implementation.

---

# 27. Extension point cho ML/RL sau này

Định nghĩa abstraction:

```ts
interface PolicyModel {
  selectAction(
    observation: BotObservation,
    candidates: CandidateAction[],
  ): Promise<PolicyDecision>;
}
```

Hiện tại:

```text
HeuristicPolicyModel
```

Sau này:

```text
RLPolicyModel
```

hoặc:

```text
TransformerPolicyModel
```

Không để game engine phụ thuộc trực tiếp vào PyTorch/LLM.

---

# 28. Recommended folder structure

Chỉ áp dụng nếu phù hợp codebase:

```text
bots/
├── core/
│   ├── BotBrain.ts
│   ├── observation/
│   ├── memory/
│   ├── belief/
│   ├── assessment/
│   ├── candidate/
│   ├── scoring/
│   └── planning/
│
├── roles/
│   ├── werewolf/
│   ├── villager/
│   ├── seer/
│   ├── guardian/
│   └── ...
│
├── personality/
├── dialogue/
├── simulation/
└── tests/
```

Không di chuyển file hàng loạt nếu không mang lại lợi ích rõ ràng.

---

# 29. Implementation order

Claude phải làm theo thứ tự:

### Step 1

Audit current bot.

### Step 2

Tạo characterization tests cho bot hiện tại.

### Step 3

Refactor Observation/Memory nếu cần.

### Step 4

Implement Belief Engine.

### Step 5

Implement PlayerAssessment.

### Step 6

Implement CandidateActionGenerator.

### Step 7

Implement StrategicScorer.

### Step 8

Tách role strategies.

### Step 9

Tách LLM dialogue khỏi action selection.

### Step 10

Add personality.

### Step 11

Add simulations.

### Step 12

Benchmark V1 vs V2.

### Step 13

Fix regressions.

### Step 14

Document architecture.

---

# 30. Acceptance Criteria

Feature được coi là hoàn thành khi:

- [ ] Bot có memory theo event.
- [ ] Bot có belief per player.
- [ ] Belief được update sau event.
- [ ] Bot có assessment riêng cho từng player.
- [ ] Bot generate nhiều candidate actions.
- [ ] Bot score candidate thay vì dùng một rule đơn.
- [ ] Strategy khác nhau theo role.
- [ ] LLM không tự quyết action.
- [ ] Personality hoạt động.
- [ ] Không có hidden information leakage.
- [ ] Có unit tests.
- [ ] Có simulation.
- [ ] Có benchmark V1 vs V2.
- [ ] Không phá game engine.
- [ ] Existing tests pass.
- [ ] Có docs giải thích architecture mới.

---

# 31. Quality Bar

Đừng chỉ làm:

```text
if suspicion > 0.5:
    vote player
```

hoặc:

```text
sort by suspicion
take first
```

Đó chỉ là cosmetic upgrade.

Bot mới phải thể hiện được các hành vi:

```text
- giữ nhiều giả thuyết cùng lúc
- đổi belief khi có evidence mới
- phân biệt "đáng nghi" và "nguy hiểm"
- cân nhắc lợi ích tương lai
- hiểu voting pattern
- hiểu claim/counter-claim
- không blindly follow majority
- biết lúc nào nên im lặng
- biết lúc nào nên tạo pressure
- wolf biết distance teammate
- wolf biết sacrifice teammate khi cần
- seer biết cân bằng information vs survival
```

---

# 32. Future Phase — Self-play / RL

Sau khi heuristic bot ổn định:

```text
Bot Environment
      ↓
100k+ simulated games
      ↓
Replay Dataset
      ↓
Policy / Value Training
      ↓
New Bot
      ↓
Self-play
```

Có thể học:

```text
action policy
value function
role inference
dialogue strategy
```

Nhưng KHÔNG triển khai RL trong cùng PR với heuristic upgrade trừ khi codebase đã sẵn sàng.

---

# 33. Claude Code working instructions

Khi bắt đầu, hãy output:

```text
1. Current bot architecture
2. Files involved
3. Current decision flow
4. Biggest 5 weaknesses
5. Proposed changes
6. Risks
```

Sau đó implement theo từng phase nhỏ.

Sau mỗi phase:

```text
- Run tests
- Run typecheck
- Run lint if available
- Show changed files
- Explain why each change exists
```

Không tạo "god class".

Không nhồi tất cả logic vào `BotBrain`.

Ưu tiên composition:

```text
BotBrain
 ├── ObservationBuilder
 ├── Memory
 ├── BeliefEngine
 ├── AssessmentEngine
 ├── CandidateGenerator
 ├── Strategy
 ├── Scorer
 └── DialogueService
```

---

# 34. First task for Claude

**BẮT ĐẦU TỪ ĐÂY.**

Không sửa code ngay.

1. Inspect repo.
2. Xác định chính xác implementation hiện tại.
3. Tạo `docs/BOT_AI_AUDIT.md`.
4. Viết characterization tests cho behavior hiện tại.
5. Đề xuất migration plan dựa trên code thật.
6. Sau đó mới bắt đầu Phase 1.
7. Mỗi thay đổi phải nhỏ, có test và giữ backward compatibility.

Mục tiêu cuối cùng không phải làm bot "nói hay hơn", mà là làm bot:

```text
SEE → reason
KILL → reason
VOTE → reason
PROTECT → reason
CLAIM → reason
DEFEND → reason
ACC– USE → reason
```

và các quyết định đó phải xuất phát từ:

```text
Observation
+ Memory
+ Belief
+ Role Strategy
+ Risk
+ Future Consequence
```

thay vì chỉ từ một vài if/else cố định.
