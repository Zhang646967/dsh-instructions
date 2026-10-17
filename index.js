/**
 * dsh-instructions — host half.
 *
 * This plugin owns no prompt injection of its own: the shipped
 * `@deepseek-ai/dsh-agent-instructions` preset plugin already injects
 * <workspace instructions> from AGENTS.md files. This host half resolves the
 * effective instruction chain, reads/writes the very files that engine
 * consumes, exposes the two editors to the Web UI, and offers an agent tool
 * plus a human command for the same operations.
 */
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import TYPERT from './typert.host.js'

export const name = 'instructions'
export const inject = []

const BASE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']
const LOCAL_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md']
/** Presets that mount the built-in agent-instructions engine (see dsh-web-app). */
const ENGINE_PRESETS = new Set(['standard', 'ptc', 'cordis'])

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return path.join(os.homedir(), '.dsh')
}

function agentsHome() {
  const fromEnv = process.env.DSH_AGENTS_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return path.join(os.homedir(), '.agents')
}

async function readFileInfo(filePath) {
  try {
    const stat = await fsp.stat(filePath)
    if (!stat.isFile()) {
      return { path: filePath, exists: false, bytes: 0, mtime: 0, content: '' }
    }
    const content = await fsp.readFile(filePath, 'utf8')
    return {
      path: filePath,
      exists: true,
      bytes: Buffer.byteLength(content, 'utf8'),
      mtime: stat.mtimeMs,
      content,
    }
  } catch {
    return { path: filePath, exists: false, bytes: 0, mtime: 0, content: '' }
  }
}

async function probeFile(filePath) {
  try {
    const stat = await fsp.stat(filePath)
    if (!stat.isFile()) return { path: filePath, exists: false, bytes: 0, mtime: 0 }
    return { path: filePath, exists: true, bytes: stat.size, mtime: stat.mtimeMs }
  } catch {
    return { path: filePath, exists: false, bytes: 0, mtime: 0 }
  }
}

async function writeFileText(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

/**
 * Write text, or delete the file when the content is blank. Deleting an empty
 * instruction file is what makes the official engine emit "Instructions
 * removed" instead of keeping a pointless empty section.
 */
async function writeOrDeleteFile(filePath, content) {
  if (typeof content !== 'string') throw new Error('content must be a string')
  if (content.trim().length === 0) {
    try {
      await fsp.unlink(filePath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    return
  }
  await writeFileText(filePath, content)
}

async function findProjectRoot(start) {
  let current = path.resolve(start)
  for (;;) {
    try {
      await fsp.stat(path.join(current, '.git'))
      return current
    } catch {
      /* keep climbing */
    }
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(start)
    current = parent
  }
}

function rootToDirectoryChain(root, target) {
  const chain = []
  let current = path.resolve(target)
  const resolvedRoot = path.resolve(root)
  while (current !== resolvedRoot) {
    chain.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  chain.push(resolvedRoot)
  return chain.reverse()
}

function relativeDisplay(base, target) {
  const rel = path.relative(base, target)
  return rel.length > 0 ? rel : path.basename(target)
}

function workspaceList(ctx) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof registry.list !== 'function') return []
  try {
    return registry.list()
  } catch {
    return []
  }
}

function messageText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('')
}

export function apply(ctx) {
  const home = dshHome()
  const sharedHome = agentsHome()
  const globalPath = path.join(home, 'AGENTS.md')
  const sharedGlobalPath = path.join(sharedHome, 'AGENTS.md')

  const getSession = (sessionId) => {
    try {
      const sessions = ctx.get('sessions')
      if (sessions === undefined || typeof sessions.get !== 'function') return undefined
      return sessions.get(String(sessionId))
    } catch {
      return undefined
    }
  }

  const resolveWorkspace = (workspaceId) => {
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) return undefined
    return workspaceList(ctx).find((workspace) => String(workspace.id) === workspaceId)
  }

  const findWorkspaceForSession = (sessionId) => {
    const wanted = String(sessionId)
    for (const workspace of workspaceList(ctx)) {
      if (!Array.isArray(workspace.sessionIds)) continue
      if (workspace.sessionIds.some((id) => String(id) === wanted)) return String(workspace.id)
    }
    return null
  }

  const resolveAgentProject = (agentId) => {
    const sessionId = String(agentId ?? '')
    const workspace = workspaceList(ctx).find(
      (item) => Array.isArray(item.sessionIds) && item.sessionIds.some((id) => String(id) === sessionId),
    )
    const session = getSession(sessionId)
    const projectPath =
      workspace !== undefined
        ? workspace.path
        : typeof session?.header?.cwd === 'string'
          ? session.header.cwd
          : undefined
    if (typeof projectPath !== 'string' || projectPath.length === 0) {
      throw new Error('Cannot resolve the workspace of this session.')
    }
    return {
      workspaceId: workspace === undefined ? null : String(workspace.id),
      workspace,
      projectPath: path.resolve(projectPath),
      title: workspace?.title || path.basename(projectPath),
    }
  }

  const preferredProjectFile = async (workspacePath) => {
    const agents = path.join(workspacePath, 'AGENTS.md')
    const claude = path.join(workspacePath, 'CLAUDE.md')
    const [agentsInfo, claudeInfo] = await Promise.all([probeFile(agents), probeFile(claude)])
    if (agentsInfo.exists) return agents
    if (claudeInfo.exists) return claude
    return agents
  }

  const buildProjectState = async (workspace, options = {}) => {
    const workspacePath = path.resolve(workspace.path)
    const root = await findProjectRoot(workspacePath)
    const chain = []
    let depth = 0

    const globalEntry = await probeFile(globalPath)
    chain.push({
      scope: 'global',
      depth,
      label: '全局',
      displayPath: '~/.dsh/AGENTS.md',
      absolutePath: globalPath,
      ...globalEntry,
    })

    const sharedEntry = await probeFile(sharedGlobalPath)
    if (sharedEntry.exists) {
      chain.push({
        scope: 'global-shared',
        depth,
        label: '共享全局',
        displayPath: '~/.agents/AGENTS.md',
        absolutePath: sharedGlobalPath,
        ...sharedEntry,
      })
    }

    for (const dir of rootToDirectoryChain(root, workspacePath)) {
      depth += 1
      for (const candidate of [...BASE_CANDIDATES, ...LOCAL_CANDIDATES]) {
        const candidatePath = path.join(dir, candidate)
        const info = await probeFile(candidatePath)
        if (!info.exists) continue
        chain.push({
          scope: 'project',
          depth,
          label: relativeDisplay(workspacePath, dir),
          displayPath: relativeDisplay(root, candidatePath),
          absolutePath: candidatePath,
          ...info,
        })
      }
    }

    const targetPath = await preferredProjectFile(workspacePath)
    const targetInfo = await probeFile(targetPath)
    const summary = {
      id: String(workspace.id),
      title: workspace.title || path.basename(workspacePath),
      path: workspacePath,
      root,
      isGit: root !== workspacePath,
      targetPath,
      targetName: path.basename(targetPath),
      targetExists: targetInfo.exists,
      bytes: targetInfo.bytes,
      mtime: targetInfo.mtime,
    }
    if (options.full !== true) return summary

    const targetFull = await readFileInfo(targetPath)
    return {
      ...summary,
      content: targetFull.exists ? targetFull.content : '',
      chain,
      evidence: {
        baseCandidates: BASE_CANDIDATES,
        localCandidates: LOCAL_CANDIDATES,
      },
    }
  }

  const globalState = async () => {
    const info = await readFileInfo(globalPath)
    const shared = await readFileInfo(sharedGlobalPath)
    return {
      path: globalPath,
      displayPath: '~/.dsh/AGENTS.md',
      exists: info.exists,
      bytes: info.bytes,
      mtime: info.mtime,
      content: info.content,
      sharedPath: sharedGlobalPath,
      sharedExists: shared.exists,
      sharedBytes: shared.bytes,
      sharedMtime: shared.mtime,
    }
  }

  const getState = async () => {
    const projects = []
    for (const workspace of workspaceList(ctx)) {
      try {
        projects.push(await buildProjectState(workspace))
      } catch (error) {
        projects.push({
          id: String(workspace.id),
          title: workspace.title || path.basename(workspace.path),
          path: workspace.path,
          root: workspace.path,
          isGit: false,
          targetPath: path.join(workspace.path, 'AGENTS.md'),
          targetName: 'AGENTS.md',
          targetExists: false,
          bytes: 0,
          mtime: 0,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return {
      global: await globalState(),
      projects,
      budgetBytes: 65536,
      engine: '@deepseek-ai/dsh-agent-instructions',
      home,
      sharedHome,
    }
  }

  const readProject = async (workspaceId) => {
    const workspace = resolveWorkspace(workspaceId)
    if (workspace === undefined) throw new Error(`Unknown workspace: ${String(workspaceId)}`)
    return buildProjectState(workspace, { full: true })
  }

  const saveGlobal = async (content) => {
    await writeOrDeleteFile(globalPath, content)
    return globalState()
  }

  const saveProject = async (workspaceId, content) => {
    const workspace = resolveWorkspace(workspaceId)
    if (workspace === undefined) throw new Error(`Unknown workspace: ${String(workspaceId)}`)
    const state = await buildProjectState(workspace)
    await writeOrDeleteFile(state.targetPath, content)
    return buildProjectState(workspace, { full: true })
  }

  /**
   * A chain file is any existing-or-creatable instruction candidate inside the
   * project-root → workspace directory chain. Resolve it here so the client can
   * never write an arbitrary path.
   */
  const assertChainFile = async (workspacePath, filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('filePath must be a non-empty string')
    }
    const target = path.resolve(filePath)
    const root = await findProjectRoot(workspacePath)
    const directories = rootToDirectoryChain(root, workspacePath).map((dir) => path.resolve(dir))
    if (!directories.includes(path.dirname(target))) {
      throw new Error(`Not inside the instruction chain: ${target}`)
    }
    if (![...BASE_CANDIDATES, ...LOCAL_CANDIDATES].includes(path.basename(target))) {
      throw new Error(`Not an instruction file name: ${path.basename(target)}`)
    }
    return target
  }

  const readInstructionFile = async (workspaceId, filePath) => {
    const workspace = resolveWorkspace(workspaceId)
    if (workspace === undefined) throw new Error(`Unknown workspace: ${String(workspaceId)}`)
    const target = await assertChainFile(workspace.path, filePath)
    const info = await readFileInfo(target)
    return {
      workspaceId: String(workspace.id),
      filePath: target,
      exists: info.exists,
      bytes: info.bytes,
      mtime: info.mtime,
      content: info.content,
    }
  }

  const saveInstructionFile = async (workspaceId, filePath, content) => {
    const workspace = resolveWorkspace(workspaceId)
    if (workspace === undefined) throw new Error(`Unknown workspace: ${String(workspaceId)}`)
    const target = await assertChainFile(workspace.path, filePath)
    await writeOrDeleteFile(target, content)
    const info = await readFileInfo(target)
    return {
      file: {
        workspaceId: String(workspace.id),
        filePath: target,
        exists: info.exists,
        bytes: info.bytes,
        mtime: info.mtime,
        content: info.content,
      },
      project: await buildProjectState(workspace, { full: true }),
    }
  }

  /**
   * Fold the durable `agent-instructions` messages of one live session into the
   * currently injected instruction files. Best effort: a cold session simply
   * reports found:false.
   */
  const collectSessionInjection = (session) => {
    const files = new Map()
    let messages = 0
    let totalBytes = 0
    let baseline = false
    let lastAt = 0
    try {
      const nodes = Array.isArray(session?.surface?.nodes) ? session.surface.nodes : []
      for (const seq of nodes) {
        const event = typeof session.eventAt === 'function' ? session.eventAt(seq) : undefined
        if (event === undefined || event.type !== 'user/message') continue
        const source = event.data?.source
        if (source === null || typeof source !== 'object' || source.kind !== 'agent-instructions') continue
        messages += 1
        if (source.baseline === true) baseline = true
        totalBytes += Buffer.byteLength(messageText(event.data?.content), 'utf8')
        lastAt = Math.max(lastAt, Number(event.time) || 0)
        const changes = Array.isArray(source.changes) ? source.changes : []
        for (const change of changes) {
          if (change === null || typeof change !== 'object' || typeof change.scope !== 'string') continue
          if (change.action === 'remove') files.delete(change.scope)
          else {
            files.set(change.scope, {
              scope: change.scope,
              path: typeof change.path === 'string' ? change.path : '',
            })
          }
        }
      }
    } catch {
      /* best effort */
    }
    return { files: [...files.values()], messages, totalBytes, baseline, lastAt }
  }

  const getSessionStatus = (sessionId) => {
    const id = String(sessionId ?? '')
    const session = getSession(id)
    const workspaceId = findWorkspaceForSession(id)
    if (session === undefined) {
      return {
        found: false,
        sessionId: id,
        preset: null,
        engineActive: null,
        presetHeuristic: true,
        workspaceId,
        files: [],
        messages: 0,
        totalBytes: 0,
        baseline: false,
        lastAt: 0,
      }
    }
    const preset = typeof session.header?.agentPreset === 'string' ? session.header.agentPreset : 'standard'
    const injection = collectSessionInjection(session)
    return {
      found: true,
      sessionId: id,
      preset,
      engineActive: preset === 'minimal' ? false : true,
      presetHeuristic: !ENGINE_PRESETS.has(preset),
      workspaceId,
      ...injection,
    }
  }

  const api = {
    getState,
    readProject,
    saveGlobal,
    saveProject,
    findWorkspaceForSession,
    readFile: readInstructionFile,
    saveFile: saveInstructionFile,
    getSessionStatus,
  }

  // Typert gateway binding: a plain ctx.provide() value is invisible to the
  // gateway until it carries the `typertRemote` binding (same hand-written
  // pattern as the installed dsh-cost-meter plugin). Without it every call
  // fails with: Service "instructions" has no visible typertRemote binding.
  Object.defineProperty(api, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service: api, serviceKey: 'instructions', namespace: 'instructions' },
  })

  // The Typert face (./typert) routes remote.<namespace> calls to this service.
  ctx.provide('instructions', api)

  // -------------------------------------------------------------------------
  // Agent tool: read/edit the workspace instruction chain from conversation.
  // Global instructions stay user-only (the UI); the tool may read them.
  // -------------------------------------------------------------------------
  const toolExecute = async (args, exec) => {
    const input = args !== null && typeof args === 'object' ? args : {}
    const action = typeof input.action === 'string' ? input.action : 'list'
    const scope = input.scope === 'global' ? 'global' : 'project'
    const project = resolveAgentProject(exec?.agent?.id)
    if (scope === 'global') {
      if (action === 'list' || action === 'get') {
        const info = await readFileInfo(globalPath)
        return {
          scope: 'global',
          path: globalPath,
          exists: info.exists,
          bytes: info.bytes,
          content: info.content,
          note: 'Global instructions are user-managed. Read them here; edit them in the Instruction panel.',
        }
      }
      throw new Error('Global instructions are user-only. Use the Instruction panel to edit them.')
    }
    const pseudoWorkspace = {
      id: project.workspaceId ?? 'session',
      title: project.title,
      path: project.projectPath,
    }
    if (action === 'list') {
      const state = await buildProjectState(pseudoWorkspace, { full: true })
      const status = getSessionStatus(exec?.agent?.id)
      return {
        workspace: state.path,
        projectRoot: state.root,
        targetPath: state.targetPath,
        preset: status.preset,
        engineActive: status.engineActive,
        chain: state.chain.map((entry) => ({
          scope: entry.scope,
          path: entry.displayPath,
          bytes: entry.bytes,
        })),
      }
    }
    const primaryPath = await preferredProjectFile(project.projectPath)
    const requested =
      typeof input.file_path === 'string' && input.file_path.length > 0 ? input.file_path : primaryPath
    const target = await assertChainFile(project.projectPath, requested)
    if (action === 'get') {
      const info = await readFileInfo(target)
      return { path: target, exists: info.exists, bytes: info.bytes, content: info.content }
    }
    if (action === 'set' || action === 'append' || action === 'remove') {
      let next
      if (action === 'remove') {
        next = ''
      } else {
        if (typeof input.content !== 'string') throw new Error('content is required for set/append')
        if (action === 'append') {
          const info = await readFileInfo(target)
          const current = info.exists ? info.content : ''
          const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n'
          next = `${current}${separator}${input.content}`
        } else {
          next = input.content
        }
      }
      await writeOrDeleteFile(target, next)
      const info = await readFileInfo(target)
      return {
        path: target,
        action,
        exists: info.exists,
        bytes: info.bytes,
        note: 'Saved. The built-in engine reads this file before the next model request.',
      }
    }
    throw new Error(`Unknown action: ${String(action)}`)
  }

  const toolDefinition = {
    name: 'instructions',
    description:
      'Read and edit the workspace instruction chain (AGENTS.md files) that the built-in desktop injection engine loads. Use it to list the effective instruction files, read one file, or add/replace/remove project instruction text. Global instructions are user-managed: this tool can read them but only the user edits them in the Instruction panel.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'set', 'append', 'remove'],
          description: 'list: effective chain; get: read a file; set/append/remove: edit a project instruction file.',
        },
        scope: {
          type: 'string',
          enum: ['project', 'global'],
          description: 'Defaults to project. global is read-only for this tool.',
        },
        file_path: {
          type: 'string',
          description:
            'Absolute path of one chain file (AGENTS.md / CLAUDE.md / *.local.md). Defaults to the workspace AGENTS.md.',
        },
        content: { type: 'string', description: 'Instruction text for set/append. Empty content deletes the file.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2).slice(0, 16000) },
      ],
    },
    execute: toolExecute,
    isConcurrencySafe: () => false,
  }

  // -------------------------------------------------------------------------
  // Human command: /instruction [show|global|project]
  // -------------------------------------------------------------------------
  const commandHandler = async (invocation) => {
    try {
      const project = resolveAgentProject(invocation.agent?.id)
      const state = await buildProjectState(
        {
          id: project.workspaceId ?? 'session',
          title: project.title,
          path: project.projectPath,
        },
        { full: true },
      )
      const status = getSessionStatus(invocation.agent?.id)
      const mode = String(invocation.rawInput ?? '').trim().toLowerCase() || 'show'
      if (mode === 'global') {
        const info = await readFileInfo(globalPath)
        return {
          kind: 'success',
          text: `全局指令: ${globalPath}\n${info.exists ? `(${info.bytes} bytes)\n\n${info.content}` : '(尚未创建)'}`,
        }
      }
      if (mode === 'project') {
        const info = await readFileInfo(state.targetPath)
        return {
          kind: 'success',
          text: `项目指令: ${state.targetPath}\n${info.exists ? `(${info.bytes} bytes)\n\n${info.content}` : '(尚未创建)'}`,
        }
      }
      const lines = [
        `Instruction · 当前会话注入状态`,
        `预设: ${status.preset ?? '未知'} · 引擎: ${status.engineActive === false ? '未启用' : '已启用'}`,
        `项目: ${state.path}`,
        status.found
          ? `已注入: ${status.files.length} 个文件 · ${status.totalBytes} bytes · ${status.messages} 条注入消息`
          : '已注入: 会话状态不可读（冷会话或未开始）',
        '',
        '生效链（越靠下优先级越高）:',
        ...state.chain.map((entry, index) => `${index + 1}. [${entry.scope}] ${entry.displayPath} (${entry.bytes} B)`),
        '',
        '编辑: 在左侧栏 Instruction 面板中修改全局/项目指令。',
      ]
      return { kind: 'success', text: lines.join('\n') }
    } catch (error) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
  }

  const commandDefinition = {
    name: 'instruction',
    description: 'Show the effective instruction chain (global → project → workspace) and this session injection status.',
    handler: commandHandler,
  }

  ctx.inject(['tools', 'commands'], (toolCtx) => {
    toolCtx.effect(() => toolCtx.tools.register(toolDefinition), 'instructions: agent tool')
    toolCtx.effect(() => toolCtx.commands.register(commandDefinition), 'instructions: /instruction command')
  })

  // Fallback for a Loader entry installed through a file: specifier, where the
  // typert-loader cannot discover the package from the entry name.
  const entryName = ctx.fiber?.entry?.options?.name
  if (typeof entryName === 'string' && entryName.startsWith('file:')) {
    ctx.inject(['typert'], (typertCtx) => {
      if (typertCtx.typert.getPackage('dsh-instructions', 'host') !== undefined) return
      typertCtx.effect(() => typertCtx.typert.register(TYPERT), 'instructions: typert registration')
    })
  }
}
