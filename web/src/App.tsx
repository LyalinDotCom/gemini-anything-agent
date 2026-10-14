import { LARGE_IMAGE_UI_READY } from "./agentProfiles";
import { lazy, Suspense, useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { KeyGate } from "./components/KeyGate";
import { hasStoredKey, onKeyChange } from "./gemini/keyStore";
const LargeImageDemo = lazy(() => import("./components/LargeImageDemo"));
const Object3dDemo = lazy(() => import("./components/Object3dDemo"));

export function App() {
  const [keyed, setKeyed] = useState(hasStoredKey());
  // Local visual automation can exercise the complete shell without copying a
  // developer secret into the browser. Vite replaces DEV with false in production.
  const uiTestMode = import.meta.env.DEV && new URLSearchParams(location.search).has("ui-test");

  useEffect(() => onKeyChange(() => setKeyed(hasStoredKey())), []);

  const sample = new URLSearchParams(location.search).get("sample3d");
  if (sample === "rocket" || sample === "person-cat") {
    return <Suspense fallback={<p>Loading 3D sample…</p>}><Object3dDemo /></Suspense>;
  }

  if (LARGE_IMAGE_UI_READY && new URLSearchParams(location.search).get("sampleLarge") === "seuss-world") return <Suspense fallback={<p>Loading large image…</p>}><LargeImageDemo /></Suspense>;

  return keyed || uiTestMode ? <AppShell /> : <KeyGate />;
}
