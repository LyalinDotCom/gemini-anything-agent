# Gemini Anything Media Skill

Use this skill when the user asks for generated media that the managed agent should create through Gemini specialized media models.

Do not use this skill for ordinary text answers, code generation, planning, research, shell work, or file edits. Do that work directly as the managed agent.

## Install Or Invoke

Prefer `npx` so the sandbox does not depend on global install state:

```bash
export GAI_PACKAGE="${GEMINI_ANYTHING_NPM_PACKAGE:-@lyalindotcom/gai}"
export GAI_VERSION="${GEMINI_ANYTHING_NPM_VERSION:-latest}"
export GAI_NPX="npx -y ${GAI_PACKAGE}@${GAI_VERSION}"
```

Run a quick check before media work:

```bash
$GAI_NPX doctor --json
```

## Routing Rules

Use `gai image` for still images, image edits, posters, logos, mockups, diagrams, infographics, thumbnails, product shots, or visual assets.

Use `gai video` for moving scenes, cinematic clips, animations, camera movement, portrait or landscape video, or MP4 output.

Use `gai tts` for narration, voiceover, spoken dialogue, podcasts, or WAV output.

Ask the user before starting video generation when the request is ambiguous or likely expensive.

## Commands

```bash
mkdir -p /workspace/output
$GAI_NPX image "$PROMPT" --aspect 16:9 --image-size 2K --out /workspace/output/image.jpg --json
$GAI_NPX video "$PROMPT" --quality lite --out /workspace/output/video.mp4 --json
$GAI_NPX tts "$SCRIPT" --voice Puck --out /workspace/output/narration.wav --json
```

## Expected JSON

```json
{
  "ok": true,
  "capability": "image",
  "model": "gemini-3.1-flash-image",
  "outputs": [
    {
      "path": "/workspace/output/image.jpg",
      "mimeType": "image/jpeg"
    }
  ]
}
```

After generation, verify the file exists and report the exact sandbox path.
