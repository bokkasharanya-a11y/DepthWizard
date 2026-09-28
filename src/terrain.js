import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Arbitrary display scale in scene units, not a real-world elevation conversion.
const ELEVATION_SCALE = 28;
const SLAB_BOTTOM = -2;
const PALETTE = [
  [0, new THREE.Color('#315b59')],
  [0.18, new THREE.Color('#52796b')],
  [0.4, new THREE.Color('#849c79')],
  [0.62, new THREE.Color('#b4b59a')],
  [0.8, new THREE.Color('#d4d3bf')],
  [1, new THREE.Color('#f1f2e8')],
];

function elevationColor(value, mode, result) {
  if (mode === 'grayscale') {
    const brightness = 0.16 + value * 0.79;
    return result.setRGB(brightness, brightness, brightness);
  }
  for (let index = 1; index < PALETTE.length; index += 1) {
    const [upper, color] = PALETTE[index];
    if (value <= upper) {
      const [lower, previous] = PALETTE[index - 1];
      return result.copy(previous).lerp(color, (value - lower) / (upper - lower));
    }
  }
  return result.copy(PALETTE.at(-1)[1]);
}

export function createTerrainViewer(container, { onChange } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f2f5f4');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.className = 'terrain-canvas';
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D terrain');
  renderer.domElement.setAttribute('tabindex', '0');
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 3000);
  camera.position.set(135, 115, 150);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.8;
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.045;
  controls.minPolarAngle = 0.001;
  controls.minDistance = 12;
  controls.maxDistance = 700;
  controls.autoRotateSpeed = 0.6;

  const hemisphere = new THREE.HemisphereLight('#ffffff', '#9caea6', 2.3);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight('#fff8ed', 3.2);
  sun.position.set(-85, 150, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -115;
  sun.shadow.camera.right = 115;
  sun.shadow.camera.top = 115;
  sun.shadow.camera.bottom = -115;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 450;
  sun.shadow.normalBias = 0.35;
  sun.shadow.bias = -0.0001;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight('#e8f2f0', 0.8);
  fill.position.set(80, 50, -100);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1500, 1500),
    new THREE.ShadowMaterial({ color: '#43574f', opacity: 0.13 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = SLAB_BOTTOM - 0.1;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(320, 32, '#bccbc5', '#d8e1dc');
  grid.position.y = SLAB_BOTTOM - 0.075;
  grid.material.transparent = true;
  grid.material.opacity = 0.48;
  grid.material.depthWrite = false;
  scene.add(grid);

  let terrain = null;
  let skirts = null;
  let data = null;
  let exaggeration = 1.2;
  let mode = 'surface';
  let isTopView = false;
  let renderCount = 0;
  let disposed = false;
  let animationFrame = 0;
  let lastFrameTime = 0;
  let viewportWidth = 1;
  let viewportHeight = 1;
  let applyingCameraChange = false;
  const color = new THREE.Color();
  const corner = new THREE.Vector3();
  const normalDirection = new THREE.Vector3(1, 0.86, 1.18).normalize();

  function getState() {
    return {
      vertexCount: data ? data.columns * data.rows : 0,
      triangleCount: data ? (data.columns - 1) * (data.rows - 1) * 2 : 0,
      minHeight: data ? data.minValue * ELEVATION_SCALE * exaggeration : 0,
      maxHeight: data ? data.maxValue * ELEVATION_SCALE * exaggeration : 0,
      width: data?.width || 0,
      depth: data?.depth || 0,
      camera: camera.position.toArray(),
      target: controls.target.toArray(),
      exaggeration,
      mode,
      isTopView,
      autoRotate: controls.autoRotate,
      grid: grid.visible,
      renderCount,
    };
  }

  function notify() {
    if (!disposed && onChange) onChange(getState());
  }

  function removeMesh(mesh) {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  function applyCameraChange(change) {
    const damping = controls.enableDamping;
    const autoRotate = controls.autoRotate;
    applyingCameraChange = true;
    controls.enableDamping = false;
    controls.autoRotate = false;
    try {
      // Consume pending orbit and pan deltas before assigning the requested view.
      controls.update();
      change();
      controls.update();
    } finally {
      controls.enableDamping = damping;
      controls.autoRotate = autoRotate;
      applyingCameraChange = false;
    }
    notify();
  }

  function fitView(direction = null) {
    if (!data) return;
    const viewDirection = direction || camera.position.clone().sub(controls.target).normalize();
    const maxHeight = data.maxValue * ELEVATION_SCALE * exaggeration;
    const target = new THREE.Vector3(0, (SLAB_BOTTOM + maxHeight) / 2, 0);
    const right = new THREE.Vector3().crossVectors(camera.up, viewDirection).normalize();
    const up = new THREE.Vector3().crossVectors(viewDirection, right).normalize();
    const verticalTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const horizontalTangent = verticalTangent * camera.aspect;
    let distance = 0;

    // Project the bounding-box corners to fit both narrow and wide viewports.
    for (const x of [-data.width / 2, data.width / 2]) {
      for (const y of [SLAB_BOTTOM, maxHeight]) {
        for (const z of [-data.depth / 2, data.depth / 2]) {
          corner.set(x, y, z).sub(target);
          const towardsCamera = corner.dot(viewDirection);
          distance = Math.max(
            distance,
            towardsCamera + Math.abs(corner.dot(right)) / horizontalTangent,
            towardsCamera + Math.abs(corner.dot(up)) / verticalTangent,
          );
        }
      }
    }
    distance = Math.max(30, distance * 1.13);
    controls.maxDistance = Math.max(700, distance * 4);
    camera.far = Math.max(3000, distance * 8);
    camera.updateProjectionMatrix();
    applyCameraChange(() => {
      controls.target.copy(target);
      camera.position.copy(target).addScaledVector(viewDirection, distance);
    });
  }

  function updateSurface() {
    if (!terrain || !data) return;
    const positions = terrain.geometry.attributes.position.array;
    const colors = terrain.geometry.attributes.color.array;
    for (let index = 0; index < data.values.length; index += 1) {
      const value = data.values[index];
      positions[index * 3 + 1] = value * ELEVATION_SCALE * exaggeration;
      elevationColor(value, mode, color).toArray(colors, index * 3);
    }
    terrain.geometry.attributes.position.needsUpdate = true;
    terrain.geometry.attributes.color.needsUpdate = true;
    terrain.geometry.computeVertexNormals();
    terrain.geometry.computeBoundingBox();
    terrain.geometry.computeBoundingSphere();
    terrain.material.wireframe = mode === 'wireframe';

    const sidePositions = skirts.geometry.attributes.position.array;
    const sideColors = skirts.geometry.attributes.color.array;
    for (let index = 0; index < data.perimeter.length; index += 1) {
      const value = data.values[data.perimeter[index]];
      const offset = index * 6;
      sidePositions[offset + 1] = value * ELEVATION_SCALE * exaggeration;
      elevationColor(value, mode, color).multiplyScalar(0.76).toArray(sideColors, offset);
      elevationColor(0, mode, color).multiplyScalar(0.75).toArray(sideColors, offset + 3);
    }
    skirts.geometry.attributes.position.needsUpdate = true;
    skirts.geometry.attributes.color.needsUpdate = true;
    skirts.geometry.computeVertexNormals();
    skirts.geometry.computeBoundingBox();
    skirts.geometry.computeBoundingSphere();
    skirts.visible = mode !== 'wireframe';
    renderer.shadowMap.needsUpdate = true;
  }

  function setHeightmap({ values, columns, rows, aspect }) {
    if (
      !Number.isInteger(columns) || columns < 2 ||
      !Number.isInteger(rows) || rows < 2 ||
      !values || values.length !== columns * rows ||
      !Number.isFinite(aspect) || aspect <= 0
    ) {
      throw new Error('The heightmap must contain at least 2 by 2 pixels and a valid aspect ratio.');
    }

    const normalizedValues = new Float32Array(values.length);
    let minValue = 1;
    let maxValue = 0;
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (!Number.isFinite(value)) throw new Error('The heightmap contains invalid pixel values.');
      const normalized = THREE.MathUtils.clamp(value, 0, 1);
      normalizedValues[index] = normalized;
      minValue = Math.min(minValue, normalized);
      maxValue = Math.max(maxValue, normalized);
    }

    const width = aspect >= 1 ? 120 : 120 * aspect;
    const depth = aspect >= 1 ? 120 / aspect : 120;
    const positions = new Float32Array(columns * rows * 3);
    const colors = new Float32Array(positions.length);
    const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
    let offset = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        positions[index * 3] = (column / (columns - 1) - 0.5) * width;
        positions[index * 3 + 2] = (row / (rows - 1) - 0.5) * depth;
        if (column < columns - 1 && row < rows - 1) {
          indices[offset++] = index;
          indices[offset++] = index + columns;
          indices[offset++] = index + 1;
          indices[offset++] = index + 1;
          indices[offset++] = index + columns;
          indices[offset++] = index + columns + 1;
        }
      }
    }

    const perimeter = [];
    for (let column = 0; column < columns; column += 1) perimeter.push(column);
    for (let row = 1; row < rows; row += 1) perimeter.push(row * columns + columns - 1);
    for (let column = columns - 2; column >= 0; column -= 1) perimeter.push((rows - 1) * columns + column);
    for (let row = rows - 2; row > 0; row -= 1) perimeter.push(row * columns);
    perimeter.push(0);

    const sidePositions = new Float32Array(perimeter.length * 6);
    const sideColors = new Float32Array(sidePositions.length);
    const sideIndices = new Uint32Array((perimeter.length - 1) * 6);
    for (let index = 0; index < perimeter.length; index += 1) {
      const sourceOffset = perimeter[index] * 3;
      sidePositions[index * 6] = positions[sourceOffset];
      sidePositions[index * 6 + 2] = positions[sourceOffset + 2];
      sidePositions[index * 6 + 3] = positions[sourceOffset];
      sidePositions[index * 6 + 4] = SLAB_BOTTOM;
      sidePositions[index * 6 + 5] = positions[sourceOffset + 2];
      if (index < perimeter.length - 1) {
        const current = index * 2;
        sideIndices.set([current, current + 2, current + 1, current + 2, current + 3, current + 1], index * 6);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const sideGeometry = new THREE.BufferGeometry();
    sideGeometry.setAttribute('position', new THREE.BufferAttribute(sidePositions, 3));
    sideGeometry.setAttribute('color', new THREE.BufferAttribute(sideColors, 3));
    sideGeometry.setIndex(new THREE.BufferAttribute(sideIndices, 1));

    removeMesh(terrain);
    removeMesh(skirts);
    data = { values: normalizedValues, columns, rows, aspect, width, depth, minValue, maxValue, perimeter };
    terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.91,
      metalness: 0,
      side: THREE.DoubleSide,
    }));
    terrain.castShadow = true;
    terrain.receiveShadow = true;
    skirts = new THREE.Mesh(sideGeometry, new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    }));
    skirts.castShadow = true;
    skirts.receiveShadow = true;
    scene.add(terrain, skirts);
    updateSurface();
    resetView();
  }

  function setExaggeration(value) {
    if (!Number.isFinite(value) || value < 0) return;
    exaggeration = THREE.MathUtils.clamp(value, 0, 8);
    updateSurface();
    notify();
  }

  function setMode(value) {
    if (!['surface', 'wireframe', 'grayscale'].includes(value)) return;
    mode = value;
    updateSurface();
    notify();
  }

  function setGrid(value) {
    grid.visible = Boolean(value);
    notify();
  }

  function setAutoRotate(value) {
    controls.autoRotate = Boolean(value);
    notify();
  }

  function resetView() {
    isTopView = false;
    fitView(normalDirection);
  }

  function zoom(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const target = controls.target.clone();
    const offset = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
    offset.setLength(distance);
    applyCameraChange(() => {
      controls.target.copy(target);
      camera.position.copy(target).add(offset);
    });
  }

  function setTopView(value) {
    isTopView = Boolean(value);
    fitView(isTopView ? new THREE.Vector3(0, 1, 0.001).normalize() : normalDirection);
  }

  function resize() {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    if (width === viewportWidth && height === viewportHeight) return;
    viewportWidth = width;
    viewportHeight = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fitView();
  }

  function onControlsChange() {
    if (applyingCameraChange) return;
    if (controls.target.y < SLAB_BOTTOM) {
      camera.position.y += SLAB_BOTTOM - controls.target.y;
      controls.target.y = SLAB_BOTTOM;
    }
    const direction = camera.position.clone().sub(controls.target).normalize();
    if (isTopView && direction.y < 0.999) isTopView = false;
    notify();
  }

  controls.addEventListener('change', onControlsChange);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  function animate(time) {
    if (disposed) return;
    const delta = lastFrameTime ? Math.min((time - lastFrameTime) / 1000, 0.1) : 1 / 60;
    lastFrameTime = time;
    controls.update(delta);
    renderer.render(scene, camera);
    renderCount += 1;
    animationFrame = requestAnimationFrame(animate);
  }
  animationFrame = requestAnimationFrame(animate);

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    controls.removeEventListener('change', onControlsChange);
    controls.dispose();
    removeMesh(terrain);
    removeMesh(skirts);
    ground.geometry.dispose();
    ground.material.dispose();
    grid.geometry.dispose();
    grid.material.dispose();
    sun.shadow.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { setHeightmap, setExaggeration, setMode, setGrid, setAutoRotate, resetView, zoom, setTopView, dispose, getState };
}
