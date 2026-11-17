import { fsx } from "./storage";

import { shapeSvg } from "./shapes";
import type { ShapeKind, Pt } from "./shapes";

export type ItemType = "text" | "postit" | "image" | "shape" | "timeline";

export interface Item {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string; // post-its
  name?: string; // nombre interno (post-its y figuras)
  shape?: ShapeKind; // figuras
  points?: Pt[]; // líneas y flechas: nodos en coordenadas locales
  // organización
  groupId?: string;
  locked?: boolean;
  pinned?: boolean; // post-its y timelines: siempre al frente
  // flechas y líneas conectadas: extremo unido al punto medio de un lado de otro elemento
  startConn?: Conn;
  endConn?: Conn;
  strokeWidth?: number; // rotulador
  // timeline
  titlePos?: "top" | "bottom" | "none";
  dividers?: number[]; // posiciones de las líneas verticales (0..1)
  segments?: Segment[]; // una más que dividers
  file?: string; // imágenes: nombre dentro de imagenes/
  content?: string; // textos y post-its: markdown (se guarda en .md aparte)
}

export type Side = "t" | "r" | "b" | "l";
export interface Conn { id: string; side: Side }

export interface Segment { color: string; label?: string; textColor?: string }

export interface Sheet { w: number; h: number }
export interface Camera { x: number; y: number; z: number }

export interface BoardMeta {
  version: 1;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface BoardFile extends BoardMeta {
  sheet: Sheet;
  camera?: Camera;
  items: Omit<Item, "content">[];
}

export interface BoardSummary extends BoardMeta { dir: string; itemCount: number }

export interface BoardState { sheet: Sheet; items: Item[] }

export const POSTIT_COLORS = ["#ffe066", "#ffadad", "#a0e7a0", "#9bd0ff", "#d7b8ff", "#ffc78f"];
export const POSTIT_SIZES = { s: 180, l: 280 };

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "pizarra";

export const contentPath = (dir: string, it: Item) => `${dir}/${it.type === "postit" ? "postits" : "textos"}/${it.id}.md`;

export async function listBoards(): Promise<BoardSummary[]> {
  const dirs = await fsx.listDirs("");
  const out: BoardSummary[] = [];
  for (const dir of dirs) {
    const raw = await fsx.readText(`${dir}/board.json`);
    if (!raw) continue;
    try {
      const b = JSON.parse(raw) as BoardFile;
      out.push({ version: 1, id: b.id, name: b.name, description: b.description, createdAt: b.createdAt, updatedAt: b.updatedAt, dir, itemCount: b.items?.length ?? 0 });
    } catch { /* carpeta dañada: se ignora */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createBoard(name: string, description: string): Promise<string> {
  const id = uid();
  const dir = `${slug(name)}-${id.slice(0, 6)}`;
  const now = new Date().toISOString();
  const file: BoardFile = { version: 1, id, name, description, createdAt: now, updatedAt: now, sheet: { w: 1920, h: 1080 }, items: [] };
  await fsx.writeText(`${dir}/board.json`, JSON.stringify(file, null, 2));
  return dir;
}

export async function updateBoardMeta(dir: string, name: string, description: string) {
  const raw = await fsx.readText(`${dir}/board.json`);
  if (!raw) return;
  const b = JSON.parse(raw) as BoardFile;
  b.name = name; b.description = description; b.updatedAt = new Date().toISOString();
  await fsx.writeText(`${dir}/board.json`, JSON.stringify(b, null, 2));
}

export async function duplicateBoard(src: BoardSummary): Promise<void> {
  const id = uid();
  const name = `${src.name} (copia)`;
  const dir = `${slug(name)}-${id.slice(0, 6)}`;
  await fsx.copyDir(src.dir, dir);
  const raw = await fsx.readText(`${dir}/board.json`);
  if (!raw) return;
  const b = JSON.parse(raw) as BoardFile;
  const now = new Date().toISOString();
  Object.assign(b, { id, name, createdAt: now, updatedAt: now });
  await fsx.writeText(`${dir}/board.json`, JSON.stringify(b, null, 2));
}

export const deleteBoard = (dir: string) => fsx.remove(dir);

export async function loadBoard(dir: string): Promise<{ file: BoardFile; state: BoardState }> {
  const raw = await fsx.readText(`${dir}/board.json`);
  if (!raw) throw new Error("No se encontró board.json");
  const file = JSON.parse(raw) as BoardFile;
  const items: Item[] = [];
  for (const it of file.items) {
    const item: Item = { ...it };
    if (it.type === "text" || it.type === "postit") item.content = (await fsx.readText(contentPath(dir, item))) ?? "";
    items.push(item);
  }
  return { file, state: { sheet: file.sheet, items } };
}

/** Guarda board.json y los .md que hayan cambiado. `saved` recuerda lo último escrito. */
export async function saveBoard(dir: string, meta: BoardMeta, state: BoardState, camera: Camera, saved: Map<string, string>) {
  const current = new Map<string, string>();
  for (const it of state.items) {
    if (it.type === "image" || it.type === "timeline") continue;
    const p = it.type === "shape" ? `${dir}/formas/${it.id}.svg` : contentPath(dir, it);
    const c = it.type === "shape" ? shapeSvg(it, true) : it.content ?? "";
    current.set(p, c);
    if (saved.get(p) !== c) await fsx.writeText(p, c);
  }
  for (const p of saved.keys()) if (!current.has(p)) await fsx.remove(p);
  saved.clear();
  current.forEach((v, k) => saved.set(k, v));
  const file: BoardFile = {
    ...meta,
    updatedAt: new Date().toISOString(),
    sheet: state.sheet,
    camera,
    items: state.items.map(({ content: _c, ...rest }) => rest),
  };
  await fsx.writeText(`${dir}/board.json`, JSON.stringify(file, null, 2));
}

/** Borra imágenes que ya no usa ningún elemento (se llama al cerrar la pizarra). */
export async function cleanOrphanImages(dir: string, state: BoardState) {
  const used = new Set(state.items.filter((i) => i.type === "image").map((i) => i.file));
  for (const f of await fsx.listFiles(`${dir}/imagenes`)) if (!used.has(f)) await fsx.remove(`${dir}/imagenes/${f}`);
}

const imgCache = new Map<string, string>();
export async function imageUrl(dir: string, file: string): Promise<string | null> {
  const key = `${dir}/imagenes/${file}`;
  if (imgCache.has(key)) return imgCache.get(key)!;
  const b64 = await fsx.readBase64(key);
  if (!b64) return null;
  const ext = file.split(".").pop()?.toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const url = `data:${mime};base64,${b64}`;
  imgCache.set(key, url);
  return url;
}

export async function storeImage(dir: string, f: File): Promise<{ file: string; w: number; h: number; url: string }> {
  const ext = (f.name.split(".").pop() || f.type.split("/")[1] || "png").toLowerCase();
  const file = `${uid()}.${ext}`;
  const url: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
  await fsx.writeBase64(`${dir}/imagenes/${file}`, url.split(",")[1]);
  imgCache.set(`${dir}/imagenes/${file}`, url);
  const dims: { w: number; h: number } = await new Promise((res) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => res({ w: 400, h: 300 });
    im.src = url;
  });
  return { file, url, ...dims };
}
