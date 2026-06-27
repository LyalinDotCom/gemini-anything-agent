# gai

`gai` is the media capability CLI for Gemini Anything managed agents.

Live npm package: [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai)

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

When the CLI is used through the managed-agent sample, the app provides this key by mounting a plaintext `.env` file into the remote sandbox. That is proof-of-concept wiring, not encrypted production secret handling.

Published package:

```bash
npx -y @lyalindotcom/gai@latest doctor --json
```
