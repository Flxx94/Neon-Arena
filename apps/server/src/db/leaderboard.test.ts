import { describe, expect, it } from 'vitest'
import { buildBoard, kdOf, parseSort, type StatRow } from './leaderboard.js'

const rows: StatRow[] = [
  { nickname: 'Alpha', kills: 50, deaths: 40, matches: 10, wins: 2 },
  { nickname: 'Bravo', kills: 20, deaths: 2, matches: 3, wins: 3 },
  { nickname: 'Charlie', kills: 30, deaths: 0, matches: 12, wins: 0 },
  { nickname: 'Delta', kills: 5, deaths: 90, matches: 30, wins: 1 },
]
const order = (sort: Parameters<typeof buildBoard>[1]) => buildBoard(rows, sort).map((r) => r.nickname)

describe('Leaderboard-Sortierung', () => {
  it('nach Kills, K/D, Deaths, Matches und Siegen', () => {
    expect(order('kills')).toEqual(['Alpha', 'Charlie', 'Bravo', 'Delta'])
    expect(order('kd')).toEqual(['Charlie', 'Bravo', 'Alpha', 'Delta'])
    expect(order('deaths')).toEqual(['Delta', 'Alpha', 'Bravo', 'Charlie'])
    expect(order('matches')).toEqual(['Delta', 'Charlie', 'Alpha', 'Bravo'])
    expect(order('wins')).toEqual(['Bravo', 'Alpha', 'Delta', 'Charlie'])
  })

  it('K/D: durch max(1, Deaths), gerundet; Raenge ab 1; nur oeffentliche Felder', () => {
    expect(kdOf(30, 0)).toBe(30)
    expect(kdOf(5, 3)).toBe(1.67)
    const b = buildBoard(rows, 'kills')
    expect(b.map((r) => r.rank)).toEqual([1, 2, 3, 4])
    expect(Object.keys(b[0]!).sort()).toEqual(['deaths', 'kd', 'kills', 'matches', 'nickname', 'rank', 'wins'])
  })

  it('Gleichstand: mehr Kills, dann Name; Limit; unbekannter Sort -> kills', () => {
    const tie = buildBoard(
      [
        { nickname: 'B', kills: 1, deaths: 1, matches: 1, wins: 0 },
        { nickname: 'A', kills: 1, deaths: 1, matches: 1, wins: 0 },
        { nickname: 'C', kills: 9, deaths: 1, matches: 1, wins: 0 },
      ],
      'matches',
      2,
    )
    expect(tie.map((r) => r.nickname)).toEqual(['C', 'A'])
    expect(parseSort('hacker')).toBe('kills')
    expect(parseSort(undefined)).toBe('kills')
    expect(parseSort('kd')).toBe('kd')
  })
})
