# gai

Media capability CLI for the Gemini Anything Agent sample.

Live npm package: [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai)

## Commands

```bash
npx -y @lyalindotcom/gai@latest --help
npx -y @lyalindotcom/gai@latest image --help
npx -y @lyalindotcom/gai@latest video --help
npx -y @lyalindotcom/gai@latest tts --help
npx -y @lyalindotcom/gai@latest music --help
npx -y @lyalindotcom/gai@latest transcribe --help
```

## Development

```bash
npm install
npm test
npm run build
npm run gai -- models
```

## Key Warning

Live calls require `GEMINI_API_KEY`.

In the managed-agent sample, the app passes the key by mounting a plaintext sandbox `.env`, and `/.agents/bin/gai` sources it.
