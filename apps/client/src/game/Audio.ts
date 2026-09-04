/** Synthetisierte Soundeffekte via WebAudio (M2-07): keine Assets, schaltbar. */
export class SoundFX {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  muted = false

  /** Muss aus User-Geste aufgerufen werden (Autoplay-Policy). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.25
    this.master.connect(this.ctx.destination)
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master && this.ctx) {
      this.master.gain.setValueAtTime(this.muted ? 0 : 0.25, this.ctx.currentTime)
    }
    return this.muted
  }

  shoot(): void {
    this.blip(880, 220, 0.08, 'square')
  }

  hit(): void {
    this.blip(200, 120, 0.1, 'sawtooth')
  }

  death(): void {
    this.blip(400, 60, 0.4, 'sawtooth')
  }

  private blip(from: number, to: number, seconds: number, type: OscillatorType): void {
    if (!this.ctx || !this.master || this.muted) return
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(from, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + seconds)
    osc.connect(this.master)
    osc.start(t)
    osc.stop(t + seconds)
  }
}
