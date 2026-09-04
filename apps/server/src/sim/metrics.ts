/** Sim-Timing: Tick-Dauern als Ring-Buffer, p95 fuer /metrics (M2-01). */
const MAX_SAMPLES = 300
const samples: number[] = []

export function recordTick(ms: number): void {
  samples.push(ms)
  if (samples.length > MAX_SAMPLES) samples.shift()
}

export function tickMsP95(): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
  return sorted[idx] ?? 0
}
