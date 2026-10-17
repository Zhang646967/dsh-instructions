#!/usr/bin/env node
/**
 * Host-half smoke test: runs the plugin's `apply(ctx)` against a fake Cordis
 * context (no DSH process required) and checks the file/instruction logic.
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
      return undefined
    },
    provide(name, value) {
      provided[name] = value
    },
    inject(names, callback) {
      deferred.push(() =>
        callback({ ...baseCtx, tools: toolApi, commands: commandApi, effect: (fn) => (fn(), () => {}) }),
      )
    },
    fiber: {},
  }
  plugin.apply(baseCtx)
  deferred.forEach((run) => run())
  const api = provided.instructions
  assert.ok(api, 'instructions service is provided')

  // Chain resolution: empty files do not appear in the project chain.
  const initial = await api.getState()
  assert.equal(initial.global.exists, false)
  assert.equal(initial.projects.length, 2)
  assert.equal(initial.projects[1].root, repo, 'project root discovery climbs to .git')

  // Empty content deletes the file; non-empty writes the official path.
  await api.saveGlobal('')
  await api.saveGlobal('# global\n\nReply in Chinese.\n')
  const withGlobal = await api.getState()
  assert.equal(withGlobal.global.exists, true)
  assert.equal(await api.readFile('ws1', path.join(workspace, 'AGENTS.md')).then((f) => f.exists), false)

  await api.saveProject('ws1', '# project\n')
  const project = await api.readProject('ws1')
  assert.equal(project.targetExists, true)
  assert.equal(project.content, '# project\n')
  assert.ok(project.chain.some((entry) => entry.scope === 'global' && entry.exists))
  assert.ok(project.chain.some((entry) => entry.scope === 'project' && entry.displayPath === 'AGENTS.md'))

  // Chain-file validation rejects paths outside the instruction chain.
  await assert.rejects(() => api.readFile('ws1', '/etc/passwd'), /Not inside the instruction chain/)
  const chainFile = await api.readFile('ws1', project.targetPath)
  assert.equal(chainFile.content, '# project\n')
  const removed = await api.saveFile('ws1', project.targetPath, '')
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

  // Agent tool: list / get / set / append / remove, global read-only.
  assert.ok(registered.tool, 'instructions tool registered')
  assert.ok(registered.command, '/instruction command registered')
  const listed = await registered.tool.execute({ action: 'list' }, { agent: { id: 's1' } })
  assert.equal(listed.workspace, workspace)
  await registered.tool.execute({ action: 'set', content: '# from tool\n' }, { agent: { id: 's1' } })
  await registered.tool.execute({ action: 'append', content: '- appended\n' }, { agent: { id: 's1' } })
  const readTool = await registered.tool.execute({ action: 'get' }, { agent: { id: 's1' } })
  assert.match(readTool.content, /from tool/)
  assert.match(readTool.content, /appended/)
  await assert.rejects(
    () => registered.tool.execute({ action: 'set', scope: 'global', content: 'x' }, { agent: { id: 's1' } }),
    /user-only/,
  )
  const removedByTool = await registered.tool.execute({ action: 'remove' }, { agent: { id: 's1' } })
  assert.equal(removedByTool.exists, false)

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
