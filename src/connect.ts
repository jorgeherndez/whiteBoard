// Conexiones de flechas/líneas con otros elementos (punto medio de cada lado)
import type { Item, Side } from "./model";
import { isLineKind, isStrokeKind } from "./shapes";

export const SIDES: Side[] = ["t", "r", "b", "l"];

/** Alto real en pantalla (los textos crecen con su contenido) */
export function realH(it: Item): number {
  if (it.type !== "text") return it.h;
  const el = document.querySelector(`[data-id="${it.id}"]`) as HTMLElement | null;
  return el ? Math.max(it.h, el.offsetHeight) : it.h;
}

export const connectable = (it: Item) => !(it.type === "shape" && isStrokeKind(it.shape));

export function anchor(it: Item, side: Side) {
  const h = realH(it);
  if (side === "t") return { x: it.x + it.w / 2, y: it.y };
  if (side === "b") return { x: it.x + it.w / 2, y: it.y + h };
  if (side === "l") return { x: it.x, y: it.y + h / 2 };
  return { x: it.x + it.w, y: it.y + h / 2 };
}

/** Devuelve los elementos con los extremos de las flechas conectadas ya recolocados */
export function resolveLines(items: Item[]): Item[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return items.map((it) => {
    if (it.type !== "shape" || !isLineKind(it.shape) || !it.points || (!it.startConn && !it.endConn)) return it;
    const pts = [...it.points];
    const s = it.startConn && byId.get(it.startConn.id);
    const e = it.endConn && byId.get(it.endConn.id);
    if (s) { const a = anchor(s, it.startConn!.side); pts[0] = { x: a.x - it.x, y: a.y - it.y }; }
    if (e) { const a = anchor(e, it.endConn!.side); pts[pts.length - 1] = { x: a.x - it.x, y: a.y - it.y }; }
    return { ...it, points: pts };
  });
}

/** Ancla más cercana a un punto del mundo (excluyendo ids), dentro de `max` */
export function nearestAnchor(items: Item[], p: { x: number; y: number }, max: number, exclude: Set<string>) {
  let best: { id: string; side: Side; x: number; y: number; d: number } | null = null;
  for (const it of items) {
    if (exclude.has(it.id) || !connectable(it)) continue;
    for (const side of SIDES) {
      const a = anchor(it, side);
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d <= max && (!best || d < best.d)) best = { id: it.id, side, ...a, d };
    }
  }
  return best;
}

/** Caja de un elemento en el mundo (para selección por recuadro y guías) */
export function worldBox(it: Item) {
  if (it.points?.length) {
    const xs = it.points.map((p) => p.x), ys = it.points.map((p) => p.y);
    return { x: it.x + Math.min(...xs), y: it.y + Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  return { x: it.x, y: it.y, w: it.w, h: realH(it) };
}
