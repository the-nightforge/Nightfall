# BOT AI CONTINUOUS IMPROVEMENT SPEC
## Ma Sói Online — Upgrade from Advanced Heuristic Bot to Strong Strategic Agent

> The current project already has a mature deterministic bot architecture:
> KnowledgeView → Memory → Belief → Analysis → Candidate Actions → Scoring → Role Strategy → Action.
> It also has deterministic replay, self-play tooling, role-specific strategies, controlled LLM dialogue, and knowledge-isolation safeguards.
>
> **DO NOT rebuild these systems from scratch.**
> The goal is to continue improving the existing bot toward a stronger strategic agent.

---

## 1. Current assessment

Treat the current implementation as:

- Advanced deterministic social-deduction agent
- Event memory
- Belief / suspicion model
- Role-specific heuristic strategies
- LLM verbalization
- Self-play / replay tooling

It is **not yet a fully learned game-playing AI**.

Main gaps:

1. Belief is mainly scalar suspicion/trust rather than a coherent probability model.
2. Player dependencies are not modeled strongly enough.
3. Long-horizon planning is limited.
4. Wolf team coordination is mostly deterministic rather than strategic.
5. Self-play measures the policy but does not yet train the policy.
6. Dialogue intelligence is sometimes stronger than strategic planning.

---

## 2. Non-negotiable constraints

Before touching code:

- Read the actual repository.
- Read existing bot audit/tuning documents.
- Read relevant tests.
- Preserve game rules.
- Preserve deterministic replay where possible.
- Preserve knowledge isolation.
- Do not leak hidden state.
- Do not let LLM directly choose game actions.
- Do not replace working components without measurable reason.
- Do not add ML frameworks prematurely.
- Every significant behavior change requires tests.
- Compare against the current bot as baseline.

Use the current implementation as:

`BOT_V_CURRENT`

---

## 3. Phase 0 — Repository audit

Inspect the real codebase first.

Useful commands:

```bash
git status
git branch --show-current
find . -maxdepth 4 -type f | sort
rg -n "BotBrain|belief|suspicion|trust|memory|candidate|strategy|score|selfplay|replay|wolf|seer|guard|vote|claim" .
```

Read:

- bot audit documentation
- bot tuning documentation
- current bot implementation
- game engine interfaces
- role definitions
- self-play tooling
- test suites

Create/update:

```text
docs/BOT_AI_CONTINUOUS_IMPROVEMENT.md
```

Record:

- Current pipeline
- Current interfaces
- Existing extension points
- Current metrics
- Known weaknesses
- Files that should change
- Files that should not change

Do not perform a large refactor before the audit is complete.

---

## 4. Target architecture

Keep the existing high-level architecture, extending it toward:

```text
Game Engine
    ↓
Knowledge View
    ↓
Observation Builder
    ↓
Event Memory
    ↓
Probabilistic Belief Engine
    ↓
Player / Team Assessment
    ↓
Candidate Action Generator
    ↓
Counterfactual Strategic Planner
    ↓
Role Policy
    ↓
Policy / Action Selector
    ↓
Action
    ↓
LLM Dialogue Verbalizer
```

For wolves:

```text
Wolf Private State
    ↓
Team Belief
    ↓
Team Planning
    ↓
Coordinated Individual Actions
```

---

## 5. Upgrade #1 — Probabilistic belief

Current scalar values such as:

```text
suspicion = 0..100
trust = 0..100
```

should evolve toward:

```text
P(role | evidence)
```

per player.

Example:

```json
{
  "player-2": {
    "WEREWOLF": 0.72,
    "SEER": 0.18,
    "VILLAGER": 0.10
  }
}
```

Create an abstraction equivalent to:

```ts
interface RoleBelief {
  playerId: string;
  probabilities: Record<string, number>;
  confidence: number;
  updatedAtEventId?: string;
}
```

And:

```ts
interface BeliefState {
  getRoleProbability(playerId: string, role: string): number;
  getWolfProbability(playerId: string): number;
  getTeamProbability(playerId: string, team: string): number;
  update(evidence: Evidence): void;
}
```

Use actual project types and names rather than blindly copying these examples.

---

## 6. Evidence updating

Important events should become evidence:

```text
ROLE_CLAIM
COUNTER_CLAIM
VOTE_CAST
VOTE_CHANGED
LATE_VOTE
DEFEND
ACCUSE
PLAYER_DIED
ROLE_REVEAL
SEER_RESULT
NIGHT_RESULT
```

Examples:

```text
Player A claims Seer
→ increase P(A = Seer)
→ decrease incompatible roles

Player B counter-claims Seer
→ both claims become competing hypotheses

A's inspection history later matches a revealed role
→ increase A credibility

A makes an impossible claim
→ decrease A credibility
```

Centralize evidence weights. Do not scatter magic numbers throughout the code.

---

## 7. Role consistency constraints

Belief should use actual game setup constraints.

Examples:

```text
limited Seer count
limited Werewolf count
dead players cannot remain living roles
revealed role becomes certain
role-specific results constrain possibilities
```

Never hard-code role counts when the game engine already has role configuration.

---

## 8. Player dependency model

Independent suspicion scores are insufficient.

Add pairwise reasoning where practical.

Example:

```text
A and B repeatedly defend each other
and have correlated votes.

This should affect:
P(A,B both wolves)
```

A possible abstraction:

```ts
interface PlayerPairAssessment {
  playerA: string;
  playerB: string;
  wolfPairScore: number;
  allyScore: number;
  conflictScore: number;
  evidence: AssessmentReason[];
}
```

Start with pairwise compatibility. Do not build a full Bayesian network unless benchmarks justify it.

---

## 9. Distinguish player dimensions

Do not collapse all evidence into one score.

Maintain separate concepts:

```text
wolfProbability
roleProbabilities
suspicion
threat
credibility
influence
cooperationValue
survivalImportance
```

Example:

```text
A:
wolfProbability = 0.45
threat = 0.90
credibility = 0.80

B:
wolfProbability = 0.70
threat = 0.30
credibility = 0.20
```

B can be more likely a wolf while A is the better immediate target.

---

## 10. Upgrade #2 — Counterfactual action evaluation

Evolve:

```text
score(action)
```

toward:

```text
expectedOutcome(action)
```

Create an abstraction equivalent to:

```ts
interface ActionEvaluation {
  action: CandidateAction;
  immediateValue: number;
  survivalValue: number;
  informationValue: number;
  teamValue: number;
  deceptionValue: number;
  futureRisk: number;
  expectedWinValue: number;
  confidence: number;
  reasons: string[];
}
```

---

## 11. One-step lookahead first

Do not jump straight to deep MCTS.

Start with:

```text
Current state
   ↓
candidate action
   ↓
predicted immediate outcome
   ↓
next-phase evaluation
```

For example:

```text
VOTE A
→ A eliminated
→ role reveal
→ beliefs update
→ predict next day/night
```

Use expected outcomes rather than deterministic fantasy.

---

## 12. Information value

Some actions are valuable because they create information.

Examples:

- Seer inspection
- Targeted accusation
- Pressure on a suspicious player
- Allowing competing claims to interact
- Deliberately challenging majority

Approximate:

```text
informationValue =
expected uncertainty reduction
```

Entropy-based approximation is acceptable, but do not add complexity without benchmarks.

---

## 13. Upgrade #3 — Discussion strategy

Track:

```text
who initiated pressure
who joined
who defended
who stayed silent
who changed position
who followed majority
who challenged the majority
```

Build a discussion graph where useful:

```text
A → accuses B
C → defends B
D → questions A
E → follows C
```

Treat evidence incrementally.

Do not assume:

```text
defend(B) => C is wolf
```

Instead:

```text
defend(B)
→ weak evidence

+
vote alignment
+
contradictions
→ stronger evidence
```

---

## 14. Upgrade #4 — Wolf team coordination

Current deterministic wolf coordination should evolve into strategic planning while remaining deterministic/replayable.

Create a concept similar to:

```ts
interface WolfTeamPlan {
  primaryKillTarget?: string;
  backupKillTarget?: string;
  discussionLeader?: string;
  claimant?: string;
  distancingPlayers: string[];
  sacrificeCandidate?: string;
  immediateObjective: string;
}
```

Only wolves may see team-private planning.

---

## 15. Wolf team objectives

Evaluate:

```text
1. survive
2. reduce village information
3. eliminate high-value roles
4. preserve wolf majority
5. maintain plausible narratives
6. avoid correlated wolf behavior
7. prepare future voting states
```

Do not force every wolf to act identically.

---

## 16. Wolf role assignment

Possible internal jobs:

```text
Leader
Bluffer
Quiet wolf
Sacrifice wolf
Information wolf
Dominator
```

Assign dynamically using existing personality and assessment infrastructure.

Example:

```text
Wolf A has high credibility
→ primary speaker

Wolf B has high suspicion
→ avoid leading

Wolf C has low suspicion
→ can push a vote
```

---

## 17. Wolf distancing

Compare options:

```text
defend teammate
ignore teammate
vote teammate
fake conflict
```

against future risk.

Example:

```text
Defend teammate:
+ immediate survival
- future association risk

Vote teammate:
- lose one wolf
+ credibility
+ potential late-game advantage
```

The scorer should evaluate the tradeoff rather than always choosing the same behavior.

---

## 18. Upgrade #5 — Personality affects strategy

Personality should influence:

```text
risk tolerance
vote threshold
likelihood of leading
likelihood of challenging majority
deception preference
information-seeking
```

Example:

```text
Aggressive:
lower accusation threshold

Conservative:
prefers stronger evidence

Manipulator:
higher deception/social-pressure utility

Analyst:
higher information utility
```

Do not make one personality objectively stronger by default.

---

## 19. LLM boundary

Keep:

```text
LLM does not select legal game action.
```

Correct:

```text
Strategy
→ selected action
→ structured intent
→ LLM
→ speech
```

Incorrect:

```text
Game state
→ prompt
→ LLM says "vote player 4"
→ engine executes it
```

LLM may:

- verbalize;
- ask questions;
- phrase accusations;
- create natural dialogue;
- choose among pre-approved communication intents.

LLM may NOT:

- invent hidden information;
- mutate game state;
- bypass legality;
- override selected action.

---

## 20. Dialogue intent

Use an abstraction similar to:

```ts
interface DialogueIntent {
  type:
    | "ACCUSE"
    | "DEFEND"
    | "QUESTION"
    | "CLAIM"
    | "PRESSURE"
    | "AGREE"
    | "DISAGREE"
    | "SUMMARIZE";

  targetId?: string;
  strength: number;
  evidenceIds: string[];
}
```

LLM receives only permitted evidence.

---

## 21. No fabricated evidence

Enforce:

```text
Never claim knowledge the player does not possess.
Never claim an inspection result that was not observed.
Never invent votes, deaths, or statements.
Never reveal private team information unless rules permit it.
```

Validate structured LLM output after generation.

---

## 22. Self-play becomes training data

Current self-play is useful but should eventually evolve:

```text
simulate
→ collect trajectories
→ analyze
→ optionally train learned components
→ evaluate
```

Trajectory example:

```json
{
  "gameId": "...",
  "seed": "...",
  "playerId": "...",
  "role": "...",
  "turn": 12,
  "observation": {},
  "legalActions": [],
  "candidates": [],
  "selectedAction": {},
  "reward": 0,
  "finalWinner": "VILLAGE"
}
```

Never place hidden information into the acting bot's observation snapshot.

---

## 23. Learned components

Do not train an entire LLM first.

First candidates:

```text
1. Role probability model
2. Action value model
3. Vote prediction model
4. Target selection model
5. Dialogue intent ranking
```

Keep legality and information boundaries deterministic.

---

## 24. Hybrid policy

Do not replace heuristic policy immediately.

Create:

```text
HybridPolicy
```

conceptually:

```text
finalScore =
  alpha * heuristicScore
+ beta  * learnedScore
```

Start:

```text
alpha = 1.0
beta = 0.0
```

Increase beta only when benchmark evidence supports it.

---

## 25. Reward design

For RL experiments:

```text
Win  = +1
Loss = -1
```

Then compare with shaped rewards for:

```text
survival
team objective
information gain
deception
action quality
```

Always validate against actual game win rate.

---

## 26. Benchmark protocol

Every bot version must be benchmarked with fixed seeds.

For major changes:

```text
10,000+ games
```

Compare:

```text
BOT_V_CURRENT
BOT_V_NEXT
```

Metrics:

```text
overall win rate
village win rate
wolf win rate
win rate by role
survival by role
wolf detection precision/recall
mislynch rate
vote accuracy
night target quality
claim success
deception success
average game length
```

---

## 27. Statistical significance

Do not treat tiny changes such as:

```text
51.2% → 51.4%
```

as proof.

For major policy changes:

```text
5 independent batches
× 10,000 games
```

Report mean and uncertainty where practical.

---

## 28. Scenario benchmarks

Create deterministic targeted scenarios.

### Two Seer claims

Can the bot identify the more credible claim?

### Suspicious wolf teammate

Should the wolf defend, ignore, or bus?

### Late game parity

One incorrect vote may lose the game.

### Conflicting evidence

Suspicious vote + strong claim + trusted defender.

### Social manipulation

A good player successfully pressures another good player.

Can the bot detect the manipulation?

---

## 29. Explainability

For internal debugging, expose:

```text
chosen action
top 3 reasons
belief snapshot
expected outcome
confidence
```

Example:

```json
{
  "action": "VOTE",
  "target": "player-5",
  "confidence": 0.74,
  "topReasons": [
    "counter-claim inconsistency",
    "suspicious vote alignment",
    "low credibility"
  ]
}
```

---

## 30. Performance

Deterministic decision logic target:

```text
< 50ms
```

in normal conditions, excluding network/LLM latency.

Avoid:

```text
LLM call per candidate
```

and unnecessarily high-complexity algorithms.

---

## 31. Persistence isolation

Bot runtime memory must never leak across games.

Each game starts with:

```text
new Memory()
new BeliefState()
```

Persistent learned models, if added later, must remain separate from runtime game memory.

---

## 32. Recommended implementation order

Do not implement everything in one PR.

Recommended sequence:

```text
PR 1
Probabilistic belief

PR 2
Pairwise player reasoning

PR 3
Counterfactual one-step planner

PR 4
Discussion strategy

PR 5
Wolf team planner

PR 6
Personality-driven decision behavior

PR 7
Self-play trajectory export

PR 8
Hybrid learned role/action model

PR 9
Expanded scenario benchmark
```

Each PR should contain:

```text
implementation
tests
benchmark
documentation
```

---

## 33. First implementation target

### Replace scalar role suspicion with probabilistic role belief while preserving current behavior.

Requirements:

- Keep current suspicion API if existing consumers need it.
- Derive suspicion from probability where practical.
- Maintain normalized probabilities.
- Update from evidence.
- Use actual role configuration.
- Do not immediately change action selection.
- Add tests before enabling probability-driven scoring.

Target example:

```text
Old:
suspicion[player] = 74

New:
P(player = Wolf) = 0.74
P(player = Seer) = 0.18
P(player = Villager) = 0.08

Derived:
suspicion = P(Wolf)
```

---

## 34. Second implementation target

Add pairwise reasoning.

Example:

```text
A/B relationship
↓
ally evidence
hostility evidence
vote correlation
defense correlation
shared targets
↓
pair probability / score
```

Do not let pairwise evidence completely override individual evidence.

---

## 35. Third implementation target

Implement one-step counterfactual planning.

Take existing candidate actions:

```text
candidate
→ expected next state
→ expected future risk
→ expected role/team outcome
```

Do not implement MCTS yet.

Prove benefit with targeted benchmarks.

---

## 36. Fourth implementation target

Implement Wolf Team Planner:

```text
kill target
leader
claimant
sacrifice option
backup target
distancing plan
```

Reuse existing role/personality/assessment infrastructure.

---

## 37. Fifth implementation target

Self-play learning:

```text
10k games
→ validate trajectory format

100k games
→ train baseline learned scorer

1M games
→ evaluate scaling
```

Learned models should initially act only as optional scorers.

---

## 38. What NOT to do

Do NOT:

```text
- add random behavior just to look human
- ask LLM to choose votes
- give LLM full game state
- replace deterministic engine with LLM
- add hundreds of weights without benchmarks
- treat tiny metric changes as success
- train an LLM from scratch
- introduce RL before stable simulation/trajectory data
- remove replay/determinism
- leak hidden roles for better performance
```

---

## 39. Definition of "smarter"

A bot is not smarter because it:

```text
talks more
uses longer prompts
has more if/else
```

It is smarter if it can:

```text
1. maintain multiple plausible world states
2. update beliefs from evidence
3. distinguish suspicion from threat
4. reason about player relationships
5. compare alternative future outcomes
6. coordinate with teammates
7. trade short-term and long-term value
8. exploit discussion information
9. deceive without breaking knowledge constraints
10. improve using self-play data
```

---

## 40. Acceptance criteria

- [ ] Current bot remains a working baseline.
- [ ] Belief is probabilistic.
- [ ] Role constraints are respected.
- [ ] Pairwise relationships are modeled.
- [ ] Suspicion/threat/credibility are distinct.
- [ ] One-step counterfactual planning exists.
- [ ] Wolf team planning exists.
- [ ] Personality affects decisions.
- [ ] LLM remains isolated from action authority.
- [ ] Hidden information never leaks.
- [ ] Self-play exports training trajectories.
- [ ] Hybrid learned-policy seam exists.
- [ ] Scenario benchmarks exist.
- [ ] Fixed-seed benchmark exists.
- [ ] New bot measurably beats baseline on at least one important metric without materially degrading others.
- [ ] Existing tests and replay invariants pass.
- [ ] Architecture remains modular.

---

## 41. Claude Code execution protocol

When this file is provided:

### Step 1
Inspect repository.

### Step 2
Read current bot audit/tuning docs.

### Step 3
Map actual implementation to this document.

### Step 4
Identify what already exists.

### Step 5
Do NOT recreate existing components.

### Step 6
Implement the smallest missing layer.

### Step 7
Add tests.

### Step 8
Run benchmark.

### Step 9
Compare against baseline.

### Step 10
Keep the change only if evidence supports it.

Every implementation report should include:

```text
Changed files:
...

Behavior changed:
...

Tests:
...

Benchmark:
...

Baseline:
...

New result:
...

Known limitations:
...
```

---

## 42. Ultimate target architecture

```text
                    Game Engine
                         ↓
                   Knowledge View
                         ↓
                      Memory
                         ↓
             Probabilistic Belief
             ├── Role probabilities
             ├── Player relationships
             └── Claim credibility
                         ↓
                Strategic Assessment
                         ↓
                 Candidate Actions
                         ↓
               Counterfactual Planner
                         ↓
                  Hybrid Policy
             ┌───────────┴───────────┐
             │                       │
       Heuristic model        Learned model
             └───────────┬───────────┘
                         ↓
                       ACTION
                         ↓
                  LLM Verbalization
```

Wolf team:

```text
Wolf A ─┐
Wolf B ─┼──→ Shared Team Plan ──→ Individual Policies
Wolf C ─┘
```

The long-term objective is not to make the bot complicated. It is to make its internal model of the game better than the current hand-written heuristics while preserving safety, determinism, testability, and measurable improvement.
