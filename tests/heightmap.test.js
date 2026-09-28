import assert from 'node:assert/strict';
import test from 'node:test';
import { getSampleDimensions, pixelBrightness } from '../src/heightmap.js';

test('grayscale brightness maps black, gray, and white to normalized heights', () => {
  assert.equal(pixelBrightness(0, 0, 0), 0);
  assert.ok(Math.abs(pixelBrightness(128, 128, 128) - 128 / 255) < 1e-12);
  assert.ok(Math.abs(pixelBrightness(255, 255, 255) - 1) < 1e-12);
});

test('colored pixels use luminance and transparent pixels composite on black', () => {
  assert.ok(Math.abs(pixelBrightness(255, 0, 0) - 0.2126) < 1e-12);
  assert.ok(Math.abs(pixelBrightness(0, 255, 0) - 0.7152) < 1e-12);
  assert.ok(Math.abs(pixelBrightness(0, 0, 255) - 0.0722) < 1e-12);
  assert.equal(pixelBrightness(255, 255, 255, 0), 0);
  assert.ok(Math.abs(pixelBrightness(255, 255, 255, 128) - 128 / 255) < 1e-12);
});

test('mesh sampling caps resolution while preserving landscape and portrait proportions', () => {
  for (const [width, height] of [[1200, 600], [600, 1200], [4096, 4096], [3200, 1000]]) {
    const { columns, rows } = getSampleDimensions(width, height);
    assert.ok(Number.isInteger(columns) && Number.isInteger(rows));
    assert.ok(columns >= 2 && rows >= 2);
    assert.equal(Math.max(columns, rows), 241);
    assert.ok(Math.abs(columns / rows - width / height) <= 1 / rows);
  }
});

test('sampling supports tiny and extremely narrow images without degenerate planes', () => {
  assert.deepEqual(getSampleDimensions(1, 1), { columns: 2, rows: 2 });
  assert.deepEqual(getSampleDimensions(6000, 1), { columns: 241, rows: 2 });
  assert.deepEqual(getSampleDimensions(1, 6000), { columns: 2, rows: 241 });
  assert.deepEqual(getSampleDimensions(128, 64, 65), { columns: 65, rows: 33 });
});
