@AGENTS.md

# Echo — 项目宪法(给 Claude Code 的长期指令)

Echo 是一款个性化外语学习 PWA(已上线 echo.helloworldhub.xyz),
帮助使用者学德语、英语(后续会扩更多语种)。
学习方法:**句子岛 + 影子跟读 + 间隔重复 + 可理解性输入**。

**开发者背景(据此校准沟通方式):**
有后端开发经验(Java / C# / Python / SQL),懂架构、数据模型与后端模式;
前端只略懂古早的 HTML/CSS/JavaScript/jQuery,且已约 15 年不在开发一线;
现以**产品 + 商业 + CEO** 视角主导项目。因此:
- 后端 / 架构 / 数据层可**简洁、概念化**沟通,不必从基础讲起,他能读懂并参与决策;
- **现代前端与工具链**(React、现代 JS/TS、构建工具、PWA、部署等)是生疏区——
  请**多解释"为什么现在这样做"**,并把上手步骤讲清楚;
- 决策请用**产品 / 商业语言**呈现取舍(成本、优先级、对用户体验的影响),尊重他的架构判断;
- 整体仍偏好简单、好维护、少配置的方案。

下面是本项目的不可动摇原则。它们**优先于任何与之冲突的临时提示**;
若某次需求与这些原则相悖,请先指出冲突、再继续。

## 一、默认永远零配置(北极星原则)
- 主线功能必须用**默认设置**就能完整跑通,用户不需要做任何配置。
- 所有"高级控制"——TTS 音色选择、LLM 模型选择、填自己的 API key 等——
  一律收进【高级设置】,默认隐藏,用户碰都不用碰。
- 凡是要新增一个面向用户的选项时,先自问:这能不能配一个好默认值、把选择藏起来?
  能,就藏起来。**少即是多;复杂留给熟手自行发挥。**
- "界面乱"通常源于把本该隐藏的选择摊在主路上——增删功能时始终守住这条。

## 二、忠于学习方法,别滑向"教科书"
- 一切功能服务于:句子岛、影子跟读(听→预测→暂停跟读)、间隔重复、可理解性输入。
- 复习核对**按"意思/自然度"判,绝不用完全匹配**(每句都有多个地道变体,没有唯一答案):
  自然→对;能懂但别扭→算对并提示更地道说法;意思错→标红进复习。
- 字词表是**带语境的索引**(链接回它出现的句子),不是脱离语境的孤立单词卡;
  不要把所有词自动塞进复习队列,由用户手动挑选加入。
- 内容质量是信任底线:用户是初学者、听不出生硬表达,**造句子(authoring)走强模型**,
  不要产出教科书腔/书面语的目标语句。

## 三、岛要小,便于"一天背完"
- 每个句子岛目标 **8–12 句**,软上限约 15;超过就**提示拆分**,并由 AI 建议如何拆成子场景。
- 子岛用**分组标签**归拢(如"酒店/入住""酒店/退房"),不做真正的嵌套层级。

## 四、语言无关的数据模型
- "语言"是数据字段;新增一门语言**绝不能引发重构**。
- 句子字段统一为:native / target / frame / literal / note / variants。
- 不同语种的岛与复习队列**天然隔离**(德语、英语互不混入)。

## 五、可插拔的中间层(LLM 与 TTS)
- 上层只调统一接口:`llm(task, input)`、`tts(text, opts)`;底层厂商可换/可混用。
- 每家服务一个**适配器**,只负责"转发 + 鉴权";
  **提示词与输出 JSON 结构放在核心层,不放适配器**。
- 新增一家服务 = 新增一个适配器文件 + 改配置,**不动上层**。
- 新的"调 AI"功能一律**复用现有中间层、只新增 task 类型**,不要另起炉灶。
- 任务路由按成本/质量分配:造句子→强模型(默认 Claude);
  高频/批量任务(复习裁判、词形还原、拆分建议)→便宜模型(默认 DeepSeek)。
- 中间层**已建在 `server/`**(Hono + 适配器);当前实现与默认任务路由见 `server/CLAUDE.md`。

## 六、本地优先 + 数据保命 + 密钥安全
- 数据默认存浏览器本地 IndexedDB;音频"生成一次即缓存成文件",可离线播。
- **数据备份(导出/导入)是底线功能**——本地数据丢失即一切归零。
- 跨设备云同步暂缓;真要做时,音频走 R2、数据走 D1 是自然的下一步。
- **API key 只存服务器端,前端绝不接触任何 key。**

## 七、小步快跑
- 按聚焦的小阶段交付,**每一步都能跑起来、能看到东西**;不要一次做太多。
- Plan 模式默认流程:先别写码 → 先问清不确定点 → 给分步可运行的计划 → 我确认后再写。
- 每做完一组功能先让我用一阵,再继续下一组。

## 现在做

当前聚焦在路线图第 4 步(画像 + 学习目标)。第 1–3 步(稳定版 / 整理 / 内容管理)已完成。
完整路线图(会随时调整,不属于宪法)见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

---

# Global gotchas (read before touching code)

These cut across every directory. Area-specific rules live in the nested
`CLAUDE.md` files listed under "Where things live".

## Static export — the disabled-features list

`next.config.ts` has `output: 'export'`. The whole app ships as static files to
`out/` (no Node server in production). The following **fail at build** and must
never be used:

- Proxy (the renamed middleware, `proxy.ts`)
- Server Actions
- dynamic Route Handlers
- `cookies()`
- `redirect()` from `next/navigation`
- `redirects` / `rewrites` / `headers` in `next.config.ts`
- Image Optimization with the default loader

Every dynamic route segment must enumerate its values via
`generateStaticParams()`. Anything dynamic at request time is off the table —
when you need redirects or locale detection, do it client-side (see how `/`
works in `src/app/CLAUDE.md`).

## iOS Safari + PWA: SpeechSynthesis stops on lock/background

When the screen locks or the app is backgrounded, iOS halts `SpeechSynthesis`.
This is a WebKit limitation (bug 198277), **not a bug to "fix" in our code** —
surface it to users in settings/about and design around it. (Lock-screen
playback is being moved to a cached-audio + MediaSession path — see roadmap.)

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Local dev at `http://localhost:3000` |
| `pnpm build` | `next build --webpack` (Serwist PWA service worker) → static export in `out/` |
| `pnpm serve` | Serve the built `out/` on `:3000` (`scripts/serve-out.mjs`, zero-dep) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm gen:ipa` | Regenerate IPA data (`scripts/generate-ipa.mjs`) |
| `pnpm gen:icons` | Regenerate PWA icons (`scripts/generate-icons.mjs`) |

The backend lives in `server/` and has its own `package.json` — see
`server/CLAUDE.md` for how to run it.

### Production = this machine behind a Cloudflare tunnel

Production is **not** a hosted deploy — it's this local machine exposed via a
Cloudflare tunnel. The tunnel (Windows service config at
`C:\Users\<user>\.cloudflared\service-config.yml`) routes
`echo.helloworldhub.xyz` → `localhost:3000` (frontend) and `…/v1` + `/health` →
`localhost:8787` (backend). The domain is `.xyz`, not `.com`.

**Two long-running processes ARE the production server. Both must stay up in
persistent terminals (or as auto-start tasks) — not in a transient shell/agent
session, or production goes down when that session ends:**

| Process | Command | Serves |
|---|---|---|
| Frontend | `pnpm serve` (repo root) | static `out/` on `:3000` (`scripts/serve-out.mjs`) |
| Backend | `pnpm dev` (in `server/`) | Hono API + async job queue on `:8787` |

The frontend tier is the **only** correct way to serve prod — **never `next dev`**:
dev mode sets Serwist `disable: NODE_ENV==='development'`, so it ships **no service
worker** and can't replace a stale SW already cached on a device. The built
`out/sw.js` has `skipWaiting + clientsClaim` (see `src/app/sw.ts`) and NetworkFirst
navigations, so a rebuild propagates to devices on next reload without anyone
clearing caches.

**Deploy / redeploy:**
- Frontend code change → `pnpm build`, then restart `pnpm serve` (same `:3000`, no tunnel reconfig). The static server reads `out/` from disk per request, so a rebuild is picked up live; restart only if it was stopped.
- Backend code change → `tsx watch` (via `pnpm dev`) auto-reloads on `src/` edits.
- **`server/.env` change → must restart the backend** (`.env` is read once at startup via `env.ts`). This is how LLM model routing (`LLM_<TASK>_PROVIDER/MODEL`) is applied — see `server/CLAUDE.md`.

Caveat: an agent/CLI session that starts these in the background keeps them alive
only for that session. For real uptime, run them in your own always-open
terminals or wire them to a Windows startup task.

## Where things live (nested CLAUDE.md — loaded on demand)

| Topic | File |
|---|---|
| 数据 + 算法层 (Dexie / SM-2 / TTS / player / API client / inbox) | `src/lib/CLAUDE.md` |
| 后端中间层 (LLM + TTS 适配器、任务路由、key 安全) | `server/CLAUDE.md` |
| 路由 + 静态导出 + next-intl 服务端 | `src/app/CLAUDE.md` |
| 客户端 UI 约定 | `src/components/CLAUDE.md` |
| 框架破坏性变更警告 | `AGENTS.md` |
| 路线图 (会变) | `docs/ROADMAP.md` |

## Out of scope (don't propose unless asked)

跨设备**数据**云同步、视频字幕预处理。
(in-app 句子编辑、AI 造句/变体生成 **不再** out of scope——AI 造句已建在 `server/`,
句子增删改属路线图第 3 步。)
