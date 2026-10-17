#!/usr/bin/env node
/**
 * Host-half smoke test: runs the plugin's `apply(ctx)` against a fake Cordis
 * context (no DSH process required) and checks file/instruction logic,
 * history snapshots, stale-write protection, the agent tool and the command.
 *
 *   node test/host.test.mjs
 */
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-instructions-test-'))
const home = path.join(root, 'dsh-home')
const agentsHome = path.join(root, 'agents-home')
const workspace = path.join(root, 'workspace')
const repo = path.join(root, 'repo')
const nested = path.join(repo, 'sub')

process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = agentsHome

const cleanup = async () => {
  await fsp.rm(root, { recursive: true, force: true })
}

try {
  await fsp.mkdir(workspace, { recursive: true })
  await fsp.mkdir(path.join(workspace, '.git'), { recursive: true })
  await fsp.mkdir(nested, { recursive: true })
  await fsp.mkdir(path.join(repo, '.git'), { recursive: true })

  const plugin = await import(pathToFileURL(path.join(import.meta.dirname, '..', 'index.js')).href)
  const provided = {}
  const registered = {}
  const deferred = []
  const sandbox = { mode: 'workspace-write', workspaceRoot: workspace }
  const instructionEvents = [
    {
      type: 'user/message',
      seq: 1,
      time: 111,
      data: {
        content: [{ type: 'text', text: '<system-reminder>global+project</system-reminder>' }],
        source: {
          kind: 'agent-instructions',
          baseline: true,
          changes: [
            { action: 'set', scope: 'user-global', path: '~/.dsh/AGENTS.md', digest: 'a' },
            { action: 'set', scope: '.:AGENTS.md', path: 'AGENTS.md', digest: 'b' },
          ],
        },
      },
    },
  ]
  const sessions = new Map([
    [
      's1',
      {
        header: { agentPreset: 'cordis', cwd: workspace },
        surface: { nodes: [1] },
        eventAt: (seq) => instructionEvents.find((event) => event.seq === seq),
      },
    ],
    ['s2', { header: { agentPreset: 'minimal', cwd: workspace }, surface: { nodes: [] }, eventAt: () => undefined }],
  ])
  const toolApi = { register: (definition) => (registered.tool = definition) || (() => {}) }
  const commandApi = { register: (definition) => (registered.command = definition) || (() => {}) }
  const sections = []
  const events = {}
  const fakeSystemPrompt = {
    section: (section) => {
      sections.push(section)
      return () => {
        const index = sections.indexOf(section)
        if (index >= 0) sections.splice(index, 1)
      }
    },
  }
  const fakeAgentCtx = {
    get: (name) => (name === 'systemPrompt' ? fakeSystemPrompt : undefined),
    effect: (callback) => {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
  const baseCtx = {
    get(name) {
      if (name === 'workspaceRegistry') {
        return {
          list: () => [
            { id: 'ws1', title: 'test-workspace', path: workspace, sessionIds: ['s1'] },
            { id: 'ws2', title: 'repo-sub', path: nested, sessionIds: [] },
          ],
        }
      }
      if (name === 'sessions') return { get: (id) => sessions.get(id) }
      if (name === 'tools') return toolApi
      if (name === 'commands') return commandApi
      if (name === 'sandboxPolicy') return { resolve: () => ({ ...sandbox }) }
      if (name === 'systemPrompt') return fakeSystemPrompt
      return undefined
    },
    provide(name, value) {
      provided[name] = value
    },
    inject(names, callback) {
      deferred.push(() =>
        callback({
          ...baseCtx,
          tools: toolApi,
          commands: commandApi,
          systemPrompt: fakeSystemPrompt,
          on: (event, listener) => {
            events[event] = listener
            return () => {}
          },
          effect: (fn) => {
            const dispose = fn()
            return typeof dispose === 'function' ? dispose : () => {}
          },
        }),
      )
    },
    on(event, listener) {
      events[event] = listener
      return () => {}
    },
    fiber: {},
  }
  plugin.apply(baseCtx)
  deferred.forEach((run) => run())
  const api = provided.instructions
  assert.ok(api, 'instructions service is provided')

  // Chain resolution: .git selects the project root.
  const initial = await api.getState()
  assert.equal(initial.global.exists, false)
  assert.equal(initial.global.hash, '')
  assert.equal(initial.projects.length, 2)
  assert.equal(initial.projects[1].root, repo, 'project root discovery climbs to .git')

  // Empty content deletes the file; non-empty writes the official path + hash.
  const deleted = await api.saveGlobal('', '')
  assert.equal(deleted.stale, false)
  assert.equal(deleted.global.exists, false)
  const firstSave = await api.saveGlobal('# global\n\nReply in Chinese.\n', '')
  assert.equal(firstSave.stale, false)
  assert.equal(firstSave.global.exists, true)
  assert.match(firstSave.global.hash, /^[0-9a-f]{40}$/)

  // Stale-write protection: a wrong base hash reports the current content.
  const staleSave = await api.saveGlobal('# overwrite?\n', 'deadbeef')
  assert.equal(staleSave.stale, true)
  assert.equal(staleSave.current.hash, firstSave.global.hash)
  assert.match(staleSave.current.content, /Reply in Chinese/)

  // Correct base hash writes and archives the previous content for history.
  const secondSave = await api.saveGlobal('# global v2\n', firstSave.global.hash)
  assert.equal(secondSave.stale, false)
  const globalHistory = await api.listHistory('', '')
  assert.ok(globalHistory.entries.length >= 1, 'previous global content is snapshotted')
  const restored = await api.restoreHistory('', '', globalHistory.entries[0].id)
  assert.match(restored.file.content, /Reply in Chinese/)

  // Project primary file: save returns {stale, project} and a target hash.
  const projectSave = await api.saveProject('ws1', '# project\n', '')
  assert.equal(projectSave.stale, false)
  assert.equal(projectSave.project.targetExists, true)
  assert.equal(projectSave.project.content, '# project\n')
  assert.match(projectSave.project.targetHash, /^[0-9a-f]{40}$/)
  assert.ok(projectSave.project.chain.some((entry) => entry.scope === 'global' && entry.exists))
  assert.ok(projectSave.project.chain.some((entry) => entry.scope === 'project' && entry.displayPath === 'AGENTS.md'))

  // Chain-file validation rejects paths outside the instruction chain.
  await assert.rejects(() => api.readFile('ws1', '/etc/passwd'), /Not inside the instruction chain/)
  const chainFile = await api.readFile('ws1', projectSave.project.targetPath)
  assert.equal(chainFile.content, '# project\n')
  assert.match(chainFile.hash, /^[0-9a-f]{40}$/)
  const removed = await api.saveFile('ws1', projectSave.project.targetPath, '', '')
  assert.equal(removed.stale, false)
  assert.equal(removed.file.exists, false, 'empty content deletes a chain file')
  assert.equal(removed.project.targetExists, false)

  // Session injection status is folded from agent-instructions messages.
  const status = api.getSessionStatus('s1')
  assert.equal(status.found, true)
  assert.equal(status.preset, 'cordis')
  assert.equal(status.engineActive, true)
  assert.equal(status.files.length, 2)
  assert.ok(status.totalBytes > 0)
  assert.equal(api.getSessionStatus('s2').engineActive, false, 'minimal preset reports the engine off')

  // Agent tool: list / get / set / append / remove; global read-only.
  assert.ok(registered.tool, 'instructions tool registered')
  assert.ok(registered.command, '/instruction command registered')
  const listed = await registered.tool.execute({ action: 'list' }, { agent: { id: 's1' } })
  assert.equal(listed.workspace, workspace)
  await registered.tool.execute({ action: 'set', content: '# from tool\n' }, { agent: { id: 's1' } })
  await registered.tool.execute({ action: 'append', content: '- appended\n' }, { agent: { id: 's1' } })
  const readTool = await registered.tool.execute({ action: 'get' }, { agent: { id: 's1' } })
  assert.match(readTool.content, /from tool/)
  assert.match(readTool.content, /appended/)
  const validateResult = await registered.tool.execute(
    { action: 'validate', content: '# from tool\n- appended\n- extra\n' },
    { agent: { id: 's1' } },
  )
  assert.equal(validateResult.note, 'Dry run only; nothing was written.')
  assert.match(validateResult.diff, /^\+ /m)
  assert.equal((await registered.tool.execute({ action: 'get' }, { agent: { id: 's1' } })).content.includes('- extra'), false)
  await assert.rejects(
    () => registered.tool.execute({ action: 'set', scope: 'global', content: 'x' }, { agent: { id: 's1' } }),
    /user-only/,
  )

  // Sandbox awareness: read-only sessions refuse tool writes.
  sandbox.mode = 'read-only'
  await assert.rejects(
    () => registered.tool.execute({ action: 'set', content: '# nope\n' }, { agent: { id: 's1' } }),
    /read-only sandbox/,
  )
  sandbox.mode = 'workspace-write'
  const removedByTool = await registered.tool.execute({ action: 'remove' }, { agent: { id: 's1' } })
  assert.equal(removedByTool.exists, false)

  // F gradual: self-built system-prompt channels.
  assert.ok(Array.isArray((await api.getState()).features))
  assert.ok((await api.getState()).features.includes('extraGlobal'))
  const extraSection = sections.find((section) => section.name === 'instructions:extra-global')
  assert.ok(extraSection, 'extra-global prompt section registered')
  assert.equal(extraSection.text(), '')
  await api.saveExtraGlobal('# extra global\n\n- be concise\n')
  assert.match(extraSection.text(), /be concise/)
  const clearedExtra = (await api.saveExtraGlobal('')).content
  assert.equal(clearedExtra, '')
  assert.equal(extraSection.text(), '')

  const sessionInfoBefore = await api.getSessionInstruction('s1')
  assert.equal(sessionInfoBefore.exists, false)
  await sessions.get('s1').header // no-op: session object already exists
  await events['agent/created']({ agent: { id: 's1', ctx: fakeAgentCtx } })
  const sessionSection = sections.find((section) => section.name === 'instructions:session')
  assert.ok(sessionSection, 'session prompt section registered per agent')
  assert.equal(sessionSection.text(), '')
  await api.saveSessionInstruction('s1', '# session only\n\n- answer briefly\n')
  assert.match(sessionSection.text(), /answer briefly/)
  const sessionInfoAfter = await api.getSessionInstruction('s1')
  assert.equal(sessionInfoAfter.exists, true)
  await assert.rejects(() => api.getSessionInstruction('bad id!'), /invalid session id/)

  // Command output mentions the injection chain.
  const commandResult = await registered.command.handler({
    agent: { id: 's1' },
    rawInput: 'show',
    signal: new AbortController().signal,
  })
  assert.equal(commandResult.kind, 'success')
  assert.match(commandResult.text, /Instruction/)
  assert.match(commandResult.text, /生效链/)

  console.log('ok: dsh-instructions host smoke test passed')
} finally {
  await cleanup()
}
