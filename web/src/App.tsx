import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { KeyGate } from "./components/KeyGate";
import { hasStoredKey, onKeyChange } from "./gemini/keyStore";

export function App() {
  const [keyed, setKeyed] = useState(hasStoredKey());
  // Local visual automation can exercise the complete shell without copying a
  // developer secret into the browser. Vite replaces DEV with false in production.
  const uiTestMode = import.meta.env.DEV && new URLSearchParams(location.search).has("ui-test");

  useEffect(() => onKeyChange(() => setKeyed(hasStoredKey())), []);

  return keyed || uiTestMode ? <AppShell /> : <KeyGate />;
}
