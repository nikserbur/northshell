import type { Client, ClientChannel } from 'ssh2'

export interface CwdFollowOptions {
  /** Where /proc lives; tests point it at a fake tree. */
  procRoot?: string
  /** Shell expression for the process whose children are searched; tests override it. */
  parent?: string
}

/**
 * POSIX shell script for an exec channel of the same SSH connection. Every channel of a connection is
 * a child of the same sshd process, so the interactive shell is the sibling that owns a tty. The script
 * then prints `@@cwd <dir>` whenever the directory of the terminal's foreground process changes
 * (so `cd` in a nested `bash` is followed too). Nothing is typed into the user's shell.
 * Linux reads /proc; other hosts (macOS) use ps and lsof. The body must not contain single quotes.
 */
export function cwdFollowCommand({ procRoot = '/proc', parent = '$PPID' }: CwdFollowOptions = {}): string {
  const body = [
    'export LC_ALL=C',
    `R=${procRoot}; P=${parent}; S=; i=0`,
    // Fields after "(comm) ": state ppid pgrp session tty_nr tpgid — comm itself may contain spaces.
    'while [ -z "$S" ] && [ $i -lt 10 ]; do',
    '  if [ -r "$R/$P/stat" ]; then',
    '    for f in "$R"/[0-9]*/stat; do',
    '      read -r l 2>/dev/null < "$f" || continue',
    '      set -- ${l##*) }',
    '      if [ "$2" = "$P" ] && [ "$5" != 0 ]; then S=${f%/stat}; S=${S##*/}; [ "$S" = $$ ] && S= || break; fi',
    '    done',
    '  else',
    // ps marks "no tty" as ?? (macOS), - (BSD) or ? (Linux); the script itself is never the shell.
    '    S=$(ps -A -o pid=,ppid=,tt= 2>/dev/null | while read -r p pp tt; do',
    '      case "$tt" in ("??"|"?"|"-"|"") continue;; esac',
    '      if [ "$pp" = "$P" ] && [ "$p" != $$ ]; then echo "$p"; break; fi',
    '    done)',
    '  fi',
    '  if [ -z "$S" ]; then i=$((i + 1)); sleep 1; fi',
    'done',
    'if [ -z "$S" ]; then echo @@nocwd; exit 0; fi',
    'L=',
    // Ends with the shell or with the connection (sshd), so nothing is left behind on the server.
    'while kill -0 "$S" 2>/dev/null && kill -0 "$P" 2>/dev/null; do',
    '  if [ -r "$R/$S/stat" ]; then',
    '    read -r l 2>/dev/null < "$R/$S/stat"; set -- ${l##*) }',
    '    C=$(readlink "$R/$6/cwd" 2>/dev/null || readlink "$R/$S/cwd" 2>/dev/null)',
    '  else',
    '    C=$(lsof -a -d cwd -p "$S" -Fn 2>/dev/null | sed -n "s/^n//p")',
    '  fi',
    '  case "$C" in (*" (deleted)") C=;; esac',
    '  if [ -n "$C" ] && [ "$C" != "$L" ]; then printf "@@cwd %s\\n" "$C"; L=$C; fi',
    '  sleep 1',
    'done'
  ].join('\n')
  return `exec sh -c '${body}'`
}

/** Pulls complete `@@cwd <dir>` lines out of a stream; absolute paths only. */
export class CwdLines {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = (lines.pop() ?? '').slice(-8192)
    return lines.filter((l) => l.startsWith('@@cwd /')).map((l) => l.slice('@@cwd '.length))
  }
}

/** Follows the working directory of a tab's remote shell over a separate exec channel. */
export class CwdFollower {
  private channel: ClientChannel | null = null
  private stopped = false

  constructor(
    private readonly client: Client,
    private readonly emit: (dir: string) => void
  ) {}

  start(): void {
    const lines = new CwdLines()
    this.client.exec(cwdFollowCommand(), (err, channel) => {
      if (err || this.stopped) {
        channel?.close()
        return
      }
      this.channel = channel
      channel.on('data', (chunk: Buffer) => {
        for (const dir of lines.push(chunk.toString('utf8'))) this.emit(dir)
      })
      channel.stderr.on('data', () => undefined)
      channel.on('close', () => (this.channel = null))
    })
  }

  stop(): void {
    this.stopped = true
    this.channel?.close()
    this.channel = null
  }
}
