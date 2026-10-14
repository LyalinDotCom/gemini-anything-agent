import { useEffect, useRef, useState } from 'react';
import { deepZoomEntries, validateDeepZoomManifest, validateDeepZoomTiles } from '../utils/deepZoomArchive';
import html from '../../../agents/skills/gigapixel-gemini-mosaic/viewer/index.html?raw';
import css from '../../../agents/skills/gigapixel-gemini-mosaic/viewer/styles.txt?raw';
import script from '../../../agents/skills/gigapixel-gemini-mosaic/viewer/deepzoom.js?raw';
import { Spinner } from './atoms';

export function buildDeepZoomViewerDocument(): string {
  const tile = '`tiles/${z}/${c}_${r}.${M.format}`';
  const overview = '`overview.${M.format}`';
  if ([tile,overview].some(token => script.split(token).length !== 2) || ['<link rel="stylesheet" href="styles.css" />','<script src="deepzoom.js"></script>'].some(token => html.split(token).length !== 2)) throw new Error('Viewer assets are incompatible.');
  const trusted = script.replace(tile, () => `__imageUrl(${tile})`).replace(overview, () => `__imageUrl(${overview})`);
  // Transfer bytes into the opaque-origin iframe; only bundled code executes.
  const boot = `addEventListener('message', function receive(event) {
    if (event.source !== parent || event.data?.type !== 'large-image-assets') return;
    removeEventListener('message', receive);
    const __manifest = event.data.manifest;
    const __images = new Map(event.data.images);
    const __archive = event.data.archive;
    const __urls = new Map();
    function __imageUrl(name) {
      if (!__urls.has(name)) {
        const bytes = __images.get(name);
        if (!bytes) return '';
        __urls.set(name, URL.createObjectURL(new Blob([new Uint8Array(__archive, bytes[0], bytes[1])], {type:'image/jpeg'})));
        __images.delete(name);
      }
      return __urls.get(name);
    }
    const fetch = async () => ({ok:true, json:async () => __manifest});
    ${trusted}
  });`;
  return html.replace('<link rel="stylesheet" href="styles.css" />', () => `<style>${css}</style>`)
    .replace('<script src="deepzoom.js"></script>', () => `<script>${boot}</script>`);
}

export default function DeepZoomViewer({ url }: { url: string }) {
  const [page, setPage] = useState('');
  const [error, setError] = useState('');
  const payload = useRef<{ manifest: unknown; archive: ArrayBuffer; images: Array<[string, [number,number]]> } | null>(null);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setPage(''); setError(''); payload.current = null;
    void fetch(url, { signal: abort.signal }).then(r => {
      if (!r.ok) throw new Error('Could not load the large image viewer.');
      return r.arrayBuffer();
    }).then(buffer => {
      const files = deepZoomEntries(new Uint8Array(buffer));
      const manifest = validateDeepZoomManifest(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))));
      validateDeepZoomTiles(files,manifest);
      const images: Array<[string, [number,number]]> = [];
      for (const [name, data] of files) if (name.endsWith('.jpg')) images.push([name, [data.byteOffset,data.byteLength]]);
      if (active) { payload.current = { manifest, archive:buffer, images }; setPage(buildDeepZoomViewerDocument()); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; abort.abort(); payload.current = null; };
  }, [url]);
  if (error) return <div role="alert">{error}</div>;
  if (!page) return <Spinner />;
  return <iframe title="Explorable large image" sandbox="allow-scripts" srcDoc={page}
    onLoad={event => {
      const data = payload.current;
      if (!data) return;
      event.currentTarget.contentWindow?.postMessage({ type:'large-image-assets', ...data }, '*', [data.archive]);
      payload.current = null;
    }} style={{ width:'100%', height:'100%', border:0, minHeight:480 }} />;
}
