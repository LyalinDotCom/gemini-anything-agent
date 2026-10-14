import { describe, expect, test } from "vitest";
import { object3dPhotoContext, object3dPhotos } from "../../shared/object3dInputs";

describe("3D object source photos", () => {
  test("preserves the original bytes and existing sandbox on an attached-photo turn", () => {
    const data = Buffer.from([137, 80, 78, 71, 0, 255]).toString("base64");
    const photos = object3dPhotos([{ type: "image", data, mime_type: "image/png" }]);
    expect(photos[0].data).toBe(data);
    expect(photos[0].mimeType).toBe("image/png");
    expect(photos[0].target).toMatch(/^workspace\/input\/photo3d-.*\.png$/);
    const context = object3dPhotoContext([{ ...photos[0], fileName: "files/test-photo", fileUri: "https://example.test/photo", sha256: "1234", sizeBytes: 6 }]);
    expect(context).toContain("files/test-photo");
    expect(context).toContain(`/${photos[0].target}.json`);
    expect(context).toContain("Never recreate the image from a description");
    expect(object3dPhotos([{ type: "image", data, mime_type: "image/png" }])).toEqual(photos);
  });

  test("does not mount text, audio, or empty media as photos", () => {
    expect(object3dPhotos("hello")).toEqual([]);
    expect(object3dPhotos([{ type: "audio", data: "bytes" }, { type: "image", data: "" }])).toEqual([]);
  });
});

describe("photographic object methods", () => {
  test("uses only 3D View and migrates legacy selections", async () => {
    const { object3dMethodInstruction, OBJECT3D_METHODS } = await import("../../shared/object3dProfile");
    expect(OBJECT3D_METHODS.map((method) => method.id)).toEqual(["views"]);
    expect(object3dMethodInstruction(undefined)).toContain("Create only the 3D View");
    expect(object3dMethodInstruction("orbit")).toBe(object3dMethodInstruction(undefined));
    expect(object3dMethodInstruction("cutout")).toBe(object3dMethodInstruction("views"));
    expect(object3dMethodInstruction("views")).toContain("opposite profile");
  });
});
