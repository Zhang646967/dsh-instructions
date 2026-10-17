window.__ModuleLoader__.load({
  id: 'dsh-instructions',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    /* ------------------------------------------------------------------ *
     * Remote face: the package-private Host half publishes the
     * `instructions` service through ./typert; the browser half mounts the
     * matching descriptor list so `remote.instructions.*` becomes callable.
     * ------------------------------------------------------------------ */

    const permissiveSchema = (parse) => ({ parse, safeParse: (value) => ({ success: true, data: value }) })
    const clientCodec = (name, parse) => ({
      mode: 'strict',
      typeSymbol: `dsh-instructions#${name}`,
      schema: permissiveSchema(parse),
      create: () => permissiveSchema(parse),
    })
    const stringParameter = (name) => ({
      name,
      wire: name,
      source: 'json',
      codec: clientCodec(`parameter:${name}`, (value) => {
        if (typeof value !== 'string') throw new Error(`${name} must be a string`)
        return value
      }),
    })
    const resultCodec = (method) => clientCodec(`result:${method}`, (value) => value)
    const descriptor = (method, parameters = []) => ({
      id: `dsh-instructions#instructions/${method}`,
      service: 'instructions',
      namespace: 'instructions',
      method,
      invocation: { kind: 'direct' },
      parameters: parameters.map(stringParameter),
      result: resultCodec(method),
    })
    const FACE = {
      package: 'dsh-instructions',
      descriptors: [
        descriptor('getState'),
        descriptor('readProject', ['workspaceId']),
        descriptor('saveGlobal', ['content', 'baseHash']),
        descriptor('saveProject', ['workspaceId', 'content', 'baseHash']),
        descriptor('findWorkspaceForSession', ['sessionId']),
        descriptor('readFile', ['workspaceId', 'filePath']),
        descriptor('saveFile', ['workspaceId', 'filePath', 'content', 'baseHash']),
        descriptor('getSessionStatus', ['sessionId']),
        descriptor('listHistory', ['workspaceId', 'filePath']),
        descriptor('restoreHistory', ['workspaceId', 'filePath', 'snapshotId']),
      ],
    }

    /* ------------------------------------------------------------------ *
     * Shared state
     * ------------------------------------------------------------------ */

    let CTX = null
    let API = null
    let pendingWorkspaceId = null
    let pendingSessionId = null

    const STRINGS = {
      zh: {
        panel: 'Instruction',
        headerAction: 'Instruction',
        headerTip: '设置当前工作区 / 全局的 Instruction',
        intro:
          '全局指令对所有会话生效；项目指令只在该工作区内生效，且优先于全局指令。保存后，桌面版官方注入引擎会在下一次模型请求前自动读取这些文件。',
        engine: '注入引擎：桌面版内置 AGENTS.md 引擎（standard / ptc / cordis 预设默认启用）',
        budget: '官方单会话预算 65536 字节；超出时先省略较宽泛的文件，最具体的文件可能被截断。',
        global: '全局指令',
        globalHint: '写入 ~/.dsh/AGENTS.md，所有项目、所有会话都会带上。',
        projects: '项目',
        noProjects: '还没有工作区。新建工作区后会自动出现在这里。',
        refresh: '刷新',
        loading: '读取中…',
        saving: '保存中…',
        save: '保存',
        saved: '已保存，下一条消息生效',
        dirty: '有未保存的修改',
        exists: '已存在',
        notCreated: '尚未创建',
        createFile: '保存后创建',
        chain: '生效链（越靠下优先级越高）',
        chainHint: '官方引擎按这个顺序读取：全局 → 项目根 → … → 当前工作区目录；越具体越优先。',
        emptyChain: '暂无生效的指令文件',
        chars: '字符',
        autoSaved: '已自动保存',
        autoSaveHint: '输入后自动保存到官方注入文件；官方引擎在下一条消息前读取。',
        autoSavePending: '等待自动保存…',
        injectedBadge: '已写入官方注入文件',
        notInjectedBadge: '尚未写入（不会注入）',
        globalMissingWarn: '全局指令文件尚未创建：当前会话只注入了项目指令。在这里输入内容会自动保存，并补进官方注入。',
        projectMissingWarn: '本项目指令文件尚未创建：在这里输入内容会自动保存，并补进官方注入。',
        injectionTitle: '官方注入预览',
        injectionHint: '官方引擎在下一次请求时按「全局 → 项目根 → … → 当前目录」的顺序注入；更具体的内容优先。保存后下一条消息生效。',
        injectionEmpty: '暂无内容可注入。',
        previewLabelGlobal: '全局',
        previewLabelProject: '本项目',
        previewOtherLabel: '其他生效文件（只读）',
        saveNotWritten: '保存后未在预期路径找到文件',
        savedAt: '最近保存',
        saveNow: '立即保存',
        searchPlaceholder: '搜索工作区…',
        noSearchResults: '没有匹配的工作区',
        edit: '编辑',
        editingFile: '正在编辑',
        backToPrimary: '返回主文件',
        editingHint: '正在编辑生效链上的附加文件；保存后下一条消息生效。',
        copyPreview: '复制预览',
        copiedPreview: '已复制注入预览',
        sessionStatusTitle: '当前会话注入',
        sessionPreset: '预设',
        sessionEngine: '引擎',
        engineOn: '已启用',
        engineOff: '未启用',
        sessionFiles: '个文件',
        sessionUnknown: '会话状态不可读',
        history: '历史',
        historyTitle: '保存历史',
        historyHint: '每次保存前自动归档上一版，最多保留 20 份。恢复时会先归档当前内容。',
        historyEmpty: '暂无历史版本',
        restore: '恢复',
        restoreConfirm: '恢复这个历史版本？当前内容会先被归档。',
        restored: '已恢复历史版本',
        reloadFromDisk: '重新加载',
        overwrite: '覆盖保存',
        conflictDetected: '检测到文件已被外部修改',
        conflictBody: '该文件在别处被修改过。重新加载会丢弃你的修改；覆盖保存会保留你的修改并覆盖外部内容。',
        lastInjected: '最近注入',
        baselineOn: '含基线',
        baselineOff: '仅增量',
        messagesUnit: '条注入消息',
        approxTokens: '≈ tokens',
        tokenEstimate: 'token 估算',
        budgetUsage: '预算',
        restoredFromDisk: '已重新加载磁盘内容',
        historyRefresh: '刷新历史',
        close: '关闭',
        templates: '模板',
        customTemplates: '自定义模板',
        customTemplatesEmpty: '还没有自定义模板。',
        addTemplate: '把当前内容存为模板',
        templateAdded: '已保存自定义模板',
        templateEmpty: '当前编辑器内容为空',
        delete: '删除',
        deleteFile: '删除',
        deleteConfirm: '删除这个指令文件？官方引擎会收到 "Instructions removed"。',
        deleted: '指令文件已删除',
        preview: '预览',
        editMode: '编辑',
        previewEmpty: '（空）',
        renderErrorTitle: 'Instruction 面板渲染失败',
        renderErrorHint: '可以把下面的错误信息发给我；其他会话不受影响。',
        templateInserted: '已插入模板',

        templatesHint: '点击插入到当前编辑器末尾；插入后会自动保存。',
        templateInserted: '已插入模板',
        openPanel: '打开管理页',
        settingsRowHint: '管理全局与项目 AGENTS.md 前置指令，查看官方注入预览。',
        export: '导出',
        import: '导入',
        exportDone: '已导出备份',
        importDone: '导入完成',
        importConfirm: '导入会用备份内容覆盖全局与已匹配项目的指令，继续？',
        importInvalid: '不是有效的 dsh-instructions 备份文件',

        engineInactiveWarn:
          '当前会话的 Agent 预设未启用官方注入引擎（例如 minimal 预设）：这些指令不会注入。请切换到 standard / ptc / cordis 预设。',


        workspaceUnavailable: '无法读取工作区列表',
        projectFile: '项目指令文件',
        globalFile: '全局指令文件',
        path: '路径',
        copyPath: '复制路径',
        copied: '已复制',
        globalPlaceholder: '例如：始终使用中文回答；修改代码前先说明计划；不要自动提交 git。',
        projectPlaceholder: '例如：本项目使用 pnpm；测试命令是 pnpm test；目录结构约定……',
        discardConfirm: '当前有未保存的修改，确定放弃并切换吗？',
        error: '读取失败',
        retry: '重试',
        root: '项目根',
        gitMissing: '未检测到 .git，只读取该工作区文件夹',
        scopeGlobal: '全局',
        scopeShared: '共享全局',
        scopeProject: '项目',
        depth: '层级',
        sharedTitle: '共享全局指令（~/.agents/AGENTS.md）',
        sharedHint: '该文件由多套工具共享，本插件只读展示；如需修改请直接编辑该文件。',
        noSelection: '选择左侧的项目以编辑其前置指令',
        projectHint: '写入该工作区的 AGENTS.md；只在这个工作区的会话中生效。',
      },
      en: {
        panel: 'Instructions',
        headerAction: 'Instructions',
        headerTip: 'Set pre-instructions for this workspace / global',
        intro:
          'Global instructions apply to every session; project instructions apply only inside their workspace and take precedence over global ones. The built-in desktop injection engine reads these files before the next model request.',
        engine: 'Injection engine: built-in AGENTS.md engine (enabled by the standard / ptc / cordis presets)',
        budget:
          'The built-in per-session budget is 65536 bytes; broader files are omitted first and the most specific file may be truncated.',
        global: 'Global instructions',
        globalHint: 'Stored in ~/.dsh/AGENTS.md and applied to every project and session.',
        projects: 'Projects',
        noProjects: 'No workspaces yet. New workspaces appear here automatically.',
        refresh: 'Refresh',
        loading: 'Loading…',
        saving: 'Saving…',
        save: 'Save',
        saved: 'Saved, effective on the next message',
        dirty: 'Unsaved changes',
        exists: 'Exists',
        notCreated: 'Not created',
        createFile: 'Created on save',
        chain: 'Effective chain (lower entries win)',
        chainHint:
          'The engine reads global → project root → … → current workspace; more specific files take precedence.',
        emptyChain: 'No effective instruction files',
        chars: 'chars',
        autoSaved: 'Auto-saved',
        autoSaveHint: 'Changes are saved to the official instruction file automatically; the engine reads it before the next message.',
        autoSavePending: 'Waiting to auto-save…',
        injectedBadge: 'Written to the official file',
        notInjectedBadge: 'Not written (not injected)',
        globalMissingWarn: 'The global instruction file does not exist yet: only project instructions are injected right now. Typing here auto-saves it into the official file.',
        projectMissingWarn: 'This project instruction file does not exist yet: typing here auto-saves it into the official file.',
        injectionTitle: 'Official injection preview',
        injectionHint: 'The engine injects global → project root → … → workspace on the next request; more specific content wins. Effective on the next message after saving.',
        injectionEmpty: 'Nothing to inject yet.',
        previewLabelGlobal: 'Global',
        previewLabelProject: 'This project',
        previewOtherLabel: 'Other effective files (read-only)',
        saveNotWritten: 'File not found at the expected path after saving',
        savedAt: 'Last saved',
        saveNow: 'Save now',
        searchPlaceholder: 'Search workspaces…',
        noSearchResults: 'No matching workspaces',
        edit: 'Edit',
        editingFile: 'Editing',
        backToPrimary: 'Back to main file',
        editingHint: 'Editing an additional file of the effective chain; effective on the next message after saving.',
        copyPreview: 'Copy preview',
        copiedPreview: 'Injection preview copied',
        sessionStatusTitle: 'Session injection',
        sessionPreset: 'Preset',
        sessionEngine: 'Engine',
        engineOn: 'enabled',
        engineOff: 'not enabled',
        sessionFiles: 'files',
        sessionUnknown: 'Session state unavailable',
        history: 'History',
        historyTitle: 'Save history',
        historyHint: 'The previous version is archived before every save (up to 20 kept). Restoring archives the current content first.',
        historyEmpty: 'No saved versions yet',
        restore: 'Restore',
        restoreConfirm: 'Restore this version? The current content is archived first.',
        restored: 'Version restored',
        reloadFromDisk: 'Reload',
        overwrite: 'Overwrite',
        conflictDetected: 'The file changed outside this editor',
        conflictBody: 'It was modified elsewhere. Reload discards your edits; Overwrite keeps your edits and replaces the external content.',
        lastInjected: 'Last injected',
        baselineOn: 'baseline',
        baselineOff: 'incremental',
        messagesUnit: 'injection messages',
        approxTokens: '≈ tokens',
        tokenEstimate: 'token estimate',
        budgetUsage: 'Budget',
        restoredFromDisk: 'Reloaded from disk',
        historyRefresh: 'Refresh history',
        close: 'Close',
        templates: 'Templates',
        customTemplates: 'Custom templates',
        customTemplatesEmpty: 'No custom templates yet.',
        addTemplate: 'Save current content as template',
        templateAdded: 'Custom template saved',
        templateEmpty: 'The editor is empty',
        delete: 'Delete',
        deleteFile: 'Delete',
        deleteConfirm: 'Delete this instruction file? The official engine will see "Instructions removed".',
        deleted: 'Instruction file deleted',
        preview: 'Preview',
        editMode: 'Edit',
        previewEmpty: '(empty)',
        renderErrorTitle: 'Instruction panel failed to render',
        renderErrorHint: 'Send the error below to the author; other sessions are unaffected.',
        templateInserted: 'Template inserted',

        templatesHint: 'Click to append to the current editor; it will be auto-saved.',
        templateInserted: 'Template inserted',
        openPanel: 'Open manager',
        settingsRowHint: 'Manage global and project AGENTS.md instructions and inspect the official injection preview.',
        export: 'Export',
        import: 'Import',
        exportDone: 'Backup exported',
        importDone: 'Import finished',
        importConfirm: 'Importing will overwrite global and matched project instructions with the backup. Continue?',
        importInvalid: 'Not a valid dsh-instructions backup file',

        engineInactiveWarn:
          'This session agent preset does not mount the built-in injection engine (for example the minimal preset): these instructions are not injected. Switch to the standard / ptc / cordis preset.',


        workspaceUnavailable: 'Workspace list unavailable',
        projectFile: 'Project instruction file',
        globalFile: 'Global instruction file',
        path: 'Path',
        copyPath: 'Copy path',
        copied: 'Copied',
        globalPlaceholder: 'e.g. Always answer in English; explain the plan before editing; never commit automatically.',
        projectPlaceholder: 'e.g. This project uses pnpm; tests run with pnpm test; layout conventions…',
        discardConfirm: 'Discard unsaved changes and switch?',
        error: 'Load failed',
        retry: 'Retry',
        root: 'Project root',
        gitMissing: 'No .git found; only this workspace folder is read',
        scopeGlobal: 'Global',
        scopeShared: 'Shared global',
        scopeProject: 'Project',
        depth: 'Depth',
        sharedTitle: 'Shared global instructions (~/.agents/AGENTS.md)',
        sharedHint: 'Shared across tools; shown read-only here. Edit that file directly to change it.',
        noSelection: 'Select a project on the left to edit its pre-instructions',
        projectHint: 'Written to this workspace AGENTS.md; applies only to sessions in this workspace.',
      },
    }

    const CUSTOM_TEMPLATE_KEY = 'dsh-instructions/custom-templates/v1'

    const TEMPLATES = [
      {
        id: 'language-zh',
        group: 'style',
        zh: '始终使用简体中文回答；代码、命令和文件路径保持原样。',
        en: 'Always answer in Simplified Chinese. Keep code, commands and file paths as-is.',
      },
      {
        id: 'plan-first',
        group: 'style',
        zh: '修改代码前，先用一两句话说明计划；涉及多文件或高风险改动时，先征得同意。',
        en: 'Before editing code, state the plan in one or two sentences; ask first for multi-file or risky changes.',
      },
      {
        id: 'pnpm',
        group: 'code',
        zh: '本仓库使用 pnpm；安装依赖用 pnpm install，运行测试用 pnpm test，不要用 npm/yarn 生成新的锁文件。',
        en: 'This repository uses pnpm: install with pnpm install, test with pnpm test; do not create npm/yarn lockfiles.',
      },
      {
        id: 'tests',
        group: 'code',
        zh: '修改行为后补充或更新测试；提交前运行与改动相关的测试，并在回复中说明测试结果。',
        en: 'Add or update tests when behavior changes; run the relevant tests before finishing and report the result.',
      },
      {
        id: 'commit',
        group: 'git',
        zh: '不要自动 git commit / push；需要提交时先说明将要提交的文件和提交信息，得到同意后再执行。',
        en: 'Do not git commit or push automatically. Show the files and message you intend to commit, then wait for approval.',
      },
      {
        id: 'secrets',
        group: 'security',
        zh: '不要读取或输出任何密钥、令牌、.env 内容；需要凭据时说明需要哪一类凭据，由用户自行提供。',
        en: 'Never read or print secrets, tokens or .env contents; state what kind of credential is needed and let the user supply it.',
      },
      {
        id: 'scope',
        group: 'security',
        zh: '只修改与当前任务相关的文件；不要顺手清理、重排或重构无关代码。',
        en: 'Only touch files relevant to the task; do not clean up, reorder or refactor unrelated code.',
      },
      {
        id: 'team',
        group: 'team',
        zh: '提交前检查 AGENTS.md 与 README 是否需要同步更新；新增约定时优先写入项目指令，而不是只留在对话里。',
        en: 'Before finishing, check whether AGENTS.md/README need updates; record new conventions in project instructions rather than leaving them in chat.',
      },
    ]

    const TEMPLATE_GROUPS = [
      { id: 'style', zh: '回答风格', en: 'Answer style' },
      { id: 'code', zh: '代码与测试', en: 'Code & tests' },
      { id: 'git', zh: '提交与 Git', en: 'Commits & Git' },
      { id: 'security', zh: '安全与边界', en: 'Safety & scope' },
      { id: 'team', zh: '协作约定', en: 'Team conventions' },
    ]

    const activeLanguage = () => {
      try {
        const locale = CTX?.get?.('locale')
        const snapshot = locale?.getSnapshot?.()
        const active = typeof snapshot?.active === 'string' ? snapshot.active : ''
        if (active.startsWith('en')) return 'en'
        if (active.startsWith('zh')) return 'zh'
      } catch {
        /* fall through */
      }
      try {
        if (typeof navigator !== 'undefined' && String(navigator.language || '').startsWith('en')) return 'en'
      } catch {
        /* fall through */
      }
      return 'zh'
    }

    const tr = (key) => {
      const language = activeLanguage()
      const dict = STRINGS[language] || STRINGS.zh
      return dict[key] ?? STRINGS.zh[key] ?? key
    }

    const useLocaleTick = () => {
      const [tick, setTick] = useState(0)
      useEffect(() => {
        let dispose
        try {
          const locale = CTX?.get?.('locale')
          if (locale && typeof locale.subscribe === 'function') {
            dispose = locale.subscribe(() => setTick((value) => value + 1))
          }
        } catch {
          /* ignore */
        }
        return () => {
          try {
            dispose?.()
          } catch {
            /* ignore */
          }
        }
      }, [])
      return tick
    }

    const unwrap = async (promise) => {
      const result = await promise
      if (result !== null && typeof result === 'object' && 'ok' in result) {
        if (result.ok) return result.value
        const message = result.error?.message ?? result.error?.code ?? 'remote call failed'
        throw new Error(String(message))
      }
      return result
    }

    const byteLength = (text) => {
      const value = typeof text === 'string' ? text : String(text ?? '')
      try {
        return new TextEncoder().encode(value).length
      } catch {
        return value.length
      }
    }

    const formatBytes = (bytes) => {
      const value = Number(bytes) || 0
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
      return `${(value / (1024 * 1024)).toFixed(1)} MB`
    }

    const copyText = (text) => {
      try {
        navigator.clipboard?.writeText?.(text)
      } catch {
        /* ignore */
      }
    }

    const openInstructionsPanel = (workspaceId, sessionId) => {
      pendingWorkspaceId = workspaceId ? String(workspaceId) : null
      pendingSessionId = sessionId ? String(sessionId) : null
      try {
        CTX?.get?.('layout')?.selectPanel?.('instructions')
      } catch (error) {
        console.error('[dsh-instructions] cannot open the instructions panel', error)
      }
    }

    /* ------------------------------------------------------------------ *
     * Icon + header action
     * ------------------------------------------------------------------ */

    const PanelIcon = (props) => {
      const size = typeof props?.size === 'number' ? props.size : 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M6 3.75h7.6L18.75 8v12.25H6z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M9 12h6M9 15.5h6M9 8.75h2.5',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
      )
    }

    const HeaderAction = (props) => {
      useLocaleTick()
      const sessionId = props?.sessionId
      const [busy, setBusy] = useState(false)
      const [status, setStatus] = useState(null)
      useEffect(() => {
        let cancelled = false
        if (sessionId === undefined || API === null) return undefined
        unwrap(API.getSessionStatus(String(sessionId)))
          .then((value) => {
            if (!cancelled) setStatus(value)
          })
          .catch((error) => {
            console.warn('[dsh-instructions] cannot read the session injection status', error)
          })
        return () => {
          cancelled = true
        }
      }, [String(sessionId ?? '')])
      const count = status?.found ? (Array.isArray(status.files) ? status.files.length : 0) : 0
      const label = count > 0 ? `${tr('headerAction')} · ${count}` : tr('headerAction')
      const engineOff = status?.found === true && status?.engineActive === false
      const title = status?.found
        ? `${tr('headerTip')} · ${tr('sessionPreset')}: ${status.preset ?? '?'} · ${tr('sessionEngine')}: ${
            status.engineActive === false ? tr('engineOff') : tr('engineOn')
          } · ${formatBytes(status.totalBytes)}`
        : tr('headerTip')
      const onClick = useCallback(async () => {
        if (busy) return
        setBusy(true)
        let workspaceId = null
        try {
          if (sessionId !== undefined && API) {
            workspaceId = await unwrap(API.findWorkspaceForSession(String(sessionId)))
          }
        } catch (error) {
          console.warn('[dsh-instructions] cannot resolve the workspace of this session', error)
        } finally {
          setBusy(false)
        }
        openInstructionsPanel(workspaceId, sessionId)
      }, [busy, sessionId])
      return h(
        'button',
        {
          type: 'button',
          className: 'dwi-header-action' + (engineOff ? ' warn' : ''),
          title,
          'aria-label': label,
          onClick,
          disabled: busy,
        },
        h(PanelIcon, { size: 15 }),
        h('span', null, label),
      )
    }

    /* ------------------------------------------------------------------ *
     * Extra entry points: one row in Settings → General and one option in
     * the New Session hero, both opening the Instruction panel.
     * ------------------------------------------------------------------ */

    const SettingsInstructionRow = () => {
      useLocaleTick()
      return h(
        'div',
        { className: 'dwi-settings-row' },
        h(
          'div',
          { className: 'dwi-settings-text' },
          h('div', { className: 'dwi-settings-title' }, tr('panel')),
          h('div', { className: 'dwi-settings-desc' }, tr('settingsRowHint')),
        ),
        h(
          'button',
          { type: 'button', className: 'dwi-btn small', onClick: () => openInstructionsPanel() },
          tr('openPanel'),
        ),
      )
    }

    const HeroInstructionOption = (props) => {
      useLocaleTick()
      const [busy, setBusy] = useState(false)
      const sessionId = props?.sessionId
      const onClick = useCallback(async () => {
        if (busy) return
        setBusy(true)
        let workspaceId = null
        try {
          if (sessionId !== undefined && API) {
            workspaceId = await unwrap(API.findWorkspaceForSession(String(sessionId)))
          }
        } catch (error) {
          console.warn('[dsh-instructions] cannot resolve the workspace of this session', error)
        } finally {
          setBusy(false)
        }
        openInstructionsPanel(workspaceId, sessionId)
      }, [busy, sessionId])
      return h(
        'button',
        { type: 'button', className: 'dwi-btn small', title: tr('headerTip'), onClick, disabled: busy },
        tr('headerAction'),
      )
    }

    /* ------------------------------------------------------------------ *
     * Settings page: global + per-workspace AGENTS.md editors with the
     * effective chain preview.
     * ------------------------------------------------------------------ */

    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        console.error('[dsh-instructions] panel crashed', error)
      }

      render() {
        if (this.state.error !== null) {
          return h(
            'div',
            { className: 'dwi-page' },
            h(
              'div',
              { className: 'dwi-main' },
              h(
                'div',
                { className: 'dwi-card' },
                h('h2', { className: 'dwi-card-title' }, tr('renderErrorTitle')),
                h('p', { className: 'dwi-hint' }, tr('renderErrorHint')),
                h('pre', { className: 'dwi-preview' }, String(this.state.error?.stack ?? this.state.error)),
              ),
            ),
          )
        }
        return this.props.children
      }
    }

    const InstructionsPage = () => {
      useLocaleTick()
      const [state, setState] = useState(null)
      const [status, setStatus] = useState('loading')
      const [errorText, setErrorText] = useState('')
      const [active, setActive] = useState({ kind: 'global' })
      const [project, setProject] = useState(null)
      const [editingPath, setEditingPath] = useState(null)
      const [draft, setDraft] = useState('')
      const [original, setOriginal] = useState('')
      const [originalHash, setOriginalHash] = useState('')
      const [conflict, setConflict] = useState(null)
      const [chainContents, setChainContents] = useState({})
      const [historyOpen, setHistoryOpen] = useState(false)
      const [historyEntries, setHistoryEntries] = useState([])
      const [historyLoading, setHistoryLoading] = useState(false)
      const [templatesOpen, setTemplatesOpen] = useState(false)
      const [customTemplates, setCustomTemplates] = useState(() => {
        try {
          const raw = window.localStorage.getItem(CUSTOM_TEMPLATE_KEY)
          if (typeof raw === 'string' && raw.length > 0) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) {
              return parsed
                .filter((item) => item && typeof item.id === 'string' && typeof item.text === 'string')
                .slice(0, 30)
            }
          }
        } catch {
          /* storage unavailable */
        }
        return []
      })
      const [previewMode, setPreviewMode] = useState(false)
      const [exporting, setExporting] = useState(false)
      const [importing, setImporting] = useState(false)
      const importInputRef = React.useRef(null)
      const [saving, setSaving] = useState(false)
      const [notice, setNotice] = useState(null)
      const [lastSavedAt, setLastSavedAt] = useState(0)
      const [search, setSearch] = useState('')
      const [sessionId, setSessionId] = useState(null)
      const [sessionStatus, setSessionStatus] = useState(null)
      const saveRef = React.useRef(null)
      const dirty = draft !== original

      useEffect(() => {
        try {
          window.localStorage.setItem(CUSTOM_TEMPLATE_KEY, JSON.stringify(customTemplates))
        } catch {
          /* storage unavailable */
        }
      }, [customTemplates])

      const estimateTokens = (text) => {
        const value = String(text ?? '')
        let cjk = 0
        let other = 0
        for (const character of value) {
          const code = character.codePointAt(0) ?? 0
          const isCjk =
            (code >= 0x3040 && code <= 0x30ff) ||
            (code >= 0x3400 && code <= 0x9fff) ||
            (code >= 0xac00 && code <= 0xd7af) ||
            (code >= 0xf900 && code <= 0xfaff)
          if (isCjk) cjk += 1
          else other += 1
        }
        return cjk + Math.ceil(other / 4)
      }

      const fetchSessionStatus = useCallback(async (id) => {
        if (!API || id === null || id === undefined) return
        try {
          const value = await unwrap(API.getSessionStatus(String(id)))
          setSessionStatus(value)
        } catch (error) {
          console.warn('[dsh-instructions] cannot read the session injection status', error)
        }
      }, [])

      const loadChainContents = useCallback(async (workspaceId, projectState) => {
        const entries = (projectState?.chain ?? []).filter(
          (entry) => entry.scope === 'project' && entry.exists === true,
        )
        const map = {}
        await Promise.all(
          entries.map(async (entry) => {
            try {
              const file = await unwrap(API.readFile(workspaceId, entry.absolutePath))
              map[entry.absolutePath] = file.content ?? ''
            } catch {
              /* one unreadable chain file should not blank the preview */
            }
          }),
        )
        setChainContents(map)
      }, [])

      const applyGlobal = useCallback((next) => {
        setState(next)
        setActive({ kind: 'global' })
        setProject(null)
        setEditingPath(null)
        setHistoryOpen(false)
        setPreviewMode(false)
        setConflict(null)
        const content = next?.global?.content ?? ''
        setDraft(content)
        setOriginal(content)
        setOriginalHash(next?.global?.hash ?? '')
      }, [])

      const loadProject = useCallback(
        async (workspaceId) => {
          const full = await unwrap(API.readProject(workspaceId))
          setActive({ kind: 'project', id: workspaceId })
          setProject(full)
          setEditingPath(null)
          setHistoryOpen(false)
          setPreviewMode(false)
          setConflict(null)
          setDraft(full?.content ?? '')
          setOriginal(full?.content ?? '')
          setOriginalHash(full?.targetHash ?? '')
          setChainContents({})
          void loadChainContents(workspaceId, full)
          setNotice(null)
        },
        [loadChainContents],
      )

      const boot = useCallback(async () => {
        setStatus('loading')
        setErrorText('')
        try {
          const next = await unwrap(API.getState())
          const wantedWorkspace =
            pendingWorkspaceId !== null && next.projects.some((item) => item.id === pendingWorkspaceId)
              ? pendingWorkspaceId
              : null
          const wantedSession = pendingSessionId
          pendingWorkspaceId = null
          pendingSessionId = null
          if (wantedWorkspace !== null) {
            setState(next)
            await loadProject(wantedWorkspace)
          } else {
            applyGlobal(next)
          }
          if (wantedSession !== null) {
            setSessionId(String(wantedSession))
            await fetchSessionStatus(wantedSession)
          }
          setStatus('ready')
        } catch (error) {
          setStatus('error')
          setErrorText(String(error?.message ?? error))
        }
      }, [applyGlobal, loadProject, fetchSessionStatus])

      useEffect(() => {
        let cancelled = false
        boot().catch((error) => {
          if (cancelled) return
          setStatus('error')
          setErrorText(String(error?.message ?? error))
        })
        return () => {
          cancelled = true
        }
      }, [boot])

      const save = useCallback(
        async (mode, options = {}) => {
          if (!API || saving || !dirty) return false
          if (conflict !== null && options.force !== true) return false
          const baseHash = options.force === true ? '' : originalHash
          setSaving(true)
          setNotice(null)
          try {
            let result
            if (active.kind === 'project' && typeof active.id === 'string') {
              result =
                editingPath !== null
                  ? await unwrap(API.saveFile(active.id, editingPath, draft, baseHash))
                  : await unwrap(API.saveProject(active.id, draft, baseHash))
            } else {
              result = await unwrap(API.saveGlobal(draft, baseHash))
            }
            if (result !== null && typeof result === 'object' && result.stale === true) {
              setConflict({ current: result.current ?? null })
              setNotice({ kind: 'error', text: tr('conflictDetected') })
              return false
            }
            setConflict(null)
            if (active.kind === 'project' && typeof active.id === 'string') {
              const full = result?.project
              setProject(full)
              setState((previous) =>
                previous === null
                  ? previous
                  : {
                      ...previous,
                      projects: previous.projects.map((item) =>
                        item.id === active.id
                          ? { ...item, targetExists: full?.targetExists, bytes: full?.bytes, mtime: full?.mtime }
                          : item,
                      ),
                    },
              )
              if (editingPath !== null) {
                setDraft(result?.file?.content ?? '')
                setOriginal(result?.file?.content ?? '')
                setOriginalHash(result?.file?.hash ?? '')
                if (result?.file?.exists !== true && editingPath !== full?.targetPath) {
                  setEditingPath(null)
                  setDraft(full?.content ?? '')
                  setOriginal(full?.content ?? '')
                  setOriginalHash(full?.targetHash ?? '')
                }
              } else {
                setDraft(full?.content ?? draft)
                setOriginal(full?.content ?? draft)
                setOriginalHash(full?.targetHash ?? '')
              }
              void loadChainContents(active.id, full)
            } else {
              const global = result?.global
              setOriginal(draft)
              setOriginalHash(global?.hash ?? '')
              setState((previous) =>
                previous === null ? previous : { ...previous, global: { ...previous.global, ...global } },
              )
            }
            setLastSavedAt(Date.now())
            setNotice({ kind: 'ok', text: mode === 'auto' ? tr('autoSaved') : tr('saved') })
            if (sessionId !== null) fetchSessionStatus(sessionId)
            return true
          } catch (error) {
            setNotice({ kind: 'error', text: String(error?.message ?? error) })
            return false
          } finally {
            setSaving(false)
          }
        },
        [
          active,
          draft,
          dirty,
          editingPath,
          saving,
          sessionId,
          fetchSessionStatus,
          loadChainContents,
          originalHash,
          conflict,
        ],
      )
      saveRef.current = save

      // Auto-save: 800ms after the last edit, write straight into the file the
      // official engine reads, so a forgotten Save click cannot lose content.
      useEffect(() => {
        if (!dirty || saving || status !== 'ready' || conflict !== null) return undefined
        const timer = setTimeout(() => {
          const current = saveRef.current
          if (typeof current === 'function') current('auto')
        }, 800)
        return () => clearTimeout(timer)
      }, [draft, dirty, saving, status, active.kind, active.id, editingPath, conflict])

      // Detect external edits when the window regains focus.
      useEffect(() => {
        const onFocus = () => {
          if (status !== 'ready' || saving) return
          ;(async () => {
            try {
              if (active.kind === 'global') {
                const next = await unwrap(API.getState())
                setState(next)
                const diskHash = next?.global?.hash ?? ''
                if (diskHash !== originalHash) {
                  if (!dirty) {
                    setDraft(next?.global?.content ?? '')
                    setOriginal(next?.global?.content ?? '')
                    setOriginalHash(diskHash)
                    setNotice({ kind: 'ok', text: tr('restoredFromDisk') })
                  } else {
                    setConflict({ current: { content: next?.global?.content ?? '', hash: diskHash } })
                  }
                }
              } else if (editingPath !== null) {
                const file = await unwrap(API.readFile(active.id, editingPath))
                const diskHash = file?.hash ?? ''
                if (diskHash !== originalHash) {
                  if (!dirty) {
                    setDraft(file?.content ?? '')
                    setOriginal(file?.content ?? '')
                    setOriginalHash(diskHash)
                    setNotice({ kind: 'ok', text: tr('restoredFromDisk') })
                  } else {
                    setConflict({ current: { content: file?.content ?? '', hash: diskHash } })
                  }
                }
              } else if (project !== null) {
                const full = await unwrap(API.readProject(active.id))
                const diskHash = full?.targetHash ?? ''
                if (diskHash !== originalHash) {
                  if (!dirty) {
                    setProject(full)
                    setDraft(full?.content ?? '')
                    setOriginal(full?.content ?? '')
                    setOriginalHash(diskHash)
                    void loadChainContents(active.id, full)
                    setNotice({ kind: 'ok', text: tr('restoredFromDisk') })
                  } else {
                    setConflict({ current: { content: full?.content ?? '', hash: diskHash } })
                  }
                }
              }
              if (sessionId !== null) fetchSessionStatus(sessionId)
            } catch (error) {
              console.warn('[dsh-instructions] external change check failed', error)
            }
          })()
        }
        window.addEventListener('focus', onFocus)
        return () => window.removeEventListener('focus', onFocus)
      }, [
        active.kind,
        active.id,
        editingPath,
        dirty,
        originalHash,
        project,
        status,
        saving,
        sessionId,
        fetchSessionStatus,
        loadChainContents,
      ])

      const flush = async () => {
        if (!API) return true
        if (saving) {
          await new Promise((resolve) => setTimeout(resolve, 120))
          if (saving) return false
        }
        if (!dirty) return true
        const current = saveRef.current
        if (typeof current !== 'function') return true
        return (await current('flush')) !== false
      }

      const refresh = async () => {
        if (status === 'loading' || saving) return
        if (!(await flush())) return
        setStatus('loading')
        setErrorText('')
        try {
          const next = await unwrap(API.getState())
          setState(next)
          if (active.kind === 'project') {
            const stillThere = next.projects.some((item) => item.id === active.id)
            if (stillThere) await loadProject(active.id)
            else applyGlobal(next)
          } else {
            applyGlobal(next)
          }
          if (sessionId !== null) await fetchSessionStatus(sessionId)
          setStatus('ready')
        } catch (error) {
          setStatus('error')
          setErrorText(String(error?.message ?? error))
        }
      }

      const reloadConflict = async () => {
        setConflict(null)
        try {
          if (active.kind === 'global') {
            const next = await unwrap(API.getState())
            applyGlobal(next)
          } else if (editingPath !== null) {
            const file = await unwrap(API.readFile(active.id, editingPath))
            setDraft(file?.content ?? '')
            setOriginal(file?.content ?? '')
            setOriginalHash(file?.hash ?? '')
          } else {
            await loadProject(active.id)
          }
          setNotice({ kind: 'ok', text: tr('restoredFromDisk') })
        } catch (error) {
          setNotice({ kind: 'error', text: String(error?.message ?? error) })
        }
      }

      const selectGlobal = async () => {
        if (!(await flush())) return
        applyGlobal(state)
        setNotice(null)
      }

      const selectProject = async (workspaceId) => {
        if (workspaceId === active.id) return
        if (!(await flush())) return
        try {
          await loadProject(workspaceId)
        } catch (error) {
          setNotice({ kind: 'error', text: String(error?.message ?? error) })
        }
      }

      const selectChainFile = async (entry) => {
        if (!(await flush())) return
        try {
          const file = await unwrap(API.readFile(active.id, entry.absolutePath))
          setEditingPath(file.filePath)
          setDraft(file.content ?? '')
          setOriginal(file.content ?? '')
          setOriginalHash(file.hash ?? '')
          setConflict(null)
          setHistoryOpen(false)
          setPreviewMode(false)
          setNotice(null)
        } catch (error) {
          setNotice({ kind: 'error', text: String(error?.message ?? error) })
        }
      }

      const backToPrimary = async () => {
        if (!(await flush())) return
        try {
          await loadProject(active.id)
        } catch (error) {
          setNotice({ kind: 'error', text: String(error?.message ?? error) })
        }
      }

      const historyTarget = () => ({
        workspaceId: active.kind === 'global' ? '' : active.id ?? '',
        filePath: active.kind === 'global' ? '' : editingPath ?? project?.targetPath ?? '',
      })

      const refreshHistory = async () => {
        try {
          setHistoryLoading(true)
          const target = historyTarget()
          if (target.filePath === '' && active.kind !== 'global') {
            setHistoryEntries([])
            return
          }
          const result = await unwrap(API.listHistory(target.workspaceId, target.filePath))
          setHistoryEntries(Array.isArray(result?.entries) ? result.entries : [])
        } catch (error) {
          setNotice({ kind: 'error', text: String(error?.message ?? error) })
        } finally {
          setHistoryLoading(false)
        }
      }

      const openHistory = async () => {
        setHistoryOpen(true)
        await refreshHistory()
      }

      const restoreHistoryEntry = async (entry) => {
        if (!window.confirm(tr('restoreConfirm'))) return
        try {
          const target = historyTarget()
          const result = await unwrap(API.restoreHistory(target.workspaceId, target.filePath, entry.id))
          setHistoryEntries(Array.isArray(result?.entries) ? result.entries : [])
          if (active.kind === 'global') {
            const next = await unwrap(API.getState())
            applyGlobal(next)
          } else {
            const full = await unwrap(API.readProject(active.id))
            setProject(full)
            if (editingPath !== null) {
              setDraft(result?.file?.content ?? '')
              setOriginal(result?.file?.content ?? '')
              setOriginalHash(result?.file?.hash ?? '')
            } else {
              setDraft(full?.content ?? '')
              setOriginal(full?.content ?? '')
              setOriginalHash(full?.targetHash ?? '')
            }
            setState((previous) =>
              previous === null
                ? previous
                : {
                    ...previous,
                    projects: previous.projects.map((item) =>
                      item.id === active.id
                        ? { ...item, targetExists: full?.targetExists, bytes: full?.bytes, mtime: full?.mtime }
                        : item,
                    ),
                  },
            )
            void loadChainContents(active.id, full)
          }
          setNotice({ kind: 'ok', text: tr('restored') })
        } catch (error) {
          setNotice({ kind: 'error', text: String(error?.message ?? error) })
        }
      }

      const insertText = (text) => {
        const separator =
          draft.length === 0 ? '' : draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n'
        setDraft(draft + separator + text)
        setNotice({ kind: 'ok', text: tr('templateInserted') })
        setTemplatesOpen(false)
      }

      const insertTemplate = (template) => {
        insertText(activeLanguage() === 'en' ? template.en : template.zh)
      }

      const insertCustomTemplate = (template) => {
        insertText(template.text)
      }

      const addCustomTemplate = () => {
        const text = draft.trim()
        if (text.length === 0) {
          setNotice({ kind: 'error', text: tr('templateEmpty') })
          return
        }
        setCustomTemplates((previous) =>
          [{ id: `custom-${Date.now().toString(36)}`, text: draft }, ...previous].slice(0, 30),
        )
        setNotice({ kind: 'ok', text: tr('templateAdded') })
      }

      const removeCustomTemplate = (id) => {
        setCustomTemplates((previous) => previous.filter((item) => item.id !== id))
      }

      const exportAll = async () => {
        if (!API || exporting) return
        setExporting(true)
        setNotice(null)
        try {
          const next = await unwrap(API.getState())
          const projects = []
          for (const item of next.projects) {
            try {
              const full = await unwrap(API.readProject(item.id))
              projects.push({
                id: item.id,
                title: item.title,
                path: item.path,
                filePath: full?.targetPath ?? '',
                content: full?.content ?? '',
              })
            } catch (error) {
              projects.push({ id: item.id, title: item.title, path: item.path, error: String(error?.message ?? error) })
            }
          }
          const payload = {
            format: 'dsh-instructions/v1',
            exportedAt: new Date().toISOString(),
            global: { path: next.global?.path ?? '', content: next.global?.content ?? '' },
            projects,
          }
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = `dsh-instructions-${new Date().toISOString().slice(0, 10)}.json`
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          setNotice({ kind: 'ok', text: tr('exportDone') })
        } catch (error) {
          setNotice({ kind: 'error', text: String(error?.message ?? error) })
        } finally {
          setExporting(false)
        }
      }

      const handleImportFile = async (event) => {
        const file = event?.target?.files?.[0]
        if (event?.target) event.target.value = ''
        if (!file) return
        if (!window.confirm(tr('importConfirm'))) return
        setImporting(true)
        setNotice(null)
        try {
          const text = await file.text()
          const payload = JSON.parse(text)
          if (payload === null || typeof payload !== 'object' || payload.format !== 'dsh-instructions/v1') {
            throw new Error(tr('importInvalid'))
          }
          const next = await unwrap(API.getState())
          let written = 0
          let skipped = 0
          if (typeof payload.global?.content === 'string') {
            await unwrap(API.saveGlobal(payload.global.content, ''))
            written += 1
          }
          for (const entry of Array.isArray(payload.projects) ? payload.projects : []) {
            const match =
              next.projects.find((item) => item.path === entry?.path) ??
              next.projects.find((item) => item.id === entry?.id)
            if (match === undefined || typeof entry?.content !== 'string') {
              skipped += 1
              continue
            }
            await unwrap(API.saveProject(match.id, entry.content, ''))
            written += 1
          }
          const refreshed = await unwrap(API.getState())
          if (active.kind === 'project') {
            setState(refreshed)
            await loadProject(active.id)
          } else {
            applyGlobal(refreshed)
          }
          setNotice({ kind: 'ok', text: `${tr('importDone')} (${written} / ${skipped})` })
        } catch (error) {
          setNotice({ kind: 'error', text: String(error?.message ?? error) })
        } finally {
          setImporting(false)
        }
      }

      const deleteCurrentFile = async () => {
        if (!API || saving) return
        if (!window.confirm(tr('deleteConfirm'))) return
        setSaving(true)
        setNotice(null)
        try {
          let result
          if (active.kind === 'project' && typeof active.id === 'string') {
            result =
              editingPath !== null
                ? await unwrap(API.saveFile(active.id, editingPath, '', originalHash))
                : await unwrap(API.saveProject(active.id, '', originalHash))
          } else {
            result = await unwrap(API.saveGlobal('', originalHash))
          }
          if (result !== null && typeof result === 'object' && result.stale === true) {
            setConflict({ current: result.current ?? null })
            setNotice({ kind: 'error', text: tr('conflictDetected') })
            return
          }
          setConflict(null)
          if (active.kind === 'project' && typeof active.id === 'string') {
            const full = result?.project
            setProject(full)
            setState((previous) =>
              previous === null
                ? previous
                : {
                    ...previous,
                    projects: previous.projects.map((item) =>
                      item.id === active.id
                        ? { ...item, targetExists: full?.targetExists, bytes: full?.bytes, mtime: full?.mtime }
                        : item,
                    ),
                  },
            )
            if (editingPath !== null && editingPath !== full?.targetPath) {
              setEditingPath(null)
              setDraft(full?.content ?? '')
              setOriginal(full?.content ?? '')
              setOriginalHash(full?.targetHash ?? '')
            } else {
              setDraft('')
              setOriginal('')
              setOriginalHash('')
            }
            void loadChainContents(active.id, full)
          } else {
            const global = result?.global
            setDraft('')
            setOriginal('')
            setOriginalHash(global?.hash ?? '')
            setState((previous) =>
              previous === null ? previous : { ...previous, global: { ...previous.global, ...global } },
            )
          }
          setLastSavedAt(Date.now())
          setNotice({ kind: 'ok', text: tr('deleted') })
          if (sessionId !== null) fetchSessionStatus(sessionId)
        } catch (error) {
          setNotice({ kind: 'error', text: String(error?.message ?? error) })
        } finally {
          setSaving(false)
        }
      }

      const renderMarkdown = (text) => {
        const lines = String(text ?? '').split('\n')
        const nodes = []
        let codeLines = null
        let listItems = null
        const flushList = () => {
          if (listItems !== null && listItems.length > 0) {
            nodes.push(h('ul', { className: 'dwi-md-list', key: `ul-${nodes.length}` }, listItems))
          }
          listItems = null
        }
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]
          if (line.trim().startsWith('```')) {
            if (codeLines === null) {
              codeLines = []
            } else {
              nodes.push(h('pre', { className: 'dwi-md-code', key: `code-${index}` }, codeLines.join('\n')))
              codeLines = null
            }
            continue
          }
          if (codeLines !== null) {
            codeLines.push(line)
            continue
          }
          if (line.startsWith('### ')) {
            flushList()
            nodes.push(h('h4', { className: 'dwi-md-h', key: `h-${index}` }, line.slice(4)))
          } else if (line.startsWith('## ')) {
            flushList()
            nodes.push(h('h3', { className: 'dwi-md-h', key: `h-${index}` }, line.slice(3)))
          } else if (line.startsWith('# ')) {
            flushList()
            nodes.push(h('h2', { className: 'dwi-md-h', key: `h-${index}` }, line.slice(2)))
          } else if (/^\s*[-*]\s+/.test(line)) {
            if (listItems === null) listItems = []
            listItems.push(h('li', { key: `li-${index}` }, line.replace(/^\s*[-*]\s+/, '')))
          } else if (line.trim().length === 0) {
            flushList()
          } else {
            flushList()
            nodes.push(h('p', { className: 'dwi-md-p', key: `p-${index}` }, line))
          }
        }
        if (codeLines !== null) {
          nodes.push(h('pre', { className: 'dwi-md-code', key: 'code-end' }, codeLines.join('\n')))
        }
        flushList()
        return nodes
      }

      const projects = state?.projects ?? []
      const globalInfo = state?.global ?? null
      const globalSavedContent = globalInfo?.content ?? ''
      const currentFilePath =
        active.kind === 'project' ? (editingPath ?? project?.targetPath ?? '') : null
      const projectChain = project?.chain ?? []
      const currentFileExists =
        editingPath === null
          ? project?.targetExists === true
          : projectChain.some((entry) => entry.absolutePath === editingPath)
      const searchText = search.trim().toLowerCase()
      const filteredProjects =
        searchText.length === 0
          ? projects
          : projects.filter(
              (item) =>
                String(item.title ?? '').toLowerCase().includes(searchText) ||
                String(item.path ?? '').toLowerCase().includes(searchText),
            )

      const shortPath = (absolute) => {
        if (typeof absolute !== 'string') return ''
        const root = typeof project?.root === 'string' ? project.root : ''
        if (root.length > 0 && absolute.startsWith(root)) {
          const rel = absolute.slice(root.length)
          return rel.startsWith('/') ? rel.slice(1) : rel
        }
        return absolute
      }

      const pathRow = (label, filePath, key) =>
        h(
          'div',
          { className: 'dwi-path-row', key },
          h('span', { className: 'dwi-path-label' }, label),
          h('code', { className: 'dwi-path-value', title: filePath }, filePath),
          h(
            'button',
            { type: 'button', className: 'dwi-btn small', onClick: () => copyText(filePath) },
            tr('copyPath'),
          ),
        )

      const onEditorKeyDown = (event) => {
        if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 's') {
          event.preventDefault()
          const current = saveRef.current
          if (typeof current === 'function') current('manual')
        }
      }

      const editorFooter = (meta) =>
        h(
          'div',
          { className: 'dwi-editor-footer' },
          h('div', { className: 'dwi-editor-meta' }, meta),
          h(
            'div',
            { className: 'dwi-editor-actions' },
            h(
              'span',
              { className: 'dwi-save-line' },
              saving
                ? tr('saving')
                : dirty
                  ? tr('autoSavePending')
                  : lastSavedAt > 0
                    ? `${tr('savedAt')} ${new Date(lastSavedAt).toLocaleTimeString()}`
                    : tr('autoSaveHint'),
            ),
            notice !== null ? h('span', { className: 'dwi-notice ' + notice.kind }, notice.text) : null,
            h(
              'button',
              {
                type: 'button',
                className: 'dwi-btn primary',
                disabled: saving || !dirty,
                onClick: () => {
                  const current = saveRef.current
                  if (typeof current === 'function') current('manual')
                },
              },
              dirty ? tr('saveNow') : tr('saved'),
            ),
          ),
        )

      const injectionBlocks = () => {
        const blocks = []
        const globalText = active.kind === 'global' ? draft : globalSavedContent
        if (globalText.trim().length > 0) {
          blocks.push({ label: `${tr('previewLabelGlobal')} · ~/.dsh/AGENTS.md`, text: globalText })
        }
        if (active.kind === 'project' && project !== null) {
          for (const entry of projectChain) {
            const text =
              entry.absolutePath === currentFilePath ? draft : chainContents[entry.absolutePath] ?? ''
            if (text.trim().length > 0) {
              blocks.push({ label: `${tr('scopeProject')} · ${entry.displayPath}`, text })
            }
          }
        }
        return blocks
      }

      const injectionCard = () => {
        const blocks = injectionBlocks()
        const totalBytes = blocks.reduce((sum, block) => sum + byteLength(block.text), 0)
        const totalTokens = blocks.reduce((sum, block) => sum + estimateTokens(block.text), 0)
        const budget = Number(state?.budgetBytes) > 0 ? Number(state.budgetBytes) : 65536
        const percent = Math.min(100, (totalBytes / budget) * 100)
        const copySource = blocks.map((block) => `${block.label}\n${block.text}`).join('\n\n')
        return h(
          'div',
          { className: 'dwi-card' },
          h(
            'div',
            { className: 'dwi-card-head' },
            h('h3', { className: 'dwi-card-title' }, tr('injectionTitle')),
            h(
              'button',
              {
                type: 'button',
                className: 'dwi-btn small',
                disabled: copySource.length === 0,
                onClick: () => {
                  copyText(copySource)
                  setNotice({ kind: 'ok', text: tr('copiedPreview') })
                },
              },
              tr('copyPreview'),
            ),
          ),
          h('p', { className: 'dwi-hint' }, tr('injectionHint')),
          blocks.length > 0
            ? blocks.map((block, index) =>
                h(
                  'div',
                  { className: 'dwi-preview-block', key: `${block.label}:${index}` },
                  h('div', { className: 'dwi-preview-head' }, block.label),
                  h('pre', { className: 'dwi-preview' }, block.text),
                ),
              )
            : h('p', { className: 'dwi-empty' }, tr('injectionEmpty')),
          h(
            'div',
            { className: 'dwi-token-line' + (percent > 80 ? ' warn' : '') },
            `${formatBytes(totalBytes)} · ${tr('tokenEstimate')} ≈ ${totalTokens} tokens · ${tr(
              'budgetUsage',
            )} ${percent.toFixed(1)}% / ${formatBytes(budget)}`,
          ),
        )
      }

      const sessionCard = () => {
        if (sessionStatus === null) return null
        const files = Array.isArray(sessionStatus.files) ? sessionStatus.files : []
        return h(
          'div',
          { className: 'dwi-card' },
          h(
            'div',
            { className: 'dwi-card-head' },
            h(
              'div',
              null,
              h('h3', { className: 'dwi-card-title' }, tr('sessionStatusTitle')),
              h(
                'p',
                { className: 'dwi-hint' },
                `${tr('sessionPreset')}: ${sessionStatus.preset ?? '?'} · ${tr('sessionEngine')}: ${
                  sessionStatus.engineActive === false
                    ? tr('engineOff')
                    : sessionStatus.engineActive === true
                      ? tr('engineOn')
                      : '?'
                }`,
              ),
              h(
                'p',
                { className: 'dwi-hint' },
                `${tr('lastInjected')}: ${
                  sessionStatus.lastAt ? new Date(sessionStatus.lastAt).toLocaleString() : '—'
                } · ${sessionStatus.messages ?? 0} ${tr('messagesUnit')} · ${
                  sessionStatus.baseline ? tr('baselineOn') : tr('baselineOff')
                }`,
              ),
            ),
            h(
              'span',
              { className: 'dwi-badge' + (sessionStatus.found ? '' : ' muted') },
              sessionStatus.found
                ? `${files.length} ${tr('sessionFiles')} · ${formatBytes(sessionStatus.totalBytes)}`
                : tr('sessionUnknown'),
            ),
          ),
          files.length > 0
            ? h(
                'ul',
                { className: 'dwi-simple-list' },
                files.map((file, index) =>
                  h('li', { key: `${file.scope}:${index}` }, h('code', null, file.path || file.scope)),
                ),
              )
            : null,
        )
      }

      const conflictBanner =
        conflict !== null
          ? h(
              'div',
              { className: 'dwi-banner warn dwi-conflict' },
              h(
                'div',
                null,
                h('strong', null, tr('conflictDetected')),
                h('p', { className: 'dwi-hint' }, tr('conflictBody')),
              ),
              h(
                'div',
                { className: 'dwi-conflict-actions' },
                h('button', { type: 'button', className: 'dwi-btn', onClick: reloadConflict }, tr('reloadFromDisk')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dwi-btn primary',
                    onClick: () => saveRef.current?.('manual', { force: true }),
                  },
                  tr('overwrite'),
                ),
              ),
            )
          : null

      const historyCard =
        historyOpen
          ? h(
              'div',
              { className: 'dwi-card' },
              h(
                'div',
                { className: 'dwi-card-head' },
                h(
                  'div',
                  null,
                  h('h3', { className: 'dwi-card-title' }, tr('historyTitle')),
                  h('p', { className: 'dwi-hint' }, tr('historyHint')),
                ),
                h(
                  'div',
                  { className: 'dwi-head-actions' },
                  h(
                    'button',
                    { type: 'button', className: 'dwi-btn small', onClick: refreshHistory, disabled: historyLoading },
                    tr('historyRefresh'),
                  ),
                  h('button', { type: 'button', className: 'dwi-btn small', onClick: () => setHistoryOpen(false) }, tr('close')),
                ),
              ),
              historyLoading
                ? h('p', { className: 'dwi-empty' }, tr('loading'))
                : historyEntries.length === 0
                  ? h('p', { className: 'dwi-empty' }, tr('historyEmpty'))
                  : h(
                      'ul',
                      { className: 'dwi-history-list' },
                      historyEntries.map((entry) =>
                        h(
                          'li',
                          { key: entry.id, className: 'dwi-history-row' },
                          h(
                            'div',
                            { className: 'dwi-history-main' },
                            h(
                              'div',
                              { className: 'dwi-history-meta' },
                              `${new Date(entry.savedAt).toLocaleString()} · ${formatBytes(entry.bytes)}`,
                            ),
                            h('pre', { className: 'dwi-history-preview' }, entry.preview),
                          ),
                          h(
                            'button',
                            { type: 'button', className: 'dwi-btn small', onClick: () => restoreHistoryEntry(entry) },
                            tr('restore'),
                          ),
                        ),
                      ),
                    ),
            )
          : null

      const templatesCard = templatesOpen
        ? h(
            'div',
            { className: 'dwi-card' },
            h(
              'div',
              { className: 'dwi-card-head' },
              h(
                'div',
                null,
                h('h3', { className: 'dwi-card-title' }, tr('templates')),
                h('p', { className: 'dwi-hint' }, tr('templatesHint')),
              ),
              h(
                'button',
                { type: 'button', className: 'dwi-btn small', onClick: () => setTemplatesOpen(false) },
                tr('close'),
              ),
            ),
            TEMPLATE_GROUPS.map((group) =>
              h(
                'div',
                { className: 'dwi-template-group', key: group.id },
                h(
                  'div',
                  { className: 'dwi-template-group-title' },
                  activeLanguage() === 'en' ? group.en : group.zh,
                ),
                h(
                  'div',
                  { className: 'dwi-template-list' },
                  TEMPLATES.filter((template) => template.group === group.id).map((template) =>
                    h(
                      'button',
                      {
                        key: template.id,
                        type: 'button',
                        className: 'dwi-template-item',
                        onClick: () => insertTemplate(template),
                      },
                      activeLanguage() === 'en' ? template.en : template.zh,
                    ),
                  ),
                ),
              ),
            ),
            h(
              'div',
              { className: 'dwi-template-group' },
              h('div', { className: 'dwi-template-group-title' }, tr('customTemplates')),
              customTemplates.length === 0
                ? h('p', { className: 'dwi-hint' }, tr('customTemplatesEmpty'))
                : null,
              customTemplates.length > 0
                ? h(
                    'div',
                    { className: 'dwi-template-list' },
                    customTemplates.map((template) =>
                      h(
                        'div',
                        { className: 'dwi-custom-row', key: template.id },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dwi-template-item',
                            onClick: () => insertCustomTemplate(template),
                          },
                          template.text,
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dwi-btn small danger',
                            onClick: () => removeCustomTemplate(template.id),
                          },
                          tr('delete'),
                        ),
                      ),
                    ),
                  )
                : null,
              h(
                'div',
                { className: 'dwi-template-actions' },
                h('button', { type: 'button', className: 'dwi-btn small', onClick: addCustomTemplate }, tr('addTemplate')),
              ),
            ),
          )
        : null

      const engineBanner =
        sessionStatus !== null && sessionStatus.engineActive === false
          ? h('div', { className: 'dwi-banner warn' }, tr('engineInactiveWarn'))
          : null

      const nav = h(
        'aside',
        { className: 'dwi-nav' },
        h(
          'button',
          {
            type: 'button',
            className: 'dwi-nav-item' + (active.kind === 'global' ? ' active' : ''),
            onClick: selectGlobal,
          },
          h('span', { className: 'dwi-nav-title' }, tr('global')),
          h('span', { className: 'dwi-nav-path' }, '~/.dsh/AGENTS.md'),
          h(
            'span',
            { className: 'dwi-nav-meta' },
            globalInfo?.exists
              ? `${formatBytes(globalInfo.bytes)} · ${tr('injectedBadge')}`
              : tr('notInjectedBadge'),
          ),
        ),
        h('div', { className: 'dwi-nav-heading' }, tr('projects')),
        h('input', {
          className: 'dwi-search',
          type: 'search',
          value: search,
          placeholder: tr('searchPlaceholder'),
          onChange: (event) => setSearch(event.target.value),
        }),
        filteredProjects.length === 0
          ? h(
              'p',
              { className: 'dwi-empty' },
              projects.length > 0
                ? tr('noSearchResults')
                : status === 'loading'
                  ? tr('loading')
                  : status === 'error'
                    ? tr('workspaceUnavailable')
                    : tr('noProjects'),
            )
          : filteredProjects.map((item) =>
              h(
                'button',
                {
                  key: item.id,
                  type: 'button',
                  className:
                    'dwi-nav-item' + (active.kind === 'project' && active.id === item.id ? ' active' : ''),
                  onClick: () => selectProject(item.id),
                },
                h('span', { className: 'dwi-nav-title' }, item.title),
                h('span', { className: 'dwi-nav-path', title: item.path }, item.path),
                h(
                  'span',
                  { className: 'dwi-nav-meta' },
                  item.targetExists
                    ? `${formatBytes(item.bytes)} · ${new Date(item.mtime).toLocaleString()}`
                    : tr('notInjectedBadge'),
                ),
              ),
            ),
      )

      let main = null
      if (status === 'loading' && state === null) {
        main = h('section', { className: 'dwi-main' }, h('p', { className: 'dwi-empty' }, tr('loading')))
      } else if (status === 'error') {
        main = h(
          'section',
          { className: 'dwi-main' },
          h(
            'div',
            { className: 'dwi-card' },
            h('p', { className: 'dwi-error' }, `${tr('error')}: ${errorText}`),
            h('button', { type: 'button', className: 'dwi-btn', onClick: refresh }, tr('retry')),
          ),
        )
      } else if (active.kind === 'global') {
        main = h(
          'section',
          { className: 'dwi-main' },
          engineBanner,
          sessionCard(),
          conflictBanner,
          globalInfo?.exists !== true ? h('div', { className: 'dwi-banner warn' }, tr('globalMissingWarn')) : null,
          h(
            'div',
            { className: 'dwi-card' },
            h(
              'div',
              { className: 'dwi-card-head' },
              h(
                'div',
                null,
                h('h2', { className: 'dwi-card-title' }, tr('global')),
                h('p', { className: 'dwi-hint' }, tr('globalHint')),
              ),
              h(
                'div',
                { className: 'dwi-head-actions' },
                h(
                  'button',
                  { type: 'button', className: 'dwi-btn small', onClick: () => setPreviewMode((value) => !value) },
                  previewMode ? tr('editMode') : tr('preview'),
                ),
                globalInfo?.exists
                  ? h(
                      'button',
                      { type: 'button', className: 'dwi-btn small danger', onClick: deleteCurrentFile },
                      tr('deleteFile'),
                    )
                  : null,
                h(
                  'button',
                  { type: 'button', className: 'dwi-btn small', onClick: () => setTemplatesOpen((value) => !value) },
                  tr('templates'),
                ),
                h('button', { type: 'button', className: 'dwi-btn small', onClick: openHistory }, tr('history')),
                h(
                  'span',
                  { className: 'dwi-badge' + (globalInfo?.exists ? '' : ' muted') },
                  globalInfo?.exists ? tr('injectedBadge') : tr('notInjectedBadge'),
                ),
              ),
            ),
            pathRow(tr('globalFile'), globalInfo?.path ?? '~/.dsh/AGENTS.md', 'global-path'),
            previewMode
              ? h(
                  'div',
                  { className: 'dwi-md' },
                  draft.trim().length === 0
                    ? h('p', { className: 'dwi-hint' }, tr('previewEmpty'))
                    : renderMarkdown(draft),
                )
              : h('textarea', {
                  className: 'dwi-editor',
                  value: draft,
                  placeholder: tr('globalPlaceholder'),
                  spellCheck: false,
                  onChange: (event) => {
                    setDraft(event.target.value)
                    setNotice(null)
                  },
                  onKeyDown: onEditorKeyDown,
                }),
            editorFooter(
              `${draft.length} ${tr('chars')} · ${formatBytes(byteLength(draft))} · ${tr('tokenEstimate')} ≈ ${estimateTokens(
                draft,
              )} tokens · 64 KB budget`,
            ),
          ),
          historyCard,
          templatesCard,
          injectionCard(),
          globalInfo?.sharedExists
            ? h(
                'div',
                { className: 'dwi-card' },
                h('h3', { className: 'dwi-card-title' }, tr('sharedTitle')),
                h('p', { className: 'dwi-hint' }, tr('sharedHint')),
                pathRow(tr('globalFile'), globalInfo.sharedPath, 'shared-path'),
              )
            : null,
        )
      } else if (project === null) {
        main = h('section', { className: 'dwi-main' }, h('p', { className: 'dwi-empty' }, tr('loading')))
      } else {
        main = h(
          'section',
          { className: 'dwi-main' },
          engineBanner,
          sessionCard(),
          conflictBanner,
          currentFileExists ? null : h('div', { className: 'dwi-banner warn' }, tr('projectMissingWarn')),
          h(
            'div',
            { className: 'dwi-card' },
            h(
              'div',
              { className: 'dwi-card-head' },
              h(
                'div',
                null,
                h(
                  'h2',
                  { className: 'dwi-card-title' },
                  editingPath === null ? project.title : `${tr('editingFile')} · ${shortPath(editingPath)}`,
                ),
                h('p', { className: 'dwi-hint' }, editingPath === null ? tr('projectHint') : tr('editingHint')),
                h('p', { className: 'dwi-hint' }, project.path),
                h(
                  'p',
                  { className: 'dwi-hint' },
                  project.isGit
                    ? `${tr('root')}: ${project.root}`
                    : `${tr('root')}: ${project.root} · ${tr('gitMissing')}`,
                ),
              ),
              h(
                'div',
                { className: 'dwi-head-actions' },
                editingPath !== null
                  ? h(
                      'button',
                      { type: 'button', className: 'dwi-btn small', onClick: backToPrimary },
                      tr('backToPrimary'),
                    )
                  : null,
                h(
                  'button',
                  { type: 'button', className: 'dwi-btn small', onClick: () => setPreviewMode((value) => !value) },
                  previewMode ? tr('editMode') : tr('preview'),
                ),
                currentFileExists
                  ? h(
                      'button',
                      { type: 'button', className: 'dwi-btn small danger', onClick: deleteCurrentFile },
                      tr('deleteFile'),
                    )
                  : null,
                h(
                  'button',
                  { type: 'button', className: 'dwi-btn small', onClick: () => setTemplatesOpen((value) => !value) },
                  tr('templates'),
                ),
                h('button', { type: 'button', className: 'dwi-btn small', onClick: openHistory }, tr('history')),
                h(
                  'span',
                  { className: 'dwi-badge' + (currentFileExists ? '' : ' muted') },
                  currentFileExists ? tr('injectedBadge') : tr('notInjectedBadge'),
                ),
              ),
            ),
            pathRow(tr('projectFile'), currentFilePath || project.targetPath, 'project-path'),
            previewMode
              ? h(
                  'div',
                  { className: 'dwi-md' },
                  draft.trim().length === 0
                    ? h('p', { className: 'dwi-hint' }, tr('previewEmpty'))
                    : renderMarkdown(draft),
                )
              : h('textarea', {
                  className: 'dwi-editor',
                  value: draft,
                  placeholder: tr('projectPlaceholder'),
                  spellCheck: false,
                  onChange: (event) => {
                    setDraft(event.target.value)
                    setNotice(null)
                  },
                  onKeyDown: onEditorKeyDown,
                }),
            editorFooter(
              `${draft.length} ${tr('chars')} · ${formatBytes(byteLength(draft))} · ${tr('tokenEstimate')} ≈ ${estimateTokens(
                draft,
              )} tokens · 64 KB budget`,
            ),
          ),
          historyCard,
          templatesCard,
          injectionCard(),
          h(
            'div',
            { className: 'dwi-card' },
            h('h3', { className: 'dwi-card-title' }, tr('chain')),
            projectChain.length === 0
              ? h('p', { className: 'dwi-empty' }, tr('emptyChain'))
              : h(
                  'ol',
                  { className: 'dwi-chain' },
                  projectChain.map((entry, index) =>
                    h(
                      'li',
                      {
                        key: `${entry.absolutePath}:${index}`,
                        className:
                          'dwi-chain-row' + (currentFilePath === entry.absolutePath ? ' current' : ''),
                      },
                      h('span', { className: 'dwi-chain-order' }, String(index + 1)),
                      h(
                        'div',
                        { className: 'dwi-chain-body' },
                        h('div', { className: 'dwi-chain-path' }, entry.displayPath),
                        h(
                          'div',
                          { className: 'dwi-chain-meta' },
                          `${
                            entry.scope === 'global'
                              ? tr('scopeGlobal')
                              : entry.scope === 'global-shared'
                                ? tr('scopeShared')
                                : tr('scopeProject')
                          } · ${formatBytes(entry.bytes)}${entry.depth ? ` · ${tr('depth')} ${entry.depth}` : ''}`,
                        ),
                      ),
                      entry.scope === 'project'
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'dwi-btn small',
                              onClick: () => selectChainFile(entry),
                            },
                            tr('edit'),
                          )
                        : null,
                    ),
                  ),
                ),
            h('p', { className: 'dwi-hint' }, tr('chainHint')),
          ),
        )
      }

      return h(
        ErrorBoundary,
        null,
        h(
          'div',
          { className: 'dwi-page' },
        h('style', null, CSS),
        h(
          'header',
          { className: 'dwi-header' },
          h(
            'div',
            { className: 'dwi-header-text' },
            h('h1', { className: 'dwi-title' }, tr('panel')),
            h('p', { className: 'dwi-subtitle' }, tr('intro')),
            h('p', { className: 'dwi-hint' }, tr('engine')),
            h('p', { className: 'dwi-hint' }, tr('budget')),
          ),
          h(
            'div',
            { className: 'dwi-head-actions' },
            h(
              'button',
              { type: 'button', className: 'dwi-btn', onClick: refresh, disabled: status === 'loading' || saving },
              tr('refresh'),
            ),
            h(
              'button',
              { type: 'button', className: 'dwi-btn', onClick: exportAll, disabled: exporting || importing },
              exporting ? tr('loading') : tr('export'),
            ),
            h(
              'button',
              { type: 'button', className: 'dwi-btn', onClick: () => importInputRef.current?.click(), disabled: exporting || importing },
              importing ? tr('loading') : tr('import'),
            ),
            h('input', {
              ref: importInputRef,
              type: 'file',
              accept: 'application/json,.json',
              className: 'dwi-hidden-input',
              onChange: handleImportFile,
            }),
          ),
        ),
          h('div', { className: 'dwi-body' }, nav, main),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * Styles — theme tokens only, no host Client package imports.
     * ------------------------------------------------------------------ */

    const CSS = `
.dwi-page{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit}
.dwi-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 24px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dwi-header-text{min-width:0}
.dwi-title{margin:0 0 6px;font-size:20px;line-height:1.3;font-weight:600}
.dwi-subtitle{margin:0 0 6px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);max-width:820px}
.dwi-hint{margin:2px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dwi-body{display:flex;flex:1;min-height:0;overflow:hidden}
.dwi-nav{flex:0 0 264px;width:264px;box-sizing:border-box;padding:12px;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.dwi-nav-heading{margin:16px 8px 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.dwi-nav-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;box-sizing:border-box;margin:0 0 4px;padding:8px 10px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.dwi-nav-item:hover{background:var(--dsw-alias-bg-layer-2)}
.dwi-nav-item.active{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.dwi-nav-title{font-size:13px;font-weight:600;line-height:1.4;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dwi-nav-path{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dwi-nav-meta{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.dwi-main{flex:1;min-width:0;overflow:auto;padding:18px 24px 48px;display:flex;flex-direction:column;gap:16px}
.dwi-card{box-sizing:border-box;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.dwi-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
.dwi-card-title{margin:0 0 4px;font-size:15px;line-height:1.4;font-weight:600}
.dwi-badge{flex:none;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dwi-badge.muted{color:var(--dsw-alias-state-idle-primary)}
.dwi-path-row{display:flex;align-items:center;gap:8px;min-width:0;margin:6px 0 10px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dwi-path-label{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dwi-path-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.dwi-editor{display:block;width:100%;box-sizing:border-box;min-height:300px;resize:vertical;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.65;outline:none}
.dwi-editor:focus{border-color:var(--dsw-alias-brand-primary)}
.dwi-editor-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;flex-wrap:wrap}
.dwi-editor-meta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dwi-editor-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dwi-dirty{font-size:12px;color:var(--dsw-alias-state-warn-primary)}
.dwi-notice{font-size:12px}
.dwi-notice.ok{color:var(--dsw-alias-state-success-primary)}
.dwi-notice.error{color:var(--dsw-alias-state-error-primary)}
.dwi-btn{appearance:none;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5;cursor:pointer}
.dwi-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.dwi-btn:disabled{opacity:.55;cursor:default}
.dwi-btn.small{padding:3px 8px;font-size:11px}
.dwi-btn.primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#ffffff}
.dwi-empty{margin:8px 0;padding:16px;border:1px dashed var(--dsw-alias-border-l1);border-radius:10px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);text-align:center}
.dwi-error{margin:0 0 10px;font-size:13px;line-height:1.6;color:var(--dsw-alias-state-error-primary);word-break:break-word}
.dwi-chain{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.dwi-chain-row{display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}
.dwi-chain-order{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary)}
.dwi-chain-body{min-width:0}
.dwi-chain-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;word-break:break-all}
.dwi-chain-meta{margin-top:2px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dwi-banner{margin:0;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.dwi-banner.warn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.dwi-preview-block{margin-top:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden}
.dwi-preview-head{padding:6px 10px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.dwi-preview{margin:0;padding:10px;max-height:240px;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.dwi-save-line{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dwi-search{box-sizing:border-box;width:100%;margin:0 0 6px;padding:6px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}
.dwi-search:focus{border-color:var(--dsw-alias-brand-primary)}
.dwi-simple-list{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.dwi-simple-list li{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);word-break:break-all}
.dwi-head-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.dwi-chain-row.current{border-color:var(--dsw-alias-brand-primary)}
.dwi-header-action.warn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.dwi-history-list{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.dwi-history-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}
.dwi-history-main{min-width:0;flex:1}
.dwi-history-meta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dwi-history-preview{margin:4px 0 0;max-height:72px;overflow:hidden;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}
.dwi-conflict{display:flex;flex-direction:column;gap:8px}
.dwi-conflict-actions{display:flex;gap:8px;flex-wrap:wrap}
.dwi-token-line{margin-top:10px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dwi-token-line.warn{color:var(--dsw-alias-state-warn-primary)}
.dwi-template-group{margin-top:12px}
.dwi-template-group-title{margin-bottom:6px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.dwi-template-list{display:flex;flex-direction:column;gap:6px}
.dwi-template-item{display:block;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.55;text-align:left;cursor:pointer}
.dwi-template-item:hover{border-color:var(--dsw-alias-brand-primary)}
.dwi-hidden-input{display:none}
.dwi-settings-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0}
.dwi-settings-text{min-width:0}
.dwi-settings-title{font-size:13px;font-weight:600;line-height:1.4}
.dwi-settings-desc{margin-top:2px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dwi-custom-row{display:flex;align-items:flex-start;gap:8px}
.dwi-custom-row .dwi-template-item{flex:1}
.dwi-template-actions{margin-top:8px}
.dwi-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dwi-btn.danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2)}
.dwi-md{box-sizing:border-box;min-height:300px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);overflow:auto;font-size:13px;line-height:1.7}
.dwi-md-h{margin:12px 0 6px;font-size:14px;font-weight:600;line-height:1.4}
.dwi-md-p{margin:4px 0;white-space:pre-wrap;word-break:break-word}
.dwi-md-list{margin:4px 0 4px 18px;padding:0}
.dwi-md-list li{margin:2px 0}
.dwi-md-code{margin:8px 0;padding:10px;overflow:auto;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap}
.dwi-header-action{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1.5;cursor:pointer}
.dwi-header-action:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dwi-header-action:disabled{opacity:.55;cursor:default}
`

    /* ------------------------------------------------------------------ *
     * Plugin
     * ------------------------------------------------------------------ */

    return {
      inject: ['remote', 'slots'],
      async apply(ctx) {
        CTX = ctx
        if (ctx.remote === undefined || typeof ctx.remote.$mount !== 'function') {
          console.error('[dsh-instructions] ctx.remote.$mount is unavailable in this Client assembly')
          return
        }
        let releaseMount = null
        try {
          releaseMount = await ctx.remote.$mount(FACE)
        } catch (error) {
          console.error('[dsh-instructions] mounting the remote face failed', error)
          return
        }
        if (typeof releaseMount === 'function') {
          ctx.effect(
            () => () => {
              try {
                releaseMount()
              } catch {
                /* ignore */
              }
            },
            'instructions: remote contribution',
          )
        }
        const api = ctx.get('remote.instructions')
        if (api === undefined) {
          console.error('[dsh-instructions] remote.instructions is unavailable after mounting the face')
          return
        }
        API = api

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'instructions' }, InstructionsPage),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'instructions',
              order: 20,
              label: () => tr('panel'),
            },
            PanelIcon,
          ),
        )
        ctx.slots.inject('conversation.session.header.actions', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.actions',
              id: 'instructions',
              order: 2,
              label: () => tr('headerAction'),
            },
            HeaderAction,
          ),
        )
        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'instructions',
              order: 60,
              label: () => tr('panel'),
            },
            SettingsInstructionRow,
          ),
        )
        ctx.slots.inject('conversation.hero.options', () =>
          ctx.slots.register(
            {
              name: 'conversation.hero.options',
              id: 'instructions',
              order: 10,
              label: () => tr('headerAction'),
            },
            HeroInstructionOption,
          ),
        )
      },
    }
  },
})
