const LINUX_PROBE = [
  'echo @@stat; head -n 1 /proc/stat 2>/dev/null',
  'echo @@nproc; (nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null)',
  'echo @@os; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")',
  'echo @@loadavg; cat /proc/loadavg 2>/dev/null',
  'echo @@uptime; cat /proc/uptime 2>/dev/null',
  'echo @@meminfo; grep -E "^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):" /proc/meminfo 2>/dev/null',
  'echo @@net; tail -n +3 /proc/net/dev 2>/dev/null',
  'echo @@ps; ps -eo pid=,pcpu=,pmem=,comm= --sort=-pcpu 2>/dev/null | head -n 8'
]

const DARWIN_PROBE = [
  'echo @@cpupct; top -l 2 -n 0 -s 1 2>/dev/null | grep "CPU usage" | tail -n 1',
  'echo @@nproc; sysctl -n hw.ncpu',
  'echo @@os; echo "$(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null)"',
  'echo @@loadavg; sysctl -n vm.loadavg',
  'echo @@uptime; echo $(( $(date +%s) - $(sysctl -n kern.boottime | sed "s/[^0-9]*\\([0-9]*\\).*/\\1/") ))',
  'echo @@memsize; sysctl -n hw.memsize',
  'echo @@vmstat; vm_stat',
  'echo @@swap; sysctl -n vm.swapusage',
  'echo @@netstat; netstat -ib 2>/dev/null',
  'echo @@ps; ps -Aceo pid=,pcpu=,pmem=,comm= -r 2>/dev/null | head -n 8'
]

/**
 * POSIX shell loop that prints a marker-delimited stats block every `intervalSec` seconds.
 * Linux reads /proc; macOS hosts use sysctl/vm_stat/netstat. Wrapped in `exec sh -c '…'`
 * so it works regardless of the login shell (bash, zsh, fish). The body must not contain single quotes.
 */
export function remoteMonitorCommand(intervalSec: number): string {
  const interval = Math.max(1, Math.min(60, Math.floor(intervalSec)))
  const body = [
    'export LC_ALL=C',
    'OS=$(uname -s)',
    'while :; do',
    'echo @@XMT_BEGIN',
    'echo @@uname; uname -snrm 2>/dev/null',
    'if [ "$OS" = Darwin ]; then',
    ...DARWIN_PROBE,
    'else',
    ...LINUX_PROBE,
    'fi',
    'echo @@df; df -kP 2>/dev/null',
    'echo @@users; who 2>/dev/null | wc -l',
    'echo @@XMT_END',
    `sleep ${interval}`,
    'done'
  ].join('\n')
  return `exec sh -c '${body}'`
}
