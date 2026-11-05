import { BODY_KINDS } from '@shared/httpBody'
import { HTTP_METHODS, type HttpRequestSpec } from '@shared/httpRequest'
import { TEST_OPS, TEST_TARGETS } from '@shared/httpTests'
import { z } from 'zod'
import { normalizeBaseUrl, parseHeaders } from '@shared/httpEnv'
import { UNSAFE_CONTROL_RE } from '@shared/snippets'

const HOST_RE = /^[A-Za-z0-9._%:\-[\]]+$/

export const sessionInputSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    kind: z.enum(['ssh', 'http']).default('ssh'),
    name: z.string().trim().min(1).max(100),
    folder: z.string().trim().max(100),
    host: z.string().trim().max(255),
    port: z.number().int().min(1).max(65535),
    username: z.string().trim().max(64),
    auth: z.enum(['password', 'key', 'agent']),
    keyPath: z.string().max(1024),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    startupCommand: z.string().max(2000),
    monitoring: z.boolean(),
    sftp: z.boolean(),
    baseUrl: z.string().trim().max(2048).default(''),
    headers: z.string().max(8192).default(''),
    insecure: z.boolean().default(false),
    secret: z.string().max(4096).optional(),
    clearSecret: z.boolean().optional()
  })
  .superRefine((s, ctx) => {
    if (s.kind === 'ssh') {
      if (!s.host || !HOST_RE.test(s.host)) ctx.addIssue({ code: 'custom', path: ['host'], message: 'Invalid host' })
      return
    }
    if (!normalizeBaseUrl(s.baseUrl)) ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'Base URL must be http(s)://host' })
    if (s.secret && /[\x00-\x1f\x7f]/.test(s.secret)) ctx.addIssue({ code: 'custom', path: ['secret'], message: 'Token contains control characters' })
    const bad = parseHeaders(s.headers).invalid
    if (bad.length > 0) ctx.addIssue({ code: 'custom', path: ['headers'], message: `Invalid header on line ${bad[0]}` })
  })

const commandName = z.string().trim().min(1).max(120)
const commandText = z
  .string()
  .max(8000)
  .refine((c) => c.trim().length > 0, 'Command is empty')
  .refine((c) => !UNSAFE_CONTROL_RE.test(c), 'Command contains control characters')

export const commandInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: commandName,
  command: commandText,
  sessionId: z.string().min(1).max(64).optional(),
  sessionName: z.string().trim().min(1).max(100).optional()
})

/** One entry of commands.json as people write it: `session` names a connection, `sessionId` pins it. */
export const commandFileEntrySchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: commandName,
  command: commandText,
  session: z.string().trim().min(1).max(100).optional(),
  sessionId: z.string().min(1).max(64).optional()
})

export const settingsShape = z.object({
    language: z.enum(['ru', 'en']),
    uiTheme: z.enum(['dark', 'light', 'system', 'vs', 'retro', 'moba']),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    terminalTheme: z.string().max(40),
    fontFamily: z.string().max(80),
    fontSize: z.number().min(8).max(32),
    lineHeight: z.number().min(1).max(2),
    cursorStyle: z.enum(['block', 'bar', 'underline']),
    cursorBlink: z.boolean(),
    scrollback: z.number().int().min(100).max(200000),
    copyOnSelect: z.boolean(),
    rightClickPaste: z.boolean(),
    terminalBanner: z.boolean(),
    outputHighlight: z.boolean(),
    localShell: z.string().max(512),
    keepaliveInterval: z.number().int().min(0).max(600),
    connectTimeout: z.number().int().min(3).max(120),
    defaultUsername: z.string().max(64),
    monitorEnabled: z.boolean(),
    monitorInterval: z.number().int().min(1).max(60),
    downloadDir: z.string().max(1024),
    showHiddenFiles: z.boolean(),
    confirmDelete: z.boolean(),
    sftpFollowTerminal: z.boolean(),
    selectAllPicksCommand: z.boolean(),
    sftpPanelOpen: z.boolean(),
    sidebarOpen: z.boolean(),
    commandsPanelOpen: z.boolean(),
    httpPanelOpen: z.boolean(),
    httpPanelExpanded: z.boolean()
})

export const settingsPatchSchema = settingsShape.partial().strict()

const httpText = (max: number): z.ZodString => z.string().max(max)
const shortText = httpText(4096)

export const httpRequestSpecSchema = z.object({
  method: z.enum(HTTP_METHODS),
  url: httpText(8192),
  headers: httpText(16384),
  body: httpText(1024 * 1024),
  followRedirects: z.boolean(),
  bodyKind: z.enum(BODY_KINDS).optional(),
  form: z.array(z.object({ name: shortText, value: httpText(64 * 1024), enabled: z.boolean(), file: z.boolean().optional() })).max(200).optional(),
  filePath: shortText.optional(),
  graphqlVariables: httpText(256 * 1024).optional(),
  auth: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('none') }),
      z.object({ type: z.literal('bearer'), token: shortText }),
      z.object({ type: z.literal('basic'), username: shortText, password: shortText }),
      z.object({ type: z.literal('apikey'), name: shortText, value: shortText, in: z.enum(['header', 'query']) })
    ])
    .optional(),
  disabledParams: z.array(z.object({ name: shortText, value: shortText })).max(200).optional(),
  timeoutSec: z.number().int().min(1).max(3600).optional(),
  insecure: z.boolean().optional(),
  saveCookies: z.boolean().optional(),
  tests: z.array(z.object({ target: z.enum(TEST_TARGETS), path: shortText, op: z.enum(TEST_OPS), value: shortText, enabled: z.boolean() })).max(100).optional(),
  extract: z.array(z.object({ source: z.enum(['json', 'header']), path: shortText, variable: httpText(64), enabled: z.boolean() })).max(100).optional()
}) satisfies z.ZodType<HttpRequestSpec>

const savedName = z.string().trim().min(1).max(200)
const savedFolder = z.string().trim().max(400)

export const savedRequestInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: savedName,
  folder: savedFolder,
  sessionId: z.string().min(1).max(64).optional(),
  spec: httpRequestSpecSchema
})

export const httpVarsSchema = z.record(z.string().min(1).max(64), z.string().max(64 * 1024))

export const httpHistoryItemSchema = z.object({
  id: z.string().min(1).max(64),
  spec: httpRequestSpecSchema,
  status: z.number().int().min(0).max(999),
  timeMs: z.number().min(0),
  at: z.number().min(0)
})

export const httpWorkspaceSchema = z.object({
  requests: z.array(savedRequestInputSchema.extend({ id: z.string().min(1).max(64), updatedAt: z.number() })),
  vars: z.record(z.string(), httpVarsSchema),
  history: z.record(z.string(), z.array(httpHistoryItemSchema))
})

export const importedCollectionSchema = z.object({
  name: z.string().max(400),
  requests: z.array(z.object({ name: savedName, folder: savedFolder, spec: httpRequestSpecSchema })).max(5000),
  variables: httpVarsSchema
})
