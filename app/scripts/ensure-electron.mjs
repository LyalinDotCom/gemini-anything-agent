import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const mirror = process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/";
const electronRoot = join(process.cwd(), "node_modules", "electron");
const pathFile = join(electronRoot, "path.txt");
const force = process.argv.includes("--force");

const installedPath = () => {
  if (!existsSync(pathFile)) {
    return undefined;
  }
  const relativePath = readFileSync(pathFile, "utf8").trim();
  return join(electronRoot, "dist", relativePath);
};

const existing = installedPath();
if (!force && existing && existsSync(existing)) {
  process.exit(0);
}

const installScript = join(electronRoot, "install.js");
if (!existsSync(installScript)) {
  console.error("Electron package is missing. Run npm install first.");
  process.exit(1);
}

console.log(`Installing Electron binary from ${mirror}`);
const result = spawnSync(process.execPath, [installScript], {
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_MIRROR: mirror
  }
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
