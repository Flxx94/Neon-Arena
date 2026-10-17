import { MAPS, MODEL_COUNT, MODEL_NAMES, ULT_MAX, skinModel } from '@neon-arena/shared'
import type { ClientPlayer } from '../net/client.js'
import type { NetClient } from '../net/client.js'

/**
 * Admin-Panel (Strg+Umschalt+A oder #admin in der URL). Die Berechtigung prueft ausschliesslich der
 * Server per ADMIN_TOKEN (nie im Client-Bundle); ohne Token auf dem Server tut das Panel nichts.
 * Alle Texte werden per textContent gesetzt (Spielernamen sind fremde Eingaben).
 */
export interface AdminDeps {
  net: NetClient
  players: () => ClientPlayer[]
  ownId: () => string | null
  connected: () => boolean
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export function initAdmin(deps: AdminDeps): { toggle: () => void } {
  const { net } = deps
  const root = el('aside', 'admin card ui')
  root.hidden = true
  root.setAttribute('aria-label', 'Admin-Panel')

  const head = el('header')
  head.append(el('h2', undefined, 'Admin'))
  const close = el('button', 'icon-btn small', '×')
  close.type = 'button'
  close.setAttribute('aria-label', 'Schließen')
  head.append(close)

  const login = el('div', 'admin-login')
  const token = el('input')
  token.type = 'password'
  token.placeholder = 'Admin-Token'
  token.autocomplete = 'off'
  const loginBtn = el('button', 'btn small', 'Anmelden')
  loginBtn.type = 'button'
  const status = el('p', 'admin-status', 'Nur im laufenden Match.')
  login.append(token, loginBtn, status)

  const body = el('div', 'admin-body')
  body.hidden = true

  // Runde
  const round = el('section', 'admin-round')
  const amount = el('input')
  amount.type = 'number'
  amount.value = '100'
  amount.step = '50'
  amount.title = 'Betrag für +/− Buttons'
  const amountRow = el('label', 'admin-amount', 'Betrag ')
  amountRow.append(amount)
  const mkBtn = (label: string, fn: () => void, cls = 'btn small'): HTMLButtonElement => {
    const b = el('button', cls, label)
    b.type = 'button'
    b.addEventListener('click', fn)
    return b
  }
  const mapSel = el('select')
  for (const m of MAPS) mapSel.append(new Option(m.name, String(m.id)))
  round.append(
    amountRow,
    mkBtn('Neustart', () => net.adminRound({ op: 'restart' })),
    mkBtn('Runde beenden', () => net.adminRound({ op: 'end' })),
    mkBtn('+30 s', () => net.adminRound({ op: 'time', value: 30 })),
    mkBtn('−30 s', () => net.adminRound({ op: 'time', value: -30 })),
    mapSel,
    mkBtn('Karte starten', () => net.adminRound({ op: 'map', value: Number(mapSel.value) })),
  )

  const list = el('div', 'admin-list')
  body.append(round, list)
  root.append(head, login, body)
  document.body.append(root)

  const amt = (): number => {
    const v = Number(amount.value)
    return Number.isFinite(v) ? Math.max(0, Math.min(100000, v)) : 0
  }

  let authed = false
  net.onAdminAuth = (ok) => {
    authed = ok
    status.textContent = ok ? 'Angemeldet.' : 'Token falsch oder Admin nicht aktiviert.'
    login.hidden = ok
    body.hidden = !ok
    if (ok) token.value = ''
  }
  const doLogin = (): void => {
    if (!deps.connected()) {
      status.textContent = 'Erst einem Match beitreten.'
      return
    }
    status.textContent = 'Prüfe …'
    net.adminAuth(token.value)
  }
  loginBtn.addEventListener('click', doLogin)
  token.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin()
  })

  interface Row {
    stats: HTMLElement
  }
  const rows = new Map<string, Row>()
  let sig = ''

  function rebuild(players: ClientPlayer[]): void {
    list.replaceChildren()
    rows.clear()
    for (const p of players) {
      const card = el('div', 'admin-player')
      const title = el('div', 'admin-title')
      const cls = { name: MODEL_NAMES[skinModel(p.skin) % MODEL_COUNT] ?? '' }
      title.append(el('b', undefined, p.nickname), el('span', 'admin-tag', p.isBot ? `BOT · ${cls?.name ?? ''}` : (cls?.name ?? '')))
      const stats = el('div', 'admin-stats')
      const act = el('div', 'admin-actions')
      const t = p.id
      const A = (label: string, fn: () => void, title2?: string): void => {
        const b = mkBtn(label, fn, 'btn tiny')
        if (title2) b.title = title2
        act.append(b)
      }
      A('Ult −', () => net.adminPlayer({ action: 'ult', target: t, mode: 'add', value: -amt() * 10 }), 'Betrag × 10 (Ult 0..1000)')
      A('Ult +', () => net.adminPlayer({ action: 'ult', target: t, mode: 'add', value: amt() * 10 }), 'Betrag × 10 (Ult 0..1000)')
      A('Ult MAX', () => net.adminPlayer({ action: 'ult', target: t, mode: 'set', value: ULT_MAX }))
      A('Ult 0', () => net.adminPlayer({ action: 'ult', target: t, mode: 'set', value: 0 }))
      A('Punkte −', () => net.adminPlayer({ action: 'score', target: t, mode: 'add', value: -amt() }))
      A('Punkte +', () => net.adminPlayer({ action: 'score', target: t, mode: 'add', value: amt() }))
      A('Punkte 0', () => net.adminPlayer({ action: 'score', target: t, mode: 'set', value: 0 }))
      A('HP voll', () => net.adminPlayer({ action: 'hp', target: t, mode: 'set', value: 100000 }))
      A('Schild', () => net.adminPlayer({ action: 'shield', target: t, mode: 'set', value: 100000 }))
      A('Kill', () => net.adminPlayer({ action: 'kill', target: t }))
      A('Revive', () => net.adminPlayer({ action: 'revive', target: t }))
      const kick = mkBtn('Kick', () => {
        if (confirm(`${p.nickname} wirklich kicken?`)) net.adminPlayer({ action: 'kick', target: t })
      }, 'btn tiny danger')
      act.append(kick)
      card.append(title, stats, act)
      list.append(card)
      rows.set(p.id, { stats })
    }
  }

  function refresh(): void {
    if (root.hidden || !authed) return
    const players = [...deps.players()].sort((a, b) => b.score - a.score)
    const nextSig = players.map((p) => `${p.id}:${p.nickname}:${p.skin}:${p.isBot}`).join('|')
    if (nextSig !== sig) {
      sig = nextSig
      rebuild(players)
    }
    for (const p of players) {
      const r = rows.get(p.id)
      if (!r) continue
      r.stats.textContent = `${p.alive ? `HP ${Math.round(p.hp)}` : 'tot'} · Schild ${Math.round(p.shield)} · Ult ${Math.round(p.ult / 10)} % · Punkte ${p.score} · K/D ${p.kills}/${p.deaths}${p.id === deps.ownId() ? ' · (du)' : ''}`
    }
  }
  setInterval(refresh, 250)

  const toggle = (): void => {
    root.hidden = !root.hidden
    if (!root.hidden) {
      sig = ''
      if (!authed) token.focus()
      refresh()
    }
  }
  close.addEventListener('click', () => (root.hidden = true))
  addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') {
      e.preventDefault()
      toggle()
    }
  })
  if (location.hash === '#admin') toggle()
  return { toggle }
}
