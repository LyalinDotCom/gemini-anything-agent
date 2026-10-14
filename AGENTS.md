# AGENTS.md — Gemini Anywhere Agent (GAA)

The web chat app in `web/` is the active modernization target. `agents/` is the canonical managed-agent payload; `shared/agentAssets.ts` lists the identical assets mounted by both UIs. `app/` is the Electron harness and `cli/` is the archived media CLI; do not broaden web work into unrelated changes there.

## Current rules

1. All generated media and delegated Gemini operations use Google's official `google-gemini/gemini-api-cli` release through `bash /.agents/bin/gemini-api`. The latest verified release is v0.4.2. Never deploy or suggest the retired media launcher in an active workflow.
2. Discover capabilities from the installed CLI's `--help`, subcommand help and request schema. Do not implement model calls through a custom Python/REST client or wrapper library. Native helpers only process existing artifacts.
3. Keep `agents/` shared. Both UIs deploy the same manifest and receive the key separately as `/.env`. No per-UI forks of instructions, skills or launchers. Never expose or commit keys.
4. The shared official launcher installs checksum-verified published binaries into the durable workspace cache. Preserve HTTPS/proxy compatibility and noninteractive operation.
5. Photographic 3D references and large-image regions are generated with Gemini inside the managed Linux agent. No third-party hosted 3D service or alternative generator. Local libraries and Blender may process/package those artifacts. Preserve photographic textures and transparency; do not return the rejected organic silhouette reconstruction.
6. Read current official releases and SDK contracts when modernizing Managed Agents. Test complete web requests, stream recovery and actual artifacts before publishing to Firebase. Peer bug bashes use Opus 5.5 High and Gemini 4 Argon Medium; the primary agent owns verified fixes and final implementation.
7. Preserve unrelated existing work. Scope GitHub changes to the web app, its shared agent payload, relevant tests and documentation. Keep large generated samples out of Git; retain or retrieve their published Firebase assets.

The web app migrated from the retired `~/Source/Projects/ai-chatbot-agents` repository. Do not resurrect that project.

8. Branding is Gemini Anywhere Agent (GAA). Use GAA identifiers for active agents, skills, downloads and browser storage. Do not add backward-compatibility aliases or migrations.
