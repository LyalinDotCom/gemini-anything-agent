import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { config as loadEnv } from "dotenv";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ANTIGRAVITY_BASE_AGENT,
  GEMINI_API_BASE_URL,
  GEMINI_API_REVISION,
  GeminiApiError,
  GeminiManagedAgentsClient,
  normalizeAgentDefinition,
  type AgentDefinition,
  type AgentListResponse,
  type Interaction,
  type InteractionCreateRequest,
  type InteractionStreamEvent,
  type ManagedAgent
} from "../sdk";
import {
  ipcChannels,
  type AgentProjectFileSnapshot,
  type AgentProjectSnapshot,
  type EnvironmentOutputFile,
  type EnsureAnythingAgentResult,
  type IpcError,
  type IpcResult,
  type ResolvedEnvironmentMedia,
  type SaveResolvedMediaResult,
  type SaveTextResult,
  type SetApiKeyResult,
  type SnapshotDownloadResult
} from "../shared/electron-api";

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const MEDIA_PROTOCOL = "gemini-media";

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

const DEFAULT_AGENT_ID = "gemini-anything-agent";
const DEFAULT_NPM_PACKAGE = "@lyalindotcom/gai";
const DEFAULT_NPM_VERSION = "latest";

const snapshotTarPath = (cacheRoot: string): string => join(cacheRoot, `snapshot-${randomUUID()}.tar`);
const tarEntriesPath = (cacheRoot: string): string => join(cacheRoot, `snapshot-entries-${randomUUID()}.txt`);

const CWD = process.cwd();
const REPO_ROOT = existsSync(join(CWD, "app", "package.json"))
  ? CWD
  : existsSync(join(CWD, "..", "cli", "package.json"))
    ? join(CWD, "..")
    : CWD;
const APP_ROOT = existsSync(join(REPO_ROOT, "app", "package.json"))
  ? join(REPO_ROOT, "app")
  : CWD;
const ROOT_ENV_PATH = join(REPO_ROOT, ".env");
const ROOT_ENV_LOCAL_PATH = join(REPO_ROOT, ".env.local");
const ENV_PATH = join(APP_ROOT, ".env");
const ENV_LOCAL_PATH = join(APP_ROOT, ".env.local");
const PROJECTS_ROOT = join(APP_ROOT, "agent-projects");
const AGENT_ASSETS_ROOT = join(REPO_ROOT, "agents");
const APP_ICON_PNG_PATH = join(APP_ROOT, "assets", "app-icon.png");
const APP_ICON_PATH = process.platform === "darwin"
  ? join(APP_ROOT, "assets", "app-icon.icns")
  : APP_ICON_PNG_PATH;
const LOCAL_OUTPUT_ROOT = join(REPO_ROOT, "outputs", "managed-agent");
const mediaCacheRoot = (): string => join(app.getPath("userData"), "environment-media");

const loadEnvIfPresent = (path: string, override = false): void => {
  if (existsSync(path)) {
    loadEnv({ path, override });
  }
};

loadEnvIfPresent(ROOT_ENV_PATH);
loadEnvIfPresent(ROOT_ENV_LOCAL_PATH, true);
loadEnvIfPresent(ENV_PATH, true);
loadEnvIfPresent(ENV_LOCAL_PATH, true);

const createClient = (): GeminiManagedAgentsClient =>
  new GeminiManagedAgentsClient({
    apiKey: envValue(process.env.GEMINI_API_KEY),
    baseUrl: process.env.GEMINI_API_BASE_URL ?? GEMINI_API_BASE_URL,
    apiRevision: process.env.GEMINI_API_REVISION ?? GEMINI_API_REVISION
  });

const maskKey = (key?: string): string | undefined => {
  if (!key) {
    return undefined;
  }
  if (key.length <= 8) {
    return "•".repeat(key.length);
  }
  const middle = "•".repeat(Math.min(key.length - 8, 12));
  return `${key.slice(0, 4)}${middle}${key.slice(-4)}`;
};

const envValue = (value: string | undefined): string =>
  (value ?? "")
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2")
    .replace(/[\r\n]/g, "");

const envValueOrDefault = (value: string | undefined, fallback: string): string =>
  envValue(value) || fallback;

const sandboxEnvContent = (): string =>
  [
    `GEMINI_API_KEY=${envValue(process.env.GEMINI_API_KEY)}`,
    `GEMINI_ANYTHING_NPM_PACKAGE=${envValueOrDefault(process.env.GEMINI_ANYTHING_NPM_PACKAGE, DEFAULT_NPM_PACKAGE)}`,
    `GEMINI_ANYTHING_NPM_VERSION=${envValueOrDefault(process.env.GEMINI_ANYTHING_NPM_VERSION, DEFAULT_NPM_VERSION)}`,
    `GEMINI_ANYTHING_TRANSCRIBE_MODEL=${envValueOrDefault(process.env.GEMINI_ANYTHING_TRANSCRIBE_MODEL, "gemini-3.5-flash")}`
  ].join("\n") + "\n";

const readAgentAsset = (relativePath: string, fallback: string): string => {
  const path = join(AGENT_ASSETS_ROOT, relativePath);
  return existsSync(path) ? readFileSync(path, "utf8") : fallback;
};

const defaultAnythingSystemInstruction =
  "You are Gemini Anything Agent. Use native tools for text, coding, planning, research, file work, and artifact transformations. Use gai only for new image, video, text-to-speech generation, and audio transcription. For transcription, save a transcript file and report its path instead of pasting transcript contents.";

const anythingAgentId = (): string => process.env.GEMINI_ANYTHING_AGENT_ID?.trim() || DEFAULT_AGENT_ID;

const isAnythingAgentRequest = (request: InteractionCreateRequest): boolean =>
  request.agent.trim() === anythingAgentId();

const currentInvocationContext = (): string => {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  return [
    "## Current Invocation Context",
    "",
    `- Host current date/time: ${now.toLocaleString()} (${timeZone})`,
    `- UTC date/time: ${now.toISOString()}`,
    "- You are running as a remote Gemini Managed Agent in a Google-hosted Linux sandbox.",
    "- Workspace root in the sandbox: `/workspace`.",
    "- Durable artifact folder in the sandbox: `/workspace/output`.",
    "- Mounted agent instruction files: `/.agents/AGENTS.md` and `/.agents/skills/gemini-anything/SKILL.md`.",
    "- Mounted media CLI wrapper: `/.agents/bin/gai`.",
    "- Follow-up turns may include two independent continuity pointers: `previous_interaction_id` for conversation context and `environment` for sandbox/filesystem state.",
    "- If a request depends on existing artifacts, inspect `/workspace/output` before choosing tools.",
    "- If exact current date/time or live facts matter, verify with `date`, `date -u`, and web/search as appropriate.",
    ""
  ].join("\n");
};

const anythingSystemInstructionForRequest = (request: InteractionCreateRequest): string => {
  const base = readAgentAsset("system-prompt.md", defaultAnythingSystemInstruction);
  const override = request.system_instruction?.trim();
  return [
    base,
    currentInvocationContext(),
    override
      ? [
          "## Additional Per-Interaction Instruction",
          "",
          "The following instruction was explicitly supplied for this interaction. Apply it unless it conflicts with higher-priority safety, runtime, artifact, or tool-routing rules above.",
          "",
          override
        ].join("\n")
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");
};

const augmentInteractionRequest = (request: InteractionCreateRequest): InteractionCreateRequest =>
  isAnythingAgentRequest(request)
    ? {
        ...request,
        system_instruction: anythingSystemInstructionForRequest(request)
      }
    : request;

const comparableAgentDefinition = (agent: ManagedAgent | AgentDefinition): AgentDefinition =>
  normalizeAgentDefinition({
    id: agent.id,
    description: agent.description,
    base_agent: agent.base_agent,
    system_instruction: agent.system_instruction,
    tools: agent.tools,
    base_environment: agent.base_environment
  });

const isEnvTarget = (target: string): boolean =>
  basename(target.replace(/\\/g, "/")) === ".env";

const redactEnvContent = (content: string): string =>
  content.replace(/^([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*)=.*$/gim, "$1=<configured>");

const redactEnvironmentSecrets = <T extends AgentDefinition | ManagedAgent>(agent: T): T => {
  if (typeof agent.base_environment !== "object" || !Array.isArray(agent.base_environment?.sources)) {
    return agent;
  }

  return {
    ...agent,
    base_environment: {
      ...agent.base_environment,
      sources: agent.base_environment.sources.map((source) =>
        source.type === "inline" && isEnvTarget(source.target)
          ? {
              ...source,
              content: redactEnvContent(source.content)
            }
          : source
      )
    }
  };
};

const redactDefinitionSecrets = (agent: AgentDefinition): AgentDefinition => {
  const comparable = redactEnvironmentSecrets(comparableAgentDefinition(agent));
  delete comparable.description;
  return comparable;
};

const redactAgentForRenderer = (agent: ManagedAgent): ManagedAgent =>
  redactEnvironmentSecrets(agent);

const redactAgentListForRenderer = (response: AgentListResponse): AgentListResponse => ({
  ...response,
  agents: response.agents?.map(redactAgentForRenderer)
});

const agentConfigHash = (agent: AgentDefinition): string =>
  createHash("sha256").update(JSON.stringify(redactDefinitionSecrets(agent))).digest("hex").slice(0, 12);

const buildAnythingAgentDefinition = (agentId: string): AgentDefinition => {
  const definition: AgentDefinition = {
    id: agentId,
    base_agent: ANTIGRAVITY_BASE_AGENT,
    system_instruction: readAgentAsset("system-prompt.md", defaultAnythingSystemInstruction),
    tools: [
      { type: "code_execution" },
      { type: "google_search" },
      { type: "url_context" }
    ],
    base_environment: {
      type: "remote",
      sources: [
        {
          type: "inline",
          target: ".agents/bin/gai",
          content: readAgentAsset(
            "bin/gai",
            [
              "#!/usr/bin/env bash",
              "set -euo pipefail",
              "if [ \"${GEMINI_API_KEY:-}\" = \"PLACEHOLDER\" ]; then unset GEMINI_API_KEY; fi",
              "if [ -f /.env ]; then set -a; . /.env; set +a; fi",
              "if [ \"${GEMINI_API_KEY:-}\" = \"PLACEHOLDER\" ]; then unset GEMINI_API_KEY; fi",
              "export NODE_USE_ENV_PROXY=\"${NODE_USE_ENV_PROXY:-1}\"",
              "exec npx -y \"${GEMINI_ANYTHING_NPM_PACKAGE:-@lyalindotcom/gai}@${GEMINI_ANYTHING_NPM_VERSION:-latest}\" \"$@\"",
              ""
            ].join("\n")
          )
        },
        {
          type: "inline",
          target: ".agents/AGENTS.md",
          content: readAgentAsset(
            "AGENTS.md",
            "# Gemini Anything Agent\n\nUse native managed-agent tools for normal work. Use gai only for image, video, text-to-speech, and audio transcription. For transcription, write a file and report its path instead of pasting transcript contents.\n"
          )
        },
        {
          type: "inline",
          target: ".agents/skills/gemini-anything/SKILL.md",
          content: readAgentAsset(
            "skills/gemini-anything/SKILL.md",
            "# Gemini Anything Media Skill\n\nUse bash /.agents/bin/gai for image, video, tts generation, and audio transcription. For transcription, write a file and report its path instead of pasting transcript contents.\n"
          )
        },
        {
          type: "inline",
          target: ".env",
          content: sandboxEnvContent()
        }
      ]
    }
  };

  return {
    ...definition,
    description: `Gemini Anything managed agent with media generation routed through gai. config:${agentConfigHash(definition)}`
  };
};

const agentDefinitionsMatch = (actual: ManagedAgent, desired: AgentDefinition): boolean =>
  actual.description?.includes(`config:${agentConfigHash(desired)}`) ||
  JSON.stringify(comparableAgentDefinition(actual)) === JSON.stringify(comparableAgentDefinition(desired));

const isMissingAgentError = (error: unknown): boolean =>
  error instanceof GeminiApiError
    ? error.status === 404 || /unknown agent name|not found/i.test(error.message)
    : error instanceof Error && /unknown agent name|not found/i.test(error.message);

const MEDIA_EXTENSIONS = new Map<string, ResolvedEnvironmentMedia["mediaType"]>([
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".webp", "image"],
  [".gif", "image"],
  [".avif", "image"],
  [".svg", "image"],
  [".mp4", "video"],
  [".webm", "video"],
  [".mov", "video"],
  [".m4v", "video"],
  [".wav", "audio"],
  [".mp3", "audio"],
  [".m4a", "audio"],
  [".aac", "audio"],
  [".ogg", "audio"],
  [".flac", "audio"]
]);

const mediaTypeForPath = (path: string): ResolvedEnvironmentMedia["mediaType"] | undefined =>
  MEDIA_EXTENSIONS.get(extname(path).toLowerCase());

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".srt",
  ".vtt",
  ".log",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".xml",
  ".yaml",
  ".yml",
  ".py",
  ".sh"
]);

const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);
const ARCHIVE_EXTENSIONS = new Set([".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z"]);

const outputFileTypeForPath = (path: string): EnvironmentOutputFile["fileType"] => {
  const mediaType = mediaTypeForPath(path);
  if (mediaType) {
    return mediaType;
  }
  const extension = extname(path).toLowerCase();
  if (extension === ".html" || extension === ".htm") {
    return "html";
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return "document";
  }
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return "archive";
  }
  return "other";
};

const safeCacheSegment = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "environment";

const normalizedRelativeTarPath = (value: string): string | undefined => {
  const normalized = normalize(value).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  if (!normalized || normalized === "." || isAbsolute(normalized) || normalized.split(/[\\/]/).includes("..")) {
    return undefined;
  }
  return normalized.replace(/\\/g, "/");
};

const pathIsInside = (candidate: string, root: string): boolean => {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const outputRelativePathForEntry = (value: string): string | undefined => {
  const normalized = normalizedRelativeTarPath(value);
  if (!normalized) {
    return undefined;
  }
  const withoutWorkspace = normalized.replace(/^workspace\//, "");
  if (!withoutWorkspace.startsWith("output/")) {
    return undefined;
  }
  const relativeOutputPath = normalizedRelativeTarPath(withoutWorkspace.slice("output/".length));
  if (!relativeOutputPath) {
    return undefined;
  }
  return relativeOutputPath;
};

const requestedPathMatchesTarEntry = (requestedPath: string, tarEntry: string): boolean => {
  const requested = requestedPath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  const requestedWithoutWorkspace = requested.replace(/^workspace\//, "");
  const entry = tarEntry.replace(/^\.?\//, "").replace(/\\/g, "/");
  const entryWithoutWorkspace = entry.replace(/^workspace\//, "");
  return (
    entry === requested ||
    entryWithoutWorkspace === requestedWithoutWorkspace ||
    entry.endsWith(`/${requested}`) ||
    entry.endsWith(`/${requestedWithoutWorkspace}`)
  );
};

const unique = <T,>(values: T[]): T[] => [...new Set(values)];

const filesHaveSameContent = (left: string, right: string): boolean => {
  try {
    const leftStats = statSync(left);
    const rightStats = statSync(right);
    if (leftStats.size !== rightStats.size) {
      return false;
    }
    const digest = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
    return digest(left) === digest(right);
  } catch {
    return false;
  }
};

const autoSaveTarget = (directory: string, sourcePath: string): string => {
  const originalName = basename(sourcePath);
  const extension = extname(originalName);
  const stem = extension ? originalName.slice(0, -extension.length) : originalName;

  for (let index = 0; ; index += 1) {
    const name = index === 0 ? originalName : `${stem}-${index + 1}${extension}`;
    const candidate = join(directory, name);
    if (!existsSync(candidate) || filesHaveSameContent(sourcePath, candidate)) {
      return candidate;
    }
  }
};

const autoSaveMedia = (environmentId: string, sourcePath: string): string => {
  const directory = join(LOCAL_OUTPUT_ROOT, safeCacheSegment(environmentId));
  mkdirSync(directory, { recursive: true });
  const target = autoSaveTarget(directory, sourcePath);
  if (!existsSync(target)) {
    copyFileSync(sourcePath, target);
  }
  return target;
};

const localOutputRoot = (environmentId: string): string =>
  join(LOCAL_OUTPUT_ROOT, safeCacheSegment(environmentId));

const localOutputMediaEntries = (root: string, current = root): string[] => {
  if (!existsSync(current)) {
    return [];
  }
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      return localOutputMediaEntries(root, fullPath);
    }
    if (!entry.isFile() || !mediaTypeForPath(fullPath)) {
      return [];
    }
    return [normalize(fullPath.slice(root.length)).replace(/^[/\\]+/, "").replace(/\\/g, "/")];
  });
};

const copyAutoSavedMediaToCache = (
  environmentId: string,
  extractRoot: string,
  requestedPaths?: string[]
): void => {
  const sourceRoot = localOutputRoot(environmentId);
  if (!existsSync(sourceRoot)) {
    return;
  }

  const entries = localOutputMediaEntries(sourceRoot);
  const requestedNames = requestedPaths
    ? new Set(
        requestedPaths.flatMap((requestedPath) => {
          const outputRelativePath = outputRelativePathForEntry(requestedPath);
          return unique(
            [outputRelativePath, outputRelativePath ? basename(outputRelativePath) : basename(requestedPath)]
              .filter((value): value is string => Boolean(value))
          );
        })
      )
    : undefined;

  for (const entry of entries) {
    if (requestedNames && !requestedNames.has(entry) && !requestedNames.has(basename(entry))) {
      continue;
    }
    const sourcePath = resolve(sourceRoot, entry);
    if (!pathIsInside(sourcePath, resolve(sourceRoot)) || !existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      continue;
    }
    const targetPath = resolve(extractRoot, "workspace", "output", entry);
    if (!pathIsInside(targetPath, resolve(extractRoot))) {
      continue;
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
};

const mediaUrl = (environmentId: string, relativeEntry: string): string => {
  const encodedPath = relativeEntry
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${MEDIA_PROTOCOL}://${safeCacheSegment(environmentId)}/${encodedPath}`;
};

const cachedMediaEntries = (root: string, current = root): string[] => {
  if (!existsSync(current)) {
    return [];
  }
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      return cachedMediaEntries(root, fullPath);
    }
    if (!entry.isFile() || !mediaTypeForPath(fullPath)) {
      return [];
    }
    return [normalize(fullPath.slice(root.length)).replace(/^[/\\]+/, "").replace(/\\/g, "/")];
  });
};

const cachedEnvironmentOutputFiles = (
  environmentId: string,
  root: string,
  current = root
): EnvironmentOutputFile[] => {
  const resolvedRoot = resolve(root);
  if (!existsSync(current)) {
    return [];
  }

  return readdirSync(current, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        return cachedEnvironmentOutputFiles(environmentId, root, fullPath);
      }
      if (!entry.isFile()) {
        return [];
      }

      const relativeEntry = normalize(fullPath.slice(resolvedRoot.length))
        .replace(/^[/\\]+/, "")
        .replace(/\\/g, "/");
      const outputRelativePath = outputRelativePathForEntry(relativeEntry);
      if (!outputRelativePath) {
        return [];
      }

      const stats = statSync(fullPath);
      const mediaType = mediaTypeForPath(fullPath);
      const file: EnvironmentOutputFile = {
        sandboxPath: `/workspace/output/${outputRelativePath}`,
        relativePath: outputRelativePath,
        name: basename(outputRelativePath),
        path: fullPath,
        bytes: stats.size,
        modifiedAt: stats.mtimeMs,
        fileType: outputFileTypeForPath(fullPath),
        mediaType,
        url: mediaType ? mediaUrl(environmentId, relativeEntry) : undefined
      };
      return [file];
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt || left.relativePath.localeCompare(right.relativePath));
};

const resolveCachedEnvironmentMedia = (
  environmentId: string,
  extractRoot: string,
  requestedPaths: string[]
): ResolvedEnvironmentMedia[] | undefined => {
  const entries = cachedMediaEntries(resolve(extractRoot));
  if (!entries.length) {
    return undefined;
  }

  const resolvedItems = requestedPaths.flatMap((requestedPath) => {
    const relativeEntry = entries.find((candidate) => requestedPathMatchesTarEntry(requestedPath, candidate));
    if (!relativeEntry) {
      return [];
    }
    const path = resolve(extractRoot, relativeEntry);
    if (!pathIsInside(path, resolve(extractRoot)) || !existsSync(path) || !statSync(path).isFile()) {
      return [];
    }
    const mediaType = mediaTypeForPath(path);
    return mediaType
      ? [
          {
            requestedPath,
            path,
            savedPath: autoSaveMedia(environmentId, path),
            url: mediaUrl(environmentId, relativeEntry),
            mediaType
          }
        ]
      : [];
  });

  return resolvedItems.length === requestedPaths.length ? resolvedItems : undefined;
};

const extractTarEntries = async (
  cacheRoot: string,
  tarPath: string,
  destinationRoot: string,
  entries: string[]
): Promise<void> => {
  const entriesPath = tarEntriesPath(cacheRoot);
  writeFileSync(entriesPath, `${entries.join("\n")}\n`, "utf8");
  try {
    await execFileAsync("tar", ["-xf", tarPath, "-C", destinationRoot, "-T", entriesPath], {
      maxBuffer: 5 * 1024 * 1024
    });
  } finally {
    rmSync(entriesPath, { force: true });
  }
};

const snapshotCacheLocks = new Map<string, Promise<void>>();

const withEnvironmentSnapshotLock = async <T,>(
  environmentId: string,
  task: () => Promise<T>
): Promise<T> => {
  const previous = snapshotCacheLocks.get(environmentId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const currentWait = new Promise<void>((resolveWait) => {
    release = resolveWait;
  });
  const currentLock = previous.catch(() => undefined).then(() => currentWait);
  snapshotCacheLocks.set(environmentId, currentLock);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (snapshotCacheLocks.get(environmentId) === currentLock) {
      snapshotCacheLocks.delete(environmentId);
    }
  }
};

const listEnvironmentOutputFilesFromSnapshot = async (
  environmentId: string,
  force = false
): Promise<EnvironmentOutputFile[]> => {
  const cacheRoot = join(mediaCacheRoot(), safeCacheSegment(environmentId));
  const extractRoot = join(cacheRoot, "files");
  const nextExtractRoot = join(cacheRoot, "files-next");
  const previousExtractRoot = join(cacheRoot, "files-previous");
  const targetExtractRoot = force ? nextExtractRoot : extractRoot;
  const tarPath = snapshotTarPath(cacheRoot);

  if (!force) {
    copyAutoSavedMediaToCache(environmentId, extractRoot);
  }
  const cached = cachedEnvironmentOutputFiles(environmentId, extractRoot);
  if (!force && cached.length > 0) {
    return cached;
  }

  return withEnvironmentSnapshotLock(environmentId, async () => {
    if (!force) {
      copyAutoSavedMediaToCache(environmentId, extractRoot);
      const cachedAfterLock = cachedEnvironmentOutputFiles(environmentId, extractRoot);
      if (cachedAfterLock.length > 0) {
        return cachedAfterLock;
      }
    }

    const replaceExtractRootFromNext = () => {
      if (existsSync(extractRoot)) {
        renameSync(extractRoot, previousExtractRoot);
      }
      try {
        renameSync(nextExtractRoot, extractRoot);
        rmSync(previousExtractRoot, { recursive: true, force: true });
      } catch (error) {
        rmSync(extractRoot, { recursive: true, force: true });
        if (existsSync(previousExtractRoot)) {
          renameSync(previousExtractRoot, extractRoot);
        }
        throw error;
      }
    };

    if (force) {
      rmSync(nextExtractRoot, { recursive: true, force: true });
      rmSync(previousExtractRoot, { recursive: true, force: true });
    }
    mkdirSync(targetExtractRoot, { recursive: true });
    rmSync(tarPath, { force: true });

    try {
      const buffer = await createClient().downloadEnvironmentSnapshot(environmentId);
      writeFileSync(tarPath, Buffer.from(buffer));

      const listed = await execFileAsync("tar", ["-tf", tarPath], { maxBuffer: 5 * 1024 * 1024 });
      const selectedEntries = unique(
        listed.stdout
          .split("\n")
          .map((entry) => entry.trim())
          .map(normalizedRelativeTarPath)
          .filter((entry): entry is string => Boolean(entry && outputRelativePathForEntry(entry)))
      );

      if (selectedEntries.length === 0) {
        if (force) {
          replaceExtractRootFromNext();
          return [];
        }
        return cachedEnvironmentOutputFiles(environmentId, extractRoot);
      }

      await extractTarEntries(cacheRoot, tarPath, targetExtractRoot, selectedEntries);

      if (force) {
        replaceExtractRootFromNext();
      }

      return cachedEnvironmentOutputFiles(environmentId, extractRoot);
    } catch (error) {
      copyAutoSavedMediaToCache(environmentId, extractRoot);
      const fallback = cachedEnvironmentOutputFiles(environmentId, extractRoot);
      if (fallback.length > 0) {
        return fallback;
      }
      throw error;
    } finally {
      rmSync(tarPath, { force: true });
      if (force) {
        rmSync(nextExtractRoot, { recursive: true, force: true });
        rmSync(previousExtractRoot, { recursive: true, force: true });
      }
    }
  });
};

const registerMediaProtocol = (): void => {
  protocol.handle(MEDIA_PROTOCOL, (request) => {
    const url = new URL(request.url);
    const environmentSegment = safeCacheSegment(url.hostname);
    const relativeEntry = normalizedRelativeTarPath(decodeURIComponent(url.pathname.slice(1)));
    if (!relativeEntry || !mediaTypeForPath(relativeEntry)) {
      return new Response("Not found", { status: 404 });
    }

    const root = resolve(mediaCacheRoot(), environmentSegment, "files");
    const path = resolve(root, relativeEntry);
    if (!pathIsInside(path, root) || !existsSync(path) || !statSync(path).isFile()) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(path).toString());
  });
};

/** Strip surrounding whitespace and any control chars so a pasted key can't inject extra .env lines. */
const sanitizeKey = (key: string): string => key.trim().replace(/[\x00-\x1f]/g, "");

const safeProjectSegment = (value: string): string => {
  const safe = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "untitled-agent";
};

const projectDir = (agentId: string): string => join(PROJECTS_ROOT, safeProjectSegment(agentId));

const safeProjectPath = (root: string, relativePath: string): string => {
  const normalized = normalize(relativePath);
  if (!normalized || isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error(`Invalid project file path: ${relativePath}`);
  }
  return join(root, normalized);
};

const readProjectFiles = (root: string, base = ""): AgentProjectFileSnapshot[] => {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = base ? `${base}/${entry.name}` : entry.name;
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      return readProjectFiles(fullPath, relativePath);
    }
    if (!entry.isFile() || statSync(fullPath).size > 1024 * 1024) {
      return [];
    }
    return [{ path: relativePath, content: readFileSync(fullPath, "utf8") }];
  });
};

const loadAgentProjectSnapshot = (agentId: string): AgentProjectSnapshot => {
  const rootPath = projectDir(agentId);
  return {
    agentId,
    rootPath,
    files: readProjectFiles(rootPath)
  };
};

/** Upsert `NAME=value` in a .env file, preserving other lines and creating the file if needed. */
const upsertEnvKey = (envPath: string, name: string, value: string): void => {
  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!value) {
    content = content
      .replace(new RegExp(`^${name}=.*(?:\\r?\\n)?`, "m"), "")
      .replace(/\n{3,}/g, "\n\n");
    writeFileSync(envPath, content, "utf8");
    return;
  }
  if (pattern.test(content)) {
    // Function replacer so a "$" in the value is written literally, not as a $-pattern.
    content = content.replace(pattern, () => line);
  } else {
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
    content += `${line}\n`;
  }
  writeFileSync(envPath, content, "utf8");
};

const serializeError = (error: unknown): IpcError => {
  if (error instanceof Error) {
    const maybeGemini = error as GeminiApiError & { errors?: string[] };
    return {
      name: error.name,
      message: error.message,
      status: maybeGemini.status,
      errors: maybeGemini.errors,
      details: maybeGemini.details
    };
  }
  return {
    name: "UnknownError",
    message: String(error)
  };
};

const ok = <T>(value: T): IpcResult<T> => ({ ok: true, value });
const fail = <T>(error: unknown): IpcResult<T> => ({ ok: false, error: serializeError(error) });
const streamControllers = new Map<string, AbortController>();
const STREAM_BUFFER_TTL_MS = 5 * 60_000;
type StreamBuffer = {
  events: InteractionStreamEvent[];
  latestInteraction?: Interaction;
  done: boolean;
  lastEventId?: string;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};
const streamBuffers = new Map<string, StreamBuffer>();

const scheduleStreamBufferCleanup = (streamId: string, buffer: StreamBuffer): void => {
  if (streamBuffers.get(streamId) !== buffer) {
    return;
  }
  if (!buffer || buffer.cleanupTimer) {
    return;
  }
  buffer.cleanupTimer = setTimeout(() => {
    if (streamBuffers.get(streamId) === buffer) {
      streamBuffers.delete(streamId);
    }
  }, STREAM_BUFFER_TTL_MS);
};

const rememberStreamEvent = (
  buffer: {
    events: InteractionStreamEvent[];
    latestInteraction?: Interaction;
    lastEventId?: string;
  },
  streamEvent: InteractionStreamEvent
): Interaction | undefined => {
  buffer.events = [...buffer.events, streamEvent].slice(-300);
  if (streamEvent.event_id) {
    buffer.lastEventId = streamEvent.event_id;
  }
  if (streamEvent.interaction) {
    buffer.latestInteraction = streamEvent.interaction;
    return streamEvent.interaction;
  }
  if (streamEvent.interaction_id || streamEvent.status) {
    const id = streamEvent.interaction_id ?? buffer.latestInteraction?.id;
    if (id) {
      buffer.latestInteraction = {
        ...(buffer.latestInteraction ?? { id }),
        id,
        status: streamEvent.status ?? buffer.latestInteraction?.status
      };
      return buffer.latestInteraction;
    }
  }
  return buffer.latestInteraction;
};

const hydrateStreamInteraction = async (
  client: GeminiManagedAgentsClient,
  latestInteraction: Interaction | undefined,
  fallbackInteractionId?: string
): Promise<Interaction | undefined> => {
  const interactionId = latestInteraction?.id ?? fallbackInteractionId;
  if (!interactionId) {
    return latestInteraction;
  }
  try {
    const hydrated = await client.getInteraction(interactionId);
    return {
      ...latestInteraction,
      ...hydrated,
      usage: latestInteraction?.usage ?? hydrated.usage,
      status: hydrated.status ?? latestInteraction?.status,
      environment_id: latestInteraction?.environment_id ?? hydrated.environment_id
    };
  } catch {
    return latestInteraction;
  }
};

const handle = <Args extends unknown[], Result>(
  channel: string,
  callback: (...args: Args) => Promise<Result> | Result
): void => {
  ipcMain.handle(channel, async (_event, ...args: Args) => {
    try {
      return ok(await callback(...args));
    } catch (error) {
      return fail<Result>(error);
    }
  });
};

/** Open a web URL in the OS default browser; ignore anything that isn't http(s). */
const openWebUrlExternally = (url: string): void => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      void shell.openExternal(parsed.toString());
    }
  } catch {
    // Malformed URL — nothing safe to open.
  }
};

const sameOrigin = (a: string, b: string): boolean => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/**
 * Links must never replace the app shell. A plain <a> click (e.g. a markdown
 * link in agent output) would otherwise navigate the BrowserWindow away from the
 * renderer and break the app. Externalize off-origin web URLs to the OS browser
 * and deny window.open / target=_blank popups, opening them externally instead.
 */
const guardWindowNavigation = (mainWindow: BrowserWindow): void => {
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openWebUrlExternally(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (sameOrigin(url, mainWindow.webContents.getURL())) {
      return;
    }
    event.preventDefault();
    openWebUrlExternally(url);
  });
};

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1080,
    minHeight: 720,
    title: "Gemini Anything Agent",
    icon: existsSync(APP_ICON_PATH) ? APP_ICON_PATH : undefined,
    // Direction B (Sequoia inset): let the native traffic lights float over our
    // own slim, draggable titlebar so the chrome reads as one native surface.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 15 },
    backgroundColor: "#e8eaef",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload is built as ESM (.mjs); Electron only loads ESM preloads
      // when the renderer is unsandboxed. contextIsolation stays on for safety.
      sandbox: false
    }
  });

  guardWindowNavigation(mainWindow);

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

handle(ipcChannels.runtimeConfig, () => ({
  hasApiKey: Boolean(process.env.GEMINI_API_KEY),
  apiKeyMasked: maskKey(process.env.GEMINI_API_KEY),
  apiRevision: process.env.GEMINI_API_REVISION ?? GEMINI_API_REVISION,
  baseUrl: process.env.GEMINI_API_BASE_URL ?? GEMINI_API_BASE_URL,
  envPath: ENV_PATH,
  docsLastChecked: "2026-06-22",
  agentId: envValueOrDefault(process.env.GEMINI_ANYTHING_AGENT_ID, DEFAULT_AGENT_ID),
  npmPackage: envValueOrDefault(process.env.GEMINI_ANYTHING_NPM_PACKAGE, DEFAULT_NPM_PACKAGE),
  npmVersion: envValueOrDefault(process.env.GEMINI_ANYTHING_NPM_VERSION, DEFAULT_NPM_VERSION)
}));

handle<[string], SetApiKeyResult>(ipcChannels.setApiKey, async (key) => {
  const value = sanitizeKey(key);
  upsertEnvKey(ENV_PATH, "GEMINI_API_KEY", value);
  // Keep an existing .env.local in sync, since it overrides .env on the next launch.
  if (existsSync(ENV_LOCAL_PATH) && /^GEMINI_API_KEY=.*$/m.test(readFileSync(ENV_LOCAL_PATH, "utf8"))) {
    upsertEnvKey(ENV_LOCAL_PATH, "GEMINI_API_KEY", value);
  }
  if (value) {
    process.env.GEMINI_API_KEY = value;
  } else {
    delete process.env.GEMINI_API_KEY;
  }
  return {
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    apiKeyMasked: maskKey(process.env.GEMINI_API_KEY),
    envPath: ENV_PATH
  };
});

handle<[string | undefined], EnsureAnythingAgentResult>(
  ipcChannels.ensureAnythingAgent,
  async (requestedAgentId) => {
    const agentId = requestedAgentId?.trim() || process.env.GEMINI_ANYTHING_AGENT_ID || DEFAULT_AGENT_ID;
    const client = createClient();
    const definition = buildAnythingAgentDefinition(agentId);
    const sourceTargets =
      typeof definition.base_environment === "object"
        ? definition.base_environment.sources?.map((source) => source.target) ?? []
        : [];

    try {
      const existing = await client.getAgent(agentId);
      if (agentDefinitionsMatch(existing, definition)) {
        return {
          agent: redactAgentForRenderer(existing),
          created: false,
          sourceTargets
        };
      }

      await client.deleteAgent(agentId);
      return {
        agent: redactAgentForRenderer(await client.createAgent(definition)),
        created: true,
        recreated: true,
        sourceTargets
      };
    } catch (error) {
      if (!isMissingAgentError(error)) {
        throw error;
      }
    }

    try {
      return {
        agent: redactAgentForRenderer(await client.createAgent(definition)),
        created: true,
        sourceTargets
      };
    } catch (error) {
      if (!isMissingAgentError(error) && !(error instanceof GeminiApiError && error.status === 409)) {
        throw error;
      }
      return {
        agent: redactAgentForRenderer(await client.getAgent(agentId)),
        created: false,
        sourceTargets
      };
    }
  }
);

handle<[AgentDefinition], Awaited<ReturnType<GeminiManagedAgentsClient["createAgent"]>>>(
  ipcChannels.createAgent,
  async (agent) => redactAgentForRenderer(await createClient().createAgent(agent))
);

handle(ipcChannels.listAgents, async () => redactAgentListForRenderer(await createClient().listAgents()));
handle<[string], Awaited<ReturnType<GeminiManagedAgentsClient["getAgent"]>>>(
  ipcChannels.getAgent,
  async (id) => redactAgentForRenderer(await createClient().getAgent(id))
);
handle<[string], boolean>(ipcChannels.deleteAgent, async (id) => {
  await createClient().deleteAgent(id);
  return true;
});
handle<[InteractionCreateRequest], Awaited<ReturnType<GeminiManagedAgentsClient["createInteraction"]>>>(
  ipcChannels.createInteraction,
  async (request) => createClient().createInteraction(augmentInteractionRequest(request))
);
ipcMain.handle(
  ipcChannels.createInteractionStream,
  async (event, streamId: string, request: InteractionCreateRequest): Promise<IpcResult<Interaction>> => {
    const controller = new AbortController();
    streamControllers.set(streamId, controller);
    const buffer = {
      events: [] as InteractionStreamEvent[],
      latestInteraction: undefined as Interaction | undefined,
      done: false,
      lastEventId: undefined as string | undefined,
      cleanupTimer: undefined as ReturnType<typeof setTimeout> | undefined
    };
    streamBuffers.set(streamId, buffer);
    const client = createClient();
    let latestInteraction: Interaction | undefined;
    const abortForDestroyedSender = () => controller.abort(new Error("Renderer was destroyed."));
    event.sender.once("destroyed", abortForDestroyedSender);

    try {
      for await (const streamEvent of client.createInteractionStream(augmentInteractionRequest(request), { signal: controller.signal })) {
        latestInteraction = rememberStreamEvent(buffer, streamEvent);
        if (event.sender.isDestroyed()) {
          controller.abort(new Error("Renderer was destroyed."));
          break;
        }
        event.sender.send(ipcChannels.interactionStreamEvent, {
          streamId,
          event: streamEvent
        });
      }

      const hydrated = await hydrateStreamInteraction(client, latestInteraction);
      if (hydrated) {
        latestInteraction = hydrated;
        buffer.latestInteraction = hydrated;
      }

      if (!latestInteraction) {
        throw new Error("Gemini interaction stream ended before returning an interaction.");
      }
      return ok(latestInteraction);
    } catch (error) {
      if (controller.signal.aborted && latestInteraction?.id) {
        const hydrated = await hydrateStreamInteraction(client, latestInteraction);
        if (hydrated) {
          buffer.latestInteraction = hydrated;
          return ok(hydrated);
        }
      }
      return fail<Interaction>(error);
    } finally {
      event.sender.off("destroyed", abortForDestroyedSender);
      buffer.done = true;
      scheduleStreamBufferCleanup(streamId, buffer);
      streamControllers.delete(streamId);
    }
  }
);
ipcMain.handle(
  ipcChannels.resumeInteractionStream,
  async (event, streamId: string, interactionId: string, lastEventId?: string): Promise<IpcResult<Interaction>> => {
    const controller = new AbortController();
    streamControllers.set(streamId, controller);
    const buffer = {
      events: [] as InteractionStreamEvent[],
      latestInteraction: { id: interactionId, status: "in_progress" } as Interaction,
      done: false,
      lastEventId,
      cleanupTimer: undefined as ReturnType<typeof setTimeout> | undefined
    };
    streamBuffers.set(streamId, buffer);
    const client = createClient();
    let latestInteraction: Interaction | undefined;
    const abortForDestroyedSender = () => controller.abort(new Error("Renderer was destroyed."));
    event.sender.once("destroyed", abortForDestroyedSender);

    try {
      for await (const streamEvent of client.resumeInteractionStream(interactionId, {
        lastEventId,
        signal: controller.signal
      })) {
        latestInteraction = rememberStreamEvent(buffer, streamEvent);
        if (event.sender.isDestroyed()) {
          controller.abort(new Error("Renderer was destroyed."));
          break;
        }
        event.sender.send(ipcChannels.interactionStreamEvent, {
          streamId,
          event: streamEvent
        });
      }

      const hydrated = await hydrateStreamInteraction(client, latestInteraction, interactionId);
      if (hydrated) {
        latestInteraction = hydrated;
        buffer.latestInteraction = hydrated;
      }
      if (!latestInteraction) {
        throw new Error("Gemini interaction resume stream ended before returning an interaction.");
      }
      return ok(latestInteraction);
    } catch (error) {
      if (controller.signal.aborted) {
        const hydrated = await hydrateStreamInteraction(client, latestInteraction, interactionId);
        if (hydrated) {
          buffer.latestInteraction = hydrated;
          return ok(hydrated);
        }
      }
      return fail<Interaction>(error);
    } finally {
      event.sender.off("destroyed", abortForDestroyedSender);
      buffer.done = true;
      scheduleStreamBufferCleanup(streamId, buffer);
      streamControllers.delete(streamId);
    }
  }
);
handle<[string], boolean>(ipcChannels.cancelInteractionStream, async (streamId) => {
  streamControllers.get(streamId)?.abort(new Error("Interaction stream cancelled."));
  return true;
});
handle<
  [string],
  { events: InteractionStreamEvent[]; latestInteraction?: Interaction; done: boolean; lastEventId?: string }
>(
  ipcChannels.getInteractionStreamSnapshot,
  async (streamId) => {
    const buffer = streamBuffers.get(streamId);
    if (!buffer) {
      return { events: [], done: true };
    }
    return {
      events: buffer.events,
      latestInteraction: buffer.latestInteraction,
      done: buffer.done,
      lastEventId: buffer.lastEventId
    };
  }
);
handle<[string], Awaited<ReturnType<GeminiManagedAgentsClient["getInteraction"]>>>(
  ipcChannels.getInteraction,
  async (id) => createClient().getInteraction(id)
);
handle<[string], Awaited<ReturnType<GeminiManagedAgentsClient["cancelInteraction"]>>>(
  ipcChannels.cancelInteraction,
  async (id) => createClient().cancelInteraction(id)
);
handle<[string], boolean>(ipcChannels.deleteInteraction, async (id) => {
  await createClient().deleteInteraction(id);
  return true;
});
handle<[string], SnapshotDownloadResult>(ipcChannels.downloadSnapshot, async (environmentId) => {
  const result = await dialog.showSaveDialog({
    title: "Save environment snapshot",
    defaultPath: `environment-${environmentId}.tar.gz`
  });
  if (result.canceled || !result.filePath) {
    return { saved: false, canceled: true };
  }
  const buffer = await createClient().downloadEnvironmentSnapshot(environmentId);
  writeFileSync(result.filePath, Buffer.from(buffer));
  return { saved: true, path: result.filePath, bytes: buffer.byteLength };
});

handle<[string, string[]], ResolvedEnvironmentMedia[]>(
  ipcChannels.resolveEnvironmentMedia,
  async (environmentId, paths) => {
    const requestedPaths = unique(
      paths
        .map((path) => path.trim())
        .filter((path) => path.length > 0 && mediaTypeForPath(path))
    );
    if (requestedPaths.length === 0) {
      return [];
    }

    const cacheRoot = join(mediaCacheRoot(), safeCacheSegment(environmentId));
    const extractRoot = join(cacheRoot, "files");
    const tarPath = snapshotTarPath(cacheRoot);
    let cached = resolveCachedEnvironmentMedia(environmentId, extractRoot, requestedPaths);
    if (!cached) {
      copyAutoSavedMediaToCache(environmentId, extractRoot, requestedPaths);
      cached = resolveCachedEnvironmentMedia(environmentId, extractRoot, requestedPaths);
    }
    if (cached) {
      return cached;
    }

    return withEnvironmentSnapshotLock(environmentId, async () => {
      let lockedCached = resolveCachedEnvironmentMedia(environmentId, extractRoot, requestedPaths);
      if (!lockedCached) {
        copyAutoSavedMediaToCache(environmentId, extractRoot, requestedPaths);
        lockedCached = resolveCachedEnvironmentMedia(environmentId, extractRoot, requestedPaths);
      }
      if (lockedCached) {
        return lockedCached;
      }

      rmSync(tarPath, { force: true });
      mkdirSync(extractRoot, { recursive: true });

      try {
        const buffer = await createClient().downloadEnvironmentSnapshot(environmentId);
        writeFileSync(tarPath, Buffer.from(buffer));

        const listed = await execFileAsync("tar", ["-tf", tarPath], { maxBuffer: 5 * 1024 * 1024 });
        const tarEntries = listed.stdout
          .split("\n")
          .map((entry) => entry.trim())
          .map(normalizedRelativeTarPath)
          .filter((entry): entry is string => {
            if (!entry) {
              return false;
            }
            return Boolean(mediaTypeForPath(entry));
          });
        const selectedEntries = unique(
          tarEntries.filter((entry) =>
            requestedPaths.some((requestedPath) => requestedPathMatchesTarEntry(requestedPath, entry))
          )
        );

        if (selectedEntries.length === 0) {
          return [];
        }

        await extractTarEntries(cacheRoot, tarPath, extractRoot, selectedEntries);

        return requestedPaths.flatMap((requestedPath) => {
          const entry = selectedEntries.find((candidate) => requestedPathMatchesTarEntry(requestedPath, candidate));
          const relativeEntry = entry ? normalizedRelativeTarPath(entry) : undefined;
          if (!relativeEntry) {
            return [];
          }
          const path = resolve(extractRoot, relativeEntry);
          if (!pathIsInside(path, resolve(extractRoot))) {
            return [];
          }
          if (!existsSync(path) || !statSync(path).isFile()) {
            return [];
          }
          const mediaType = mediaTypeForPath(path);
          const savedPath = mediaType ? autoSaveMedia(environmentId, path) : undefined;
          return mediaType
            ? [
                {
                  requestedPath,
                  path,
                  savedPath,
                  url: mediaUrl(environmentId, relativeEntry),
                  mediaType
                }
              ]
            : [];
        });
      } catch (error) {
        copyAutoSavedMediaToCache(environmentId, extractRoot, requestedPaths);
        const fallback = resolveCachedEnvironmentMedia(environmentId, extractRoot, requestedPaths);
        if (fallback) {
          return fallback;
        }
        throw error;
      } finally {
        rmSync(tarPath, { force: true });
      }
    });
  }
);

handle<[string, boolean | undefined], EnvironmentOutputFile[]>(
  ipcChannels.listEnvironmentOutputFiles,
  async (environmentId, force) => listEnvironmentOutputFilesFromSnapshot(environmentId, Boolean(force))
);

handle<[string], SaveResolvedMediaResult>(ipcChannels.saveResolvedMedia, async (sourcePath) => {
  const source = resolve(sourcePath);
  const root = resolve(mediaCacheRoot());
  if (!pathIsInside(source, root) || !existsSync(source) || !statSync(source).isFile() || !mediaTypeForPath(source)) {
    throw new Error("Media file is not available in the app cache.");
  }

  const result = await dialog.showSaveDialog({
    title: "Save generated media",
    defaultPath: basename(source)
  });
  if (result.canceled || !result.filePath) {
    return { saved: false, canceled: true };
  }

  copyFileSync(source, result.filePath);
  return { saved: true, path: result.filePath, bytes: statSync(result.filePath).size };
});

handle<[string], SaveResolvedMediaResult>(ipcChannels.saveEnvironmentOutputFile, async (sourcePath) => {
  const source = resolve(sourcePath);
  const root = resolve(mediaCacheRoot());
  if (!pathIsInside(source, root) || !existsSync(source) || !statSync(source).isFile()) {
    throw new Error("Output file is not available in the app cache.");
  }

  const result = await dialog.showSaveDialog({
    title: "Save output file",
    defaultPath: basename(source)
  });
  if (result.canceled || !result.filePath) {
    return { saved: false, canceled: true };
  }

  copyFileSync(source, result.filePath);
  return { saved: true, path: result.filePath, bytes: statSync(result.filePath).size };
});

handle<[string], boolean>(ipcChannels.openEnvironmentOutputFile, async (sourcePath) => {
  const source = resolve(sourcePath);
  const root = resolve(mediaCacheRoot());
  if (!pathIsInside(source, root) || !existsSync(source) || !statSync(source).isFile()) {
    throw new Error("Output file is not available in the app cache.");
  }

  const message = await shell.openPath(source);
  if (message) {
    throw new Error(message);
  }
  return true;
});

handle<[string, string | undefined], SaveTextResult>(ipcChannels.saveText, async (content, defaultFileName) => {
  const safeName =
    basename((defaultFileName || "agent-output.md").replace(/[/\\:*?"<>|]+/g, "-")).trim() || "agent-output.md";
  const result = await dialog.showSaveDialog({
    title: "Save text",
    defaultPath: safeName
  });
  if (result.canceled || !result.filePath) {
    return { saved: false, canceled: true };
  }

  writeFileSync(result.filePath, content, "utf8");
  return { saved: true, path: result.filePath, bytes: statSync(result.filePath).size };
});

handle<[string], AgentProjectSnapshot>(ipcChannels.loadAgentProject, async (agentId) =>
  loadAgentProjectSnapshot(agentId)
);
handle<[string, AgentProjectFileSnapshot[]], AgentProjectSnapshot>(
  ipcChannels.saveAgentProject,
  async (agentId, files) => {
    const rootPath = projectDir(agentId);
    rmSync(rootPath, { recursive: true, force: true });
    mkdirSync(rootPath, { recursive: true });
    for (const file of files) {
      if (typeof file.path !== "string" || typeof file.content !== "string") {
        continue;
      }
      const filePath = safeProjectPath(rootPath, file.path);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, file.content, "utf8");
    }
    return loadAgentProjectSnapshot(agentId);
  }
);
handle<[string], boolean>(ipcChannels.openAgentProject, async (agentId) => {
  const rootPath = projectDir(agentId);
  mkdirSync(rootPath, { recursive: true });
  await shell.openPath(rootPath);
  return true;
});
handle<[string], boolean>(ipcChannels.openExternal, async (url) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Blocked non-web URL: ${parsed.protocol}`);
  }
  await shell.openExternal(parsed.toString());
  return true;
});

app.whenReady().then(() => {
  registerMediaProtocol();
  if (process.platform === "darwin" && app.dock && existsSync(APP_ICON_PNG_PATH)) {
    app.dock.setIcon(APP_ICON_PNG_PATH);
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
