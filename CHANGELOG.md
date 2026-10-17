# Changelog

## [0.7.0] - 2026-10-17

### Added — F (gradual): self-built system-prompt channels
- **额外全局来源**: `~/.dsh/instructions/extra-global.md`, injected as a host-level
  system-prompt section alongside the official AGENTS.md message chain. Editable
  from the Instruction panel (nav entry appears after the Host restart).
- **本次会话临时指令**: per-session temporary rules stored under
  `$DSH_HOME/storages/dsh-instructions/sessions/<sessionId>.md`, injected as an
  agent-scoped system-prompt section that disappears with the agent. Edit it by
  opening the panel from the session-header Instruction button.
- These channels are user-authored content; project repository instructions stay
  on the official message channel. Session instructions rank above extra-global,
  and both are framed as not overriding system/developer/direct user instructions.
- `getState().features` advertises the new capabilities so the client hides the
  entries on older Host builds.


## [0.6.1] - 2026-10-17

### Fixed
- Client is now compatible with the previous Host build: it detects a missing
  `historyLimit` capability, uses the old save arguments/return shape, and hides
  history/conflict features until the next app restart. Refreshing the page no
  longer risks failed saves while another session keeps the old process alive.


## [0.6.0] - 2026-10-17

### Added
- **自定义模板**：把当前编辑器内容保存为本地模板（localStorage），可插入或删除，最多 30 条。
- **删除指令文件**：编辑器右上角「删除」，清空内容并删除文件，引擎会收到 “Instructions removed”。
- **Markdown 预览**：编辑器支持「预览 / 编辑」切换，长指令可先读再改。
- **渲染错误边界**：面板渲染异常时显示错误信息，而不是空白区域。
- 客户端 smoke test（React/window stub）并接入 CI。


## [0.5.0] - 2026-10-17

### Added
- **模板 / 片段库**：内置回答风格、代码与测试、Git、安全、协作约定等模板，一键插入当前编辑器。
- **Settings → General 入口**：设置里新增 Instruction 行，可直接打开管理页。
- **新建会话 Hero 入口**：新会话页面新增 Instruction 按钮，直达当前工作区/全局配置。
- **导入 / 导出**：把全局与所有项目指令导出为 JSON 备份，并从备份恢复（按路径匹配项目）。
- **`instructions` 工具 `validate` 动作**：写入前返回行级 diff 的 dry-run 结果，不落盘。
- GitHub Actions CI（Node 20/22：语法检查 + Host 冒烟测试）与本 CHANGELOG。

## [0.4.0] - 2026-10-17

### Added
- **保存历史**：每次保存前归档上一版（最多 20 份），支持查看与恢复。
- **冲突保护**：保存按内容 hash 校验，外部修改时提示重新加载或覆盖保存。
- **原子写入**：临时文件 + rename。
- **按来源的注入预览与 token/预算估算**。
- **会话注入时间线**（最近注入时间、消息数、基线标记）。
- Agent 工具跟随会话沙箱（read-only 拒绝写入，workspace-write 限制在工作区内）。

## [0.3.0] - 2026-10-17

### Added
- 清空内容即删除文件；链上文件可编辑；工作区搜索与修改时间；会话注入状态与引擎可用性警告。
- `instructions` 工具（list/get/set/append/remove，项目可写、全局只读）与 `/instruction` 命令。

## [0.2.0] - 2026-10-17

### Added
- 自动保存（800ms 防抖 + Cmd/Ctrl+S）、保存后校验、官方注入预览、文件状态提醒。

## [0.1.0] - 2026-10-17

### Added
- 首个可用版本：全局/项目 AGENTS.md 编辑、按工作区入口、会话标题按钮、中英双语、图标与 MIT 许可证。
