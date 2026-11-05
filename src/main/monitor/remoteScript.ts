import { PHYSICAL_DISK_PATTERN } from './diskIo'

const LINUX_PROBE = [
  'echo @@stat; head -n 1 /proc/stat 2>/dev/null',
  'echo @@nproc; (nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null)',
  'echo @@os; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")',
  'echo @@loadavg; cat /proc/loadavg 2>/dev/null',
  'echo @@uptime; cat /proc/uptime 2>/dev/null',
  'echo @@meminfo; grep -E "^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):" /proc/meminfo 2>/dev/null',
  'echo @@net; tail -n +3 /proc/net/dev 2>/dev/null',
  `echo @@diskstats; grep -E " ${PHYSICAL_DISK_PATTERN} " /proc/diskstats 2>/dev/null`,
  'echo @@ps; ps -eo pid=,pcpu=,pmem=,comm= --sort=-pcpu 2>/dev/null | head -n 8',
  'echo @@nvsmi; [ -n "$NV" ] && $TO "$NV" --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits 2>/dev/null',
  // amdgpu exposes VRAM counters in sysfs; connector entries (card0-DP-1) are skipped.
  'echo @@amdgpu; for d in /sys/class/drm/card*/device; do case $d in *-*/device) continue;; esac; [ -r "$d/mem_info_vram_total" ] && echo "$(cat "$d/mem_info_vram_total" 2>/dev/null) $(cat "$d/mem_info_vram_used" 2>/dev/null || echo 0) $(cat "$d/gpu_busy_percent" 2>/dev/null || echo -)"; done'
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
  'echo @@diskio; ioreg -c IOBlockStorageDriver -r -w0 -k Statistics 2>/dev/null | grep Statistics',
  'echo @@ps; ps -Aceo pid=,pcpu=,pmem=,comm= -r 2>/dev/null | head -n 8',
  'echo @@gpu; ioreg -r -d 1 -w 0 -c IOAccelerator 2>/dev/null | grep -E "^[ |]*\\+-o|\\"(model|PerformanceStatistics)\\" ="',
  'echo @@gpulimit; sysctl -n iogpu.wired_limit_mb 2>/dev/null || echo $(( $(sysctl -n debug.iogpu.wired_limit 2>/dev/null || echo 0) / 1048576 ))'
]

/** The longest command line kept per process: Java classpaths alone can run to many kilobytes. */
const MAX_COMMAND = 500
const MAX_PROCESSES = 2000
const MAX_SOCKETS = 3000

/**
 * Reduces `ss -tinep` to `uid sk pid sent received`, one line per socket that carried traffic.
 * `ss` prints uid only when it is not 0; older kernels have bytes_acked but no bytes_sent.
 * Written for double quotes inside the sh -c wrapper, so $ and " are escaped.
 */
const SS_AWK = [
  '/^[A-Z]/ { u=0; k=\\"\\"; p=0; for (i=1;i<=NF;i++) { if (\\$i ~ /^uid:/) u=substr(\\$i,5); else if (\\$i ~ /^sk:/) k=substr(\\$i,4) }',
  'if (match(\\$0,/pid=[0-9]+/)) p=substr(\\$0,RSTART+4,RLENGTH-4); next }',
  'k!=\\"\\" { s=0; r=0; for (i=1;i<=NF;i++) { if (\\$i ~ /^bytes_sent:/) s=substr(\\$i,12); else if (\\$i ~ /^bytes_acked:/ && s==0) s=substr(\\$i,13); else if (\\$i ~ /^bytes_received:/) r=substr(\\$i,16) }',
  'if (s+r>0) print u, k, p, s, r; k=\\"\\" }'
].join(' ')

/**
 * Who is doing what, sent only while the monitor panel is open. Kernel threads (children of pid 2) and
 * this script itself stay out of the list; /proc/PID/io of other users can be read only by root.
 */
const LINUX_DETAIL = [
  'echo @@uid; id -u',
  'echo @@hz; echo "$HZ"',
  `echo @@pslist; ps -ww -eo pid=,ppid=,uid=,user:32=,pcpu=,pmem=,rss=,vsz=,nlwp=,ni=,stat=,etimes=,args= 2>/dev/null | awk "\\$1!=$$ && \\$1!=2 && \\$2!=2" | head -n ${MAX_PROCESSES} | cut -c1-${MAX_COMMAND}`,
  // pid utime stime: the fields between them are fixed, the name in parentheses may hold anything.
  'echo @@ticks; cat /proc/[0-9]*/stat 2>/dev/null | sed -n "s/^\\([0-9]*\\) (.*) . [-0-9]* [-0-9]* [-0-9]* [-0-9]* [-0-9]* [0-9]* [0-9]* [0-9]* [0-9]* [0-9]* \\([0-9]*\\) \\([0-9]*\\) .*/\\1 \\2 \\3/p"',
  'echo @@procio; grep -HE "^(read|write)_bytes:" /proc/[0-9]*/io 2>/dev/null | grep -v ": 0\\$"',
  `if command -v ss >/dev/null 2>&1; then echo @@tcp; ss -tinep 2>/dev/null | awk "${SS_AWK}" | head -n ${MAX_SOCKETS}; fi`
]

const DARWIN_DETAIL = [
  'echo @@uid; id -u',
  `echo @@pslistmac; ps -Aww -o pid=,ppid=,uid=,user=,pcpu=,pmem=,rss=,vsz=,nice=,stat=,etime=,args= 2>/dev/null | awk "\\$1!=$$" | head -n ${MAX_PROCESSES} | cut -c1-${MAX_COMMAND}`,
  'if command -v nettop >/dev/null 2>&1; then echo @@nettop; nettop -P -L 1 -x -J bytes_in,bytes_out 2>/dev/null | grep -v ",0,0,\\$"; fi'
]

/**
 * POSIX shell loop that prints a marker-delimited stats block every `intervalSec` seconds.
 * Linux reads /proc (plus nvidia-smi / amdgpu sysfs for video memory); macOS hosts use
 * sysctl/vm_stat/netstat/ioreg. A hung nvidia-smi is cut off by `timeout`. Wrapped in `exec sh -c '…'`
 * so it works regardless of the login shell (bash, zsh, fish). The body must not contain single quotes.
 * With `detail` it also lists every process and its counters, for the monitor panel.
 */
export function remoteMonitorCommand(intervalSec: number, detail = false): string {
  const interval = Math.max(1, Math.min(60, Math.floor(intervalSec)))
  const body = [
    'export LC_ALL=C',
    'OS=$(uname -s)',
    'NV=$(command -v nvidia-smi 2>/dev/null)',
    'TO=; command -v timeout >/dev/null 2>&1 && TO="timeout 5"',
    ...(detail ? ['HZ=$(getconf CLK_TCK 2>/dev/null || echo 100)'] : []),
    'while :; do',
    'echo @@XMT_BEGIN',
    'echo @@uname; uname -snrm 2>/dev/null',
    'if [ "$OS" = Darwin ]; then',
    ...DARWIN_PROBE,
    ...(detail ? DARWIN_DETAIL : []),
    'else',
    ...LINUX_PROBE,
    ...(detail ? LINUX_DETAIL : []),
    'fi',
    'echo @@df; df -kP 2>/dev/null',
    'echo @@users; who 2>/dev/null | cut -d" " -f1 | sort -u',
    'echo @@XMT_END',
    `sleep ${interval}`,
    'done'
  ].join('\n')
  return `exec sh -c '${body}'`
}
