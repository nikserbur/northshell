import { z } from 'zod'

const HOST_RE = /^[A-Za-z0-9._%:\-[\]]+$/

export const sessionInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(100),
  folder: z.string().trim().max(100),
  host: z.string().trim().min(1).max(255).regex(HOST_RE),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().max(64),
  auth: z.enum(['password', 'key', 'agent']),
  keyPath: z.string().max(1024),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  startupCommand: z.string().max(2000),
  monitoring: z.boolean(),
  sftp: z.boolean(),
  secret: z.string().max(4096).optional(),
  clearSecret: z.boolean().optional()
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
    sidebarOpen: z.boolean()
})

export const settingsPatchSchema = settingsShape.partial().strict()
