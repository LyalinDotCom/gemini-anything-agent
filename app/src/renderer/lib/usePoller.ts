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
  "started",
  // Waiting for client input — still a live interaction, keep polling.
  "requires_action",
  "requires-action"
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
  const raw = interaction.status?.toLowerCase();
  if (raw) {
    return !NON_TERMINAL.has(raw);
  }
  return Boolean(extractInteractionOutputText(interaction));
};

const DELAYS = [1000, 1500, 2000, 3000, 5000];
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Polls getInteraction on a capped backoff until the interaction reaches a
 * terminal status. Each RunView owns one poller; it cleans up on unmount,
 * supports a manual stop, and no-ops gracefully without the Electron bridge.
 * Transient poll failures are retried; polling only stops on a terminal
 * status, a manual stop, or several consecutive failures.
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
      // A parent re-render can hand back a stale non-terminal seed after the
      // poller already fetched the terminal interaction; never regress.
      setInteraction((previous) =>
        previous && previous.id === seed.id && isTerminal(previous) && !isTerminal(seed)
          ? previous
          : seed
      );
    }
  }, [seed]);

  useEffect(() => {
    setInteraction(seedRef.current);
    setError(undefined);
  }, [id]);

  useEffect(() => {
    if (!enabled || !id || isTerminal(seedRef.current) || !window.managedAgents) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let consecutiveFailures = 0;
    stoppedRef.current = false;
    setPolling(true);

    const stillRunning = (): boolean => !cancelled && !stoppedRef.current;

    const scheduleNext = () => {
      timer = setTimeout(() => void tick(), DELAYS[Math.min(attempt, DELAYS.length - 1)]);
    };

    const tick = async (): Promise<void> => {
      if (!stillRunning()) {
        setPolling(false);
        return;
      }
      attempt += 1;
      let failure: IpcError | undefined;
      try {
        const result = await window.managedAgents!.getInteraction(id);
        if (!stillRunning()) {
          setPolling(false);
          return;
        }
        if (result.ok) {
          consecutiveFailures = 0;
          setError(undefined);
          setInteraction(result.value);
          if (isTerminal(result.value)) {
            setPolling(false);
            return;
          }
          scheduleNext();
          return;
        }
        failure = result.error;
      } catch (thrown) {
        if (!stillRunning()) {
          setPolling(false);
          return;
        }
        failure = {
          name: "PollError",
          message: thrown instanceof Error ? thrown.message : "Polling failed unexpectedly."
        };
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        setError(failure);
        setPolling(false);
        return;
      }
      scheduleNext();
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
