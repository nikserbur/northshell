import { useId } from 'react'

interface SparklineProps {
  values: number[]
  max?: number
  height?: number
  color?: string
  second?: number[]
  secondColor?: string
}

const POINTS = 60

function toPath(values: number[], max: number, h: number): string {
  const padded = values.length >= POINTS ? values.slice(-POINTS) : [...Array(POINTS - values.length).fill(0), ...values]
  return padded
    .map((v, i) => {
      const x = (i / (POINTS - 1)) * 100
      const y = h - (Math.min(max, Math.max(0, v)) / max) * (h - 2) - 1
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

export function Sparkline({ values, max, height = 46, color = 'var(--accent)', second, secondColor = 'var(--violet)' }: SparklineProps) {
  const id = useId().replace(/:/g, '')
  const top = Math.max(1, max ?? Math.max(...values, ...(second ?? []), 1) * 1.15)
  const line = toPath(values, top, height)
  const line2 = second ? toPath(second, top, height) : null
  return (
    <svg className="spark" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L100,${height} L0,${height} Z`} fill={`url(#g${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {line2 && (
        <path d={line2} fill="none" stroke={secondColor} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeDasharray="3 2" />
      )}
    </svg>
  )
}
