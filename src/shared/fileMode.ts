/** "-rwxr-xr-x" → "755"; falls back to 644 for unparseable input. */
export function modeToOctal(mode: string): string {
  if (!/^.[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(mode)) return '644'
  let out = ''
  for (let group = 0; group < 3; group++) {
    const bits = mode.slice(1 + group * 3, 4 + group * 3)
    out += String((bits[0] === 'r' ? 4 : 0) + (bits[1] === 'w' ? 2 : 0) + (/[xst]/.test(bits[2]) ? 1 : 0))
  }
  return out
}

export function parseOctal(input: string): number | null {
  const v = input.trim()
  return /^[0-7]{3,4}$/.test(v) ? parseInt(v, 8) : null
}
