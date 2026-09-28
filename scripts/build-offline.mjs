import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(projectRoot, 'DepthWizard-Viewer.html');
const result = await build({
  root: projectRoot,
  publicDir: false,
  build: {
    write: false,
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    rollupOptions: {
      input: join(projectRoot, 'src/main.js'),
      output: { inlineDynamicImports: true },
    },
  },
});

if (Array.isArray(result) || !('output' in result)) {
  throw new Error('The offline build requires a single Rollup output.');
}

const chunks = result.output.filter((item) => item.type === 'chunk');
const assets = result.output.filter((item) => item.type === 'asset');
const entry = chunks[0];
if (chunks.length !== 1 || !entry.isEntry || entry.imports.length || entry.dynamicImports.length) {
  throw new Error('The offline build must contain one JavaScript entry with no external imports.');
}
if (entry.viteMetadata?.importedAssets?.size) {
  throw new Error('The offline build still references external assets.');
}

const extraAssets = assets.filter((item) => !item.fileName.endsWith('.css'));
if (extraAssets.length) {
  throw new Error(`Assets were not inlined: ${extraAssets.map((item) => item.fileName).join(', ')}`);
}
const css = assets.map((item) => typeof item.source === 'string'
  ? item.source
  : Buffer.from(item.source).toString('utf8')).join('\n');
if (!css || /@import\b/i.test(css)) {
  throw new Error('The offline build needs bundled CSS without external imports.');
}
for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
  const url = (match[1] ?? match[2] ?? match[3]).trim();
  if (!url.startsWith('data:') && !url.startsWith('#')) {
    throw new Error(`CSS asset was not inlined: ${url}`);
  }
}

const favicon = (await readFile(join(projectRoot, 'public/favicon.svg'))).toString('base64');
const script = entry.code.replace(/<\/script/gi, '<\\/script');
const styles = css.replace(/<\/style/gi, '<\\/style');
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f2f5f4" />
    <meta name="description" content="DepthWizard heightmap terrain viewer." />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${favicon}" />
    <title>DepthWizard | Terrain Viewer</title>
    <style>${styles}</style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module">${script}</script>
  </body>
</html>
`;

await writeFile(outputPath, html, 'utf8');
console.log(`Offline viewer: ${outputPath}`);
console.log(`Size: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB. Open this HTML file directly in your browser.`);
