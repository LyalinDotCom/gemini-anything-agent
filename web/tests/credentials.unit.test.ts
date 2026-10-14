import { beforeEach, describe, expect, test, vi } from "vitest";

const sdk = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn() }));
vi.mock("../src/gemini/client", () => ({ ai: () => ({ credentials: sdk }) }));
import { createCredential, deleteCredential, getCredential, updateCredential } from "../src/gemini/credentials";
import { FriendlyError } from "../src/gemini/errors";

beforeEach(() => { for (const fn of Object.values(sdk)) fn.mockReset(); });

describe("BYOK credential adapters", () => {
  test("writes OAuth configuration without replay and returns metadata only", async () => {
    const metadata = { id: "connection", type: "oauth2", status: "active" };
    sdk.create.mockResolvedValue(metadata);
    const params = { id: "connection", type: "oauth2" as const, client_id: "client", client_secret: "server-secret", refresh_token: "offline-refresh", token_url: "https://provider.example/token" };
    expect(await createCredential(params)).toEqual(metadata);
    expect(sdk.create).toHaveBeenCalledExactlyOnceWith(params, { maxRetries: 0 });
  });

  test("reads, rotates, and deletes only the explicitly supplied credential", async () => {
    sdk.get.mockResolvedValue({ id: "connection" });
    sdk.update.mockResolvedValue({ id: "connection" });
    await getCredential("connection");
    await updateCredential("connection", { type: "oauth2", refresh_token: "rotated" });
    await deleteCredential("connection");
    expect(sdk.get).toHaveBeenCalledExactlyOnceWith("connection", undefined, { maxRetries: 3 });
    expect(sdk.update).toHaveBeenCalledExactlyOnceWith("connection", { type: "oauth2", refresh_token: "rotated" }, { maxRetries: 0 });
    expect(sdk.delete).toHaveBeenCalledExactlyOnceWith("connection");
  });

  test("keeps a credential validation error actionable without echoing its secret", async () => {
    sdk.create.mockRejectedValue({ status: 400, message: "Rejected offline-refresh and server-secret" });
    try {
      await createCredential({ id: "connection", type: "oauth2", client_id: "client", client_secret: "server-secret", refresh_token: "offline-refresh", token_url: "https://provider.example/token" });
      expect.fail("expected error");
    } catch (error) {
      expect(error).toBeInstanceOf(FriendlyError);
      expect((error as FriendlyError).message).toBe("Rejected <redacted> and <redacted>");
    }
  });
});
