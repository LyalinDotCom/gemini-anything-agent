import type { Message } from "../state/types";

/** An immediate prompt-based title, including runs that stop or fail. */
export function chatTitle(message: Message): string {
  const text = message.parts.filter(part => part.kind === "text").map(part => part.text).join(" ")
    .split("\n").find(line => line.trim())?.replace(/```/g, " ") ?? "";
  const clean = text.replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim()
    .replace(/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:help me\s+(?:to\s+)?)?/i, "");
  if (clean) {
    const sentence = (clean.split(/[.!?](?:\s+|$)/)[0] || clean).replace(/[.!?\s]+$/, "");
    const words = sentence.split(" ").slice(0, 8).join(" ");
    const title = words.length > 52 ? words.slice(0, 49).trimEnd() + "…" : words;
    return title ? title.charAt(0).toUpperCase() + title.slice(1) : "Conversation";
  }
  if (message.parts.some(part => part.kind === "audio")) return "Voice conversation";
  if (message.parts.some(part => part.kind === "image")) return "Image conversation";
  return "Conversation";
}
