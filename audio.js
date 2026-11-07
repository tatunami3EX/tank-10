// TANK-10: Web Audio API Sound Synthesizer
// Zero external sound assets needed!
class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.masterGain = null;
  }

  init() {
    if (this.ctx) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.3; // Default comfortable volume
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn('Web Audio API not supported', e);
    }
  }

  ensureContext() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setVolume(vol) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, vol));
    }
  }

  toggleMute() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  // Helper: Create routed sub-gain & stereo panner node
  _createRoute(vol = 1.0, pan = 0) {
    if (!this.ctx || !this.masterGain) return null;
    if (vol <= 0) return null;
    const subGain = this.ctx.createGain();
    subGain.gain.value = Math.max(0, Math.min(1.5, vol));

    if (this.ctx.createStereoPanner) {
      try {
        const panner = this.ctx.createStereoPanner();
        panner.pan.value = Math.max(-0.95, Math.min(0.95, pan));
        subGain.connect(panner);
        panner.connect(this.masterGain);
        return subGain;
      } catch (e) {}
    }
    subGain.connect(this.masterGain);
    return subGain;
  }

  // --- Sound Synthesizers ---

  // Tank Shoot sound customized per tank type
  playShoot(tankType = 'standard', vol = 1.0, pan = 0) {
    if (!this.enabled || vol <= 0) return;
    this.ensureContext();
    if (!this.ctx) return;

    const route = this._createRoute(vol, pan);
    if (!route) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Noise buffer for punchy blast
    const noiseBuffer = this._createNoiseBuffer(0.12);
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = this.ctx.createBiquadFilter();
    const noiseGain = this.ctx.createGain();

    noiseFilter.type = 'lowpass';
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(route);

    osc.connect(gain);
    gain.connect(route);

    if (tankType === 'sniper') {
      // High-pitched laser crack + heavy low boom
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(800, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.25);
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);

      noiseFilter.frequency.setValueAtTime(3000, t);
      noiseGain.gain.setValueAtTime(0.4, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);

      osc.start(t);
      osc.stop(t + 0.3);
      noise.start(t);
      noise.stop(t + 0.15);
    } else if (tankType === 'assault') {
      // Rapid, light crisp pop
      osc.type = 'square';
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.08);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.09);

      noiseFilter.frequency.setValueAtTime(1500, t);
      noiseGain.gain.setValueAtTime(0.2, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);

      osc.start(t);
      osc.stop(t + 0.09);
      noise.start(t);
      noise.stop(t + 0.08);
    } else if (tankType === 'heavy') {
      // Deep heavy cannon thud
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + 0.4);
      gain.gain.setValueAtTime(0.7, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.45);

      noiseFilter.frequency.setValueAtTime(800, t);
      noiseGain.gain.setValueAtTime(0.6, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);

      osc.start(t);
      osc.stop(t + 0.45);
      noise.start(t);
      noise.stop(t + 0.3);
    } else if (tankType === 'breaker') {
      // Punchy explosive blast
      osc.type = 'sine';
      osc.frequency.setValueAtTime(240, t);
      osc.frequency.exponentialRampToValueAtTime(50, t + 0.25);
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);

      noiseFilter.frequency.setValueAtTime(1800, t);
      noiseGain.gain.setValueAtTime(0.5, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

      osc.start(t);
      osc.stop(t + 0.25);
      noise.start(t);
      noise.stop(t + 0.2);
    } else if (tankType === 'phantom') {
      // Futuristic twin-plasma laser zap
      osc.type = 'sine';
      osc.frequency.setValueAtTime(960, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.16);
      gain.gain.setValueAtTime(0.45, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);

      noiseFilter.frequency.setValueAtTime(2500, t);
      noiseGain.gain.setValueAtTime(0.3, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);

      osc.start(t);
      osc.stop(t + 0.18);
      noise.start(t);
      noise.stop(t + 0.1);
    } else {
      // Standard tank shot
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.2);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

      noiseFilter.frequency.setValueAtTime(1200, t);
      noiseGain.gain.setValueAtTime(0.35, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);

      osc.start(t);
      osc.stop(t + 0.2);
      noise.start(t);
      noise.stop(t + 0.15);
    }
  }

  // Hit sound when bullet strikes a tank
  playHit(vol = 1.0, pan = 0) {
    if (!this.enabled || vol <= 0) return;
    this.ensureContext();
    if (!this.ctx) return;

    const route = this._createRoute(vol, pan);
    if (!route) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.1);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);

    osc.connect(gain);
    gain.connect(route);

    osc.start(t);
    osc.stop(t + 0.12);
  }

  // Wall hit sound
  playWallHit(vol = 1.0, pan = 0) {
    if (!this.enabled || vol <= 0) return;
    this.ensureContext();
    if (!this.ctx) return;

    const route = this._createRoute(vol, pan);
    if (!route) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.08);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);

    osc.connect(gain);
    gain.connect(route);

    osc.start(t);
    osc.stop(t + 0.08);
  }

  // Brick Wall Destroyed (crumbling debris)
  playWallBreak(vol = 1.0, pan = 0) {
    if (!this.enabled || vol <= 0) return;
    this.ensureContext();
    if (!this.ctx) return;

    const route = this._createRoute(vol, pan);
    if (!route) return;

    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(0.3);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.exponentialRampToValueAtTime(150, t + 0.3);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(route);

    noise.start(t);
    noise.stop(t + 0.3);
  }

  // Tank Destroyed (Massive explosion)
  playExplosion(vol = 1.0, pan = 0) {
    if (!this.enabled || vol <= 0) return;
    this.ensureContext();
    if (!this.ctx) return;

    const route = this._createRoute(vol, pan);
    if (!route) return;

    const t = this.ctx.currentTime;

    // Sub-bass rumble
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(25, t + 0.8);

    oscGain.gain.setValueAtTime(0.8, t);
    oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.85);

    osc.connect(oscGain);
    oscGain.connect(route);
    osc.start(t);
    osc.stop(t + 0.85);

    // Blast noise
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(0.7);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(100, t + 0.7);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.7, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.7);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(route);

    noise.start(t);
    noise.stop(t + 0.7);
  }

  // Countdown Beep
  playBeep(isFinal = false) {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    const freq = isFinal ? 880 : 440;
    const dur = isFinal ? 0.4 : 0.15;

    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + dur);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + dur);
  }

  // Victory fanfare
  playVictory() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      setTimeout(() => {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(t);
        osc.stop(t + 0.4);
      }, i * 140);
    });
  }

  playClick() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, t);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.04);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.04);
  }

  _createNoiseBuffer(duration = 0.5) {
    if (!this.ctx) return null;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}

window.soundManager = new SoundManager();
