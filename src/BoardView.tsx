import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import RichText from "./RichText";
import {
  BoardFile, BoardState, Camera, Item, POSTIT_COLORS, POSTIT_SIZES,
  cleanOrphanImages, imageUrl, loadBoard, saveBoard, storeImage, uid,
} from "./model";

const MIN_Z = 0.05, MAX_Z = 8;
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

type Drag =
  | { kind: "pan"; sx: number; sy: number; cam: Camera }
  | { kind: "move"; id: string; sx: number; sy: number; ox: number; oy: number; base: BoardState }
  | { kind: "resize"; id: string; sx: number; sy: number; ow: number; oh: number; ratio?: number; base: BoardState }
  | { kind: "sheet"; edge: "r" | "b" | "rb"; sx: number; sy: number; ow: number; oh: number; base: BoardState };

export default function BoardView({ dir, onClose }: { dir: string; onClose: () => void }) {
  const [meta, setMeta] = useState<BoardFile | null>(null);
  const [state, setState] = useState<BoardState | null>(null);
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, z: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [lifted, setLifted] = useState<Set<string>>(new Set());
  const [color, setColor] = useState(POSTIT_COLORS[0]);
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
      for (const it of state.items) if (it.type !== "image") savedMap.current.set(`${dir}/${it.type === "postit" ? "postits" : "textos"}/${it.id}.md`, it.content ?? "");
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
    if (item.type !== "image") setEditing(item.id);
  };

  const addPostit = (size: "s" | "l", at?: { x: number; y: number }) =>
    addItem({ type: "postit", w: POSTIT_SIZES[size], h: POSTIT_SIZES[size], color, content: "" }, at);
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
    mouse.current = { x: (e.clientX - r.left - c.x) / c.z, y: (e.clientY - r.top - c.y) / c.z };
    const d = drag.current;
    if (!d) return;
    const z = camRef.current.z;
    const dx = (e.clientX - d.sx) / z, dy = (e.clientY - d.sy) / z;
    if (d.kind === "pan") setCam({ ...d.cam, x: d.cam.x + (e.clientX - d.sx), y: d.cam.y + (e.clientY - d.sy) });
    else if (d.kind === "move") updateItem(d.id, { x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) }, false);
    else if (d.kind === "resize") {
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

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
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
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); doSave(); return; }
      if (e.key === "Escape") { setEditing(null); return; }
      if (inField) return;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (!mod && !e.altKey && e.key.toLowerCase() === "p") { e.preventDefault(); addPostit(e.shiftKey ? "l" : "s", mouse.current ?? undefined); }
      else if (!mod && !e.altKey && e.key.toLowerCase() === "t") { e.preventDefault(); addText(mouse.current ?? undefined); }
      else if (e.key === "Delete" || e.key === "Backspace") removeSelected();
      else if (e.key === "Enter" && selected) { const it = stateRef.current?.items.find((i) => i.id === selected); if (it && it.type !== "image") { e.preventDefault(); setEditing(selected); } }
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
          <button className="tool" title="Post-it pequeño" onClick={() => addPostit("s")}><span className="pi-ico s" style={{ background: color }} />Pequeño</button>
          <button className="tool" title="Post-it grande" onClick={() => addPostit("l")}><span className="pi-ico l" style={{ background: color }} />Grande</button>
          <div className="swatches">
            {POSTIT_COLORS.map((c) => (
              <button key={c} className={`swatch ${c === color ? "on" : ""}`} style={{ background: c }}
                onClick={() => { setColor(c); if (sel?.type === "postit") updateItem(sel.id, { color: c }); }} />
            ))}
          </div>
          <div className="sep" />
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

      {/* ajustes del post-it seleccionado */}
      {!activeEditor && sel?.type === "postit" && (
        <div className="formatbar pill">
          <span className="bar-label">Post-it</span>
          {POSTIT_COLORS.map((c) => (
            <button key={c} className={`swatch ${c === sel.color ? "on" : ""}`} style={{ background: c, margin: "0 2px" }}
              title="Color" onClick={() => { setColor(c); updateItem(sel.id, { color: c }); }} />
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
                className={`item ${it.type} ${selected === it.id ? "selected" : ""} ${editing === it.id ? "is-editing" : ""}`}
                style={{ left: it.x, top: it.y, width: it.w, height: it.type === "text" ? undefined : it.h, minHeight: it.type === "text" ? it.h : undefined }}
                onPointerDown={(e) => onItemPointerDown(e, it)}
                onDoubleClick={(e) => { e.stopPropagation(); if (it.type !== "image") setEditing(it.id); }}
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
                ) : (
                  <BoardImage dir={dir} file={it.file!} />
                )}
                {selected === it.id && it.type !== "postit" && <div className="resize" onPointerDown={(e) => onResizeDown(e, it)} />}
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
      <div className="hint muted">P: post-it en el ratón (Mayús+P grande) · T: texto · Rueda: zoom · Arrastra el fondo o Espacio: mover · Doble clic: editar</div>
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
