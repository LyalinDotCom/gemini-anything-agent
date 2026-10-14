import {expect,test} from 'vitest';
import {buildDeepZoomViewerDocument} from '../src/components/DeepZoomViewer';
test('actual bundled viewer bootstraps from transferred assets without external scripts or embedded image strings',()=>{
 const page=buildDeepZoomViewerDocument();
 expect(page).not.toContain('<script src=');expect(page).not.toContain('href="styles.css"');
 expect(page).toContain('event.source !== parent');expect(page).toContain('new Uint8Array(__archive, bytes[0], bytes[1])');
 expect(page).not.toContain('data:image/jpeg;base64');expect(page).toContain('__imageUrl(`tiles/${z}/${c}_${r}.${M.format}`)');
});
