import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('webcam-model-manifest.json', root), 'utf8'));
const pkg = new URL('node_modules/@mediapipe/tasks-vision/', root);
const metadata = JSON.parse(await readFile(new URL('package.json', pkg), 'utf8'));
if (metadata.version !== manifest.runtimeVersion) throw new Error('MediaPipe version differs from webcam manifest. Run npm ci.');
const output = new URL('public/webcam-model/', root);
await mkdir(output, { recursive: true });
const target = new URL('face_landmarker.task', output);
let bytes = await readFile(target).catch(() => null);
const hash = value => createHash('sha256').update(value).digest('hex');
if (!bytes || hash(bytes) !== manifest.sha256) {
  const response = await fetch(manifest.url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Model download failed (${response.status}).`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (hash(bytes) !== manifest.sha256) throw new Error('Model checksum mismatch; refusing to install.');
await writeFile(target, bytes);
await copyFile(new URL('vision_bundle.js', pkg), new URL('vision_bundle.js', output));
await cp(new URL('wasm/', pkg), new URL('wasm/', output), { recursive: true });
await copyFile(new URL('webcam-model-NOTICE.txt', root), new URL('NOTICE.txt', output));
await copyFile(new URL('webcam-model-LICENSE.txt', root), new URL('LICENSE.txt', output));
console.log(`Verified webcam model and MediaPipe ${metadata.version}: ${fileURLToPath(output)}`);
