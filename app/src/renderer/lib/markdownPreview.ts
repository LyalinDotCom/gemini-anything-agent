const fencePattern = /^\s*(```|~~~)/;
const indentedBlockPattern = /^(?: {4,}|\t)/;

const commandPattern =
  /^\s*(?:bash|cat|cd|chmod|cp|curl|echo|export|find|git|mkdir|mv|node|npm|npx|pnpm|python|python3|rm|sh|touch|yarn)\b/m;

const codePattern =
  /(?:[{};]|=>|<\/?[a-z][\w-]*(?:\s|>)|^\s*(?:class|const|enum|export|for|function|if|import|interface|let|return|type|var|while)\b|^\s*[$#]\s|^\s*[{[])/m;

const stripIndentedPrefix = (line: string): string => line.replace(/^(?: {4,}|\t)/, "");

const isProbablyProse = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  if (commandPattern.test(trimmed) || codePattern.test(trimmed)) {
    return false;
  }

  const words = trimmed.match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0;
  const hasSentencePunctuation = /[.!?][)"']?(?:\s|$)/.test(trimmed);
  const hasNaturalSpacing = /[A-Za-z][A-Za-z'-]*\s+[A-Za-z][A-Za-z'-]*/.test(trimmed);

  return hasSentencePunctuation || (words >= 5 && hasNaturalSpacing);
};

export const normalizePreviewMarkdown = (source: string): string => {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const normalized: string[] = [];
  let proseCandidate: string[] = [];
  let inFence = false;

  const flushProseCandidate = () => {
    if (proseCandidate.length === 0) {
      return;
    }

    const text = proseCandidate
      .map((line) => stripIndentedPrefix(line).trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (isProbablyProse(text)) {
      normalized.push(text);
    } else {
      normalized.push(...proseCandidate);
    }
    proseCandidate = [];
  };

  for (const line of lines) {
    if (fencePattern.test(line)) {
      flushProseCandidate();
      inFence = !inFence;
      normalized.push(line);
      continue;
    }

    if (!inFence && line.trim() && indentedBlockPattern.test(line)) {
      proseCandidate.push(line);
      continue;
    }

    flushProseCandidate();
    normalized.push(line);
  }

  flushProseCandidate();
  return normalized.join("\n");
};
