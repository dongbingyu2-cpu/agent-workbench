# 本地 Agent 工作台（Web）设计

- 日期：2026-11-23
- 状态：待批准

## 1. 意图与缘由

用户本机上有多个 AI agent（如 Claude Code、Codex），有的在桌面端、有的在 TUI 终端里各开一个窗口。逐个切换、手动盯进度、把一个大任务手工拆给不同 agent，既累又乱。

用户要一个**本地 Web 工作台**，把这些散落的、属于自己的 agent 收拢到一处：启动即扫描出本机已有的 agent，在一个界面里看它们的所有会话、给它们派任务、把一个任务拆成几块分给不同 agent、实时看进度，并通过共享目录让它们协作。

范围严格限定：**只针对用户本人、只在本机、不涉及多用户、远程或他人的 agent。**

## 2. 目标 / 非目标 / 反面目标

### 目标
- G1 启动时自动扫描本机已有的 agent（桌面端 / TUI 进程 + 历史会话），统一列表展示。
- G2 在本工作台内浏览这些 agent 的全部会话（历史 + 实时）。
- G3 向 agent 分派任务；能把一个任务拆成多个部分，分给不同 agent。拆分既可手动，也可由某个 agent 先给出拆分方案、用户确认后再分发。
- G4 实时查看每个 agent / 每个任务部分的进度。
- G5 参与同一任务的 agent 通过工作台提供的共享目录交换产物，形成协作。
- G6 保留"往活 TUI 敲字"的能力——对受管 agent 能实时输入、实时观察。

### 非目标
- N1 不做多用户、账号、权限、隔离。
- N2 不做远程管理，不跨机器。
- N3 不管理别人的 agent，只管理用户自己的本机 agent。
- N4 不是"再造一种新的 agent"——不实现自己的 agent 推理循环，只做编排与外壳。
- N5 不做 agent 之间自主通信 / 自治协商；协作由用户在工作台里编排。

### 反面目标（即使技术跑通也算失败）
- A1 需要把 agent 搬到某个陌生终端、或牺牲"能敲字"才能用。
- A2 会话 / 进度依赖 agent 私有的、随版本变化的日志格式，升级即崩。
- A3 任务拆解后 agent 各跑各的、彼此看不到产物，"协作"名存实亡。

## 3. 约束

- C1 运行环境为 Windows。终端控制通过 ConPTY（node-pty）实现，这是"持有终端、能敲字"的前提。
- C2 每个 agent 必须是用户自己的、可通过 CLI 续接会话的（如 `--resume` / `--continue` / 会话选择器）。v1 目标覆盖主流 CLI agent（Claude Code、Codex、opencode、pi、workbuddy 等）；不支持续接、又不透明 GUI 的 agent 只能监控、不能敲字，续接方式以各自 CLI 为准。
- C3 "往活 TUI 敲字"只对"终端由工作台持有"的 agent 成立。要让一个已在外部终端运行的 agent 可敲字，需用其 session id 在工作台的 PTY 里重新拉起（接管）。
- C4 agent 的磁盘会话日志（如 `~/.claude/projects/**/*.jsonl`）是私有格式，仅作"尽力导入"的历史来源，不作为唯一真相。

## 4. 方案（Approaches）

### 4.1 外壳形态（三选一，已选 1）
1. **Web 工作台（已选）**：本地后端 + 浏览器多面板界面。会话是文本 / JSONL，多 agent 进度并排展示最自然，迭代最快，面板可扩展。
2. **终端原生 TUI 管理器（否决）**：轻量、贴合终端流；但多 agent 会话 + 拆分 + 进度挤在单一终端里展示局促，做个好用的 TUI 成本高。
3. **桌面原生（Tauri / Electron）（暂缓）**：观感最好、可停靠；但脚手架重、到首个可用版本更慢，与"尽快做出多面板工作台"的目标相悖。

### 4.2 终端持有方式（三选一，已选 1）
1. **自建 PTY 监督器（已选）**：用 node-pty（Windows 走 ConPTY）为每个 agent 开伪终端，工作台持有主端的输入 / 输出。写入 = 敲字，读流 = 实时会话。原生、无额外依赖。
2. **tmux（否决）**：需 WSL / 外部 tmux，链路多一层，与"纯本地 Windows 工作台"不符。
3. **全局输入注入（仅兜底）**：`AttachConsole` / `SendInput` 硬塞，不稳定、抢焦点；仅对无法接管的 agent 做尽力尝试，不作主路。

> 决策记录：用户明确"保留往活 TUI 敲字"，因此在无头模式（`claude -p` / `codex exec`）与 PTY 托管之间选择了 **PTY 托管**。无头模式作为可选补充（一次性 `-p` 跑完即走），不作为主交互。

## 5. 设计

### 5.1 整体架构
- **本地后端（Node.js）**：唯一进程，负责扫描、PTY 监督、任务编排、事件落地、API / WS。
- **前端（Web）**：单页多面板工作台，通过 REST + WebSocket 与后端通信。
- 后端只监听 `127.0.0.1`，无鉴权（个人本机）。

```
浏览器工作台 ──REST/WS── 后端
                         ├── 发现器（进程扫描 + 会话目录扫描）
                         ├── PTY 监督器（node-pty，每个 agent 一个伪终端）
                         ├── 任务编排器（Task/Part 状态机、派发、进度）
                         ├── 会话存储（自有事件日志 + 尽力导入磁盘日志）
                         └── 共享工作区（每个任务一个目录，供 agent 交换产物）
```

### 5.2 模块职责
- **发现器 Discovery**：启动时 + 周期扫描。识别 agent 类型（claude / codex / generic），枚举运行中进程与磁盘会话，产出"已发现 agent / 会话"列表。仅"看见"，不代表可控。
- **PTY 监督器 Supervisor**：为每个受管 agent 启动 node-pty 伪终端，运行对应命令（如 `claude --resume <id>` 或 `claude`）。提供 `write(输入)`、订阅 `output(输出流)`；进程生命周期管理（启动 / 退出 / 重启）。
- **接管 Adopt**：把"已发现"的 agent 纳入受管：用其 session id 在 PTY 内重新拉起（需先关闭外部原进程），或直接新开会话。接管后即可敲字。
- **任务编排器 Orchestrator**：管理 Task/Part 状态机；按用户拆分把 Part 派发到指定 agent；通过 PTY 写入结构化任务提示；依据"产物 / 完成标记 + 进程状态"推进状态；汇总进度。
- **任务规划器 Planner**：可选。用户就一个任务请求"拆分方案"时，工作台把任务交给一个指定 agent 生成结构化拆分建议（若干 Part + 各自职责 + 建议分配的 agent），以草稿返回；用户可编辑、确认后才真正分发，不确认不派发。
- **适配器注册表 Adapter Registry**：每个受支持 agent 一个适配器，声明：可执行命令名、启动命令模板、续接命令模板、进程识别方式、会话目录与格式、是否支持续接。新增 agent 只需加配置，核心不改。
- **会话存储 SessionStore**：自己的 append-only 结构化事件日志（JSONL）作为真相源；磁盘上 agent 会话日志仅尽力导入为只读历史。
- **共享工作区 Workspace**：`workspace/<task-id>/` 下放 `SHARED.md`（任务背景）与 `parts/<part-id>/`（各 part 产物与完成标记）。

### 5.3 关键流程

**启动扫描**
1. 进程扫描（Windows `tasklist` / WMI 或进程库）识别运行的 claude / codex 进程，标为 `running`。
2. 会话目录扫描（如 `~/.claude/projects`、`~/.codex`）枚举历史会话，标为 `historical`。
3. 合并去重后以 agent 列表呈现；每项给出状态、来源、能否接管。

**接管（把已发现 agent 变成可敲字的受管 agent）**
1. 用户在列表点"接管"。
2. 若该会话仍有外部进程在跑 → 提示先关闭，避免同一会话双进程。
3. 后端用其 session id 在 node-pty 内 `claude --resume <id>` 拉起，接管输入输出；状态变为 `adopted / running`。

**派发单任务**
1. 用户选中 agent，输入任务。
2. 后端写入 PTY（一行指令），并订阅输出流；状态 `running`，进度面板显示实时输出尾。

**任务拆分（手动或 agent 辅助）**
1. 用户建 Task，写背景。拆分有两种入口：
   - 手动：用户直接把任务拆成若干 Part，逐个绑定 agent。
   - agent 辅助：用户点"请给出拆分方案"，工作台把任务交给一个指定 agent，要求它返回结构化拆分建议（Part 列表 + 职责 + 建议分配的 agent）。建议以**草稿**返回，用户可编辑，确认后才生效（不确认不派发）。
2. 确认后为任务建 `workspace/<task-id>/`，写入 `SHARED.md`（背景）。
3. 每个 Part 派发时写入结构化提示，显式要求：读 `SHARED.md`；完成时把结果写到 `parts/<part-id>/RESULT.md` 并落 `parts/<part-id>/DONE`（**自报完成协议**）。
4. 进度：文件监听（产物 / 标记）+ PTY 输出尾部 + 进程状态三者合成；不依赖私有流格式。

**协作**
- 每个 agent 的提示都指向同一 `SHARED.md`；用户可把某 part 的 `RESULT.md` 作为输入喂给另一 agent 的提示，实现"接力 / 汇总"。
- 协作由用户在工作台编排，不是 agent 自治通信。

**看进度**
- agent 面板：活 / 空闲 / 退出 + 实时输出尾。
- 任务面板：Task → 各 Part 的状态（pending / running / done / failed）、耗时、产物链接。

### 5.4 数据模型（概念）
- Agent：`id, name, adapter(claude|codex|generic), command, cwd, sessionId, status(discovered|adopted|running|idle|exited), managed(bool)`
- Session：`id, agentId, source(disk|pty), path, startedAt, events[]`
- Task：`id, title, description, workspacePath, status(planned|active|done), parts[]`
- Part：`id, taskId, title, description, assignedAgentId, status(proposed|pending|running|done|failed), resultPath, doneMarker`

### 5.5 技术选型（部分为我的判断，构建者可调）
- 后端：Node.js + Fastify / Express + `ws`（我的建议）。
- PTY：`node-pty`（ConPTY）。
- 元数据存储：SQLite（better-sqlite3）；事件日志用 append-only JSONL（我的建议）。
- 前端：React + Vite 多面板（构建者可换，属实现细节）。
- 文件监听：`chokidar`。
- 适配器注册表：配置驱动的 per-agent adapter（命令 / 续接方式 / 进程识别 / 会话目录），新增主流 agent 只需加配置（我的建议）。

### 5.6 约束下的诚实边界
- 支持的 agent 由适配器决定；v1 至少覆盖 Claude Code、Codex、opencode、pi、workbuddy，续接机制各以 CLI 为准；只能对能续接的 agent 接管并敲字，不透明 GUI agent 仅监控。
- 接管外部运行中的会话需先关原进程（用户已确认接受）。
- 磁盘日志尽力导入，不作真相源；升级不崩靠自有事件日志。

## 6. 留给构建者的（实现时的自由）
- 各主流 agent（Claude Code、Codex、opencode、pi、workbuddy…）的确切启动 / 续接命令、会话目录与格式，需逐个对照其 CLI 核实；适配器错误处理。
- 状态机精确状态集与重试 / 超时策略。
- 前端框架、面板布局、图表 / 流式渲染细节。
- 并发上限、资源回收、进程池策略。
- SQLite schema 细节与迁移。
