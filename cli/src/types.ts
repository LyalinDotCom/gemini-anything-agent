export type OutputFile = {
  path: string;
  mimeType: string;
};

export type CommandResult = {
  ok: true;
  capability: "image" | "video" | "tts" | "transcribe" | "models" | "doctor";
  model?: string;
  outputs?: OutputFile[];
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
