# Instruction（dsh-instructions）

DeepSeek Harness 桌面版插件：管理**全局**与**项目**两级 `AGENTS.md` 前置指令，并在会话里直接查看/维护生效链。

注入引擎复用桌面版官方内置的 `@deepseek-ai/dsh-agent-instructions`（standard / ptc / cordis 预设默认启用）。本插件**不注册新的提示词通道**，只负责解析与编辑官方引擎实际读取的文件，避免双重注入与提示词缓存破坏。

## 功能

- **全局指令**：编辑 `~/.dsh/AGENTS.md`，对所有项目、所有会话生效。
- **项目指令**：按工作区编辑项目根 → 当前目录链上的 `AGENTS.md` / `CLAUDE.md` / `*.local.md`；项目指令优先于全局指令（官方引擎顺序：全局 → 项目根 → … → 当前目录，越具体越优先）。
- **按工作区的入口**：左侧栏 Instruction 面板列出全部工作区（含搜索、大小、修改时间）；会话标题旁的按钮直接定位到当前会话所属工作区。
- **自动保存**：输入停止 800ms 自动保存（也支持 `Cmd/Ctrl+S`）；保存后官方引擎在下一条模型请求前读取。
- **清空即删除**：清空内容会删除对应文件，引擎提示 "Instructions removed"，不留空注入段。
- **官方注入预览**：按官方引擎的真实顺序展示全局 + 项目将被注入的文本，可复制；文件未创建时给出提醒。
- **会话注入状态**：会话标题按钮显示已注入文件数；面板顶部展示预设/引擎状态、已注入文件列表与总字节数；预设未挂载官方引擎（如 `minimal`）时明确警告。
- **Agent 协作**：`instructions` 工具（`list/get/set/append/remove`，项目可写、全局只读）与 `/instruction` 命令（查看注入状态与生效链）。

## 安装

需要 DeepSeek Harness 桌面版 `0.2.1-rc.1`（或同系列版本），且会话使用 `standard` / `ptc` / `cordis` 预设（内置注入引擎随这些预设挂载）。

1. 把本仓库放在一个**稳定目录**（不要放临时目录；当前桌面版以 `link:` 方式安装到 profile）。
2. 在桌面版打开 **Plugins → Add plugin → 选择本地目录**，选中本仓库目录；或使用 CLI：`dsh plugin --profile desktop add <本仓库绝对路径>`。
3. 重启 DeepSeek Harness（Host 侧代码只在进程启动时加载）。

> 后续如果只改 UI/文案，刷新页面即可；改动 Host 侧代码（`index.js` / `typert.host.js`）需要重启 App。

## 使用

1. 左侧栏 **Instruction** 图标打开管理页（Plugins / Schedules 附近）。
2. 编辑全局或某个项目的指令；内容会自动保存，面板里能看到官方注入预览。
3. 在任意会话里输入 `/instruction` 查看本会话注入状态与生效链；也可以直接让 agent「把这条规则追加到项目指令」。

## 已知限制与安全边界

- **依赖 DSH 内部接口**：Remote 走手写 Typert 清单与 `typertRemote` 绑定；DSH 升级可能改变校验/绑定方式，需要跟随适配（`package.json` 已声明兼容范围）。
- **预设检测是启发式**：会话状态卡用 `session.header.agentPreset` 判断（standard/ptc/cordis 视为启用，minimal 视为未启用）；自定义预设可能显示不准确。
- **Agent 工具写入绕过会话 fs 沙箱**：工具写的是项目指令候选文件（路径与文件名均校验），但不受 `read-only` 会话沙箱约束；全局指令对工具只读。把该工具视同“允许 agent 编辑项目指令文件”。
- **非原子写入**：直接覆盖写文件；外部编辑器同时修改时是最后写入者获胜。自动保存已串行化，但仍建议避免同时手改。
- **指令是指导不是硬约束**：冲突依赖官方引擎“更具体优先”的提示语义；官方单会话预算 65536 字节，超出会先省略宽泛文件、可能截断最具体文件。
- **提示注入风险**：项目内 `AGENTS.md` 来自仓库，属于不受信内容；不要在不信任的仓库里启用/注入未审阅的指令。
- **本机安装形态**：当前以 `link:` 方式安装，移动/删除本仓库目录会让 profile 中的插件失效；分发时建议打包后安装。

## 开发与测试

```bash
node --check index.js
node --check typert.host.js
node --check client.js
node test/host.test.mjs
```

Host 端测试使用 fake Cordis context 与临时目录，不会接触真实 profile 或真实 `~/.dsh`。

## 版本

- `0.3.0`：清空即删除、链上文件编辑、工作区搜索/修改时间、会话注入状态、引擎可用性警告；新增 `instructions` 工具与 `/instruction` 命令。
- `0.2.0`：自动保存、保存后校验、官方注入预览、文件状态提醒。
- `0.1.0`：首个可用版本（全局/项目编辑、按工作区入口、会话按钮）。

## License

[MIT](LICENSE) © 2026 Eric Zhang (Zhang646967)
