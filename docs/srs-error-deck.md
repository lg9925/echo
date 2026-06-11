# Echo SRS 错误卡组 —— 实现细则（Implementation Detail）

> [`learning-method.md`](./learning-method.md) §4-P4 与 §2 状态机的可落地展开。不引入新原理，只把"错误卡组 = `ReviewState` 的降级 + 重排"具体化。冲突时以 `learning-method.md` 与根 `CLAUDE.md` 为准。
>
> **每条都给「现状 → 目标」并点名真实文件。**

---

## 1. 一句话

错误卡组不是新模块——它是 `ReviewState`（`src/lib/types.ts`）在"未晋级"时的行为：**降一阶 + 打 `errorTags` + 由调度器收紧 `due`**。本文回答三件事：怎么换 FSRS、错误怎么分类、失败后送回哪一阶段。

---

## 2. 完整 ErrorType 分类法

- **现状**：`/v1/judge`（`server/src/routes/judge.ts` + `llm/prompts.ts` 的 `buildJudgePrompt`）只返回 `verdict: correct/close/wrong` + `tip` + `better`，**不分类失败原因**。入籍模块 `study.tags`（否定/数字/价值观/图片/配对，见 `src/lib/einbuergerung/tags.ts`）已证明"按类型打标 + 只练某类"在 Echo 里可行。
- **目标**：judge 额外产出 `errorTags`。`type` 驱动调度与统计，`detail` 驱动针对性练习内容。

```ts
// 加到前后端 contracts.ts 的 JudgeResult（两边都要改，二者是镜像）
interface JudgeResult {
  verdict: 'correct' | 'close' | 'wrong';   // 现有
  tip: string;                               // 现有
  better: string;                            // 现有
  errorTags?: ErrorTag[];                    // 新增
}
type ErrorType = 'WORD_ORDER' | 'MORPHOLOGY' | 'PHONEME' | 'VOCAB' | 'FLUENCY_LATENCY';
interface ErrorTag { type: ErrorType; detail?: string; count: number; lastSeen: number; }
```

| type | 含义 | 在哪个阶段检出 | detail 示例（按语言扩展） | 触发的针对性练习 |
|---|---|---|---|---|
| `WORD_ORDER` | 语序错 | 2 回忆 / 3 运用 | `verb-second`(德语 V2)、`verb-final`、`adj-noun` | 浮现同结构小岛，遮挡后重排 |
| `MORPHOLOGY` | 性/格/一致/时态/体 | 2 回忆 / 3 运用 | `gender`、`case-dative`、`agreement`、`tense-past` | 浮现只在该形态变化的最小对立对 |
| `PHONEME` | 具体音/韵律 | 1 模仿 | `umlaut-ü`、`/ʁ/`、`tone-3` | 阶段 1 发音微练习，只含该音 |
| `VOCAB` | 词汇缺口 | 2 回忆 / 3 运用 | 缺失词条 key | 该词作为阶段 0 卡预学，再回原句 |
| `FLUENCY_LATENCY` | 内容对但提取过慢 | 2 / 3 | `over-threshold` | 不降阶；缩短间隔、增加该卡频次 |

**检出来源**：`WORD_ORDER/MORPHOLOGY/VOCAB` 由 judge 的 LLM 评判产出（扩 `buildJudgePrompt` 让它顺带分类，复用现有任务，宪法原则五）；`PHONEME` 由 P3 发音评分产出（录音对比阶段先可人工/留空）；`FLUENCY_LATENCY` 由产出耗时阈值判定（`ReviewSession` 计时即可）。

---

## 3. FSRS 默认参数（换 `src/lib/sr.ts`）

- **现状**：`sr.ts` 是简化 SM-2，`schedule(prev, grade: "again"|"good", now)` 纯函数，`src/lib/CLAUDE.md` 明确写"接口冻结，方便将来换 FSRS"。`ReviewState` 有 `ease/interval/repetitions/due`。
- **目标**：换成 FSRS，**尽量保住 `schedule()` 调用点**（`ReviewSession` 不必大改）。

要点：
1. **用 FSRS 库的默认权重**，不手填魔数；目标保持率 `requestRetention = 0.90`。
2. **`ReviewState` 增量加** `stability`、`difficulty`（见 `learning-method.md` §3）；`ease/interval/repetitions` 可保留兼容或逐步弃用。Dexie 随 v5 一起增量，`reviews` 不清。
3. **评分映射（关键，呼应宪法原则二"按意思判"）**：judge 的 verdict + 失败/慢，自动映射 FSRS 的 `Again/Hard/Good/Easy`，**用户不手选**：

| Echo 结果 | FSRS rating | 同时的状态机动作 |
|---|---|---|
| 失败（硬错误：语序/形态/词汇/发音未过） | `Again` | 降一阶 + 打 tag |
| 通过但慢（`FLUENCY_LATENCY`） | `Hard` | 不降阶，留同阶强化 |
| judge `correct`/正常通过 | `Good` | 晋级一阶 |
| 远超门槛（秒答 / 发音分很高） | `Easy` | 晋级一阶，间隔更长 |

> 现有 `ReviewSession` 已把 judge 的 verdict 映射成 again/good 两档建议；这里只是把它扩成四档 + 接上 `masteryStage` 升降。

4. **参数优化时机**：单用户复习日志够多（社区经验约 ≥1000 条）后再用库的 optimizer 重算；之前一律默认权重。每语言/每用户独立。

---

## 4. 「失败类型 → 送回哪一阶段」判定表

把 §2 状态机"失败类型决定送回哪一阶段"落地。

| 当前阶段 | 检出错误 | 下一次送往 | 练什么 |
|---|---|---|---|
| 1 模仿 | `PHONEME` | 留在 1 | 该音的发音微练习 |
| 2 回忆 | `PHONEME`（音错内容对） | 回到 1 | 先修发音，过门槛再回 2 |
| 2 回忆 | `VOCAB` | 回到 0（仅缺词） | 缺词作阶段 0 卡预学，原句回 2 |
| 2 回忆 | `WORD_ORDER`/`MORPHOLOGY` | 留在 2，挂针对性小岛 | 同结构/最小对立对；原句间隔收紧 |
| 2 回忆 | `FLUENCY_LATENCY`（慢） | 留在 2 | 不降阶，增频、缩间隔，直到秒答 |
| 3 运用 | `PHONEME` | 回到 1（仅该音） | 不让整句退回 0/1，只补该音 |
| 3 运用 | `WORD_ORDER`/`MORPHOLOGY` | 回到 2 | 凭记忆重练，过后回对话验证 |
| 3 运用 | `VOCAB` / 想说说不出 | 新建阶段 0 卡 + 回流 P1 | 对话里缺的表达变成该岛新句子 |

**四条通用规则（灵魂）**：① 只补缺口，不整句退回；② VOCAB 走"预学单词"而非退句；③ 慢 ≠ 错，`FLUENCY_LATENCY` 永不降阶；④ 运用阶段的缺口优先回流成新岛句子。

---

## 5. 系统性弱点 → 自动专项练习（Echo 的差异化）

按 `(type, detail)` 跨卡聚合（查 `reviews` 表的 `errorTags`），识别系统性弱点 → AI 生成专练小岛。例：某用户 `MORPHOLOGY:case-dative` 累计超阈值且分布在 ≥K 张卡 → 生成"德语与格"10–12 句最小对立对（沿用 `createScenarioIsland` 建岛、`addSentencesToIsland` 灌句），标 `source: 'remediation'`。弱点缓解后停止主动浮现，转入正常 FSRS。这是 Telleria 方法做不到、Echo 能做的。

---

## 6. 落地顺序（小步，合宪法原则七）

1. **db v5**：`ReviewState` 加 `masteryStage`（默认见 `learning-method.md` §2）。先不接 FSRS、不接 tag——只让字段存在、默认正确、不破坏现有复习。可上线。
2. **换 FSRS**：填 `sr.ts` 冻结位 + `ReviewState` 加 `stability/difficulty` + verdict→rating 映射。
3. **judge 产出 `errorTags`**：扩 `buildJudgePrompt` + `judgeSchema`（`server/src/llm/schema.ts`）+ 两边 `contracts.ts`；存到 `ReviewState`。
4. **按类型重练 + 跨卡聚合专项**：接 §4 判定表与 §5。

每步先 Plan 模式、跑起来、用一阵再下一步。

---

## 7. 验收标准

- 失败卡都带非空 `errorTags`；`FLUENCY_LATENCY` 从不降阶。
- FSRS rating 全由结果自动映射，无用户手选难度。
- 「失败类型 → 重练阶段」严格按 §4；发音错不把句子打回理解阶段。
- 跨卡聚合能自动触发某 `(type, detail)` 的专项小岛，弱点缓解后关闭。
- schema 改动：Dexie 版本 +1、`reviews` 不清、`backup.ts` 同步（宪法原则六）。
