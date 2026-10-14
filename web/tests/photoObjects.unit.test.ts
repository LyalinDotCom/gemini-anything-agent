import { describe, expect, test } from "vitest";
import { photoObjectMode, photoViewIndex } from "../src/utils/photoObjects";

describe("photographic view selection", () => {
  test("wraps through the complete orbit in either direction", () => {
    expect(photoViewIndex(0, 32)).toBe(0);
    expect(photoViewIndex(Math.PI / 2, 32)).toBe(8);
    expect(photoViewIndex(Math.PI, 32)).toBe(16);
    expect(photoViewIndex(-Math.PI / 2, 32)).toBe(24);
    expect(photoViewIndex(2 * Math.PI, 32)).toBe(0);
    expect(photoViewIndex(-2 * Math.PI, 32)).toBe(0);
    expect(photoViewIndex(2 * Math.PI - .01, 32)).toBe(0);
  });
  test("selects inspected irregular angles through positive, negative and multiple turns", () => {
    const angles = [0, 70, 180, 280];
    for (const turn of [-2, -1, 0, 1, 2]) {
      expect(photoViewIndex((70 + turn*360)*Math.PI/180, 4, angles)).toBe(1);
      expect(photoViewIndex((280 + turn*360)*Math.PI/180, 4, angles)).toBe(3);
      expect(photoViewIndex((355 + turn*360)*Math.PI/180, 4, angles)).toBe(0);
    }
  });
  test("rejects invalid frame counts and non-finite angles", () => {
    for (const count of [0, -1, 1.5, NaN]) expect(photoViewIndex(1, count)).toBe(0);
    expect(photoViewIndex(Infinity, 32)).toBe(0);
  });
  test("recognizes only the explicitly packaged photographic objects", () => {
    expect(photoObjectMode(null)).toBeNull();
    expect(photoObjectMode({ photo_object_mode: "mesh" })).toBeNull();
    expect(photoObjectMode({ photo_object_mode: "cutout" })).toBe("cutout");
    expect(photoObjectMode({ photo_object_mode: "views" })).toBe("views");
  });
});
