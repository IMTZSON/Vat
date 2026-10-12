const test = require('node:test');
const assert = require('node:assert');
const U = require('../js/updates.js');

test('aggiornamenti: trova la build più recente e ignora il resto', () => {
  const rel = [
    { tag_name: 'build-7', html_url: 'u7' },
    { tag_name: 'build-12', html_url: 'u12', name: 'Readback Copilot – build 12' },
    { tag_name: 'build-10', html_url: 'u10' },
    { tag_name: 'v1.0', html_url: 'x' },
    { tag_name: 'build-99', draft: true },
  ];
  assert.deepStrictEqual(U.newer(rel, 9), { build: 12, url: 'u12', name: 'Readback Copilot – build 12', date: undefined });
  assert.strictEqual(U.newer(rel, 12), null);
  assert.strictEqual(U.newer([], 1), null);
  assert.strictEqual(U.newer(null, 1), null);
});
