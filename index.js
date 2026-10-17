/**
 * dsh-instructions — host half.
 *
 * The plugin owns no prompt injection of its own: the shipped
 * `@deepseek-ai/dsh-agent-instructions` preset plugin injects AGENTS.md as
 * durable context. This host half resolves the effective chain, edits the
 * files that engine consumes (with history + stale-write protection), exposes
 * the editors to the Web UI, and offers an agent tool plus a human command.
 */
import { promises as fsp, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import TYPERT from './typert.host.js'

export const name = 'instructions'
export const inject = []

const BASE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']
const LOCAL_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md']
/** Presets that mount the built-in agent-instructions engine (see dsh-web-app). */
const ENGINE_PRESETS = new Set(['standard', 'ptc', 'cordis'])
const HISTORY_LIMIT = 20
const EXTRA_GLOBAL_FILE = 'extra-global.md'
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

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

function hashContent(content) {
  return createHash('sha1').update(content, 'utf8').digest('hex')
}

async function readFileInfo(filePath) {
  try {
    const stat = await fsp.stat(filePath)
    if (!stat.isFile()) {
      return { path: filePath, exists: false, bytes: 0, mtime: 0, hash: '', content: '' }
    }
    const content = await fsp.readFile(filePath, 'utf8')
    return {
      path: filePath,
      exists: true,
      bytes: Buffer.byteLength(content, 'utf8'),
      mtime: stat.mtimeMs,
      hash: hashContent(content),
      content,
    }
  } catch {
    return { path: filePath, exists: false, bytes: 0, mtime: 0, hash: '', content: '' }
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

/** Atomic write: a temp sibling then rename, so a crash cannot truncate the file. */
async function writeFileAtomic(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const temp = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
  try {
    await fsp.writeFile(temp, content, 'utf8')
    await fsp.rename(temp, filePath)
  } catch (error) {
    try {
      await fsp.unlink(temp)
    } catch {
      /* ignore */
    }
    throw error
  }
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
  await writeFileAtomic(filePath, content)
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

function insidePath(root, target) {
  if (typeof root !== 'string' || root.length === 0) return false
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
}


/**
 * Small line-oriented diff used by the agent tool's dry-run `validate` action.
 * LCS over lines when the inputs are small; otherwise a bounded summary.
 */
function simpleLineDiff(before, after) {
  const a = String(before ?? '').split('\n')
  const b = String(after ?? '').split('\n')
  if (a.length > 1200 || b.length > 1200) {
    return `(files too large for inline diff: ${a.length} -> ${b.length} lines)`
  }
  const rows = a.length + 1
  const cols = b.length + 1
  const table = Array.from({ length: rows }, () => new Uint16Array(cols))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const lines = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`)
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push(`- ${a[i]}`)
      i += 1
    } else {
      lines.push(`+ ${b[j]}`)
      j += 1
    }
  }
  while (i < a.length) {
    lines.push(`- ${a[i]}`)
    i += 1
  }
  while (j < b.length) {
    lines.push(`+ ${b[j]}`)
    j += 1
  }
  const text = lines.join('\n')
  return text.length > 20000 ? `${text.slice(0, 20000)}\n… (diff truncated)` : text
}

export function apply(ctx) {
  const home = dshHome()
  const sharedHome = agentsHome()
  const globalPath = path.join(home, 'AGENTS.md')
  const sharedGlobalPath = path.join(sharedHome, 'AGENTS.md')
  const historyRoot = path.join(home, 'storages', 'dsh-instructions', 'history')
  const sessionRoot = path.join(home, 'storages', 'dsh-instructions', 'sessions')
  const extraGlobalPath = path.join(home, 'instructions', EXTRA_GLOBAL_FILE)
  const sessionCache = new Map()
  const sessionDisposers = new Map()
  let extraGlobalCache = { mtime: 0, size: 0, text: '' }

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
      targetHash: targetFull.hash,
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
      hash: info.hash,
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
      historyLimit: HISTORY_LIMIT,
      extraGlobalPath,
      features: ['history', 'extraGlobal', 'sessionInstruction', 'validate'],
    }
  }

  // -------------------------------------------------------------------------
  // History snapshots: every accepted save archives the previous content.
  // -------------------------------------------------------------------------
  const historyDirFor = (target) => path.join(historyRoot, hashContent(target).slice(0, 16))

  const archiveHistory = async (target, content) => {
    if (typeof content !== 'string' || content.length === 0) return
    const dir = historyDirFor(target)
    await fsp.mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await fsp.writeFile(path.join(dir, `${stamp}.md`), content, 'utf8')
    let names = []
    try {
      names = await fsp.readdir(dir)
    } catch {
      return
    }
    const snapshots = names.filter((name) => name.endsWith('.md')).sort().reverse()
    for (const stale of snapshots.slice(HISTORY_LIMIT)) {
      await fsp.unlink(path.join(dir, stale)).catch(() => {})
    }
  }

  const listHistoryFor = async (target) => {
    const dir = historyDirFor(target)
    let names = []
    try {
      names = await fsp.readdir(dir)
    } catch {
      return []
    }
    const entries = []
    for (const name of names.filter((item) => item.endsWith('.md')).sort().reverse().slice(0, HISTORY_LIMIT)) {
      const filePath = path.join(dir, name)
      try {
        const stat = await fsp.stat(filePath)
        const content = await fsp.readFile(filePath, 'utf8')
        entries.push({
          id: name,
          savedAt: stat.mtimeMs,
          bytes: Buffer.byteLength(content, 'utf8'),
          preview: content.slice(0, 240),
          content,
        })
      } catch {
        /* ignore one unreadable snapshot */
      }
    }
    return entries
  }

  const readHistorySnapshot = async (target, snapshotId) => {
    if (typeof snapshotId !== 'string' || !/^[0-9A-Za-z-]+\.md$/.test(snapshotId)) {
      throw new Error('invalid history snapshot id')
    }
    const snapshotPath = path.join(historyDirFor(target), snapshotId)
    return fsp.readFile(snapshotPath, 'utf8')
  }

  const restoreHistorySnapshot = async (workspaceId, filePath, snapshotId) => {
    const target = await resolveTarget(workspaceId, filePath)
    const content = await readHistorySnapshot(target, snapshotId)
    const current = await readFileInfo(target)
    if (current.exists) await archiveHistory(target, current.content)
    await writeOrDeleteFile(target, content)
    const info = await readFileInfo(target)
    return {
      target,
      file: info,
      entries: await listHistoryFor(target),
    }
  }

  // -------------------------------------------------------------------------
  // Stale-write protection
  // -------------------------------------------------------------------------
  const checkBase = async (target, baseHash) => {
    if (typeof baseHash !== 'string' || baseHash.length === 0) return null
    const current = await readFileInfo(target)
    if (current.exists !== true || current.hash !== baseHash) {
      return {
        stale: true,
        current: {
          exists: current.exists,
          bytes: current.bytes,
          mtime: current.mtime,
          hash: current.hash,
          content: current.content,
        },
      }
    }
    return null
  }

  const resolveTarget = async (workspaceId, filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0) return globalPath
    const workspace = resolveWorkspace(workspaceId)
    if (workspace === undefined) throw new Error(`Unknown workspace: ${String(workspaceId)}`)
    return assertChainFile(workspace.path, filePath)
  }

  const saveGlobal = async (content, baseHash) => {
    const stale = await checkBase(globalPath, baseHash)
    if (stale !== null) return stale
    const current = await readFileInfo(globalPath)
    if (current.exists) await archiveHistory(globalPath, current.content)
    await writeOrDeleteFile(globalPath, content)
    return { stale: false, global: await globalState() }
  }

  const saveProject = async (workspaceId, content, baseHash) => {
    const workspace = resolveWorkspace(workspaceId)
    if (workspace === undefined) throw new Error(`Unknown workspace: ${String(workspaceId)}`)
    const state = await buildProjectState(workspace)
    const stale = await checkBase(state.targetPath, baseHash)
    if (stale !== null) return stale
    const current = await readFileInfo(state.targetPath)
    if (current.exists) await archiveHistory(state.targetPath, current.content)
    await writeOrDeleteFile(state.targetPath, content)
    return { stale: false, project: await buildProjectState(workspace, { full: true }) }
  }

  const saveInstructionFile = async (workspaceId, filePath, content, baseHash) => {
    const workspace = resolveWorkspace(workspaceId)
    if (workspace === undefined) throw new Error(`Unknown workspace: ${String(workspaceId)}`)
    const target = await assertChainFile(workspace.path, filePath)
    const stale = await checkBase(target, baseHash)
    if (stale !== null) return stale
    const current = await readFileInfo(target)
    if (current.exists) await archiveHistory(target, current.content)
    await writeOrDeleteFile(target, content)
    const info = await readFileInfo(target)
    return {
      stale: false,
      file: {
        workspaceId: String(workspace.id),
        filePath: target,
        exists: info.exists,
        bytes: info.bytes,
        mtime: info.mtime,
        hash: info.hash,
        content: info.content,
      },
      project: await buildProjectState(workspace, { full: true }),
    }
  }

  const readProject = async (workspaceId) => {
    const workspace = resolveWorkspace(workspaceId)
    if (workspace === undefined) throw new Error(`Unknown workspace: ${String(workspaceId)}`)
    return buildProjectState(workspace, { full: true })
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
      hash: info.hash,
      content: info.content,
    }
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

  const listHistory = async (workspaceId, filePath) => {
    const target = await resolveTarget(workspaceId, filePath)
    return { target, entries: await listHistoryFor(target) }
  }

  // -------------------------------------------------------------------------
  // Session injection status
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // F (gradual): self-built system-prompt channels
  //   - extra global sources: $DSH_HOME/instructions/extra-global.md
  //   - session temporary instructions: $DSH_HOME/storages/dsh-instructions/sessions/<id>.md
  // These are user-authored additions on top of the official AGENTS.md engine.
  // -------------------------------------------------------------------------
  const buildExtraGlobalSection = () => {
    try {
      const stat = statSync(extraGlobalPath)
      if (!stat.isFile() || stat.size === 0) {
        extraGlobalCache = { mtime: 0, size: 0, text: '' }
        return ''
      }
      if (extraGlobalCache.mtime === stat.mtimeMs && extraGlobalCache.size === stat.size) {
        return extraGlobalCache.text
      }
      let body = readFileSync(extraGlobalPath, 'utf8')
      if (Buffer.byteLength(body, 'utf8') > 32768) {
        body = `${body.slice(0, 32768)}\n… (truncated by dsh-instructions)`
      }
      const text =
        body.trim().length === 0
          ? ''
          : [
              '以下是你（用户）在 Instruction 中维护的「额外全局前置指令」（system prompt 注入，与官方 AGENTS.md 全局链并存）。',
              '冲突时以更具体或更近期的指令为准；它们不覆盖系统、开发者或直接用户指令。',
              '',
              body,
            ].join('\n')
      extraGlobalCache = { mtime: stat.mtimeMs, size: stat.size, text }
      return text
    } catch {
      extraGlobalCache = { mtime: 0, size: 0, text: '' }
      return ''
    }
  }

  const buildSessionSection = (sessionId) => {
    const raw = sessionCache.get(String(sessionId)) ?? ''
    if (raw.trim().length === 0) return ''
    return [
      '以下是当前会话的临时前置指令（仅本次会话生效，优先级最高；不覆盖系统、开发者或直接用户指令）：',
      '',
      raw,
    ].join('\n')
  }

  const sessionInstructionPath = (sessionId) => {
    const id = String(sessionId ?? '')
    if (!SESSION_ID_RE.test(id)) throw new Error(`invalid session id: ${id}`)
    return path.join(sessionRoot, `${id}.md`)
  }

  const getExtraGlobal = async () => {
    const info = await readFileInfo(extraGlobalPath)
    return {
      path: extraGlobalPath,
      displayPath: '~/.dsh/instructions/extra-global.md',
      exists: info.exists,
      bytes: info.bytes,
      mtime: info.mtime,
      content: info.content,
    }
  }

  const saveExtraGlobal = async (content) => {
    await writeOrDeleteFile(extraGlobalPath, content)
    extraGlobalCache = { mtime: 0, size: 0, text: '' }
    return getExtraGlobal()
  }

  const getSessionInstruction = async (sessionId) => {
    const target = sessionInstructionPath(sessionId)
    const info = await readFileInfo(target)
    sessionCache.set(String(sessionId), info.exists ? info.content : '')
    return {
      sessionId: String(sessionId),
      path: target,
      exists: info.exists,
      bytes: info.bytes,
      content: info.content,
    }
  }

  const saveSessionInstruction = async (sessionId, content) => {
    const target = sessionInstructionPath(sessionId)
    await writeOrDeleteFile(target, content)
    sessionCache.set(String(sessionId), content.trim().length === 0 ? '' : content)
    return getSessionInstruction(sessionId)
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
    listHistory,
    restoreHistory: restoreHistorySnapshot,
    getExtraGlobal,
    saveExtraGlobal,
    getSessionInstruction,
    saveSessionInstruction,
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

  ctx.provide('instructions', api)

  // -------------------------------------------------------------------------
  // F (gradual): our own system-prompt channels, alongside the official
  // message-based AGENTS.md engine.
  //   1. extra global sources -> one host-level system-prompt section
  //   2. session temporary instructions -> one section registered per Agent,
  //      so it disappears when that Agent is disposed.
  // -------------------------------------------------------------------------
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(
      () =>
        promptCtx.systemPrompt.section({
          name: 'instructions:extra-global',
          order: 500,
          interpolate: false,
          text: () => buildExtraGlobalSection(),
        }),
      'instructions: extra global system-prompt section',
    )

    const registerSessionSection = (agent) => {
      const sessionId = String(agent?.id ?? agent?.session?.id ?? '')
      if (sessionId.length === 0) return
      const agentCtx = agent?.ctx
      const prompt = agentCtx?.get?.('systemPrompt')
      if (prompt === undefined || typeof prompt.section !== 'function') return
      const dispose = agentCtx.effect(
        () =>
          prompt.section({
            name: 'instructions:session',
            order: 510,
            interpolate: false,
            text: () => buildSessionSection(sessionId),
          }),
        'instructions: session system-prompt section',
      )
      sessionDisposers.set(sessionId, () => {
        try {
          dispose()
        } catch {
          /* ignore */
        }
      })
    }

    promptCtx.on('agent/created', async ({ agent }) => {
      const sessionId = String(agent?.id ?? agent?.session?.id ?? '')
      if (sessionId.length === 0) return
      try {
        const info = await readFileInfo(sessionInstructionPath(sessionId))
        sessionCache.set(sessionId, info.exists ? info.content : '')
      } catch {
        sessionCache.set(sessionId, '')
      }
      registerSessionSection(agent)
    })

    promptCtx.on('agent/disposed', ({ agent }) => {
      const sessionId = String(agent?.id ?? agent?.session?.id ?? '')
      if (sessionId.length === 0) return
      sessionCache.delete(sessionId)
      const dispose = sessionDisposers.get(sessionId)
      if (dispose !== undefined) {
        dispose()
        sessionDisposers.delete(sessionId)
      }
    })

    promptCtx.effect(
      () => () => {
        for (const dispose of sessionDisposers.values()) dispose()
        sessionDisposers.clear()
      },
      'instructions: session sections cleanup',
    )
  })


  // -------------------------------------------------------------------------
  // Agent tool: read/edit the workspace instruction chain from conversation.
  // Global instructions stay user-only (the UI); the tool may read them.
  // -------------------------------------------------------------------------
  const sandboxAllowsWrite = (agent, target) => {
    try {
      const policyService = ctx.get('sandboxPolicy')
      if (policyService === undefined || typeof policyService.resolve !== 'function') return null
      const session = getSession(String(agent?.id ?? ''))
      const policy = policyService.resolve(session === undefined ? {} : { session })
      if (policy === null || typeof policy !== 'object') return null
      if (policy.mode === 'read-only') {
        return 'The current session is in read-only sandbox mode; the agent cannot modify instruction files.'
      }
      if (policy.mode === 'workspace-write' && !insidePath(policy.workspaceRoot, target)) {
        return `The target file is outside this session's workspace (${target}); workspace-write mode does not allow writing it.`
      }
      return null
    } catch {
      return null
    }
  }

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
    if (action === 'validate') {
      if (typeof input.content !== 'string') throw new Error('content is required for validate')
      const current = await readFileInfo(target)
      return {
        path: target,
        exists: current.exists,
        bytesBefore: current.bytes,
        bytesAfter: Buffer.byteLength(input.content, 'utf8'),
        changed: current.content !== input.content,
        diff: simpleLineDiff(current.content, input.content),
        note: 'Dry run only; nothing was written.',
      }
    }
    if (action === 'set' || action === 'append' || action === 'remove') {
      const denial = sandboxAllowsWrite(exec?.agent, target)
      if (denial !== null) throw new Error(denial)
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
      const current = await readFileInfo(target)
      if (current.exists) await archiveHistory(target, current.content)
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
      'Read and edit the workspace instruction chain (AGENTS.md files) that the built-in desktop injection engine loads. Use it to list the effective instruction files, read one file, validate a proposed change as a dry-run diff, or add/replace/remove project instruction text. Global instructions are user-managed: this tool can read them but only the user edits them in the Instruction panel. Writes follow the current session sandbox mode.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'validate', 'set', 'append', 'remove'],
          description:
            'list: effective chain; get: read a file; validate: dry-run diff of proposed content; set/append/remove: edit a project instruction file.',
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
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2).slice(0, 16000) }],
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
      const extraGlobalInfo = await readFileInfo(extraGlobalPath)
      let sessionInfo = { exists: false, bytes: 0 }
      try {
        const sessionId = String(invocation.agent?.id ?? '')
        if (SESSION_ID_RE.test(sessionId)) sessionInfo = await readFileInfo(sessionInstructionPath(sessionId))
      } catch {
        /* ignore */
      }
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
        'Instruction · 当前会话注入状态',
        `预设: ${status.preset ?? '未知'} · 引擎: ${
          status.engineActive === false ? '未启用' : status.engineActive === true ? '已启用' : '未知'
        }`,
        `项目: ${state.path}`,
        status.found
          ? `已注入: ${status.files.length} 个文件 · ${status.totalBytes} bytes · ${status.messages} 条注入消息`
          : '已注入: 会话状态不可读（冷会话或未开始）',
        extraGlobalInfo.exists ? `额外全局（system prompt）: ${extraGlobalInfo.bytes} bytes` : '额外全局（system prompt）: 未创建',
        sessionInfo.exists ? `会话临时（system prompt）: ${sessionInfo.bytes} bytes` : '会话临时（system prompt）: 未设置',
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
