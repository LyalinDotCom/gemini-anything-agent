import { describe, expect, test } from "vitest";
import { syncEntriesToProject } from "../src/storage/localProjects";
import { idbDelete, idbPut } from "../src/storage/db";
import { useStore } from "../src/state/store";

class FakeDirectory {
  readonly kind = "directory" as const;
  readonly children = new Map<string, FakeDirectory>();
  readonly files = new Map<string, Uint8Array>();
  constructor(readonly name: string, private readonly root: FakeDirectory = null as never) {}
  async queryPermission() { return "granted" as PermissionState; }
  async requestPermission() { return "granted" as PermissionState; }
  async getDirectoryHandle(name: string) {
    let child = this.children.get(name);
    if (!child) {
      child = new FakeDirectory(name, this.root || this);
      this.children.set(name, child);
    }
    return child;
  }
  async getFileHandle(name: string) {
    const directory = this;
    return {
      kind: "file" as const,
      name,
      async createWritable() {
        return {
          async write(blob: Blob) { directory.files.set(name, new Uint8Array(await blob.arrayBuffer())); },
          async close() {},
        };
      },
    };
  }
}

describe("local project sync", () => {
  test("writes only safe /workspace/output paths and preserves folders", async () => {
    const id = "local-project-test";
    const root = new FakeDirectory("demo");
    await idbPut("projectHandles", { id, handle: root as unknown as FileSystemDirectoryHandle });
    const result = await syncEntriesToProject(id, [
      { name: "workspace/output/index.html", size: 2, data: new Uint8Array([1, 2]) },
      { name: "workspace/output/assets/app.js", size: 1, data: new Uint8Array([3]) },
      { name: "workspace/.env", size: 1, data: new Uint8Array([4]) },
      { name: "workspace/output/.secret", size: 1, data: new Uint8Array([5]) },
    ], false);
    expect(result).toMatchObject({ name: "demo", written: 2, skipped: 2, permission: "granted" });
    expect([...root.files]).toEqual([["index.html", new Uint8Array([1, 2])]]);
    expect(root.children.get("assets")?.files.get("app.js")).toEqual(new Uint8Array([3]));
    await idbDelete("projectHandles", id);
  });

  test("writes readable conversation metadata for a linked project", async () => {
    const id = useStore.getState().createSession();
    useStore.getState().appendMessage(id, {
      id: "message-1",
      role: "user",
      createdAt: 1,
      status: "complete",
      parts: [{ kind: "text", id: "text-1", text: "Build the demo" }],
    });
    const root = new FakeDirectory("project-with-history");
    await idbPut("projectHandles", { id, handle: root as unknown as FileSystemDirectoryHandle });
    const result = await syncEntriesToProject(id, [], false);
    expect(result?.metadataWritten).toBe(true);
    const metadata = root.children.get(".gemini-anything");
    expect(new TextDecoder().decode(metadata?.files.get("conversation.md"))).toContain("Build the demo");
    expect(JSON.parse(new TextDecoder().decode(metadata?.files.get("conversation.json"))).session.id).toBe(id);
    useStore.getState().deleteSession(id);
  });
});
