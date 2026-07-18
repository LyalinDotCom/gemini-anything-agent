export const COMPOSER_MAX_VISIBLE_LINES = 5;

export type ComposerScrollAlignment = "start" | "end";

const pixels = (value: string): number => Number.parseFloat(value) || 0;

/** Resize a composer textarea to 1–5 visual lines and choose which end stays visible. */
export function resizeComposerTextarea(
  textarea: HTMLTextAreaElement,
  alignment: ComposerScrollAlignment,
): void {
  const style = window.getComputedStyle(textarea);
  const lineHeight = pixels(style.lineHeight) || pixels(style.fontSize) * 1.5 || 22;
  const chrome =
    pixels(style.paddingTop) +
    pixels(style.paddingBottom) +
    pixels(style.borderTopWidth) +
    pixels(style.borderBottomWidth);
  const minHeight = Math.ceil(lineHeight + chrome);
  const maxHeight = Math.ceil(lineHeight * COMPOSER_MAX_VISIBLE_LINES + chrome);

  textarea.style.height = "auto";
  const naturalHeight = textarea.scrollHeight + pixels(style.borderTopWidth) + pixels(style.borderBottomWidth);
  textarea.style.height = `${Math.max(minHeight, Math.min(naturalHeight, maxHeight))}px`;
  textarea.style.overflowY = naturalHeight > maxHeight ? "auto" : "hidden";
  textarea.scrollTop = alignment === "start" ? 0 : textarea.scrollHeight;
}
