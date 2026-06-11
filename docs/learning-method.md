# Echo 学习方法规范（Learning Method Spec）

> **文档性质**：Echo 学习引擎的**设计地面真值（ground truth）**。Claude Code 实现/重构学习相关功能时，本文优先于临时判断。
>
> **与项目宪法的关系**：本文是根 [`CLAUDE.md`](../CLAUDE.md) 的**展开**，不与之冲突；凡涉及零配置、忠于方法、语言无关、可插拔中间层、数据保命、小步快跑，**以宪法为准**，本文只补充"学习引擎该长成什么样"。
>
> **写法约定**：每条都给「**现状**（代码里已经是什么）→ **目标**（要变成什么）」，并点名真实文件。这不是从零的规范，是从当前代码到目标的 diff。
>
> **配套**：方法来源与学习科学见 [`research-mikel-telleria.md`](./research-mikel-telleria.md)；P4/P5 的实现细则见 [`srs-error-deck.md`](./srs-error-deck.md)、[`conversation-station.md`](./conversation-station.md)。

---

## 1. 核心哲学（Invariants）

不可协商的设计前提。

1. **单一轨道（Mastery Track）**：Echo 的本质是"把每个句子从『能认出』推到『能脱口而出』，并把学习者的时间花在他当前所处的位置"。它是一个**会调度学习者的提取-自动化引擎**，不是供人翻阅的内容库。

2. **句子带掌握状态**：每个句子有一个 `masteryStage`（0–3）。系统的智能在于知道每句在哪一阶段、并送上对应训练。
   - **现状**：`ReviewState`（`src/lib/types.ts`）只有 SM-2 维度（ease/interval/repetitions/due），复习只有 `again/good`（`src/lib/sr.ts`）。
   - **目标**：在 `ReviewState` 上**增量加** `masteryStage`，不新建并行结构。

3. **错误卡组不是独立模块**：它就是"同一份卡片在『未晋级』时被降级 + 重排"的行为。
   - **现状**：**已经是了**——`ReviewSession`（`src/components/ReviewSession.tsx`）的复习队列本就是从 `sentences + ReviewState`（到期 + 新卡）动态拼出来的，错误卡组从来不是第二套数据。
   - **目标**：保持这一点；只在其上叠加"掌握阶段 + 按类型打标的失败"。详见 `srs-error-deck.md`。

4. **难度是系统自动转的旋钮，不是用户选的模式**（呼应宪法原则一）：i+1 是移动靶，系统始终把每句往难一档推；学习者不手选难度档。

5. **以自发产出衡量自己**：北极星指标是"在开放对话中说出从未练过的新句子数"，**不是**"复习完成数 / 掌握句子数 / 连胜"。
   - **现状**：只统计到期数（`countDueForLanguage` 等）。
   - **目标**：等对话工位（P5）落地后才真正可测；在那之前用"阶段分布"当代理指标。

---

## 2. 掌握阶段状态机（Mastery Stage Machine）

引擎的核心模型。每句在四阶段流转，**每个阶段就是一条原理**。

| 阶段 | 学习者动作 | 对应原理 | Echo 落点 | 晋级条件 |
|---|---|---|---|---|
| `0` 理解 | 在输入中听懂、看双语对照 | 可理解输入 + 预输入(P0) | 新卡（无 `ReviewState`）默认此阶段 | 标记"听懂了" |
| `1` 模仿 | 预测→停顿→揭晓→跟读 | 影子跟读(P3) | `ShadowPlayer` + `playbackQueue` 双语模式 | 发音过门槛（录音对比，先人工） |
| `2` 回忆 | 看母语→凭记忆产出目标语 | 主动回忆(P4) | `ReviewSession` + `/v1/judge` | judge 判 `correct`，无脚手架 |
| `3` 运用 | 在对话中自发用出 | 自由产出(P5) | 对话工位（待建） | 对话中自发用出 |

**降级与重排（错误卡组的全部逻辑）**：任一阶段未通过 → `masteryStage` 降一阶 + 由调度器（FSRS）收紧 `due` + 写 `errorTags`。失败类型决定送回哪一阶段重练。完整规则见 `srs-error-deck.md`。

**迁移策略（重要，合宪法原则六）**：
- Dexie 版本 **v4 → v5**，**纯增量**：给 `reviews` 表加 `masteryStage` 字段，`reviews` 数据**绝不清空**。
- 已有 `ReviewState` 的句子（说明已被回忆过）默认 `masteryStage = 2`；无 `ReviewState` 的新卡视为阶段 0。
- `src/lib/backup.ts`：`reviews` 已在备份内，新字段自动随行；若新增任何**表**则必须补进 `backup.ts` 的导出/导入/校验三处。

---

## 3. 数据模型（Schema Delta）

只列**相对现有 `src/lib/types.ts` 的增量**。命名在前后端 `contracts.ts` 须一致。

```ts
// ReviewState 增量（src/lib/types.ts）——不动现有字段
interface ReviewState {
  // ...现有：sentenceId, language, ease, interval, repetitions, due, lastReviewedAt
  masteryStage: 0 | 1 | 2 | 3;          // 新增；缺省见 §2 迁移策略
  errorTags?: ErrorTag[];               // 新增；失败诊断，见 srs-error-deck.md
  // FSRS 字段（换 sr.ts 时加，见 srs-error-deck.md §3）
  stability?: number;
  difficulty?: number;
}

type ErrorType =
  | 'WORD_ORDER' | 'MORPHOLOGY' | 'PHONEME' | 'VOCAB' | 'FLUENCY_LATENCY';

interface ErrorTag { type: ErrorType; detail?: string; count: number; lastSeen: number; }
```

**不新增的字段（避免与现有重复）**：
- **不加 `colloquialNotes`**——口语化"为什么这么说"复用现有 `Sentence.note`（必要时让 authoring 提示词在 `note` 里多带 1–2 条口语特征即可）。
- **不加 `masteryStage` 到 `Sentence`**——它是"每学习者每句"的状态，归 `ReviewState`（合宪法原则四：语言无关、每用户隔离的天然位置）。
- **四个维度不拆四个布尔**——`masteryStage`（在测哪一维）+ `errorTags`（为什么错）已足够表达，合宪法原则一"少即是多"。

---

## 4. 各原理的实现契约（现状 → 目标）

### P0 · 预输入理解（加速器）
- **现状**：无。但已在 [`ROADMAP.md`](./ROADMAP.md) 第 6 步("预习加速器:粘字幕→标生词")。
- **目标**：新增一个后端 `task`（复用中间层，宪法原则五）：粘一段母语级内容文本 → 抽出超出已知范围的生词 → 作为阶段 0 卡片预学 → 再去看该内容。机制与 `gloss`(想懂) 同源，复用其提示词/schema 范式。

### P1 · 个性化句子岛
- **现状**：种子岛 + AI 生成（`scenario`/`compose`/inbox 流），岛会随 inbox 生长——**已部分"活"**。`InboxCapture` 的"想说"已支持语音输入，是"采集你真会说的话"的雏形。岛大小受 `getMaxIslandSentences()` 约束。
- **目标**：
  1. **岛大小统一到 8–12**（宪法原则三；`settings.ts` 已是 `DEFAULT 10/MIN 6/MAX 15`）——本规范早期草稿写的 15–25 作废，以宪法为准。
  2. **跳岛（island chaining）**：在对话工位（P5）里奖励从一个已掌握岛桥接到另一个；数据上可在 `Island` 上加可选 `linkedIslandIds`（增量，非必需先做）。
  3. **采集优先**：把"生活旁白 + 语音转文字 → 生成岛"做顺（`InboxCapture` 已有 mic + `compose`，主要是引导文案与流程）。AI 访谈式入职作为补充触发器，不取代现有手动 `ProfileView`。

### P2 · 口语化翻译
- **现状**：**基本满足**。`server/src/llm/prompts.ts` 的 authoring/scenario 提示词已要求"地道口语、不要书面腔"，走强模型（宪法原则二）；`note/literal/frame` 已承载用法说明与逐词直译。
- **目标**：仅微调——让 authoring 提示词在 `note` 里**显式带 1–2 条"该注意的口语特征"**（缩读、语气词、语序、形态）。**不新增字段、不新建任务。**

### P3 · 影子跟读（预测-停顿-跟读 + 录音对比）
- **现状**：`playbackQueue.ts` 的双语模式 = 母语→停顿→目标语→间隔（**预测-停顿的外壳已在**）；`ShadowPlayer` 有 neural TTS + 合成回退；`MicButton`/`speech.ts` 有语音转文字（但用于输入，未接跟读评分）。
- **目标**：
  1. 在"停顿"里加一个明确的"**先说出来**"提示 + 可选**录音**；先做**录音自比**（字幕里 Telleria 原话："录下来和原音对比"），自动打分后置。接 `ROADMAP.md` 第 6 步"录音对比"。
  2. 计次 **5×/1×**（首次/复习）与"发音过门槛 → 晋级阶段 1→2"作为后续增量。

### P4 · SRS 错误卡组（FSRS + 类型化诊断）
- **现状**：简化 SM-2（`sr.ts`，仅 again/good），接口**已冻结**为"将来换 FSRS"；`/v1/judge` 已按意思判（correct/close/wrong + tip + better），但**未产出错误类型**。入籍模块的 `study.tags` + "只练错题" 是现成的"按类型 + 错题池"范式。
- **目标**：换 FSRS、judge 产出 `errorTags`、失败按类型送回相应阶段重练。**完整契约见 [`srs-error-deck.md`](./srs-error-deck.md)。**

### P5 · AI 对话工位（带脚手架的陪练）
- **现状**：`Assistant`（`src/components/Assistant.tsx`）是单轮"提问 / 生成岛"，用 inbox + `/v1/ask`。**不是**多轮、带脚手架、会回流"想说说不出"的陪练。
- **目标**：在现有 Assistant + judge 上做多轮、脚手架自动升降、对话既是测试也是来源（错误进卡组、说对了晋级、想说说不出变新岛句子）。**完整契约见 [`conversation-station.md`](./conversation-station.md)。** 这是最大的一块，独立成一个路线图大步。

---

## 5. 闭环连接

```
预输入(P0) → 输入 → 句子岛(P1) → 口语化(P2) → 影子跟读(P3) → 主动回忆(P4 阶段2) → 对话运用(P5 阶段3)
   ↑                                                                              │
   └────────────────── 错误回流·重排(P4) ←──── 失败/想说说不出 ──────────────────────┘
   引擎：每日小剂量调度 · i+1 自动加压
```

任一环单独拿出来都打折：只输入不产出→听得懂开不了口；只背岛不对话→会背诵不会临场；只跟读不回忆→发音好但提取慢。

---

## 6. 多语言适配点（合宪法原则四）

核心机制与语言无关。按"母语—目标语"距离动态调整：
- **书写系统**：非拉丁文字（中/日/阿/俄…）提供"初期先脱离文字、用罗马音练音"的可配置开关。
- **语法是否自然涌现**：德语（格/性/语序）、斯拉夫语（体）、声调语言需更多显式提示——据距离决定 `note` 里的形态标注密度。
- **同源词密度**：近的（英↔德、西↔意）可快进；远的在"高频核心"选取上多下功夫。

---

## 7. 非目标 / 反模式

- ❌ 游戏化连胜/积分作为激励核心（宪法原则一精神；方法作者本人也批评其"上瘾而非有效"）。
- ❌ 语法优先——语法作为整句的副产品隐式习得。
- ❌ 错误卡组实现为与 `ReviewState` 并行的第二套数据/UI——它是同一对象的降级视图。
- ❌ 新机制摊到主路上或变成用户必须配置的选项——默认自动、藏进高级设置（宪法原则一）。
- ❌ 新 AI 功能另起服务——一律 `server/` 加 `task`、复用中间层（宪法原则五）。
- ❌ 改 schema 时清空 `reviews` / 漏改 `backup.ts`（宪法原则六）。
- ⚠️ 不照搬方法作者"6 周能对话""提速 50%"等营销数字——只采用机制。

---

## 8. 术语表（中 / EN）

| 中文 | English | 含义 / Echo 落点 |
|---|---|---|
| 掌握阶段 | mastery stage | `ReviewState.masteryStage`，0–3 |
| 句子岛 | island | `Island`；8–12 句（原则三） |
| 错误卡组 | error deck | `ReviewState` 的"降级 + 重排"行为视图，非独立模块 |
| 错误类型 | error type | `ErrorTag.type`，见 `srs-error-deck.md` |
| 预测-停顿-跟读 | predict-pause-repeat | `playbackQueue` 双语模式 + 录音对比 |
| 脚手架档位 | scaffolding level | 对话工位的辅助强度，自动升降，见 `conversation-station.md` |
| 预输入理解 | pre-input comprehension | P0 加速器，新 `task` |
| 自发产出 | spontaneous production | 北极星指标，待 P5 |

---

## 9. 来源与注意事项

方法来源：Basque 多语者 **Mikel Telleria**；三步系统、学习科学谱系详见 [`research-mikel-telleria.md`](./research-mikel-telleria.md)。**机制扎实、与学习科学吻合；时间神话不照搬**（见 §7 末）。
