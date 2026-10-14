import { profileForSession } from "../agentProfiles";
import { effectiveRunOptions } from "../state/runOptions";
import { useStore } from "../state/store";
import type { RunOptions } from "../state/types";
import { T } from "../tokens";
import { credentialBindingError } from "../../../shared/credentialBinding";

const row: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 32, fontSize: 12.5 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: `1px solid ${T.border}`, borderRadius: 7, background: T.bg, color: T.text, padding: "7px 8px", fontSize: 12, outline: "none" };

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label style={{ ...row, opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export function RunOptionsPanel({ sessionId }: { sessionId: string }) {
  const session = useStore((s) => s.sessions[sessionId]);
  const patchSession = useStore((s) => s.patchSession);
  if (!session) return null;
  const options = effectiveRunOptions(session);
  const profile = profileForSession(session);
  const research = profile.research;
  const durable = Boolean(profile.object3dPersona || profile.largeImagePersona);
  const set = (patch: Partial<RunOptions>) => patchSession(sessionId, { runOptions: { ...options, ...patch } });
  const tools = ["code_execution", "google_search", "url_context"] as const;
  const connectionError = credentialBindingError(options);

  return (
    <div style={{ marginTop: 8, padding: "10px 12px", border: `1px solid ${T.borderSoft}`, borderRadius: T.radiusSm, background: T.bgElev }}>
      <p style={{ margin: "0 0 7px", color: T.textFaint, fontSize: 11.5 }}>
        {research ? "Deep Research always stores history and runs in the background." : durable ? `${profile.label} stores its long run so it can resume after reload.` : "Defaults preserve chat context and the remote sandbox."}
      </p>
      <Toggle label="Store interaction history" checked={research || options.store} disabled={research || durable} onChange={(store) => set({ store, background: store ? options.background : false, autoContinue: store ? options.autoContinue : false })} />
      <Toggle label="Continue chat context" checked={research || (options.store && options.autoContinue)} disabled={research || !options.store} onChange={(autoContinue) => set({ autoContinue, previousInteractionId: autoContinue ? "" : options.previousInteractionId })} />
      <Toggle label="Background execution" checked={research || (options.store && options.background)} disabled={research || durable || !options.store} onChange={(background) => set({ background })} />
      <Toggle label="Reuse sandbox environment" checked={options.reuseEnvironment} disabled={research} onChange={(reuseEnvironment) => set({ reuseEnvironment })} />

      <label style={{ ...row, alignItems: "flex-start", flexDirection: "column", gap: 4 }}>
        <span style={{ color: T.textDim }}>Service tier</span>
        <select value={options.serviceTier} disabled={research} onChange={(event) => set({ serviceTier: event.target.value as RunOptions["serviceTier"] })} style={input}>
          <option value="standard">Standard</option><option value="flex">Flex</option><option value="priority">Priority</option>
        </select>
      </label>
      {research && <label style={{ ...row, alignItems: "flex-start", flexDirection: "column", gap: 4, marginTop: 7 }}>
        <span style={{ color: T.textDim }}>Thinking summaries</span>
        <span>Auto</span>
      </label>}

      {!research && (
        <>
          <Toggle label="Use stored credential" checked={options.useCredential} onChange={(useCredential) => set({ useCredential })} />
          {options.useCredential && (
            <div style={{ display: "grid", gap: 7, margin: "3px 0 10px" }}>
              <label style={{ fontSize: 11.5, color: T.textDim }}>Credential ID
                <input value={options.credentialId} placeholder="my-service-connection" onChange={(event) => set({ credentialId: event.target.value })} style={{ ...input, marginTop: 4, fontFamily: T.mono }} />
              </label>
              <label style={{ fontSize: 11.5, color: T.textDim }}>API domain
                <input value={options.credentialDomain} placeholder="api.example.com" onChange={(event) => set({ credentialDomain: event.target.value })} style={{ ...input, marginTop: 4, fontFamily: T.mono }} />
              </label>
              <p style={{ margin: 0, fontSize: 11.5, color: connectionError ? T.danger : T.textFaint }} role={connectionError ? "alert" : undefined}>
                {connectionError ?? "Use a credential issued for this Gemini project. Tokens stay in the credential service."}
              </p>
            </div>
          )}
          <Toggle label="Override system instruction" checked={options.overrideSystemInstruction} onChange={(overrideSystemInstruction) => set({ overrideSystemInstruction })} />
          {options.overrideSystemInstruction && <textarea rows={3} value={options.systemInstruction} placeholder="One-off instruction for this conversation…" onChange={(event) => set({ systemInstruction: event.target.value })} style={{ ...input, resize: "vertical" }} />}
          <Toggle label="Override tools" checked={options.overrideTools} onChange={(overrideTools) => set({ overrideTools })} />
          {options.overrideTools && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "0 0 7px", color: T.textDim, fontSize: 11.5 }}>
              {tools.map((tool) => <label key={tool} style={{ cursor: "pointer" }}><input type="checkbox" checked={options.toolTypes.includes(tool)} onChange={(event) => set({ toolTypes: event.target.checked ? [...options.toolTypes, tool] : options.toolTypes.filter((item) => item !== tool) })} /> {tool.replace("_", " ")}</label>)}
            </div>
          )}
          <Toggle label="Use specific environment id" checked={options.overrideEnvironment} onChange={(overrideEnvironment) => set({ overrideEnvironment, reuseEnvironment: overrideEnvironment ? false : options.reuseEnvironment })} />
          {options.overrideEnvironment && <input value={options.environmentId} placeholder="env-…" onChange={(event) => set({ environmentId: event.target.value })} style={{ ...input, fontFamily: T.mono }} />}
          {!options.autoContinue && options.store && <input value={options.previousInteractionId} placeholder="Specific previous interaction id" onChange={(event) => set({ previousInteractionId: event.target.value })} style={{ ...input, marginTop: 7, fontFamily: T.mono }} />}
        </>
      )}
    </div>
  );
}
