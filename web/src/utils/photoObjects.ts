export type PhotoObjectMode = "cutout" | "views";
export function photoObjectMode(extras: unknown): PhotoObjectMode | null {
  const value = (extras as { photo_object_mode?: unknown } | null)?.photo_object_mode;
  return value === "cutout" || value === "views" ? value : null;
}
/** Ordered Gemini frames follow horizontal viewing direction; no interpolated face ghosts. */
export function photoViewIndex(azimuth: number, count: number, angles?: number[]): number {
  if (!Number.isFinite(azimuth) || !Number.isInteger(count) || count < 1) return 0;
  const turn = ((azimuth / (2 * Math.PI)) % 1 + 1) % 1;
  if (angles?.length === count && angles.every((angle) => Number.isFinite(angle))) {
    const degrees = turn * 360;
    let best = 0, distance = Infinity;
    angles.forEach((angle, index) => {
      const difference = Math.abs(((angle % 360) + 360) % 360 - degrees);
      const circular = Math.min(difference, 360 - difference);
      if (circular < distance) { distance = circular; best = index; }
    });
    return best;
  }
  return Math.round(turn * count) % count;
}
