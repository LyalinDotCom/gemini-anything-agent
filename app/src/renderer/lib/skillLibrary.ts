import { slug, uid, type ProjectFileDraft } from "./builderState";

export type SkillTemplate = {
  id: string;
  name: string;
  label: string;
  description: string;
  content: string;
};

const githubRepoSyncContent = [
  "---",
  "name: github-repo-sync",
  "description: Use when the task needs to clone, inspect, edit, commit, or push changes to the configured GitHub repository.",
  "---",
  "",
  "# GitHub Repo Sync",
  "",
  "Use this skill when the user asks you to work with the configured GitHub repository.",
  "",
  "## Secrets",
  "",
  "The environment may provide:",
  "",
  "- `GITHUB_TOKEN`: a fine-grained GitHub personal access token scoped to one repository.",
  "- `GITHUB_REPOSITORY`: the target repository in `owner/name` form.",
  "- `GIT_AUTHOR_NAME`: commit author name.",
  "- `GIT_AUTHOR_EMAIL`: commit author email.",
  "",
  "Never print secrets. Never echo `GITHUB_TOKEN`. Never include it in logs, command output, files, commits, or final responses.",
  "",
  "## Setup",
  "",
  "Before using git, validate required values without printing them:",
  "",
  "```bash",
  'test -n "$GITHUB_TOKEN"',
  'test -n "$GITHUB_REPOSITORY"',
  "```",
  "",
  "Configure git identity if provided:",
  "",
  "```bash",
  'git config --global user.name "${GIT_AUTHOR_NAME:-Managed Agent}"',
  'git config --global user.email "${GIT_AUTHOR_EMAIL:-managed-agent@example.com}"',
  "```",
  "",
  "Use HTTPS auth without writing the token into tracked files:",
  "",
  "```bash",
  'git clone "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" repo',
  "cd repo",
  'git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"',
  "```",
  "",
  "## Workflow",
  "",
  "1. Clone the repo into `repo` unless it already exists.",
  "2. Create a branch for changes:",
  "   ```bash",
  '   git checkout -b "agent/$TASK_SLUG"',
  "   ```",
  "3. Inspect files before editing.",
  "4. Make minimal, focused changes.",
  "5. Run relevant tests or validation.",
  "6. Show `git status --short`.",
  "7. Commit only intentional changes:",
  "   ```bash",
  '   git add <paths>',
  '   git commit -m "<clear commit message>"',
  "   ```",
  "8. Push the branch:",
  "   ```bash",
  "   git push -u origin HEAD",
  "   ```",
  "",
  "## Safety Rules",
  "",
  "- Do not push directly to `main` unless the user explicitly asks.",
  "- Do not rewrite history.",
  "- Do not run destructive commands like `git reset --hard`, `git clean -fd`, or force-push unless the user explicitly asks.",
  "- Do not commit `.env`, tokens, keys, credentials, downloaded secrets, or generated dependency folders.",
  "- If auth fails, report that the token may be missing required repo permissions.",
  "- If the task requires creating a PR and GitHub CLI is available, use:",
  "  ```bash",
  "  gh pr create --fill",
  "  ```"
].join("\n");

export const skillLibrary: SkillTemplate[] = [
  {
    id: "github-repo-sync",
    name: "github-repo-sync",
    label: "GitHub repo sync",
    description: "Clone, edit, commit, and push a configured GitHub repo with a scoped token.",
    content: githubRepoSyncContent
  }
];

export const skillTemplateToProjectFile = (skill: SkillTemplate): ProjectFileDraft => {
  const name = slug(skill.name, "skill");
  return {
    id: uid(),
    kind: "skill",
    name,
    target: `.agents/${name}/SKILL.md`,
    content: skill.content
  };
};
