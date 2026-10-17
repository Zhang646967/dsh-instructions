/**
 * Hand-written Typert host face for dsh-instructions.
 *
 * The shape mirrors a generated `@deepseek-ai/dsh-typert-generator` artifact
 * (see the installed dsh-cost-meter package for the same hand-written form):
 * `./typert` exports TYPERT, and typert-loader registers it automatically for
 * the Loader entry that mounts this package. Every codec is a strict codec
 * with a `create()` factory; the schema is permissive because the business
 * methods validate their own inputs and return plain JSON.
 */

const anySchema = {
  parse(value) {
    return value
  },
  safeParse(value) {
    return { success: true, data: value }
  },
}

const strictCodec = (name) => ({
  mode: 'strict',
  typeSymbol: `dsh-instructions#${name}`,
  schema: anySchema,
  create: () => anySchema,
})

const parameter = (name) => ({
  name,
  wire: name,
  source: 'json',
  codec: strictCodec(`parameter:${name}`),
})

const invocation = (method, parameters = []) => ({
  id: `dsh-instructions#instructions/${method}`,
  service: 'instructions',
  namespace: 'instructions',
  method,
  invocation: { kind: 'direct' },
  parameters: parameters.map(parameter),
  result: strictCodec(`result:${method}`),
})

export const TYPERT = {
  package: 'dsh-instructions',
  face: 'host',
  schemas: [],
  invocations: [
    invocation('getState'),
    invocation('readProject', ['workspaceId']),
    invocation('saveGlobal', ['content']),
    invocation('saveProject', ['workspaceId', 'content']),
    invocation('findWorkspaceForSession', ['sessionId']),
    invocation('readFile', ['workspaceId', 'filePath']),
    invocation('saveFile', ['workspaceId', 'filePath', 'content']),
    invocation('getSessionStatus', ['sessionId']),
  ],
  model: {
    services: [
      {
        key: 'instructions',
        exportName: 'InstructionsService',
        description:
          'Resolve and edit the AGENTS.md instruction chain consumed by the built-in desktop instructions engine.',
        summary: 'Global and project pre-instruction management.',
        tags: [],
        jsDoc: '/** Global and project pre-instruction management. */',
        members: [
          { kind: 'method', name: 'getState', signature: 'getState(): Promise<InstructionsState>' },
          {
            kind: 'method',
            name: 'readProject',
            signature: 'readProject(workspaceId: string): Promise<ProjectInstructions>',
          },
          {
            kind: 'method',
            name: 'saveGlobal',
            signature: 'saveGlobal(content: string): Promise<GlobalInstructions>',
          },
          {
            kind: 'method',
            name: 'saveProject',
            signature: 'saveProject(workspaceId: string, content: string): Promise<ProjectInstructions>',
          },
          {
            kind: 'method',
            name: 'findWorkspaceForSession',
            signature: 'findWorkspaceForSession(sessionId: string): Promise<string | null>',
          },
          {
            kind: 'method',
            name: 'readFile',
            signature: 'readFile(workspaceId: string, filePath: string): Promise<InstructionFile>',
          },
          {
            kind: 'method',
            name: 'saveFile',
            signature:
              'saveFile(workspaceId: string, filePath: string, content: string): Promise<InstructionFileSave>',
          },
          {
            kind: 'method',
            name: 'getSessionStatus',
            signature: 'getSessionStatus(sessionId: string): Promise<SessionInstructionStatus>',
          },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
}

export default TYPERT
