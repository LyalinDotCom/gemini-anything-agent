// sendTurn: the whole life of one chat turn.
//   ensure agent → stream interaction → live-render blocks → (requires_action?
//   fulfill function → continue chain) → persist ids + transcript.
// Server-side state discipline: lastInteractionId is captured from the FIRST event
// (interaction.created) so even an aborted turn chains correctly, and environmentId
// is always threaded into continuations (required by the API).
import { ensureChatAgent } from "../gemini/agents";
import { ai, resolveApiKey } from "../gemini/client";
import { buildEnvSources } from "../gemini/envSources";
import { syncOutputMedia } from "../gemini/envFiles";
import { FriendlyError, toFriendly } from "../gemini/errors";
import type { InteractionInput } from "../gemini/interactionParams";
import { buildInteractionParams, functionResultPart } from "../gemini/interactionParams";
import type { StreamBlock, StreamMeta, StreamOutcome, Usage } from "../gemini/streamAdapter";
import { asEventStream, blocksFromInteraction, consumeInteractionStream } from "../gemini/streamAdapter";
import { useStore } from "../state/store";
import type { ContentPart, Message, ToolActivity } from "../state/types";
import { base64ToBlob, mediaId as makeMediaId, putMedia } from "../storage/messages";
import { uid } from "../utils/id";
import type { MediaStampedBlock } from "./blocksToParts";
import { blocksToParts, settleParts } from "./blocksToParts";
import { chatToolset, getFulfiller } from "./functionTools";

const MAX_FUNCTION_ROUNDS = 4;

const aborters = new Map<string, AbortController>();

export function abortTurn(sessionId: string): void {
  aborters.get(sessionId)?.abort();
}

function latestAssistantMessageId(sessionId: string): string | undefined {
  return [...(useStore.getState().messages[sessionId] ?? [])].reverse().find((m) => m.role === "assistant")?.id;
}

export async function cancelServerTurn(sessionId: string): Promise<void> {
  const store = useStore.getState();
  const session = store.sessions[sessionId];
  const interactionId = session?.pending?.interactionId ?? session?.lastInteractionId;
  const messageId = session?.pending?.messageId ?? latestAssistantMessageId(sessionId);
  abortTurn(sessionId);

  if (!session) return;
  if (!interactionId) {
    if (messageId) {
      const msg = (useStore.getState().messages[sessionId] ?? []).find((m) => m.id === messageId);
      if (msg) {
        useStore.getState().patchMessage(sessionId, messageId, {
          parts: settleParts(msg.parts),
          status: "stopped",
        });
      }
    }
    useStore.getState().patchSession(sessionId, { pending: null });
    useStore.getState().setStreaming(sessionId, false);
    return;
  }

  const cancelChip = (status: ToolActivity["status"], label: string, detail?: string): ContentPart => ({
    kind: "tool",
    id: `cancel-${Date.now()}`,
    activity: {
      tool: "setup",
      label,
      status,
      detail:
        detail ??
        [
          `chat: ${sessionId}`,
          `interaction: ${interactionId}`,
          `environment: ${session.environmentId ?? "unknown"}`,
        ].join("\n"),
    },
  });

  if (messageId) {
    const msg = (useStore.getState().messages[sessionId] ?? []).find((m) => m.id === messageId);
    if (msg) {
      useStore.getState().patchMessage(sessionId, messageId, {
        parts: [...msg.parts.filter((p) => p.id !== "recover-note"), cancelChip("running", "Cancelling server turn…")],
      });
    }
  }

  try {
    const interaction = (await ai().interactions.cancel(interactionId)) as Record<string, unknown>;
    const outcome = blocksFromInteraction(interaction);
    const status = outcome.status || "cancelled";
    if (messageId) {
      const msg = (useStore.getState().messages[sessionId] ?? []).find((m) => m.id === messageId);
      if (msg) {
        useStore.getState().patchMessage(sessionId, messageId, {
          parts: [
            ...msg.parts.filter((p) => !(p.kind === "tool" && p.activity.label === "Cancelling server turn…")),
            cancelChip(
              "done",
              `Server turn ${status}`,
              [
                `chat: ${sessionId}`,
                `interaction: ${outcome.interactionId || interactionId}`,
                `environment: ${outcome.environmentId || session.environmentId || "unknown"}`,
                `status: ${status}`,
              ].join("\n"),
            ),
          ],
          status: "stopped",
          interactionId: outcome.interactionId || interactionId,
        });
      }
    }
    useStore.getState().patchSession(sessionId, {
      lastInteractionId: outcome.interactionId || interactionId,
      environmentId: outcome.environmentId || session.environmentId,
      pending: null,
    });
  } catch (e) {
    const f = toFriendly(e);
    if (messageId) {
      const msg = (useStore.getState().messages[sessionId] ?? []).find((m) => m.id === messageId);
      if (msg) {
        useStore.getState().patchMessage(sessionId, messageId, {
          parts: [
            ...settleParts(
              msg.parts.filter((p) => !(p.kind === "tool" && p.activity.label === "Cancelling server turn…")),
            ),
            cancelChip(
              "error",
              "Stopped locally; server cancel was not confirmed",
              [
                `chat: ${sessionId}`,
                `interaction: ${interactionId}`,
                `environment: ${session.environmentId ?? "unknown"}`,
                `cancel error: ${f.message}`,
              ].join("\n"),
            ),
          ],
          status: "stopped",
          interactionId,
        });
      }
    }
    useStore.getState().patchSession(sessionId, { pending: null });
  } finally {
    aborters.delete(sessionId);
    useStore.getState().setStreaming(sessionId, false);
    useStore.getState().persistTranscript(sessionId);
  }
}

export function isTurnRunning(sessionId: string): boolean {
  return !!useStore.getState().streaming[sessionId];
}

function rafThrottle(fn: () => void): () => void {
  let scheduled = false;
  const raf =
    typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16);
  return () => {
    if (scheduled) return;
    scheduled = true;
    raf(() => {
      scheduled = false;
      fn();
    });
  };
}

export interface TurnInput {
  text: string;
  /** Pre-persisted uploads (already in IDB); wire parts carry base64 into the chain. */
  attachments?: Array<{ kind: "image" | "audio"; mediaId: string; mimeType: string; base64: string }>;
}

/**
 * Request-level system_instruction carries ONLY fresh per-call context. It must never
 * hold durable rules: agent-level and request-level instructions share one slot (the
 * request one silently replaces the agent one), while AGENTS.md is additive and
 * undisplaceable — so durable rules live there.
 */
function freshCallContext(): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  return `Current date/time for the user: ${now.toLocaleString()} (${tz}). The sandbox clock/timezone may differ.`;
}

/** Local, model-free session title: nothing runs on the client but string math. */
function titleFromText(text: string): string | null {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const words = clean.split(" ").slice(0, 6).join(" ");
  const cut = words.length > 42 ? `${words.slice(0, 42)}…` : words;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

/** Pull /workspace/output files produced by a turn down into this chat's file index. Best-effort. */
function syncOutputMediaBestEffort(sessionId: string, environmentId: string): void {
  void syncOutputMedia(sessionId, environmentId).catch(() => {
    // sync is best-effort; the Files panel offers a manual retry
  });
}

/** Text-only recap used to reseed a fresh chain after server-side expiry. */
function condenseTranscript(messages: Message[]): string {
  const lines: string[] = [];
  for (const m of messages.slice(-8)) {
    const text = m.parts
      .filter((p): p is Extract<ContentPart, { kind: "text" }> => p.kind === "text")
      .map((p) => p.text)
      .join(" ")
      .slice(0, 240);
    if (text) lines.push(`${m.role === "user" ? "User" : "Assistant"}: ${text}`);
  }
  return lines.join("\n");
}

export async function sendTurn(sessionId: string, turn: TurnInput): Promise<void> {
  // Transcript must be hydrated before we append/persist, or we'd overwrite the
  // stored history with just this turn.
  await useStore.getState().hydrateSession(sessionId);
  const store = useStore.getState();
  if (store.streaming[sessionId]) return; // one turn per session; other sessions run independently
  const session = store.sessions[sessionId];
  if (!session || (!turn.text.trim() && !turn.attachments?.length)) return;

  // ---- user message
  const userParts: ContentPart[] = [];
  for (const a of turn.attachments ?? []) {
    if (a.kind === "audio") {
      userParts.push({ kind: "audio", id: uid(), mediaId: a.mediaId, mimeType: a.mimeType, label: "voice message" });
    } else {
      userParts.push({ kind: "image", id: uid(), mediaId: a.mediaId, mimeType: a.mimeType, origin: "uploaded" });
    }
  }
  if (turn.text.trim()) userParts.push({ kind: "text", id: uid(), text: turn.text.trim() });
  const userMessage: Message = { id: uid(), role: "user", createdAt: Date.now(), status: "complete", parts: userParts };
  store.appendMessage(sessionId, userMessage);
  store.persistTranscript(sessionId);

  // ---- assistant placeholder
  const assistantId = uid();
  store.appendMessage(sessionId, {
    id: assistantId,
    role: "assistant",
    createdAt: Date.now(),
    status: "streaming",
    parts: [],
  });
  store.setStreaming(sessionId, true);

  const controller = new AbortController();
  aborters.set(sessionId, controller);

  // Chain-expiry reseed: previous server session died, rebuild context inline.
  let contextPrefix = "";
  if (session.chainBroken) {
    const recap = condenseTranscript(useStore.getState().messages[sessionId]?.slice(0, -2) ?? []);
    if (recap) contextPrefix = `[Recap of our conversation so far — the previous server session expired]\n${recap}\n[End recap]\n\n`;
    useStore.getState().patchSession(sessionId, { chainBroken: false, lastInteractionId: null, environmentId: null });
  }

  // Accumulated parts across fulfillment rounds; live round renders after them.
  const settledParts: ContentPart[] = [];
  let liveParts: ContentPart[] = [];
  let lastInteractionId = (session.chainBroken ? null : session.lastInteractionId) ?? undefined;
  let environmentId = (session.chainBroken ? null : session.environmentId) ?? undefined;
  let usage: Usage | undefined;
  let sawError: unknown = null;

  const patchAssistant = (extra?: Partial<Message>) => {
    // Raw parts only — grouping happens at render time in MessageBubble.
    useStore.getState().patchMessage(sessionId, assistantId, { parts: [...settledParts, ...liveParts], ...extra });
  };
  const flush = rafThrottle(() => patchAssistant());

  // Session-start narration: make what's happening server-side explicit in the thread.
  const isFirstTurn = !lastInteractionId;
  const narrate = (id: string, label: string): void => {
    settledParts.push({ kind: "tool", id, activity: { tool: "setup", label, status: "running" } });
  };
  const setNarration = (id: string, patch: Partial<ToolActivity>): void => {
    const i = settledParts.findIndex((p) => p.kind === "tool" && p.id === id);
    if (i < 0) return;
    const p = settledParts[i] as Extract<ContentPart, { kind: "tool" }>;
    settledParts[i] = { ...p, activity: { ...p.activity, ...patch } };
  };
  if (isFirstTurn) {
    narrate("setup-agent", "Connecting to your managed agent…");
    narrate("setup-session", "Opening a server-side container session…");
    patchAssistant();
  }

  try {
    // ---- agent resolution (managed agent, or degraded fallback on base agent).
    // One conversation ↔ one agent: the first turn pins the agent on the session and
    // every later turn reuses it, even if the managed agent's health changes between
    // turns — a chain never mixes agents.
    const agentInfo = await ensureChatAgent(useStore.getState().agent);
    useStore.getState().setAgent(agentInfo);
    const pinned = useStore.getState().sessions[sessionId]?.agentUsed;
    const agentName = pinned ?? (agentInfo.degraded ? agentInfo.baseAgent : agentInfo.agentId);
    if (!pinned) useStore.getState().patchSession(sessionId, { agentUsed: agentName });
    // Degraded mode = chatting on the raw base agent: persona rides per-request instead.
    const degraded = agentName === agentInfo.baseAgent;

    if (isFirstTurn) {
      const AGENT_ACTION_LABELS: Record<string, string> = {
        created: `Created your managed agent (${agentName})`,
        recreated: `Updated your managed agent to the latest version (${agentName})`,
        reused: `Connected to your managed agent (${agentName})`,
        degraded: "Managed agent unavailable — using the shared base agent for now",
      };
      setNarration("setup-agent", {
        status: "done",
        label: AGENT_ACTION_LABELS[agentInfo.action ?? "reused"],
        detail: `agent: ${agentName}\nbase: ${agentInfo.baseAgent}\npayload: ${agentInfo.payloadFingerprint}\ninstalled: shared agents/ payload (AGENTS.md, gai launcher, gemini-anything skill) + API key`,
      });
      flush();
    }

    const userText = contextPrefix + turn.text.trim();
    let input: InteractionInput = turn.attachments?.length
      ? [
          ...turn.attachments.map((a) => ({ type: a.kind, data: a.base64, mime_type: a.mimeType })),
          ...(userText ? [{ type: "text", text: userText }] : []),
        ]
      : userText;

    let expiryHealed = false;
    let pendingMarkedFor = "";
    for (let round = 0; round < MAX_FUNCTION_ROUNDS; round++) {
      const params = buildInteractionParams({
        agent: agentName,
        input,
        toolset: chatToolset(),
        previousInteractionId: lastInteractionId,
        environmentId,
        systemInstruction: freshCallContext(),
        seedSources: degraded && !lastInteractionId ? buildEnvSources(resolveApiKey() ?? "") : undefined,
        stream: true,
      });

      let roundBlocks: MediaStampedBlock[] = [];
      const onUpdate = (blocks: StreamBlock[], meta: StreamMeta) => {
        roundBlocks = blocks;
        if (meta.interactionId) lastInteractionId = meta.interactionId;
        if (meta.environmentId) environmentId = meta.environmentId;
        // Durable in-flight marker: from the moment the server acks, a reload can
        // recover this turn from the server instead of losing it.
        if (meta.interactionId && meta.interactionId !== pendingMarkedFor) {
          pendingMarkedFor = meta.interactionId;
          useStore.getState().patchSession(sessionId, {
            pending: { interactionId: meta.interactionId, messageId: assistantId, startedAt: Date.now() },
          });
          useStore.getState().persistTranscript(sessionId);
        }
        liveParts = blocksToParts(roundBlocks, `r${round}`);
        flush();
      };

      let outcome!: Awaited<ReturnType<typeof consumeInteractionStream>>;
      try {
        // retries "none": an auto-retried POST /interactions would create a DUPLICATE
        // run server-side. Failures route through our own recovery instead.
        const stream = await ai().interactions.create(params as never, {
          signal: controller.signal,
          retries: { strategy: "none" },
          timeout_ms: 60 * 60 * 1000,
        } as never);
        outcome = await consumeInteractionStream(asEventStream(stream), onUpdate);
      } catch (e) {
        // Server-side state can expire (interaction chain or environment gone) even
        // though we persist the ids. Self-heal ONCE, inside this same turn: start a
        // fresh container, replay a condensed recap, and rerun the request.
        const f = toFriendly(e);
        const chainExpiry =
          f.kind === "not-found" ||
          ((f.kind === "bad-request" || f.kind === "unknown") &&
            /(interaction|environment)/i.test(f.message) &&
            /(not.?found|expired|invalid|no longer)/i.test(f.message));
        if (chainExpiry && !expiryHealed && lastInteractionId && !controller.signal.aborted) {
          expiryHealed = true;
          const recap = condenseTranscript((useStore.getState().messages[sessionId] ?? []).slice(0, -2));
          lastInteractionId = undefined;
          environmentId = undefined;
          useStore.getState().patchSession(sessionId, { lastInteractionId: null, environmentId: null, chainBroken: false });
          settledParts.push({
            kind: "tool",
            id: "expiry-heal",
            activity: {
              tool: "setup",
              label: "Server session expired — resumed in a fresh container",
              status: "done",
              detail: recap
                ? "The previous interaction chain/environment no longer exists on the server. Started a new one and replayed a condensed recap of the conversation."
                : "The previous interaction chain/environment no longer exists on the server. Started a new one.",
            },
          });
          patchAssistant();
          const healedText =
            (recap
              ? `[Recap of our conversation so far — the previous server session expired]\n${recap}\n[End recap]\n\n`
              : "") + turn.text.trim();
          input = turn.attachments?.length
            ? [
                ...turn.attachments.map((a) => ({ type: a.kind, data: a.base64, mime_type: a.mimeType })),
                ...(healedText ? [{ type: "text", text: healedText }] : []),
              ]
            : healedText;
          round--;
          continue;
        }
        // Connection blip AFTER the server acked: the turn is still running remotely —
        // reattach by polling the interaction instead of failing the turn.
        if ((f.kind === "network" || f.kind === "server") && pendingMarkedFor && !controller.signal.aborted) {
          settledParts.push({
            kind: "tool",
            id: `net-heal-${round}`,
            activity: {
              tool: "setup",
              label: "Connection hiccup — reattached to the running turn",
              status: "done",
              detail: "The stream dropped but the interaction kept running server-side; fetched its final state.",
            },
          });
          patchAssistant();
          outcome = await awaitInteractionOutcome(pendingMarkedFor, controller.signal);
          liveParts = blocksToParts(outcome.blocks as MediaStampedBlock[], `r${round}`);
        } else {
          throw e;
        }
      }
      roundBlocks = outcome.blocks;
      if (outcome.interactionId) lastInteractionId = outcome.interactionId;
      if (outcome.environmentId) environmentId = outcome.environmentId;
      if (outcome.usage) usage = outcome.usage;

      if (round === 0 && isFirstTurn) {
        setNarration("setup-session", {
          status: "done",
          label: "Container session ready — conversation state lives server-side",
          detail: `interaction: ${lastInteractionId ?? "?"}\nenvironment: ${environmentId ?? "?"}\nThe sandbox persists for this whole conversation; files under /workspace/output sync to this device.`,
        });
        flush();
      }

      // Persist any streamed media blocks (agent-produced images) before final render.
      for (const block of roundBlocks as MediaStampedBlock[]) {
        if (block.type === "image" && block.data && !block.mediaRef) {
          const mid = makeMediaId(sessionId, `${assistantId}-r${round}-${block.index}`);
          const mime = block.mimeType ?? "image/png";
          await putMedia(mid, sessionId, base64ToBlob(block.data, mime), mime);
          block.mediaRef = { mediaId: mid, mimeType: mime };
          block.data = undefined; // free the base64 string
        }
      }
      liveParts = blocksToParts(roundBlocks as MediaStampedBlock[], `r${round}`);

      if (outcome.status !== "requires_action") {
        settledParts.push(...settleParts(liveParts));
        liveParts = [];
        break;
      }

      // ---- requires_action: fulfill the pending function call and continue the chain
      const call = [...roundBlocks].reverse().find((b) => b.type === "function_call");
      const callId = call?.id ?? "";
      const callName = call?.name ?? "unknown";
      const args = (call?.arguments ?? {}) as Record<string, unknown>;
      let result: Awaited<ReturnType<NonNullable<ReturnType<typeof getFulfiller>>>>;

      const fulfiller = call ? getFulfiller(callName) : null;
      if (!call || !fulfiller) {
        result = `Error: the ${callName} tool is not available in this app right now. Tell the user and continue without it.`;
      } else {
        try {
          result = await fulfiller(args, {
            sessionId,
            signal: controller.signal,
            onArtifact: (artifact) => {
              if (artifact.kind === "image") {
                liveParts = [
                  ...liveParts.filter(
                    (p) => !(p.kind === "tool" && p.activity.tool === "generate_image" && p.activity.status === "running"),
                  ),
                  {
                    kind: "image",
                    id: uid(),
                    mediaId: artifact.mediaId,
                    mimeType: artifact.mimeType,
                    origin: "generated",
                    prompt: artifact.prompt,
                  },
                ];
                flush();
              }
            },
          });
        } catch (fulfillErr) {
          if (controller.signal.aborted) throw fulfillErr;
          result = `Error: ${callName} failed (${toFriendly(fulfillErr).message}). Tell the user briefly.`;
        }
      }

      settledParts.push(...settleParts(liveParts));
      liveParts = [];
      patchAssistant();

      input = [functionResultPart(callId, callName, result)];
      // Loop continues: next round streams the agent's post-tool response.
    }
  } catch (e) {
    sawError = e;
  }

  // ---- settle
  aborters.delete(sessionId);
  const friendly = sawError ? toFriendly(sawError) : null;
  const aborted = friendly?.kind === "aborted" || controller.signal.aborted;
  const finalParts = settleParts([...settledParts, ...liveParts], !!sawError && !aborted);

  // Server-side chain expired underneath us: recover by reseeding on the next turn.
  const chainExpired =
    friendly?.kind === "not-found" && !!(session.lastInteractionId || session.environmentId);

  useStore.getState().patchMessage(sessionId, assistantId, {
    parts: finalParts,
    status: aborted ? "stopped" : sawError ? "error" : "complete",
    interactionId: lastInteractionId,
    usage,
    errorMessage:
      sawError && !aborted
        ? chainExpired
          ? "The server-side session expired. Send your message again — I'll rebuild the context automatically."
          : friendly?.message
        : undefined,
  });
  useStore.getState().patchSession(
    sessionId,
    chainExpired
      ? { chainBroken: true, lastInteractionId: null, environmentId: null, pending: null }
      : {
          lastInteractionId: lastInteractionId ?? session.lastInteractionId,
          environmentId: environmentId ?? session.environmentId,
          pending: null,
        },
  );
  useStore.getState().setStreaming(sessionId, false);
  useStore.getState().persistTranscript(sessionId);

  // Title locally from the first message — no client-side model calls, ever.
  if (!sawError && !aborted) {
    const current = useStore.getState().sessions[sessionId];
    if (current && current.title === "New chat") {
      const title = titleFromText(turn.text) ?? (turn.attachments?.length ? "Voice & media chat" : null);
      if (title) useStore.getState().renameSession(sessionId, title);
    }
  }

  // Pull whatever the agent saved under /workspace/output down to this device (the
  // media handoff contract): snapshot → tar → IndexedDB → parts on this message.
  if (!aborted && environmentId) syncOutputMediaBestEffort(sessionId, environmentId);
}

// ---- reload / connection recovery ------------------------------------------

const RECOVER_POLL_MS = 4000;
const RECOVER_MAX_MS = 10 * 60_000;
const NON_TERMINAL_INTERACTION_STATUS = new Set(["queued", "pending", "running", "in_progress", "cancelling"]);
const SUCCESS_INTERACTION_STATUS = new Set(["completed", "succeeded"]);

function interactionStatusIsTerminal(status: string | undefined): boolean {
  return Boolean(status && !NON_TERMINAL_INTERACTION_STATUS.has(status.toLowerCase()));
}

/** Poll a server-side interaction until it reaches a terminal state (network-tolerant). */
async function awaitInteractionOutcome(
  interactionId: string,
  signal?: AbortSignal,
  onPoll?: (outcome: StreamOutcome) => void,
): Promise<StreamOutcome> {
  const started = Date.now();
  for (;;) {
    if (signal?.aborted) throw new FriendlyError("aborted", "Stopped.");
    try {
      const interaction = (await ai().interactions.get(interactionId)) as Record<string, unknown>;
      const outcome = blocksFromInteraction(interaction);
      onPoll?.(outcome);
      if (interactionStatusIsTerminal(outcome.status)) return outcome;
    } catch (e) {
      const f = toFriendly(e);
      if (f.kind !== "network" && f.kind !== "server" && f.kind !== "rate-limit") {
        throw f;
      }
      // network/server trouble: keep polling — that's the whole point
    }
    if (Date.now() - started > RECOVER_MAX_MS) {
      throw new FriendlyError("unknown", "Timed out waiting for the running turn to finish server-side.");
    }
    await new Promise((r) => setTimeout(r, RECOVER_POLL_MS));
  }
}

const recovering = new Set<string>();

/**
 * Called when a session mounts. If the session carries a `pending` marker, this tab
 * lost a turn mid-flight (reload/crash) — the SERVER has the truth, so fetch it and
 * complete the message. Sessions without `pending` are in a finished state and render
 * purely from local cache: no server calls.
 */
export async function recoverPendingTurn(sessionId: string): Promise<void> {
  const store = useStore.getState();
  const session = store.sessions[sessionId];
  const pending = session?.pending;
  if (!session || !pending || session.mode === "deep-research") return;
  if (store.streaming[sessionId] || recovering.has(pending.interactionId)) return;
  recovering.add(pending.interactionId);

  const chip: ContentPart = {
    kind: "tool",
    id: "recover-note",
    activity: {
      tool: "setup",
      label: "Reattached after reload — fetching this turn's latest state from the server",
      status: "running",
    },
  };
  const existing = (useStore.getState().messages[sessionId] ?? []).find((m) => m.id === pending.messageId);
  if (existing) {
    useStore.getState().patchMessage(sessionId, pending.messageId, {
      status: "streaming",
      parts: [chip, ...existing.parts.filter((p) => p.id !== "recover-note")],
    });
  } else {
    useStore.getState().appendMessage(sessionId, {
      id: pending.messageId,
      role: "assistant",
      createdAt: pending.startedAt,
      status: "streaming",
      parts: [chip],
    });
  }
  useStore.getState().setStreaming(sessionId, true);
  const controller = new AbortController();
  aborters.set(sessionId, controller);
  const terminalRecoveryChip = (status: ToolActivity["status"], label: string, detail: string): ContentPart => ({
    ...chip,
    activity: {
      ...chip.activity,
      status,
      label,
      detail,
    },
  });

  try {
    const recoveryStarted = Date.now();
    const recoveryChip = (outcome?: StreamOutcome): ContentPart => {
      const seconds = Math.max(0, Math.round((Date.now() - recoveryStarted) / 1000));
      const status = outcome?.status || "in_progress";
      return {
        ...chip,
        activity: {
          ...chip.activity,
          label:
            status === "in_progress" || status === "running"
              ? `Still running on the server (${seconds}s)…`
              : `Server turn status: ${status}`,
          detail: [
            `chat: ${sessionId}`,
            `interaction: ${outcome?.interactionId || pending.interactionId}`,
            `environment: ${outcome?.environmentId || session.environmentId || "unknown"}`,
            `status: ${status}`,
            `waiting: ${seconds}s`,
          ].join("\n"),
        },
      };
    };
    const outcome = await awaitInteractionOutcome(pending.interactionId, controller.signal, (current) => {
      useStore.getState().patchMessage(sessionId, pending.messageId, {
        status: "streaming",
        parts: [recoveryChip(current), ...blocksToParts(current.blocks as MediaStampedBlock[], "rec")],
        interactionId: current.interactionId || pending.interactionId,
        usage: current.usage,
      });
    });

    for (const block of outcome.blocks as MediaStampedBlock[]) {
      if (block.type === "image" && block.data && !block.mediaRef) {
        const mid = makeMediaId(sessionId, `${pending.messageId}-rec-${block.index}`);
        const mime = block.mimeType ?? "image/png";
        await putMedia(mid, sessionId, base64ToBlob(block.data, mime), mime);
        block.mediaRef = { mediaId: mid, mimeType: mime };
        block.data = undefined;
      }
    }

    const ok = SUCCESS_INTERACTION_STATUS.has(outcome.status.toLowerCase());
    const doneChip: ContentPart = {
      ...chip,
      activity: {
        ...chip.activity,
        status: ok ? "done" : "error",
        label: ok ? "Recovered this turn from the server after a reload" : `Recovered turn ended: ${outcome.status}`,
        detail: [
          `chat: ${sessionId}`,
          `interaction: ${outcome.interactionId || pending.interactionId}`,
          `environment: ${outcome.environmentId || session.environmentId || "unknown"}`,
          `status: ${outcome.status}`,
        ].join("\n"),
      },
    };
    useStore.getState().patchMessage(sessionId, pending.messageId, {
      parts: settleParts([doneChip, ...blocksToParts(outcome.blocks as MediaStampedBlock[], "rec")], !ok),
      status: ok ? "complete" : "error",
      interactionId: outcome.interactionId || pending.interactionId,
      usage: outcome.usage,
      errorMessage:
        ok
          ? undefined
          : outcome.status === "requires_action"
            ? "The recovered turn paused for a browser-side action after reload. Send your message again and I’ll continue from the server context."
            : `The turn ended server-side with status: ${outcome.status}.`,
    });
    useStore.getState().patchSession(sessionId, {
      lastInteractionId: outcome.interactionId || pending.interactionId,
      environmentId: outcome.environmentId || session.environmentId,
      pending: null,
    });

    const current = useStore.getState().sessions[sessionId];
    if (current && current.title === "New chat") {
      const lastUser = [...(useStore.getState().messages[sessionId] ?? [])].reverse().find((m) => m.role === "user");
      const text = lastUser?.parts.find((p): p is Extract<ContentPart, { kind: "text" }> => p.kind === "text")?.text;
      const title = text ? titleFromText(text) : null;
      if (title) useStore.getState().renameSession(sessionId, title);
    }

    const envId = outcome.environmentId || session.environmentId;
    if (envId) syncOutputMediaBestEffort(sessionId, envId);
  } catch (e) {
    const f = toFriendly(e);
    const aborted = f.kind === "aborted" || controller.signal.aborted;
    const message = (useStore.getState().messages[sessionId] ?? []).find((m) => m.id === pending.messageId);
    const detail = [
      `chat: ${sessionId}`,
      `interaction: ${pending.interactionId}`,
      `environment: ${session.environmentId || "unknown"}`,
      aborted ? "status: stopped" : `error: ${f.message}`,
    ].join("\n");
    const recoveryEndedChip = terminalRecoveryChip(
      aborted ? "done" : "error",
      aborted ? "Recovery stopped" : "Recovery failed",
      detail,
    );
    const nextParts = settleParts(
      (message?.parts ?? [chip]).map((part) => (part.id === "recover-note" ? recoveryEndedChip : part)),
      !aborted,
    );
    useStore.getState().patchMessage(sessionId, pending.messageId, {
      status: aborted ? "stopped" : "error",
      parts: nextParts,
      errorMessage: aborted
        ? undefined
        : f.kind === "not-found"
          ? "The reload interrupted this turn before the server registered it — please send your message again."
          : f.message,
    });
    useStore.getState().patchSession(sessionId, { pending: null });
  } finally {
    recovering.delete(pending.interactionId);
    aborters.delete(sessionId);
    useStore.getState().setStreaming(sessionId, false);
    useStore.getState().persistTranscript(sessionId);
  }
}
