# DepthWizard Terrain

A small Three.js proof of concept for the **3D Reconstruction + Visualization** stage of DepthWizard. Open a saved depth or height image to turn its brightness into an interactive terrain mesh. A synthetic Alpine ridge heightmap is generated at startup; no `heightmap.png` file is required.

## Run

Requires Node.js 20.19+ or 22.12+.

### Open on Windows

Double-click **Open DepthWizard.cmd** in this project folder whenever you want to use the viewer. It starts the local server and opens your browser automatically. If dependencies are missing, it installs them first (internet access is needed for that initial setup).

Keep the launcher window open while using the viewer; minimizing it is fine. Closing that window or restarting your computer stops the server. Double-click the launcher again next time. A saved localhost link cannot start the server by itself.

The launcher tries port 5174 and uses the next available port if needed, opening the correct address automatically.

### Run from a terminal

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The default is http://127.0.0.1:5173.

```sh
npm run build
npm run preview
```

The production build is written to `dist/` and can be served by any static web server.

## Use

- Open an image with **Open image**, **Choose heightmap**, or drag and drop.
- Drag the terrain to rotate. Scroll to zoom. Touch supports one-finger rotation and two-finger zoom/pan.
- Adjust **Height exaggeration** or switch between terrain colors, grayscale, and wireframe.
- The camera toolbar provides top view, zoom, reset, and fullscreen where supported.
- The preview download button saves the sample PNG or the original uploaded image. **Load sample** restores the demo.

Images stay in the browser. PNG, JPEG, WebP, and BMP files up to 30 MB are accepted. Fonts and application dependencies are bundled locally; the running viewer needs no external network requests.

## Conversion

1. Decode the saved image in the browser.
2. Sample pixels through a 2D canvas, limiting the longest mesh dimension to 241 vertices.
3. Compute brightness as `(0.2126 R + 0.7152 G + 0.0722 B) / 255`. Transparent pixels are composited onto black.
4. Set each vertex's height to `brightness * 28 * exaggeration`, preserving the source image's width-to-height ratio. The constant `28` is an arbitrary visualization scale in scene units, not a conversion to real-world elevation or metres.
5. Recompute normals and render the mesh with [Three.js](https://threejs.org/docs/pages/BufferGeometry.html). [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html) handles rotation, zoom, and pan.

Black is low, white is high, and uniform images remain flat. Values are not stretched to the image's brightness range. Elevation is relative, not measured in metres. The longest terrain side is 120 scene units; the default exaggeration is 1.2.

This prototype uses the browser's 8-bit canvas pixel values, so high-bit-depth images do not retain scientific elevation precision. It has no SRTM/DEM integrations or AI models, and does not fetch satellite data, calibrate elevation, or interpret geospatial metadata.

## Verify

```sh
npm test
npm run test:browser
```

Run the dev server before the browser check. Tests use installed Chrome on Windows; set `CHROME_PATH` to another Chromium executable and `BASE_URL` to a different server URL when needed. Browser checks cover uploads, brightness and aspect ratio, flat images, controls, error recovery, and rendered pixels on desktop and mobile. Screenshots are written to `artifacts/`.

## Files

The application files are organized as follows. Supporting documentation, tests, and bundled assets sit alongside them.

```text
DepthWizard-Terrain/
|-- package.json
|-- index.html
`-- src/
    |-- main.js
    |-- terrain.js
    |-- heightmap.js
    `-- style.css
```

- `package.json`: Node/Vite scripts and dependencies, including Three.js.
- `index.html`: the webpage entry point and application container.
- `src/main.js`: application controls, image loading, and user interactions.
- `src/heightmap.js`: image decoding, grayscale sampling, and sample generation.
- `src/terrain.js`: mesh construction, lighting, camera, and rendering.
- `src/style.css`: responsive viewer layout.

```text
Image (uploaded or generated sample)
  -> heightmap.js: read pixels -> brightness -> normalized height values
  -> terrain.js: height values -> 3D mesh
  -> Three.js + OrbitControls: render -> rotate and zoom
  -> Interactive 3D terrain
```
