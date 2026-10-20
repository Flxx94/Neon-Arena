export const SORT_KEYS = ['kills', 'kd', 'deaths', 'matches', 'wins'] as const
export type SortKey = (typeof SORT_KEYS)[number]

export interface StatRow {
  nickname: string
  kills: number
  deaths: number
  matches: number
  wins: number
}

/** Oeffentliche Zeile: nur Anzeigename + Zahlen (keine ID, keine IP). */
export interface BoardRow extends StatRow {
  rank: number
  kd: number
}

export function parseSort(v: unknown): SortKey {
  return (SORT_KEYS as readonly string[]).includes(v as string) ? (v as SortKey) : 'kills'
}

/** K/D = Kills / max(1, Deaths), 2 Nachkommastellen. */
export function kdOf(kills: number, deaths: number): number {
  return Math.round((kills / Math.max(1, deaths)) * 100) / 100
}

/** Absteigend nach `sort`; Gleichstand: mehr Kills, dann mehr Matches, dann Name. Top `limit`. */
export function buildBoard(rows: StatRow[], sort: SortKey, limit = 100): BoardRow[] {
  const withKd = rows.map((r) => ({ ...r, kd: kdOf(r.kills, r.deaths) }))
  withKd.sort(
    (a, b) =>
      b[sort] - a[sort] || b.kills - a.kills || b.matches - a.matches || a.nickname.localeCompare(b.nickname),
  )
  return withKd.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r }))
}
