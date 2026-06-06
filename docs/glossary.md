# 术语表（glossary）

本文面向**开发者自查**:把 Echo 开发中反复出现、但不一定人人都熟的概念,用一句话讲清楚,并尽量标注它在**项目里哪个文件/字段**出现。看到陌生词先来这里翻。

按主题分组,组内大致由浅入深。

---

## 1. 发音与音频

### TTS — Text-To-Speech(文字转语音)
把一段文字"读"出来的技术。Echo 用它朗读目标语言句子,服务于**影子跟读**。

- 浏览器自带免费实现:`window.speechSynthesis`,本地、离线可用,当前 Echo 用的就是它。
- **硬约束**:组件不许直接碰 `window.speechSynthesis`,一律走 `src/lib/tts.ts` 的 `speak()`。这层隔离是为了将来能无痛换成预录 MP3 / 神经网络 TTS,UI 不用改。
- iOS 坑:锁屏或切后台,朗读会停。WebKit 限制(bug 198277),非代码问题。

### IPA — International Phonetic Alphabet(国际音标)
一套全球通用的发音符号系统,**一符一音**,不依赖拼写。解决"同样字母在不同词里发音不同"的问题。

- 在项目里:`Sentence.ipa`(`src/lib/types.ts`),类型 `string | null`,允许为空。
- 例:`Guten Morgen!` → `ɡˈuːtən mˈɔɾɡən`。其中 `ˈ` 是重音标记,`ː` 表示元音拉长,`ə` 是 schwa。
- 有脚本自动生成 IPA(见 commit `fix(gen:ipa): …`),德语变音字母需用 stdin 喂入以绕开 Windows argv 编码问题。

### schwa(中央元音 `ə`)
最"轻、松、含糊"的元音,发音时舌头摆在嘴巴正中、不用力。英语 "about" 开头的 a、德语 "Morgen" 结尾的 -en 都是它。IPA 符号是 `ə`。

### umlaut(变音字母)
德语的 **ä ö ü**。字母上两点改变元音音色。它们是非 ASCII 字符,在命令行/编码处理中容易出问题(参见 IPA 那条 commit)。另有 ß(Eszett)同属德语特殊字符。

### neural TTS(神经网络语音合成)
比浏览器内置 TTS 更自然的机器朗读,通常需后端/付费 API。项目里预留了缓存结构 `AudioCacheEntry`(`src/lib/types.ts`),按 `hash(lang|voice|rate|text)` 缓存音频 Blob,为将来接入做准备。

---

## 2. 学习算法

### SR — Spaced Repetition(间隔重复)
"在快要忘的那一刻复习"的记忆方法,基于艾宾浩斯遗忘曲线。记得越牢,复习间隔拉得越长。

### SM-2
1980s SuperMemo 提出的间隔重复算法,Anki 的鼻祖。Echo 在 `src/lib/sr.ts` 用了**简化版**:评分只有 `again` / `good` 两档(标准版是 0–5 六档)。

- 三个核心状态(`ReviewState`):`ease`(难度系数,越大越简单)、`interval`(下次复习天数)、`repetitions`(连续答对次数)。
- `good`:间隔按 `1 → 3 → interval × ease` 天几何增长。
- `again`:`ease` 扣 0.2(地板 1.3)、连击清零、立即重排。
- 纯函数 `schedule(state, grade, now)`,接口**冻结**,方便将来换 FSRS。

### FSRS — Free Spaced Repetition Scheduler
比 SM-2 更新、更精准的间隔重复算法,用机器学习拟合记忆模型。Echo 暂未使用,但 `sr.ts` 的接口是为了将来能换它而设计的。

### due(到期)
某张卡"下次该复习的时间戳"。`ReviewState.due`(毫秒)。复习队列就是查 `due <= now` 的句子(见 `src/lib/db.ts` 的 `dueReviews` 查询)。

---

## 3. 项目方法论

### 句子岛 / 场景岛(island)
把句子按"场景"成组,一组叫一个岛(如「打招呼」)。数据结构见 `Island`(`src/lib/types.ts`)、种子格式见 [`seed-format.md`](./seed-format.md)。

### 影子跟读(shadowing)
听一句、立刻模仿跟读的训练法。Echo 的播放器状态机 `src/lib/player.ts` 就是为它设计的(母语 → 停顿 → 目标语 → 间隔 循环)。

---

## 4. 前端 / 平台

### PWA — Progressive Web App
能像原生 App 一样"安装到主屏、离线可用"的网页。靠 manifest + Service Worker 实现。

### Service Worker(SW)
浏览器后台独立运行的脚本,坐在页面和网络之间像个**本地代理中间件**——拦截每个网络请求,自己决定走网络还是回缓存(Cache Storage)。是 PWA 离线能力的核心。只能在 HTTPS / localhost 跑。有"安装→等待→激活"的更新生命周期(见 `skipWaiting + clientsClaim`)。Echo 的实现:`src/app/sw.ts`,构建后产出 `out/sw.js`。

### manifest(PWA 清单)
一个 JSON,告诉浏览器 App 的图标、名字、主题色、启动方式——决定"装到主屏后长什么样"。与 Service Worker 是 PWA 的两根支柱(SW 管离线/缓存,manifest 管外观/安装)。

### Serwist
帮你**生成和管理 Service Worker** 的库(Google 已停维护的 Workbox 的后继者)。手写 SW 易错(缓存版本、清理旧缓存、precache 清单……),Serwist 把这些封装成声明式的 `runtimeCaching` 配置。`@serwist/next` 是给 Next.js 的集成包。它是**构建期工具**:`pnpm build` 时读 `sw.ts` + 扫描静态资源 → 编译出 `out/sw.js`,因此与静态导出不冲突。⚠️ `disable: NODE_ENV==='development'` 意味着 `next dev` 不产出 SW。

### precache(预缓存)
Serwist 在构建期扫描所有静态资源,生成一份清单(`sw.ts` 里的 `__SW_MANIFEST`),SW 安装时就把它们全缓存下来——保证离线时核心资源齐全。与之相对的是 `runtimeCaching`(运行时按请求动态缓存)。

### NetworkFirst / CacheFirst(缓存策略)
SW 决定"请求来了走网络还是走缓存"的策略。**NetworkFirst** = 先试网络,失败/超时才回退缓存;**CacheFirst** = 先用缓存。Echo 的 `sw.ts` 对 `/seed/*` 和页面跳转都用 NetworkFirst(5 秒超时),刻意优先回源——这样 `pnpm build` 重新部署后用户一刷新就拿到新版,不会卡在旧内容。

### skipWaiting + clientsClaim
解决 SW 那个"更新要等下次才生效"的痛点。`skipWaiting`:新 SW 装好后**立刻上岗**,不等旧 SW 退休;`clientsClaim`:新 SW 一激活就**立刻接管所有已打开页面**。两者合起来 = 重新部署后用户**刷一下就用上新版**,无需清缓存。Echo 在 `sw.ts:16-17` 同时开启,是其"build→serve 即部署"流程能生效的底层保障。

### IndexedDB
浏览器内置的本地数据库(可存大量结构化数据 + Blob)。Echo 全部数据存这里,**无后端、无云同步**。

### Dexie
IndexedDB 的封装库,把原生那套难用的 API 变成顺手的查询。**只允许通过 `src/lib/db.ts` 访问**,组件不许直接 `indexedDB.open`。

### static export(静态导出)
`next.config.ts` 里 `output: 'export'`,把站点编译成纯静态文件(`out/`),无服务器运行时。**代价**:不能用 Proxy(中间件)、Server Actions、动态 Route Handler、`cookies()`、`redirects`/`rewrites`/`headers` 配置、默认 Image Optimization——用了会构建失败。

### `next dev`(开发服务器)
本地开发命令(项目里是 `pnpm dev`,跑在 `localhost:3000`)。改代码即时编译、浏览器自动刷新(靠 HMR),**为快而牺牲优化**:不压缩、不打包成成品。类比后端的 `dotnet watch` / Spring devtools。⚠️ **绝不能当生产**:它跑在 development 模式,Serwist 配置里 `disable: NODE_ENV==='development'` → **不产出 service worker**,无法覆盖用户设备上缓存的旧 SW(见 `static export` / `Serwist`)。

### `next build`(生产构建)
产出上线成品的命令(项目里是 `pnpm build`,即 `next build --webpack`)。编译慢但做了全部优化,把站点输出成静态 `out/`,**并由 Serwist 生成带 SW 的 `out/sw.js`**。正确的生产姿势是 `pnpm build` 后用 `pnpm serve` 伺服 `out/`,不是 `next dev`。

### HMR — Hot Module Replacement(热模块替换)
开发期"改一行代码、不刷新整页就把改动塞进运行中的应用"的机制,只换变更的模块、保留页面状态。`next dev` 提供,`next build` 的成品里没有。

### seed(种子数据)
首次启动时一次性读入 IndexedDB 的初始内容,放在 `public/seed/echo_seed_{lang}.json`。加载逻辑 `src/lib/seedLoader.ts`,**幂等**(已加载过就跳过)。详见 [`seed-format.md`](./seed-format.md)。

### i18n / locale(国际化 / 语言区域)
界面多语言。Echo 用 next-intl,所有路由在 `[locale]/` 下(`zh` / `en`),UI 文案集中在 `src/i18n/messages/*.json`。注意:**界面语言**(zh/en)与**学习目标语言**(de/en)是两条独立的轴。

### inbox(收件箱)
Phase 2 概念:用户随手"想说/想懂/场景"丢进来的待处理条目(`InboxItem`),经后端处理后变成学习卡。状态流转 `captured → processing → ready → added`。

---

## 5. 后端 / LLM 调度（`server/`）

> 后端的 LLM 调用是一张**二维路由表**:**任务(task)× 供应商(provider)**。任务 = "要干什么活",供应商 = "用谁、怎么调"。两者在 `server/src/config.ts` 的 `TASK_ROUTING` 里相遇,容易混。

### LLM task(LLM 任务)
后端让大模型干的三种活,与前端 `InboxKind` 一一对应。定义见 `config.ts`(`LlmTask`)。

| task | 前端对应 | 中文 | 干什么 | maxTokens |
|---|---|---|---|---|
| `authoring` | say | 想说 | 给个意思,生成一句地道目标语句子 | 1500 |
| `gloss` | understand | 想懂 | 给个词,解释含义/用法 | 1200 |
| `scenario` | scenario | 场景 | 给个场景,**一次生成一整岛 15+ 句** | 8192 |

### scenario(场景任务)
上表第三种任务:**根据一个场景批量生成一整个句子岛**。因为一次吐 15+ 句,它的 `maxTokens` 最大(8192)、**输出最长、调用最慢**——所以在 CLI 适配器里常被当作"超时上限"的参照物(`claudeCli.ts` 给到 6 分钟超时)。注意:它是"任务",不是"调用配置"。

### LLM provider(供应商)
"用谁、怎么调模型"。定义见 `config.ts`(`LlmProvider`):`anthropic`(API key,生产用)、`openai`、`deepseek`、`claude-cli`。每个 provider 对应 `server/src/llm/adapters/` 下一个适配器文件。**加一家厂商 = 加一个适配器 + 配置里加一行**。

### task routing(任务路由)
`TASK_ROUTING` 表:每个 task 指定 `{ provider, model, maxTokens }`。支持**环境变量覆盖**,改 provider 不用动代码,例如:
```
LLM_GLOSS_PROVIDER=deepseek  LLM_GLOSS_MODEL=deepseek-chat
```
设计意图:测试期全走 Claude,将来想省钱把便宜任务(如 gloss)甩给 deepseek,只改 env。

### claude-cli adapter(CLI 适配器)
一个 provider 实现:**通过命令行 `claude -p` 调 Claude**,走你的订阅额度而非计费 API(本地开发省钱)。代码 `server/src/llm/adapters/claudeCli.ts`。提速关键点:
- `--strict-mcp-config` —— 跳过全局 MCP 健康检查,砍冷启动。
- `--no-session-persistence` —— 不写会话历史,省磁盘 IO。
- `cwd` 设为临时目录 —— 不加载项目 CLAUDE.md,省上下文 token。
- system prompt 走临时文件 + user 走 stdin —— 避开 Windows argv 非 ASCII 编码问题(与 IPA 那条 commit 同源)。

### adapter(适配器)
把"统一接口"翻译成"某个具体厂商/工具的调用方式"的一层。Echo 里 `LlmAdapter` 接口固定为 `complete({ system, user, model })`,每个 provider 实现它。换厂商不影响调用方——与 `tts.ts`、`sr.ts` 同样的"接口隔离实现"哲学。

---

> 新词随时往这里加。每条目标:**一句话能看懂 + 指向项目里的落点**。
