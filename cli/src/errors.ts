export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

// Exit codes: 0 success, 1 API/runtime failure, 2 invalid usage, 3 auth/config.
export const exitCodeForError = (error: unknown): number => {
  if (error instanceof UsageError) {
    return 2;
  }
  if (error instanceof AuthError) {
    return 3;
  }
  return 1;
};
