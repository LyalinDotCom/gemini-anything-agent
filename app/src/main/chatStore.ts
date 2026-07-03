import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, join } from "node:path";
import type { InteractionCreateRequest } from "../sdk";
import type { PersistedSession } from "../shared/electron-api";

const STORE_VERSION = 1;
const CONVERSATION_FILE = "conversation.json";

type ConversationFile = {
  schemaVersion: typeof STORE_VERSION;
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sessions: PersistedSession[];
};

export const chatStoreRootPath = (repoRoot: string): string => join(repoRoot, "chats");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const promptForInput = (input: InteractionCreateRequest["input"]): string => {
  if (typeof input === "string") {
    return input;
  }
  return input
    .map((part) => (part.type === "text" ? part.text : `[${part.mime_type} image]`))
    .join("\n")
    .trim();
};

const firstPromptLine = (input: InteractionCreateRequest["input"]): string => {
  const prompt = promptForInput(input).trim().replace(/\s+/g, " ");
  if (!prompt) {
    return "Untitled conversation";
  }
  return prompt.length > 80 ? `${prompt.slice(0, 79)}...` : prompt;
};

const safeSegment = (value: string, fallback = "chat"): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
};

const compactDate = (value: number): string => {
  const date = new Date(Number.isFinite(value) ? value : Date.now());
  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
};

const prettyDate = (value: number | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : "";

const conversationRootId = (session: PersistedSession, byId: Map<string, PersistedSession>): string => {
  let current = session;
  const seen = new Set<string>();
  while (current.parentLocalId && byId.has(current.parentLocalId) && !seen.has(current.localId)) {
    seen.add(current.localId);
    current = byId.get(current.parentLocalId)!;
  }
  return current.localId;
};

const groupSessions = (sessions: PersistedSession[]): Map<string, PersistedSession[]> => {
  const byId = new Map(sessions.map((session) => [session.localId, session]));
  const grouped = new Map<string, PersistedSession[]>();
  for (const session of sessions) {
    const rootId = conversationRootId(session, byId);
    grouped.set(rootId, [...(grouped.get(rootId) ?? []), session]);
  }
  return grouped;
};

const readConversationFile = (path: string): ConversationFile | undefined => {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.conversationId !== "string" ||
      !Array.isArray(parsed.sessions)
    ) {
      return undefined;
    }
    return parsed as ConversationFile;
  } catch {
    return undefined;
  }
};

// Saves run on every renderer state change, so unchanged conversations and runs
// must be skipped instead of rewritten. Keyed by absolute folder path.
const folderConversationIds = new Map<string, string>();
const writtenConversations = new Map<string, string>();
const writtenRuns = new Map<string, string>();

export type ConversationDiagnosticEntry = {
  at: string;
  event: string;
  detail?: string;
};

// Runtime diagnostics (stream retries, transient errors, lifecycle) queue in
// memory and flush into each conversation's folder on the next save, since
// the save flow is what knows which folder a conversation lives in.
const diagnosticsQueues = new Map<string, string[]>();
const MAX_QUEUED_DIAGNOSTIC_LINES = 500;

export const queueConversationDiagnostics = (
  conversationId: string,
  entry: ConversationDiagnosticEntry
): void => {
  const queue = diagnosticsQueues.get(conversationId) ?? [];
  queue.push(JSON.stringify(entry));
  if (queue.length > MAX_QUEUED_DIAGNOSTIC_LINES) {
    queue.splice(0, queue.length - MAX_QUEUED_DIAGNOSTIC_LINES);
  }
  diagnosticsQueues.set(conversationId, queue);
};

const flushConversationDiagnostics = (conversationId: string, folderPath: string): void => {
  const queue = diagnosticsQueues.get(conversationId);
  if (!queue?.length) {
    return;
  }
  diagnosticsQueues.delete(conversationId);
  try {
    appendFileSync(join(folderPath, "diagnostics.log"), `${queue.join("\n")}\n`, "utf8");
  } catch {
    // Diagnostics must never break chat persistence.
  }
};

const forgetFolderCaches = (folderPath: string): void => {
  folderConversationIds.delete(folderPath);
  writtenConversations.delete(folderPath);
  for (const key of writtenRuns.keys()) {
    if (key.startsWith(`${folderPath}/`)) {
      writtenRuns.delete(key);
    }
  }
};

const conversationIdForFolder = (folderPath: string): string | undefined => {
  const cached = folderConversationIds.get(folderPath);
  if (cached) {
    return cached;
  }
  const conversation = readConversationFile(join(folderPath, CONVERSATION_FILE));
  if (conversation?.conversationId) {
    folderConversationIds.set(folderPath, conversation.conversationId);
    return conversation.conversationId;
  }
  return undefined;
};

const writeTextFile = (path: string, content: string): void => {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, content, "utf8");
  renameSync(tempPath, path);
};

const writeJsonFile = (path: string, value: unknown): void =>
  writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);

const conversationMarkdown = (conversation: ConversationFile): string => {
  const lines = [
    `# ${conversation.title}`,
    "",
    `- Conversation ID: \`${conversation.conversationId}\``,
    `- Created: ${prettyDate(conversation.createdAt)}`,
    `- Updated: ${prettyDate(conversation.updatedAt)}`,
    `- Turns: ${conversation.sessions.length}`,
    ""
  ];

  for (const [index, session] of conversation.sessions.entries()) {
    const prompt = promptForInput(session.request.input).trim() || "(empty prompt)";
    const outputPreview = JSON.stringify(session.seed?.output_text ?? session.seed?.output ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 500);
    lines.push(
      `## Turn ${index + 1}`,
      "",
      `- Local ID: \`${session.localId}\``,
      `- Interaction ID: \`${session.seed?.id ?? ""}\``,
      `- Parent Local ID: \`${session.parentLocalId ?? ""}\``,
      `- Previous Interaction ID: \`${session.request.previous_interaction_id ?? ""}\``,
      `- Environment: \`${typeof session.request.environment === "string" ? session.request.environment : "config"}\``,
      `- Environment ID: \`${session.seed?.environment_id ?? ""}\``,
      `- Status: \`${session.error ? "error" : session.seed?.status ?? "pending"}\``,
      `- Started: ${prettyDate(session.startedAt)}`,
      `- Completed: ${prettyDate(session.completedAt)}`,
      "",
      "### Prompt",
      "",
      "```text",
      prompt,
      "```",
      ""
    );
    if (session.error) {
      lines.push("### Error", "", "```text", `${session.error.name}: ${session.error.message}`, "```", "");
    }
    if (outputPreview && outputPreview !== "\"\"") {
      lines.push("### Output Preview", "", "```json", outputPreview, "```", "");
    }
  }

  return `${lines.join("\n")}\n`;
};

const conversationFolderName = (root: PersistedSession): string =>
  `${compactDate(root.startedAt)}-${safeSegment(firstPromptLine(root.request.input))}-${safeSegment(root.localId)}`;

// A single dangling symlink or unreadable entry must not abort a scan of the
// whole store: a failed load feeds the renderer an empty session list, and the
// next autosave would then delete every conversation on disk.
const conversationFolderPaths = (rootPath: string): string[] => {
  const paths: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(rootPath);
  } catch {
    return paths;
  }
  for (const entry of entries) {
    const folderPath = join(rootPath, entry);
    try {
      if (statSync(folderPath).isDirectory()) {
        paths.push(folderPath);
      }
    } catch {
      // Skip entries that cannot be stat'ed (dangling symlinks, permissions).
    }
  }
  return paths;
};

const existingConversationFolders = (rootPath: string): Map<string, string> => {
  const folders = new Map<string, string>();
  for (const folderPath of conversationFolderPaths(rootPath)) {
    const conversationId = conversationIdForFolder(folderPath);
    if (conversationId) {
      folders.set(conversationId, folderPath);
    }
  }
  return folders;
};

const runFolderName = (session: PersistedSession): string =>
  `${compactDate(session.startedAt)}-${safeSegment(session.localId, "run")}`;

const writeRunFiles = (runPath: string, session: PersistedSession): void => {
  const serialized = JSON.stringify(session);
  if (writtenRuns.get(runPath) === serialized) {
    return;
  }
  mkdirSync(runPath, { recursive: true });
  // Sidecar files must be removed when their source data is gone — a run that
  // errored and later succeeded on reconnect must not keep a stale error.json.
  const writeOrRemove = (name: string, content: string | undefined): void => {
    if (content === undefined) {
      rmSync(join(runPath, name), { force: true });
    } else {
      writeTextFile(join(runPath, name), content);
    }
  };
  const asJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

  writeJsonFile(join(runPath, "session.json"), session);
  writeJsonFile(join(runPath, "request.json"), session.request);
  writeOrRemove("latest-interaction.json", session.seed ? asJson(session.seed) : undefined);
  writeOrRemove(
    "events.jsonl",
    session.events?.length
      ? `${session.events.map((event) => JSON.stringify(event)).join("\n")}\n`
      : undefined
  );
  writeOrRemove("error.json", session.error ? asJson(session.error) : undefined);
  writeOrRemove(
    "attachments.json",
    session.imageAttachments?.length ? asJson(session.imageAttachments) : undefined
  );
  writtenRuns.set(runPath, serialized);
};

export const loadChatSessionsFromDisk = (rootPath: string): PersistedSession[] => {
  const sessions: PersistedSession[] = [];
  for (const folderPath of conversationFolderPaths(rootPath)) {
    const conversation = readConversationFile(join(folderPath, CONVERSATION_FILE));
    if (conversation?.sessions) {
      sessions.push(...conversation.sessions);
    }
  }
  return sessions;
};

export const saveChatSessionsToDisk = (rootPath: string, sessions: PersistedSession[]): void => {
  mkdirSync(rootPath, { recursive: true });
  const grouped = groupSessions(sessions);
  const activeConversationIds = new Set(grouped.keys());
  const existing = existingConversationFolders(rootPath);

  for (const [conversationId, folderPath] of existing) {
    if (!activeConversationIds.has(conversationId)) {
      rmSync(folderPath, { recursive: true, force: true });
      forgetFolderCaches(folderPath);
      diagnosticsQueues.delete(conversationId);
    }
  }

  for (const [conversationId, group] of grouped) {
    const sorted = [...group].sort((left, right) => left.startedAt - right.startedAt);
    const root = sorted[0];
    if (!root) {
      continue;
    }
    const folderPath = existing.get(conversationId) ?? join(rootPath, conversationFolderName(root));
    mkdirSync(folderPath, { recursive: true });
    // Diagnostics flush regardless of the content dirty-check below — a
    // stream retry can happen without any chat content changing.
    flushConversationDiagnostics(conversationId, folderPath);
    const runsPath = join(folderPath, "runs");
    const title = firstPromptLine(root.request.input);
    const conversation: ConversationFile = {
      schemaVersion: STORE_VERSION,
      conversationId,
      title,
      createdAt: root.startedAt,
      updatedAt: Math.max(...sorted.map((session) => session.completedAt ?? session.startedAt)),
      sessions: sorted
    };

    const serialized = `${JSON.stringify(conversation, null, 2)}\n`;
    const previouslyWritten =
      writtenConversations.get(folderPath) ??
      (existsSync(join(folderPath, CONVERSATION_FILE))
        ? readFileSync(join(folderPath, CONVERSATION_FILE), "utf8")
        : undefined);
    if (previouslyWritten === serialized) {
      writtenConversations.set(folderPath, serialized);
      folderConversationIds.set(folderPath, conversationId);
      continue;
    }

    mkdirSync(runsPath, { recursive: true });
    writeTextFile(join(folderPath, CONVERSATION_FILE), serialized);
    writeTextFile(join(folderPath, "conversation.md"), conversationMarkdown(conversation));
    writeTextFile(
      join(folderPath, "README.md"),
      [
        `# ${title}`,
        "",
        "This folder is written by the Gemini Anything Agent sample app.",
        "",
        "- `conversation.json` is the full machine-readable chat record.",
        "- `conversation.md` is a human-readable timeline.",
        "- `runs/` contains one folder per agent turn with request, response, stream events, errors, and media metadata.",
        "- `diagnostics.log` is an append-only runtime log (run lifecycle, stream retries, transient errors) for support and debugging.",
        "",
        `Folder: \`${basename(folderPath)}\``,
        ""
      ].join("\n")
    );

    const expectedRunFolders = new Set(sorted.map(runFolderName));
    for (const entry of readdirSync(runsPath)) {
      if (!expectedRunFolders.has(entry)) {
        rmSync(join(runsPath, entry), { recursive: true, force: true });
        writtenRuns.delete(join(runsPath, entry));
      }
    }
    for (const session of sorted) {
      writeRunFiles(join(runsPath, runFolderName(session)), session);
    }
    writtenConversations.set(folderPath, serialized);
    folderConversationIds.set(folderPath, conversationId);
  }
};
