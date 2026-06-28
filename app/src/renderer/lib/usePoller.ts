import { useEffect, useRef, useState } from "react";
import { extractInteractionOutputText, type Interaction } from "@sdk";
import type { IpcError } from "../../shared/electron-api";

export type SessionStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";

const NON_TERMINAL = new Set([
  "queued",
  "running",
  "in_progress",
  "in-progress",
  "pending",
  "processing",
  "started"
]);

const FAILED = new Set(["failed", "error", "cancelled", "canceled", "expired"]);

/** Defensive status mapping that tolerates unknown preview status strings. */
export const sessionStatus = (interaction: Interaction | undefined, polling: boolean): SessionStatus => {
  const raw = interaction?.status?.toLowerCase();
  if (raw) {
    if (FAILED.has(raw)) {
      return "failed";
    }
    if (!NON_TERMINAL.has(raw)) {
      return "succeeded";
    }
    return raw === "queued" || raw === "pending" ? "queued" : "running";
  }
  if (extractInteractionOutputText(interaction)) {
    return "succeeded";
  }
  return polling ? "running" : "unknown";
};

export const isTerminal = (interaction: Interaction | undefined): boolean => {
  if (!interaction) {
    return false;
  }
  if (extractInteractionOutputText(interaction)) {
    return true;
  }
  const raw = interaction.status?.toLowerCase();
  if (!raw) {
    return false;
  }
  return !NON_TERMINAL.has(raw);
};

const DELAYS = [1000, 1500, 2000, 3000, 5000];
const MAX_ATTEMPTS = 80;
const MAX_ELAPSED_MS = 5 * 60_000;

/**
 * Polls getInteraction on a capped backoff until the interaction reaches a
 * terminal status. Each RunView owns one poller; it cleans up on unmount,
 * supports a manual stop, and no-ops gracefully without the Electron bridge.
 */
export const useInteractionPoller = (
  id: string | undefined,
  seed: Interaction | undefined,
  enabled: boolean
): {
  interaction: Interaction | undefined;
  polling: boolean;
  error?: IpcError;
  stop: () => void;
} => {
  const [interaction, setInteraction] = useState<Interaction | undefined>(seed);
  const [polling, setPolling] = useState<boolean>(false);
  const [error, setError] = useState<IpcError | undefined>(undefined);
  const stoppedRef = useRef<boolean>(false);
  const seedRef = useRef<Interaction | undefined>(seed);

  useEffect(() => {
    seedRef.current = seed;
    if (seed) {
      setInteraction(seed);
    }
  }, [seed]);

  useEffect(() => {
    if (!enabled || !id || isTerminal(seedRef.current) || !window.managedAgents) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const startedAt = Date.now();
    stoppedRef.current = false;
    setPolling(true);

    const stillRunning = (): boolean =>
      !cancelled &&
      !stoppedRef.current &&
      attempt < MAX_ATTEMPTS &&
      Date.now() - startedAt < MAX_ELAPSED_MS;

    const tick = async (): Promise<void> => {
      if (!stillRunning()) {
        setPolling(false);
        return;
      }
      attempt += 1;
      const result = await window.managedAgents!.getInteraction(id);
      if (cancelled || stoppedRef.current) {
        setPolling(false);
        return;
      }
      if (!result.ok) {
        setError(result.error);
        setPolling(false);
        return;
      }
      setInteraction(result.value);
      if (isTerminal(result.value)) {
        setPolling(false);
        return;
      }
      timer = setTimeout(() => void tick(), DELAYS[Math.min(attempt, DELAYS.length - 1)]);
    };

    timer = setTimeout(() => void tick(), DELAYS[0]);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
      setPolling(false);
    };
  }, [id, enabled]);

  return {
    interaction,
    polling,
    error,
    stop: () => {
      stoppedRef.current = true;
      setPolling(false);
    }
  };
};
