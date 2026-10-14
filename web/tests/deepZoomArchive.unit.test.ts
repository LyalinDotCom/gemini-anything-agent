import {expect,test} from 'vitest';
import {deepZoomEntries,validateDeepZoomManifest} from '../src/utils/deepZoomArchive';
function archive(files:Array<[string,string]>):Uint8Array {
 const chunks=files.map(([name,text])=>{const n=new TextEncoder().encode(name),data=new TextEncoder().encode(text);const a=new Uint8Array(30+n.length+data.length);const v=new DataView(a.buffer);v.setUint32(0,0x04034b50,true);v.setUint32(18,data.length,true);v.setUint16(26,n.length,true);a.set(n,30);a.set(data,30+n.length);return a;});
 const out=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;
}
const manifest={width:13334,height:7500,tile_size:512,format:'jpg',max_level:14,min_preload_level:10,districts:[]};
test('loads only permitted native zoom assets, ignoring archive scripts and traversal paths',()=>{
 const files=deepZoomEntries(archive([['manifest.json',JSON.stringify(manifest)],['overview.jpg','image'],['tiles/14/0_0.jpg','tile'],['index.html','evil'],['../../secret.jpg','evil']]));
 expect([...files.keys()]).toEqual(['manifest.json','overview.jpg','tiles/14/0_0.jpg']);expect(validateDeepZoomManifest(manifest)).toEqual(manifest);
});
test('rejects duplicate assets and truncated archives',()=>{
 expect(()=>deepZoomEntries(archive([['manifest.json','{}'],['overview.jpg','x'],['overview.jpg','y']]))).toThrow('Duplicate');
 const valid=archive([['manifest.json','{}'],['overview.jpg','x']]);expect(()=>deepZoomEntries(valid.subarray(0,valid.length-1))).toThrow();
});
test('rejects compressed or encrypted entries and unsafe manifest geometry',()=>{
 const a=archive([['manifest.json','{}'],['overview.jpg','x']]);new DataView(a.buffer).setUint16(8,8,true);expect(()=>deepZoomEntries(a)).toThrow('stored ZIP');
 for(const change of [{tile_size:0},{max_level:100},{min_preload_level:15},{districts:[{title:'x',scene:'x',cx:Infinity,cy:1,box:[0,0,1,1]}]}])expect(()=>validateDeepZoomManifest({...manifest,...change})).toThrow();
});
