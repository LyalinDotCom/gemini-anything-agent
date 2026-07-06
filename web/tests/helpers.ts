export const hasKey = (): boolean => !!process.env.GEMINI_API_KEY;

export const skipNote = (name: string): void => {
  console.warn(`[skip] ${name}: GEMINI_API_KEY not set`);
};

export const uniqueAgentId = (): string =>
  `test-companion-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
