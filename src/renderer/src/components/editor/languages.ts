import type { Extension } from '@codemirror/state'

export interface LanguageInfo {
  label: string
  load: () => Promise<Extension>
}

async function legacy(mode: () => Promise<Record<string, unknown>>, key: string): Promise<Extension> {
  const [{ StreamLanguage }, mod] = await Promise.all([import('@codemirror/language'), mode()])
  return StreamLanguage.define(mod[key] as Parameters<typeof StreamLanguage.define>[0])
}

const LANGS: Record<string, LanguageInfo> = {
  javascript: { label: 'JavaScript', load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }) },
  typescript: {
    label: 'TypeScript',
    load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true })
  },
  json: { label: 'JSON', load: async () => (await import('@codemirror/lang-json')).json() },
  python: { label: 'Python', load: async () => (await import('@codemirror/lang-python')).python() },
  yaml: { label: 'YAML', load: async () => (await import('@codemirror/lang-yaml')).yaml() },
  markdown: { label: 'Markdown', load: async () => (await import('@codemirror/lang-markdown')).markdown() },
  html: { label: 'HTML', load: async () => (await import('@codemirror/lang-html')).html() },
  css: { label: 'CSS', load: async () => (await import('@codemirror/lang-css')).css() },
  sql: { label: 'SQL', load: async () => (await import('@codemirror/lang-sql')).sql() },
  xml: { label: 'XML', load: async () => (await import('@codemirror/lang-xml')).xml() },
  shell: { label: 'Shell', load: () => legacy(() => import('@codemirror/legacy-modes/mode/shell'), 'shell') },
  nginx: { label: 'Nginx', load: () => legacy(() => import('@codemirror/legacy-modes/mode/nginx'), 'nginx') },
  dockerfile: { label: 'Dockerfile', load: () => legacy(() => import('@codemirror/legacy-modes/mode/dockerfile'), 'dockerFile') },
  toml: { label: 'TOML', load: () => legacy(() => import('@codemirror/legacy-modes/mode/toml'), 'toml') },
  ini: { label: 'INI / env', load: () => legacy(() => import('@codemirror/legacy-modes/mode/properties'), 'properties') },
  go: { label: 'Go', load: () => legacy(() => import('@codemirror/legacy-modes/mode/go'), 'go') },
  rust: { label: 'Rust', load: () => legacy(() => import('@codemirror/legacy-modes/mode/rust'), 'rust') },
  ruby: { label: 'Ruby', load: () => legacy(() => import('@codemirror/legacy-modes/mode/ruby'), 'ruby') },
  lua: { label: 'Lua', load: () => legacy(() => import('@codemirror/legacy-modes/mode/lua'), 'lua') },
  diff: { label: 'Diff', load: () => legacy(() => import('@codemirror/legacy-modes/mode/diff'), 'diff') }
}

const BY_EXT: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  json: 'json', jsonc: 'json', webmanifest: 'json',
  py: 'python', pyw: 'python',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  css: 'css', scss: 'css', less: 'css',
  sql: 'sql',
  xml: 'xml', svg: 'xml', plist: 'xml', xsd: 'xml',
  sh: 'shell', bash: 'shell', zsh: 'shell', ksh: 'shell',
  toml: 'toml',
  ini: 'ini', cfg: 'ini', conf: 'ini', env: 'ini', properties: 'ini', service: 'ini', timer: 'ini',
  go: 'go', rs: 'rust', rb: 'ruby', lua: 'lua', diff: 'diff', patch: 'diff'
}

const BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile', containerfile: 'dockerfile', '.bashrc': 'shell', '.zshrc': 'shell', '.profile': 'shell',
  '.bash_profile': 'shell', '.env': 'ini', 'nginx.conf': 'nginx', gemfile: 'ruby', makefile: 'shell'
}

/** Picks a language for a remote file path; null means plain text. */
export function languageFor(path: string): LanguageInfo | null {
  const name = path.split('/').pop()?.toLowerCase() ?? ''
  if (BY_NAME[name]) return LANGS[BY_NAME[name]]
  if (name.startsWith('dockerfile')) return LANGS.dockerfile
  if (name.startsWith('.env')) return LANGS.ini
  if (/\/nginx\//.test(path) && name.endsWith('.conf')) return LANGS.nginx
  const ext = name.includes('.') ? name.split('.').pop() ?? '' : ''
  return BY_EXT[ext] ? LANGS[BY_EXT[ext]] : null
}
