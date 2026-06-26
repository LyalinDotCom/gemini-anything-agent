import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { config as loadEnv } from "dotenv";
import { createHash } from "node:crypto";
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, extname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ANTIGRAVITY_BASE_AGENT,
  GEMINI_API_BASE_URL,
  GEMINI_API_REVISION,
  GeminiApiError,
  GeminiManagedAgentsClient,
  normalizeAgentDefinition,
  type AgentDefinition,
  type Interaction,
  type InteractionCreateRequest,
  type InteractionStreamEvent,
  type ManagedAgent
} from "../sdk";
import {
  ipcChannels,
  type AgentProjectFileSnapshot,
  type AgentProjectSnapshot,
  type EnsureAnythingAgentResult,
  type IpcError,
  type IpcResult,
  type ResolvedEnvironmentMedia,
  type SaveResolvedMediaResult,
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

const sandboxEnvContent = (): string =>
  [
    `GEMINI_API_KEY=${envValue(process.env.GEMINI_API_KEY)}`,
    `GEMINI_ANYTHING_NPM_PACKAGE=${envValue(process.env.GEMINI_ANYTHING_NPM_PACKAGE ?? DEFAULT_NPM_PACKAGE)}`,
    `GEMINI_ANYTHING_NPM_VERSION=${envValue(process.env.GEMINI_ANYTHING_NPM_VERSION ?? DEFAULT_NPM_VERSION)}`
  ].join("\n") + "\n";

const readAgentAsset = (relativePath: string, fallback: string): string => {
  const path = join(AGENT_ASSETS_ROOT, relativePath);
  return existsSync(path) ? readFileSync(path, "utf8") : fallback;
};

const defaultAnythingSystemInstruction =
  "You are Gemini Anything Agent. Use native tools for text, coding, planning, research, file work, and artifact transformations. Use gai only for new image, video, and text-to-speech generation.";

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

const redactDefinitionSecrets = (agent: AgentDefinition): AgentDefinition => {
  const comparable = comparableAgentDefinition(agent);
  if (typeof comparable.base_environment === "object" && comparable.base_environment?.sources) {
    comparable.base_environment = {
      ...comparable.base_environment,
      sources: comparable.base_environment.sources.map((source) =>
        source.type === "inline" && source.target === ".env"
          ? {
              ...source,
              content: source.content.replace(/^GEMINI_API_KEY=.*$/m, "GEMINI_API_KEY=<configured>")
            }
          : source
      )
    };
  }
  delete comparable.description;
  return comparable;
};

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
            "# Gemini Anything Agent\n\nUse native managed-agent tools for normal work. Use gai only for image, video, and text-to-speech.\n"
          )
        },
        {
          type: "inline",
          target: ".agents/skills/gemini-anything/SKILL.md",
          content: readAgentAsset(
          "skills/gemini-anything/SKILL.md",
            "# Gemini Anything Media Skill\n\nUse bash /.agents/bin/gai for image, video, and tts generation.\n"
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

const uniqueOutputPath = (directory: string, fileName: string): string => {
  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  let candidate = join(directory, fileName);
  for (let index = 2; existsSync(candidate); index += 1) {
    candidate = join(directory, `${stem}-${index}${extension}`);
  }
  return candidate;
};

const autoSaveMedia = (environmentId: string, sourcePath: string): string => {
  const directory = join(LOCAL_OUTPUT_ROOT, safeCacheSegment(environmentId));
  mkdirSync(directory, { recursive: true });
  const target = uniqueOutputPath(directory, basename(sourcePath));
  copyFileSync(sourcePath, target);
  return target;
};

const mediaUrl = (environmentId: string, relativeEntry: string): string => {
  const encodedPath = relativeEntry
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${MEDIA_PROTOCOL}://${safeCacheSegment(environmentId)}/${encodedPath}`;
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
    if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
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
const streamBuffers = new Map<
  string,
  {
    events: InteractionStreamEvent[];
    latestInteraction?: Interaction;
    done: boolean;
    lastEventId?: string;
    cleanupTimer?: ReturnType<typeof setTimeout>;
  }
>();

const scheduleStreamBufferCleanup = (streamId: string): void => {
  const buffer = streamBuffers.get(streamId);
  if (!buffer || buffer.cleanupTimer) {
    return;
  }
  buffer.cleanupTimer = setTimeout(() => {
    streamBuffers.delete(streamId);
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
  agentId: process.env.GEMINI_ANYTHING_AGENT_ID ?? DEFAULT_AGENT_ID,
  npmPackage: process.env.GEMINI_ANYTHING_NPM_PACKAGE ?? DEFAULT_NPM_PACKAGE,
  npmVersion: process.env.GEMINI_ANYTHING_NPM_VERSION ?? DEFAULT_NPM_VERSION
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
          agent: existing,
          created: false,
          sourceTargets
        };
      }

      await client.deleteAgent(agentId);
      return {
        agent: await client.createAgent(definition),
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
        agent: await client.createAgent(definition),
        created: true,
        sourceTargets
      };
    } catch (error) {
      if (!isMissingAgentError(error) && !(error instanceof GeminiApiError && error.status === 409)) {
        throw error;
      }
      return {
        agent: await client.getAgent(agentId),
        created: false,
        sourceTargets
      };
    }
  }
);

handle<[AgentDefinition], Awaited<ReturnType<GeminiManagedAgentsClient["createAgent"]>>>(
  ipcChannels.createAgent,
  async (agent) => createClient().createAgent(agent)
);

handle(ipcChannels.listAgents, async () => createClient().listAgents());
handle<[string], Awaited<ReturnType<GeminiManagedAgentsClient["getAgent"]>>>(
  ipcChannels.getAgent,
  async (id) => createClient().getAgent(id)
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

    try {
      for await (const streamEvent of client.createInteractionStream(augmentInteractionRequest(request), { signal: controller.signal })) {
        latestInteraction = rememberStreamEvent(buffer, streamEvent);
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
      buffer.done = true;
      scheduleStreamBufferCleanup(streamId);
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
    let latestInteraction: Interaction | undefined = buffer.latestInteraction;

    try {
      for await (const streamEvent of client.resumeInteractionStream(interactionId, {
        lastEventId,
        signal: controller.signal
      })) {
        latestInteraction = rememberStreamEvent(buffer, streamEvent);
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
      buffer.done = true;
      scheduleStreamBufferCleanup(streamId);
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
    const tarPath = join(cacheRoot, "snapshot.tar");
    rmSync(cacheRoot, { recursive: true, force: true });
    mkdirSync(extractRoot, { recursive: true });

    const buffer = await createClient().downloadEnvironmentSnapshot(environmentId);
    writeFileSync(tarPath, Buffer.from(buffer));

    try {
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

      await execFileAsync("tar", ["-xf", tarPath, "-C", extractRoot, ...selectedEntries], {
        maxBuffer: 5 * 1024 * 1024
      });

      return requestedPaths.flatMap((requestedPath) => {
        const entry = selectedEntries.find((candidate) => requestedPathMatchesTarEntry(requestedPath, candidate));
        const relativeEntry = entry ? normalizedRelativeTarPath(entry) : undefined;
        if (!relativeEntry) {
          return [];
        }
        const path = resolve(extractRoot, relativeEntry);
        if (!path.startsWith(resolve(extractRoot))) {
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
    } finally {
      rmSync(tarPath, { force: true });
    }
  }
);

handle<[string], SaveResolvedMediaResult>(ipcChannels.saveResolvedMedia, async (sourcePath) => {
  const source = resolve(sourcePath);
  const root = resolve(mediaCacheRoot());
  if (!source.startsWith(root) || !existsSync(source) || !statSync(source).isFile() || !mediaTypeForPath(source)) {
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
