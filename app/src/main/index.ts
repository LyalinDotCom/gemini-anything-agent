import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { config as loadEnv } from "dotenv";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  createReadStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANTIGRAVITY_BASE_AGENT,
  GEMINI_API_BASE_URL,
  GEMINI_API_REVISION,
  GeminiApiError,
  GeminiManagedAgentsClient,
  type AgentDefinition,
  type AgentListResponse,
  type Interaction,
  type InteractionCreateRequest,
  type InteractionStreamEvent,
  type ManagedAgent
} from "../sdk";
import {
  ipcChannels,
  type ChatSessionStoreSnapshot,
  type EnvironmentOutputFile,
  type EnsureAnythingAgentResult,
  type IpcError,
  type IpcResult,
  type PersistedSession,
  type ReadEnvironmentOutputTextResult,
  type ResolvedEnvironmentMedia,
  type SaveResolvedMediaResult,
  type SaveTextResult,
  type SetApiKeyResult,
  type SnapshotDownloadResult
} from "../shared/electron-api";
import {
  chatStoreRootPath,
  loadChatSessionsFromDisk,
  queueConversationDiagnostics,
  saveChatSessionsToDisk
} from "./chatStore";
import { agentConfigHash, comparableAgentDefinition } from "./agentConfig";

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
      stream: true,
      // The sandboxed HTML preview iframe has an opaque origin, so its
      // fetch() calls for the file's own data assets are cross-origin.
      corsEnabled: true
    }
  }
]);

const DEFAULT_AGENT_ID = "gemini-anything-v1";
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
const APP_ROOT = existsSync(join(REPO_ROOT, "app", "package.json")) ? join(REPO_ROOT, "app") : CWD;
const ROOT_ENV_PATH = join(REPO_ROOT, ".env");
const ROOT_ENV_LOCAL_PATH = join(REPO_ROOT, ".env.local");
const ENV_PATH = join(APP_ROOT, ".env");
const ENV_LOCAL_PATH = join(APP_ROOT, ".env.local");
const AGENT_ASSETS_ROOT = join(REPO_ROOT, "agents");
const APP_ICON_PNG_PATH = join(APP_ROOT, "assets", "app-icon.png");
const APP_ICON_PATH = process.platform === "darwin" ? join(APP_ROOT, "assets", "app-icon.icns") : APP_ICON_PNG_PATH;
const LOCAL_OUTPUT_ROOT = join(REPO_ROOT, "outputs", "managed-agent");
const LOCAL_CHAT_ROOT = chatStoreRootPath(REPO_ROOT);
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
    baseUrl: envValueOrDefault(process.env.GEMINI_API_BASE_URL, GEMINI_API_BASE_URL),
    apiRevision: envValueOrDefault(process.env.GEMINI_API_REVISION, GEMINI_API_REVISION)
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

const envValueOrDefault = (value: string | undefined, fallback: string): string => envValue(value) || fallback;

const sandboxEnvContent = (): string =>
  [
    `GEMINI_API_KEY=${envValue(process.env.GEMINI_API_KEY)}`,
    `GEMINI_ANYTHING_NPM_PACKAGE=${envValueOrDefault(process.env.GEMINI_ANYTHING_NPM_PACKAGE, DEFAULT_NPM_PACKAGE)}`,
    `GEMINI_ANYTHING_NPM_VERSION=${envValueOrDefault(process.env.GEMINI_ANYTHING_NPM_VERSION, DEFAULT_NPM_VERSION)}`,
    `GEMINI_ANYTHING_MUSIC_MODEL=${envValueOrDefault(process.env.GEMINI_ANYTHING_MUSIC_MODEL, "lyria-3-clip-preview")}`,
    `GEMINI_ANYTHING_TRANSCRIBE_MODEL=${envValueOrDefault(process.env.GEMINI_ANYTHING_TRANSCRIBE_MODEL, "gemini-3.5-flash")}`
  ].join("\n") + "\n";

// agents/ is the single source of truth for everything deployed into the
// managed agent — a missing file is a hard error, never a silent fallback,
// so the folder can be inspected and tuned as exactly what the agent runs.
const readAgentAsset = (relativePath: string): string => {
  const path = join(AGENT_ASSETS_ROOT, relativePath);
  if (!existsSync(path)) {
    throw new Error(`Agent asset missing: ${path} (see agents/README.md).`);
  }
  return readFileSync(path, "utf8");
};

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

// The base agent's built-in prompt is always present and append-only, and a
// request-level system_instruction REPLACES any agent-level one. Durable
// behavior therefore lives in the mounted AGENTS.md (which nothing can knock
// out); the per-request instruction carries only what must be fresh per call.
const anythingSystemInstructionForRequest = (request: InteractionCreateRequest): string => {
  const override = request.system_instruction?.trim();
  return [
    currentInvocationContext(),
    override
      ? [
          "## Additional Per-Interaction Instruction",
          "",
          "The following instruction was explicitly supplied for this interaction. Apply it unless it conflicts with higher-priority safety, runtime, artifact, or tool-routing rules.",
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

const isEnvTarget = (target: string): boolean => basename(target.replace(/\\/g, "/")) === ".env";

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

const redactAgentForRenderer = (agent: ManagedAgent): ManagedAgent => redactEnvironmentSecrets(agent);

const redactAgentListForRenderer = (response: AgentListResponse): AgentListResponse => ({
  ...response,
  agents: response.agents?.map(redactAgentForRenderer)
});

const buildAnythingAgentDefinition = (agentId: string): AgentDefinition => {
  const sources = [
    {
      type: "inline" as const,
      target: ".agents/bin/gai",
      content: readAgentAsset("bin/gai")
    },
    {
      type: "inline" as const,
      target: ".agents/AGENTS.md",
      content: readAgentAsset("AGENTS.md")
    },
    {
      type: "inline" as const,
      target: ".agents/skills/gemini-anything/SKILL.md",
      content: readAgentAsset("skills/gemini-anything/SKILL.md")
    },
    {
      type: "inline" as const,
      target: ".env",
      content: sandboxEnvContent()
    }
  ];
  // No agent-level system_instruction: the app sends a request-level one on
  // every interaction, which would silently replace it anyway. AGENTS.md is
  // the durable instruction layer.
  const definition: AgentDefinition = {
    id: agentId,
    base_agent: ANTIGRAVITY_BASE_AGENT,
    tools: [{ type: "code_execution" }, { type: "google_search" }, { type: "url_context" }],
    base_environment: { type: "remote", sources }
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

const SERVABLE_OUTPUT_EXTENSIONS = new Set([
  ...MEDIA_EXTENSIONS.keys(),
  ".html",
  ".htm",
  ".md",
  ".markdown",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".txt",
  ".jsonl",
  ".csv",
  ".tsv",
  ".srt",
  ".vtt",
  ".log",
  ".ts",
  ".tsx",
  ".jsx",
  ".xml",
  ".yaml",
  ".yml",
  ".py",
  ".sh",
  ".map",
  ".wasm"
]);

const canServeOutputPath = (path: string): boolean => SERVABLE_OUTPUT_EXTENSIONS.has(extname(path).toLowerCase());

const MEDIA_MIME_TYPES = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".avif", "image/avif"],
  [".svg", "image/svg+xml"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".m4v", "video/x-m4v"],
  [".wav", "audio/wav"],
  [".mp3", "audio/mpeg"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".ogg", "audio/ogg"],
  [".flac", "audio/flac"],
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".markdown", "text/markdown; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".jsonl", "application/x-ndjson; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".tsv", "text/tab-separated-values; charset=utf-8"],
  [".srt", "application/x-subrip; charset=utf-8"],
  [".vtt", "text/vtt; charset=utf-8"],
  [".log", "text/plain; charset=utf-8"],
  [".ts", "text/plain; charset=utf-8"],
  [".tsx", "text/plain; charset=utf-8"],
  [".jsx", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".yaml", "application/yaml; charset=utf-8"],
  [".yml", "application/yaml; charset=utf-8"],
  [".py", "text/x-python; charset=utf-8"],
  [".sh", "text/x-shellscript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"]
]);

const mediaMimeTypeForPath = (path: string): string =>
  MEDIA_MIME_TYPES.get(extname(path).toLowerCase()) ?? "application/octet-stream";

type ByteRange = { start: number; end: number };

const byteRangeForHeader = (rangeHeader: string | null, size: number): ByteRange | undefined | "invalid" => {
  if (!rangeHeader) {
    return undefined;
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return "invalid";
  }

  const [, startText, endText] = match;
  if (!startText && !endText) {
    return "invalid";
  }

  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return "invalid";
  }

  return { start, end: Math.min(end, size - 1) };
};

const mediaFileResponse = (path: string, request: Request): Response => {
  const stats = statSync(path);
  const size = stats.size;
  const mimeType = mediaMimeTypeForPath(path);
  const range = byteRangeForHeader(request.headers.get("range"), size);

  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${size}`,
        "Content-Type": mimeType,
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": mimeType,
    // Preview iframes are sandboxed without allow-same-origin, so their
    // requests arrive with an opaque origin.
    "Access-Control-Allow-Origin": "*"
  });

  if (!range) {
    headers.set("Content-Length", String(size));
    return new Response(
      request.method === "HEAD" ? null : (Readable.toWeb(createReadStream(path)) as unknown as BodyInit),
      { status: 200, headers }
    );
  }

  const length = range.end - range.start + 1;
  headers.set("Content-Length", String(length));
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  return new Response(
    request.method === "HEAD"
      ? null
      : (Readable.toWeb(createReadStream(path, { start: range.start, end: range.end })) as unknown as BodyInit),
    { status: 206, headers }
  );
};

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
  if (extension === ".md" || extension === ".markdown") {
    return "markdown";
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
  const normalized = normalize(value)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");
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

const unique = <T>(values: T[]): T[] => [...new Set(values)];

// Hashes incrementally so comparing two multi-GB videos never loads either
// into memory or blocks the main thread in one long readFileSync.
const fileDigest = async (path: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
};

// Throws when either file cannot be read: the caller must distinguish
// "contents differ" from "couldn't compare right now".
const filesHaveSameContent = async (left: string, right: string): Promise<boolean> => {
  const leftStats = statSync(left);
  const rightStats = statSync(right);
  if (leftStats.size !== rightStats.size) {
    return false;
  }
  const [leftDigest, rightDigest] = await Promise.all([fileDigest(left), fileDigest(right)]);
  return leftDigest === rightDigest;
};

const autoSaveTarget = async (directory: string, sourcePath: string): Promise<string> => {
  const originalName = basename(sourcePath);
  const extension = extname(originalName);
  const stem = extension ? originalName.slice(0, -extension.length) : originalName;

  for (let index = 0; ; index += 1) {
    const name = index === 0 ? originalName : `${stem}-${index + 1}${extension}`;
    const candidate = join(directory, name);
    if (!existsSync(candidate)) {
      return candidate;
    }
    try {
      if (await filesHaveSameContent(sourcePath, candidate)) {
        return candidate;
      }
    } catch {
      // Transient read failure (cache file mid-extract or mid-swap): reuse
      // the existing name without overwriting. Treating this as "different"
      // used to fork spurious "-2" duplicates of identical content.
      return candidate;
    }
  }
};

const autoSaveMedia = async (environmentId: string, sourcePath: string): Promise<string> => {
  const directory = join(LOCAL_OUTPUT_ROOT, safeCacheSegment(environmentId));
  mkdirSync(directory, { recursive: true });
  const target = await autoSaveTarget(directory, sourcePath);
  if (!existsSync(target)) {
    // Copy via temp + rename so a concurrent save or dedup compare never
    // observes a half-written file under the final name.
    const partial = `${target}.${randomUUID()}.partial`;
    try {
      await copyFile(sourcePath, partial);
      renameSync(partial, target);
    } catch (error) {
      rmSync(partial, { force: true });
      throw error;
    }
  }
  return target;
};

const localOutputRoot = (environmentId: string): string => join(LOCAL_OUTPUT_ROOT, safeCacheSegment(environmentId));

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
    return [
      normalize(fullPath.slice(root.length))
        .replace(/^[/\\]+/, "")
        .replace(/\\/g, "/")
    ];
  });
};

const copyAutoSavedMediaToCache = async (
  environmentId: string,
  extractRoot: string,
  requestedPaths?: string[]
): Promise<void> => {
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
            [outputRelativePath, outputRelativePath ? basename(outputRelativePath) : basename(requestedPath)].filter(
              (value): value is string => Boolean(value)
            )
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
    await copyFile(sourcePath, targetPath);
  }
};

const mediaUrl = (environmentId: string, relativeEntry: string, version?: string): string => {
  const encodedPath = relativeEntry
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const cacheBust = version ? `?v=${encodeURIComponent(version)}` : "";
  return `${MEDIA_PROTOCOL}://${safeCacheSegment(environmentId)}/${encodedPath}${cacheBust}`;
};

const cachedEnvironmentOutputFiles = (environmentId: string, root: string, current = root): EnvironmentOutputFile[] => {
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
      const fileType = outputFileTypeForPath(fullPath);
      const version = `${Math.round(stats.mtimeMs)}-${stats.size}`;
      const file: EnvironmentOutputFile = {
        sandboxPath: `/workspace/output/${outputRelativePath}`,
        relativePath: outputRelativePath,
        name: basename(outputRelativePath),
        path: fullPath,
        bytes: stats.size,
        modifiedAt: stats.mtimeMs,
        fileType,
        mediaType,
        url:
          mediaType || fileType === "html" || fileType === "markdown" || fileType === "text"
            ? mediaUrl(environmentId, relativeEntry, version)
            : undefined
      };
      return [file];
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt || left.relativePath.localeCompare(right.relativePath));
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

const withEnvironmentSnapshotLock = async <T>(environmentId: string, task: () => Promise<T>): Promise<T> => {
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

/**
 * Downloads an environment snapshot tar straight to disk via the GenAI SDK.
 * Writes to a temp file and renames so readers never see a truncated tar.
 */
const downloadSnapshotTarTo = async (environmentId: string, filePath: string): Promise<void> => {
  const partialPath = `${filePath}.partial`;
  try {
    await createClient().downloadEnvironmentSnapshotTo(environmentId, partialPath);
    renameSync(partialPath, filePath);
  } catch (error) {
    rmSync(partialPath, { force: true });
    throw error;
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

  // Policy: the server snapshot is the source of truth whenever it has
  // content. Local auto-saves are seeded into the cache ONLY as a fallback
  // when the server can't provide anything (download failure or an empty
  // snapshot) — never merged into a server-derived listing.
  const cached = cachedEnvironmentOutputFiles(environmentId, extractRoot);
  if (!force && cached.length > 0) {
    return cached;
  }

  return withEnvironmentSnapshotLock(environmentId, async () => {
    if (!force) {
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
      await downloadSnapshotTarTo(environmentId, tarPath);

      const listed = await execFileAsync("tar", ["-tf", tarPath], {
        maxBuffer: 64 * 1024 * 1024
      });
      const selectedEntries = unique(
        listed.stdout
          .split("\n")
          .map((entry) => entry.trim())
          .map(normalizedRelativeTarPath)
          .filter((entry): entry is string => Boolean(entry && outputRelativePathForEntry(entry)))
      );

      if (selectedEntries.length === 0) {
        // The server has nothing: keep whatever is already cached and fall
        // back to locally auto-saved media rather than clearing anything.
        rmSync(nextExtractRoot, { recursive: true, force: true });
        await copyAutoSavedMediaToCache(environmentId, extractRoot);
        return cachedEnvironmentOutputFiles(environmentId, extractRoot);
      }

      await extractTarEntries(cacheRoot, tarPath, targetExtractRoot, selectedEntries);

      if (force) {
        replaceExtractRootFromNext();
      }

      // Local convenience copies (outputs/managed-agent/) so generated media
      // survives environment expiry. This is the only auto-save hook now that
      // media resolution is cache-only.
      for (const entry of selectedEntries) {
        const mediaPath = resolve(extractRoot, entry);
        if (
          mediaTypeForPath(mediaPath) &&
          pathIsInside(mediaPath, resolve(extractRoot)) &&
          existsSync(mediaPath) &&
          statSync(mediaPath).isFile()
        ) {
          await autoSaveMedia(environmentId, mediaPath);
        }
      }

      return cachedEnvironmentOutputFiles(environmentId, extractRoot);
    } catch (error) {
      await copyAutoSavedMediaToCache(environmentId, extractRoot);
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
    // Agent-generated HTML can reference subresources with malformed
    // percent-escapes or paths; any parse/stat failure is a plain 404, not an
    // uncaught handler error.
    try {
      const url = new URL(request.url);
      const environmentSegment = safeCacheSegment(url.hostname);
      const relativeEntry = normalizedRelativeTarPath(decodeURIComponent(url.pathname.slice(1)));
      if (!relativeEntry || !canServeOutputPath(relativeEntry)) {
        return new Response("Not found", { status: 404 });
      }

      const root = resolve(mediaCacheRoot(), environmentSegment, "files");
      const path = resolve(root, relativeEntry);
      if (!pathIsInside(path, root) || !existsSync(path) || !statSync(path).isFile()) {
        return new Response("Not found", { status: 404 });
      }

      return mediaFileResponse(path, request);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
};

/** Strip surrounding whitespace and any control chars so a pasted key can't inject extra .env lines. */
const sanitizeKey = (key: string): string => key.trim().replace(/[\x00-\x1f]/g, "");

/** Upsert `NAME=value` in a .env file, preserving other lines and creating the file if needed. */
const upsertEnvKey = (envPath: string, name: string, value: string): void => {
  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!value) {
    content = content.replace(new RegExp(`^${name}=.*(?:\\r?\\n)?`, "m"), "").replace(/\n{3,}/g, "\n\n");
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
const fail = <T>(error: unknown): IpcResult<T> => ({
  ok: false,
  error: serializeError(error)
});
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

// Seeded from wall-clock so sequence values stay above anything persisted by a
// previous app run; the renderer sorts merged events by seq for canonical order.
let nextStreamEventSeq = Date.now() * 1000;

const rememberStreamEvent = (
  buffer: {
    events: InteractionStreamEvent[];
    latestInteraction?: Interaction;
    lastEventId?: string;
  },
  streamEvent: InteractionStreamEvent
): {
  event: InteractionStreamEvent;
  latestInteraction: Interaction | undefined;
} => {
  const event: InteractionStreamEvent = {
    ...streamEvent,
    seq: nextStreamEventSeq
  };
  nextStreamEventSeq += 1;
  buffer.events = [...buffer.events, event].slice(-300);
  if (event.event_id) {
    buffer.lastEventId = event.event_id;
  }
  if (event.interaction) {
    buffer.latestInteraction = event.interaction;
    return { event, latestInteraction: event.interaction };
  }
  if (event.interaction_id || event.status) {
    const id = event.interaction_id ?? buffer.latestInteraction?.id;
    if (id) {
      buffer.latestInteraction = {
        ...(buffer.latestInteraction ?? { id }),
        id,
        status: event.status ?? buffer.latestInteraction?.status
      };
      return { event, latestInteraction: buffer.latestInteraction };
    }
  }
  return { event, latestInteraction: buffer.latestInteraction };
};

// Mirrors the renderer's status sets: anything not known-live is terminal.
const NON_TERMINAL_INTERACTION_STATUS = new Set([
  "queued",
  "running",
  "in_progress",
  "in-progress",
  "pending",
  "processing",
  "started",
  "requires_action",
  "requires-action"
]);

const interactionStatusIsTerminal = (interaction: Interaction | undefined): boolean => {
  const status = interaction?.status?.toLowerCase();
  return Boolean(status && !NON_TERMINAL_INTERACTION_STATUS.has(status));
};

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

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
      environment_id: nonEmptyString(latestInteraction?.environment_id) ?? nonEmptyString(hydrated.environment_id)
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
    // Only an in-place reload of the app shell may proceed. A same-origin
    // check is not enough: the packaged app shell is a file:// URL whose
    // origin is "null", so ANY file:// navigation (e.g. a file dragged onto
    // the window) would compare equal and replace the app.
    if (url === mainWindow.webContents.getURL()) {
      return;
    }
    event.preventDefault();
    openWebUrlExternally(url);
  });

  // will-navigate only covers the main frame. The only subframes in this app
  // are sandboxed output previews (about:srcdoc); generated scripts, forms,
  // and meta refreshes must not replace the decorated preview document with
  // live web content inside the app. Deliberate link clicks reach the OS
  // browser via the preview's postMessage bridge instead.
  mainWindow.webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame) {
      return;
    }
    if (details.url === "about:blank" || details.url.startsWith("about:srcdoc")) {
      return;
    }
    details.preventDefault();
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

  // A rejected load (dev server not up yet, missing packaged renderer) would
  // otherwise be an unhandled rejection and a silent blank window.
  const loaded = process.env.ELECTRON_RENDERER_URL
    ? mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    : mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  loaded.catch((error: unknown) => {
    console.error("Failed to load renderer:", error);
  });
};

handle(ipcChannels.runtimeConfig, () => ({
  hasApiKey: Boolean(process.env.GEMINI_API_KEY),
  apiKeyMasked: maskKey(process.env.GEMINI_API_KEY),
  apiRevision: envValueOrDefault(process.env.GEMINI_API_REVISION, GEMINI_API_REVISION),
  baseUrl: envValueOrDefault(process.env.GEMINI_API_BASE_URL, GEMINI_API_BASE_URL),
  envPath: ENV_PATH,
  chatStorePath: LOCAL_CHAT_ROOT,
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

handle<[string | undefined], EnsureAnythingAgentResult>(ipcChannels.ensureAnythingAgent, async (requestedAgentId) => {
  const agentId = requestedAgentId?.trim() || process.env.GEMINI_ANYTHING_AGENT_ID || DEFAULT_AGENT_ID;
  const client = createClient();
  const definition = buildAnythingAgentDefinition(agentId);
  const sourceTargets =
    typeof definition.base_environment === "object"
      ? (definition.base_environment.sources?.map((source) => source.target) ?? [])
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
});

handle<[AgentDefinition], Awaited<ReturnType<GeminiManagedAgentsClient["createAgent"]>>>(
  ipcChannels.createAgent,
  async (agent) => redactAgentForRenderer(await createClient().createAgent(agent))
);

handle(ipcChannels.listAgents, async () => redactAgentListForRenderer(await createClient().listAgents()));
handle<[string], Awaited<ReturnType<GeminiManagedAgentsClient["getAgent"]>>>(ipcChannels.getAgent, async (id) =>
  redactAgentForRenderer(await createClient().getAgent(id))
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
      for await (const streamEvent of client.createInteractionStream(augmentInteractionRequest(request), {
        signal: controller.signal
      })) {
        const remembered = rememberStreamEvent(buffer, streamEvent);
        latestInteraction = remembered.latestInteraction;
        if (event.sender.isDestroyed()) {
          controller.abort(new Error("Renderer was destroyed."));
          break;
        }
        event.sender.send(ipcChannels.interactionStreamEvent, {
          streamId,
          event: remembered.event
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
      // A dying stream is not the same as a dying run: long streams get cut
      // by the server (gRPC CANCELLED) or proxies while the interaction keeps
      // running — or already finished. Hydrate and report success whenever
      // the interaction itself reached a terminal state.
      if (latestInteraction?.id) {
        const hydrated = await hydrateStreamInteraction(client, latestInteraction);
        if (hydrated) {
          buffer.latestInteraction = hydrated;
          if (controller.signal.aborted || interactionStatusIsTerminal(hydrated)) {
            return ok(hydrated);
          }
        }
      }
      return fail<Interaction>(error);
    } finally {
      event.sender.off("destroyed", abortForDestroyedSender);
      buffer.done = true;
      scheduleStreamBufferCleanup(streamId, buffer);
      // Identity-guarded like the buffer cleanup: if a newer stream reused
      // this streamId, its controller must stay registered and cancellable.
      if (streamControllers.get(streamId) === controller) {
        streamControllers.delete(streamId);
      }
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
      latestInteraction: {
        id: interactionId,
        status: "in_progress"
      } as Interaction,
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
        const remembered = rememberStreamEvent(buffer, streamEvent);
        latestInteraction = remembered.latestInteraction;
        if (event.sender.isDestroyed()) {
          controller.abort(new Error("Renderer was destroyed."));
          break;
        }
        event.sender.send(ipcChannels.interactionStreamEvent, {
          streamId,
          event: remembered.event
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
      // Same as the create path: if the interaction is already terminal, the
      // stream's death is irrelevant — return the finished interaction.
      const hydrated = await hydrateStreamInteraction(client, latestInteraction, interactionId);
      if (hydrated) {
        buffer.latestInteraction = hydrated;
        if (controller.signal.aborted || interactionStatusIsTerminal(hydrated)) {
          return ok(hydrated);
        }
      }
      return fail<Interaction>(error);
    } finally {
      event.sender.off("destroyed", abortForDestroyedSender);
      buffer.done = true;
      scheduleStreamBufferCleanup(streamId, buffer);
      // Identity-guarded like the buffer cleanup: if a newer stream reused
      // this streamId, its controller must stay registered and cancellable.
      if (streamControllers.get(streamId) === controller) {
        streamControllers.delete(streamId);
      }
    }
  }
);
handle<[string], boolean>(ipcChannels.cancelInteractionStream, async (streamId) => {
  streamControllers.get(streamId)?.abort(new Error("Interaction stream cancelled."));
  return true;
});
handle<
  [string],
  {
    events: InteractionStreamEvent[];
    latestInteraction?: Interaction;
    done: boolean;
    lastEventId?: string;
  }
>(ipcChannels.getInteractionStreamSnapshot, async (streamId) => {
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
});
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
  await downloadSnapshotTarTo(environmentId, result.filePath);
  return {
    saved: true,
    path: result.filePath,
    bytes: statSync(result.filePath).size
  };
});

handle<[string, boolean | undefined], EnvironmentOutputFile[]>(
  ipcChannels.listEnvironmentOutputFiles,
  async (environmentId, force) => listEnvironmentOutputFilesFromSnapshot(environmentId, Boolean(force))
);

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

  await copyFile(source, result.filePath);
  return {
    saved: true,
    path: result.filePath,
    bytes: statSync(result.filePath).size
  };
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

handle<[string], ReadEnvironmentOutputTextResult>(ipcChannels.readEnvironmentOutputText, async (sourcePath) => {
  const source = resolve(sourcePath);
  const cacheRoot = resolve(mediaCacheRoot());
  const outputRoot = resolve(LOCAL_OUTPUT_ROOT);
  const insideKnownOutputRoot = pathIsInside(source, cacheRoot) || pathIsInside(source, outputRoot);
  if (!insideKnownOutputRoot || !existsSync(source) || !statSync(source).isFile()) {
    throw new Error("Output text file is not available in the app cache.");
  }

  const fileType = outputFileTypeForPath(source);
  if (fileType !== "html" && fileType !== "markdown" && fileType !== "text") {
    throw new Error("Output file is not readable text.");
  }

  const bytes = statSync(source).size;
  const maxPreviewBytes = 10 * 1024 * 1024;
  if (bytes > maxPreviewBytes) {
    throw new Error(
      `This file is too large to preview in the app (${Math.round(bytes / (1024 * 1024))} MB). Use "Save" to export it instead.`
    );
  }

  return {
    path: source,
    content: readFileSync(source, "utf8"),
    bytes,
    fileType
  };
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
  return {
    saved: true,
    path: result.filePath,
    bytes: statSync(result.filePath).size
  };
});

handle(ipcChannels.loadStoredSessions, (): ChatSessionStoreSnapshot => ({
  rootPath: LOCAL_CHAT_ROOT,
  sessions: loadChatSessionsFromDisk(LOCAL_CHAT_ROOT)
}));

handle<[PersistedSession[]], ChatSessionStoreSnapshot>(ipcChannels.saveStoredSessions, (sessions) => {
  saveChatSessionsToDisk(LOCAL_CHAT_ROOT, sessions);
  // Re-reading every conversation file here doubled the save cost, and the
  // renderer keeps its own copy of the sessions it just saved.
  return {
    rootPath: LOCAL_CHAT_ROOT,
    sessions
  };
});

ipcMain.on(ipcChannels.appendConversationDiagnostics, (_event, conversationId: unknown, entry: unknown) => {
  if (typeof conversationId !== "string" || !conversationId.trim() || typeof entry !== "object" || entry === null) {
    return;
  }
  const { at, event: eventName, detail } = entry as Record<string, unknown>;
  if (typeof at !== "string" || typeof eventName !== "string") {
    return;
  }
  queueConversationDiagnostics(conversationId, {
    at,
    event: eventName,
    detail: typeof detail === "string" ? detail : undefined
  });
});

// Blocking variant for window unload: renderer saves are coalesced, so the
// final pending snapshot must land on disk before the process goes away.
ipcMain.on(ipcChannels.saveStoredSessionsSync, (event, sessions: PersistedSession[]) => {
  try {
    saveChatSessionsToDisk(LOCAL_CHAT_ROOT, sessions);
    event.returnValue = true;
  } catch (error) {
    console.error("Failed to persist chat sessions during unload:", error);
    event.returnValue = false;
  }
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
