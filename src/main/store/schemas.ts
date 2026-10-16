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
    sftpPanelOpen: z.boolean(),
    sidebarOpen: z.boolean(),
    commandsPanelOpen: z.boolean()
})

export const settingsPatchSchema = settingsShape.partial().strict()
