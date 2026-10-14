/**
 * DeepZoom Gigapixel Viewer (`deepzoom.js`)
 *
 * Pure minimal HTML5 `<canvas>` multi-resolution pyramid viewer:
 *  - Instant `<30 ms` low-res base overview paint
 *  - Hierarchical parent-tile fallback (`z-1 -> ... -> min_preload_level`) with zero blank squares
 *  - Cursor-anchored wheel/pinch zoom, kinetic drag glide, top-right zoom controls, bottom-right interactive minimap
 */
(function () {
  const canvas = document.getElementById("dz-canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const miniCanvas = document.getElementById("minimap-canvas");
  const miniCtx = miniCanvas.getContext("2d");

  const btnZoomIn = document.getElementById("btn-zoom-in");
  const btnZoomOut = document.getElementById("btn-zoom-out");
  const btnFit = document.getElementById("btn-fit");
  const btn1to1 = document.getElementById("btn-1to1");

  let M = null;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let vw = window.innerWidth, vh = window.innerHeight;

  let cam = { cx: 0, cy: 0, scale: 0.1 };
  let anim = null;
  let vel = { vx: 0, vy: 0 };
  let dragging = false, miniDragging = false, lastPt = null;

  const cache = new Map();
  let inflight = 0;
  const MAX_INFLIGHT = 8;
  const MAX_CACHE = 450;
  let needsRender = true;
  let overviewImg = null;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    miniCanvas.width = Math.round(miniCanvas.clientWidth * dpr);
    miniCanvas.height = Math.round(miniCanvas.clientHeight * dpr);
    needsRender = true;
  }

  function fitScale() {
    if (!M) return 0.1;
    return Math.min((vw - 32) / M.width, (vh - 32) / M.height);
  }

  function clampCam() {
    if (!M) return;
    const minS = fitScale() * 0.65;
    const maxS = 2.5;
    cam.scale = Math.max(minS, Math.min(maxS, cam.scale));
    const marginX = vw / (2 * cam.scale) * 0.65;
    const marginY = vh / (2 * cam.scale) * 0.65;
    cam.cx = Math.max(-marginX + M.width * 0.1, Math.min(M.width + marginX - M.width * 0.1, cam.cx));
    cam.cy = Math.max(-marginY + M.height * 0.1, Math.min(M.height + marginY - M.height * 0.1, cam.cy));
  }

  function flyTo(tx, ty, tScale, durationMs = 450) {
    anim = {
      sx: cam.cx, sy: cam.cy, ss: cam.scale,
      tx, ty, ts: tScale,
      t0: performance.now(),
      dur: durationMs,
    };
    vel.vx = vel.vy = 0;
    needsRender = true;
  }

  function levelScale(z) {
    return Math.pow(0.5, M.max_level - z);
  }

  function requestTile(z, c, r) {
    const key = `${z}/${c}_${r}`;
    let entry = cache.get(key);
    if (entry) {
      entry.t = performance.now();
      return entry;
    }
    if (inflight >= MAX_INFLIGHT) return null;
    entry = { img: new Image(), state: "loading", t: performance.now() };
    inflight++;
    entry.img.onload = () => {
      inflight--;
      entry.state = "ready";
      entry.t = performance.now();
      needsRender = true;
    };
    entry.img.onerror = () => {
      inflight--;
      entry.state = "err";
    };
    entry.img.src = `tiles/${z}/${c}_${r}.${M.format}`;
    cache.set(key, entry);

    if (cache.size > MAX_CACHE) {
      const entries = [...cache.entries()]
        .filter(([, v]) => v.state === "ready")
        .sort((a, b) => a[1].t - b[1].t);
      for (let i = 0; i < 60 && i < entries.length; i++) {
        cache.delete(entries[i][0]);
      }
    }
    return entry;
  }

  function drawTileWithFallback(z, c, r, destX, destY, destW, destH) {
    const entry = requestTile(z, c, r);
    if (entry && entry.state === "ready") {
      ctx.drawImage(entry.img, destX, destY, destW, destH);
      return;
    }
    for (let pz = z - 1; pz >= M.min_preload_level; pz--) {
      const shift = z - pz;
      const factor = 1 << shift;
      const pc = c >> shift;
      const pr = r >> shift;
      const pEntry = cache.get(`${pz}/${pc}_${pr}`);
      if (pEntry && pEntry.state === "ready") {
        const subX = ((c % factor) * M.tile_size) / factor;
        const subY = ((r % factor) * M.tile_size) / factor;
        const subW = Math.min(M.tile_size / factor, pEntry.img.width - subX);
        const subH = Math.min(M.tile_size / factor, pEntry.img.height - subY);
        if (subW > 0 && subH > 0) {
          ctx.drawImage(pEntry.img, subX, subY, subW, subH, destX, destY, destW, destH);
          return;
        }
      }
    }
  }

  function renderFrame() {
    if (!M) return;
    const now = performance.now();

    if (anim) {
      const u = Math.min(1, (now - anim.t0) / anim.dur);
      const ease = 1 - Math.pow(1 - u, 3);
      cam.cx = anim.sx + (anim.tx - anim.sx) * ease;
      cam.cy = anim.sy + (anim.ty - anim.sy) * ease;
      cam.scale = anim.ss * Math.pow(anim.ts / anim.ss, ease);
      clampCam();
      if (u >= 1) anim = null;
      needsRender = true;
    } else if (!dragging && (Math.abs(vel.vx) > 0.08 || Math.abs(vel.vy) > 0.08)) {
      cam.cx -= vel.vx / cam.scale;
      cam.cy -= vel.vy / cam.scale;
      vel.vx *= 0.91;
      vel.vy *= 0.91;
      clampCam();
      needsRender = true;
    }

    if (!needsRender) return;
    needsRender = false;

    ctx.fillStyle = "#f4ede0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const effScale = cam.scale * dpr;
    const imgLeft = vw * 0.5 * dpr - cam.cx * effScale;
    const imgTop = vh * 0.5 * dpr - cam.cy * effScale;
    const imgW = M.width * effScale;
    const imgH = M.height * effScale;

    if (overviewImg && overviewImg.complete) {
      ctx.drawImage(overviewImg, imgLeft, imgTop, imgW, imgH);
    }

    const idealZ = M.max_level + Math.log2(cam.scale * dpr);
    const z = Math.max(M.min_preload_level, Math.min(M.max_level, Math.ceil(idealZ - 0.15)));
    const zScale = levelScale(z);
    const levelW = Math.ceil(M.width * zScale);
    const levelH = Math.ceil(M.height * zScale);
    const cols = Math.ceil(levelW / M.tile_size);
    const rows = Math.ceil(levelH / M.tile_size);

    const visLeft = Math.max(0, (cam.cx - vw / (2 * cam.scale)) * zScale);
    const visTop = Math.max(0, (cam.cy - vh / (2 * cam.scale)) * zScale);
    const visRight = Math.min(levelW, (cam.cx + vw / (2 * cam.scale)) * zScale);
    const visBottom = Math.min(levelH, (cam.cy + vh / (2 * cam.scale)) * zScale);

    const c0 = Math.max(0, Math.floor(visLeft / M.tile_size));
    const r0 = Math.max(0, Math.floor(visTop / M.tile_size));
    const c1 = Math.min(cols - 1, Math.floor(visRight / M.tile_size));
    const r1 = Math.min(rows - 1, Math.floor(visBottom / M.tile_size));

    const pxPerLevelPx = effScale / zScale;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const tw = Math.min(M.tile_size, levelW - c * M.tile_size);
        const th = Math.min(M.tile_size, levelH - r * M.tile_size);
        const dx = imgLeft + c * M.tile_size * pxPerLevelPx;
        const dy = imgTop + r * M.tile_size * pxPerLevelPx;
        const dw = tw * pxPerLevelPx + 0.6;
        const dh = th * pxPerLevelPx + 0.6;
        drawTileWithFallback(z, c, r, dx, dy, dw, dh);
      }
    }

    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    if (overviewImg && overviewImg.complete) {
      miniCtx.drawImage(overviewImg, 0, 0, miniCanvas.width, miniCanvas.height);
    }
    const rx = ((cam.cx - vw / (2 * cam.scale)) / M.width) * miniCanvas.width;
    const ry = ((cam.cy - vh / (2 * cam.scale)) / M.height) * miniCanvas.height;
    const rw = ((vw / cam.scale) / M.width) * miniCanvas.width;
    const rh = ((vh / cam.scale) / M.height) * miniCanvas.height;
    miniCtx.strokeStyle = "#d94e34";
    miniCtx.lineWidth = 2 * dpr;
    miniCtx.strokeRect(rx, ry, rw, rh);
  }

  function loop() {
    renderFrame();
    requestAnimationFrame(loop);
  }

  canvas.addEventListener("pointerdown", (e) => {
    anim = null;
    dragging = true;
    lastPt = { x: e.clientX, y: e.clientY, t: performance.now() };
    vel.vx = vel.vy = 0;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging || !lastPt) return;
    const dx = e.clientX - lastPt.x;
    const dy = e.clientY - lastPt.y;
    const dt = Math.max(1, performance.now() - lastPt.t);
    cam.cx -= dx / cam.scale;
    cam.cy -= dy / cam.scale;
    vel.vx = (dx / dt) * 14;
    vel.vy = (dy / dt) * 14;
    lastPt = { x: e.clientX, y: e.clientY, t: performance.now() };
    clampCam();
    needsRender = true;
  });

  window.addEventListener("pointerup", () => {
    dragging = false;
    miniDragging = false;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!M) return;
    anim = null;
    const factor = Math.pow(1.0018, -e.deltaY);
    const oldScale = cam.scale;
    const newScale = Math.max(fitScale() * 0.65, Math.min(2.5, oldScale * factor));
    const mx = e.clientX - vw * 0.5;
    const my = e.clientY - vh * 0.5;
    const worldX = cam.cx + mx / oldScale;
    const worldY = cam.cy + my / oldScale;
    cam.scale = newScale;
    cam.cx = worldX - mx / newScale;
    cam.cy = worldY - my / newScale;
    clampCam();
    needsRender = true;
  }, { passive: false });

  canvas.addEventListener("dblclick", (e) => {
    if (!M) return;
    const mx = e.clientX - vw * 0.5;
    const my = e.clientY - vh * 0.5;
    const worldX = cam.cx + mx / cam.scale;
    const worldY = cam.cy + my / cam.scale;
    const targetScale = e.shiftKey ? cam.scale * 0.5 : Math.min(2.0, cam.scale * 2.0);
    flyTo(worldX, worldY, targetScale, 420);
  });

  function jumpFromMini(e) {
    if (!M) return;
    anim = null;
    const rect = miniCanvas.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    cam.cx = u * M.width;
    cam.cy = v * M.height;
    clampCam();
    needsRender = true;
  }

  miniCanvas.addEventListener("pointerdown", (e) => {
    miniDragging = true;
    miniCanvas.setPointerCapture(e.pointerId);
    jumpFromMini(e);
  });

  miniCanvas.addEventListener("pointermove", (e) => {
    if (miniDragging) jumpFromMini(e);
  });

  btnZoomIn.onclick = () => flyTo(cam.cx, cam.cy, Math.min(2.5, cam.scale * 1.65), 300);
  btnZoomOut.onclick = () => flyTo(cam.cx, cam.cy, Math.max(fitScale() * 0.7, cam.scale / 1.65), 300);
  btnFit.onclick = () => flyTo(M.width * 0.5, M.height * 0.5, fitScale(), 500);
  btn1to1.onclick = () => flyTo(cam.cx, cam.cy, 1.0, 450);

  window.addEventListener("resize", resize);

  async function init() {
    resize();
    const res = await fetch("manifest.json");
    M = await res.json();
    if (M.world_name) document.title = M.world_name;

    overviewImg = new Image();
    overviewImg.onload = () => { needsRender = true; };
    overviewImg.src = `overview.${M.format}`;

    for (let z = M.min_preload_level; z <= Math.min(M.max_level, M.min_preload_level + 2); z++) {
      const zScale = levelScale(z);
      const cols = Math.ceil(Math.ceil(M.width * zScale) / M.tile_size);
      const rows = Math.ceil(Math.ceil(M.height * zScale) / M.tile_size);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          requestTile(z, c, r);
        }
      }
    }

    cam.cx = M.width * 0.5;
    cam.cy = M.height * 0.5;
    cam.scale = fitScale();
    needsRender = true;
    requestAnimationFrame(loop);
  }

  init();
})();
