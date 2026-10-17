/**
 * Ult-Joystick (Touch/Maus) + Q-Taste (Tastatur).
 *  - Tippen (Druecken + Loslassen ohne Ziehen) loest sofort mit der aktuellen Zielrichtung aus.
 *  - Ziehen blendet das Pre-Aim ein (Richtung + Entfernung aus dem Zug); Loslassen loest aus.
 *    Zurueck in die Mitte ziehen und loslassen bricht ab.
 *  - Q: halten = Pre-Aim zur Maus, loslassen = ausloesen (kurzes Tippen = sofort zur Maus), Esc bricht ab.
 * Die Steuerung kennt keine Spielregeln: `ready()` sagt, ob die Ult bereit ist; der Server prueft ohnehin alles.
 */
export interface UltRelease {
  /** Zielrichtung in rad. */
  ua: number
  /** Zielentfernung 0..1 (Anteil der Ult-Reichweite). */
  ud: number
}

interface Options {
  ready: () => boolean
  /** Aktuelle Zielrichtung (Maus/Ziel-Stick), fuer Antippen. */
  defaultAim: () => number
  /** Maus relativ zum eigenen Spieler: Richtung + Entfernung 0..1 (fuer Q-Zielen). */
  mouseAim: () => { angle: number; dist: number }
}

/** Pixel Auslenkung, ab denen gezogen (statt getippt) wird. */
const DEADZONE = 16
/** Pixel Auslenkung fuer volle Entfernung. */
const FULL_DRAG = 96

export class UltControl {
  /** Pre-Aim sichtbar (gezogen oder Q gehalten). */
  aiming = false
  angle = 0
  dist = 0.6
  private pending: UltRelease | null = null
  private pointerId: number | null = null
  private dragged = false
  private qHeld = false

  constructor(
    private el: HTMLElement,
    private knob: HTMLElement,
    private opts: Options,
  ) {
    el.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null || !this.opts.ready()) return
      e.preventDefault()
      this.pointerId = e.pointerId
      this.dragged = false
      el.setPointerCapture(e.pointerId)
      this.move(e)
    })
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointerId) this.move(e)
    })
    el.addEventListener('pointerup', (e) => {
      if (e.pointerId !== this.pointerId) return
      const r = el.getBoundingClientRect()
      const len = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2))
      if (!this.dragged) this.pending = { ua: this.opts.defaultAim(), ud: 0.6 }
      else if (len > DEADZONE) this.pending = { ua: this.angle, ud: this.dist }
      this.endPointer()
    })
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === this.pointerId) this.endPointer()
    }
    el.addEventListener('pointercancel', cancel)
    el.addEventListener('lostpointercapture', cancel)

    addEventListener('keydown', (e) => {
      if ((e.target as Element | null)?.closest?.('input, textarea')) return
      if (e.code === 'KeyQ' && !e.repeat && !this.qHeld && this.opts.ready()) {
        this.qHeld = true
        this.update()
      } else if (e.code === 'Escape') this.cancel()
    })
    addEventListener('keyup', (e) => {
      if (e.code !== 'KeyQ' || !this.qHeld) return
      this.update()
      this.pending = { ua: this.angle, ud: this.dist }
      this.cancel()
    })
    addEventListener('blur', () => this.cancel())
  }

  private move(e: PointerEvent): void {
    const r = this.el.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    const len = Math.hypot(dx, dy)
    const k = len > 34 ? 34 / len : 1 // Knopf bleibt im Button
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`
    if (len > DEADZONE) {
      this.dragged = true
      this.aiming = true
      this.angle = Math.atan2(dy, dx)
      this.dist = Math.min(1, Math.max(0.15, (len - DEADZONE) / (FULL_DRAG - DEADZONE)))
    } else {
      this.aiming = false
    }
  }

  /** Pro Frame: Q-Zielen folgt der Maus. */
  update(): void {
    if (!this.qHeld) return
    const m = this.opts.mouseAim()
    this.angle = m.angle
    this.dist = Math.max(0.15, m.dist)
    this.aiming = true
  }

  /** Ausloese-Wunsch (einmalig) abholen. */
  take(): UltRelease | null {
    const v = this.pending
    this.pending = null
    return v
  }

  cancel(): void {
    this.qHeld = false
    this.endPointer()
  }

  private endPointer(): void {
    this.pointerId = null
    this.dragged = false
    this.aiming = this.qHeld
    this.knob.style.transform = ''
  }
}
