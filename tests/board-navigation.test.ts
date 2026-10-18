import test from "node:test";
import assert from "node:assert/strict";
import {
  boundedCamera,
  zoomCamera,
  panCamera,
  pinchCamera,
  wheelZoom,
  FIT_BOARD_CAMERA,
} from "../lib/board-navigation";
const size = { width: 800, height: 600 };
test("board zoom preserves the map point under the cursor", () => {
  const camera = { zoom: 1.5, x: 30, y: -20 },
    focal = { x: 120, y: 70 };
  const next = zoomCamera(camera, 2, focal, size);
  assert.ok(
    Math.abs(
      (focal.x - camera.x) / camera.zoom - (focal.x - next.x) / next.zoom,
    ) < 1e-10,
  );
  assert.ok(
    Math.abs(
      (focal.y - camera.y) / camera.zoom - (focal.y - next.y) / next.zoom,
    ) < 1e-10,
  );
});
test("fit panning uses spare space without cropping the board", () => {
  assert.deepEqual(
    panCamera(FIT_BOARD_CAMERA, { x: 100, y: 100 }, {
      ...size, contentWidth: 500, contentHeight: 600,
    }),
    { zoom: 1, x: 100, y: 0 },
  );
  assert.deepEqual(boundedCamera({ zoom: 10, x: 10000, y: -10000 }, size), {
    zoom: 3,
    x: 800,
    y: -600,
  });
  assert.deepEqual(
    zoomCamera({ zoom: 3, x: 100, y: 20 }, 0, { x: 10, y: 20 }, size),
    { zoom: 1, x: 0, y: 0 },
  );
});
test("resizing constrains existing pan without changing zoom", () => {
  assert.deepEqual(
    boundedCamera({ zoom: 2, x: 300, y: -250 }, { width: 200, height: 100 }),
    { zoom: 2, x: 100, y: -50 },
  );
});
test("zoomed pan reaches either board edge without dragging it offscreen", () => {
  const wide = { width: 1200, height: 600, contentWidth: 600, contentHeight: 600 };
  const edge = boundedCamera({ zoom: 3, x: 10000, y: 10000 }, wide);
  assert.equal(edge.x, 300);
  assert.equal(edge.y, 600);
  assert.equal(edge.x - wide.contentWidth * edge.zoom / 2, -wide.width / 2);
  assert.equal(edge.y - wide.contentHeight * edge.zoom / 2, -wide.height / 2);
  const opposite = boundedCamera({ zoom: 3, x: -10000, y: -10000 }, wide);
  assert.equal(opposite.x + wide.contentWidth * opposite.zoom / 2, wide.width / 2);
  assert.equal(opposite.y + wide.contentHeight * opposite.zoom / 2, wide.height / 2);
});

test("all fitted content stays inside wide, tall and square viewport frames after panning", () => {
  for (const frame of [
    { width: 1200, height: 600, contentWidth: 626, contentHeight: 600 },
    { width: 600, height: 900, contentWidth: 600, contentHeight: 574 },
    { width: 600, height: 600, contentWidth: 600, contentHeight: 600 },
  ]) for (const direction of [-1, 1]) {
    const camera = panCamera(FIT_BOARD_CAMERA, { x: direction * 10000, y: direction * 10000 }, frame);
    assert(camera.x - frame.contentWidth / 2 >= -frame.width / 2);
    assert(camera.x + frame.contentWidth / 2 <= frame.width / 2);
    assert(camera.y - frame.contentHeight / 2 >= -frame.height / 2);
    assert(camera.y + frame.contentHeight / 2 <= frame.height / 2);
  }
});
test("pinch combines scale and midpoint translation before clamping", () => {
  // Scaling and midpoint translation preserve the finger anchor together.
  const next = pinchCamera(
    FIT_BOARD_CAMERA,
    { x: 600, y: 0 },
    { x: 650, y: 20 },
    2,
    size,
  );
  assert.deepEqual(next, { zoom: 2, x: -400, y: 20 });
  const anchored = pinchCamera(
    FIT_BOARD_CAMERA,
    { x: 500, y: 0 },
    { x: 650, y: 20 },
    2,
    size,
  );
  assert.deepEqual(anchored, { zoom: 2, x: -350, y: 20 });
});
test("pinch translation continues correctly with unchanged finger distance", () => {
  assert.deepEqual(
    pinchCamera(
      { zoom: 2, x: 20, y: -10 },
      { x: 50, y: 50 },
      { x: 90, y: 30 },
      1,
      size,
    ),
    { zoom: 2, x: 60, y: -30 },
  );
});
test("wheel units agree and large scroll deltas remain bounded", () => {
  assert.equal(
    wheelZoom(FIT_BOARD_CAMERA, 16, 0, size),
    wheelZoom(FIT_BOARD_CAMERA, 1, 1, size),
  );
  assert.equal(
    wheelZoom(FIT_BOARD_CAMERA, 60, 0, size),
    wheelZoom(FIT_BOARD_CAMERA, 0.1, 2, size),
  );
  assert.equal(wheelZoom(FIT_BOARD_CAMERA, -1e8, 0, size), Math.exp(0.5));
});
test("invalid dimensions and camera values produce a safe fit", () => {
  assert.deepEqual(
    boundedCamera(
      { zoom: NaN, x: Infinity, y: NaN },
      { width: -20, height: NaN },
    ),
    FIT_BOARD_CAMERA,
  );
  assert.equal(wheelZoom(FIT_BOARD_CAMERA, NaN, 0, size), 1);
});
