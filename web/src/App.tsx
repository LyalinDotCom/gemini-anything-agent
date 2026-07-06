import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { KeyGate } from "./components/KeyGate";
import { hasStoredKey, onKeyChange } from "./gemini/keyStore";

export function App() {
  const [keyed, setKeyed] = useState(hasStoredKey());

  useEffect(() => onKeyChange(() => setKeyed(hasStoredKey())), []);

  return keyed ? <AppShell /> : <KeyGate />;
}
