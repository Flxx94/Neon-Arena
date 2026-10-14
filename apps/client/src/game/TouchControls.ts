/**
 * Touch-Steuerung: zwei analoge Sticks (Twin-Stick), Multitouch ueber Pointer Events + setPointerCapture.
 * - Links: Bewegung. Deadzone 12 %, Laenge wird auf 1 begrenzt (Server clampt ebenfalls).
 * - Rechts: Zielen + automatisches Schiessen. Sobald der Stick ueber die Schwelle gezogen ist (35 %),
 *   zeigt die Figur in Zugrichtung und feuert dauerhaft; beim Loslassen oder Zurueckziehen in die
 *   Mitte stoppt der Schuss. Die zuletzt gezielte Richtung bleibt erhalten. Kein Auto-Aim.
 * Rein clientseitig: der Server sieht weiterhin nur dx/dy/aim/fire (gleiche Validierung wie Maus/Tastatur).
 */
const MOVE_DEADZONE = 0.12
/** Ab dieser Auslenkung (0..1) wird gezielt und geschossen. */
const FIRE_THRESHOLD = 0.35
/** Hysterese: unter diesem Wert hoert der Dauerfeuer-Modus wieder auf. */
const FIRE_RELEASE = 0.28

interface StickState {
  id: number | null
  x: number
  y: number
  mag: number
}

export class TouchControls {
  /** Aktueller Bewegungsvektor (Laenge 0..1, y nach unten). */
  move = { dx: 0, dy: 0 }
  /** true, solange der Bewegungs-Stick ausgelenkt ist. */
  moving = false
  /** true, solange der Ziel-Stick ueber der Schwelle gehalten wird. */
  firing = false
  /** Letzte Zielrichtung (rad) des Ziel-Sticks; null, solange noch nie gezielt wurde. */
  aimAngle: number | null = null
  /** Letzte Bewegungsrichtung (rad): Blickrichtung, solange noch nie gezielt wurde. */
  facing = 0

  private moveStick: StickState = { id: null, x: 0, y: 0, mag: 0 }
  private aimStick: StickState = { id: null, x: 0, y: 0, mag: 0 }

  constructor(
    private moveZone: HTMLElement,
    private moveKnob: HTMLElement,
    private aimZone: HTMLElement,
    private aimKnob: HTMLElement,
  ) {
    this.bind(moveZone, moveKnob, this.moveStick, () => this.onMove(), () => this.releaseMove())
    this.bind(aimZone, aimKnob, this.aimStick, () => this.onAim(), () => this.releaseAim())
    // Fokusverlust / Tab-Wechsel: nichts haengen lassen.
    addEventListener('blur', () => this.reset())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset()
    })
  }

  reset(): void {
    this.releaseMove()
    this.releaseAim()
  }

  private bind(
    zone: HTMLElement,
    knob: HTMLElement,
    st: StickState,
    onChange: () => void,
    onRelease: () => void,
  ): void {
    const update = (e: PointerEvent) => {
      const r = zone.getBoundingClientRect()
      const radius = r.width / 2
      let x = (e.clientX - (r.left + radius)) / radius
      let y = (e.clientY - (r.top + radius)) / radius
      const len = Math.hypot(x, y)
      if (len > 1) {
        x /= len
        y /= len
      }
      st.x = x
      st.y = y
      st.mag = Math.min(1, len)
      // Knopf zeigt die volle Auslenkung (visuelles Feedback).
      knob.style.transform = `translate(${x * radius * 0.5}px, ${y * radius * 0.5}px)`
      onChange()
    }
    zone.addEventListener('pointerdown', (e) => {
      if (st.id !== null) return
      e.preventDefault()
      st.id = e.pointerId
      zone.setPointerCapture(e.pointerId)
      zone.classList.add('active')
      update(e)
    })
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === st.id) update(e)
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId === st.id) onRelease()
    }
    zone.addEventListener('pointerup', end)
    zone.addEventListener('pointercancel', end)
    zone.addEventListener('lostpointercapture', end)
  }

  private onMove(): void {
    const { x, y, mag } = this.moveStick
    if (mag < MOVE_DEADZONE) {
      this.move = { dx: 0, dy: 0 }
      this.moving = false
      return
    }
    const scaled = (mag - MOVE_DEADZONE) / (1 - MOVE_DEADZONE)
    const nx = x / Math.max(mag, 1e-6)
    const ny = y / Math.max(mag, 1e-6)
    this.move = { dx: nx * scaled, dy: ny * scaled }
    this.moving = true
    this.facing = Math.atan2(ny, nx)
  }

  private onAim(): void {
    const { x, y, mag } = this.aimStick
    const threshold = this.firing ? FIRE_RELEASE : FIRE_THRESHOLD
    if (mag >= threshold) {
      this.aimAngle = Math.atan2(y, x)
      this.firing = true
      if (!this.aimZone.classList.contains('firing')) navigator.vibrate?.(8)
    } else {
      this.firing = false
    }
    this.aimZone.classList.toggle('firing', this.firing)
  }

  private releaseMove(): void {
    this.moveStick.id = null
    this.moveStick.mag = 0
    this.move = { dx: 0, dy: 0 }
    this.moving = false
    this.moveKnob.style.transform = ''
    this.moveZone.classList.remove('active')
  }

  private releaseAim(): void {
    this.aimStick.id = null
    this.aimStick.mag = 0
    this.firing = false
    this.aimKnob.style.transform = ''
    this.aimZone.classList.remove('active', 'firing')
  }
}
