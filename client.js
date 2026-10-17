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
        descriptor('saveGlobal', ['content']),
        descriptor('saveProject', ['workspaceId', 'content']),
        descriptor('findWorkspaceForSession', ['sessionId']),
        descriptor('readFile', ['workspaceId', 'filePath']),
        descriptor('saveFile', ['workspaceId', 'filePath', 'content']),
        descriptor('getSessionStatus', ['sessionId']),
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
     * Settings page: global + per-workspace AGENTS.md editors with the
     * effective chain preview.
     * ------------------------------------------------------------------ */

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
      const [saving, setSaving] = useState(false)
      const [notice, setNotice] = useState(null)
      const [lastSavedAt, setLastSavedAt] = useState(0)
      const [search, setSearch] = useState('')
      const [sessionId, setSessionId] = useState(null)
      const [sessionStatus, setSessionStatus] = useState(null)
      const saveRef = React.useRef(null)
      const dirty = draft !== original

      const fetchSessionStatus = useCallback(async (id) => {
        if (!API || id === null || id === undefined) return
        try {
          const value = await unwrap(API.getSessionStatus(String(id)))
          setSessionStatus(value)
        } catch (error) {
          console.warn('[dsh-instructions] cannot read the session injection status', error)
        }
      }, [])

      const applyGlobal = useCallback((next) => {
        setState(next)
        setActive({ kind: 'global' })
        setProject(null)
        setEditingPath(null)
        const content = next?.global?.content ?? ''
        setDraft(content)
        setOriginal(content)
      }, [])

      const loadProject = useCallback(async (workspaceId) => {
        const full = await unwrap(API.readProject(workspaceId))
        setActive({ kind: 'project', id: workspaceId })
        setProject(full)
        setEditingPath(null)
        setDraft(full?.content ?? '')
        setOriginal(full?.content ?? '')
        setNotice(null)
      }, [])

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
        async (mode) => {
          if (!API || saving || !dirty) return false
          setSaving(true)
          setNotice(null)
          try {
            if (active.kind === 'project' && typeof active.id === 'string') {
              if (editingPath !== null) {
                const result = await unwrap(API.saveFile(active.id, editingPath, draft))
                if (draft.trim().length > 0 && result?.file?.exists !== true) {
                  throw new Error(`${tr('saveNotWritten')}: ${editingPath}`)
                }
                const full = result?.project
                setProject(full)
                setState((previous) =>
                  previous === null
                    ? previous
                    : {
                        ...previous,
                        projects: previous.projects.map((item) =>
                          item.id === active.id
                            ? {
                                ...item,
                                targetExists: full?.targetExists,
                                bytes: full?.bytes,
                                mtime: full?.mtime,
                              }
                            : item,
                        ),
                      },
                )
                setDraft(result?.file?.content ?? '')
                setOriginal(result?.file?.content ?? '')
                if (result?.file?.exists !== true && editingPath !== full?.targetPath) {
                  setEditingPath(null)
                  setDraft(full?.content ?? '')
                  setOriginal(full?.content ?? '')
                }
              } else {
                const full = await unwrap(API.saveProject(active.id, draft))
                if (draft.trim().length > 0 && full?.targetExists !== true) {
                  throw new Error(`${tr('saveNotWritten')}: ${full?.targetPath ?? active.id}`)
                }
                setProject(full)
                setDraft(full?.content ?? draft)
                setOriginal(full?.content ?? draft)
                setState((previous) =>
                  previous === null
                    ? previous
                    : {
                        ...previous,
                        projects: previous.projects.map((item) =>
                          item.id === active.id
                            ? {
                                ...item,
                                targetExists: full.targetExists,
                                bytes: full.bytes,
                                mtime: full.mtime,
                              }
                            : item,
                        ),
                      },
                )
              }
            } else {
              const global = await unwrap(API.saveGlobal(draft))
              if (draft.trim().length > 0 && global?.exists !== true) {
                throw new Error(`${tr('saveNotWritten')}: ${global?.path ?? '~/.dsh/AGENTS.md'}`)
              }
              setOriginal(draft)
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
        [active, draft, dirty, editingPath, saving, sessionId, fetchSessionStatus],
      )
      saveRef.current = save

      // Auto-save: 800ms after the last edit, write straight into the file the
      // official engine reads, so a forgotten Save click cannot lose content.
      useEffect(() => {
        if (!dirty || saving || status !== 'ready') return undefined
        const timer = setTimeout(() => {
          const current = saveRef.current
          if (typeof current === 'function') current('auto')
        }, 800)
        return () => clearTimeout(timer)
      }, [draft, dirty, saving, status, active.kind, active.id, editingPath])

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
            {
              type: 'button',
              className: 'dwi-btn small',
              onClick: () => copyText(filePath),
            },
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

      const previewBlock = (label, filePath, content, key) => {
        const text = String(content ?? '')
        if (text.trim().length === 0) return null
        return h(
          'div',
          { className: 'dwi-preview-block', key },
          h('div', { className: 'dwi-preview-head' }, `${label} · ${filePath}`),
          h('pre', { className: 'dwi-preview' }, text),
        )
      }

      const injectionCard = (options) => {
        const blocks = []
        const globalBlock = previewBlock(
          tr('previewLabelGlobal'),
          '~/.dsh/AGENTS.md',
          options.globalText,
          'preview-global',
        )
        if (globalBlock !== null) blocks.push(globalBlock)
        const projectBlock = previewBlock(
          tr('previewLabelProject'),
          options.projectPath ?? '',
          options.projectText,
          'preview-project',
        )
        if (projectBlock !== null) blocks.push(projectBlock)
        const others = Array.isArray(options.others) ? options.others : []
        const copySource = [
          String(options.globalText ?? '').trim().length > 0
            ? `${tr('previewLabelGlobal')}\n${options.globalText}`
            : '',
          String(options.projectText ?? '').trim().length > 0
            ? `${tr('previewLabelProject')} (${options.projectPath ?? ''})\n${options.projectText}`
            : '',
        ]
          .filter((part) => part.length > 0)
          .join('\n\n')
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
          blocks.length > 0 ? blocks : h('p', { className: 'dwi-empty' }, tr('injectionEmpty')),
          others.length > 0
            ? h(
                'p',
                { className: 'dwi-hint' },
                `${tr('previewOtherLabel')}: ${others.map((entry) => entry.displayPath).join(' · ')}`,
              )
            : null,
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
                'span',
                { className: 'dwi-badge' + (globalInfo?.exists ? '' : ' muted') },
                globalInfo?.exists ? tr('injectedBadge') : tr('notInjectedBadge'),
              ),
            ),
            pathRow(tr('globalFile'), globalInfo?.path ?? '~/.dsh/AGENTS.md', 'global-path'),
            h('textarea', {
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
              `${draft.length} ${tr('chars')} · ${formatBytes(byteLength(draft))} · 64 KB budget`,
            ),
          ),
          injectionCard({ globalText: draft }),
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
        const others = projectChain.filter(
          (entry) => entry.scope === 'project' && entry.absolutePath !== currentFilePath,
        )
        main = h(
          'section',
          { className: 'dwi-main' },
          engineBanner,
          sessionCard(),
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
                h(
                  'p',
                  { className: 'dwi-hint' },
                  editingPath === null ? tr('projectHint') : tr('editingHint'),
                ),
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
                  'span',
                  { className: 'dwi-badge' + (currentFileExists ? '' : ' muted') },
                  currentFileExists ? tr('injectedBadge') : tr('notInjectedBadge'),
                ),
              ),
            ),
            pathRow(tr('projectFile'), currentFilePath || project.targetPath, 'project-path'),
            h('textarea', {
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
              `${draft.length} ${tr('chars')} · ${formatBytes(byteLength(draft))} · 64 KB budget`,
            ),
          ),
          injectionCard({
            globalText: globalSavedContent,
            projectPath: currentFilePath || project.targetPath,
            projectText: draft,
            others,
          }),
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
            'button',
            { type: 'button', className: 'dwi-btn', onClick: refresh, disabled: status === 'loading' || saving },
            tr('refresh'),
          ),
        ),
        h('div', { className: 'dwi-body' }, nav, main),
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
      },
    }
  },
})
