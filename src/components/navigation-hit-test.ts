type Point = { x: number; y: number };
type Bounds = { left: number; right: number; top: number; bottom: number };

export function outsideNavigationBounds(point: Point, bounds: Bounds) {
  return (
    point.x < bounds.left ||
    point.x >= bounds.right ||
    point.y < bounds.top ||
    point.y >= bounds.bottom
  );
}
