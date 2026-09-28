import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const assets = resolve('docs/demo-assets');
await mkdir(assets, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const externalRequests = [];
const report = { source: 'DepthWizard-Viewer.html opened directly with file://', checks: [] };

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  await page.goto(pathToFileURL(resolve('DepthWizard-Viewer.html')).href, { waitUntil: 'load' });
  await expect(page.locator('#source-preview')).toHaveAttribute('src', /^data:image\/png/);
  await expect(page.locator('#header-status')).toHaveText('Ready');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  async function frame() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function screenshot(name) {
    await frame();
    await page.screenshot({ path: resolve(assets, name), fullPage: true });
    console.log(`Captured ${name}`);
  }
  async function exaggeration(amount) {
    await page.locator('#exaggeration').fill(String(amount));
    await expect(page.locator('#height-value')).toContainText(amount.toFixed(2));
    await frame();
  }
  async function pixels() {
    const bytes = await page.locator('#viewport canvas').screenshot();
    return page.evaluate(async base64 => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const colors = new Map();
      let count = 0;
      for (let i = 0; i < data.length; i += 16) {
        const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
        colors.set(key, (colors.get(key) || 0) + 1);
        count++;
      }
      bitmap.close();
      return { width: canvas.width, height: canvas.height, colors: colors.size, foreground: 1 - Math.max(...colors.values()) / count };
    }, bytes.toString('base64'));
  }

  report.desktop = await pixels();
  assert.ok(report.desktop.colors > 20 && report.desktop.foreground > 0.025, 'Offline viewer must render visible terrain');
  report.checks.push('Offline startup and nonblank terrain');
  await screenshot('overview.png');

  const downloaded = page.waitForEvent('download');
  await page.locator('#download-image').click();
  const download = await downloaded;
  const savedSample = resolve(assets, 'alpine-ridge-heightmap.png');
  await download.saveAs(savedSample);
  const fileChooserEvent = page.waitForEvent('filechooser');
  await page.locator('#open-image').click();
  await (await fileChooserEvent).setFiles(savedSample);
  await expect(page.locator('#source-name')).toHaveText('alpine-ridge-heightmap.png');
  await screenshot('uploaded.png');
  report.checks.push('Download heightmap and reopen saved PNG through Open image');

  const fixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    [0, 128, 255].forEach((value, i) => {
      context.fillStyle = `rgb(${value},${value},${value})`;
      context.fillRect(i * 160, 0, 160, 240);
    });
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const fixturePath = resolve(assets, 'brightness-test.png');
  await writeFile(fixturePath, Buffer.from(fixture, 'base64'));
  await exaggeration(1);
  await page.locator('#file-input').setInputFiles(fixturePath);
  await expect(page.locator('#source-name')).toHaveText('brightness-test.png');
  await screenshot('brightness.png');
  report.checks.push('Known black/gray/white image upload');

  await page.locator('#file-input').setInputFiles(savedSample);
  await expect(page.locator('#source-name')).toHaveText('alpine-ridge-heightmap.png');
  await exaggeration(1.2);
  await page.locator('#reset-view').click();
  await page.locator('[data-mode="wireframe"]').click();
  await expect(page.locator('[data-mode="wireframe"]')).toHaveAttribute('aria-pressed', 'true');
  await screenshot('wireframe.png');
  await page.locator('[data-mode="surface"]').click();
  report.checks.push('Wireframe selection');

  await exaggeration(0);
  await screenshot('flat.png');
  const flat = await page.locator('#viewport canvas').screenshot();
  await exaggeration(2);
  await screenshot('raised.png');
  assert.ok(!flat.equals(await page.locator('#viewport canvas').screenshot()), 'Height slider must visibly change the surface');
  report.checks.push('Height exaggeration visibly changes the surface');

  await exaggeration(1.2);
  await page.locator('#reset-view').click();
  const canvas = page.locator('#viewport canvas');
  const original = await canvas.screenshot();
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 180, bounds.y + bounds.height / 2 + 35, { steps: 15 });
  await page.mouse.up();
  await frame();
  assert.ok(!original.equals(await canvas.screenshot()), 'Drag must change the terrain view');
  await screenshot('rotated.png');
  await page.locator('#reset-view').click();
  await frame();
  const beforeZoom = await canvas.screenshot();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -350);
  await frame();
  assert.ok(!beforeZoom.equals(await canvas.screenshot()), 'Scroll must change the terrain view');
  await page.locator('#top-view').click();
  await expect(page.locator('#top-view')).toHaveAttribute('aria-pressed', 'true');
  await screenshot('top-view.png');
  await page.locator('#reset-view').click();
  await expect(page.locator('#top-view')).toHaveAttribute('aria-pressed', 'false');
  report.checks.push('Rotate, scroll to zoom, top view, and reset');

  await page.setViewportSize({ width: 390, height: 844 });
  await frame();
  report.mobile = await pixels();
  assert.ok(report.mobile.colors > 20 && report.mobile.foreground > 0.025, 'Offline mobile view must contain terrain');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile layout must not overflow');
  await screenshot('mobile.png');
  assert.deepEqual(errors, [], 'Offline page must have no JavaScript errors');
  assert.deepEqual(externalRequests, [], 'Offline viewer must not request any HTTP assets');
  report.checks.push('Mobile rendering and zero external network requests');
  await writeFile(resolve(assets, 'verification.json'), JSON.stringify({ status: 'passed', ...report, errors, externalRequests }, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
