/** Tastatur (WASD) + Maus (Aim, Feuer). */
export class Input {
  private keys = new Set<string>()
  mouseX = 0
  mouseY = 0
  firing = false
  /** Zeitpunkt der letzten Beruehrung: emulierte Maus-Events nach einem Tap ignorieren. */
  private lastTouchAt = -10_000

  constructor() {
    addEventListener('touchstart', () => (this.lastTouchAt = performance.now()), { passive: true })
    addEventListener('keydown', (e) => {
      // Tippen in Formularfeldern (Login, Name) darf keine Bewegung ausloesen.
      if ((e.target as Element | null)?.closest?.('input, textarea')) return
      this.keys.add(e.code)
    })
    addEventListener('keyup', (e) => this.keys.delete(e.code))
    addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX
      this.mouseY = e.clientY
    })
    addEventListener('mousedown', (e) => {
      // Klicks auf UI (Buttons, Einstellungen, Formular) feuern nicht.
      const t = e.target as Element | null
      if (t?.closest?.('.ui, button, input, a')) return
      if (performance.now() - this.lastTouchAt < 800) return
      if (e.button === 0) this.firing = true
    })
    // Fokusverlust (Alt-Tab, Einstellungen): nichts haengen lassen.
    addEventListener('blur', () => {
      this.keys.clear()
      this.firing = false
    })
    addEventListener('contextmenu', (e) => {
      if (!(e.target as Element | null)?.closest?.('input, textarea')) e.preventDefault()
    })
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false
    })
  }

  readMove(): { dx: number; dy: number } {
    const dx = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)
    const dy = (this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0)
    if (dx !== 0 && dy !== 0) return { dx: dx / Math.SQRT2, dy: dy / Math.SQRT2 }
    return { dx, dy }
  }

  /** Test-Helfer: Tasten simulieren. */
  testSetKey(code: string, down: boolean): void {
    if (down) this.keys.add(code)
    else this.keys.delete(code)
  }
}
