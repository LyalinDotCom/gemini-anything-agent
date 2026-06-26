# gai

`gai` is the media capability CLI for Gemini Anything managed agents.

```bash
gai models
gai doctor --json
gai image "a crisp app icon" --out outputs/icon.jpg --json
gai tts "Say cheerfully: hello" --out outputs/hello.wav --json
gai video "a glowing command line cursor" --quality lite --out outputs/cursor.mp4 --json
```

`GEMINI_API_KEY` is required for live generation.

Published package:

```bash
npx -y @lyalindotcom/gai doctor --json
```
