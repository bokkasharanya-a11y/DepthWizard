import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const report = {};
await mkdir('artifacts', { recursive: true });

function collectErrors(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push({ message: message.text(), ...message.location() });
  });
}

async function ready(page) {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__terrainViewer?.getState().vertexCount > 0);
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expect(page.locator('i[data-lucide]')).toHaveCount(0);
}

const state = page => page.evaluate(() => window.__terrainViewer.getState());
const coordinates = vector => Array.isArray(vector) ? vector : [vector.x, vector.y, vector.z];
const cameraDistance = snapshot => {
  const camera = coordinates(snapshot.camera);
  const target = coordinates(snapshot.target);
  return Math.hypot(...camera.map((value, index) => value - target[index]));
};

async function setExaggeration(page, value) {
  const slider = page.locator('#exaggeration');
  if (value === 0 || value === 3) {
    await slider.focus();
    await slider.press(value === 0 ? 'Home' : 'End');
  } else {
    await slider.evaluate((input, nextValue) => {
      input.value = String(nextValue);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  await expect.poll(async () => (await state(page)).exaggeration).toBe(value);
}

async function renderedFrame(page) {
  const before = (await state(page)).renderCount;
  await page.waitForFunction(count => window.__terrainViewer.getState().renderCount >= count + 2, before);
}

async function toggleValue(page, id) {
  return page.locator(id).evaluate(element => element instanceof HTMLInputElement
    ? element.checked
    : element.getAttribute('aria-pressed') === 'true');
}

// Decode an actual screenshot to check the rendered output, even without preserveDrawingBuffer.
async function pixelStats(page) {
  const screenshot = await page.locator('#viewport canvas').screenshot();
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const buckets = new Map();
    let count = 0;
    for (let index = 0; index < data.length; index += 16) {
      const key = `${data[index] >> 4},${data[index + 1] >> 4},${data[index + 2] >> 4}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
      count++;
    }
    bitmap.close();
    return {
      width: canvas.width,
      height: canvas.height,
      colors: buckets.size,
      foregroundRatio: 1 - Math.max(...buckets.values()) / count,
    };
  }, screenshot.toString('base64'));
}

function assertRendered(stats, label) {
  assert.ok(stats.width >= 240 && stats.height >= 200, `${label}: canvas must have usable dimensions`);
  assert.ok(stats.colors > 20, `${label}: rendered canvas must contain terrain shading`);
  assert.ok(stats.foregroundRatio > 0.025, `${label}: canvas must contain visible terrain`);
}

async function assertNoOverflow(page, label) {
  const sizes = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(sizes.document <= sizes.viewport + 1, `${label}: document overflows horizontally`);
  assert.ok(sizes.body <= sizes.viewport + 1, `${label}: body overflows horizontally`);
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  collectErrors(page);
  await ready(page);
  const initial = await state(page);
  assert.ok(initial.maxHeight > initial.minHeight, 'sample terrain must have elevation variation');
  assert.ok(initial.vertexCount <= 241 * 241, 'sample mesh must have bounded resolution');
  assert.ok(initial.triangleCount > 0, 'sample mesh must contain triangles');
  report.desktop = await pixelStats(page);
  assertRendered(report.desktop, 'Desktop');
  await assertNoOverflow(page, 'Desktop');
  await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true });

  const canvas = page.locator('#viewport canvas');
  const beforeDragImage = await canvas.screenshot();
  const bounds = await canvas.boundingBox();
  const start = { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.5 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 115, start.y + 35, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify((await state(page)).camera)).not.toBe(JSON.stringify(initial.camera));
  assert.ok(!beforeDragImage.equals(await canvas.screenshot()), 'drag must change the rendered canvas');

  const beforeWheel = cameraDistance(await state(page));
  await page.mouse.wheel(0, -350);
  await expect.poll(async () => cameraDistance(await state(page))).toBeLessThan(beforeWheel * 0.98);
  const beforeZoomOut = cameraDistance(await state(page));
  await page.locator('#zoom-out').click();
  await expect.poll(async () => cameraDistance(await state(page))).toBeGreaterThan(beforeZoomOut * 1.01);
  const beforeZoomIn = cameraDistance(await state(page));
  await page.locator('#zoom-in').click();
  await expect.poll(async () => cameraDistance(await state(page))).toBeLessThan(beforeZoomIn * 0.99);

  await page.locator('#reset-view').click();
  await expect.poll(async () => {
    const camera = coordinates((await state(page)).camera);
    return Math.hypot(...camera.map((value, index) => value - coordinates(initial.camera)[index]));
  }).toBeLessThan(0.05);
  await page.locator('#top-view').click();
  await expect.poll(async () => (await state(page)).isTopView).toBe(true);
  await page.locator('#reset-view').click();
  await expect.poll(async () => (await state(page)).isTopView).toBe(false);

  const surfaceImage = await canvas.screenshot();
  for (const mode of ['grayscale', 'wireframe', 'surface']) {
    await page.locator(`[data-mode="${mode}"]`).click();
    await expect.poll(async () => (await state(page)).mode).toBe(mode);
    await expect(page.locator(`[data-mode="${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
    await renderedFrame(page);
    if (mode === 'wireframe') {
      assert.ok(!surfaceImage.equals(await canvas.screenshot()), 'wireframe must visibly change the rendered mesh');
      assert.equal((await state(page)).triangleCount, initial.triangleCount, 'wireframe must keep the same mesh');
      report.wireframe = await pixelStats(page);
      assertRendered(report.wireframe, 'Wireframe');
      await page.screenshot({ path: 'artifacts/wireframe.png', fullPage: true });
    }
  }
  const gridBefore = await toggleValue(page, '#grid-toggle');
  await page.locator('label[for="grid-toggle"]').click();
  assert.notEqual(await toggleValue(page, '#grid-toggle'), gridBefore, 'grid toggle must change state');
  assert.equal((await state(page)).grid, !gridBefore);
  await page.locator('label[for="grid-toggle"]').click();
  await page.locator('label[for="rotate-toggle"]').click();
  assert.equal(await toggleValue(page, '#rotate-toggle'), true);
  assert.equal((await state(page)).autoRotate, true);
  const rotatingCamera = JSON.stringify((await state(page)).camera);
  await expect.poll(async () => JSON.stringify((await state(page)).camera)).not.toBe(rotatingCamera);
  await page.locator('label[for="rotate-toggle"]').click();

  const fixture = await page.evaluate(async () => {
    const source = document.createElement('canvas');
    source.width = 480;
    source.height = 240;
    const context = source.getContext('2d');
    for (let x = 0; x < source.width; x++) {
      const brightness = x < 160 ? 0 : x < 320 ? 128 : 255;
      context.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
      context.fillRect(x, 0, 1, source.height);
    }
    context.fillStyle = 'white';
    context.fillRect(0, 0, 40, 40);
    const dataURL = source.toDataURL('image/png');
    const image = new Image();
    image.src = dataURL;
    await image.decode();
    const { readHeightmap } = await import('/src/heightmap.js');
    const sample = readHeightmap(image);
    return {
      base64: dataURL.split(',')[1],
      columns: sample.columns,
      rows: sample.rows,
      aspect: sample.aspect,
      imageWidth: sample.imageWidth,
      imageHeight: sample.imageHeight,
      topLeft: sample.values[0],
      bottomLeft: sample.values[(sample.rows - 1) * sample.columns],
      bottomMiddle: sample.values[(sample.rows - 1) * sample.columns + Math.floor(sample.columns / 2)],
      bottomRight: sample.values[sample.values.length - 1],
    };
  });
  assert.equal(fixture.imageWidth, 480);
  assert.equal(fixture.imageHeight, 240);
  assert.equal(fixture.aspect, 2);
  assert.ok(fixture.topLeft > 0.99 && fixture.bottomLeft < 0.01, 'pixel sampling must preserve vertical orientation');
  assert.ok(Math.abs(fixture.bottomMiddle - 128 / 255) < 0.01, 'middle gray must produce middle height');
  assert.ok(fixture.bottomRight > 0.99, 'white pixels must produce maximum height');
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#open-image').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'asymmetric-heightmap.png',
    mimeType: 'image/png',
    buffer: Buffer.from(fixture.base64, 'base64'),
  });
  await expect(page.locator('#source-name')).toContainText('asymmetric-heightmap.png');
  const imported = await state(page);
  assert.ok(Math.abs(imported.width / imported.depth - 2) < 0.01, 'terrain must preserve source aspect ratio');
  assert.equal(imported.vertexCount, fixture.columns * fixture.rows);
  assert.equal(imported.triangleCount, (fixture.columns - 1) * (fixture.rows - 1) * 2);
  assert.ok(imported.maxHeight > imported.minHeight, 'uploaded brightness must produce varying heights');
  report.importPixels = await pixelStats(page);
  assertRendered(report.importPixels, 'Imported image');
  await page.screenshot({ path: 'artifacts/imported-heightmap.png', fullPage: true });
  await setExaggeration(page, 0);
  await expect.poll(async () => {
    const current = await state(page);
    return Math.abs(current.maxHeight - current.minHeight);
  }).toBeLessThan(1e-6);
  await renderedFrame(page);
  const flatImage = await canvas.screenshot();
  await page.screenshot({ path: 'artifacts/height-flat.png', fullPage: true });
  await setExaggeration(page, 2);
  await expect.poll(async () => (await state(page)).maxHeight - (await state(page)).minHeight).toBeGreaterThan(0);
  await renderedFrame(page);
  assert.ok(!flatImage.equals(await canvas.screenshot()), 'height exaggeration must visibly change the terrain');
  await page.screenshot({ path: 'artifacts/height-raised.png', fullPage: true });
  report.heightExaggeration = { flat: 0, raisedMaximum: (await state(page)).maxHeight };
  await setExaggeration(page, 3);
  await page.locator('#reset-view').click();
  report.maximumExaggeration = await pixelStats(page);
  assertRendered(report.maximumExaggeration, 'Maximum exaggeration');

  await page.locator('#file-input').setInputFiles({
    name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a valid image'),
  });
  await expect(page.locator('#message')).toBeVisible();
  await expect(page.locator('#message')).toContainText(/could|invalid|unable|failed|supported|decode|choose|load/i);
  await expect(page.locator('#source-name')).toContainText('asymmetric-heightmap.png');

  for (const brightness of [0, 255]) {
    await page.evaluate(async value => {
      const source = document.createElement('canvas');
      source.width = 8;
      source.height = 4;
      const context = source.getContext('2d');
      context.fillStyle = `rgb(${value}, ${value}, ${value})`;
      context.fillRect(0, 0, source.width, source.height);
      const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], `flat-${value}.png`, { type: 'image/png' }));
      document.querySelector('main').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, brightness);
    await expect(page.locator('#source-name')).toContainText(`flat-${brightness}.png`);
    const flat = await state(page);
    assert.ok(Math.abs(flat.maxHeight - flat.minHeight) < 1e-6, 'uniform images must remain flat');
    assert.ok(coordinates(flat.camera).every(Number.isFinite), 'uniform image camera must remain finite');
    if (brightness === 0) assert.equal(flat.maxHeight, 0);
    else assert.ok(flat.minHeight > 0, 'all-white input must remain above black input');
  }
  await page.locator('#sample-button').click();
  await expect(page.locator('#source-name')).not.toContainText('asymmetric-heightmap.png');
  assert.ok((await state(page)).vertexCount > 0, 'sample restoration must recover after an invalid import');
  await page.locator('#reset-view').click();
  report.imported = { columns: fixture.columns, rows: fixture.rows, aspect: imported.width / imported.depth };
  report.renderCount = (await state(page)).renderCount;
  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage();
  collectErrors(mobile);
  await ready(mobile);
  await assertNoOverflow(mobile, 'Mobile');
  report.mobile = await pixelStats(mobile);
  assertRendered(report.mobile, 'Mobile');
  await mobile.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
  const mobileBounds = await mobile.locator('#viewport canvas').boundingBox();
  const mobileCamera = JSON.stringify((await state(mobile)).camera);
  const session = await mobileContext.newCDPSession(mobile);
  const touch = { x: mobileBounds.x + mobileBounds.width * 0.4, y: mobileBounds.y + Math.min(mobileBounds.height * 0.5, 250) };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
  for (let step = 1; step <= 6; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touch.x + step * 12, y: touch.y + step * 2 }] });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => JSON.stringify((await state(mobile)).camera)).not.toBe(mobileCamera);
  await mobile.setViewportSize({ width: 320, height: 740 });
  await assertNoOverflow(mobile, 'Narrow mobile');
  report.narrowMobile = await pixelStats(mobile);
  assertRendered(report.narrowMobile, 'Narrow mobile');
  await mobile.screenshot({ path: 'artifacts/mobile-narrow.png', fullPage: true });

  console.log(JSON.stringify({ status: errors.length ? 'failed' : 'passed', ...report, errors }, null, 2));
  assert.deepEqual(errors, [], 'browser console and page must have no errors');
} finally {
  await browser.close();
}
