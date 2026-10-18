import test from 'node:test';
import assert from 'node:assert/strict';
test('temporary fork CI failure propagation probe - never merge', () => {
  assert.fail('Intentional commissioning failure: hosted fork checks must report failure');
});
