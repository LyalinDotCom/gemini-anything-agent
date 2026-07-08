export type OutputFile = {
  path: string;
  mimeType: string;
};

export type CommandResult = {
  ok: true;
  capability:
    | "image"
    | "video"
    | "tts"
    | "music"
    | "transcribe"
    | "generate"
    | "embed"
    | "tokens"
    | "files"
    | "agent"
    | "models"
    | "doctor";
  model?: string;
  outputs?: OutputFile[];
  /** Bare deliverable for non-JSON mode; printed to stdout instead of the JSON envelope. */
  stdout?: string;
  operation?: {
    name?: string;
    done?: boolean;
  };
  message?: string;
  details?: Record<string, unknown>;
};

export type CommandFailure = {
  ok: false;
  capability?: string;
  model?: string;
  error: {
    name: string;
    message: string;
    details?: unknown;
  };
};

export type JsonResult = CommandResult | CommandFailure;
