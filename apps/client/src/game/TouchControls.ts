/**
 * Touch-Steuerung: Joystick links unten (Bewegung) + Schuss-Button rechts unten.
 * - Pointer Events mit setPointerCapture: Joystick und Button laufen parallel (Multitouch).
 * - Der Joystick ist analog; Deadzone 12 %, Laenge wird auf 1 begrenzt (Server clampt ebenfalls).
 * - Zielen: Auto-Aim auf den naechsten Gegner (main.ts). Wer den Schuss-Button zieht (> 26 px),
 *   zielt manuell in Zugrichtung (Twin-Stick); beim Loslassen gilt wieder Auto-Aim.
 * Rein clientseitig: der Server sieht weiterhin nur dx/dy/aim/fire (gleiche Validierung wie Maus/Tastatur).
 */
const DEADZONE = 0.12
const AIM_DRAG_PX = 26

export class TouchControls {
  /** Aktueller Bewegungsvektor (Laenge 0..1, y nach unten). */
  move = { dx: 0, dy: 0 }
  /** true, solange der Joystick gehalten wird. */
  moving = false
  firing = false
  /** Manuelles Ziel (rad), solange der Schuss-Button gezogen wird; sonst null. */
  aimOverride: number | null = null
  /** Letzte Bewegungsrichtung (rad): Ziel, wenn kein Gegner in Reichweite ist. */
  facing = 0

  private stickId: number | null = null
  private fireId: number | null = null

  constructor(
    private stickZone: HTMLElement,
    private knob: HTMLElement,
    private fireZone: HTMLElement,
    private fireBtn: HTMLElement,
  ) {
    this.bindStick()
    this.bindFire()
    // Fokusverlust / Tab-Wechsel: nichts haengen lassen.
    addEventListener('blur', () => this.reset())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset()
    })
  }

  reset(): void {
    this.releaseStick()
    this.releaseFire()
  }

  private bindStick(): void {
    const zone = this.stickZone
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
      const mag = Math.min(1, len)
      // Knopf zeigt die volle Auslenkung (visuelles Feedback), Bewegung nutzt die Deadzone.
      this.knob.style.transform = `translate(${x * radius * 0.5}px, ${y * radius * 0.5}px)`
      if (mag < DEADZONE) {
        this.move = { dx: 0, dy: 0 }
        this.moving = false
        return
      }
      const scaled = (mag - DEADZONE) / (1 - DEADZONE)
      const nx = x / Math.max(mag, 1e-6)
      const ny = y / Math.max(mag, 1e-6)
      this.move = { dx: nx * scaled, dy: ny * scaled }
      this.moving = true
      this.facing = Math.atan2(ny, nx)
    }
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return
      e.preventDefault()
      this.stickId = e.pointerId
      zone.setPointerCapture(e.pointerId)
      zone.classList.add('active')
      update(e)
    })
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) update(e)
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.stickId) this.releaseStick()
    }
    zone.addEventListener('pointerup', end)
    zone.addEventListener('pointercancel', end)
    zone.addEventListener('lostpointercapture', end)
  }

  private releaseStick(): void {
    this.stickId = null
    this.move = { dx: 0, dy: 0 }
    this.moving = false
    this.knob.style.transform = ''
    this.stickZone.classList.remove('active')
  }

  private bindFire(): void {
    const zone = this.fireZone
    const aimFrom = (e: PointerEvent) => {
      const r = this.fireBtn.getBoundingClientRect()
      const dx = e.clientX - (r.left + r.width / 2)
      const dy = e.clientY - (r.top + r.height / 2)
      if (Math.hypot(dx, dy) > AIM_DRAG_PX) {
        this.aimOverride = Math.atan2(dy, dx)
        this.fireBtn.classList.add('aiming')
      } else {
        this.aimOverride = null
        this.fireBtn.classList.remove('aiming')
      }
    }
    zone.addEventListener('pointerdown', (e) => {
      if (this.fireId !== null) return
      e.preventDefault()
      this.fireId = e.pointerId
      zone.setPointerCapture(e.pointerId)
      this.firing = true
      zone.classList.add('active')
      navigator.vibrate?.(8)
      aimFrom(e)
    })
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.fireId) aimFrom(e)
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.fireId) this.releaseFire()
    }
    zone.addEventListener('pointerup', end)
    zone.addEventListener('pointercancel', end)
    zone.addEventListener('lostpointercapture', end)
  }

  private releaseFire(): void {
    this.fireId = null
    this.firing = false
    this.aimOverride = null
    this.fireZone.classList.remove('active')
    this.fireBtn.classList.remove('aiming')
  }
}
