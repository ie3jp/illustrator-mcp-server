import { describe, expect, it } from 'vitest';
import { register as registerCreateRectangle } from '../../src/tools/modify/create-rectangle.js';
import { register as registerCreateEllipse } from '../../src/tools/modify/create-ellipse.js';
import { register as registerCreateLine } from '../../src/tools/modify/create-line.js';
import { register as registerCreatePath } from '../../src/tools/modify/create-path.js';
import { captureInputSchema } from './helpers/tool-schema.js';

describe('shape tool schemas', () => {
  it('create_rectangle accepts standard payload', () => {
    const schema = captureInputSchema(registerCreateRectangle);
    expect(schema.safeParse({
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      fill: { type: 'rgb', r: 255, g: 0, b: 0 },
      stroke: { color: { type: 'none' } },
      coordinate_system: 'artboard-web',
    }).success).toBe(true);
  });

  it('create_ellipse accepts standard payload', () => {
    const schema = captureInputSchema(registerCreateEllipse);
    expect(schema.safeParse({
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      fill: { type: 'rgb', r: 255, g: 0, b: 0 },
      stroke: { color: { type: 'none' } },
      coordinate_system: 'artboard-web',
    }).success).toBe(true);
  });

  it('create_line accepts stroke settings', () => {
    const schema = captureInputSchema(registerCreateLine);
    expect(schema.safeParse({
      x1: 0,
      y1: 0,
      x2: 50,
      y2: 10,
      stroke: { color: { type: 'rgb', r: 10, g: 20, b: 30 }, width: 2, cap: 'round' },
      coordinate_system: 'document',
    }).success).toBe(true);
  });

  it('create_path accepts anchors and closed boolean strings', () => {
    const schema = captureInputSchema(registerCreatePath);
    expect(schema.safeParse({
      anchors: [
        { x: 0, y: 0 },
        { x: 50, y: 10, point_type: 'smooth' },
      ],
      closed: 'TRUE',
      stroke: { color: { type: 'none' } },
      coordinate_system: 'document',
    }).success).toBe(true);
  });
});
