import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  centredCrop,
  clampOffset,
  coverImageLayout,
  cropFromTransform,
  minCoverScale,
  parseCoverCrop,
  transformFromCrop,
} from './coverCrop.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.001, `${a} vs ${b}`);

test('centred frame for a tall photo keeps full width', () => {
  const c = centredCrop(1000, 1500); // 2:3 photo, 2:1 frame
  near(c.w, 1);
  near(c.h, 1000 / 2 / 1500);
  near(c.y, (1 - c.h) / 2);
});

test('centred frame for a wide photo keeps full height', () => {
  const c = centredCrop(4000, 1000); // 4:1 photo
  near(c.h, 1);
  near(c.w, 0.5);
  near(c.x, 0.25);
});

test('layout draws only the frame in the box', () => {
  const l = coverImageLayout({ x: 0.25, y: 0.1, w: 0.5, h: 0.2 }, 400, 200);
  near(l.width, 800);
  near(l.height, 1000);
  near(l.left, -200);
  near(l.top, -100);
});

test('cropper transform round-trips to the same frame', () => {
  const [iw, ih, fw, fh] = [3000, 2000, 360, 180];
  const s = minCoverScale(iw, ih, fw, fh) * 1.5;
  const { tx, ty } = clampOffset(iw, ih, fw, fh, s, -120, -80);
  const crop = cropFromTransform(iw, ih, fw, fh, s, tx, ty);
  near(crop.w / crop.h * (iw / ih), 2); // still 2:1 in pixels
  const back = transformFromCrop(crop, iw, ih, fw);
  // The frame is stored to 4 decimals, so within a tenth of a point.
  assert.ok(Math.abs(back.scale - s) < 0.001);
  assert.ok(Math.abs(back.tx - tx) < 0.1);
  assert.ok(Math.abs(back.ty - ty) < 0.1);
});

test('offsets never leave a gap', () => {
  const s = minCoverScale(1000, 1000, 300, 150);
  const o = clampOffset(1000, 1000, 300, 150, s, 50, -9999);
  assert.equal(o.tx, 0);
  near(o.ty, 150 - 1000 * s);
});

test('parseCoverCrop accepts frames and rejects junk', () => {
  assert.deepEqual(parseCoverCrop({ x: 0, y: 0.2, w: 1, h: 0.5 }), { x: 0, y: 0.2, w: 1, h: 0.5 });
  assert.equal(parseCoverCrop(null), null);
  assert.equal(parseCoverCrop({ x: 0.6, y: 0, w: 0.5, h: 0.5 }), null);
  assert.equal(parseCoverCrop({ x: '0', y: 0, w: 1, h: 1 }), null);
});
