export type BoardCamera = { zoom: number; x: number; y: number };
export type BoardSize = { width: number; height: number; contentWidth?: number; contentHeight?: number };
export type BoardPoint = { x: number; y: number };
export const MIN_BOARD_ZOOM = 1;
export const MAX_BOARD_ZOOM = 3;
export const FIT_BOARD_CAMERA: BoardCamera = { zoom: 1, x: 0, y: 0 };

const finite = (n: number, fallback = 0) => (Number.isFinite(n) ? n : fallback);
export function boundedCamera(
  camera: BoardCamera,
  size: BoardSize,
): BoardCamera {
  const zoom = Math.max(
    MIN_BOARD_ZOOM,
    Math.min(MAX_BOARD_ZOOM, finite(camera.zoom, 1)),
  );
  // At fit zoom, pan only within the letterboxing so every ship stays visible.
  // When zoomed in, stop at the board's edges so all of it remains reachable.
  const limit = (viewport: number, content = viewport) => {
    const frame = Math.max(0, finite(viewport)), board = Math.max(0, finite(content)) * zoom;
    return frame > 0 && board > 0 ? Math.abs(frame - board) / 2 : 0;
  };
  const x = limit(size.width, size.contentWidth);
  const y = limit(size.height, size.contentHeight);
  return {
    zoom,
    x: Math.max(-x, Math.min(x, finite(camera.x))),
    y: Math.max(-y, Math.min(y, finite(camera.y))),
  };
}
// Points are pixels relative to the viewport's center. Keep the map point
// underneath the cursor/fingers fixed while changing scale.
export function zoomCamera(
  camera: BoardCamera,
  zoom: number,
  focal: BoardPoint,
  size: BoardSize,
): BoardCamera {
  const next = boundedCamera({ ...camera, zoom }, size).zoom;
  const ratio = next / camera.zoom;
  return boundedCamera(
    {
      zoom: next,
      x: focal.x - (focal.x - camera.x) * ratio,
      y: focal.y - (focal.y - camera.y) * ratio,
    },
    size,
  );
}
export function panCamera(
  camera: BoardCamera,
  delta: BoardPoint,
  size: BoardSize,
) {
  return boundedCamera(
    { ...camera, x: camera.x + delta.x, y: camera.y + delta.y },
    size,
  );
}
export function pinchCamera(
  camera: BoardCamera,
  start: BoardPoint,
  end: BoardPoint,
  scale: number,
  size: BoardSize,
) {
  const zoom = boundedCamera(
    { ...camera, zoom: camera.zoom * scale },
    size,
  ).zoom;
  const ratio = zoom / camera.zoom;
  return boundedCamera(
    {
      zoom,
      x: end.x - (start.x - camera.x) * ratio,
      y: end.y - (start.y - camera.y) * ratio,
    },
    size,
  );
}
export function wheelZoom(
  camera: BoardCamera,
  delta: number,
  mode: number,
  size: BoardSize,
) {
  const pixels =
    finite(delta) *
    (mode === 1 ? 16 : mode === 2 ? Math.max(1, size.height) : 1);
  return camera.zoom * Math.exp(-Math.max(-250, Math.min(250, pixels)) * 0.002);
}
