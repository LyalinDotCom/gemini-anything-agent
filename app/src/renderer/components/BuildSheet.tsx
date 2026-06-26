import { useState, type Dispatch, type SetStateAction } from "react";
import {
  AlertTriangle,
  Ban,
  BookOpen,
  Brain,
  CheckCircle2,
  Cloud,
  Cpu,
  CopyPlus,
  FileText,
  FilePlus2,
  FolderGit2,
  FolderOpen,
  Globe2,
  KeyRound,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Save,
  Server,
  Sparkles,
  Trash2,
  Wrench
} from "lucide-react";
import { managedAgentManifest, type ToolType } from "@sdk";
import { computeCardState, toolsBadgeCount } from "../lib/badges";
import {
  newNetworkRule,
  newAgentInstructions,
  newAssetFile,
  newEnvFile,
  newSourceOfType,
  resolveActiveEnvFile,
  slug,
  uid,
  uniqueEnvName,
  type BuilderDraft,
  type NetworkMode,
  type ProjectFileDraft,
  type SourceDraft,
  type SourceDraftType
} from "../lib/builderState";
import { localProjectPath, projectFileIssue, projectKindLabel } from "../lib/projectFiles";
import { skillLibrary, skillTemplateToProjectFile } from "../lib/skillLibrary";
import { CapabilityCard } from "./CapabilityCard";
import { IconButton, Segmented, TextArea, TextField } from "./primitives";

type Setter = Dispatch<SetStateAction<BuilderDraft>>;
type IconType = typeof Brain;

const SOURCE_ICON: Record<SourceDraftType, IconType> = {
  inline: FileText,
  repository: FolderGit2,
  gcs: Cloud
};

const TOOL_ICON: Record<ToolType, IconType> = {
  code_execution: Cpu,
  google_search: Globe2,
  url_context: Cloud
};

const PROJECT_ICON: Record<ProjectFileDraft["kind"], IconType> = {
  instructions: BookOpen,
  skill: Sparkles,
  env: KeyRound,
  asset: Package
};

const retargetProjectFile = (file: ProjectFileDraft, name: string): ProjectFileDraft => {
  if (file.kind === "instructions") {
    return { ...file, name: "AGENTS.md", target: ".agents/AGENTS.md" };
  }
  if (file.kind === "skill") {
    const skillName = name.trim();
    return {
      ...file,
      name,
      target: skillName ? `.agents/${slug(skillName, "skill")}/SKILL.md` : ".agents//SKILL.md"
    };
  }
  if (file.kind === "env") {
    return { ...file, name, target: ".env" };
  }
  const fileName = name.trim();
  return { ...file, name, target: file.target.startsWith("assets/") ? `assets/${fileName}` : file.target };
};

const ProjectFilesControl = ({
  builder,
  setBuilder,
  rootPath,
  onOpenProject,
  onReloadProject
}: {
  builder: BuilderDraft;
  setBuilder: Setter;
  rootPath?: string;
  onOpenProject: () => void;
  onReloadProject: () => void;
}) => {
  const [selectedId, setSelectedId] = useState(builder.projectFiles[0]?.id ?? "");
  const selected = builder.projectFiles.find((file) => file.id === selectedId) ?? builder.projectFiles[0];
  const activeEnvId = resolveActiveEnvFile(builder)?.id;

  const updateFile = (id: string, patch: (file: ProjectFileDraft) => ProjectFileDraft) =>
    setBuilder((current) => ({
      ...current,
      projectFiles: current.projectFiles.map((file) => (file.id === id ? patch(file) : file))
    }));

  const addFile = (file: ProjectFileDraft) => {
    setBuilder((current) => ({ ...current, projectFiles: [...current.projectFiles, file] }));
    setSelectedId(file.id);
  };

  const addEnvFile = () => {
    const file = newEnvFile(uniqueEnvName(builder.projectFiles));
    setBuilder((current) => {
      const firstEnv = !current.projectFiles.some((item) => item.kind === "env");
      return {
        ...current,
        projectFiles: [...current.projectFiles, file],
        // The first .env you add becomes the one baked into runs.
        activeEnvFileId: firstEnv ? file.id : current.activeEnvFileId
      };
    });
    setSelectedId(file.id);
  };

  const setActiveEnv = (id: string) =>
    setBuilder((current) => ({ ...current, activeEnvFileId: id }));

  const installSkill = (skillId: string) => {
    const skill = skillLibrary.find((item) => item.id === skillId);
    if (!skill) {
      return;
    }
    const file = skillTemplateToProjectFile(skill);
    setBuilder((current) => ({
      ...current,
      projectFiles: [
        ...current.projectFiles.filter((item) => item.kind !== "skill" || item.name !== file.name),
        file
      ]
    }));
    setSelectedId(file.id);
  };

  const removeFile = (id: string) => {
    const file = builder.projectFiles.find((item) => item.id === id);
    const label = file?.name || "this project file";
    if (!window.confirm(`Remove "${label}" from this agent project?`)) {
      return;
    }
    setBuilder((current) => {
      const projectFiles = current.projectFiles.filter((file) => file.id !== id);
      // Removing the active .env hands the role to the next remaining .env.
      const activeEnvFileId =
        current.activeEnvFileId === id
          ? projectFiles.find((file) => file.kind === "env")?.id ?? ""
          : current.activeEnvFileId;
      return { ...current, projectFiles, activeEnvFileId };
    });
  };

  return (
    <div className="project-editor">
      <div className="project-toolbar">
        <div className="project-path">
          <span className="sub-label-text">Project folder</span>
          <code>{rootPath || "agent-projects/" + (builder.id.trim() || "untitled-agent")}</code>
        </div>
        <div className="project-toolbar-actions">
          <button type="button" className="ghost-button sm" onClick={onReloadProject}>
            <RefreshCw size={13} /> Reload
          </button>
          <button type="button" className="ghost-button sm" onClick={onOpenProject}>
            <FolderOpen size={13} /> Open
          </button>
        </div>
      </div>

      <div className="project-layout">
        <div className="project-files" role="listbox">
          {builder.projectFiles.map((file) => {
            const Icon = PROJECT_ICON[file.kind];
            const selectedFile = selected?.id === file.id;
            return (
              <button
                type="button"
                key={file.id}
                className={`project-file-row ${selectedFile ? "selected" : ""}`}
                onClick={() => setSelectedId(file.id)}
              >
                <Icon size={14} />
                <strong>{file.name || "(name required)"}</strong>
                <span>
                  {projectKindLabel(file.kind)}
                  {file.kind === "env" && file.id === activeEnvId ? " · active" : ""}
                </span>
              </button>
            );
          })}
          <div className="project-add">
            {!builder.projectFiles.some((file) => file.kind === "instructions") && (
              <button type="button" className="ghost-button sm" onClick={() => addFile(newAgentInstructions())}>
                <BookOpen size={13} /> AGENTS.md
              </button>
            )}
            <button type="button" className="ghost-button sm" onClick={addEnvFile}>
              <KeyRound size={13} /> .env
            </button>
            <button type="button" className="ghost-button sm" onClick={() => addFile(newAssetFile())}>
              <FilePlus2 size={13} /> Asset
            </button>
          </div>
          <div className="skill-library">
            <span className="sub-label-text">Install skills</span>
            {skillLibrary.map((skill) => {
              const installed = builder.projectFiles.some((file) => file.kind === "skill" && file.name === skill.name);
              return (
                <button
                  type="button"
                  key={skill.id}
                  className={`skill-install ${installed ? "installed" : ""}`}
                  onClick={() => installSkill(skill.id)}
                >
                  <Sparkles size={13} />
                  <div>
                    <strong>{skill.label}</strong>
                    <span>{installed ? "Installed" : skill.description}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {selected ? (
          <div className="project-file-editor">
            <div className="project-file-meta">
              <span className={`mini-badge badge-${selected.kind === "asset" ? "addon" : selected.kind === "env" ? "secret" : "custom"}`}>
                {projectKindLabel(selected.kind)}
              </span>
              <code>{localProjectPath(selected, activeEnvId)}</code>
              {selected.kind !== "instructions" && (
                <IconButton title="Remove project file" tone="danger" onClick={() => removeFile(selected.id)}>
                  <Trash2 size={14} />
                </IconButton>
              )}
            </div>
            {selected.kind !== "instructions" && (
              <TextField
                label={selected.kind === "skill" ? "Skill name" : "File name"}
                value={selected.name}
                mono
                hint={
                  selected.kind === "env"
                    ? projectFileIssue(selected) ?? "Name this .env (e.g. .env, .env.staging)."
                    : projectFileIssue(selected) ?? "One or more characters required."
                }
                onChange={(name) => updateFile(selected.id, (file) => retargetProjectFile(file, name))}
              />
            )}
            {selected.kind === "env" && (
              <div className="env-active-row">
                {selected.id === activeEnvId ? (
                  <span className="mini-badge badge-custom">
                    <CheckCircle2 size={12} /> Active for runs
                  </span>
                ) : (
                  <button type="button" className="ghost-button sm" onClick={() => setActiveEnv(selected.id)}>
                    <CheckCircle2 size={13} /> Use for runs
                  </button>
                )}
                <span className="inline-note">Only the active .env is sent; switch any time.</span>
              </div>
            )}
            {selected.kind !== "env" && (
              <TextField
                label="Sandbox target"
                value={selected.target}
                mono
                readOnly={selected.kind !== "asset"}
                hint={selected.kind === "asset" ? "Asset files are copied into this path in the run sandbox." : undefined}
                onChange={(target) => updateFile(selected.id, (file) => ({ ...file, target }))}
              />
            )}
            {selected.kind === "env" && (
              <p className="inline-note warn">
                <KeyRound size={12} /> Plaintext in this local project; the active .env is copied to the sandbox root as <code>.env</code>.
              </p>
            )}
            <TextArea
              label="Content"
              value={selected.content}
              rows={selected.kind === "env" ? 10 : selected.kind === "asset" ? 8 : 12}
              mono
              placeholder={
                selected.kind === "env"
                  ? "KEY=value, one per line. Treated as a plain .env text file."
                  : selected.kind === "asset"
                    ? "Paste CSV, JSON, markdown, or other text asset content."
                    : "Write the markdown that defines this agent behavior."
              }
              onChange={(content) => updateFile(selected.id, (file) => ({ ...file, content }))}
            />
          </div>
        ) : (
          <div className="project-empty">
            <BookOpen size={18} />
            <span>No project files yet.</span>
          </div>
        )}
      </div>
    </div>
  );
};

const SourceEditor = ({
  source,
  onChange,
  onRemove
}: {
  source: SourceDraft;
  onChange: (source: SourceDraft) => void;
  onRemove: () => void;
}) => {
  const Icon = SOURCE_ICON[source.type];
  const meta = managedAgentManifest.sourceTypes.find((item) => item.type === source.type);
  return (
    <div className="addon-card">
      <div className="addon-head">
        <Icon size={15} />
        <strong>{meta?.label}</strong>
        <span className="limit-pill">{meta?.limit}</span>
        <IconButton
          title="Remove source"
          tone="danger"
          onClick={() => {
            const label = source.source || source.target || "this source";
            if (window.confirm(`Remove source "${label}"?`)) {
              onRemove();
            }
          }}
        >
          <Trash2 size={14} />
        </IconButton>
      </div>
      <Segmented
        value={source.type}
        options={managedAgentManifest.sourceTypes.map((item) => ({
          value: item.type as SourceDraftType,
          label: item.label
        }))}
        onChange={(type) => onChange(newSourceOfType(type))}
      />
      {source.type !== "inline" && (
        <TextField
          label={source.type === "gcs" ? "GCS source (gs://…)" : "Repository URL"}
          value={source.source}
          mono
          onChange={(value) => onChange({ ...source, source: value })}
        />
      )}
      <TextField
        label="Target path in sandbox"
        value={source.target}
        mono
        onChange={(target) => onChange({ ...source, target })}
      />
      {source.type === "inline" && (
        <TextArea
          label="File content"
          value={source.content}
          rows={5}
          mono
          onChange={(content) => onChange({ ...source, content })}
        />
      )}
    </div>
  );
};

const NetworkControl = ({ builder, setBuilder }: { builder: BuilderDraft; setBuilder: Setter }) => {
  const network = computeCardState(builder, "network");
  return (
    <div className="network-control">
      <div className="sub-label">
        <span>Network access</span>
        {builder.networkMode !== "unrestricted" && <span className={`mini-badge badge-${network.state}`}>{builder.networkMode}</span>}
      </div>
      <Segmented
        value={builder.networkMode}
        options={managedAgentManifest.networkModes.map((mode) => ({
          value: mode.id as NetworkMode,
          label: mode.label
        }))}
        onChange={(networkMode) => setBuilder((current) => ({ ...current, networkMode }))}
      />
      {builder.networkMode === "unrestricted" && (
        <p className="inline-note">Omitted → unrestricted outbound network access (the default).</p>
      )}
      {builder.networkMode === "disabled" && (
        <p className="inline-note warn">
          <Ban size={12} /> No outbound network. The agent cannot reach the internet.
        </p>
      )}
      {builder.networkMode === "allowlist" && (
        <div className="network-rules">
          <p className="inline-note warn">
            <AlertTriangle size={12} /> Only the domains you list are reachable. Everything else is blocked.
          </p>
          {builder.networkRules.map((rule) => (
            <div className="rule-card" key={rule.id}>
              <div className="rule-row">
                <TextField
                  label="Domain"
                  value={rule.domain}
                  mono
                  onChange={(domain) =>
                    setBuilder((current) => ({
                      ...current,
                      networkRules: current.networkRules.map((item) =>
                        item.id === rule.id ? { ...item, domain } : item
                      )
                    }))
                  }
                />
                <IconButton
                  title="Remove domain"
                  tone="danger"
                  onClick={() =>
                    window.confirm(`Remove "${rule.domain}" from the network allowlist?`) &&
                    setBuilder((current) => ({
                      ...current,
                      networkRules: current.networkRules.filter((item) => item.id !== rule.id)
                    }))
                  }
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
              {rule.headers.map((header) => (
                <div className="rule-row" key={header.id}>
                  <TextField
                    label="Header"
                    value={header.key}
                    mono
                    onChange={(key) =>
                      setBuilder((current) => ({
                        ...current,
                        networkRules: current.networkRules.map((item) =>
                          item.id === rule.id
                            ? {
                                ...item,
                                headers: item.headers.map((entry) =>
                                  entry.id === header.id ? { ...entry, key } : entry
                                )
                              }
                            : item
                        )
                      }))
                    }
                  />
                  <TextField
                    label="Value"
                    value={header.value}
                    mono
                    onChange={(value) =>
                      setBuilder((current) => ({
                        ...current,
                        networkRules: current.networkRules.map((item) =>
                          item.id === rule.id
                            ? {
                                ...item,
                                headers: item.headers.map((entry) =>
                                  entry.id === header.id ? { ...entry, value } : entry
                                )
                              }
                            : item
                        )
                      }))
                    }
                  />
                </div>
              ))}
              <button
                type="button"
                className="ghost-button sm"
                onClick={() =>
                  setBuilder((current) => ({
                    ...current,
                    networkRules: current.networkRules.map((item) =>
                      item.id === rule.id
                        ? {
                            ...item,
                            headers: [...item.headers, { id: uid(), key: "Authorization", value: "Bearer ${TOKEN}" }]
                          }
                        : item
                    )
                  }))
                }
              >
                <Plus size={13} /> Inject header
              </button>
            </div>
          ))}
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              setBuilder((current) => ({ ...current, networkRules: [...current.networkRules, newNetworkRule()] }))
            }
          >
            <Plus size={13} /> Allow a domain
          </button>
        </div>
      )}
    </div>
  );
};

export const BuildSheet = ({
  builder,
  setBuilder,
  issues,
  valid,
  hasKey,
  idExists,
  editingAgentId,
  dirty,
  readyToRun,
  nextVersionId,
  creating,
  projectRootPath,
  onCreate,
  onSave,
  onCreateVersion,
  onCancel,
  onOpenProject,
  onReloadProject
}: {
  builder: BuilderDraft;
  setBuilder: Setter;
  issues: string[];
  valid: boolean;
  hasKey: boolean;
  idExists: boolean;
  editingAgentId: string | null;
  dirty: boolean;
  readyToRun: boolean;
  nextVersionId: string;
  creating: boolean;
  projectRootPath?: string;
  onCreate: () => void;
  onSave: () => void;
  onCreateVersion: () => void;
  onCancel: () => void;
  onOpenProject: () => void;
  onReloadProject: () => void;
}) => {
  const [editingBrain, setEditingBrain] = useState(false);
  const [editingEnv, setEditingEnv] = useState(false);

  const brain = computeCardState(builder, "brain");
  const tools = computeCardState(builder, "tools");
  const environment = computeCardState(builder, "environment");

  const brainOpen = editingBrain || builder.systemInstruction.trim().length > 0;
  const envOpen = editingEnv || builder.environmentMode !== "remote";
  const normalizedId = builder.id.trim();
  const isEditing = Boolean(editingAgentId);
  const editingSameId = Boolean(editingAgentId && normalizedId === editingAgentId);
  const editingRenamed = Boolean(editingAgentId && normalizedId !== editingAgentId);
  const idConflict = idExists && !editingSameId;
  const savedLabel = readyToRun ? "Saved" : dirty ? "Unsaved edits" : "Loaded";

  return (
    <section className="build-sheet">
      <div className="build-header">
        <div className="build-header-top">
          <span className={`validity ${!valid ? "bad" : readyToRun ? "ok" : "warn"}`}>
            {!valid ? <AlertTriangle size={14} /> : readyToRun ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {!valid
              ? `${issues.length} issue${issues.length === 1 ? "" : "s"}`
              : readyToRun
                ? savedLabel
                : idConflict
                  ? "Id taken"
                  : isEditing
                    ? savedLabel
                    : idExists
                      ? "Version needed"
                      : "Draft"}
          </span>
        </div>
        {isEditing && (
          <p className="flow-note">
            Save updates this agent; Create version saves a separate copy.
          </p>
        )}
      </div>

      <div className="build-cards">
        <CapabilityCard
          state={builder.projectFiles.length ? "custom" : "default"}
          icon={FolderGit2}
          title="Agent project"
          subtitle="Markdown, skills, and assets"
          omittedNote="No project files are attached to this agent."
          open
        >
          <ProjectFilesControl
            builder={builder}
            setBuilder={setBuilder}
            rootPath={projectRootPath}
            onOpenProject={onOpenProject}
            onReloadProject={onReloadProject}
          />
        </CapabilityCard>

        <CapabilityCard state="required" icon={Sparkles} title="Identity">
          <TextField
            label="Agent id"
            value={builder.id}
            meter={`${builder.id.length}/128`}
            mono
            hint={
              idConflict
                ? "This id belongs to another saved agent."
                : isEditing
                  ? "Changing this id renames the selected saved agent when you save."
                  : idExists
                    ? "This id already exists. Create the next version to save changes."
                    : "Unique id used to create and run this agent."
            }
            onChange={(id) => setBuilder((current) => ({ ...current, id }))}
          />
          <TextField
            label="Description"
            value={builder.description}
            placeholder="Optional — a short human note"
            onChange={(description) => setBuilder((current) => ({ ...current, description }))}
          />
          <div className="fixed-row">
            <Cpu size={14} />
            <div>
              <span className="fixed-key">base_agent</span>
              <code>{managedAgentManifest.baseAgents[0].id}</code>
            </div>
            <span className="mini-badge badge-fixed">Fixed</span>
          </div>
        </CapabilityCard>

        <CapabilityCard
          state={brain.state}
          icon={Brain}
          title="System instruction"
          omittedNote={brain.omittedNote}
          open={brainOpen}
          customizeLabel="Write an instruction"
          onCustomize={() => setEditingBrain(true)}
          onReset={() => {
            setBuilder((current) => ({ ...current, systemInstruction: "" }));
            setEditingBrain(false);
          }}
        >
          <TextArea
            value={builder.systemInstruction}
            rows={7}
            placeholder="You are a careful data analyst…"
            onChange={(systemInstruction) => setBuilder((current) => ({ ...current, systemInstruction }))}
          />
        </CapabilityCard>

        <CapabilityCard
          state={tools.state}
          icon={Wrench}
          title="Tools"
          omittedNote={tools.omittedNote}
          count={toolsBadgeCount(builder)}
          customizeLabel="Override tools"
          onCustomize={() => setBuilder((current) => ({ ...current, toolMode: "custom" }))}
          onReset={() => setBuilder((current) => ({ ...current, toolMode: "default" }))}
        >
          <p className="inline-note warn">
            <AlertTriangle size={12} /> Sending a tools list <b>overrides</b> the defaults — anything left off is turned OFF.
          </p>
          <div className="tool-rows">
            {managedAgentManifest.tools.map((tool) => {
              const Icon = TOOL_ICON[tool.type];
              const enabled = builder.selectedTools[tool.type];
              return (
                <button
                  key={tool.type}
                  type="button"
                  className={`tool-row ${enabled ? "on" : ""}`}
                  onClick={() =>
                    setBuilder((current) => ({
                      ...current,
                      selectedTools: { ...current.selectedTools, [tool.type]: !current.selectedTools[tool.type] }
                    }))
                  }
                >
                  <Icon size={16} />
                  <div>
                    <strong>{tool.label}</strong>
                    <span>{tool.detail}</span>
                  </div>
                  <span className={`tool-state ${enabled ? "on" : ""}`}>{enabled ? "ON" : "OFF"}</span>
                </button>
              );
            })}
          </div>
        </CapabilityCard>

        <CapabilityCard
          state={environment.state}
          icon={Server}
          title="Environment"
          omittedNote={environment.omittedNote}
          open={envOpen}
          customizeLabel="Configure environment"
          onCustomize={() => setEditingEnv(true)}
          onReset={() => {
            setBuilder((current) => ({ ...current, environmentMode: "remote" }));
            setEditingEnv(false);
          }}
        >
          <Segmented
            value={builder.environmentMode}
            options={managedAgentManifest.environmentForms.map((form) => ({
              value: form.id as BuilderDraft["environmentMode"],
              label: form.label
            }))}
            onChange={(environmentMode) => setBuilder((current) => ({ ...current, environmentMode }))}
          />

          {builder.environmentMode === "remote" && (
            <p className="inline-note">
              A fresh remote sandbox is created for every run; project files are copied into it.
            </p>
          )}

          {builder.environmentMode === "environment_id" && (
            <TextField
              label="Environment id to reuse / fork"
              value={builder.environmentId}
              mono
              placeholder="env-…"
              hint="Reuse a sandbox produced by an earlier interaction."
              onChange={(environmentId) => setBuilder((current) => ({ ...current, environmentId }))}
            />
          )}

          {builder.environmentMode === "config" && (
            <div className="env-config">
              <div className="addon-tray">
                <div className="sub-label">
                  <span>External sources</span>
                  <span className="mini-badge badge-addon">Add-on</span>
                </div>
                {builder.sources.length === 0 && (
                  <p className="inline-note">No external repository or GCS sources.</p>
                )}
                {builder.sources.map((source) => (
                  <SourceEditor
                    key={source.id}
                    source={source}
                    onChange={(next) =>
                      setBuilder((current) => ({
                        ...current,
                        sources: current.sources.map((item) => (item.id === source.id ? next : item))
                      }))
                    }
                    onRemove={() =>
                      setBuilder((current) => ({
                        ...current,
                        sources: current.sources.filter((item) => item.id !== source.id)
                      }))
                    }
                  />
                ))}
                <div className="add-source-row">
                  {(["inline", "repository", "gcs"] as SourceDraftType[]).map((type) => {
                    const Icon = SOURCE_ICON[type];
                    const meta = managedAgentManifest.sourceTypes.find((item) => item.type === type);
                    return (
                      <button
                        key={type}
                        type="button"
                        className="add-tile"
                        onClick={() =>
                          setBuilder((current) => ({ ...current, sources: [...current.sources, newSourceOfType(type)] }))
                        }
                      >
                        <Plus size={12} />
                        <Icon size={13} />
                        {meta?.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <NetworkControl builder={builder} setBuilder={setBuilder} />
            </div>
          )}
        </CapabilityCard>
      </div>

      <div className="build-footer">
        {!valid && issues.length > 0 && (
          <div className="footer-issues" title={issues.join("\n")}>
            <AlertTriangle size={13} />
            {issues[0]}
            {issues.length > 1 ? ` (+${issues.length - 1} more)` : ""}
          </div>
        )}
        {isEditing ? (
          <>
            <p className={`save-state ${readyToRun ? "ok" : idConflict ? "warn" : ""}`}>
              {readyToRun ? <CheckCircle2 size={13} /> : idConflict ? <AlertTriangle size={13} /> : <Save size={13} />}
              {readyToRun
                ? "Saved. Run it from the Runs view, or edit settings here."
                : idConflict
                  ? "That id already exists. Pick a unique id before saving this agent."
                  : editingRenamed
                    ? `Save will rename ${editingAgentId} to ${normalizedId || "untitled-agent"}.`
                    : "Unsaved changes. Save replaces the selected managed agent."}
            </p>
            <button
              type="button"
              className="primary-action wide"
              disabled={!valid || creating || readyToRun || idConflict}
              onClick={onSave}
            >
              {creating ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              {readyToRun ? "Saved" : "Save changes"}
            </button>
            <button
              type="button"
              className="ghost-button wide"
              disabled={!valid || creating || idConflict}
              onClick={onCreateVersion}
              title={`Create version ${nextVersionId}`}
            >
              <CopyPlus size={14} />
              Create version {nextVersionId}
            </button>
            <button type="button" className="ghost-button wide" disabled={creating} onClick={onCancel}>
              <Ban size={14} />
              Cancel
            </button>
          </>
        ) : idExists ? (
          <>
            <p className={`save-state ${readyToRun ? "ok" : "warn"}`}>
              {readyToRun ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              {readyToRun
                ? "Current id is created. Run it on the right, or create a new version for changes."
                : "This id already exists. Create a new version before running these draft changes."}
            </p>
            <button
              type="button"
              className="primary-action wide"
              disabled={!valid || creating}
              onClick={onCreateVersion}
              title={`Create version ${nextVersionId}`}
            >
              {creating ? <Loader2 className="spin" size={16} /> : <CopyPlus size={16} />}
              Create version {nextVersionId}
            </button>
            <button type="button" className="ghost-button wide" disabled={creating} onClick={onCancel}>
              <Ban size={14} />
              Cancel
            </button>
          </>
        ) : (
          <>
            <p className="save-state">
              <Save size={13} /> This is a draft. Create it before running.
            </p>
            <button type="button" className="primary-action wide" disabled={!valid || creating} onClick={onCreate}>
              {creating ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              Create saved agent
            </button>
            <button type="button" className="ghost-button wide" disabled={creating} onClick={onCancel}>
              <Ban size={14} />
              Cancel
            </button>
          </>
        )}
        {!hasKey && <p className="key-hint">No API key set — add one in Settings to create & run for real.</p>}
      </div>
    </section>
  );
};
