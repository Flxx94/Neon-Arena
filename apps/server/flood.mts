const { Client } = await import('colyseus.js')

const PORT = Number(process.env.FLOOD_PORT ?? 2567)
const BOTS = Number(process.env.FLOOD_BOTS ?? 50)

async function guest(nickname: string) {
  const res = await fetch(`http://127.0.0.1:${PORT}/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  })
  if (!res.ok) throw new Error(`guest ${nickname}: ${res.status}`)
  return (await res.json()) as { userId: string; nickname: string }
}

const rooms = []
let joinErrors = 0
let nextJoinAt = Date.now()
let joined = 0
// 10-Min-Fenster: alle ~12 s ein Join (Join-Limit 5/min), alle Verbundenen spielen.
// Danach +2 Min Steady-State mit allen 50.
const WINDOW_MS = 10 * 60_000
const STEADY_MS = 2 * 60_000
const t0 = Date.now()
let seq = 0
let sendErrors = 0
const samples: { t: number; v: number }[] = []
while (Date.now() - t0 < WINDOW_MS + STEADY_MS) {
  const now = Date.now()
  const inWindow = now - t0 < WINDOW_MS
  if (inWindow && joined < BOTS && now >= nextJoinAt) {
    try {
      const g = await guest(`Flood${joined}`)
      const client = new Client(`ws://127.0.0.1:${PORT}`)
      rooms.push(
        await client.joinOrCreate('arena', { nickname: g.nickname, protocolV: 1, userId: g.userId }),
      )
    } catch (err) {
      joinErrors++
      console.log(`join ${joined} failed:`, String(err).slice(0, 120))
    }
    joined++
    nextJoinAt = now + 12_000
    if (joined % 10 === 0) console.log(`joined ${joined}/${BOTS}, aktiv: ${rooms.length}`)
  }
  const loopStart = Date.now()
  for (const r of rooms) {
    try {
      r.send('input', {
        kind: 'input',
        seq: seq++,
        dx: Math.random() * 2 - 1,
        dy: Math.random() * 2 - 1,
        aim: Math.random() * Math.PI * 2 - Math.PI,
        fire: Math.random() < 0.5,
      })
    } catch {
      sendErrors++
    }
  }
  try {
    const m = (await fetch(`http://127.0.0.1:${PORT}/metrics`).then((r) => r.json())) as { tickMsP95: number }
    samples.push({ t: Date.now(), v: m.tickMsP95 })
  } catch {
    /* ignore */
  }
  const elapsed = Date.now() - loopStart
  await new Promise((r) => setTimeout(r, Math.max(0, 100 - elapsed)))
}
console.log(`joined ${rooms.length}/${BOTS} (errors: ${joinErrors})`)

function p95(vals: number[]): number {
  if (vals.length === 0) return -1
  const s = [...vals].sort((a, b) => a - b)
  return s[Math.floor(s.length * 0.95)] ?? -1
}
const steadySince = t0 + WINDOW_MS
const steady = samples.filter((s) => s.t >= steadySince).map((s) => s.v)
const max = Math.max(...samples.map((s) => s.v))
console.log(`RESULT bots=${rooms.length} joinErrors=${joinErrors} sendErrors=${sendErrors} samples=${samples.length}`)
console.log(`RESULT tickMsP95(all)=${p95(samples.map((s) => s.v))} tickMsP95(steady50)=${p95(steady)} max=${max}`)

for (const r of rooms) {
  try {
    await r.leave()
  } catch {
    /* ignore */
  }
}
