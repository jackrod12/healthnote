export class RestTimer {
  constructor({ onTick, onComplete } = {}) {
    this.onTick = onTick || (() => {});
    this.onComplete = onComplete || (() => {});
    this.remaining = 0;
    this.total = 0;
    this.intervalId = null;
    this.running = false;
    this.active = false;
    this._audioCtx = null;
  }

  setDuration(seconds) {
    this.total = seconds;
    this.remaining = seconds;
    this.active = false;
    this.onTick(this.remaining, this.total);
  }

  addSeconds(delta) {
    this.remaining = Math.max(0, this.remaining + delta);
    this.total = Math.max(this.total, this.remaining);
    this.onTick(this.remaining, this.total);
  }

  start() {
    if (this.running || this.remaining <= 0) return;
    this.running = true;
    this.active = true;
    this.intervalId = setInterval(() => {
      this.remaining -= 1;
      if (this.remaining <= 0) {
        this.remaining = 0;
        this.onTick(this.remaining, this.total);
        this.stop();
        this._playBeep();
        this.onComplete();
        return;
      }
      this.onTick(this.remaining, this.total);
    }, 1000);
  }

  pause() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  stop() {
    this.pause();
  }

  reset(seconds = this.total) {
    this.pause();
    this.setDuration(seconds);
  }

  _getAudioCtx() {
    if (!this._audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this._audioCtx = new Ctx();
    }
    return this._audioCtx;
  }

  _playBeep() {
    try {
      const ctx = this._getAudioCtx();
      const beepAt = (delaySec) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + delaySec);
        gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + delaySec + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delaySec + 0.28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delaySec);
        osc.stop(ctx.currentTime + delaySec + 0.3);
      };
      beepAt(0);
      beepAt(0.35);
      beepAt(0.7);
    } catch (e) {
      // audio not available (autoplay restrictions etc) - fail silently
    }
  }

  static formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
}
