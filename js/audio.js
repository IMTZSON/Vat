/* Cattura audio (cavo virtuale / microfono / audio di sistema), rileva quando
   l'ATC parla e consegna ogni trasmissione come file WAV 16 kHz.
   La cattura usa un AudioWorklet (fuori dal thread dell'interfaccia) con ripiego su
   ScriptProcessor nei browser che non lo supportano. Il rilevamento della voce (VAD)
   è una funzione pura, testata in Node: createVad(). */
(function (root) {
  'use strict';

  function downsample(buf, inRate, outRate) {
    if (outRate >= inRate) return buf;
    const ratio = inRate / outRate;
    const len = Math.floor(buf.length / ratio);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.min(buf.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let k = a; k < b; k++) sum += buf[k];
      out[i] = sum / Math.max(1, b - a);
    }
    return out;
  }

  function encodeWav(samples, rate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return typeof Blob === 'function' ? new Blob([buffer], { type: 'audio/wav' }) : buffer;
  }

  const concat = (chunks) => {
    const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return all;
  };

  const rmsOf = (input) => {
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    return Math.sqrt(sum / (input.length || 1));
  };

  /* Rilevamento della voce a blocchi.
     opts: { rate, threshold, auto, silenceMs, minMs, maxMs, onSegment(samples, ms), onLevel(rms, speaking, threshold) }
     auto: la soglia segue da sola il rumore di fondo (si adatta in fretta quando il rumore cala,
     lentamente quando sale, e mai mentre qualcuno parla). Isteresi: per chiudere la frase
     il livello deve scendere sotto il 70% della soglia di apertura. */
  function createVad(opts) {
    const o = { threshold: 0.02, auto: false, silenceMs: 800, minMs: 500, maxMs: 30000, onSegment() {}, onLevel() {} };
    for (const [k, v] of Object.entries(opts || {})) if (v !== undefined && v !== null) o[k] = v;
    const PREROLL = 5;
    const preroll = [];
    let speaking = false;
    let chunks = [];
    let silence = 0;
    let total = 0;
    let floor = null;
    let warm = 0;

    const vad = {
      get threshold() {
        if (!o.auto) return o.threshold;
        if (floor === null) return Math.max(0.01, o.threshold);
        return Math.min(0.2, Math.max(0.004, floor * 3 + 0.003));
      },
      get noiseFloor() { return floor; },
      get speaking() { return speaking; },
      set(key, value) { o[key] = value; },

      push(input) {
        const bufMs = (input.length / o.rate) * 1000;
        const rms = rmsOf(input);
        if (o.auto && !speaking) {
          // Primi ~300 ms: stima veloce; poi scende in fretta e sale piano.
          if (floor === null) floor = rms;
          else if (warm < 300) floor = Math.min(floor, rms) * 0.5 + floor * 0.5;
          else floor = rms < floor ? floor * 0.85 + rms * 0.15 : floor * 0.995 + rms * 0.005;
          warm += bufMs;
        }
        const th = vad.threshold;
        o.onLevel(rms, speaking, th);
        if (!speaking) {
          preroll.push(input);
          if (preroll.length > PREROLL) preroll.shift();
          if (rms >= th && (!o.auto || warm >= 150)) {
            speaking = true;
            chunks = preroll.splice(0);
            total = chunks.reduce((n, c) => n + (c.length / o.rate) * 1000, 0);
            silence = 0;
          }
          return;
        }
        chunks.push(input);
        total += bufMs;
        silence = rms >= th * 0.7 ? 0 : silence + bufMs;
        if (silence >= o.silenceMs || total >= o.maxMs) vad.flush();
      },

      // Chiude la frase in corso (es. quando si ferma l'ascolto).
      flush() {
        if (!speaking) return;
        speaking = false;
        const dur = total;
        const data = chunks;
        chunks = [];
        silence = 0;
        total = 0;
        if (dur < o.minMs) return;
        o.onSegment(concat(data), dur);
      },
    };
    return vad;
  }

  async function listInputs() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  async function unlockDeviceLabels() {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  }

  // Collega una sorgente a un "rubinetto" che consegna blocchi di campioni a onChunk.
  async function tap(ctx, src, onChunk) {
    if (ctx.audioWorklet && typeof AudioWorkletNode === 'function' && /^https?:$/.test(root.location ? root.location.protocol : '')) {
      try {
        await ctx.audioWorklet.addModule('js/audio-worklet.js');
        const node = new AudioWorkletNode(ctx, 'rc-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        node.port.onmessage = (e) => onChunk(e.data);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        src.connect(node);
        node.connect(mute).connect(ctx.destination);
        return { kind: 'worklet', disconnect() { node.port.onmessage = null; try { src.disconnect(); node.disconnect(); mute.disconnect(); } catch (e) { /* già scollegato */ } } };
      } catch (e) { /* ripiego sotto */ }
    }
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(proc);
    proc.connect(ctx.destination);
    return { kind: 'script', disconnect() { proc.onaudioprocess = null; try { src.disconnect(); proc.disconnect(); } catch (e) { /* già scollegato */ } } };
  }

  class SegmentRecorder {
    constructor(opts) {
      this.opts = opts;
      this.onSegment = opts.onSegment;
      this.onLevel = opts.onLevel || (() => {});
      this.onEnded = opts.onEnded || (() => {});
      this._threshold = opts.threshold || 0.02;
      this._auto = !!opts.auto;
    }

    get threshold() { return this.vad ? this.vad.threshold : this._threshold; }
    set threshold(v) { this._threshold = v; if (this.vad) this.vad.set('threshold', v); }
    set auto(v) { this._auto = !!v; if (this.vad) this.vad.set('auto', !!v); }

    async start(source, deviceId) {
      const audioOpts = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      if (source === 'system') {
        this.stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: audioOpts });
        if (!this.stream.getAudioTracks().length) {
          this.stream.getTracks().forEach((t) => t.stop());
          throw new Error(root.I18n ? root.I18n.t('audio.noSystemAudio') : 'No system audio shared.');
        }
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { ...audioOpts, deviceId: { exact: deviceId } } : audioOpts,
        });
      }
      const track = this.stream.getAudioTracks()[0];
      track.addEventListener('ended', () => { this.stop(); this.onEnded(); });

      this.ctx = new AudioContext();
      const rate = this.ctx.sampleRate;
      this.vad = createVad({
        rate,
        threshold: this._threshold,
        auto: this._auto,
        silenceMs: this.opts.silenceMs,
        minMs: this.opts.minMs,
        maxMs: this.opts.maxMs,
        onLevel: (rms, speaking, th) => this.onLevel(rms, speaking, th),
        onSegment: (samples, dur) => this.onSegment(encodeWav(downsample(samples, rate, 16000), 16000), dur),
      });
      const src = this.ctx.createMediaStreamSource(new MediaStream([track]));
      this.tap = await tap(this.ctx, src, (chunk) => this.vad && this.vad.push(chunk));
      this.kind = this.tap.kind;
    }

    stop() {
      if (this.tap) { this.tap.disconnect(); this.tap = null; }
      if (this.vad) { this.vad.flush(); this.vad = null; }
      if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    }
  }

  // Registrazione a comando (premi per parlare), per l'allenamento.
  class ClipRecorder {
    async start(deviceId) {
      const audio = { echoCancellation: true, noiseSuppression: true };
      if (deviceId) audio.deviceId = { exact: deviceId };
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });
      this.ctx = new AudioContext();
      this.rate = this.ctx.sampleRate;
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.chunks = [];
      this.tap = await tap(this.ctx, src, (c) => this.chunks.push(c));
    }

    stop() {
      const rate = this.rate || 48000;
      if (this.tap) this.tap.disconnect();
      if (this.ctx) this.ctx.close().catch(() => {});
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      const chunks = this.chunks || [];
      this.tap = this.ctx = this.stream = null;
      this.chunks = [];
      const all = concat(chunks);
      if (all.length < rate * 0.3) return null;
      return encodeWav(downsample(all, rate, 16000), 16000);
    }
  }

  const api = { SegmentRecorder, ClipRecorder, listInputs, unlockDeviceLabels, encodeWav, downsample, createVad };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AudioCapture = api;
})(this);
