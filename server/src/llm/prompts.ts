import type {
  ComposeRequest,
  GlossRequest,
  ScenarioRequest,
} from "../contracts";

const LANG_LABEL: Record<string, string> = { de: "德语", en: "英语" };

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
${JSON_QUOTE_RULE}`;
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
${JSON_QUOTE_RULE}`;
  const user = `场景:${req.description}`;
  return { system, user };
}
