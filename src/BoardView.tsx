import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import RichText from "./RichText";
import NewPostitDialog, { NewPostit } from "./NewPostitDialog";
import NewShapeDialog, { NewShape } from "./NewShapeDialog";
import { SHAPE_COLORS, addNode, isLineKind, shapeDefaults, shapeSvg } from "./shapes";
import {
  BoardFile, BoardState, Camera, Item, POSTIT_COLORS, POSTIT_SIZES,
  cleanOrphanImages, imageUrl, loadBoard, saveBoard, storeImage, uid,
} from "./model";

const MIN_Z = 0.05, MAX_Z = 8;
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

type Drag =
  | { kind: "pan"; sx: number; sy: number; cam: Camera }
  | { kind: "move"; id: string; sx: number; sy: number; ox: number; oy: number; base: BoardState }
  | { kind: "node"; id: string; idx: number; sx: number; sy: number; ox: number; oy: number; base: BoardState }
  | { kind: "divider"; id: string; idx: number; sx: number; sy: number; ox: number; base: BoardState }
  | { kind: "draw"; id: string; sx: number; sy: number; f: number; fromTop: boolean; base: BoardState }
  | { kind: "resize"; id: string; sx: number; sy: number; ow: number; oh: number; ratio?: number; base: BoardState }
  | { kind: "sheet"; edge: "r" | "b" | "rb"; sx: number; sy: number; ow: number; oh: number; base: BoardState };

export default function BoardView({ dir, onClose }: { dir: string; onClose: () => void }) {
  const [meta, setMeta] = useState<BoardFile | null>(null);
  const [state, setState] = useState<BoardState | null>(null);
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, z: 1 });
  const [selected, setSelected] = useState<string | null>(null);
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

  const fitCam = (sheet: { w: number; h: number }, vp: DOMRect): Camera => {
    const z = clampZ(Math.min((vp.width - 160) / sheet.w, (vp.height - 200) / sheet.h));
    return { z, x: (vp.width - sheet.w * z) / 2, y: (vp.height - sheet.h * z) / 2 + 20 };
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
    force((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const f = future.current.pop();
    if (!f || !stateRef.current) return;
    past.current.push(stateRef.current);
    setState(f);
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
      await saveBoard(dir, meta, stateRef.current, camRef.current, savedMap.current);
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

  const removeSelected = () => {
    if (!selected) return;
    commit({ ...stateRef.current!, items: stateRef.current!.items.filter((i) => i.id !== selected) });
    setSelected(null);
    setEditing(null);
  };

  const bringToFront = (id: string) => {
    const s = stateRef.current!;
    const idx = s.items.findIndex((i) => i.id === id);
    if (idx < 0 || idx === s.items.length - 1) return;
    const items = [...s.items];
    const [it] = items.splice(idx, 1);
    items.push(it);
    setState({ ...s, items }); // el orden no entra en el historial
  };

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
    else if (d.kind === "move") updateItem(d.id, { x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) }, false);
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
      if (it?.points) updateItem(d.id, { points: it.points.map((p, i) => (i === d.idx ? { x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) } : p)) }, false);
    } else if (d.kind === "resize") {
      const w = Math.max(60, d.ow + dx);
      const h = d.ratio ? w * d.ratio : Math.max(40, d.oh + dy);
      updateItem(d.id, { w: Math.round(w), h: Math.round(h) }, false);
    } else if (d.kind === "sheet") {
      const s = stateRef.current!;
      const w = d.edge !== "b" ? Math.max(200, Math.round(d.ow + dx)) : d.ow;
      const h = d.edge !== "r" ? Math.max(200, Math.round(d.oh + dy)) : d.oh;
      setState({ ...s, sheet: { w, h } });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
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
    if (stateRef.current !== d.base) {
      past.current.push(d.base);
      future.current = [];
      force((n) => n + 1);
    }
  };

  const startPan = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, cam };
  };

  const onBgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    setSelected(null);
    setEditing(null);
    setSelDiv(null);
    startPan(e);
  };

  const onItemPointerDown = (e: React.PointerEvent, it: Item) => {
    if (e.button === 1 || spaceDown) return startPan(e);
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editing === it.id) return; // dentro del editor: seleccionar texto
    if (editing && editing !== it.id) setEditing(null);
    setSelected(it.id);
    bringToFront(it.id);
    viewport.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: "move", id: it.id, sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y, base: stateRef.current! };
  };

  const onResizeDown = (e: React.PointerEvent, it: Item) => {
    e.stopPropagation();
    viewport.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: "resize", id: it.id, sx: e.clientX, sy: e.clientY, ow: it.w, oh: it.h, ratio: it.type === "image" ? it.h / it.w : undefined, base: stateRef.current! };
  };

  const onNodeDown = (e: React.PointerEvent, it: Item, idx: number) => {
    e.stopPropagation();
    viewport.current!.setPointerCapture(e.pointerId);
    const p = it.points![idx];
    drag.current = { kind: "node", id: it.id, idx, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, base: stateRef.current! };
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
  const removeStage = (it: Item, idx: number) => {
    const d = [...(it.dividers ?? [])], segs = [...(it.segments ?? [])];
    if (segs.length <= 1) return;
    d.splice(idx === 0 ? 0 : idx - 1, 1);
    segs.splice(idx, 1);
    updateItem(it.id, { dividers: d, segments: segs });
  };

  const onSheetHandle = (e: React.PointerEvent, edge: "r" | "b" | "rb") => {
    e.stopPropagation();
    viewport.current!.setPointerCapture(e.pointerId);
    const s = stateRef.current!;
    drag.current = { kind: "sheet", edge, sx: e.clientX, sy: e.clientY, ow: s.sheet.w, oh: s.sheet.h, base: s };
  };

  // ---------- teclado ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement).closest("input, textarea, [contenteditable=true]");
      if (e.key === " " && !inField) { setSpaceDown(e.type === "keydown"); e.preventDefault(); return; }
      if (e.type !== "keydown") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); if (!newPostit) { setEditing(null); openNewPostit(true); } return; }
      if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); if (!newShape) { setEditing(null); openNewShape(true); } return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); doSave(); return; }
      if (e.key === "Escape") { setEditing(null); return; }
      if (inField) return;
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
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest("[contenteditable=true], input, textarea")) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) { e.preventDefault(); addImages(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const r = viewport.current!.getBoundingClientRect();
    addImages(e.dataTransfer.files, { x: (e.clientX - r.left - cam.x) / cam.z, y: (e.clientY - r.top - cam.y) / cam.z });
  };

  const fit = () => state && setCam(fitCam(state.sheet, viewport.current!.getBoundingClientRect()));

  const toggleLift = (id: string) => setLifted((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const sel = state?.items.find((i) => i.id === selected);

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
          <button className="tool" title="Nueva forma (Ctrl+F)" onClick={() => openNewShape(false)}><span className="t-ico">◇</span>Forma</button>
          <button className="tool" title="Imagen" onClick={() => fileInput.current?.click()}><span className="t-ico">▣</span>Imagen</button>
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { e.target.files && addImages(e.target.files); e.target.value = ""; }} />
        </div>

        <div className="pill">
          <button className="icon-btn" title="Deshacer (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>↶</button>
          <button className="icon-btn" title="Rehacer (Ctrl+Y)" disabled={!future.current.length} onClick={redo}>↷</button>
          <div className="sep" />
          <button className="icon-btn" title="Eliminar seleccionado (Supr)" disabled={!selected} onClick={removeSelected}>⌫</button>
          <button className="btn small" title="Guardar (Ctrl+S)" onClick={doSave}>{saveStatus === "saved" ? "Guardado" : "Guardar"}</button>
        </div>
      </div>

      {/* barra de formato */}
      {activeEditor && <FormatBar editor={activeEditor} />}

      {/* ajustes de la figura seleccionada */}
      {!activeEditor && sel?.type === "shape" && (
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
      {!activeEditor && sel?.type === "timeline" && (
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
        </div>
      )}

      {/* ajustes del post-it seleccionado */}
      {!activeEditor && sel?.type === "postit" && (
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
        </div>
      )}

      {/* lienzo */}
      <div
        ref={viewport}
        className={`viewport ${spaceDown ? "panning" : ""}`}
        onPointerDown={onBgPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        style={{ backgroundPosition: `${cam.x}px ${cam.y}px`, backgroundSize: `${24 * cam.z}px ${24 * cam.z}px` }}
      >
        {state && (
          <div className="world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
            <div className="sheet" style={{ width: state.sheet.w, height: state.sheet.h }}>
              <div className="sheet-handle r" onPointerDown={(e) => onSheetHandle(e, "r")} />
              <div className="sheet-handle b" onPointerDown={(e) => onSheetHandle(e, "b")} />
              <div className="sheet-handle rb" onPointerDown={(e) => onSheetHandle(e, "rb")} />
              <div className="sheet-size" style={{ fontSize: 12 / cam.z }}>{state.sheet.w} × {state.sheet.h}</div>
            </div>

            {state.items.map((it) => (
              <div
                key={it.id}
                className={`item ${it.type} ${isLineKind(it.shape) ? "line" : ""} ${selected === it.id ? "selected" : ""} ${editing === it.id ? "is-editing" : ""}`}
                style={{ left: it.x, top: it.y, width: it.w, height: it.type === "text" ? undefined : it.h, minHeight: it.type === "text" ? it.h : undefined }}
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
                {selected === it.id && it.type !== "postit" && !isLineKind(it.shape) && <div className="resize" onPointerDown={(e) => onResizeDown(e, it)} />}
              </div>
            ))}
          </div>
        )}
      </div>

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
      <div className="hint muted">Ctrl+P: post-it · Ctrl+F: forma · T: texto · Rueda: zoom · Arrastra el fondo o Espacio: mover · Doble clic: editar</div>
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
