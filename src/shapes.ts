// Figuras: se dibujan como SVG y además se guardan como archivo .svg en formas/
import type { Item } from "./model";

export type ShapeKind = "rect" | "rounded" | "ellipse" | "triangle" | "diamond" | "line" | "arrow" | "arrow2" | "curve";

export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: "arrow", label: "Flecha" },
  { kind: "arrow2", label: "Flecha doble" },
  { kind: "curve", label: "Flecha curva (con nodos)" },
  { kind: "line", label: "Línea" },
  { kind: "rect", label: "Rectángulo" },
  { kind: "rounded", label: "Rectángulo redondeado" },
  { kind: "ellipse", label: "Elipse" },
  { kind: "triangle", label: "Triángulo" },
  { kind: "diamond", label: "Rombo" },
];

export const SHAPE_COLORS = ["#1d1d1f", "#8e8e93", "#0071e3", "#ff3b30", "#34c759", "#ff9f0a", "#af52de", "#ffe066"];

export const isLineKind = (k?: ShapeKind) => k === "line" || k === "arrow" || k === "arrow2" || k === "curve";

export interface Pt { x: number; y: number }

/** Tamaño y puntos iniciales de cada figura */
export function shapeDefaults(kind: ShapeKind): { w: number; h: number; points?: Pt[] } {
  if (kind === "curve") return { w: 260, h: 80, points: [{ x: 0, y: 60 }, { x: 130, y: 0 }, { x: 260, y: 60 }] };
  if (isLineKind(kind)) return { w: 240, h: 0, points: [{ x: 0, y: 0 }, { x: 240, y: 0 }] };
  if (kind === "ellipse") return { w: 200, h: 140 };
  return { w: 200, h: 140 };
}

/** Curva suave que pasa por todos los nodos (Catmull-Rom → Bézier) */
function smoothPath(p: Pt[]) {
  if (p.length < 3) return `M${p[0].x},${p[0].y} L${p[1].x},${p[1].y}`;
  let d = `M${p[0].x},${p[0].y}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] ?? p2;
    d += ` C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`;
  }
  return d;
}

function head(tip: Pt, from: Pt, color: string, sw: number) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x), L = 10 + sw * 2.5, s = 0.45;
  const p1 = { x: tip.x - L * Math.cos(a - s), y: tip.y - L * Math.sin(a - s) };
  const p2 = { x: tip.x - L * Math.cos(a + s), y: tip.y - L * Math.sin(a + s) };
  return `<path d="M${p1.x},${p1.y} L${tip.x},${tip.y} L${p2.x},${p2.y}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** SVG en coordenadas locales del elemento. `standalone` añade viewBox para el archivo .svg */
export function shapeSvg(it: Item, standalone = false): string {
  const c = it.color ?? "#1d1d1f", sw = 3, k = it.shape as ShapeKind;
  let body = "";
  if (isLineKind(k)) {
    const p = (it.points ?? []) as Pt[];
    const d = k === "curve" ? smoothPath(p) : `M${p.map((q) => `${q.x},${q.y}`).join(" L")}`;
    body += `<path class="hit" d="${d}" fill="none" stroke="transparent" stroke-width="18"/>`;
    body += `<path d="${d}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`;
    const n = p.length;
    if (k === "arrow" || k === "arrow2" || k === "curve") body += head(p[n - 1], k === "curve" ? lerpBack(p) : p[n - 2], c, sw);
    if (k === "arrow2") body += head(p[0], p[1], c, sw);
  } else {
    const w = it.w, h = it.h, i = sw / 2;
    const fill = `${c}1f`;
    const attrs = `fill="${fill}" stroke="${c}" stroke-width="${sw}" stroke-linejoin="round" class="hit"`;
    if (k === "rect") body = `<rect x="${i}" y="${i}" width="${w - sw}" height="${h - sw}" ${attrs}/>`;
    if (k === "rounded") body = `<rect x="${i}" y="${i}" width="${w - sw}" height="${h - sw}" rx="${Math.min(w, h) * 0.18}" ${attrs}/>`;
    if (k === "ellipse") body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - i}" ry="${h / 2 - i}" ${attrs}/>`;
    if (k === "triangle") body = `<path d="M${w / 2},${i} L${w - i},${h - i} L${i},${h - i} Z" ${attrs}/>`;
    if (k === "diamond") body = `<path d="M${w / 2},${i} L${w - i},${h / 2} L${w / 2},${h - i} L${i},${h / 2} Z" ${attrs}/>`;
  }
  if (standalone) {
    const b = bbox(it);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x - 12} ${b.y - 12} ${b.w + 24} ${b.h + 24}" width="${b.w + 24}" height="${b.h + 24}">${body}</svg>\n`;
  }
  return `<svg class="shape-svg" width="${Math.max(1, it.w)}" height="${Math.max(1, it.h)}" overflow="visible">${body}</svg>`;
}

// la punta de la curva se orienta según la tangente final
function lerpBack(p: Pt[]): Pt {
  const a = p[p.length - 2], b = p[p.length - 1];
  return { x: b.x - (b.x - a.x) * 0.3, y: b.y - (b.y - a.y) * 0.3 };
}

export function bbox(it: Item) {
  if (!it.points?.length) return { x: 0, y: 0, w: it.w, h: it.h };
  const xs = it.points.map((p) => p.x), ys = it.points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Inserta un nodo en el centro del tramo más largo */
export function addNode(points: Pt[]): Pt[] {
  let best = 0, len = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const l = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    if (l > len) { len = l; best = i; }
  }
  const a = points[best], b = points[best + 1];
  const out = [...points];
  out.splice(best + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 30 });
  return out;
}
