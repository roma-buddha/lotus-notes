export type DropRegion = {
  path: string;
  folder: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export function markdownDropTarget(
  position: { x: number; y: number },
  scale: number,
  regions: DropRegion[],
): string {
  for (const factor of [scale || 1, 1]) {
    const x = position.x / factor,
      y = position.y / factor;
    const hits = regions.filter(
      (r) =>
        r.right > r.left &&
        r.bottom > r.top &&
        x >= r.left &&
        x <= r.right &&
        y >= r.top &&
        y <= r.bottom,
    );
    // A folder row takes precedence over the surrounding vault sidebar.
    const target = hits.find((r) => r.folder) ?? hits[0];
    if (target) return target.path;
  }
  return "";
}
