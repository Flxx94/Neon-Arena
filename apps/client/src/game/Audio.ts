import { settings } from '../ui/settings.js'

/**
 * Synthetisierte Sound-Engine (WebAudio, keine Assets, ~0 KB):
 * - Busse: master -> (sfx | music) mit Kompressor, kleiner Hall fuer Explosionen/Jingles
 * - Rauschen + Filter fuer Schuesse/Einschlaege, FM-/Saw-Stimmen fuer Pickups/UI
 * - raeumlich: Pan + Lautstaerke nach Abstand zum eigenen Spieler
 * - generative Musik-Schleife (Bass + Arpeggio + Hi-Hat), 110 BPM, Tonart a-Moll Pentatonik
 */
type Wave = OscillatorType

interface Spatial {
  /** -1 (links) .. 1 (rechts) */
  pan: number
  /** 0..1 */
  gain: number
}

/** Klangfarbe des Schusses je Charakter (Index = Modell): Tonhoehe, Laenge, Wellenform, Lautstaerke. */
const SHOT_VOICES: readonly {
  pitch: number
  len: number
  wave: OscillatorType
  gain: number
}[] = [
  { pitch: 1, len: 1, wave: 'square', gain: 1 }, // Blobby: Blubb
  { pitch: 0.45, len: 1.8, wave: 'square', gain: 1.25 }, // Cuby: dumpfer Klotz
  { pitch: 1.5, len: 0.6, wave: 'sawtooth', gain: 0.9 }, // Zappy: Zap
  { pitch: 1.2, len: 1.5, wave: 'triangle', gain: 1.1 }, // Hexo: Sniper-Zisch
  { pitch: 0.7, len: 1.6, wave: 'sine', gain: 1.4 }, // Boo: Geisterhauch
  { pitch: 1.35, len: 0.8, wave: 'triangle', gain: 1.1 }, // Kitty: Kratzer
]

const A_MINOR_PENTA = [0, 3, 5, 7, 10]
const ROOT = 55 // A1

function noteHz(root: number, semis: number): number {
  return root * Math.pow(2, semis / 12)
}

export class SoundFX {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxBus: GainNode | null = null
  private musicBus: GainNode | null = null
  private reverbSend: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private musicTimer: number | null = null
  private musicStep = 0
  private nextStepAt = 0
  private musicOn = false
  private intensity = 0

  constructor() {
    settings.subscribe((_s, changed) => {
      if (changed.some((k) => k === 'sfx' || k === 'music' || k === 'muted')) this.applyVolumes()
    })
  }

  get muted(): boolean {
    return settings.get().muted
  }

  /** Muss aus einer User-Geste aufgerufen werden (Autoplay-Policy). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    this.ctx = ctx
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.ratio.value = 5
    comp.attack.value = 0.004
    comp.release.value = 0.2
    this.master = ctx.createGain()
    this.master.connect(comp)
    comp.connect(ctx.destination)
    this.sfxBus = ctx.createGain()
    this.sfxBus.connect(this.master)
    this.musicBus = ctx.createGain()
    this.musicBus.connect(this.master)

    // Mini-Hall: verrauschter, exponentiell abklingender Impuls (1.4 s)
    const conv = ctx.createConvolver()
    const len = Math.floor(ctx.sampleRate * 1.4)
    const imp = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = imp.getChannelData(c)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
    }
    conv.buffer = imp
    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0.55
    this.reverbSend.connect(conv)
    const wet = ctx.createGain()
    wet.gain.value = 0.5
    conv.connect(wet)
    wet.connect(this.master)

    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const nd = nb.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
    this.noiseBuf = nb

    this.applyVolumes()
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfxBus || !this.musicBus) return
    const s = settings.get()
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(s.muted ? 0 : 0.9, t, 0.03)
    this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.03)
    this.musicBus.gain.setTargetAtTime(s.music * 0.5, t, 0.03)
  }

  toggleMute(): boolean {
    settings.set({ muted: !settings.get().muted })
    return settings.get().muted
  }

  // --------------------------------------------------------------------------------------
  // Spatial helper: Gegner-Sounds links/rechts + leiser mit Abstand
  // --------------------------------------------------------------------------------------
  spatial(dx: number, dy: number): Spatial {
    const dist = Math.hypot(dx, dy)
    return {
      pan: Math.max(-1, Math.min(1, dx / 700)),
      gain: Math.max(0.12, 1 - dist / 1500),
    }
  }

  private out(sp?: Spatial): AudioNode | null {
    if (!this.ctx || !this.sfxBus) return null
    if (!sp) return this.sfxBus
    const g = this.ctx.createGain()
    g.gain.value = sp.gain
    const panner = this.ctx.createStereoPanner()
    panner.pan.value = sp.pan
    g.connect(panner)
    panner.connect(this.sfxBus)
    return g
  }

  private ready(): boolean {
    return !!this.ctx && !!this.sfxBus && !this.muted
  }

  // --------------------------------------------------------------------------------------
  // Primitive Stimmen
  // --------------------------------------------------------------------------------------
  private tone(opts: {
    from: number
    to?: number
    dur: number
    type?: Wave
    gain?: number
    at?: number
    dest?: AudioNode | null
    attack?: number
    reverb?: number
    detune?: number
  }): void {
    const ctx = this.ctx
    const dest = opts.dest ?? this.sfxBus
    if (!ctx || !dest) return
    const t = opts.at ?? ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = opts.type ?? 'sine'
    osc.frequency.setValueAtTime(opts.from, t)
    if (opts.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + opts.dur)
    }
    if (opts.detune) osc.detune.value = opts.detune
    const g = ctx.createGain()
    const peak = opts.gain ?? 0.3
    const atk = opts.attack ?? 0.004
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + atk)
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur)
    osc.connect(g)
    g.connect(dest)
    if (opts.reverb && this.reverbSend) {
      const s = ctx.createGain()
      s.gain.value = opts.reverb
      g.connect(s)
      s.connect(this.reverbSend)
    }
    osc.start(t)
    osc.stop(t + opts.dur + 0.05)
  }

  private noise(opts: {
    dur: number
    filter: BiquadFilterType
    from: number
    to?: number
    q?: number
    gain?: number
    at?: number
    dest?: AudioNode | null
    reverb?: number
  }): void {
    const ctx = this.ctx
    const dest = opts.dest ?? this.sfxBus
    if (!ctx || !dest || !this.noiseBuf) return
    const t = opts.at ?? ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = opts.filter
    f.Q.value = opts.q ?? 0.8
    f.frequency.setValueAtTime(opts.from, t)
    if (opts.to !== undefined)
      f.frequency.exponentialRampToValueAtTime(Math.max(30, opts.to), t + opts.dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(opts.gain ?? 0.3, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur)
    src.connect(f)
    f.connect(g)
    g.connect(dest)
    if (opts.reverb && this.reverbSend) {
      const s = ctx.createGain()
      s.gain.value = opts.reverb
      g.connect(s)
      s.connect(this.reverbSend)
    }
    src.start(t, Math.random() * 0.5)
    src.stop(t + opts.dur + 0.05)
  }

  // --------------------------------------------------------------------------------------
  // Spiel-Sounds
  // --------------------------------------------------------------------------------------
  /** Eigener Schuss: "pew" mit Knackpunkt (Pitch leicht variiert gegen Ermuedung). */
  shoot(sp?: Spatial, own = true, kind = 0): void {
    if (!this.ready()) return
    const dest = this.out(sp)
    const r = 0.92 + Math.random() * 0.16
    const vol = own ? 1 : 0.7
    const v = SHOT_VOICES[kind] ?? SHOT_VOICES[0]!
    this.tone({
      from: 1250 * r * v.pitch,
      to: 190 * r * v.pitch,
      dur: 0.13 * v.len,
      type: v.wave,
      gain: 0.17 * vol * v.gain,
      dest,
    })
    this.tone({
      from: 620 * r * v.pitch,
      to: 90,
      dur: 0.11 * v.len,
      type: 'sawtooth',
      gain: 0.12 * vol,
      dest,
      detune: 8,
    })
    this.noise({ dur: 0.05, filter: 'highpass', from: 3500, gain: 0.2 * vol, dest })
  }

  /** Eigener Treffer-Schaden: dumpfer Schlag + Brummen. */
  hit(): void {
    if (!this.ready()) return
    this.tone({ from: 220, to: 70, dur: 0.18, type: 'sawtooth', gain: 0.3 })
    this.noise({ dur: 0.1, filter: 'lowpass', from: 1800, to: 300, gain: 0.35 })
  }

  /** Gegner getroffen (Hitmarker): knackiges "tick". */
  hitmarker(): void {
    if (!this.ready()) return
    this.tone({ from: 1800, to: 1200, dur: 0.06, type: 'triangle', gain: 0.22 })
    this.tone({
      from: 2700,
      to: 2000,
      dur: 0.05,
      type: 'sine',
      gain: 0.12,
      at: this.ctx!.currentTime + 0.012,
    })
  }

  /** Einschlag in Wand: kurzes Knistern. */
  impact(sp?: Spatial): void {
    if (!this.ready()) return
    this.noise({
      dur: 0.06,
      filter: 'bandpass',
      from: 2400,
      q: 1.4,
      gain: 0.12,
      dest: this.out(sp),
    })
  }

  /** Eigener Tod: absteigender Sweep + Rauschen. */
  death(): void {
    if (!this.ready()) return
    this.tone({ from: 520, to: 45, dur: 0.7, type: 'sawtooth', gain: 0.3, reverb: 0.6 })
    this.tone({ from: 260, to: 30, dur: 0.8, type: 'square', gain: 0.18, reverb: 0.5 })
    this.noise({ dur: 0.55, filter: 'lowpass', from: 2400, to: 90, gain: 0.45, reverb: 0.5 })
  }

  /** Abschuss eines anderen Spielers (Explosion in der Ferne). */
  explosion(sp?: Spatial): void {
    if (!this.ready()) return
    const dest = this.out(sp)
    this.noise({ dur: 0.5, filter: 'lowpass', from: 1800, to: 120, gain: 0.35, dest, reverb: 0.5 })
    this.tone({ from: 150, to: 38, dur: 0.4, type: 'sine', gain: 0.35, dest })
  }

  /** Eigener Kill: Triumph-Arpeggio. */
  /** Ult ist voll geladen: kurzes helles Zweiklang-Pling. */
  ultReady(): void {
    if (!this.ready()) return
    const t = this.ctx!.currentTime
    this.tone({ from: 660, to: 880, dur: 0.18, type: 'triangle', gain: 0.18, reverb: 0.4 })
    this.tone({ from: 990, to: 1320, dur: 0.22, type: 'triangle', gain: 0.14, at: t + 0.12, reverb: 0.4 })
  }

  /** Ult ausgeloest: aufsteigender Sweep + Rauschen. */
  ult(): void {
    if (!this.ready()) return
    this.tone({ from: 120, to: 900, dur: 0.45, type: 'sawtooth', gain: 0.2, reverb: 0.5 })
    this.tone({ from: 240, to: 1800, dur: 0.4, type: 'square', gain: 0.1, reverb: 0.5 })
    this.noise({ dur: 0.35, filter: 'highpass', from: 800, to: 5000, gain: 0.2 })
  }

  killConfirm(streak = 1): void {
    if (!this.ready()) return
    const t = this.ctx!.currentTime
    const lift = Math.min(streak - 1, 5) * 2
    const steps = [0, 4, 7, 12]
    steps.forEach((s, i) => {
      this.tone({
        from: noteHz(440, s + lift),
        dur: 0.2,
        type: 'square',
        gain: 0.13,
        at: t + i * 0.055,
        reverb: 0.45,
      })
    })
    this.tone({
      from: noteHz(220, lift),
      to: noteHz(220, lift) * 0.9,
      dur: 0.25,
      type: 'triangle',
      gain: 0.25,
      at: t,
    })
  }

  /** Pickup: HP = warm aufsteigend, Shield = metallisch. */
  /** Boost-Feld: aufsteigender Sweep + Luftstoss. */
  boost(sp?: Spatial): void {
    if (!this.ready()) return
    const dest = this.out(sp)
    this.tone({ from: 260, to: 1500, dur: 0.32, type: 'sawtooth', gain: 0.1, dest, reverb: 0.2 })
    this.tone({ from: 520, to: 3000, dur: 0.3, type: 'square', gain: 0.05, dest, detune: 12 })
    this.noise({ dur: 0.28, filter: 'highpass', from: 800, to: 5200, gain: 0.12, dest })
  }

  pickup(kind: string): void {
    if (!this.ready()) return
    const t = this.ctx!.currentTime
    if (kind === 'hp') {
      ;[0, 4, 7].forEach((s, i) =>
        this.tone({
          from: noteHz(523, s),
          dur: 0.22,
          type: 'triangle',
          gain: 0.2,
          at: t + i * 0.07,
          reverb: 0.4,
        }),
      )
    } else {
      this.tone({ from: 700, to: 1400, dur: 0.22, type: 'sawtooth', gain: 0.12, reverb: 0.5 })
      this.tone({
        from: 1050,
        to: 2100,
        dur: 0.22,
        type: 'square',
        gain: 0.07,
        at: t + 0.04,
        reverb: 0.5,
      })
    }
  }

  /** Respawn: aufsteigendes Wobble. */
  spawn(): void {
    if (!this.ready()) return
    this.tone({ from: 160, to: 740, dur: 0.38, type: 'sine', gain: 0.25, reverb: 0.5 })
    this.tone({ from: 320, to: 1480, dur: 0.38, type: 'triangle', gain: 0.1 })
  }

  /** Rundenstart: kurzer Gong + Anstieg. */
  roundStart(): void {
    if (!this.ready()) return
    const t = this.ctx!.currentTime
    ;[0, 7, 12].forEach((s, i) =>
      this.tone({
        from: noteHz(330, s),
        dur: 0.5,
        type: 'square',
        gain: 0.12,
        at: t + i * 0.09,
        reverb: 0.6,
      }),
    )
    this.tone({ from: 110, dur: 0.9, type: 'sine', gain: 0.3, at: t, reverb: 0.5 })
  }

  /** Rundenende / Sieg: Fanfare. */
  fanfare(won: boolean): void {
    if (!this.ready()) return
    const t = this.ctx!.currentTime
    const seq = won ? [0, 4, 7, 12, 16, 19] : [7, 5, 3, 0]
    seq.forEach((s, i) =>
      this.tone({
        from: noteHz(392, s),
        dur: won ? 0.28 : 0.4,
        type: won ? 'square' : 'triangle',
        gain: 0.14,
        at: t + i * (won ? 0.09 : 0.16),
        reverb: 0.55,
      }),
    )
  }

  /** Letzte 10 Sekunden: Tick. */
  tick(urgent: boolean): void {
    if (!this.ready()) return
    this.tone({ from: urgent ? 1500 : 1000, dur: 0.05, type: 'square', gain: 0.1 })
  }

  // --------------------------------------------------------------------------------------
  // UI-Sounds
  // --------------------------------------------------------------------------------------
  uiHover(): void {
    if (!this.ready()) return
    this.tone({ from: 900, to: 1100, dur: 0.035, type: 'sine', gain: 0.05 })
  }

  uiClick(): void {
    if (!this.ready()) return
    this.tone({ from: 520, to: 780, dur: 0.07, type: 'square', gain: 0.1 })
    this.tone({
      from: 1040,
      to: 1560,
      dur: 0.05,
      type: 'sine',
      gain: 0.06,
      at: this.ctx!.currentTime + 0.02,
    })
  }

  uiToggle(on: boolean): void {
    if (!this.ready()) return
    const t = this.ctx!.currentTime
    this.tone({ from: on ? 520 : 780, dur: 0.08, type: 'triangle', gain: 0.14, at: t })
    this.tone({ from: on ? 780 : 520, dur: 0.1, type: 'triangle', gain: 0.14, at: t + 0.07 })
  }

  uiError(): void {
    if (!this.ready()) return
    this.tone({ from: 190, to: 120, dur: 0.22, type: 'sawtooth', gain: 0.18 })
  }

  uiStart(): void {
    if (!this.ready()) return
    const t = this.ctx!.currentTime
    ;[0, 5, 9, 12].forEach((s, i) =>
      this.tone({
        from: noteHz(392, s),
        dur: 0.2,
        type: 'square',
        gain: 0.1,
        at: t + i * 0.06,
        reverb: 0.5,
      }),
    )
  }

  // --------------------------------------------------------------------------------------
  // Musik: generative Loop, Intensitaet (0..1) blendet Hi-Hat/Arp ein
  // --------------------------------------------------------------------------------------
  setMusic(on: boolean): void {
    if (on === this.musicOn) return
    this.musicOn = on
    if (!on) {
      if (this.musicTimer !== null) clearInterval(this.musicTimer)
      this.musicTimer = null
      return
    }
    if (!this.ctx) return
    this.nextStepAt = this.ctx.currentTime + 0.1
    this.musicStep = 0
    // Lookahead-Scheduler: alle 80 ms die naechsten 250 ms planen (stabil trotz Tab-Throttling).
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 80)
  }

  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v))
  }

  private scheduleMusic(): void {
    const ctx = this.ctx
    const bus = this.musicBus
    if (!ctx || !bus || !this.musicOn) return
    const bpm = 110
    const stepDur = 60 / bpm / 2 // Achtel
    while (this.nextStepAt < ctx.currentTime + 0.25) {
      const t = this.nextStepAt
      const s = this.musicStep % 64
      const bar = Math.floor(s / 16)
      const rootShift = [0, 0, 5, 3][bar]!
      // Bass: Achtel-Puls mit Oktav-Sprung
      if (s % 2 === 0) {
        const note = s % 8 === 6 ? 12 : 0
        this.tone({
          from: noteHz(ROOT, rootShift + note),
          dur: stepDur * 1.7,
          type: 'sawtooth',
          gain: 0.4,
          at: t,
          dest: bus,
          attack: 0.008,
        })
      }
      // Kick auf 1 und 3 (Viertel)
      if (s % 4 === 0) {
        this.tone({ from: 140, to: 42, dur: 0.16, type: 'sine', gain: 0.6, at: t, dest: bus })
      }
      // Hi-Hat (ab Intensitaet 0.15)
      if (this.intensity > 0.15 && s % 2 === 1) {
        this.noise({
          dur: 0.04,
          filter: 'highpass',
          from: 7000,
          gain: 0.07 + this.intensity * 0.06,
          at: t,
          dest: bus,
        })
      }
      // Arpeggio (ab Intensitaet 0.4)
      if (this.intensity > 0.4 && s % 2 === 0) {
        const idx = (s / 2 + bar) % A_MINOR_PENTA.length
        const semis = A_MINOR_PENTA[idx]! + rootShift + (s % 8 >= 4 ? 12 : 0)
        this.tone({
          from: noteHz(ROOT * 4, semis),
          dur: stepDur * 1.2,
          type: 'square',
          gain: 0.07 + this.intensity * 0.05,
          at: t,
          dest: bus,
          reverb: 0.3,
        })
      }
      // Snare auf 2 und 4 (ab Intensitaet 0.65)
      if (this.intensity > 0.65 && s % 8 === 4) {
        this.noise({
          dur: 0.12,
          filter: 'bandpass',
          from: 1800,
          q: 0.7,
          gain: 0.25,
          at: t,
          dest: bus,
        })
      }
      this.nextStepAt += stepDur
      this.musicStep++
    }
  }
}
