/* Tasto PTT di vPilot: osserva tastiera e pulsanti del mouse a livello di sistema (anche col simulatore
   in primo piano) SENZA bloccarli, così vPilot continua a riceverli. Serve al coach per sapere con
   certezza quando trasmetti. Logica pura: il modulo nativo (uiohook-napi) è iniettato come "hook". */
'use strict';

// Pulsanti del mouse accettati come PTT: centrale e laterali (sinistro e destro servono ad altro)
const MOUSE_OK = new Set([3, 4, 5]);

class PttController {
  /* hook: EventEmitter con start()/stop() ed eventi keydown/keyup/mousedown/mouseup (uiohook-napi)
     names: { keycode: 'Nome' } per le etichette; onChange(down) quando il PTT cambia stato */
  constructor(hook, opts) {
    this.hook = hook;
    this.names = (opts && opts.names) || {};
    this.onChange = (opts && opts.onChange) || (() => {});
    this.binding = null;
    this.down = false;
    this.started = false;
    this.capturing = null;
    this.handlers = {
      keydown: (e) => this.event('key', e.keycode, true),
      keyup: (e) => this.event('key', e.keycode, false),
      mousedown: (e) => this.event('mouse', Number(e.button), true),
      mouseup: (e) => this.event('mouse', Number(e.button), false),
    };
  }

  ensure() {
    if (this.started) return;
    for (const [evt, fn] of Object.entries(this.handlers)) this.hook.on(evt, fn);
    this.hook.start();
    this.started = true;
  }

  release() {
    if (!this.started) return;
    for (const [evt, fn] of Object.entries(this.handlers)) this.hook.removeListener(evt, fn);
    try { this.hook.stop(); } catch (e) { /* già fermo */ }
    this.started = false;
  }

  // Si ascolta solo se serve (tasto impostato o cattura in corso)
  sync() {
    if (this.binding || this.capturing) this.ensure();
    else this.release();
  }

  setBinding(b) {
    this.binding = b && (b.kind === 'key' || b.kind === 'mouse') && Number.isFinite(Number(b.code)) ? { kind: b.kind, code: Number(b.code) } : null;
    if (this.down) { this.down = false; this.onChange(false); }
    this.sync();
    return this.binding ? this.describe(this.binding) : null;
  }

  // Il prossimo tasto (o pulsante laterale del mouse) premuto diventa il PTT. Esc annulla.
  capture(timeoutMs) {
    if (this.capturing) this.capturing.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(null), timeoutMs || 15000);
      const done = (b) => {
        clearTimeout(timer);
        if (this.capturing && this.capturing.resolve === done) this.capturing = null;
        this.sync();
        resolve(b ? this.describe(b) : null);
      };
      this.capturing = { resolve: done };
      this.sync();
    });
  }

  event(kind, code, isDown) {
    if (this.capturing && isDown) {
      if (kind === 'key' && code === 1) { this.capturing.resolve(null); return; } // Esc
      if (kind === 'mouse' && !MOUSE_OK.has(code)) return;
      this.capturing.resolve({ kind, code });
      return;
    }
    const b = this.binding;
    if (!b || b.kind !== kind || b.code !== code) return;
    // La tastiera ripete keydown finché il tasto è premuto: conta solo il cambio di stato
    if (isDown === this.down) return;
    this.down = isDown;
    this.onChange(isDown);
  }

  describe(b) {
    const label = b.kind === 'mouse' ? `Mouse ${b.code}` : (this.names[b.code] || `Key ${b.code}`);
    return { kind: b.kind, code: b.code, label };
  }
}

// Nomi leggibili dei tasti dalla mappa di uiohook (UiohookKey: { Nome: codice })
function keyNames(map) {
  const out = {};
  for (const [name, code] of Object.entries(map || {})) if (out[code] === undefined) out[code] = name;
  return out;
}

module.exports = { PttController, keyNames, MOUSE_OK };
