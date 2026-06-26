import type { AgentProjectFileSnapshot, AgentProjectSnapshot } from "../../shared/electron-api";
import {
  newAgentInstructions,
  slug,
  type ProjectFileDraft,
  type ProjectFileKind
} from "./builderState";

export const localProjectPath = (file: ProjectFileDraft, activeEnvId?: string): string => {
  if (file.kind === "instructions") {
    return "AGENTS.md";
  }
  if (file.kind === "skill") {
    const skillName = file.name.trim();
    return skillName ? `skills/${slug(skillName, "skill")}/SKILL.md` : "skills//SKILL.md";
  }
  if (file.kind === "env") {
    // The active .env is the sandbox root file; the rest are a named local library.
    return file.id === activeEnvId ? ".env" : `env/${slug(file.name, "env")}`;
  }
  return file.target.startsWith("assets/") ? file.target : `assets/${slug(file.name, "asset")}`;
};

const projectTargetForLocalPath = (path: string): Pick<ProjectFileDraft, "kind" | "name" | "target"> => {
  if (path === "AGENTS.md") {
    return { kind: "instructions", name: "AGENTS.md", target: ".agents/AGENTS.md" };
  }
  if (path === ".env") {
    return { kind: "env", name: ".env", target: ".env" };
  }
  const envInDir = path.match(/^env\/(.+)$/);
  if (envInDir) {
    return { kind: "env", name: envInDir[1], target: ".env" };
  }
  const skill = path.match(/^skills\/([^/]+)\/SKILL\.md$/);
  if (skill) {
    return { kind: "skill", name: skill[1], target: `.agents/${skill[1]}/SKILL.md` };
  }
  const name = path.split("/").pop() ?? "asset";
  return { kind: "asset", name, target: path.startsWith("assets/") ? path : `assets/${name}` };
};

export const projectFileIssuesForFile = (file: ProjectFileDraft): string[] => {
  if (
    (file.kind === "asset" || file.kind === "skill" || file.kind === "env") &&
    file.name.trim().length === 0
  ) {
    return [`${projectKindLabel(file.kind)} file name is required.`];
  }
  return [];
};

export const projectFileIssue = (file: ProjectFileDraft): string | undefined =>
  projectFileIssuesForFile(file)[0];

export const projectFileIssues = (files: ProjectFileDraft[]): string[] =>
  files.flatMap(projectFileIssuesForFile);

export const projectFilesForSave = (
  files: ProjectFileDraft[],
  activeEnvId?: string
): AgentProjectFileSnapshot[] =>
  files
    .filter((file) => file.content.trim().length > 0 && !projectFileIssue(file))
    .map((file) => ({ path: localProjectPath(file, activeEnvId), content: file.content }));

export const projectFilesFromSnapshot = (
  snapshot: AgentProjectSnapshot,
  fallback: ProjectFileDraft[] = []
): { files: ProjectFileDraft[]; activeEnvFileId: string } => {
  if (snapshot.files.length === 0) {
    return { files: fallback, activeEnvFileId: "" };
  }
  let activeEnvFileId = "";
  const files = snapshot.files
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => {
      const meta = projectTargetForLocalPath(file.path);
      const draft = {
        id: `${meta.kind}:${file.path}`,
        ...meta,
        content: file.content
      };
      // The .env persisted at the sandbox root is the active one.
      if (meta.kind === "env" && file.path === ".env") {
        activeEnvFileId = draft.id;
      }
      return draft;
    });
  return { files, activeEnvFileId };
};

export const ensureProjectInstructions = (files: ProjectFileDraft[]): ProjectFileDraft[] =>
  files.some((file) => file.kind === "instructions") ? files : [newAgentInstructions(), ...files];

export const projectKindLabel = (kind: ProjectFileKind): string => {
  if (kind === "instructions") {
    return "AGENTS";
  }
  if (kind === "skill") {
    return "Skill";
  }
  if (kind === "env") {
    return ".env";
  }
  return "Asset";
};
