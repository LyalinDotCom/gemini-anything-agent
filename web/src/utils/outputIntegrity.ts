/** Reject incorrect binary bodies even when experimental file APIs report the right size. */
export function validOutputSignature(path: string, data: Uint8Array): boolean {
  const extension = path.split(".").pop()?.toLowerCase();
  const ascii = (start: number, end: number) => new TextDecoder().decode(data.slice(start, end));
  if (extension === "glb") return data.length >= 20 && ascii(0, 4) === "glTF" && new DataView(data.buffer, data.byteOffset).getUint32(8, true) === data.length;
  if (extension === "blend") return ascii(0, 7) === "BLENDER"
    || (data.length>=12 && data[0]===31 && data[1]===139 && data[2]===8)
    || (data.length>=12 && [40,181,47,253].every((byte,index)=>data[index]===byte));
  if (extension === "png") {
    if (data.length<45 || ![137,80,78,71,13,10,26,10].every((byte,index)=>data[index]===byte) || ascii(12,16)!=='IHDR') return false;
    const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
    let offset=8,hasImage=false;
    while(offset+12<=data.length) {
      const length=view.getUint32(offset),end=offset+12+length,type=ascii(offset+4,offset+8);
      if(end>data.length) return false;
      if(offset===8 && length!==13) return false;
      if(type==='IDAT') hasImage=true;
      if(type==='IEND') return hasImage && length===0 && [174,66,96,130].every((byte,index)=>data[offset+8+index]===byte);
      offset=end;
    }
    return false;
  }
  if (extension === "jpg" || extension === "jpeg") return data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (extension === "mp4") return ascii(4, 8) === "ftyp";
  if (extension === "zip") return data[0] === 80 && data[1] === 75 && data[2] === 3 && data[3] === 4;
  if (extension === "json") { try { JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); return true; } catch { return false; } }
  return true;
}
