export default function LargeImageDemo(){
 const button={color:'#d7e5dd',fontSize:12,textDecoration:'none',padding:'8px 12px',border:'1px solid #35463c',borderRadius:8};
 return <main style={{height:'100dvh',display:'flex',flexDirection:'column',background:'#111b16',color:'#e6ede7'}}>
  <header style={{padding:'18px clamp(16px,3vw,36px)',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:14}}>
   <div><p style={{margin:'0 0 6px',fontSize:10,letterSpacing:1.4,color:'#9fc8b1'}}>GEMINI ANYWHERE AGENT / LARGE IMAGES</p>
    <h1 style={{margin:0,fontWeight:500,fontSize:'clamp(20px,3vw,32px)',letterSpacing:-.8}}>A world with room to explore.</h1>
    <p style={{margin:'7px 0 0',fontSize:12,color:'#a3b5a9'}}>Dr. Seuss World · 100.005 MP · 49 Gemini-generated regions · Drag and zoom</p></div>
   <nav aria-label="Large image actions" style={{display:'flex',flexWrap:'wrap',gap:8}}>
    <a href="/" style={button}>Create a large image ↗</a>
    <a href="/examples/seuss-world/mosaic.jpg" download style={button}>Full-resolution JPEG</a>
    <a href="/examples/seuss-world/mosaic.png" download style={button}>Lossless PNG</a>
   </nav>
  </header>
  <section aria-label="Interactive large image" style={{flex:1,minHeight:0}}>
   {/* Fixed first-party canonical viewer; staged assets are verified byte-for-byte.
       Generated ZIPs in chat still use the isolated, validated DeepZoomViewer. */}
   <iframe title="Explorable large image" src="/examples/seuss-world/index.html" style={{width:'100%',height:'100%',border:0}}/>
  </section>
  <footer style={{padding:'10px 20px',fontSize:11,color:'#a3b5a9'}}>Experimental mosaic · Minor stitching imperfections remain. Generated with the Large Images and Dr. Seuss World skills. <a href="/examples/seuss-world/index.html" style={{color:'#b4d8c3'}}>Open standalone viewer ↗</a></footer>
 </main>;
}
