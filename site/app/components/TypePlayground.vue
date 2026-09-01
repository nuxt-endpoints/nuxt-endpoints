<script setup lang="ts">
import { javascript } from '@codemirror/lang-javascript'
import { basicSetup, EditorView } from 'codemirror'

type PlaygroundFile = 'server' | 'client'
type PlaygroundPreset = {
  label: string
  description: string
  hint: string
  serverCode?: string
  clientCode?: string
}
type PlaygroundDiagnostic = {
  id: string
  file: PlaygroundFile
  line: number
  column: number
  code: number
  category: string
  messageParts: PlaygroundDiagnosticMessagePart[]
  codeFrame?: PlaygroundCodeFrame
  relatedInformation: PlaygroundRelatedInformation[]
}
type PlaygroundDiagnosticMessagePart = {
  text: string
  preview: string
  isLong: boolean
  level: number
}
type PlaygroundCodeFrame = {
  text: string
  marker: string
}
type PlaygroundRelatedInformation = {
  file: string
  line?: number
  column?: number
  messageParts: PlaygroundDiagnosticMessagePart[]
}
type TypeScriptModule = typeof import('typescript')

const defaultServerCode = `export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }),
  validate: {
    response: { 200: z.object({ id: z.number(), name: z.string() }) },
  },
  handler: (event) => {
    return { id: event.validated.params.id, name: 'Ada' }
  },
})`

const defaultClientCode = `const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})

console.log(\`id: \${result.body.id}, name: \${result.body.name}\`)`

const inferServerCode = `export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }),
  handler: (event) => {
    // no response schema: the client's type is inferred from this return
    return { id: event.validated.params.id, name: 'Ada', role: 'admin' }
  },
})`

const inferClientCode = `const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})

console.log(\`\${result.body.name} (\${result.body.role})\`)`

const schemaServerCode = `export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }),
  validate: {
    response: { 200: z.object({ id: z.number(), name: z.string(), role: z.string() }) },
  },
  handler: (event) => {
    // error: the schema declares \`role\`, so this return no longer satisfies it
    return { id: event.validated.params.id, name: 'Ada' }
    // fix: return { id: event.validated.params.id, name: 'Ada', role: 'admin' }
  },
})`

const presets: PlaygroundPreset[] = [
  {
    label: 'Valid',
    description: 'Server and client agree.',
    hint: 'A response schema is declared, the handler satisfies it, and the client reads only declared fields. Edit either file — the check reruns as you type.',
    serverCode: defaultServerCode,
    clientCode: defaultClientCode,
  },
  {
    label: 'Infer from handler',
    description: 'No response schema — types flow from the handler.',
    hint: "There is no response schema, so the client type is inferred from the handler return. Try it: delete `role: 'admin'` from the handler — the client call turns red.",
    serverCode: inferServerCode,
    clientCode: inferClientCode,
  },
  {
    label: 'Infer from schema',
    description: 'Schema declared — the handler must satisfy it.',
    hint: 'Same handler as before, but now a response schema is declared — and the roles flip: the schema checks the handler, so the server is red until the return matches. Apply the fix in the comment and everything turns green. The client is unaffected: its types come from the schema.',
    serverCode: schemaServerCode,
    clientCode: inferClientCode,
  },
  {
    label: 'Bad path',
    description: 'Change the route path.',
    hint: 'The path literal is checked against the known routes, so a typo in the URL fails to compile. Apply the fix in the comment and the error disappears.',
    clientCode: `// error: '/api/user/:id' is not a known route
// fix: '/api/users/:id'
const result = await $endpoint('/api/user/:id', {
  method: 'get',
  params: { id: '123' },
})

console.log(\`id: \${result.body.id}, name: \${result.body.name}\`)`,
  },
  {
    label: 'Bad response',
    description: 'Read a field not declared by the endpoint.',
    hint: 'The client reads result.body.email, but the contract only declares id and name — the read fails in TypeScript. Apply the fix in the comment and the error disappears.',
    clientCode: `const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})

// error: the contract declares \`name\`, not \`email\`
// fix: result.body.name
console.log(\`id: \${result.body.id}, name: \${result.body.email}\`)`,
  },
]

const serverCode = ref(defaultServerCode)
const clientCode = ref(defaultClientCode)
const activePresetLabel = ref(presets[0]?.label ?? '')
const activePreset = computed(() =>
  presets.find((preset) => preset.label === activePresetLabel.value),
)
const diagnostics = ref<PlaygroundDiagnostic[]>([])
const isReady = ref(false)
const isChecking = ref(false)
const compilerError = ref('')

const resultStatus = computed<'error' | 'muted' | 'success' | undefined>(() => {
  if (compilerError.value) {
    return 'error'
  }

  if (!isReady.value) {
    return 'muted'
  }

  if (diagnostics.value.length === 0) {
    return 'success'
  }

  return undefined
})

const resultMessage = computed(() => {
  if (compilerError.value) {
    return compilerError.value
  }

  if (!isReady.value) {
    return 'Loading TypeScript...'
  }

  return 'No type errors. The client matches the endpoint contract.'
})
const serverEditorElement = ref<HTMLElement | null>(null)
const clientEditorElement = ref<HTMLElement | null>(null)
let typeScript: TypeScriptModule | undefined
let checkTimer: ReturnType<typeof setTimeout> | undefined
let serverEditor: EditorView | undefined
let clientEditor: EditorView | undefined

const playgroundEditorTheme = EditorView.theme({
  '&': {
    minHeight: '18rem',
    backgroundColor: 'transparent',
    color: 'var(--code-ink)',
    fontSize: '0.82rem',
  },
  '.cm-scroller': {
    minHeight: '18rem',
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
    lineHeight: '1.55',
  },
  '.cm-content': {
    padding: '0.9rem',
    caretColor: 'var(--accent)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--code-muted)',
    borderRight: '1px solid var(--code-border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused .cm-activeLine': {
    backgroundColor: 'rgba(5, 150, 105, 0.06)',
  },
  '&.cm-focused .cm-activeLineGutter': {
    backgroundColor: 'rgba(5, 150, 105, 0.08)',
  },
  '&.cm-focused': {
    outline: '2px solid rgba(5, 150, 105, 0.2)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(5, 150, 105, 0.18)',
  },
})

onMounted(async () => {
  initPlaygroundEditors()

  try {
    typeScript = await import('typescript')
    isReady.value = true
    runCheck()
  } catch (error) {
    compilerError.value = error instanceof Error ? error.message : 'Unable to load TypeScript.'
  }
})

watch([serverCode, clientCode], () => {
  syncEditorDoc(serverEditor, serverCode.value)
  syncEditorDoc(clientEditor, clientCode.value)

  clearTimeout(checkTimer)
  checkTimer = setTimeout(runCheck, 260)
})

onBeforeUnmount(() => {
  clearTimeout(checkTimer)
  serverEditor?.destroy()
  clientEditor?.destroy()
})

function applyPreset(preset: PlaygroundPreset) {
  activePresetLabel.value = preset.label
  serverCode.value = preset.serverCode ?? defaultServerCode
  clientCode.value = preset.clientCode ?? defaultClientCode
}

function initPlaygroundEditors() {
  if (serverEditorElement.value && !serverEditor) {
    serverEditor = createPlaygroundEditor(serverEditorElement.value, serverCode.value, (value) => {
      serverCode.value = value
    })
  }

  if (clientEditorElement.value && !clientEditor) {
    clientEditor = createPlaygroundEditor(clientEditorElement.value, clientCode.value, (value) => {
      clientCode.value = value
    })
  }
}

function createPlaygroundEditor(
  parent: HTMLElement,
  doc: string,
  onChange: (value: string) => void,
) {
  return new EditorView({
    doc,
    parent,
    extensions: [
      basicSetup,
      javascript({ typescript: true }),
      playgroundEditorTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString())
        }
      }),
    ],
  })
}

function syncEditorDoc(editor: EditorView | undefined, value: string) {
  if (!editor || editor.state.doc.toString() === value) {
    return
  }

  editor.dispatch({
    changes: {
      from: 0,
      to: editor.state.doc.length,
      insert: value,
    },
  })
}

function runCheck() {
  if (!typeScript) {
    return
  }

  isChecking.value = true

  try {
    compilerError.value = ''
    diagnostics.value = collectDiagnostics(typeScript, {
      server: serverCode.value,
      client: clientCode.value,
    })
  } catch (error) {
    compilerError.value = error instanceof Error ? error.message : 'Unable to check this example.'
  } finally {
    isChecking.value = false
  }
}

function collectDiagnostics(
  ts: TypeScriptModule,
  files: Record<PlaygroundFile, string>,
): PlaygroundDiagnostic[] {
  const rootFiles = createVirtualFiles(files)
  const compilerOptions: import('typescript').CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noLib: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  }
  const host = createCompilerHost(ts, rootFiles, compilerOptions)
  const program = ts.createProgram(Object.keys(rootFiles), compilerOptions, host)

  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => {
      const fileName = diagnostic.file?.fileName

      return fileName === '/playground/server.ts' || fileName === '/playground/client.ts'
    })
    .map((diagnostic) => {
      const sourceFile = diagnostic.file
      const position = sourceFile?.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
      const file = sourceFile?.fileName.endsWith('/server.ts') ? 'server' : 'client'
      const line = (position?.line ?? 0) + 1
      const column = (position?.character ?? 0) + 1
      const messageParts = collectMessageParts(diagnostic.messageText)

      return {
        id: `${file}:${line}:${column}:TS${diagnostic.code}:${messageParts
          .map((part) => part.text)
          .join('|')}`,
        file,
        line,
        column,
        code: diagnostic.code,
        category: formatDiagnosticCategory(ts, diagnostic.category),
        messageParts,
        codeFrame: sourceFile
          ? createCodeFrame(sourceFile, diagnostic.start ?? 0, diagnostic.length ?? 1)
          : undefined,
        relatedInformation: formatRelatedInformation(diagnostic.relatedInformation),
      }
    })
}

function collectMessageParts(
  messageText: string | import('typescript').DiagnosticMessageChain,
  level = 0,
): PlaygroundDiagnosticMessagePart[] {
  if (typeof messageText === 'string') {
    return [createMessagePart(messageText, level)]
  }

  return [
    createMessagePart(messageText.messageText, level),
    ...(messageText.next || []).flatMap((message) => collectMessageParts(message, level + 1)),
  ]
}

function createMessagePart(text: string, level: number): PlaygroundDiagnosticMessagePart {
  const maxPreviewLength = 180
  const normalizedText = text.trim()
  const isLong = normalizedText.length > maxPreviewLength

  return {
    text: normalizedText,
    preview: isLong ? `${normalizedText.slice(0, maxPreviewLength).trimEnd()}...` : normalizedText,
    isLong,
    level,
  }
}

function createCodeFrame(
  sourceFile: import('typescript').SourceFile,
  start: number,
  length: number,
): PlaygroundCodeFrame {
  const position = sourceFile.getLineAndCharacterOfPosition(start)
  const lineStarts = sourceFile.getLineStarts()
  const lineStart = lineStarts[position.line] ?? 0
  const nextLineStart = lineStarts[position.line + 1] ?? sourceFile.text.length
  const rawText = sourceFile.text.slice(lineStart, nextLineStart).replace(/\r?\n$/, '')
  const text = expandTabs(rawText)
  const markerStart = expandTabs(rawText.slice(0, position.character)).length
  const markerText = expandTabs(
    sourceFile.text.slice(start, Math.min(start + length, lineStart + rawText.length)),
  )
  const markerLength = Math.max(1, markerText.length)
  const lineNumber = String(position.line + 1)
  const gutter = `${lineNumber} | `
  const markerGutter = `${' '.repeat(lineNumber.length)} | `

  return {
    text: `${gutter}${text}`,
    marker: `${markerGutter}${' '.repeat(markerStart)}${'^'.repeat(markerLength)}`,
  }
}

function expandTabs(value: string) {
  return value.replaceAll('\t', '  ')
}

function formatRelatedInformation(
  relatedInformation: readonly import('typescript').DiagnosticRelatedInformation[] | undefined,
): PlaygroundRelatedInformation[] {
  return (relatedInformation || []).map((diagnostic) => {
    const sourceFile = diagnostic.file
    const position = sourceFile?.getLineAndCharacterOfPosition(diagnostic.start ?? 0)

    return {
      file: formatDiagnosticFile(sourceFile?.fileName),
      line: position ? position.line + 1 : undefined,
      column: position ? position.character + 1 : undefined,
      messageParts: collectMessageParts(diagnostic.messageText),
    }
  })
}

function formatDiagnosticCategory(
  ts: TypeScriptModule,
  category: import('typescript').DiagnosticCategory,
) {
  return ((ts.DiagnosticCategory as Record<number, string>)[category] || 'Diagnostic').toLowerCase()
}

function formatDiagnosticFile(fileName: string | undefined) {
  if (!fileName) {
    return 'compiler'
  }

  if (fileName.endsWith('/server.ts')) {
    return 'server'
  }

  if (fileName.endsWith('/client.ts')) {
    return 'client'
  }

  if (fileName.endsWith('/types.d.ts')) {
    return 'generated types'
  }

  if (fileName.endsWith('/lib.d.ts')) {
    return 'minimal lib'
  }

  return fileName.replace('/playground/', '')
}

function createVirtualFiles(files: Record<PlaygroundFile, string>) {
  return {
    '/playground/lib.d.ts': minimalLibSource,
    '/playground/types.d.ts': endpointTypeSource,
    '/playground/server.ts': files.server,
    '/playground/client.ts': `${files.client}\nexport {}`,
  }
}

function createCompilerHost(
  ts: TypeScriptModule,
  files: Record<string, string>,
  compilerOptions: import('typescript').CompilerOptions,
) {
  return {
    getSourceFile(fileName, languageVersion) {
      const normalizedFileName = normalizeFileName(fileName)
      const source = files[normalizedFileName]

      if (source === undefined) {
        return undefined
      }

      return ts.createSourceFile(normalizedFileName, source, languageVersion, true)
    },
    getDefaultLibFileName() {
      return '/playground/lib.d.ts'
    },
    writeFile() {},
    getCurrentDirectory() {
      return '/playground'
    },
    getDirectories() {
      return []
    },
    fileExists(fileName) {
      return files[normalizeFileName(fileName)] !== undefined
    },
    readFile(fileName) {
      return files[normalizeFileName(fileName)]
    },
    getCanonicalFileName(fileName) {
      return fileName
    },
    useCaseSensitiveFileNames() {
      return true
    },
    getNewLine() {
      return '\n'
    },
  } satisfies import('typescript').CompilerHost
}

function normalizeFileName(fileName: string) {
  if (fileName.startsWith('/')) {
    return fileName
  }

  return `/playground/${fileName.replace(/^\.\//, '')}`
}

const minimalLibSource = `
interface Array<T> { length: number; [index: number]: T }
interface Boolean {}
interface CallableFunction extends Function {}
interface Function {}
interface IArguments {}
interface NewableFunction extends Function {}
interface Number {}
interface Object {}
interface Promise<T> extends PromiseLike<T> {}
interface PromiseLike<T> { then<TResult>(onfulfilled: (value: T) => TResult): PromiseLike<TResult> }
interface RegExp {}
interface String {}
type PropertyKey = string | number | symbol
type Record<K extends keyof any, T> = { [P in K]: T }
declare const console: { log(...args: unknown[]): void }
`

const endpointTypeSource = `
type Schema<Input, Output = Input> = {
  readonly __input: Input
  readonly __output: Output
}
type InferInput<T> = T extends Schema<infer Input, unknown> ? Input : never
type InferOutput<T> = T extends Schema<unknown, infer Output> ? Output : never
type ObjectInput<Shape> = { [Key in keyof Shape]: InferInput<Shape[Key]> }
type ObjectOutput<Shape> = { [Key in keyof Shape]: InferOutput<Shape[Key]> }
type ParamsOutput<Params> = Params extends Schema<unknown, infer Output> ? Output : {}
type ParamsInput<Params> = Params extends Schema<infer Input, unknown> ? { params: Input } : {}
type ResponsesOutput<Responses> = Responses extends { 200: Schema<unknown, infer Output> }
  ? Output
  : unknown
type AwaitedLike<T> = T extends PromiseLike<infer Value> ? AwaitedLike<Value> : T
type Endpoint<Params, Responses, Return> = {
  readonly __params: Params
  readonly __responses: Responses
  readonly __handlerReturn: Return
}
type EndpointRequest<E> = E extends Endpoint<infer Params, unknown, unknown>
  ? ParamsInput<Params>
  : {}
type ClientBody<E> = E extends Endpoint<unknown, infer Responses, infer Return>
  ? Responses extends { 200: Schema<unknown, infer Output> }
    ? Output
    : Return
  : unknown
declare const z: {
  string(): Schema<string>
  number(): Schema<number>
  coerce: {
    number(): Schema<string | number, number>
  }
  object<Shape extends Record<string, Schema<unknown, unknown>>>(
    shape: Shape,
  ): Schema<ObjectInput<Shape>, ObjectOutput<Shape>>
}
declare function defineRouteHandler<
  Params extends Schema<unknown, unknown> | undefined = undefined,
  Responses extends { 200: Schema<unknown, unknown> } | undefined = undefined,
  Return extends
    | ResponsesOutput<Responses>
    | Promise<ResponsesOutput<Responses>> = ResponsesOutput<Responses>,
>(definition: {
  params?: Params
  validate?: { response?: Responses }
  handler: (event: { validated: { params: ParamsOutput<Params> } }) => Return
}): Endpoint<Params, Responses, AwaitedLike<Return>>
declare function $endpoint(
  path: '/api/users/:id',
  options: EndpointRequest<typeof import('./server').default> & { method: 'get' },
): Promise<{
  status: 200
  ok: true
  body: ClientBody<typeof import('./server').default>
  headers: Headers
}>
`
</script>

<template>
  <div class="ne-type-playground">
    <p class="text -intro">
      A real TypeScript compiler runs in your browser against a miniature of the generated endpoint
      types. Pick an example, then edit either file — the diagnostics below update as you type.
    </p>

    <div class="actions" aria-label="Playground examples">
      <button
        v-for="preset in presets"
        :key="preset.label"
        class="button"
        type="button"
        :aria-pressed="preset.label === activePresetLabel"
        @click="applyPreset(preset)"
      >
        <span class="value">{{ preset.label }}</span>
        {{ preset.description }}
      </button>
    </div>

    <p v-if="activePreset" class="text -hint">{{ activePreset.hint }}</p>

    <div class="unit">
      <section class="section" aria-label="Server contract">
        <span class="value">Server contract</span>
        <div ref="serverEditorElement" class="media" />
      </section>

      <section class="section" aria-label="Client call">
        <span class="value">Client call</span>
        <div ref="clientEditorElement" class="media" />
      </section>

      <section class="section" aria-live="polite">
        <div class="field">
          <span class="value">TypeScript diagnostics</span>
          <small class="note">Generated from the server endpoint type</small>
        </div>

        <p v-if="resultStatus" class="text" :data-status="resultStatus">{{ resultMessage }}</p>
        <ul v-else class="list">
          <li v-for="diagnostic in diagnostics" :key="diagnostic.id" class="item">
            <div class="seg">
              <span class="fr">
                {{ diagnostic.file }}:{{ diagnostic.line }}:{{ diagnostic.column }}
              </span>
              <span class="fr">TS{{ diagnostic.code }}</span>
              <span class="fr">{{ diagnostic.category }}</span>
            </div>

            <ul class="list">
              <li
                v-for="(part, index) in diagnostic.messageParts"
                :key="`${diagnostic.id}:message:${index}`"
                class="item"
                :style="{ '--local-depth': part.level }"
              >
                <template v-if="!part.isLong">{{ part.text }}</template>
                <details v-else class="details">
                  <summary class="summary">{{ part.preview }}</summary>
                  <pre class="pre">{{ part.text }}</pre>
                </details>
              </li>
            </ul>

            <pre
              v-if="diagnostic.codeFrame"
              class="pre"
            ><code class="code"><span class="value">{{ diagnostic.codeFrame.text }}</span>
<span class="value" data-marker="true">{{ diagnostic.codeFrame.marker }}</span></code></pre>

            <details v-if="diagnostic.relatedInformation.length > 0" class="details">
              <summary class="summary">Related information</summary>
              <ul class="list">
                <li
                  v-for="(related, index) in diagnostic.relatedInformation"
                  :key="`${diagnostic.id}:related:${index}`"
                  class="item"
                >
                  <span class="value">
                    {{ related.file
                    }}<template v-if="related.line"
                      >:{{ related.line }}:{{ related.column }}</template
                    >
                  </span>
                  <ul class="list">
                    <li
                      v-for="(part, partIndex) in related.messageParts"
                      :key="`${diagnostic.id}:related:${index}:${partIndex}`"
                      class="item"
                      :style="{ '--local-depth': part.level }"
                    >
                      <template v-if="!part.isLong">{{ part.text }}</template>
                      <details v-else class="details">
                        <summary class="summary">{{ part.preview }}</summary>
                        <pre class="pre">{{ part.text }}</pre>
                      </details>
                    </li>
                  </ul>
                </li>
              </ul>
            </details>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ne-type-playground {
  display: grid;
  gap: var(--space-200);

  > .text {
    margin: 0;

    &.-intro {
      max-width: 62rem;
      color: var(--muted);
    }

    &.-hint {
      max-width: 62rem;
      border-left: var(--stroke-accent) solid var(--accent);
      border-radius: 0 var(--radius-md) var(--radius-md) 0;
      background: var(--diagnostic-item-bg);
      color: var(--ink);
      font-size: var(--text-md);
      padding: var(--space-100) var(--space-150);
    }
  }

  > .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-100);

    > .button {
      display: inline-flex;
      min-height: 2.25rem;
      align-items: center;
      gap: var(--space-075);
      border: var(--stroke-default) solid var(--line);
      border-radius: var(--radius-md);
      background: var(--button-bg);
      color: var(--muted);
      cursor: pointer;
      font: inherit;
      font-size: var(--text-sm);
      padding: 0 var(--space-125);

      > .value {
        color: var(--ink);
        font-weight: 760;
      }

      &:hover {
        border-color: var(--button-hover-border);
        color: var(--ink);
      }

      &[aria-pressed='true'] {
        border-color: var(--accent);
        background: var(--inline-code-bg);
        color: var(--ink);
      }
    }
  }

  > .unit {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-200);

    > .section {
      min-width: 0;
      overflow: hidden;
      border: var(--stroke-default) solid var(--code-border);
      border-radius: var(--radius-md);
      background: var(--code-bg);
      box-shadow: var(--playground-panel-shadow);

      &:not(:last-child) {
        display: grid;
        grid-template-rows: auto minmax(18rem, 1fr);

        > .value {
          border-bottom: var(--stroke-default) solid var(--code-border);
          color: var(--code-muted);
          font-size: var(--text-xs);
          font-weight: 720;
          padding: var(--space-150) var(--space-200);
        }

        > .media {
          min-height: 18rem;
        }
      }

      &:last-child {
        display: grid;
        grid-column: 1 / -1;
        min-height: 8.5rem;
        grid-template-rows: auto 1fr;

        > .field {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-150);
          border-bottom: var(--stroke-default) solid var(--code-border);
          color: var(--code-muted);
          font-size: var(--text-xs);
          font-weight: 720;
          padding: var(--space-150) var(--space-200);

          > .note {
            color: var(--muted);
            font-size: var(--text-xs);
            font-weight: 560;
          }
        }

        > .text {
          margin: 0;
          padding: var(--space-200);

          &[data-status='success'] {
            color: var(--accent-secondary);
          }

          &[data-status='muted'] {
            color: var(--muted);
          }

          &[data-status='error'] {
            color: var(--accent-strong);
          }
        }

        > .list {
          display: grid;
          gap: var(--space-150);
          margin: 0;
          padding: var(--space-200);
          list-style: none;

          > .item {
            display: grid;
            gap: var(--space-125);
            border-left: var(--stroke-accent) solid var(--accent);
            border-radius: 0 var(--radius-md) var(--radius-md) 0;
            background: var(--diagnostic-item-bg);
            color: var(--code-ink);
            font-size: var(--text-sm);
            line-height: 1.5;
            padding: var(--space-150) var(--space-150);

            > .seg {
              display: flex;
              flex-wrap: wrap;
              align-items: center;
              gap: var(--space-100);

              > .fr {
                display: inline-flex;
                min-height: 1.45rem;
                align-items: center;
                border-radius: var(--radius-sm);
                font-size: var(--text-xs);
                font-weight: 760;
                line-height: 1;
                padding: 0 var(--space-100);

                &:nth-child(1) {
                  background: var(--inline-code-bg);
                  color: var(--accent-strong);
                  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
                }

                &:nth-child(2) {
                  border: var(--stroke-default) solid var(--diagnostic-border);
                  color: var(--accent-strong);
                }

                &:nth-child(3) {
                  color: var(--muted);
                  text-transform: capitalize;
                }
              }
            }

            > .list {
              display: grid;
              gap: var(--space-050);
              margin: 0;
              padding: 0;
              list-style: none;

              > .item {
                margin-left: calc(var(--local-depth, 0) * var(--space-200));

                &:not(:first-child) {
                  color: var(--muted);
                }

                > .details {
                  > .summary {
                    cursor: pointer;
                    color: var(--accent-strong);
                    font-weight: 760;
                  }

                  > .pre {
                    margin-top: var(--space-100);
                    overflow-x: auto;
                    border: var(--stroke-default) solid var(--code-border);
                    border-radius: var(--radius-md);
                    background: var(--code-bg);
                    color: var(--code-ink);
                    font-size: var(--text-xs);
                    white-space: pre-wrap;
                  }
                }
              }
            }

            > .pre {
              overflow-x: auto;
              border: var(--stroke-default) solid var(--code-border);
              border-radius: var(--radius-md);
              background: var(--code-bg);
              color: var(--code-ink);
              padding: var(--space-125) var(--space-125);

              > .code {
                display: grid;
                min-width: max-content;
                font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
                font-size: var(--text-xs);
                line-height: 1.45;

                > .value {
                  display: block;
                  white-space: pre;

                  &[data-marker='true'] {
                    color: var(--accent-strong);
                  }
                }
              }
            }

            > .details {
              border-top: var(--stroke-default) solid var(--line);
              padding-top: var(--space-100);

              > .summary {
                cursor: pointer;
                color: var(--accent-strong);
                font-weight: 760;
              }

              > .list {
                display: grid;
                gap: var(--space-100);
                margin: var(--space-100) 0 0;
                padding: 0;
                list-style: none;

                > .item {
                  > .value {
                    display: block;
                    margin-bottom: var(--space-050);
                    color: var(--code-muted);
                    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
                    font-size: var(--text-xs);
                    font-weight: 720;
                  }

                  > .list {
                    display: grid;
                    gap: var(--space-050);
                    margin: 0;
                    padding: 0;
                    list-style: none;

                    > .item {
                      margin-left: calc(var(--local-depth, 0) * var(--space-200));

                      &:not(:first-child) {
                        color: var(--muted);
                      }

                      > .details {
                        > .summary {
                          cursor: pointer;
                          color: var(--accent-strong);
                          font-weight: 760;
                        }

                        > .pre {
                          margin-top: var(--space-100);
                          overflow-x: auto;
                          border: var(--stroke-default) solid var(--code-border);
                          border-radius: var(--radius-md);
                          background: var(--code-bg);
                          color: var(--code-ink);
                          font-size: var(--text-xs);
                          white-space: pre-wrap;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  @media (max-width: 960px) {
    > .unit {
      grid-template-columns: 1fr;

      > .section:last-child {
        grid-column: auto;
      }
    }
  }

  @media (max-width: 620px) {
    > .unit > .section {
      &:last-child > .field {
        align-items: flex-start;
        flex-direction: column;
      }

      &:not(:last-child) {
        grid-template-rows: auto minmax(14rem, 1fr);

        > .media {
          min-height: 14rem;
        }
      }
    }
  }
}

/* CodeMirror renders non-owned DOM. These :deep() rules stay un-nested:
   Vue's scoped compiler mis-emits :deep() inside nested rules. */
.ne-type-playground > .unit > .section > .media :deep(.cm-editor) {
  height: 100%;
  min-height: 18rem;
  background: transparent;
  color: var(--code-ink);
}

.ne-type-playground > .unit > .section > .media :deep(.cm-scroller) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
}

.ne-type-playground > .unit > .section > .media :deep(.cm-content) {
  tab-size: 2;
}

.ne-type-playground > .unit > .section > .media :deep(.cm-tooltip) {
  border: var(--stroke-default) solid var(--code-border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow);
}

@media (max-width: 620px) {
  .ne-type-playground > .unit > .section > .media :deep(.cm-editor) {
    min-height: 14rem;
    font-size: var(--text-xs);
  }
}
</style>
