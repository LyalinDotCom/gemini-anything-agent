---
name: dr-seuss-world
description: Supply the visual grammar and scene plan for an original, detailed Dr. Seuss inspired world using the generic large-image skill. Apply only when this world example or style is requested.
---

# Dr. Seuss world pack

Read the generic `/.agents/skills/gigapixel-gemini-mosaic/SKILL.md` and this pack for the selected world example. Rules are in `references/dr-seuss-world-rules.md`; read them before planning or rendering. Source: https://github.com/LyalinDotCom/sergey-image.

Invent a fresh, joyful continent with 49 connected neighbourhoods on a 13,334 × 7,500 canvas. Use bold expressive ink, crosshatching and vibrant coral-pink, turquoise, tangerine, buttercup yellow and mint watercolour on warm cream paper. Buildings lean, bend in S-curves, balance on striped stilts and end in curlicues; avoid generic straight houses. Trees have striped slender trunks and colourful tufted pom-poms. Rivers, bridges, paths and contraptions continue across region boundaries.

Each region has 10–18 distinct whimsical structures or machines and 15–25 expressive original inhabitants, with faces, costumes, ears and inventions visible at 1:1 zoom. Keep characters roughly 120–210 pixels tall per region; avoid both giant foreground portraits and tiny stick dots. Include flying patchwork bicycles, multi-bell brass musical machines, paddle-wheel boats, curly fern gardens, floating islands and playful airships. Invent original creatures and place names, consistent with the repository's world rules.

Arrange sky activity above, highland ridges and waterfalls beneath, busy valleys in the middle, and waterfront gardens/parades below. Write the fresh plan using native managed-agent abilities, then follow the generic engine's CLI generation, native composition, QA and deep-zoom delivery workflow. Report both skill names in validation.json. Generic image requests should use only the generic skill.

For this world, set `image_model` to `gemini-nano-banana-2.1` and put these constraints in the plan's `render_contract` so the native master and every region share the camera and composition. Subject pixel sizes apply to final-canvas regions only; the native master request translates the scale to its own dimensions:
- camera: one continuous wide, elevated oblique storybook view; constant camera and geographic scale across neighbours, no independent district close-ups.
- subject_scale: at native 2K, expressive inhabitants approximately 120–210 pixels tall; preserve that same scale in every region and at overlaps. Buildings and vehicles must fit their neighbourhood, without giant foreground hero objects or whole neighbourhoods squeezed into tiny background patches.
- regional_detail: each native 2K region contains 10–18 distinct playful structures or machines and 15–25 expressive original inhabitants with visible faces, costumes and inventions; create NEW detailed neighbourhood content in the soft terrain area, not a larger copy of the master. Never copy lettering or title banners.
- composition: the master is a distant full-continent geography guide, with connected rivers, bridges and tracks, no large foreground portraits/buildings/airships dominating the guide. Regional generation adds detail in place rather than enlarging the master landmarks. Warm upper-left light and one continuous palette throughout; no isolated night-time district.

Do not accept a patchwork overview just because dimensions and numeric seam checks pass. Inspect the master and first adjoining regions before continuing all 49, and record any unresolved visual discontinuity at delivery.
