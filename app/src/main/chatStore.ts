import {
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

const existingConversationFolders = (rootPath: string): Map<string, string> => {
  const folders = new Map<string, string>();
  if (!existsSync(rootPath)) {
    return folders;
  }
  for (const entry of readdirSync(rootPath)) {
    const folderPath = join(rootPath, entry);
    if (!statSync(folderPath).isDirectory()) {
      continue;
    }
    const conversation = readConversationFile(join(folderPath, CONVERSATION_FILE));
    if (conversation?.conversationId) {
      folders.set(conversation.conversationId, folderPath);
    }
  }
  return folders;
};

const runFolderName = (session: PersistedSession): string =>
  `${compactDate(session.startedAt)}-${safeSegment(session.localId, "run")}`;

const writeRunFiles = (runPath: string, session: PersistedSession): void => {
  mkdirSync(runPath, { recursive: true });
  writeJsonFile(join(runPath, "session.json"), session);
  writeJsonFile(join(runPath, "request.json"), session.request);
  if (session.seed) {
    writeJsonFile(join(runPath, "latest-interaction.json"), session.seed);
  }
  if (session.events?.length) {
    writeTextFile(
      join(runPath, "events.jsonl"),
      `${session.events.map((event) => JSON.stringify(event)).join("\n")}\n`
    );
  }
  if (session.error) {
    writeJsonFile(join(runPath, "error.json"), session.error);
  }
  if (session.imageAttachments?.length) {
    writeJsonFile(join(runPath, "attachments.json"), session.imageAttachments);
  }
  if (session.resolvedMedia?.length) {
    writeJsonFile(join(runPath, "resolved-media.json"), session.resolvedMedia);
  }
};

export const loadChatSessionsFromDisk = (rootPath: string): PersistedSession[] => {
  if (!existsSync(rootPath)) {
    return [];
  }
  const sessions: PersistedSession[] = [];
  for (const entry of readdirSync(rootPath)) {
    const folderPath = join(rootPath, entry);
    if (!statSync(folderPath).isDirectory()) {
      continue;
    }
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
    }
  }

  for (const [conversationId, group] of grouped) {
    const sorted = [...group].sort((left, right) => left.startedAt - right.startedAt);
    const root = sorted[0];
    if (!root) {
      continue;
    }
    const folderPath = existing.get(conversationId) ?? join(rootPath, conversationFolderName(root));
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

    mkdirSync(folderPath, { recursive: true });
    rmSync(runsPath, { recursive: true, force: true });
    mkdirSync(runsPath, { recursive: true });
    writeJsonFile(join(folderPath, CONVERSATION_FILE), conversation);
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
        "",
        `Folder: \`${basename(folderPath)}\``,
        ""
      ].join("\n")
    );

    for (const session of sorted) {
      writeRunFiles(join(runsPath, runFolderName(session)), session);
    }
  }
};
