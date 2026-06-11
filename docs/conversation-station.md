# Echo AI 对话工位 —— 实现细则（Implementation Detail）

> [`learning-method.md`](./learning-method.md) §4-P5 的可落地展开。不引入新原理，只把"带脚手架的陪练 + 对话既是测试也是来源"具体化。冲突时以 `learning-method.md` 与根 `CLAUDE.md` 为准。这是最大的一块，**独立成一个路线图大步**。
>
> **每条都给「现状 → 目标」并点名真实文件。**

---

## 1. 一句话

对话工位是 Echo 从"AI 闪卡"变成"AI 陪练"的那一环。它做两件事：(a) 在自动调节的脚手架下，让学习者把已掌握的句子**用出来**（达阶段 3）；(b) 把对话中暴露的缺口与成功作为事件回流——失败进卡组(P4)、说对了晋级、想说说不出变新岛句子(P1)。

- **现状**：`src/components/Assistant.tsx` 是常驻面板，但只有两种**单轮**模式：`island`(描述场景→生成岛，走 inbox+`/v1/scenario`) 与 `ask`(提问→`/v1/ask` 单答)。**不是多轮对话、无脚手架、不回流。**
- **目标**：在它之上加一个**多轮对话模式**，复用现有 `/v1/judge` 判定 + inbox/cards 回流 + 新增一个 `conversation` 后端 `task`（宪法原则五）。

---

## 2. 三档脚手架（Scaffolding Levels）

脚手架强度**由系统按掌握度自动调节，用户不手选**（宪法原则一）。**按岛独立**——同一用户可能在"工作"岛已 L3、"看医生"岛仍 L1。

| 档位 | AI 行为 | 卡住时给什么 | 适用 |
|---|---|---|---|
| `L1` 引导式 | 问重复性 Q&A，把话题引向已掌握的岛，**给句子开头** | 直接给句子开头/模板 | 该岛多数句在阶段 1–2 |
| `L2` 提示式 | 就话题对话，**撤掉开头**，必要时介入 | 给提示（关键词/结构），不给答案 | 该岛多数句达阶段 2 |
| `L3` 开放式 | 自由对话，**对话中不打断**，事后纠正 | 不实时给（事后小结给） | 该岛出现阶段 3 句，或整体巩固期 |

**升降档（按岛滚动统计，最近 ≥10 轮；带滞后防抖动）**：
- `L1→L2`：该岛阶段-2 占比 ≥60% 且 `stallRate` <30%
- `L2→L3`：出现 ≥1 句阶段 3 且 `deployRate` ≥50% 且 `stallRate` <20%；跌回条件 `stallRate` ≥50%→L1
- `L3` 维持；`deployRate` <30% 或 `stallRate` ≥40% → 回 L2

掌握度直接读 `ReviewState.masteryStage`（P4 已落地的字段）。

---

## 3. 对话事件契约（Conversation Turn Result）

对话工位对外唯一接口——所有回流都走它。

```ts
type ScaffoldLevel = 'L1' | 'L2' | 'L3';

interface ConversationTurnResult {
  turnId: string;
  islandId: string;
  scaffoldLevel: ScaffoldLevel;
  utterance: string;                 // 学习者这轮说的
  outcome:
    | 'DEPLOYED'        // 自发正确用出 → 晋级阶段 3
    | 'PRODUCED_OK'     // 说对但在脚手架/提示内 → 巩固，不到 3
    | 'ERROR'           // 说错 → 进卡组(P4)
    | 'STALL'           // 想说说不出 → 回流成新岛句子(P1)
    | 'PRONUNCIATION';  // 内容对发音问题 → 回 P3 阶段1
  matchedCardId?: string;            // 匹配到的现有句子（sentenceId）
  errorTags?: ErrorTag[];            // 失败时，与 srs-error-deck.md 同构
  intendedMeaning?: string;          // STALL 时本想表达的意思（母语），用于造新句
  pronunciationScore?: number;
  latencyMs: number;
}
```

**outcome → 系统动作**：

| outcome | 动作 | 复用的现有代码 |
|---|---|---|
| `DEPLOYED` | `matchedCardId` 的 `ReviewState.masteryStage=3`；FSRS `Good/Easy`；计北极星 | `upsertReview`（`src/lib/db.ts`） |
| `PRODUCED_OK` | 不到 3；FSRS `Good`；维持档位统计 | 同上 |
| `ERROR` | 降一阶 + 写 `errorTags`；按 `srs-error-deck.md` §4 送相应阶段 | judge + `upsertReview` |
| `STALL` | 用 `intendedMeaning` 生成 `source:'conversation'` 新岛句子（阶段 0）；不罚现有卡 | `compose` + `addSentenceToIsland`（`src/lib/cards.ts`） |
| `PRONUNCIATION` | 回阶段 1 发音微练习（仅该音） | P3 |

**判定要点**：`DEPLOYED` 与 `PRODUCED_OK` 的区别 = 是否在脚手架/提示之外自发产出。L1 下基本判不了 `DEPLOYED`（开头是 AI 给的）。这条边界直接决定北极星诚不诚实，须写进 `conversation` 任务的提示词。

---

## 4. 北极星指标的计算

把"从未练过的新句子"落成可统计事件。**计入条件（全满足）**：① `outcome==='DEPLOYED'`；② `scaffoldLevel!=='L1'`；③ 该句**首次**在对话中自发用出（用 `matchedCardId` 去重；无匹配的临场全新表达计"全新产出"，最高权重）。

**禁止计入**（宪法原则一精神 + `learning-method.md` §7）：复习完成数、掌握句子总数、连胜、L1 产出。

副指标：每岛脚手架档位分布、`stallRate` 趋势（降=越来越敢说）、`STALL→新句子` 回流量（岛生长速率）、`errorTags` Top-N（来自 `srs-error-deck.md` §5）。

---

## 5. 后端任务与流程

- **新增 `conversation` task**（`server/src/config.ts` 的 `LlmTask` union + `TASK_ROUTING` + `PROVIDER_MODELS`；`llm/prompts.ts` 加 `buildConversationPrompt`；`llm/schema.ts` 加 schema；`llm/index.ts` 加 `conversation()`；`routes/` 加一条；两边 `contracts.ts` 镜像）。判定可复用现有 `judge` 任务（一轮发话 = 一次 judge + 一次对话推进）。
- **同步还是异步**：对话是交互式低延迟，**走同步**（像现有 `/v1/judge`、`/v1/ask`），不进 `/v1/jobs` 队列。
- **L1/L2 可实时轻介入；L3 对话中不打断，纠正集中到事后小结**——保护"敢说"。

```
开始对话(islandId):
  level = 读该岛滚动统计的档位
  AI 按 level 开场（L1 给开头 / L2 自然提问 / L3 自由）
  每一轮:
    学习者发话 → utterance, latencyMs（可接 MicButton 语音输入）
    judge + 对话推进 → ConversationTurnResult
    按 §3 映射执行：升降 masteryStage / 写 errorTags / 回流新句
    STALL 且 level 允许 → 即时给提示
    更新该岛 deployRate/stallRate
  结束:
    按 §2 阈值重算档位（含滞后）
    事后小结：纠正项、新增回流句子、本轮计入北极星的产出
    更新北极星周统计
```

---

## 6. 验收标准

- 脚手架按岛独立、按 `masteryStage` 自动调节，无用户手选入口；升降有滞后、不抖动。
- 每轮发话产出一个 `ConversationTurnResult`，严格走 §3 回流到 P1/P3/P4。
- `STALL` 的 `intendedMeaning` 确实生成 `source:'conversation'` 新岛句子（阶段 0），不罚现有卡。
- `DEPLOYED` 仅在非 L1 且自发时判定；北极星严格按 §4 去重，L1 产出不计入。
- L3 对话中不实时打断；纠正集中在事后小结。
- 新任务在 `server/` 加 `task`、复用中间层，不另起服务（宪法原则五）。
