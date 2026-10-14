import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { T } from "../tokens";
import { photoObjectMode, photoViewIndex, type PhotoObjectMode } from "../utils/photoObjects";
import { Spinner } from "./atoms";

function disposeModel(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}

export default function ModelViewer({ url, name }: { url: string; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const rig = useRef<{ controls: OrbitControls; model: THREE.Object3D; scene: THREE.Scene; frame: () => void; turnTo: (angle: number) => void } | null>(null);
  const motion = useRef(false);
  const [photoMode, setPhotoMode] = useState<PhotoObjectMode | null>(null);
  const [viewCount, setViewCount] = useState(0);
  const [viewIndex, setViewIndex] = useState(0);
  const [darkBackground, setDarkBackground] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ vertices: number; triangles: number } | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let active = true;
    setLoading(true); setError(null); setStats(null); setWireframe(false); setSpinning(false); setPhotoMode(null); setViewCount(0); setViewIndex(0); setDarkBackground(false); motion.current = false;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
    catch { setLoading(false); setError("3D graphics are unavailable in this browser. You can download the model above."); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", `Interactive 3D view of ${name}`);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#10141a");
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
    camera.position.set(3, 2, 4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.autoRotateSpeed = 1;
    controls.listenToKeyEvents(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xe4efff, 0x39312b, 2.2));
    const key = new THREE.DirectionalLight(0xfff3df, 2.6);
    key.position.set(3, 5, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0xadc8ff, 1.3);
    rim.position.set(-4, 2, -2); scene.add(rim);
    const grid = new THREE.GridHelper(6, 30, 0x46515f, 0x242d38);
    scene.add(grid);
    let mode: PhotoObjectMode | null = null;
    let photoViews: THREE.Object3D[] = [];
    let activeView = -1;
    let viewAngles: number[] | undefined;
    let azimuthSign = 1;
    let motionStart = 0;
    const pauseMotion = () => { motion.current = false; controls.autoRotate = false; setSpinning(false); };
    renderer.domElement.addEventListener("pointerdown", pauseMotion);
    let sphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
    let photoSize = new THREE.Vector3(1, 2, .1);
    const frame = () => {
      const vertical = THREE.MathUtils.degToRad(camera.fov);
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
      const distance = mode
        ? Math.max(photoSize.y / (2 * Math.tan(vertical / 2)), photoSize.x / (2 * Math.tan(horizontal / 2))) * 1.2 + photoSize.z / 2
        : sphere.radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.12;
      controls.target.copy(sphere.center);
      camera.position.copy(sphere.center).add(new THREE.Vector3(mode ? 0 : 0.8, mode ? 0 : 0.4, 1.7).normalize().multiplyScalar(distance));
      camera.near = Math.max(sphere.radius / 100, 0.001);
      camera.far = distance + sphere.radius * 30;
      controls.minDistance = sphere.radius * 0.15;
      controls.maxDistance = distance * 8;
      camera.updateProjectionMatrix(); controls.update();
    };
    const resize = () => {
      const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
      camera.aspect = width / height; camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container); resize();
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((asset) => {
      if (asset === url || asset.startsWith("blob:") || asset.startsWith("data:")) return asset;
      throw new Error("The viewer requires a self-contained GLB model.");
    });
    void new GLTFLoader(manager).loadAsync(url).then((gltf) => {
      if (!active) { disposeModel(gltf.scene); return; }
      const model = gltf.scene;
      model.traverse((object) => {
        const identified = photoObjectMode(object.userData);
        if (identified) {
          mode = identified;
          if (object instanceof THREE.Mesh) {
            object.scale.setScalar(1);
            photoViews.push(object);
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) { material.toneMapped = false; material.depthWrite = false; }
          }
        }
      });
      if (mode) {
        if (!photoViews.length) throw new Error("This photographic object contains no view surfaces.");
        photoViews.sort((a,b) => Number(a.userData.photo_view_index) - Number(b.userData.photo_view_index));
        viewAngles = photoViews.every((view) => Number.isFinite(view.userData.photo_view_angle_degrees)) ? photoViews.map((view) => Number(view.userData.photo_view_angle_degrees)) : undefined;
        azimuthSign = photoViews[0]?.userData.photo_view_azimuth_sign === -1 ? -1 : 1;
        setPhotoMode(mode); setViewCount(photoViews.length);
        scene.background = new THREE.Color("#edf0ec");
        grid.visible = false;
        controls.enablePan = false;
        controls.autoRotateSpeed = 2.4;
        controls.minPolarAngle = Math.PI/2 - .15; controls.maxPolarAngle = Math.PI/2 + .15;
        if (mode === "views") { controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity; }
        if (mode === "cutout") { controls.minAzimuthAngle = -.6; controls.maxAzimuthAngle = .6; }
      }
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const extent = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(extent) || extent <= 0) { disposeModel(model); throw new Error("This file contains no visible geometry."); }
      const centered = new THREE.Group(); centered.add(model);
      centered.scale.setScalar(2 / extent);
      model.position.sub(box.getCenter(new THREE.Vector3()));
      scene.add(centered); centered.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(centered);
      sphere = bounds.getBoundingSphere(new THREE.Sphere());
      photoSize = bounds.getSize(new THREE.Vector3());
      grid.position.y = bounds.min.y - 0.025;
      let vertices = 0, triangles = 0;
      centered.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const positions = object.geometry.getAttribute("position");
        vertices += positions?.count ?? 0;
        triangles += (object.geometry.index?.count ?? positions?.count ?? 0) / 3;
      });
      const turnTo = (angle: number) => {
        pauseMotion();
        const distance = camera.position.distanceTo(controls.target);
        // Flush any remaining drag inertia before setting the requested direction.
        controls.enableDamping = false; controls.update(); controls.enableDamping = true;
        camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(angle)*distance, 0, Math.cos(angle)*distance));
        controls.update(); activeView = -1;
      };
      rig.current = { controls, model: centered, scene, frame, turnTo };
      setStats({ vertices, triangles: Math.round(triangles) });
      if (mode === "views") photoViews.forEach((view,index) => { view.visible = index === 0; });
      frame(); setLoading(false);
    }).catch((reason: unknown) => {
      if (active) { setLoading(false); setError(reason instanceof Error ? reason.message : "Could not open this model."); }
    });
    let lastTime = 0;
    renderer.setAnimationLoop((time) => {
      const delta = Math.min((time - lastTime) / 1000, 0.05); lastTime = time;
      if (document.hidden) return;
      if (mode === "cutout" && motion.current) {
        if (!motionStart) motionStart = time;
        const theta = Math.sin((time-motionStart)/2200)*.4;
        const distance = camera.position.distanceTo(controls.target);
        camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(theta)*distance, 0, Math.cos(theta)*distance));
      } else { motionStart = 0; }
      controls.update(delta);
      if (mode === "views" && rig.current) {
        const theta = controls.getAzimuthalAngle();
        rig.current.model.rotation.y = theta;
        const index = photoViewIndex(theta * azimuthSign, photoViews.length, viewAngles);
        if (index !== activeView) { photoViews.forEach((view,i) => { view.visible = i === index; }); activeView = index; setViewIndex(index); }
      }
      renderer.render(scene, camera);
    });
    return () => {
      active = false; rig.current = null;
      observer.disconnect(); renderer.domElement.removeEventListener("pointerdown",pauseMotion); controls.dispose(); renderer.setAnimationLoop(null);
      disposeModel(scene); renderer.dispose(); renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [url, name]);

  const toggleWireframe = () => {
    const next = !wireframe; setWireframe(next);
    rig.current?.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if ("wireframe" in material) (material as THREE.MeshStandardMaterial).wireframe = next;
      }
    });
  };
  const toggleSpin = () => {
    const next = !spinning; setSpinning(next);
    motion.current = next;
    if (rig.current) rig.current.controls.autoRotate = photoMode === "cutout" ? false : next;
  };
  const toggleBackground = () => {
    const next = !darkBackground; setDarkBackground(next);
    if (rig.current) rig.current.scene.background = new THREE.Color(next ? "#182422" : "#edf0ec");
  };
  const button = { border: `1px solid ${T.border}`, borderRadius: 7, padding: "7px 11px", color: T.textDim, background: "#191f27", cursor: "pointer", fontSize: 12 };
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", minHeight: 240, borderRadius: 12, overflow: "hidden", border: "1px solid #2a333f" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "10px 14px", background: "#151b23", borderBottom: "1px solid #2a333f" }}>
        <span style={{ flex: 1, color: "#c4d3e4", font: `11px ${T.mono}`, letterSpacing: "0.1em" }}>{photoMode === "cutout" ? "ROUNDED PHOTO" : photoMode === "views" ? "3D VIEW" : "3D OBJECT"}</span>
        <a href={url} download={name} style={{ ...button, textDecoration: "none" }}>Download GLB</a>
        <button type="button" style={button} disabled={loading || !!error} onClick={() => rig.current?.frame()}>Reset view</button>
        {photoMode && <button type="button" style={{ ...button, color: darkBackground ? T.accent : T.textDim }} aria-pressed={darkBackground} disabled={loading || !!error} onClick={toggleBackground}>Dark background</button>}
        {!photoMode && <button type="button" style={{ ...button, color: wireframe ? T.accent : T.textDim }} disabled={loading || !!error} aria-pressed={wireframe} onClick={toggleWireframe}>Wireframe</button>}
        <button type="button" style={{ ...button, color: spinning ? T.accent : T.textDim }} disabled={loading || !!error} aria-pressed={spinning} onClick={toggleSpin}>{spinning ? "Pause motion" : photoMode === "cutout" ? "Gentle tilt" : "Rotate"}</button>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div ref={host} style={{ position: "absolute", inset: 0 }} />
        {(loading || error) && <div role={error ? "alert" : "status"} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, color: T.textDim, background: "#10141a" }}>{error ?? <><Spinner /> Loading 3D object…</>}</div>}
      </div>
      {photoMode === "views" && <nav aria-label="3D View directions" style={{ display: "flex", justifyContent: "center", gap: 7, padding: "8px", background: "#151b23" }}>
        {["Front", "Left side", "Back", "Right side"].map((label,index) => <button key={label} type="button" style={button} onClick={() => rig.current?.turnTo(index*Math.PI/2)}>{label}</button>)}
      </nav>}
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, padding: "10px 14px", background: "#151b23", color: "#90a0b3", fontSize: 11.5 }}>
        <span>{photoMode === "cutout" ? "Drag to tilt · Scroll to zoom" : photoMode === "views" ? "Drag to turn 360° · Scroll to zoom" : "Drag to orbit · Scroll to zoom · Right-drag to pan"}</span>
        <span aria-label={photoMode ? "Photographic object" : "Model geometry"}>{photoMode ? (photoMode === "cutout" ? "Photo texture · Transparent edges" : `View ${viewIndex + 1} / ${viewCount} · Gemini photographs`) : stats ? `${stats.vertices.toLocaleString()} vertices · ${stats.triangles.toLocaleString()} triangles` : "GLB"}</span>
      </div>
    </div>
  );
}
