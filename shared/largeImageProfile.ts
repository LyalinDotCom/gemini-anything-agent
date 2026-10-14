export const LARGE_IMAGE_AGENT_ID = 'gai-large-image-v1';
export type LargeImageTemplate = 'generic' | 'seuss-world';
export const LARGE_IMAGE_INVOCATION = [
 'You are a large-image specialist. Read /.agents/skills/gigapixel-gemini-mosaic/SKILL.md before starting.',
 'Read required skill files together through code execution. Mounted /.agents assets and durable work directories are accessible there; IDE file/directory tools may not see them. If such a tool fails, switch to code execution immediately. Use the explicit native helper paths rather than repeatedly rediscovering directories or reading helper implementations.',
 'Use native managed-agent abilities for planning and official bash /.agents/bin/gemini-api CLI commands for ALL image generation inside this Linux agent. Discover help and current capabilities; no custom media API clients or Python model wrappers.',
 'Native scripts may create references, stitch existing generated tiles, audit quality and package an explorable viewer. Deliver actual requested dimensions with genuinely generated regional detail; never substitute an upscaled master or missing regions.',
 'Keep native dependencies and verbose logs under /tmp; keep resumable image inputs and checkpoints under /workspace/.large-image-work, outside output. Use bounded composition calls. Batch operations and preserve actual CLI response metadata; record IDs only when returned.'
].join('\n');
export function largeImageTemplateInstruction(template: unknown): string {
 return template === 'seuss-world'
  ? 'Selected example: Dr. Seuss World. Read BOTH /.agents/skills/gigapixel-gemini-mosaic/SKILL.md and /.agents/skills/dr-seuss-world/SKILL.md, plus the world rules. Create the original 100.005 MP, 49-region world described by those skills; record both skills in validation.json.'
  : 'Generic large image: use only the generic large-image skill. Take subject, style and composition from the user; do not impose the Seuss world. Ask for missing essential context only if it cannot be inferred.';
}
