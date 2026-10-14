/** Read only bounded stored ZIP entries used by our native deep-zoom packager. */
export function deepZoomEntries(bytes: Uint8Array): Map<string,Uint8Array> {
  if (bytes.byteLength > 100 * 1024 * 1024) throw new Error('Deep-zoom archive exceeds 100 MB.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const files=new Map<string,Uint8Array>();let offset=0;
  while(offset+30<=bytes.length && view.getUint32(offset,true)===0x04034b50){
    const flags=view.getUint16(offset+6,true),method=view.getUint16(offset+8,true),length=view.getUint32(offset+18,true);
    const nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);const start=offset+30+nameLength+extra;
    if(flags&9 || method!==0 || start+length>bytes.length)throw new Error('The viewer requires the native stored ZIP format.');
    const name=new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength));
    if (/^(manifest\.json|overview\.jpg|tiles\/\d+\/\d+_\d+\.jpg)$/.test(name)){
      if(files.has(name))throw new Error('Duplicate deep-zoom file.');files.set(name,bytes.subarray(start,start+length));
    }
    offset=start+length;if(files.size>10000)throw new Error('Deep-zoom archive is too large.');
  }
  if(!files.has('manifest.json')||!files.has('overview.jpg'))throw new Error('Deep-zoom archive has no manifest or overview.');
  return files;
}

export function validateDeepZoomManifest(value: unknown): Record<string, unknown> {
  const m = value as Record<string, unknown>;
  const integer = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isSafeInteger(x) && x >= min && x <= max;
  if (!m || !integer(m.width,1,100000) || !integer(m.height,1,100000) || m.format !== 'jpg'
    || !integer(m.tile_size,128,2048) || !integer(m.max_level,0,17)
    || !integer(m.min_preload_level,0,Number(m.max_level))
    || Number(m.max_level) !== Math.ceil(Math.log2(Math.max(Number(m.width),Number(m.height))))
    || !Array.isArray(m.districts) || m.districts.length > 1000) throw new Error('Invalid large image manifest.');
  for (const district of m.districts) {
    if (!district || typeof district !== 'object' || typeof district.title !== 'string' || district.title.length > 500
      || typeof district.scene !== 'string' || district.scene.length > 10000
      || !Number.isFinite(district.cx) || !Number.isFinite(district.cy)
      || !Array.isArray(district.box) || district.box.length !== 4 || !district.box.every(Number.isFinite)) throw new Error('Invalid image region.');
  }
  return m;
}

export function validateDeepZoomTiles(files: Map<string,Uint8Array>, m: Record<string,unknown>): void {
  let count = 0;
  for (let z = Number(m.min_preload_level); z <= Number(m.max_level); z++) {
    const scale = 2 ** (Number(m.max_level)-z);
    const cols = Math.ceil(Math.ceil(Number(m.width)/scale)/Number(m.tile_size));
    const rows = Math.ceil(Math.ceil(Number(m.height)/scale)/Number(m.tile_size));
    count += cols*rows;
    if (count > 10000) throw new Error('Image pyramid has too many tiles.');
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
      const tile=files.get(`tiles/${z}/${c}_${r}.jpg`);
      if (!tile || tile[0] !== 255 || tile[1] !== 216) throw new Error(`Image pyramid is missing a valid tile: ${z}/${c}_${r}.`);
    }
  }
}
