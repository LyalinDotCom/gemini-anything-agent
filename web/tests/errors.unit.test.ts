import { expect, test } from "vitest";
import { toFriendly } from "../src/gemini/errors";

test("a server ABORTED status on duplicate agent creation is a conflict", () => {
  expect(toFriendly({ status: 409, message: '{"error":{"code":409,"status":"ABORTED","message":"Agent already exists"}}' }).kind).toBe("conflict");
  expect(toFriendly(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })).kind).toBe("aborted");
});
