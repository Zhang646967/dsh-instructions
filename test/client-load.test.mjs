#!/usr/bin/env node
/**
 * Client-half smoke test: loads client.js against a minimal React/window stub,
 * runs the plugin's apply(ctx) and renders the registered slots once. This
 * catches top-level crashes and broken render branches without a browser.
 *
 *   node test/client-load.test.mjs
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const h = (type, props, ...children) => ({ type, props: props ?? {}, children })

let loaded = null

globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loaded = { id, plugin: factory(requireStub) }
    },
  },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  addEventListener: () => {},
  removeEventListener: () => {},
}

const ReactStub = {
  createElement: h,
  Component: class Component {
    constructor(props) {
      this.props = props ?? {}
      this.state = {}
    }

    setState() {}
  },
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (callback) => callback,
  useRef: (initial) => ({ current: initial ?? null }),
}

function requireStub(name) {
  if (name === 'react') return ReactStub
  throw new Error(`unexpected require: ${name}`)
}

await import(pathToFileURL(path.join(import.meta.dirname, '..', 'client.js')).href)
assert.ok(loaded !== null, 'client bundle registered a module')
assert.equal(loaded.id, 'dsh-instructions')
assert.ok(loaded.plugin !== null && typeof loaded.plugin.apply === 'function')

const registrations = []
const locale = {
  getSnapshot: () => ({ active: 'zh' }),
  subscribe: () => () => {},
}
const ctx = {
  get(name) {
    if (name === 'locale') return locale
    if (name === 'remote.instructions') {
      return {
        getState: async () => ({ ok: true, value: { global: {}, projects: [] } }),
        findWorkspaceForSession: async () => null,
        getSessionStatus: async () => ({ found: false }),
      }
    }
    return undefined
  },
  remote: { $mount: async () => () => {} },
  slots: {
    inject(key, callback) {
      const dispose = callback()
      registrations.push({ key, dispose })
      return () => {}
    },
    register(options, component) {
      registrations.push({ key: options.name, options, component })
      return () => {}
    },
  },
  effect: (callback) => {
    const dispose = callback()
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  },
}

await loaded.plugin.apply(ctx)
assert.ok(registrations.length >= 5, `expected slot registrations, got ${registrations.length}`)

for (const entry of registrations) {
  if (typeof entry.component !== 'function') continue
  const element = entry.component({ sessionId: 'session-1', size: 16, active: false })
  assert.ok(element !== null && typeof element === 'object', `component for ${entry.key} rendered an element`)
}

const page = registrations.find((entry) => entry.options?.name === 'main')
assert.ok(page !== undefined, 'main panel registration exists')
assert.ok(page.component().children.length > 0, 'page renders content')

console.log('ok: dsh-instructions client smoke test passed')
