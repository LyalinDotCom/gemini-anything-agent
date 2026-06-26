#!/usr/bin/env node

import { chmodSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const binPath = resolve("dist", "cli.js");

if (existsSync(binPath)) {
  chmodSync(binPath, 0o755);
}
