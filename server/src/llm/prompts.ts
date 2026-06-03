import type {
  AskRequest,
  ComposeRequest,
  GlossRequest,
  KeywordsRequest,
  LearnerProfile,
  ScenarioRequest,
  SplitRequest,
} from "../contracts";

const LANG_LABEL: Record<string, string> = { de: "德语", en: "英语" };

// Optional learner profile → a generation-context line appended to a system
// prompt. Empty profile → "" (no effect). Prompt wording stays here (核心层).
function buildProfileBlock(p?: LearnerProfile): string {
  if (!p) return "";
  const parts: string[] = [];
  if (p.level) parts.push(`CEFR 水平:${p.level}`);
  const bg = p.background?.trim();
  if (bg) parts.push(`背景与目标:${bg}`);
  if (parts.length === 0) return "";
  return `\n学习者画像(据此调整词汇与句式难度、主题贴合度;别超纲太多、别偏离背景):${parts.join(";")}。`;
}

// Models love to quote Chinese glosses with straight double-quotes (e.g.
// 字面"…"), which are unescaped and abort JSON.parse mid-string. Force full-width
// 「」 instead. Shared by all tasks so the rule can't drift between prompts.
const JSON_QUOTE_RULE =
  '注意:JSON 字符串值内部严禁出现英文双引号 ";若需引号(如标注字面意思)一律改用中文「」。输出必须是能被 JSON.parse 直接解析的合法 JSON。';

export interface PromptPair {
  system: string;
  user: string;
}

// "想说": 中文 → 地道外语跟读卡。
export function buildAuthoringPrompt(req: ComposeRequest): PromptPair {
  const lang = LANG_LABEL[req.language] ?? req.language;
  const system = `你是一位帮助中文母语者学习${lang}口语的教练。学习者给你一句中文,想用${lang}地道地说出来。
你要产出一张"跟读卡":自然、口语化的${lang}表达,外加学习辅助。
要求:
- native:用户那句中文(可做轻微润色,但**保持原意和关键信息不变**,仍然是中文,绝不要翻译成${lang})。
- target:把这句话最地道、最自然地用口语${lang}说出来(不要书面腔,不要逐字硬翻,但必须忠于原意)。
- frame:抽出可复用的句型骨架,可变部分用 ___ 表示,后面用括号给简短中文提示。
- literal:对 target 做逐词直译(中文),帮助理解词序。
- note:1~2 句中文,说明使用场景或注意点。
- variants:5 个同义的自然说法(可含地区/语气差异,差异用括号中文标注)。
- ipa:target 的宽式 IPA 音标;拿不准就给 null。
- suggestedIslandName:给这句话归类的主题/场景名(简短中文,如 "点餐"、"问路"、"寒暄")。
只输出一个 JSON 对象,不要任何解释、不要 markdown 代码块。字段:
{"native":string,"target":string,"frame":string,"literal":string,"note":string,"variants":string[],"ipa":string|null,"suggestedIslandName":string}
${JSON_QUOTE_RULE}${buildProfileBlock(req.profile)}`;
  const user = `中文:${req.native}`;
  return { system, user };
}

// "想懂": 没懂/拼不准的外语词或短语 → 含义 + 候选 + 例句。
export function buildGlossPrompt(req: GlossRequest): PromptPair {
  const lang = LANG_LABEL[req.language] ?? req.language;
  const system = `你是一位${lang}词汇老师,帮助中文母语者弄懂一个没听懂或拼不准的${lang}词/短语。
输入可能是模糊、拼写不准、甚至是听到的近似音。你要:
- 识别/纠正成正确的${lang}词或短语。若输入模糊有多种可能,给 2~3 个候选(candidates),最可能的排第一。
- 每个候选:target(正确写法;${lang}若是名词必须带冠词,如 "der Tisch"),pos(词性,中文,如 "名词"/"动词"/"形容词"),article(德语名词冠词 der/die/das,非名词或非德语为 null),note(可选,简短中文辨析)。
- meaning:最可能那个候选的中文含义。
- example:用最可能的候选造一个自然例句(target=${lang},native=中文翻译)。
- suggestedIslandName:归类主题名(简短中文)。
只输出一个 JSON 对象,不要解释、不要 markdown。字段:
{"meaning":string,"candidates":[{"target":string,"pos":string|null,"article":"der"|"die"|"das"|null,"note":string|null}],"example":{"target":string,"native":string},"suggestedIslandName":string}
${JSON_QUOTE_RULE}`;
  const user = `${lang}词/短语:${req.query}`;
  return { system, user };
}

// "场景": 一句场景描述 → 一段完整问答对话(按顺序的多句卡)。
export function buildScenarioPrompt(req: ScenarioRequest): PromptPair {
  const lang = LANG_LABEL[req.language] ?? req.language;
  const system = `你是一位帮助中文母语者学习${lang}口语的教练。学习者给你一个"场景描述",你要为它设计一段**完整的真实问答对话**,做成一个"句子岛"。
要求:
- 按真实流程从头到尾,生成**一来一回**的对话:既包含**对方(店员/地勤/工作人员等)会问或会说的话**,也包含**你的回答或提问**,交替推进,**至少 15 句**(可更多),覆盖该场景的关键环节,不重复。
- 每一句(无论谁说的)都做成一张跟读卡,字段:
  - native:这句话的中文。
  - target:地道、自然的口语${lang}。
  - frame:可复用句型骨架,可变部分用 ___,后加简短中文提示。
  - literal:逐词直译(中文)。
  - note:**开头标明说话方**——"对方:" 或 "你:",再跟 1 句中文说明使用场景或注意点。
  - variants:2~4 个同义自然说法。
  - ipa:target 的宽式 IPA;拿不准给 null。
- 给整个岛起个简短中文名 islandName(如 "机场值机对话")。
只输出一个 JSON 对象,不要解释、不要 markdown:
{"islandName":string,"sentences":[{"native":string,"target":string,"frame":string,"literal":string,"note":string,"variants":string[],"ipa":string|null}]}
${JSON_QUOTE_RULE}${buildProfileBlock(req.profile)}`;
  const user = `场景:${req.description}`;
  return { system, user };
}

// "拆岛": 一个过大的岛 → 把现有句子分成 2–3 个子岛(只重新分组,不改写句子)。
export function buildSplitPrompt(req: SplitRequest): PromptPair {
  const lang = LANG_LABEL[req.language] ?? req.language;
  const system = `你是一位课程设计师,帮中文母语者把一个过大的${lang}"句子岛"拆成更易"一天背完"的子岛。
给你一个岛名和它的全部句子(已按顺序编号),你要把这些句子**重新分组**成 2–3 个子岛——只分组,**绝不改写、增删句子**。
要求:
- 每个子岛聚焦一个清晰的小场景/环节,理想 8–12 句;子岛名用**分组标签**形式,如 "酒店/入住"、"酒店/退房"。
- 尽量顺着原有流程切分,使每个子岛内部自成一段连贯小对话,别从中间生硬截断。
- 分组的下标并集必须**覆盖全部句子、互不重叠**(每句恰好归入一个子岛)。
只输出一个 JSON 对象,不要解释、不要 markdown:
{"groups":[{"subIslandName":string,"indices":number[]}]}
${JSON_QUOTE_RULE}${buildProfileBlock(req.profile)}`;
  const list = req.sentences
    .map((s, i) => `${i}. ${s.native} | ${s.target}`)
    .join("\n");
  const user = `岛名:${req.islandName}(共 ${req.sentences.length} 句)\n${list}`;
  return { system, user };
}

// "随手助手": 学习者随口问的问题 → 简洁中文解答。
export function buildAskPrompt(req: AskRequest): PromptPair {
  const lang = LANG_LABEL[req.language] ?? req.language;
  const system = `你是一位${lang}学习助手,帮助中文母语者。用**中文**简洁回答学习者的问题——
解释清楚、口语化,需要时举 1–3 个**地道**的${lang}例句(每个例句后用括号附中文)。
不要长篇大论、不要教科书腔;直接给有用的答案。
另外,把答案里**值得保存的内容**单独抽出来(供学习者一键收藏):
- examples:完整的${lang}例句(target=${lang}原句,native=中文),0–3 条,没有就给 []。
- words:关键${lang}词/短语(term=规范写法,名词带冠词;meaning=简洁中文释义),0–5 个,没有就给 []。
- answer 是给人读的解释;examples/words 是从中抽出的、可独立成卡的条目,别只是复述 answer。
只输出一个 JSON 对象,不要解释、不要 markdown 代码块:
{"answer":string,"examples":[{"target":string,"native":string}],"words":[{"term":string,"meaning":string}]}
answer 内可用普通换行与简单 Markdown(列表/加粗)。
${JSON_QUOTE_RULE}${buildProfileBlock(req.profile)}`;
  const user = `问题:${req.question}`;
  return { system, user };
}

// "提取关键词": 一个岛的句子 → 对学习者最有用的关键词/短语 + 释义 + 出处。
export function buildKeywordsPrompt(req: KeywordsRequest): PromptPair {
  const lang = LANG_LABEL[req.language] ?? req.language;
  const system = `你是一位${lang}词汇老师。给你一个"句子岛"的全部句子(已编号),
请挑出对中文母语学习者**最有学习价值的关键词/常用短语**(约 8–15 个),做成字词表。
要求:
- 只挑实词与地道常用表达(名词/动词/形容词/固定搭配等);**跳过太基础的功能词**(冠词、代词、介词等)。
- term:该词的规范写法;${lang}若是名词请带冠词(如 "der Bahnhof")。
- meaning:简洁中文释义。
- indices:这个词出现在**哪些句子**的下标(可多个;就是上面编号)。
- 不要重复:同一个词只出一条,把它出现的所有下标都列上。
只输出一个 JSON 对象,不要解释、不要 markdown:
{"keywords":[{"term":string,"meaning":string,"indices":number[]}]}
${JSON_QUOTE_RULE}${buildProfileBlock(req.profile)}`;
  const list = req.sentences
    .map((s, i) => `${i}. ${s.native} | ${s.target}`)
    .join("\n");
  const user = `岛名:${req.islandName}(共 ${req.sentences.length} 句)\n${list}`;
  return { system, user };
}
