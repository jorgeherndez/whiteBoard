import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import RichText from "./RichText";
import NewPostitDialog, { NewPostit } from "./NewPostitDialog";
import NewShapeDialog, { NewShape } from "./NewShapeDialog";
import { SHAPE_COLORS, addNode, isLineKind, isStrokeKind, shapeDefaults, shapeSvg } from "./shapes";
import { SIDES, anchor, connectable, nearestAnchor, resolveLines, worldBox } from "./connect";
import { fsx } from "./storage";
import {
  BoardFile, BoardState, Camera, Item, POSTIT_COLORS, POSTIT_SIZES, SHEET_MIN, Sheet,
  Side, cleanOrphanImages, imageUrl, loadBoard, saveBoard, storeImage, uid,
} from "./model";

// portapapeles interno (sirve entre pizarras)
let clip: { dir: string; items: Item[] } | null = null;
const CLIP_MARK = "whiteboard-items";

export const PEN_COLORS = ["#1d1d1f", "#1f5fd6", "#1e9e48", "#e5322d"];
export const PEN_SIZES = [3, 6, 12];

const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const itemText = (it: Item) => [it.name, it.content, ...(it.segments ?? []).map((s) => s.label)].filter(Boolean).join(" \n ");

const MIN_Z = 0.05, MAX_Z = 8;
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

type Drag =
  | { kind: "pan"; sx: number; sy: number; cam: Camera }
  | { kind: "move"; id: string; ids: string[]; origins: Record<string, { x: number; y: number }>; sx: number; sy: number; base: BoardState }
  | { kind: "node"; id: string; idx: number; sx: number; sy: number; ox: number; oy: number; base: BoardState; end?: "start" | "end" }
  | { kind: "marquee"; sx: number; sy: number; wx: number; wy: number; add: boolean; prev: string[] }
  | { kind: "pen"; sx: number; sy: number }
  | { kind: "divider"; id: string; idx: number; sx: number; sy: number; ox: number; base: BoardState }
  | { kind: "draw"; id: string; sx: number; sy: number; f: number; fromTop: boolean; base: BoardState }
  | { kind: "resize"; id: string; sx: number; sy: number; ow: number; oh: number; ratio?: number; base: BoardState }
  | { kind: "sheet"; edge: Edge; sx: number; sy: number; o: Required<Pick<Sheet, "x" | "y" | "w" | "h">>; base: BoardState }
  | { kind: "erase"; sx: number; sy: number };

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const sheetRect = (sh: Sheet) => ({ x: sh.x ?? 0, y: sh.y ?? 0, w: sh.w, h: sh.h });
const sheetClip = (sh: Sheet, ox = 0, oy = 0) => {
  const r = sheetRect(sh);
  const x0 = r.x - ox, y0 = r.y - oy, x1 = x0 + r.w, y1 = y0 + r.h;
  return `polygon(${x0}px ${y0}px, ${x1}px ${y0}px, ${x1}px ${y1}px, ${x0}px ${y1}px)`;
};
function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export default function BoardView({ dir, onClose }: { dir: string; onClose: () => void }) {
  const [meta, setMeta] = useState<BoardFile | null>(null);
  const [state, setState] = useState<BoardState | null>(null);
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, z: 1 });
  const [selIds, setSelIds] = useState<string[]>([]);
  const selected = selIds.length === 1 ? selIds[0] : null;
  const setSelected = (id: string | null) => setSelIds(id ? [id] : []);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [snapTarget, setSnapTarget] = useState<{ x: number; y: number } | null>(null);
  const [pen, setPen] = useState<{ on: boolean; mode: "pen" | "eraser"; color: string; size: number }>({ on: false, mode: "pen", color: PEN_COLORS[1], size: PEN_SIZES[1] });
  const [erasing, setErasing] = useState<Set<string>>(new Set());
  const [panning, setPanning] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [stroke, setStroke] = useState<{ x: number; y: number }[] | null>(null);
  const [search, setSearch] = useState<{ q: string; idx: number } | null>(null);
  const [connDrag, setConnDrag] = useState(false);
  const [itemMenu, setItemMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [lifted, setLifted] = useState<Set<string>>(new Set());
  const [newPostit, setNewPostit] = useState<{ screen: { x: number; y: number }; world?: { x: number; y: number } } | null>(null);
  const [newShape, setNewShape] = useState<{ screen: { x: number; y: number }; world?: { x: number; y: number } } | null>(null);
  const [segPop, setSegPop] = useState<{ id: string; idx: number; x: number; y: number } | null>(null);
  const [selDiv, setSelDiv] = useState<{ id: string; idx: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ id: string; idx: number; x: number; y: number } | null>(null);
  const [warnDiv, setWarnDiv] = useState<{ id: string; idx: number; label: string } | null>(null);
  const [drawPrev, setDrawPrev] = useState<{ id: string; f: number; fromTop: boolean; len: number } | null>(null);
  const downAt = useRef({ x: 0, y: 0, sel: false });
  const mouseScreen = useRef<{ x: number; y: number } | null>(null);
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [, force] = useState(0);
  const [spaceDown, setSpaceDown] = useState(false);

  const past = useRef<BoardState[]>([]);
  const future = useRef<BoardState[]>([]);
  const stateRef = useRef<BoardState | null>(null);
  stateRef.current = state;
  const camRef = useRef(cam);
  camRef.current = cam;
  const drag = useRef<Drag | null>(null);
  const mouse = useRef<{ x: number; y: number } | null>(null); // posición del ratón en el mundo
  const viewport = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const savedMap = useRef(new Map<string, string>());
  const loaded = useRef(false);

  // ---------- carga ----------
  useEffect(() => {
    loadBoard(dir).then(({ file, state }) => {
      setMeta(file);
      setState(state);
      for (const it of state.items) if (it.type === "text" || it.type === "postit") savedMap.current.set(`${dir}/${it.type === "postit" ? "postits" : "textos"}/${it.id}.md`, it.content ?? "");
      const vp = viewport.current!.getBoundingClientRect();
      setCam(file.camera ?? fitCam(file.sheet, vp));
      loaded.current = true;
    });
  }, [dir]);

  const fitCam = (sheet: Sheet, vp: DOMRect): Camera => {
    const r = sheetRect(sheet);
    const z = clampZ(Math.min((vp.width - 160) / r.w, (vp.height - 200) / r.h));
    return { z, x: (vp.width - r.w * z) / 2 - r.x * z, y: (vp.height - r.h * z) / 2 + 20 - r.y * z };
  };

  // ---------- historial ----------
  const commit = useCallback((next: BoardState, base?: BoardState) => {
    const prev = base ?? stateRef.current;
    if (prev) { past.current.push(prev); if (past.current.length > 200) past.current.shift(); }
    future.current = [];
    setState(next);
  }, []);

  const undo = useCallback(() => {
    const p = past.current.pop();
    if (!p || !stateRef.current) return;
    future.current.push(stateRef.current);
    setState(p);
    setSelIds((ids) => ids.filter((id) => p.items.some((i) => i.id === id)));
    force((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const f = future.current.pop();
    if (!f || !stateRef.current) return;
    past.current.push(stateRef.current);
    setState(f);
    setSelIds((ids) => ids.filter((id) => f.items.some((i) => i.id === id)));
    force((n) => n + 1);
  }, []);

  const updateItem = (id: string, patch: Partial<Item>, record = true, base?: BoardState) => {
    const s = stateRef.current!;
    const next = { ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
    if (record) commit(next, base); else setState(next);
  };

  // ---------- guardado automático ----------
  const doSave = useCallback(async () => {
    if (!meta || !stateRef.current) return;
    setSaveStatus("saving");
    try {
      const st = stateRef.current;
      await saveBoard(dir, meta, { ...st, items: resolveLines(st.items) }, camRef.current, savedMap.current);
      setSaveStatus("saved");
    } catch (e) {
      console.error(e);
      setSaveStatus("error");
    }
  }, [dir, meta]);

  useEffect(() => {
    if (!loaded.current || !state) return;
    setSaveStatus("pending");
    const t = window.setTimeout(doSave, 700);
    return () => window.clearTimeout(t);
  }, [state, cam, doSave]);

  const close = async () => {
    setEditing(null);
    await doSave();
    if (stateRef.current) await cleanOrphanImages(dir, stateRef.current).catch(() => {});
    onClose();
  };

  // ---------- crear elementos ----------
  const viewCenter = () => {
    const vp = viewport.current!.getBoundingClientRect();
    const jitter = () => (Math.random() - 0.5) * 240;
    return { x: (vp.width / 2 - cam.x) / cam.z + jitter(), y: (vp.height / 2 - cam.y) / cam.z + jitter() };
  };

  const addItem = (it: Omit<Item, "id" | "x" | "y">, at?: { x: number; y: number }) => {
    const c = at ?? viewCenter();
    const item: Item = { ...it, id: uid(), x: c.x - it.w / 2, y: c.y - it.h / 2 };
    commit({ ...stateRef.current!, items: [...stateRef.current!.items, item] });
    setSelected(item.id);
    if (item.type === "text" || item.type === "postit") setEditing(item.id);
  };

  const nextDefaultName = () => {
    const used = new Set(stateRef.current?.items.map((i) => i.name));
    let n = 1;
    while (used.has(`Sin_nombre(${n})`)) n++;
    return `Sin_nombre(${n})`;
  };
  const openNewPostit = (fromMouse: boolean) => {
    const vp = viewport.current!.getBoundingClientRect();
    if (fromMouse && mouseScreen.current && mouse.current) setNewPostit({ screen: mouseScreen.current, world: mouse.current });
    else setNewPostit({ screen: { x: vp.width / 2 - 170, y: vp.height / 2 - 150 } });
  };
  const openNewShape = (fromMouse: boolean) => {
    const vp = viewport.current!.getBoundingClientRect();
    if (fromMouse && mouseScreen.current && mouse.current) setNewShape({ screen: mouseScreen.current, world: mouse.current });
    else setNewShape({ screen: { x: vp.width / 2 - 180, y: vp.height / 2 - 160 } });
  };
  const createShape = (s: NewShape, at?: { x: number; y: number }) => {
    if (s.kind === "timeline") return addItem({ type: "timeline", name: s.name || "Timeline", color: s.color, titlePos: "top", w: 900, h: 64,
      dividers: [1 / 3, 2 / 3], segments: [{ color: "#ffffff" }, { color: "#ffffff" }, { color: "#ffffff" }] }, at);
    if (s.kind === "text") return addItem({ type: "text", w: 360, h: 120, content: "", name: s.name || undefined }, at);
    const d = shapeDefaults(s.kind);
    addItem({ type: "shape", shape: s.kind, color: s.color, name: s.name || undefined, w: d.w, h: d.h, points: d.points }, at);
  };
  const createPostit = (p: NewPostit, at?: { x: number; y: number }) => {
    const s = POSTIT_SIZES[p.size];
    addItem({ type: "postit", name: p.name, w: s, h: s, color: p.color, content: "" }, at);
  };
  const addText = (at?: { x: number; y: number }) => addItem({ type: "text", w: 360, h: 120, content: "" }, at);

  const addImages = async (files: FileList | File[], at?: { x: number; y: number }) => {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      const img = await storeImage(dir, f);
      const maxW = 480;
      const w = Math.min(maxW, img.w), h = (img.h / img.w) * w;
      addItem({ type: "image", w, h, file: img.file }, at);
    }
  };

  /** Borra los elementos indicados (los bloqueados no). Las flechas unidas a ellos se quedan donde estaban. */
  const removeItems = (ids: string[]) => {
    const st = stateRef.current!;
    const del = new Set(st.items.filter((i) => ids.includes(i.id) && !i.locked).map((i) => i.id));
    if (!del.size) return;
    const items = resolveLines(st.items).filter((i) => !del.has(i.id)).map((i) => {
      if (!i.startConn && !i.endConn) return st.items.find((o) => o.id === i.id)!;
      const patch: Partial<Item> = {};
      if (i.startConn && del.has(i.startConn.id)) patch.startConn = undefined;
      if (i.endConn && del.has(i.endConn.id)) patch.endConn = undefined;
      return Object.keys(patch).length ? { ...i, ...patch } : st.items.find((o) => o.id === i.id)!;
    });
    commit({ ...st, items });
    setSelIds([]);
    setEditing(null);
  };
  const removeSelected = () => removeItems(selIds);

  /** Selección ampliada a los grupos completos */
  const withGroups = (ids: string[]) => {
    const st = stateRef.current!;
    const groups = new Set(st.items.filter((i) => ids.includes(i.id) && i.groupId).map((i) => i.groupId));
    return st.items.filter((i) => ids.includes(i.id) || (i.groupId && groups.has(i.groupId))).map((i) => i.id);
  };

  const reorder = (ids: string[], front: boolean) => {
    const st = stateRef.current!;
    const set = new Set(ids);
    const moved = st.items.filter((i) => set.has(i.id)), rest = st.items.filter((i) => !set.has(i.id));
    commit({ ...st, items: front ? [...rest, ...moved] : [...moved, ...rest] });
  };
  const patchMany = (ids: string[], patch: (i: Item) => Partial<Item>) => {
    const st = stateRef.current!;
    commit({ ...st, items: st.items.map((i) => (ids.includes(i.id) ? { ...i, ...patch(i) } : i)) });
  };
  const toggleLock = (ids: string[]) => { const lock = !stateRef.current!.items.filter((i) => ids.includes(i.id)).every((i) => i.locked); patchMany(ids, () => ({ locked: lock || undefined })); };
  const togglePin = (ids: string[]) => { const pin = !stateRef.current!.items.filter((i) => ids.includes(i.id)).every((i) => i.pinned); patchMany(ids, (i) => (i.type === "postit" || i.type === "timeline" ? { pinned: pin || undefined } : {})); };
  const group = (ids: string[]) => { if (ids.length < 2) return; const g = uid(); patchMany(ids, () => ({ groupId: g })); };
  const ungroup = (ids: string[]) => patchMany(ids, () => ({ groupId: undefined }));

  // ---------- copiar / pegar / duplicar ----------
  const copySel = () => {
    if (!selIds.length) return false;
    const st = stateRef.current!;
    clip = { dir, items: resolveLines(st.items).filter((i) => selIds.includes(i.id)).map((i) => structuredClone(i)) };
    return true;
  };
  const pasteClip = async (offset = 30) => {
    if (!clip) return;
    const idMap = new Map(clip.items.map((i) => [i.id, uid()]));
    const gMap = new Map<string, string>();
    const out: Item[] = [];
    for (const src of clip.items) {
      const it: Item = { ...structuredClone(src), id: idMap.get(src.id)!, x: src.x + offset, y: src.y + offset, locked: undefined };
      if (src.groupId) { if (!gMap.has(src.groupId)) gMap.set(src.groupId, uid()); it.groupId = gMap.get(src.groupId); }
      it.startConn = src.startConn && idMap.has(src.startConn.id) ? { ...src.startConn, id: idMap.get(src.startConn.id)! } : undefined;
      it.endConn = src.endConn && idMap.has(src.endConn.id) ? { ...src.endConn, id: idMap.get(src.endConn.id)! } : undefined;
      if (it.type === "image" && it.file && clip.dir !== dir) {
        const b64 = await fsx.readBase64(`${clip.dir}/imagenes/${it.file}`);
        if (b64) await fsx.writeBase64(`${dir}/imagenes/${it.file}`, b64);
      }
      out.push(it);
    }
    commit({ ...stateRef.current!, items: [...stateRef.current!.items, ...out] });
    setSelIds(out.map((i) => i.id));
    clip = { dir, items: out.map((i) => structuredClone(i)) }; // pegados sucesivos se van desplazando
  };
  const duplicateSel = () => { if (copySel()) pasteClip(); };

  // ---------- zoom ----------
  const zoomAt = (factor: number, px: number, py: number) => {
    setCam((c) => {
      const z = clampZ(c.z * factor);
      const k = z / c.z;
      return { z, x: px - (px - c.x) * k, y: py - (py - c.y) * k };
    });
  };
  const zoomCenter = (factor: number) => {
    const vp = viewport.current!.getBoundingClientRect();
    zoomAt(factor, vp.width / 2, vp.height / 2);
  };

  useEffect(() => {
    const el = viewport.current!;
    const onWheel = (e: WheelEvent) => {
      if (editing && (e.target as HTMLElement).closest(".rt.editing") && !e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || !e.shiftKey) {
        // rueda = zoom (pellizco del trackpad llega con ctrlKey)
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
      } else {
        setCam((c) => ({ ...c, x: c.x - e.deltaY, y: c.y - e.deltaX }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [editing]);

  // ---------- punteros ----------
  const onPointerMove = (e: React.PointerEvent) => {
    const r = viewport.current!.getBoundingClientRect();
    const c = camRef.current;
    mouseScreen.current = { x: e.clientX, y: e.clientY };
    mouse.current = { x: (e.clientX - r.left - c.x) / c.z, y: (e.clientY - r.top - c.y) / c.z };
    const d = drag.current;
    if (!d) return;
    const z = camRef.current.z;
    const dx = (e.clientX - d.sx) / z, dy = (e.clientY - d.sy) / z;
    if (d.kind === "pan") setCam({ ...d.cam, x: d.cam.x + (e.clientX - d.sx), y: d.cam.y + (e.clientY - d.sy) });
    else if (d.kind === "move") {
      const st = stateRef.current!;
      const moving = new Set(d.ids);
      // guías magnéticas: alinear bordes y centros con el resto de elementos
      let ax = dx, ay = dy;
      const gv: number[] = [], gh: number[] = [];
      if (!e.altKey) {
        const boxes = st.items.filter((i) => moving.has(i.id) && !(i.type === "shape" && isLineKind(i.shape))).map((i) => worldBox({ ...i, x: d.origins[i.id].x, y: d.origins[i.id].y }));
        if (boxes.length) {
          const L = Math.min(...boxes.map((b) => b.x)), T = Math.min(...boxes.map((b) => b.y));
          const R = Math.max(...boxes.map((b) => b.x + b.w)), B = Math.max(...boxes.map((b) => b.y + b.h));
          const mx = [L, (L + R) / 2, R], my = [T, (T + B) / 2, B];
          const others = st.items.filter((i) => !moving.has(i.id) && !(i.type === "shape" && isStrokeKind(i.shape))).map(worldBox);
          const tx = others.flatMap((b) => [b.x, b.x + b.w / 2, b.x + b.w]), ty = others.flatMap((b) => [b.y, b.y + b.h / 2, b.y + b.h]);
          const th = 6 / z;
          let bx: number | null = null, by: number | null = null;
          for (const m of mx) for (const t of tx) { const diff = t - (m + dx); if (Math.abs(diff) < th && (bx === null || Math.abs(diff) < Math.abs(bx))) bx = diff; }
          for (const m of my) for (const t of ty) { const diff = t - (m + dy); if (Math.abs(diff) < th && (by === null || Math.abs(diff) < Math.abs(by))) by = diff; }
          if (bx !== null) { ax = dx + bx; for (const m of mx) if (tx.some((t) => Math.abs(t - (m + ax)) < 0.5)) gv.push(m + ax); }
          if (by !== null) { ay = dy + by; for (const m of my) if (ty.some((t) => Math.abs(t - (m + ay)) < 0.5)) gh.push(m + ay); }
        }
      }
      setGuides({ v: gv, h: gh });
      setState({ ...st, items: st.items.map((i) => (moving.has(i.id) ? { ...i, x: Math.round(d.origins[i.id].x + ax), y: Math.round(d.origins[i.id].y + ay) } : i)) });
    } else if (d.kind === "marquee") {
      const wx = mouse.current!.x, wy = mouse.current!.y;
      const box = { x: Math.min(d.wx, wx), y: Math.min(d.wy, wy), w: Math.abs(wx - d.wx), h: Math.abs(wy - d.wy) };
      setMarquee(box);
      const hit = stateRef.current!.items.filter((i) => {
        const b = worldBox(i);
        return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
      }).map((i) => i.id);
      setSelIds(withGroups(d.add ? [...new Set([...d.prev, ...hit])] : hit));
    } else if (d.kind === "pen") {
      const p = mouse.current!;
      setStroke((s) => {
        if (!s) return [p];
        const last = s[s.length - 1];
        return Math.hypot(p.x - last.x, p.y - last.y) * z < 2 ? s : [...s, p];
      });
    }
    else if (d.kind === "draw") {
      const it = stateRef.current!.items.find((i) => i.id === d.id);
      if (it) setDrawPrev({ id: d.id, f: d.f, fromTop: d.fromTop, len: Math.max(0, Math.min(1, (d.fromTop ? dy : -dy) / it.h)) });
    } else if (d.kind === "divider") {
      const it = stateRef.current!.items.find((i) => i.id === d.id);
      if (it?.dividers) {
        const lo = (it.dividers[d.idx - 1] ?? 0) + 0.02, hi = (it.dividers[d.idx + 1] ?? 1) - 0.02;
        const f = Math.min(hi, Math.max(lo, d.ox + ((e.clientX - d.sx) / z) / it.w));
        updateItem(d.id, { dividers: it.dividers.map((v, i) => (i === d.idx ? f : v)) }, false);
      }
    } else if (d.kind === "node") {
      const it = stateRef.current!.items.find((i) => i.id === d.id);
      if (it?.points) {
        let nx = d.ox + dx, ny = d.oy + dy;
        let target: { x: number; y: number } | null = null;
        if (d.end) {
          const conns = new Set([it.id]);
          const other = d.end === "start" ? it.endConn : it.startConn;
          if (other) conns.add(other.id);
          const near = nearestAnchor(stateRef.current!.items, { x: it.x + nx, y: it.y + ny }, 28 / z, conns);
          if (near) { nx = near.x - it.x; ny = near.y - it.y; target = near; }
        }
        setSnapTarget(target);
        const patch: Partial<Item> = { points: it.points.map((p, i) => (i === d.idx ? { x: Math.round(nx), y: Math.round(ny) } : p)) };
        if (d.end === "start") patch.startConn = undefined;
        if (d.end === "end") patch.endConn = undefined;
        updateItem(d.id, patch, false);
      }
    } else if (d.kind === "resize") {
      const w = Math.max(60, d.ow + dx);
      const h = d.ratio ? w * d.ratio : Math.max(40, d.oh + dy);
      updateItem(d.id, { w: Math.round(w), h: Math.round(h) }, false);
    } else if (d.kind === "sheet") {
      // como una forma de PowerPoint: cada borde/esquina mueve su lado, con tamaño mínimo
      const s = stateRef.current!, o = d.o;
      let { x, y, w, h } = o;
      if (d.edge.includes("e")) w = Math.max(SHEET_MIN.w, o.w + dx);
      if (d.edge.includes("s")) h = Math.max(SHEET_MIN.h, o.h + dy);
      if (d.edge.includes("w")) { w = Math.max(SHEET_MIN.w, o.w - dx); x = o.x + o.w - w; }
      if (d.edge.includes("n")) { h = Math.max(SHEET_MIN.h, o.h - dy); y = o.y + o.h - h; }
      setState({ ...s, sheet: { ...s.sheet, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } });
    } else if (d.kind === "erase") {
      eraseAt(mouse.current!);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGuides({ v: [], h: [] });
    setConnDrag(false);
    setPanning(false);
    if (d?.kind === "marquee") { setMarquee(null); return; }
    if (d?.kind === "erase") {
      const ids = [...erasing];
      setErasing(new Set());
      if (ids.length) commit({ ...stateRef.current!, items: stateRef.current!.items.filter((i) => !ids.includes(i.id)) });
      return;
    }
    if (d?.kind === "pen") {
      const pts = stroke;
      setStroke(null);
      const r = sheetRect(stateRef.current!.sheet);
      const inside = (p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
      if (pts && pts.length && pts.some(inside)) {
        const minX = Math.min(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y));
        const w = Math.max(...pts.map((p) => p.x)) - minX, h = Math.max(...pts.map((p) => p.y)) - minY;
        const item: Item = { id: uid(), type: "shape", shape: "pen", color: pen.color, strokeWidth: pen.size, x: minX, y: minY, w, h,
          points: pts.map((p) => ({ x: Math.round((p.x - minX) * 10) / 10, y: Math.round((p.y - minY) * 10) / 10 })) };
        commit({ ...stateRef.current!, items: [...stateRef.current!.items, item] });
      }
      return;
    }
    if (d?.kind === "node" && d.end) {
      const it = stateRef.current!.items.find((i) => i.id === d.id);
      if (it && snapTarget) {
        const near = nearestAnchor(stateRef.current!.items, snapTarget, 1, new Set([it.id]));
        if (near) {
          const conn = { id: near.id, side: near.side as Side };
          const st = stateRef.current!;
          setState({ ...st, items: st.items.map((i) => (i.id === it.id ? { ...i, [d.end === "start" ? "startConn" : "endConn"]: conn } : i)) });
          stateRef.current = { ...st, items: st.items.map((i) => (i.id === it.id ? { ...i, [d.end === "start" ? "startConn" : "endConn"]: conn } : i)) };
        }
      }
      setSnapTarget(null);
    }
    // clic (sin arrastrar) sobre una franja de una timeline ya seleccionada → su submenú
    if (d?.kind === "move" && downAt.current.sel && Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) < 4) {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-seg]") as HTMLElement | null;
      if (el) setSegPop({ id: d.id, idx: Number(el.dataset.seg), x: e.clientX, y: e.clientY });
    }
    downAt.current.sel = false;
    if (d?.kind === "draw") {
      const prev = drawPrev;
      setDrawPrev(null);
      if (prev && prev.len >= 0.6) insertDivider(d.id, d.f);
      return;
    }
    if (d?.kind === "divider" && stateRef.current === d.base) { setSelDiv({ id: d.id, idx: d.idx }); return; }
    if (!d || d.kind === "pan") return;
    if (d.kind === "node" && d.base && !d.base.items.some((i) => i.id === d.id)) {
      // flecha nueva desde un ancla: si no se arrastró, se descarta
      const it = stateRef.current!.items.find((i) => i.id === d.id);
      if (it?.points && Math.hypot(it.points[1].x, it.points[1].y) < 8) { setState(d.base); setSelIds([]); return; }
    }
    if (stateRef.current !== d.base) {
      past.current.push(d.base);
      future.current = [];
      force((n) => n + 1);
    }
  };

  const startPan = (e: React.PointerEvent) => {
    viewport.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, cam };
    setPanning(true);
  };

  const onBgPointerDown = (e: React.PointerEvent) => {
    setEditing(null);
    setSelDiv(null);
    if (e.button === 1 || e.button === 2 || spaceDown) return startPan(e);
    if (e.button !== 0) return;
    // arrastrar el fondo = recuadro de selección (Mayús añade)
    if (!e.shiftKey) setSelIds([]);
    viewport.current!.setPointerCapture(e.pointerId);
    const m = mouse.current ?? { x: 0, y: 0 };
    drag.current = { kind: "marquee", sx: e.clientX, sy: e.clientY, wx: m.x, wy: m.y, add: e.shiftKey, prev: e.shiftKey ? selIds : [] };
  };

  /** Con el rotulador activo, se dibuja encima de todo */
  const eraseAt = (p: { x: number; y: number }) => {
    const rad = 10 / camRef.current.z;
    const hit = stateRef.current!.items.filter((it) => it.type === "shape" && it.shape === "pen" && !it.locked && it.points?.some((q, i, arr) =>
      segDist({ x: p.x - it.x, y: p.y - it.y }, q, arr[Math.min(i + 1, arr.length - 1)]) <= rad + (it.strokeWidth ?? 4) / 2));
    if (hit.length) setErasing((s) => { const n = new Set(s); hit.forEach((h) => n.add(h.id)); return n; });
  };

  const onPenDown = (e: React.PointerEvent) => {
    if (!pen.on || e.button !== 0 || spaceDown) return;
    if (pen.mode === "eraser") {
      e.stopPropagation(); e.preventDefault();
      viewport.current!.setPointerCapture(e.pointerId);
      const r = viewport.current!.getBoundingClientRect(), c = camRef.current;
      const p = { x: (e.clientX - r.left - c.x) / c.z, y: (e.clientY - r.top - c.y) / c.z };
      mouse.current = p;
      drag.current = { kind: "erase", sx: e.clientX, sy: e.clientY };
      eraseAt(p);
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    viewport.current!.setPointerCapture(e.pointerId);
    const r = viewport.current!.getBoundingClientRect();
    const c = camRef.current;
    const p = { x: (e.clientX - r.left - c.x) / c.z, y: (e.clientY - r.top - c.y) / c.z };
    mouse.current = p;
    setStroke([p]);
    drag.current = { kind: "pen", sx: e.clientX, sy: e.clientY };
  };

  const onItemPointerDown = (e: React.PointerEvent, it: Item) => {
    if (e.button === 1 || spaceDown) return startPan(e);
    if (e.button === 2) { e.stopPropagation(); if (!selIds.includes(it.id)) setSelIds(withGroups([it.id])); return; }
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editing === it.id) return; // dentro del editor: seleccionar texto
    if (editing && editing !== it.id) setEditing(null);
    let ids: string[];
    if (e.shiftKey) {
      const grp = withGroups([it.id]);
      ids = selIds.includes(it.id) ? selIds.filter((x) => !grp.includes(x)) : [...new Set([...selIds, ...grp])];
      setSelIds(ids);
      return;
    }
    ids = selIds.includes(it.id) ? selIds : withGroups([it.id]);
    setSelIds(ids);
    const st = stateRef.current!;
    const movable = st.items.filter((i) => ids.includes(i.id) && !i.locked);
    if (!movable.length) return;
    viewport.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: "move", id: it.id, ids: movable.map((i) => i.id), origins: Object.fromEntries(movable.map((i) => [i.id, { x: i.x, y: i.y }])), sx: e.clientX, sy: e.clientY, base: st };
  };

  const onResizeDown = (e: React.PointerEvent, it: Item) => {
    e.stopPropagation();
    viewport.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: "resize", id: it.id, sx: e.clientX, sy: e.clientY, ow: it.w, oh: it.h, ratio: it.type === "image" ? it.h / it.w : undefined, base: stateRef.current! };
  };

  const onNodeDown = (e: React.PointerEvent, it: Item, idx: number) => {
    e.stopPropagation();
    viewport.current!.setPointerCapture(e.pointerId);
    if (it.locked) return;
    const p = it.points![idx];
    const end = isLineKind(it.shape) ? (idx === 0 ? "start" : idx === it.points!.length - 1 ? "end" : undefined) : undefined;
    drag.current = { kind: "node", id: it.id, idx, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, base: stateRef.current!, end };
    if (end) setConnDrag(true);
  };

  /** Arrastrar desde un punto de conexión de un elemento crea una flecha unida a él */
  const onAnchorDown = (e: React.PointerEvent, it: Item, side: Side) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const base = stateRef.current!;
    const a = anchor(it, side);
    const arrow: Item = { id: uid(), type: "shape", shape: "arrow", color: "#1d1d1f", x: a.x, y: a.y, w: 0, h: 0,
      points: [{ x: 0, y: 0 }, { x: 0, y: 0 }], startConn: { id: it.id, side } };
    const next = { ...base, items: [...base.items, arrow] };
    setState(next);
    stateRef.current = next;
    setSelIds([arrow.id]);
    viewport.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: "node", id: arrow.id, idx: 1, sx: e.clientX, sy: e.clientY, ox: 0, oy: 0, base, end: "end" };
    setConnDrag(true);
  };

  const onDividerDown = (e: React.PointerEvent, it: Item, idx: number) => {
    e.stopPropagation();
    viewport.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: "divider", id: it.id, idx, sx: e.clientX, sy: e.clientY, ox: it.dividers![idx], base: stateRef.current! };
  };
  const insertDivider = (id: string, f: number) => {
    const it = stateRef.current!.items.find((i) => i.id === id);
    if (!it) return;
    const d = it.dividers ?? [], segs = it.segments ?? [{ color: "#ffffff" }];
    if (f < 0.02 || f > 0.98 || d.some((v) => Math.abs(v - f) < 0.02)) return;
    const k = d.filter((v) => v < f).length; // franja que se parte
    const nd = [...d]; nd.splice(k, 0, f);
    const ns = [...segs]; ns.splice(k + 1, 0, { color: "#ffffff" });
    updateItem(id, { dividers: nd, segments: ns });
  };
  const hasContent = (sg?: { color: string; label?: string }) => !!sg && (!!sg.label?.trim() || (sg.color ?? "#ffffff").toLowerCase() !== "#ffffff");
  /** Borra la línea idx: se fusionan sus dos franjas. Avisa si las dos tienen contenido. */
  const requestDeleteDivider = (id: string, idx: number, force = false) => {
    const it = stateRef.current!.items.find((i) => i.id === id);
    if (!it?.dividers || !it.segments) return;
    const left = it.segments[idx], right = it.segments[idx + 1];
    if (!force && hasContent(left) && hasContent(right)) {
      setWarnDiv({ id, idx, label: right.label?.trim() || `Etapa ${idx + 2}` });
      return;
    }
    const keep = hasContent(left) || !hasContent(right) ? left : right;
    const segs = [...it.segments]; segs.splice(idx, 2, keep);
    updateItem(id, { dividers: it.dividers.filter((_, i) => i !== idx), segments: segs });
    setSelDiv(null);
  };
  const onEdgeDown = (e: React.PointerEvent, it: Item, fromTop: boolean) => {
    e.stopPropagation();
    const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    viewport.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: "draw", id: it.id, sx: e.clientX, sy: e.clientY, f: (e.clientX - r.left) / r.width, fromTop, base: stateRef.current! };
    setSelDiv(null);
  };
  const onSheetHandle = (e: React.PointerEvent, edge: Edge) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const s = stateRef.current!;
    if (s.sheet.locked) return;
    viewport.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: "sheet", edge, sx: e.clientX, sy: e.clientY, o: sheetRect(s.sheet), base: s };
  };
  const toggleSheetLock = () => {
    const s = stateRef.current!;
    commit({ ...s, sheet: { ...s.sheet, locked: !s.sheet.locked || undefined } });
  };


  // ---------- teclado ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement).closest("input, textarea, [contenteditable=true]");
      if (e.key === " " && !inField) { setSpaceDown(e.type === "keydown"); e.preventDefault(); return; }
      if (e.type !== "keydown") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); if (!newPostit) { setEditing(null); openNewPostit(true); } return; }
      if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); if (!newShape) { setEditing(null); openNewShape(true); } return; }
      if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); setSearch((s) => s ?? { q: "", idx: 0 }); setTimeout(() => (document.querySelector(".search-input") as HTMLInputElement | null)?.select(), 0); return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); doSave(); return; }
      if (e.key === "Escape") { setEditing(null); if (!inField) { setPen((p) => ({ ...p, on: false })); setSelIds([]); setShowKeys(false); } return; }
      if (inField) return;
      const k = e.key.toLowerCase();
      if (mod && k === "a") { e.preventDefault(); setSelIds(stateRef.current!.items.map((i) => i.id)); return; }
      if (mod && k === "d") { e.preventDefault(); duplicateSel(); return; }
      if (mod && k === "g") { e.preventDefault(); e.shiftKey ? ungroup(selIds) : group(selIds); return; }
      if (mod && k === "l") { e.preventDefault(); toggleLock(selIds); return; }
      if (mod && (e.key === "]" || e.code === "BracketRight")) { e.preventDefault(); reorder(selIds, true); return; }
      if (mod && (e.key === "[" || e.code === "BracketLeft")) { e.preventDefault(); reorder(selIds, false); return; }
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (!mod && !e.altKey && e.key.toLowerCase() === "t") { e.preventDefault(); addText(mouse.current ?? undefined); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selDiv) requestDeleteDivider(selDiv.id, selDiv.idx);
      else if (e.key === "Delete" || e.key === "Backspace") removeSelected();
      else if (e.key === "Enter" && selected) { const it = stateRef.current?.items.find((i) => i.id === selected); if (it && (it.type === "text" || it.type === "postit")) { e.preventDefault(); setEditing(selected); } }
      else if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomCenter(1.2); }
      else if (mod && e.key === "-") { e.preventDefault(); zoomCenter(1 / 1.2); }
      else if (mod && e.key === "0") { e.preventDefault(); fit(); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey); };
  });

  // pegar imágenes
  useEffect(() => {
    const inField = (t: EventTarget | null) => !!(t as HTMLElement)?.closest?.("[contenteditable=true], input, textarea");
    const onPaste = (e: ClipboardEvent) => {
      if (inField(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) { e.preventDefault(); addImages(files, mouse.current ?? undefined); return; }
      if (clip && e.clipboardData?.getData("text/plain") === CLIP_MARK) { e.preventDefault(); pasteClip(); }
    };
    const onCopy = (e: ClipboardEvent) => {
      if (inField(e.target) || !selIds.length) return;
      if (copySel()) { e.preventDefault(); e.clipboardData?.setData("text/plain", CLIP_MARK); }
    };
    const onCut = (e: ClipboardEvent) => {
      if (inField(e.target) || !selIds.length) return;
      if (copySel()) { e.preventDefault(); e.clipboardData?.setData("text/plain", CLIP_MARK); removeSelected(); }
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCut);
    return () => { window.removeEventListener("paste", onPaste); window.removeEventListener("copy", onCopy); window.removeEventListener("cut", onCut); };
  });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const r = viewport.current!.getBoundingClientRect();
    addImages(e.dataTransfer.files, { x: (e.clientX - r.left - cam.x) / cam.z, y: (e.clientY - r.top - cam.y) / cam.z });
  };

  const fit = () => state && setCam(fitCam(state.sheet, viewport.current!.getBoundingClientRect()));

  const toggleLift = (id: string) => setLifted((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const sel = state?.items.find((i) => i.id === selected);
  const view = state ? resolveLines(state.items) : [];
  // capas: lo que está «pintado» en la pizarra, encima los post-its (como en la vida real) y arriba del todo lo fijado
  const ordered = [
    ...view.filter((i) => !i.pinned && i.type !== "postit"),
    ...view.filter((i) => !i.pinned && i.type === "postit"),
    ...view.filter((i) => i.pinned),
  ];
  const matches = search?.q.trim() ? view.filter((i) => norm(itemText(i)).includes(norm(search.q.trim()))).map((i) => i.id) : [];
  const current = matches.length ? matches[((search!.idx % matches.length) + matches.length) % matches.length] : null;
  const connecting = connDrag;
  const selItems = view.filter((i) => selIds.includes(i.id));

  // centrar la cámara en el resultado de búsqueda actual
  useEffect(() => {
    if (!current) return;
    const it = stateRef.current?.items.find((i) => i.id === current);
    if (!it) return;
    const b = worldBox(it), vp = viewport.current!.getBoundingClientRect();
    setCam((c) => ({ ...c, x: vp.width / 2 - (b.x + b.w / 2) * c.z, y: vp.height / 2 - (b.y + b.h / 2) * c.z }));
  }, [current]);

  return (
    <div className="board">
      {/* barra superior */}
      <div className="topbar">
        <div className="pill">
          <button className="icon-btn" title="Volver a las pizarras" onClick={close}>‹</button>
          <div className="board-name">{meta?.name ?? "…"}</div>
          <span className={`save-dot ${saveStatus}`} title={{ saved: "Guardado", pending: "Cambios sin guardar", saving: "Guardando…", error: "Error al guardar" }[saveStatus]} />
        </div>

        <div className="pill tools">
          <button className="tool" title="Texto" onClick={() => addText()}><span className="t-ico">Aa</span>Texto</button>
          <div className="sep" />
          <button className="tool" title="Nuevo post-it (Ctrl+P)" onClick={() => openNewPostit(false)}><span className="pi-ico l" style={{ background: POSTIT_COLORS[0] }} />Post-it</button>
          <div className="sep" />
          <button className="tool" title="Nueva forma (Ctrl+E)" onClick={() => openNewShape(false)}><span className="t-ico">◇</span>Forma</button>
          <button className={`tool ${pen.on && pen.mode === "pen" ? "on" : ""}`} title="Rotulador (Esc para salir)" onClick={() => setPen((p) => ({ ...p, on: !(p.on && p.mode === "pen"), mode: "pen" }))}>
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M10.5 2.5l3 3-7.5 7.5H3v-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M3 13l-.5 1.5" stroke={pen.color} strokeWidth="2.4" strokeLinecap="round" /></svg>Rotulador</button>
          <button className={`tool ${pen.on && pen.mode === "eraser" ? "on" : ""}`} title="Goma: borra trazos del rotulador (Esc para salir)" onClick={() => setPen((p) => ({ ...p, on: !(p.on && p.mode === "eraser"), mode: "eraser" }))}>
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M6 13.5h8M2.8 9.6l6.4-6.4a1.4 1.4 0 012 0l2.6 2.6a1.4 1.4 0 010 2L8 13.5H5.6L2.8 10.7a.8.8 0 010-1.1z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M5.5 6.9l4.6 4.6" stroke="currentColor" strokeWidth="1.3" /></svg>Goma</button>
          <button className="tool" title="Imagen" onClick={() => fileInput.current?.click()}><span className="t-ico">▣</span>Imagen</button>
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { e.target.files && addImages(e.target.files); e.target.value = ""; }} />
        </div>

        <div className="pill">
          <button className="icon-btn" title="Deshacer (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>↶</button>
          <button className="icon-btn" title="Rehacer (Ctrl+Y)" disabled={!future.current.length} onClick={redo}>↷</button>
          <div className="sep" />
          <button className="icon-btn" title="Eliminar seleccionado (Supr)" disabled={!selIds.length} onClick={removeSelected}>⌫</button>
          <button className="btn small save-btn" title="Guardar (Ctrl+S)" onClick={doSave}>{saveStatus === "saved" ? "Guardado" : "Guardar"}</button>
        </div>
      </div>

      {/* barra de formato */}
      {activeEditor && <FormatBar editor={activeEditor} />}

      {/* rotulador */}
      {pen.on && pen.mode === "eraser" && (
        <div className="formatbar pill pen-bar">
          <span className="bar-label">Goma · arrastra sobre los trazos para borrarlos</span>
          <div className="sep" />
          <button className="fmt" style={{ padding: "0 10px" }} onClick={() => setPen((p) => ({ ...p, on: false }))}>Listo</button>
        </div>
      )}
      {pen.on && pen.mode === "pen" && (
        <div className="formatbar pill pen-bar">
          <span className="bar-label">Rotulador</span>
          {PEN_SIZES.map((sz) => (
            <button key={sz} className={`fmt pen-size ${pen.size === sz ? "on" : ""}`} title={`Grosor ${sz}`} onClick={() => setPen((p) => ({ ...p, size: sz }))}>
              <span style={{ width: sz + 2, height: sz + 2, background: pen.color }} />
            </button>
          ))}
          <div className="sep" />
          {PEN_COLORS.map((c) => (
            <button key={c} className={`swatch ${c === pen.color ? "on" : ""}`} style={{ background: c, margin: "0 3px" }} onClick={() => setPen((p) => ({ ...p, color: c }))} />
          ))}
          <div className="sep" />
          <button className="fmt" style={{ padding: "0 10px" }} onClick={() => setPen((p) => ({ ...p, on: false }))}>Listo</button>
        </div>
      )}

      {/* varios elementos seleccionados */}
      {!pen.on && !activeEditor && selItems.length > 1 && (
        <div className="formatbar pill">
          <span className="bar-label">{selItems.length} elementos</span>
          <div className="sep" />
          {selItems.every((i) => i.groupId && i.groupId === selItems[0].groupId)
            ? <button className="fmt" style={{ padding: "0 10px" }} onClick={() => ungroup(selIds)} title="Ctrl+Mayús+G">Desagrupar</button>
            : <button className="fmt" style={{ padding: "0 10px" }} onClick={() => group(selIds)} title="Ctrl+G">Agrupar</button>}
          <button className="fmt" style={{ padding: "0 10px" }} onClick={() => toggleLock(selIds)} title="Ctrl+L">{selItems.every((i) => i.locked) ? "Desbloquear" : "Bloquear"}</button>
          <div className="sep" />
          <button className="fmt" style={{ padding: "0 10px" }} onClick={() => reorder(selIds, true)} title="Ctrl+]">Al frente</button>
          <button className="fmt" style={{ padding: "0 10px" }} onClick={() => reorder(selIds, false)} title="Ctrl+[">Atrás</button>
          <div className="sep" />
          <button className="fmt" style={{ padding: "0 10px" }} onClick={duplicateSel} title="Ctrl+D">Duplicar</button>
        </div>
      )}

      {/* buscar */}
      {search && (
        <div className="searchbar pill">
          <svg width="14" height="14" viewBox="0 0 16 16" className="search-ico"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          <input className="search-input" autoFocus value={search.q} placeholder="Buscar en la pizarra"
            onChange={(e) => setSearch({ q: e.target.value, idx: 0 })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") setSearch((s) => s && { ...s, idx: s.idx + (e.shiftKey ? -1 : 1) });
              if (e.key === "Escape") setSearch(null);
            }} />
          <span className="search-count">{search.q.trim() ? (matches.length ? `${matches.indexOf(current!) + 1} de ${matches.length}` : "Sin resultados") : ""}</span>
          <button className="icon-btn sm" disabled={matches.length < 2} onClick={() => setSearch((s) => s && { ...s, idx: s.idx - 1 })} title="Anterior (Mayús+Intro)">‹</button>
          <button className="icon-btn sm" disabled={matches.length < 2} onClick={() => setSearch((s) => s && { ...s, idx: s.idx + 1 })} title="Siguiente (Intro)">›</button>
          <button className="np-close inline" title="Cerrar (Esc)" onClick={() => setSearch(null)} aria-label="Cerrar">
            <svg viewBox="0 0 10 10" width="8" height="8"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
      )}

      {/* ajustes de la figura seleccionada */}
      {!pen.on && !activeEditor && sel?.type === "shape" && (
        <div className="formatbar pill">
          <input key={sel.id} className="bar-name" defaultValue={sel.name ?? ""} placeholder="Nombre (opcional)"
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (sel.name ?? "")) updateItem(sel.id, { name: v || undefined }); }} />
          <div className="sep" />
          {SHAPE_COLORS.map((c) => (
            <button key={c} className={`swatch ${c === sel.color ? "on" : ""}`} style={{ background: c, margin: "0 2px" }} onClick={() => updateItem(sel.id, { color: c })} />
          ))}
          {sel.shape === "curve" && sel.points && (<>
            <div className="sep" />
            <button className="fmt" style={{ padding: "0 10px" }} onClick={() => updateItem(sel.id, { points: addNode(sel.points!) })}>＋ Nodo</button>
            <button className="fmt" style={{ padding: "0 10px" }} disabled={sel.points.length <= 3}
              onClick={() => updateItem(sel.id, { points: sel.points!.filter((_, i) => i !== Math.floor(sel.points!.length / 2)) })}>− Nodo</button>
          </>)}
        </div>
      )}

      {/* ajustes de la timeline seleccionada */}
      {!pen.on && !activeEditor && sel?.type === "timeline" && (
        <div className="formatbar pill">
          <input key={sel.id} className="bar-name" defaultValue={sel.name ?? ""} placeholder="Título"
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (sel.name ?? "")) updateItem(sel.id, { name: v }); }} />
          <div className="sep" />
          {(["top", "bottom", "none"] as const).map((k) => (
            <button key={k} className={`fmt ${(sel.titlePos ?? "top") === k ? "on" : ""}`} style={{ padding: "0 10px" }}
              onClick={() => updateItem(sel.id, { titlePos: k })}>{{ top: "Título arriba", bottom: "Abajo", none: "Oculto" }[k]}</button>
          ))}
          <div className="sep" />
          {SHAPE_COLORS.slice(0, 6).map((c) => (
            <button key={c} className={`swatch ${c === sel.color ? "on" : ""}`} style={{ background: c, margin: "0 2px" }} title="Color del borde" onClick={() => updateItem(sel.id, { color: c })} />
          ))}
          <div className="sep" />
          <button className={`fmt ${sel.pinned ? "on" : ""}`} style={{ padding: "0 10px" }} onClick={() => togglePin([sel.id])} title="Siempre por encima del resto">Siempre al frente</button>
        </div>
      )}

      {/* ajustes del post-it seleccionado */}
      {!pen.on && !activeEditor && sel?.type === "postit" && (
        <div className="formatbar pill">
          <input key={sel.id} className="bar-name" defaultValue={sel.name ?? ""} placeholder="Nombre"
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== sel.name) updateItem(sel.id, { name: v }); }} />
          <div className="sep" />
          {POSTIT_COLORS.map((c) => (
            <button key={c} className={`swatch ${c === sel.color ? "on" : ""}`} style={{ background: c, margin: "0 2px" }}
              title="Color" onClick={() => updateItem(sel.id, { color: c })} />
          ))}
          <div className="sep" />
          {(["s", "l"] as const).map((k) => (
            <button key={k} className={`fmt ${sel.w === POSTIT_SIZES[k] ? "on" : ""}`} style={{ padding: "0 10px" }}
              onClick={() => updateItem(sel.id, { w: POSTIT_SIZES[k], h: POSTIT_SIZES[k] })}>{k === "s" ? "Pequeño" : "Grande"}</button>
          ))}
          <div className="sep" />
          <button className="fmt" style={{ padding: "0 10px" }} onClick={() => toggleLift(sel.id)}>{lifted.has(sel.id) ? "Bajar" : "Levantar"}</button>
          <button className="fmt" style={{ padding: "0 10px" }} onClick={() => setEditing(sel.id)}>Editar</button>
          <button className={`fmt ${sel.pinned ? "on" : ""}`} style={{ padding: "0 10px" }} onClick={() => togglePin([sel.id])} title="Siempre por encima del resto">Siempre al frente</button>
        </div>
      )}

      {/* lienzo */}
      <div
        ref={viewport}
        className={`viewport ${spaceDown || panning ? "panning" : ""} ${pen.on ? (pen.mode === "eraser" ? "eraser-mode" : "pen-mode") : ""}`}
        onPointerDownCapture={onPenDown}
        onPointerDown={onBgPointerDown}
        onContextMenu={(e) => e.preventDefault()}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        style={{ backgroundPosition: `${cam.x}px ${cam.y}px`, backgroundSize: `${24 * cam.z}px ${24 * cam.z}px` }}
      >
        {state && (
          <div className="world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
            <div className={`sheet ${state.sheet.locked ? "locked" : ""}`} style={{ left: state.sheet.x ?? 0, top: state.sheet.y ?? 0, width: state.sheet.w, height: state.sheet.h, "--hz": 1 / cam.z } as React.CSSProperties}>
              {!state.sheet.locked && EDGES.map((ed) => <div key={ed} className={`sheet-handle ${ed}`} onPointerDown={(e) => onSheetHandle(e, ed)} />)}
              <div className="sheet-info" style={{ fontSize: 12 / cam.z }}>
                <span className="sheet-size">{state.sheet.w} × {state.sheet.h}</span>
                <button className={`sheet-lock ${state.sheet.locked ? "on" : ""}`} title={state.sheet.locked ? "Tamaño bloqueado · clic para desbloquear" : "Bloquear el tamaño de la pizarra"}
                  onPointerDown={(e) => e.stopPropagation()} onClick={toggleSheetLock}>
                  <svg viewBox="0 0 16 16" width="1.15em" height="1.15em">
                    <rect x="3" y="7" width="10" height="7.5" rx="1.8" fill="currentColor" />
                    <path d={state.sheet.locked ? "M5.2 7V5a2.8 2.8 0 015.6 0v2" : "M5.2 7V5a2.8 2.8 0 015.5-.7"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            {ordered.map((it) => (
              <div
                key={it.id}
                data-id={it.id}
                className={`item ${it.type} ${isStrokeKind(it.shape) ? "line" : ""} ${selIds.includes(it.id) ? "selected" : ""} ${editing === it.id ? "is-editing" : ""} ${it.locked ? "locked" : ""} ${matches.includes(it.id) ? (it.id === current ? "hit current" : "hit") : ""}`}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!selIds.includes(it.id)) setSelIds(withGroups([it.id])); setItemMenu({ x: e.clientX, y: e.clientY }); }}
                data-erasing={erasing.has(it.id) || undefined}
                style={{ left: it.x, top: it.y, width: it.w, height: it.type === "text" ? undefined : it.h, minHeight: it.type === "text" ? it.h : undefined,
                  clipPath: it.shape === "pen" ? sheetClip(state.sheet, it.x, it.y) : undefined }}
                onPointerDown={(e) => onItemPointerDown(e, it)}
                onDoubleClick={(e) => { e.stopPropagation(); if (it.type === "text" || it.type === "postit") setEditing(it.id); }}
              >
                {it.type === "postit" ? (
                  <div className={`postit ${lifted.has(it.id) ? "lifted" : ""}`} style={{ "--pc": it.color } as React.CSSProperties}>
                    <div className="postit-front">
                      <RichText content={it.content ?? ""} editing={editing === it.id} placeholder="Nota…"
                        onChange={(md) => updateItem(it.id, { content: md })} onFocusEditor={setActiveEditor} />
                    </div>
                    <div className="postit-back" />
                    <button className="lift-tab" title={lifted.has(it.id) ? "Bajar" : "Levantar para ver debajo"}
                      onPointerDown={(e) => e.stopPropagation()} onClick={() => toggleLift(it.id)} />
                  </div>
                ) : it.type === "text" ? (
                  <RichText content={it.content ?? ""} editing={editing === it.id} placeholder="Escribe… (# título, - lista, [ ] tarea)"
                    onChange={(md) => updateItem(it.id, { content: md })} onFocusEditor={setActiveEditor} />
                ) : it.type === "timeline" ? (
                  <div className="tl-bar" style={{ "--tc": it.color } as React.CSSProperties}>
                    {(it.segments ?? []).map((sg, i) => {
                      const edges = [0, ...(it.dividers ?? []), 1];
                      return (
                        <div key={i} className="tl-seg" style={{ width: `${(edges[i + 1] - edges[i]) * 100}%`, background: sg.color, color: sg.textColor ?? "#1d1d1f" }}
                          data-seg={i}
                          onPointerDown={(e) => { downAt.current = { x: e.clientX, y: e.clientY, sel: selected === it.id } as typeof downAt.current; }}>{sg.label}</div>
                      );
                    })}
                  </div>
                ) : it.type === "shape" ? (<>
                  <div dangerouslySetInnerHTML={{ __html: shapeSvg(it) }} />
                  {it.name && <div className="shape-name">{it.name}</div>}
                  {selected === it.id && it.points?.map((p, i) => (
                    <div key={i} className="node" style={{ left: p.x, top: p.y }} onPointerDown={(e) => onNodeDown(e, it, i)} />
                  ))}
                </>) : (
                  <BoardImage dir={dir} file={it.file!} />
                )}
                {it.type === "timeline" && (it.titlePos ?? "top") !== "none" && it.name && <div className={`tl-title ${it.titlePos ?? "top"}`}>{it.name}</div>}
                {it.type === "timeline" && selected === it.id && it.dividers?.map((f, i) => (
                  <div key={i} className={`tl-div ${selDiv?.id === it.id && selDiv.idx === i ? "on" : ""}`} style={{ left: f * it.w }}
                    title="Arrastra para mover · clic y Supr para borrar · clic derecho"
                    onPointerDown={(e) => { if (e.button === 0) onDividerDown(e, it, i); else e.stopPropagation(); }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelDiv({ id: it.id, idx: i }); setCtxMenu({ id: it.id, idx: i, x: e.clientX, y: e.clientY }); }} />
                ))}
                {it.type === "timeline" && selected === it.id && (<>
                  <div className="tl-edge top" title="Arrastra hacia abajo para crear una división" onPointerDown={(e) => onEdgeDown(e, it, true)} />
                  <div className="tl-edge bottom" title="Arrastra hacia arriba para crear una división" onPointerDown={(e) => onEdgeDown(e, it, false)} />
                </>)}
                {drawPrev?.id === it.id && (
                  <div className={`tl-draw ${drawPrev.len >= 0.6 ? "ok" : ""}`} style={{ left: drawPrev.f * it.w, height: drawPrev.len * it.h, top: drawPrev.fromTop ? 0 : undefined, bottom: drawPrev.fromTop ? undefined : 0 }} />
                )}
                {it.locked && selIds.includes(it.id) && <div className="lock-badge" title="Bloqueado (Ctrl+L)">🔒</div>}
                {((selected === it.id && !it.locked) || connecting) && connectable(it) && !pen.on && SIDES.map((sd) => {
                  const a = anchor(it, sd);
                  const off = connecting ? 0 : 16 / cam.z; // el asa se dibuja un poco por fuera para no tapar el borde
                  const ox = sd === "l" ? -off : sd === "r" ? off : 0, oy = sd === "t" ? -off : sd === "b" ? off : 0;
                  return <div key={sd} className={`anchor ${connecting ? "target" : ""}`} style={{ left: a.x - it.x + ox, top: a.y - it.y + oy }}
                    title="Arrastra para crear una flecha conectada" onPointerDown={(e) => onAnchorDown(e, it, sd)} />;
                })}
                {selected === it.id && !it.locked && it.type !== "postit" && !isStrokeKind(it.shape) && <div className="resize" onPointerDown={(e) => onResizeDown(e, it)} />}
              </div>
            ))}

            {/* guías, recuadro de selección, trazo en curso y punto de enganche */}
            {guides.v.map((x, i) => <div key={"v" + i} className="guide v" style={{ left: x, borderLeftWidth: 1 / cam.z }} />)}
            {guides.h.map((y, i) => <div key={"h" + i} className="guide h" style={{ top: y, borderTopWidth: 1 / cam.z }} />)}
            {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: 1 / cam.z }} />}
            {stroke && (
              <svg className="live-stroke" overflow="visible" width="1" height="1" style={{ clipPath: sheetClip(state.sheet) }}>
                <polyline points={stroke.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={pen.color} strokeWidth={pen.size} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {snapTarget && <div className="snap-dot" style={{ left: snapTarget.x, top: snapTarget.y, transform: `scale(${1 / cam.z})` }} />}
          </div>
        )}
      </div>

      {/* menú contextual de elementos */}
      {itemMenu && selIds.length > 0 && (
        <div className="np-bg" onPointerDown={() => setItemMenu(null)} onContextMenu={(e) => { e.preventDefault(); setItemMenu(null); }}>
          <div className="ctx items" style={{ left: Math.min(itemMenu.x, window.innerWidth - 220), top: Math.min(itemMenu.y, window.innerHeight - 330) }} onPointerDown={(e) => e.stopPropagation()}>
            {(() => {
              const go = (f: () => void) => () => { setItemMenu(null); f(); };
              const canPin = selItems.some((i) => i.type === "postit" || i.type === "timeline");
              return (<>
                <button onClick={go(() => { copySel(); })}><span>Copiar</span><kbd>Ctrl+C</kbd></button>
                <button onClick={go(duplicateSel)}><span>Duplicar</span><kbd>Ctrl+D</kbd></button>
                <hr />
                <button onClick={go(() => reorder(selIds, true))}><span>Traer al frente</span><kbd>Ctrl+]</kbd></button>
                <button onClick={go(() => reorder(selIds, false))}><span>Enviar atrás</span><kbd>Ctrl+[</kbd></button>
                {canPin && <button onClick={go(() => togglePin(selIds))}><span>{selItems.every((i) => i.pinned) ? "Quitar «siempre al frente»" : "Siempre al frente"}</span></button>}
                <hr />
                {selIds.length > 1 && !selItems.every((i) => i.groupId && i.groupId === selItems[0].groupId) && <button onClick={go(() => group(selIds))}><span>Agrupar</span><kbd>Ctrl+G</kbd></button>}
                {selItems.some((i) => i.groupId) && <button onClick={go(() => ungroup(selIds))}><span>Desagrupar</span><kbd>Ctrl+Mayús+G</kbd></button>}
                <button onClick={go(() => toggleLock(selIds))}><span>{selItems.every((i) => i.locked) ? "Desbloquear" : "Bloquear"}</span><kbd>Ctrl+L</kbd></button>
                <hr />
                <button className="danger" onClick={go(removeSelected)}><span>Eliminar</span><kbd>Supr</kbd></button>
              </>);
            })()}
          </div>
        </div>
      )}

      {/* zoom */}
      <div className="zoombar pill">
        <button className="icon-btn" onClick={() => zoomCenter(1 / 1.25)} title="Alejar (Ctrl -)">−</button>
        <button className="zoom-val" onClick={() => { const vp = viewport.current!.getBoundingClientRect(); setCam((c) => { const k = 1 / c.z; return { z: 1, x: vp.width / 2 - (vp.width / 2 - c.x) * k, y: vp.height / 2 - (vp.height / 2 - c.y) * k }; }); }} title="100%">{Math.round(cam.z * 100)}%</button>
        <button className="icon-btn" onClick={() => zoomCenter(1.25)} title="Acercar (Ctrl +)">+</button>
        <div className="sep" />
        <button className="btn small ghost" onClick={fit} title="Ajustar a la hoja (Ctrl 0)">Ajustar</button>
      </div>
      {ctxMenu && (
        <div className="np-bg" onPointerDown={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}>
          <div className="ctx" style={{ left: ctxMenu.x, top: ctxMenu.y }} onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={() => { const c = ctxMenu; setCtxMenu(null); requestDeleteDivider(c.id, c.idx); }}>Borrar línea</button>
          </div>
        </div>
      )}
      {warnDiv && (
        <div className="modal-bg" onMouseDown={() => setWarnDiv(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <h2>¿Borrar esta división?</h2>
            <p className="muted">«{warnDiv.label}» tiene nombre o color y se perderá. La etapa de la izquierda ocupará su espacio.</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setWarnDiv(null)}>Cancelar</button>
              <button className="btn danger-fill" autoFocus onClick={() => { const w = warnDiv; setWarnDiv(null); requestDeleteDivider(w.id, w.idx, true); }}>Borrar</button>
            </div>
          </div>
        </div>
      )}
      {segPop && (() => {
        const it = state?.items.find((i) => i.id === segPop.id);
        const sg = it?.segments?.[segPop.idx];
        if (!it || !sg) return null;
        const setSeg = (patch: Partial<typeof sg>) => updateItem(it.id, { segments: it.segments!.map((x, i) => (i === segPop.idx ? { ...x, ...patch } : x)) });
        return (
          <SegmentPopover key={segPop.id + segPop.idx} anchor={segPop} seg={sg} index={segPop.idx} onChange={setSeg} onClose={() => setSegPop(null)} />
        );
      })()}
      {newShape && (
        <NewShapeDialog anchor={newShape.screen} onClose={() => setNewShape(null)}
          onCreate={(sh) => { const at = newShape.world; setNewShape(null); createShape(sh, at); }} />
      )}
      {newPostit && (
        <NewPostitDialog defaultName={nextDefaultName()} anchor={newPostit.screen}
          onClose={() => setNewPostit(null)}
          onCreate={(p) => { const at = newPostit.world; setNewPostit(null); createPostit(p, at); }} />
      )}
      <button className={`keys-btn ${showKeys ? "on" : ""}`} title="Atajos de teclado" onClick={() => setShowKeys((v) => !v)}>
        <svg viewBox="0 0 20 20" width="18" height="18"><rect x="2" y="5" width="16" height="10.5" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.5 8.4h.01M8.5 8.4h.01M11.5 8.4h.01M14.5 8.4h.01M6.5 12.2h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
      </button>
      {showKeys && (
        <div className="keys-panel">
          <button className="np-close" title="Cerrar" onClick={() => setShowKeys(false)} aria-label="Cerrar">
            <svg viewBox="0 0 10 10" width="8" height="8"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
          <div className="np-seg-title">Atajos</div>
          {[
            ["Crear", [["Ctrl+P", "Post-it"], ["Ctrl+E", "Forma"], ["T", "Texto"], ["Ctrl+V", "Pegar imagen o elementos"]]],
            ["Editar", [["Ctrl+Z / Ctrl+Y", "Deshacer / rehacer"], ["Ctrl+C / X / D", "Copiar / cortar / duplicar"], ["Supr", "Eliminar"], ["Intro / Esc", "Editar / terminar"], ["Doble clic", "Editar texto"]]],
            ["Organizar", [["Ctrl+A", "Seleccionar todo"], ["Mayús+clic", "Añadir a la selección"], ["Ctrl+G", "Agrupar (Mayús: desagrupar)"], ["Ctrl+L", "Bloquear"], ["Ctrl+] / Ctrl+[", "Al frente / atrás"], ["Alt al mover", "Sin guías"]]],
            ["Ver", [["Ctrl+F", "Buscar"], ["Rueda", "Zoom"], ["Ctrl + / − / 0", "Acercar / alejar / ajustar"], ["Espacio + arrastrar", "Mover el lienzo"], ["Ctrl+S", "Guardar"]]],
          ].map(([title, rows]) => (
            <div key={title as string}>
              <div className="np-label">{title as string}</div>
              {(rows as string[][]).map(([k, v]) => <div key={k} className="key-row"><span>{v}</span><kbd>{k}</kbd></div>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SEG_COLORS = ["#ffffff", "#f2f2f7", "#ffe066", "#ffadad", "#a0e7a0", "#9bd0ff", "#d7b8ff", "#ffc78f", "#1d1d1f", "#0071e3"];

function SegmentPopover({ anchor, seg, index, onChange, onClose }: {
  anchor: { x: number; y: number }; seg: { color: string; label?: string; textColor?: string }; index: number;
  onChange: (p: { color?: string; label?: string; textColor?: string }) => void; onClose: () => void;
}) {
  const W = 320;
  const left = Math.min(Math.max(16, anchor.x + 12), window.innerWidth - W - 16);
  const top = Math.min(Math.max(70, anchor.y + 12), window.innerHeight - 300);
  return (
    <div className="np-bg" onPointerDown={onClose}>
      <div className="np seg-pop" style={{ left, top, width: W }} onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" || e.key === "Enter") onClose(); }}>
        <button className="np-close" title="Cerrar (Esc)" onClick={onClose} aria-label="Cerrar">
          <svg viewBox="0 0 10 10" width="8" height="8"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
        <div className="np-seg-title">Etapa {index + 1}</div>
        <input autoFocus className="np-name" defaultValue={seg.label ?? ""} placeholder="Texto de la etapa (opcional)" onChange={(e) => onChange({ label: e.target.value })} />
        <div className="np-label">Relleno</div>
        <div className="np-colors">
          {SEG_COLORS.map((c) => <button key={c} className={`np-color ${c === seg.color ? "on" : ""}`} style={{ background: c }} onClick={() => onChange({ color: c })} aria-label={c} />)}
        </div>
        <div className="np-label">Color del texto</div>
        <div className="np-colors">
          {["#1d1d1f", "#ffffff", "#0071e3", "#ff3b30", "#34c759"].map((c) => (
            <button key={c} className={`np-color ${c === (seg.textColor ?? "#1d1d1f") ? "on" : ""}`} style={{ background: c }} onClick={() => onChange({ textColor: c })} aria-label={c} />
          ))}
        </div>
        <div className="np-actions">
          <button className="np-create" onClick={onClose}>Listo</button>
        </div>
      </div>
    </div>
  );
}

function BoardImage({ dir, file }: { dir: string; file: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { imageUrl(dir, file).then(setUrl); }, [dir, file]);
  return url ? <img src={url} draggable={false} alt="" /> : <div className="img-missing">Imagen no encontrada</div>;
}

function FormatBar({ editor }: { editor: Editor }) {
  const [, re] = useState(0);
  useEffect(() => {
    const f = () => re((n) => n + 1);
    editor.on("transaction", f);
    return () => { editor.off("transaction", f); };
  }, [editor]);
  const b = (label: string, active: boolean, run: () => void, title: string) => (
    <button className={`fmt ${active ? "on" : ""}`} title={title} onMouseDown={(e) => { e.preventDefault(); run(); }}>{label}</button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="formatbar pill">
      {b("H1", editor.isActive("heading", { level: 1 }), () => c().toggleHeading({ level: 1 }).run(), "Título 1 (# )")}
      {b("H2", editor.isActive("heading", { level: 2 }), () => c().toggleHeading({ level: 2 }).run(), "Título 2 (## )")}
      {b("H3", editor.isActive("heading", { level: 3 }), () => c().toggleHeading({ level: 3 }).run(), "Título 3 (### )")}
      <div className="sep" />
      {b("B", editor.isActive("bold"), () => c().toggleBold().run(), "Negrita (Ctrl+B)")}
      {b("I", editor.isActive("italic"), () => c().toggleItalic().run(), "Cursiva (Ctrl+I)")}
      {b("S", editor.isActive("strike"), () => c().toggleStrike().run(), "Tachado")}
      {b("<>", editor.isActive("code"), () => c().toggleCode().run(), "Código")}
      <div className="sep" />
      {b("•", editor.isActive("bulletList"), () => c().toggleBulletList().run(), "Lista (- )")}
      {b("1.", editor.isActive("orderedList"), () => c().toggleOrderedList().run(), "Lista numerada (1. )")}
      {b("☑", editor.isActive("taskList"), () => c().toggleTaskList().run(), "Tareas ([ ] )")}
      {b("❝", editor.isActive("blockquote"), () => c().toggleBlockquote().run(), "Cita (> )")}
    </div>
  );
}
