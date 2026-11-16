// Packs the production build in dist/ into one self-contained HTML file that runs offline,
// straight from the file system (double-click to play, no server needed).
// Usage: npm run bundle   (builds first, then writes release/wizard-chess.html)

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const assets = join(dist, 'assets');
const outFile = join(root, 'release', 'wizard-chess.html');

const read = (path: string): string => readFileSync(path, 'utf8');
const find = (pattern: RegExp): string => {
  const name = readdirSync(assets).find((f) => pattern.test(f));
  if (!name) throw new Error(`No asset matching ${pattern} in dist/assets. Run "npm run build" first.`);
  return name;
};

/** Makes code safe to sit inside an inline <script> element. */
const scriptSafe = (code: string): string => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

const workerName = find(/^worker-.*\.js$/);
const mainName = find(/^index-.*\.js$/);
const cssName = find(/^index-.*\.css$/);

// The worker has no imports, so it can run from a Blob URL. Swap the file reference for one.
let main = read(join(assets, mainName));
const workerRef = new RegExp(
  String.raw`new URL\(new URL\(\`${workerName.replace('.', '\\.')}\`,import\.meta\.url\)\.href,\`\`\+import\.meta\.url\)`,
);
if (!workerRef.test(main)) throw new Error(`Could not find the reference to ${workerName} in ${mainName}.`);
const workerSource = JSON.stringify(read(join(assets, workerName)));
main = main.replace(
  workerRef,
  () => `URL.createObjectURL(new Blob([${workerSource}],{type:"text/javascript"}))`,
);

let html = read(join(dist, 'index.html'));
const scriptTag = /<script type="module" crossorigin src="\.\/assets\/[^"]+"><\/script>/;
const styleTag = /<link rel="stylesheet" crossorigin href="\.\/assets\/[^"]+">/;
if (!scriptTag.test(html) || !styleTag.test(html)) throw new Error('Unexpected dist/index.html layout.');

html = html
  .replace(styleTag, () => `<style>\n${read(join(assets, cssName))}\n</style>`)
  .replace(scriptTag, '')
  // Run the game after the #app element exists.
  .replace('</body>', () => `<script type="module">\n${scriptSafe(main)}\n</script>\n</body>`);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`Wrote ${outFile.slice(root.length + 1)} (${(Buffer.byteLength(html) / 1024).toFixed(1)} kB)`);
