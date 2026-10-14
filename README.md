# Gemini Anywhere Agent (GAA)

A browser chat harness for Gemini Managed Agents: code, research, browser tasks, media generation, photographic 3D views, and large images in a managed Linux workspace.

[Open the web app](https://ai-chatbot-agent-54153.web.app/) with your own Gemini API key.

## Run locally

```bash
cd web
npm ci
npm run samples:sync
npm run dev
```

The model selector offers **Gemini 3.8 Flash** and **Gemini 4 Argon**. Choose before submitting the first prompt. That choice stays fixed for the conversation, including after stopping or failing a turn; use **New chat** to choose another model.

New chat opens a fresh draft at any time. Submitted prompts immediately name the chat. The sidebar keeps conversations available while their remote runs continue, and the mobile header provides direct new-chat and history controls.

## Agent capabilities

- **Antigravity:** the baseline managed-agent harness.
- **Anywhere:** general tasks and media through the shared GAA payload.
- **Browser:** headless navigation and website testing.
- **3D View:** photographic Gemini angle views packaged locally with Blender.
- **Large Images:** native-resolution regions, composition, QA, and an explorable viewer; the world example adds a second shared skill.
- **Deep Research / Max:** background research with recovery.

All media and delegated Gemini operations use Google's official [Gemini API CLI](https://github.com/google-gemini/gemini-api-cli), installed from its checksum-verified v0.4.2 release. The agent discovers current capabilities with `bash /.agents/bin/gemini-api --help`. Native Python, Blender and other libraries process existing artifacts; they do not replace the published CLI's model calls.

## Source layout

- `web/`: active React browser app, hosted on Firebase.
- `agents/`: canonical instructions, skills and launchers.
- `shared/agentAssets.ts`: the single payload manifest consumed by both UIs.
- `shared/`: shared profile and credential contracts.
- `app/`: Electron harness.
- `cli/`: archived media CLI source, unused by the active web workflows.

The media skill is `agents/skills/gemini-anywhere/SKILL.md`. New managed-agent IDs begin with `gaa-`. Downloads, browser storage and local metadata use GAA names. This naming change starts fresh browser storage; it includes no aliases or migrations for previous app state.

## Verify and publish

```bash
cd web
npm test
npm run build
firebase deploy --only hosting --project ai-chatbot-agent-54153
```

Run the opt-in live tests with a paid `GEMINI_API_KEY` when validating managed-agent requests and artifacts. Generated samples stay out of Git; `npm run samples:sync` retrieves and verifies this project's published sample binaries before a clean-clone deployment. Their historical generation provenance remains unchanged.

See [web/README.md](web/README.md), [agents/README.md](agents/README.md), and [AGENTS.md](AGENTS.md) for workflow details.
