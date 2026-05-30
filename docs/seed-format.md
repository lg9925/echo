# 场景岛种子（seed）JSON 结构与运营文档

本文面向**内容运营**:讲清楚一个「场景岛」种子文件长什么样、每个字段怎么写、ID 是怎么来的(以及为什么不能乱动顺序)、以及新增一门语言要改哪几处。

配套文件:[`content-prompt.md`](./content-prompt.md) —— 可直接粘贴给各家 LLM 批量生成场景岛内容的提示词。

---

## 1. 文件位置与命名

- 所有种子文件放在 `public/seed/` 下。
- 文件名固定为 **`echo_seed_{语言代码}.json`**,语言代码用 BCP-47 主标签的小写,例如:
  - 德语 → `echo_seed_de.json`
  - 英语 → `echo_seed_en.json`
- 应用首次加载某语言时,会 `fetch('/seed/echo_seed_{lang}.json')` 读入 IndexedDB(见 `src/lib/seedLoader.ts`)。
- shadow 路由会在 `pnpm build` 时**自动扫描 `public/seed/` 下所有 `echo_seed_*.json`**,为每个岛生成静态页面(见 `src/app/[locale]/shadow/[islandId]/page.tsx`)。**放进去就会被打包**,无需手动登记路由。

> 关于"语言":Echo 有两个独立的语言轴。
> - **UI 界面语言**(`zh` / `en`):界面文案用哪种语言,由 `src/i18n/` 管。
> - **学习目标语言**(`de` / `en` …):你正在学的那门语言,由种子文件决定。
>
> 本文档讲的"语言代码"指的是**学习目标语言**。英语既可以是界面语言,也可以是学习目标语言,两者互不影响。

---

## 2. 顶层结构

```json
{
  "language": "en",
  "language_label": "英语",
  "version": 1,
  "islands": [ /* 场景岛数组 */ ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `language` | string | ✅ | 学习目标语言代码,**必须与文件名里的代码一致**(`echo_seed_en.json` → `"en"`)。会写进每条记录,所有数据库查询都按它过滤。 |
| `language_label` | string | 否 | 该语言的中文标签(如 `"英语"`),仅作内容侧备注,UI 实际显示的标签取自 `src/i18n/messages/*.json` 的 `languages` 键。 |
| `version` | number | 否 | 种子版本号,缺省为 `1`。**幂等灌库的关键**(见 §5)。 |
| `islands` | array | ✅ | 场景岛对象数组,见 §3。 |

---

## 3. 场景岛(island)对象

```json
{
  "name": "打招呼",
  "order": 1,
  "sentences": [ /* 句子数组 */ ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | 岛的名字,会**直接显示在 UI**(首页岛列表、播放页标题)。当前内容都用中文场景名,如 `"打招呼"`、`"餐厅点餐"`、`"购物"`。 |
| `order` | number | ✅ | 排序整数,从 `1` 起递增。首页按它排序;它还**参与 ID 合成**(见 §4),所以一旦上线就别改。 |
| `sentences` | array | ✅ | 句子对象数组,见下。 |

---

## 4. 句子(sentence)对象

```json
{
  "native": "你好!/ 嗨!",
  "target": "Hi!",
  "frame": "Hi!(万能问候)",
  "literal": "嗨",
  "note": "最随意通用的问候,任何场合都行;比 Hello 更口语。",
  "variants": ["Hello!", "Hey!", "Hey there!", "Hi there!", "Howdy!(美式/偏俏皮)"],
  "ipa": "haɪ"
}
```

| 字段 | 类型 | 必填 | 写作规范 |
|---|---|---|---|
| `native` | string | ✅ | **学习者母语 = 中文**。这句话的中文意思,口语化、自然。 |
| `target` | string | ✅ | **目标语言**的句子(英语种子里就是英文)。这是要朗读、要背的主句,优先选地道口语。 |
| `frame` | string | ✅ | 句型/可替换模板。用 `___` 标占位,括号里给中文/可选项提示。例:`"Good ___!(morning / afternoon / evening)"`。帮助学习者举一反三。 |
| `literal` | string | ✅ | **逐词直译**(中文),帮助理解语序。例:`Good morning` → `"好的 早晨"`。不是通顺翻译,是按词对照。 |
| `note` | string | ✅ | 用法说明(中文):何时用、正式/随意、地区差异、易错点等。一两句即可。 |
| `variants` | string[] | ✅ | 同义/近义的其它说法,**建议 5 条**。覆盖正式↔随意、不同场合、常见变体;可在括号里补中文提示。 |
| `ipa` | string | 否 | 目标语言的 IPA 音标(不带斜杠,UI 会自动包 `/ /`)。可选,但建议补上;英语用通用美音(与 TTS 的 `en-US` 一致)。 |

> ⚠️ 句子里**不要写 `id` 字段**。ID 由程序自动合成,见下一节。

---

## 5. ID 是怎么来的 —— 以及为什么顺序不能乱动

灌库时程序自动合成稳定 ID(见 `src/lib/seedLoader.ts`):

- 岛 ID:`{language}.{order}` —— 例如 `en.1`
- 句子 ID:`{language}.{islandOrder}.{数组下标}` —— 例如第 1 个岛的第 1 句是 `en.1.0`(下标从 0 起)

**复习进度(SM-2 间隔重复状态)是按句子 ID 存的。** 这意味着:

- ✅ **可以**在岛末尾**追加**新句子(下标递增,不影响已有句子的 ID)。
- ✅ **可以**在末尾**追加**新岛(`order` 递增)。
- ❌ **不要**在中间**插入/删除/重排**句子或岛 —— 会让后面所有句子的下标(进而 ID)整体平移,导致用户已有的复习记录"错位"到别的句子上。
- ❌ **不要**改已上线岛的 `order`。

如果确实需要重排,把它当作内容大改,通过**提升 `version`** 来重新灌库(见下)。

### 幂等灌库与 version

- 灌库幂等键 = `{language}@{version}`(如 `en@1`)。该键已存在于 `meta` 表时,跳过加载。
- 也就是说:**改了内容但 `version` 不变,老用户不会看到更新**(他们本地已是 `en@1`)。
- 要让所有人重新灌入新内容,把 `version` 加 1(`1` → `2`)。注意:复习记录(`reviews` 表)不会被清空,所以配合上面的 ID 稳定性规则一起考虑。

---

## 6. 新增一门学习语言的清单

以新增「法语 `fr`」为例:

1. **建种子文件** `public/seed/echo_seed_fr.json`,`language: "fr"`,内容参照本文 + 用 `content-prompt.md` 生成。
2. **首页登记**:在 `src/app/[locale]/page.tsx` 的 `TARGET_LANGS` 数组里加 `"fr"`。
3. **加语言标签文案**:在 `src/i18n/messages/zh.json` 和 `en.json` 的 `languages` 块里加 `"fr": "法语"` / `"fr": "French"`。
4. **确认 TTS 映射**:`src/components/ShadowPlayer.tsx` 与 `src/components/ReviewSession.tsx` 里的 `TARGET_LANG_MAP` 要有 `fr: "fr-FR"`(已预置 de/en/fr;新语言需补)。
5. `pnpm build` —— shadow 路由会自动为新岛生成静态页面,无需手改路由。

完成后首页会多出一个「法语」板块,shadow 跟读与按语言复习都即时可用。

---

## 7. 最小校验

- JSON 必须能被解析:`node -e "require('./public/seed/echo_seed_xx.json')"`。
- 每条句子至少含 `native` / `target` / `frame` / `literal` / `note` / `variants` 六个字段(`ipa` 可选)。
- `language` 与文件名一致;`order` 从 1 起、无重复、不跳号最好。
- 跑一次 `pnpm build` 确认静态导出不报错、对应岛页面已生成。
