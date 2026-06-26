# gai

`gai` is the media capability CLI for Gemini Anything managed agents.

```bash
npx -y @lyalindotcom/gai@latest --help
npx -y @lyalindotcom/gai@latest image --help
npx -y @lyalindotcom/gai@latest video --help
npx -y @lyalindotcom/gai@latest tts --help
npx -y @lyalindotcom/gai@latest transcribe --help
npx -y @lyalindotcom/gai@latest tts --script-file script.txt --out outputs/podcast.wav --json
npx -y @lyalindotcom/gai@latest transcribe podcast.wav --out outputs/podcast-transcript.md --json
```

`GEMINI_API_KEY` is required for live generation.

Published package:

```bash
npx -y @lyalindotcom/gai@latest doctor --json
```
