import test from 'node:test';
import assert from 'node:assert/strict';
test('temporary trusted Janus failure propagation probe - never merge', () => {
  assert.fail('Intentional commissioning failure: Janus must report failed tests');
});
