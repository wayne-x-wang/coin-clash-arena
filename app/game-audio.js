const makeTrack = (label, stepMs, wave, lead, bass, beatEvery, loop = true) => Object.freeze({
  label,
  stepMs,
  wave,
  lead: Object.freeze(lead),
  bass: Object.freeze(bass),
  beatEvery,
  loop,
});

/** Four original, deliberately short chiptune loops composed for this game. */
export const musicTracks = Object.freeze({
  select: makeTrack(
    "英雄登场曲",
    230,
    "square",
    ["C5", "E5", "G5", "E5", "D5", "F5", "A5", "F5", "C5", "E5", "G5", "B5", "A5", "G5", "E5", "D5"],
    ["C3", null, "C3", null, "D3", null, "D3", null, "A2", null, "E3", null, "F3", null, "G3", null],
    4,
  ),
  armory: makeTrack(
    "叮当武器铺",
    205,
    "triangle",
    ["A4", "C5", "E5", "C5", "G4", "B4", "D5", "B4", "F4", "A4", "C5", "A4", "E4", "G#4", "B4", "G#4"],
    ["A2", null, "A2", null, "G2", null, "G2", null, "F2", null, "F2", null, "E2", null, "E2", null],
    4,
  ),
  fight: makeTrack(
    "金币擂台冲冲冲",
    138,
    "sawtooth",
    ["E4", "E4", "G4", "A4", "E4", "B4", "A4", "G4", "D4", "D4", "F4", "G4", "D4", "A4", "G4", "F4"],
    ["E2", null, "E2", null, "C3", null, "D3", null, "D2", null, "D2", null, "B2", null, "C3", null],
    2,
  ),
  victory: makeTrack(
    "胜利金币雨",
    170,
    "square",
    ["C5", "E5", "G5", "C6", null, "G5", "A5", "C6", null, "E6", "D6", "C6", "G5", "C6", null, null],
    ["C3", null, "G2", null, "A2", null, "F2", null, "C3", null, "G2", null, "C3", null, null, null],
    4,
    false,
  ),
});

const semitones = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });

export function noteToFrequency(note) {
  if (note === null) return null;
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(note);
  if (!match) throw new RangeError(`Invalid note: ${note}`);
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const midi = (Number(match[3]) + 1) * 12 + semitones[match[1]] + accidental;
  return 440 * (2 ** ((midi - 69) / 12));
}

export class GameMusicEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.timer = null;
    this.mode = null;
    this.step = 0;
    this.enabled = false;
  }

  get isPlaying() {
    return this.enabled && this.context?.state === "running" && this.timer !== null;
  }

  async play(mode) {
    const track = musicTracks[mode];
    if (!track || typeof window === "undefined") return false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;

    try {
      if (!this.context || this.context.state === "closed") {
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.gain.value = 0.0001;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") await this.context.resume();
      if (this.context.state !== "running" || !this.master) return false;

      this.enabled = true;
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(0.16, this.context.currentTime, 0.035);
      if (this.mode !== mode || this.timer === null) this.restart(track, mode);
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    this.enabled = false;
    if (this.timer !== null && typeof window !== "undefined") window.clearInterval(this.timer);
    this.timer = null;
    this.mode = null;
    if (this.context && this.master && this.context.state !== "closed") {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.025);
    }
  }

  async dispose() {
    this.stop();
    const context = this.context;
    this.context = null;
    this.master = null;
    if (context && context.state !== "closed") {
      try { await context.close(); } catch { /* Audio teardown is best-effort. */ }
    }
  }

  restart(track, mode) {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.mode = mode;
    this.step = 0;
    const tick = () => this.tick(track);
    tick();
    this.timer = window.setInterval(tick, track.stepMs);
  }

  tick(track) {
    if (!this.enabled || !this.context || !this.master || this.context.state !== "running") return;
    if (!track.loop && this.step >= track.lead.length) {
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null;
      return;
    }
    const lead = track.lead[this.step % track.lead.length];
    const bass = track.bass[this.step % track.bass.length];
    const seconds = track.stepMs / 1000;
    if (lead) this.playTone(lead, seconds * 0.78, track.wave, track.wave === "sawtooth" ? 0.055 : 0.075);
    if (bass) this.playTone(bass, seconds * 0.92, "triangle", 0.09);
    if (this.step % track.beatEvery === 0) this.playKick(seconds * 0.72);
    this.step += 1;
  }

  playTone(note, duration, wave, volume) {
    const frequency = noteToFrequency(note);
    if (!frequency || !this.context || !this.master) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  playKick(duration) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(120, now);
    oscillator.frequency.exponentialRampToValueAtTime(46, now + duration);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
