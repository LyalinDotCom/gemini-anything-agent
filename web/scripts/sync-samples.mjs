// Restore generated sample binaries from this project's first-party deployment.
// Source and checksums live in Git; models and the 100 MP image remain in Hosting.
import { readFile, writeFile, mkdir, rename, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';

const root = fileURLToPath(new URL('../public/examples/', import.meta.url));
const assets = JSON.parse(await readFile(new URL('./sample-assets.json', import.meta.url), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const asset of assets) {
  const target = resolve(root, asset.path);
  if (!target.startsWith(root)) throw new Error('Invalid asset path');
  let valid = false;
  try { valid = hash(await readFile(target)) === asset.sha256; } catch { /* missing */ }
  if (valid) continue;
  console.log(`Restoring ${asset.path}`);
  const response = await fetch(`https://ai-chatbot-agent-54153.web.app/examples/${asset.path}`);
  if (!response.ok) throw new Error(`Sample download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== asset.sha256) throw new Error(`Checksum mismatch: ${asset.path}`);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.download`;
  try { await writeFile(temporary, bytes); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
}
const world = resolve(root, 'seuss-world');
let tilesPresent = true;
try { await access(resolve(world, 'tiles/14/26_14.jpg')); } catch { tilesPresent = false; }
if (!tilesPresent) {
  const entries = unzipSync(await readFile(resolve(world, 'deepzoom.zip')));
  for (const [name, bytes] of Object.entries(entries)) {
    // Only generated tiles are extracted; the checked-in viewer stays canonical.
    if (!/^tiles\/\d+\/\d+_\d+\.jpg$/.test(name)) continue;
    const target = resolve(world, name);
    if (!target.startsWith(world + sep)) throw new Error('Unsafe ZIP path');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}
console.log('Verified photographic 3D and large-image samples are ready.');
