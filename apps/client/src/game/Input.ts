/** Tastatur (WASD) + Maus (Aim, Feuer). */
export class Input {
  private keys = new Set<string>()
  mouseX = 0
  mouseY = 0
  firing = false

  constructor() {
    addEventListener('keydown', (e) => this.keys.add(e.code))
    addEventListener('keyup', (e) => this.keys.delete(e.code))
    addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX
      this.mouseY = e.clientY
    })
    addEventListener('mousedown', (e) => {
      if (e.button === 0) this.firing = true
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
