// Pan and zoom maths for the map view (no DOM, unit tested).

export interface Transform {
  scale: number
  /** Offset of the image's top-left corner in the frame, in screen pixels. */
  x: number
  y: number
}

/** Scale and centre an image of w×h so it fits inside a frame of fw×fh. */
export function fitTransform(w: number, h: number, fw: number, fh: number): Transform {
  if (w <= 0 || h <= 0 || fw <= 0 || fh <= 0) return { scale: 1, x: 0, y: 0 }
  const scale = Math.min(fw / w, fh / h)
  return { scale, x: (fw - w * scale) / 2, y: (fh - h * scale) / 2 }
}

/** Zooms by `factor`, keeping the image point under (cx, cy) in place; scale stays within [min, max]. */
export function zoomAt(t: Transform, factor: number, cx: number, cy: number, min: number, max: number): Transform {
  const scale = Math.min(max, Math.max(min, t.scale * factor))
  const k = scale / t.scale
  return { scale, x: cx - (cx - t.x) * k, y: cy - (cy - t.y) * k }
}
