import {
  createIcons, Mountain, Upload, Image as ImageIcon, RotateCcw, Plus, Minus,
  Maximize, Minimize, Download, Layers, Grid3x3, Move3d, ChevronRight,
  Scan, Check, Activity, Box,
} from 'lucide';
import { createTerrainViewer } from './terrain.js';
import { createSampleHeightmap, readHeightmap, createPreview, decodeImage } from './heightmap.js';
import './style.css';

const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
document.querySelector('#app').innerHTML = `
  <header class="app-header">
    <a class="brand" href="./" aria-label="DepthWizard home">
      <span class="brand-mark">${icon('mountain')}</span>
      <span>Depth<span class="brand-light">Wizard</span></span>
    </a>
    <span class="header-divider"></span>
    <span class="app-label">Terrain viewer</span>
    <div class="header-actions">
      <span class="ready-state"><span class="status-dot"></span><span id="header-status">Ready</span></span>
      <button id="open-image" class="button primary">${icon('upload')}<span>Open image</span></button>
    </div>
  </header>
  <main class="workspace" id="workspace">
    <aside class="sidebar" aria-label="Terrain settings">
      <section class="source-section">
        <div class="section-heading"><h2>Heightmap</h2><span class="step-label">01 / SOURCE</span></div>
        <div class="image-preview">
          <img id="source-preview" alt="Grayscale heightmap used to generate the terrain" />
          <span class="preview-label">HEIGHT DATA</span>
          <button id="download-image" class="icon-button preview-download" aria-label="Download heightmap" data-tooltip="Download heightmap">${icon('download')}</button>
        </div>
        <div class="source-details">
          <span class="file-icon">${icon('image')}</span>
          <div class="file-info"><strong id="source-name">Alpine ridge</strong><span id="source-size">512 &times; 512 px</span></div>
          <span class="loaded-icon" aria-label="Image loaded">${icon('check')}</span>
        </div>
        <button id="replace-image" class="button secondary full-width">${icon('upload')}<span>Choose heightmap</span></button>
        <button id="sample-button" class="sample-button">${icon('rotate-ccw')}<span>Load sample</span>${icon('chevron-right')}</button>
      </section>
      <section class="settings-section">
        <div class="section-heading"><h2>Elevation</h2><span class="step-label">02 / SHAPE</span></div>
        <div class="control-label"><label for="exaggeration">Height exaggeration</label><output for="exaggeration" id="height-value">1.20&times;</output></div>
        <input id="exaggeration" type="range" min="0" max="3" step="0.05" value="1.2" />
        <div class="range-labels"><span>0&times;</span><span>3&times;</span></div>
        <div class="brightness-scale"></div>
        <div class="range-labels"><span>Black / low</span><span>White / high</span></div>
      </section>
      <section class="settings-section display-section">
        <div class="section-heading"><h2>Appearance</h2><span class="step-label">03 / VIEW</span></div>
        <div class="mode-control" role="group" aria-label="Terrain appearance">
          <button data-mode="surface" class="mode-button active" aria-pressed="true">${icon('layers')}<span>Terrain</span></button>
          <button data-mode="grayscale" class="mode-button" aria-pressed="false">${icon('box')}<span>Gray</span></button>
          <button data-mode="wireframe" class="mode-button" aria-pressed="false">${icon('grid-3x3')}<span>Wire</span></button>
        </div>
        <label class="toggle-row" for="grid-toggle"><span>${icon('grid-3x3')}Ground grid</span><input id="grid-toggle" type="checkbox" role="switch" checked /><span class="switch" aria-hidden="true"></span></label>
        <label class="toggle-row" for="rotate-toggle"><span>${icon('move-3d')}Auto-rotate</span><input id="rotate-toggle" type="checkbox" role="switch" /><span class="switch" aria-hidden="true"></span></label>
      </section>
      <div class="sidebar-footer"><span class="status-dot"></span><span id="source-kind">Sample heightmap</span></div>
    </aside>
    <section class="terrain-area" aria-label="Interactive terrain">
      <div id="viewport" aria-label="3D terrain, rotatable and zoomable"></div>
      <div class="viewport-heading"><div class="viewport-eyebrow"><span class="status-dot"></span>3D RECONSTRUCTION</div><h1>Terrain</h1><span id="terrain-name">Alpine ridge</span></div>
      <div class="view-toolbar" role="toolbar" aria-label="Camera controls">
        <button id="top-view" class="icon-button" aria-label="Top view" aria-pressed="false" data-tooltip="Top view">${icon('scan')}</button>
        <span class="toolbar-divider"></span>
        <button id="zoom-in" class="icon-button" aria-label="Zoom in" data-tooltip="Zoom in">${icon('plus')}</button>
        <button id="zoom-out" class="icon-button" aria-label="Zoom out" data-tooltip="Zoom out">${icon('minus')}</button>
        <span class="toolbar-divider"></span>
        <button id="reset-view" class="icon-button" aria-label="Reset view" data-tooltip="Reset view">${icon('rotate-ccw')}</button>
        <button id="fullscreen" class="icon-button" aria-label="Fullscreen" data-tooltip="Fullscreen">${icon('maximize')}</button>
      </div>
      <div class="elevation-legend"><span>RELATIVE ELEVATION</span><div class="terrain-scale"></div><div><span>Low <b>0</b></span><span>High <b>1</b></span></div></div>
      <div class="axis-label" aria-hidden="true"><span class="axis-y">Y</span><span class="axis-x">X</span><span class="axis-z">Z</span><span class="axis-center"></span></div>
      <div class="viewport-footer"><span>${icon('activity')}<span id="mesh-stats">Preparing terrain</span></span><span class="view-label">${icon('box')}<span id="projection-label">Perspective</span></span></div>
      <div id="message" role="alert" hidden></div>
      <div id="drop-overlay" hidden>${icon('upload')}<span>Open heightmap</span></div>
    </section>
  </main>
  <input id="file-input" type="file" accept=".png,.jpg,.jpeg,.webp,.bmp,image/png,image/jpeg,image/webp,image/bmp" hidden />
`;

const icons = { Mountain, Upload, Image: ImageIcon, RotateCcw, Plus, Minus, Maximize, Minimize, Download, Layers, Grid3x3, Move3d, ChevronRight, Scan, Check, Activity, Box };
const refreshIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.7 } });
refreshIcons();
const $ = (selector) => document.querySelector(selector);
let viewer;
let sample;
let loadVersion = 0;
let currentDownload = '';
let currentFilename = 'alpine-ridge.png';
let messageTimer;

function showMessage(message, persistent = false) {
  clearTimeout(messageTimer);
  $('#message').textContent = message;
  $('#message').hidden = false;
  if (!persistent) messageTimer = setTimeout(() => { $('#message').hidden = true; }, 6500);
}

function updateStats(state) {
  $('#mesh-stats').textContent = `${state.vertexCount.toLocaleString()} vertices`;
  $('#projection-label').textContent = state.isTopView ? 'Top view' : 'Perspective';
  $('#top-view').setAttribute('aria-pressed', String(state.isTopView));
}

function applyImage(image, name, isSample, file = null) {
  const heightmap = readHeightmap(image);
  const preview = createPreview(image);
  viewer.setHeightmap(heightmap);
  $('#source-preview').src = preview;
  $('#source-name').textContent = name;
  $('#source-name').title = name;
  $('#terrain-name').textContent = isSample ? 'Alpine ridge' : name;
  $('#terrain-name').title = name;
  $('#source-size').textContent = `${heightmap.imageWidth.toLocaleString()} \u00d7 ${heightmap.imageHeight.toLocaleString()} px`;
  $('#source-kind').textContent = isSample ? 'Sample heightmap' : 'Local heightmap';
  if (currentDownload.startsWith('blob:')) URL.revokeObjectURL(currentDownload);
  currentDownload = file ? URL.createObjectURL(file) : preview;
  currentFilename = isSample ? 'alpine-ridge-heightmap.png' : name;
  $('#message').hidden = true;
  updateStats(viewer.getState());
}

function loadSample() {
  loadVersion++;
  $('#header-status').textContent = 'Ready';
  sample ||= createSampleHeightmap();
  applyImage(sample, 'Alpine ridge', true);
}

async function openFile(file) {
  if (!file || !viewer) return;
  const version = ++loadVersion;
  $('#header-status').textContent = 'Loading';
  try {
    const image = await decodeImage(file);
    if (version !== loadVersion) return;
    applyImage(image, file.name, false, file);
  } catch (error) {
    if (version === loadVersion) showMessage(error.message);
  } finally {
    if (version === loadVersion) $('#header-status').textContent = 'Ready';
  }
}

try {
  viewer = createTerrainViewer($('#viewport'), { onChange: updateStats });
  if (import.meta.env.DEV) window.__terrainViewer = viewer;
  loadSample();
} catch (error) {
  console.error(error);
  $('#header-status').textContent = 'Unavailable';
  $('#mesh-stats').textContent = 'Terrain unavailable';
  showMessage('3D rendering could not start. Enable hardware acceleration or open this page in a WebGL 2 compatible browser.', true);
  document.querySelectorAll('button, input').forEach((control) => { control.disabled = true; });
}

for (const id of ['#open-image', '#replace-image']) {
  $(id).addEventListener('click', () => $('#file-input').click());
}
$('#file-input').addEventListener('change', (event) => {
  openFile(event.target.files[0]);
  event.target.value = '';
});
$('#sample-button').addEventListener('click', loadSample);
$('#exaggeration').addEventListener('input', (event) => {
  const amount = Number(event.target.value);
  $('#height-value').textContent = `${amount.toFixed(2)}\u00d7`;
  event.target.style.setProperty('--range-fill', `${amount / 3 * 100}%`);
  viewer.setExaggeration(amount);
});
document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    viewer.setMode(button.dataset.mode);
    document.querySelectorAll('[data-mode]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
  });
});
$('#grid-toggle').addEventListener('change', (event) => viewer.setGrid(event.target.checked));
$('#rotate-toggle').addEventListener('change', (event) => viewer.setAutoRotate(event.target.checked));
$('#zoom-in').addEventListener('click', () => viewer.zoom(0.8));
$('#zoom-out').addEventListener('click', () => viewer.zoom(1.25));
$('#top-view').addEventListener('click', () => viewer.setTopView(!viewer.getState().isTopView));
$('#reset-view').addEventListener('click', () => {
  $('#rotate-toggle').checked = false;
  viewer.setAutoRotate(false);
  viewer.resetView();
});
$('#download-image').addEventListener('click', () => {
  const anchor = document.createElement('a');
  anchor.href = currentDownload;
  anchor.download = currentFilename;
  anchor.click();
});
$('#fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('.terrain-area').requestFullscreen();
  } catch {
    showMessage('Fullscreen is unavailable in this browser.');
  }
});
document.addEventListener('fullscreenchange', () => {
  const isFull = Boolean(document.fullscreenElement);
  $('#fullscreen').innerHTML = icon(isFull ? 'minimize' : 'maximize');
  $('#fullscreen').setAttribute('aria-label', isFull ? 'Exit fullscreen' : 'Fullscreen');
  $('#fullscreen').dataset.tooltip = isFull ? 'Exit fullscreen' : 'Fullscreen';
  refreshIcons();
});
if (!document.fullscreenEnabled) $('#fullscreen').hidden = true;

let dragDepth = 0;
document.addEventListener('dragenter', (event) => {
  if (!viewer || !event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  dragDepth++;
  $('#drop-overlay').hidden = false;
});
document.addEventListener('dragover', (event) => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
});
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('#drop-overlay').hidden = true;
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  openFile(event.dataTransfer.files[0]);
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  viewer?.dispose();
  if (currentDownload.startsWith('blob:')) URL.revokeObjectURL(currentDownload);
});
