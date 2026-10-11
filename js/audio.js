/* Cattura audio (cavo virtuale / microfono / audio di sistema), rileva quando
   l'ATC parla e consegna ogni trasmissione come file WAV 16 kHz. */
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
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function listInputs() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  async function unlockDeviceLabels() {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  }

  class SegmentRecorder {
    constructor(opts) {
      this.onSegment = opts.onSegment;
      this.onLevel = opts.onLevel || (() => {});
      this.onEnded = opts.onEnded || (() => {});
      this.threshold = opts.threshold || 0.02;
      this.silenceMs = opts.silenceMs || 800;
      this.minMs = opts.minMs || 500;
      this.maxMs = opts.maxMs || 30000;
    }

    async start(source, deviceId) {
      const audioOpts = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      if (source === 'system') {
        this.stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: audioOpts });
        if (!this.stream.getAudioTracks().length) {
          this.stream.getTracks().forEach((t) => t.stop());
          throw new Error('Nessun audio condiviso: scegli "Schermo intero" e spunta "Condividi audio di sistema".');
        }
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { ...audioOpts, deviceId: { exact: deviceId } } : audioOpts,
        });
      }
      const track = this.stream.getAudioTracks()[0];
      track.addEventListener('ended', () => { this.stop(); this.onEnded(); });

      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(new MediaStream([track]));
      this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
      const rate = this.ctx.sampleRate;
      const bufMs = (4096 / rate) * 1000;
      const preroll = [];
      let speaking = false;
      let chunks = [];
      let silence = 0;
      let total = 0;

      const finish = () => {
        speaking = false;
        const dur = total;
        const data = chunks;
        chunks = [];
        silence = 0;
        total = 0;
        if (dur < this.minMs) return;
        const len = data.reduce((n, c) => n + c.length, 0);
        const all = new Float32Array(len);
        let o = 0;
        for (const c of data) { all.set(c, o); o += c.length; }
        this.onSegment(encodeWav(downsample(all, rate, 16000), 16000), dur);
      };

      this.proc.onaudioprocess = (e) => {
        const input = new Float32Array(e.inputBuffer.getChannelData(0));
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);
        this.onLevel(rms, speaking);
        const loud = rms >= this.threshold;
        if (!speaking) {
          preroll.push(input);
          if (preroll.length > 5) preroll.shift();
          if (loud) {
            speaking = true;
            chunks = preroll.splice(0);
            total = chunks.length * bufMs;
            silence = 0;
          }
          return;
        }
        chunks.push(input);
        total += bufMs;
        silence = loud ? 0 : silence + bufMs;
        if (silence >= this.silenceMs || total >= this.maxMs) finish();
      };
      src.connect(this.proc);
      this.proc.connect(this.ctx.destination);
    }

    stop() {
      if (this.proc) { this.proc.disconnect(); this.proc.onaudioprocess = null; this.proc = null; }
      if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    }
  }

  root.AudioCapture = { SegmentRecorder, listInputs, unlockDeviceLabels, encodeWav };
})(this);
