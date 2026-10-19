/* PTT sul joystick: legge i pulsanti di joystick, yoke e throttle con la Gamepad API (anche col simulatore
   in primo piano, perché la finestra non viene rallentata). Logica pura: getPads() è iniettata.
   Binding: { kind: 'gamepad', pad: 'id del dispositivo', button: n } */
(function (root) {
  'use strict';

  const pressed = (b) => !!(b && (b.pressed || b.value > 0.5));

  // Nome breve del dispositivo: "Thrustmaster T.16000M (Vendor: 044f Product: b10a)" -> "Thrustmaster T.16000M"
  function shortName(id) {
    return String(id || '').replace(/\s*\((?:Vendor|STANDARD GAMEPAD)[^)]*\)/gi, '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim().slice(0, 40) || 'Joystick';
  }

  /* getPads(): array come navigator.getGamepads(); onChange(down) quando il PTT cambia stato */
  function createPoller(getPads, onChange) {
    let binding = null;
    let down = false;
    let capturing = null; // { resolve, base: { 'pad#btn': true } }

    const list = () => Array.from(getPads() || []).filter(Boolean);
    const snapshot = () => {
      const s = {};
      for (const p of list()) (p.buttons || []).forEach((b, i) => { if (pressed(b)) s[`${p.index}#${i}`] = true; });
      return s;
    };

    function tick() {
      const pads = list();
      if (capturing) {
        // il primo pulsante premuto (che non era già premuto all'inizio) diventa il PTT
        for (const p of pads) {
          const i = (p.buttons || []).findIndex((b, n) => pressed(b) && !capturing.base[`${p.index}#${n}`]);
          if (i >= 0) { const c = capturing; capturing = null; c.resolve({ kind: 'gamepad', pad: p.id, button: i }); return; }
        }
        capturing.base = Object.fromEntries(Object.entries(capturing.base).filter(([k]) => snapshot()[k]));
        return;
      }
      if (!binding) return;
      const pad = pads.find((p) => p.id === binding.pad);
      const now = !!pad && pressed((pad.buttons || [])[binding.button]);
      if (now !== down) { down = now; onChange(now); }
    }

    return {
      tick,
      active: () => !!(binding || capturing),
      setBinding(b) {
        binding = b && b.kind === 'gamepad' && b.pad && Number.isInteger(b.button) ? { pad: String(b.pad), button: b.button } : null;
        if (down) { down = false; onChange(false); }
      },
      capture() {
        if (capturing) capturing.resolve(null);
        return new Promise((resolve) => { capturing = { resolve, base: snapshot() }; });
      },
      cancelCapture() { if (capturing) { const c = capturing; capturing = null; c.resolve(null); } },
    };
  }

  const api = { createPoller, shortName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GamepadPtt = api;
})(this);
