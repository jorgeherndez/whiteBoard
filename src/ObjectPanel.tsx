import { useState } from "react";
import { Attr, Item, ObjClass, objectAttrs, uid } from "./model";
import { OBJECT_COLORS } from "./NewObjectDialog";

interface Props {
  item: Item;
  classes: ObjClass[];
  /** Cambia el objeto y/o la lista de clases en un solo paso (un único deshacer) */
  update: (patch?: Partial<Item>, classes?: ObjClass[]) => void;
  onClose: () => void;
  classUsers: number; // objetos que usan su clase
}

const stop = (e: React.KeyboardEvent) => {
  e.stopPropagation();
  if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") (e.target as HTMLInputElement).blur();
  if (e.key === "Escape") (e.target as HTMLInputElement).blur();
};

export default function ObjectPanel({ item, classes, classUsers, update, onClose }: Props) {
  const cls = classes.find((c) => c.id === item.classId);
  const attrs = objectAttrs(item, classes);
  const users = classUsers;
  const [newCls, setNewCls] = useState<{ name: string; description: string } | null>(null);

  const setValue = (key: string, value: string) => {
    const own = [...(item.attrs ?? [])];
    const i = own.findIndex((a) => a.key === key);
    if (i >= 0) own[i] = { key, value }; else own.push({ key, value });
    update({ attrs: own });
  };
  const renameOwn = (old: string, key: string) => {
    if (!key || key === old || attrs.some((a) => a.key === key)) return;
    update({ attrs: (item.attrs ?? []).map((a) => (a.key === old ? { ...a, key } : a)) });
  };
  const freeKey = () => { let n = attrs.length + 1; while (attrs.some((a) => a.key === `atributo${n}`)) n++; return `atributo${n}`; };
  const addOwn = () => update({ attrs: [...(item.attrs ?? []), { key: freeKey(), value: "" }] });
  const addToClass = () => cls && update(undefined, classes.map((c) => (c.id === cls.id ? { ...c, attrs: [...c.attrs, freeKey()] } : c)));
  const removeAttr = (a: Attr & { fromClass: boolean }) => {
    const own = (item.attrs ?? []).filter((o) => o.key !== a.key);
    if (a.fromClass && cls) update({ attrs: own }, classes.map((c) => (c.id === cls.id ? { ...c, attrs: c.attrs.filter((k) => k !== a.key) } : c)));
    else update({ attrs: own });
  };
  const renameClassAttr = (old: string, key: string) => {
    if (!cls || !key || key === old || attrs.some((a) => a.key === key)) return;
    update({ attrs: (item.attrs ?? []).map((a) => (a.key === old ? { ...a, key } : a)) },
      classes.map((c) => (c.id === cls.id ? { ...c, attrs: c.attrs.map((k) => (k === old ? key : k)) } : c)));
  };
  const patchClass = (p: Partial<ObjClass>) => cls && update(undefined, classes.map((c) => (c.id === cls.id ? { ...c, ...p } : c)));
  const createClass = () => {
    if (!newCls?.name.trim()) return;
    const c: ObjClass = { id: uid(), name: newCls.name.trim(), description: newCls.description.trim(), color: item.color ?? OBJECT_COLORS[0], attrs: attrs.map((a) => a.key) };
    update({ classId: c.id }, [...classes, c]);
    setNewCls(null);
  };

  return (
    <div className="np obj-panel" onPointerDown={(e) => e.stopPropagation()} onKeyDown={stop}>
      <button className="np-close" title="Cerrar" onClick={onClose} aria-label="Cerrar">
        <svg viewBox="0 0 10 10" width="8" height="8"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      <div className="np-label" style={{ marginTop: 0 }}>Objeto</div>
      <div className="obj-row">
        <input key={item.id + (item.name ?? "")} className="np-name" defaultValue={item.name ?? ""} placeholder="Nombre" spellCheck={false}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (item.name ?? "")) update({ name: v || undefined }); }} />
        <button className={`obj-eye ${item.hideName ? "" : "on"}`} title={item.hideName ? "Nombre oculto · clic para mostrarlo" : "Nombre visible · clic para ocultarlo"}
          onClick={() => update({ hideName: !item.hideName || undefined })}>
          <svg viewBox="0 0 20 20" width="18" height="18"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="10" cy="10" r="2.6" fill="currentColor" />{item.hideName && <path d="M3.5 3.5l13 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}</svg>
        </button>
      </div>

      <div className="np-label">Clase</div>
      <div className="cls-chips">
        <button className={`cls-chip ${!item.classId && !newCls ? "on" : ""}`} onClick={() => { setNewCls(null); update({ classId: undefined }); }}>Sin clase</button>
        {classes.map((c) => (
          <button key={c.id} className={`cls-chip ${item.classId === c.id && !newCls ? "on" : ""}`} title={c.description || c.name}
            onClick={() => { setNewCls(null); update({ classId: c.id, color: c.color }); }}>
            <span className="cls-dot" style={{ background: c.color }} />{c.name}
          </button>
        ))}
        <button className={`cls-chip add ${newCls ? "on" : ""}`} onClick={() => setNewCls({ name: "", description: "" })}>＋ Nueva</button>
      </div>
      {newCls && (
        <div className="cls-card" style={{ "--cc": item.color ?? "#0071e3" } as React.CSSProperties}>
          <input className="cls-card-name" autoFocus value={newCls.name} placeholder="Nombre de la clase" onChange={(e) => setNewCls({ ...newCls, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); createClass(); } }} />
          <textarea className="cls-card-desc" rows={2} value={newCls.description} placeholder="Descripción (opcional)" onChange={(e) => setNewCls({ ...newCls, description: e.target.value })} />
          <div className="cls-card-foot">
            <span>Los atributos actuales pasarán a la clase</span>
            <button className="np-create small" onClick={createClass}>Crear clase</button>
          </div>
        </div>
      )}
      {cls && !newCls && (
        <div className="cls-card" style={{ "--cc": cls.color } as React.CSSProperties}>
          <div className="cls-card-head">
            <span className="cls-card-ico" />
            <input key={cls.id + cls.name} className="cls-card-name" defaultValue={cls.name} title="Nombre de la clase (afecta a todos sus objetos)"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== cls.name) patchClass({ name: v }); }} />
          </div>
          <textarea key={cls.id + cls.description} className="cls-card-desc" rows={2} defaultValue={cls.description} placeholder="Añade una descripción…"
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== cls.description) patchClass({ description: v }); }} />
          <div className="cls-card-foot">
            <span>{users} objeto{users === 1 ? "" : "s"} · {cls.attrs.length} atributo{cls.attrs.length === 1 ? "" : "s"}</span>
            <span className="cls-card-colors">
              {OBJECT_COLORS.slice(0, 6).map((c) => (
                <button key={c} className={`cls-mini ${c === cls.color ? "on" : ""}`} style={{ background: c }} title="Color de la clase"
                  onClick={() => update({ color: c }, classes.map((k) => (k.id === cls.id ? { ...k, color: c } : k)))} />
              ))}
            </span>
          </div>
        </div>
      )}

      <div className="np-label">Atributos</div>
      {attrs.length === 0 && <div className="np-hint">Sin atributos todavía.</div>}
      {attrs.map((a, i) => (
        <div key={item.id + i + a.key} className="attr-row">
          <input className={`attr-key ${a.fromClass ? "cls" : ""}`} defaultValue={a.key} title={a.fromClass ? "Atributo de la clase" : "Atributo propio"}
            onBlur={(e) => (a.fromClass ? renameClassAttr : renameOwn)(a.key, e.target.value.trim())} />
          <input className="attr-val" defaultValue={a.value} placeholder="valor" onBlur={(e) => { if (e.target.value !== a.value) setValue(a.key, e.target.value); }} />
          <button className="attr-del" title={a.fromClass ? "Quitar de la clase (todos sus objetos)" : "Quitar atributo"} onClick={() => removeAttr(a)}>×</button>
        </div>
      ))}
      <div className="attr-actions">
        <button className="fmt" onClick={addOwn}>＋ Atributo</button>
        {cls && <button className="fmt" onClick={addToClass}>＋ Atributo de la clase</button>}
      </div>
      <label className="obj-check"><input type="checkbox" checked={!!item.showAttrs} onChange={(e) => update({ showAttrs: e.target.checked || undefined })} />Mostrar atributos en el círculo</label>

      <div className="np-label">Color</div>
      <div className="np-colors">
        {OBJECT_COLORS.map((c) => (
          <button key={c} className={`np-color ${c === item.color ? "on" : ""}`} style={{ background: c }} onClick={() => update({ color: c })} aria-label={c} />
        ))}
      </div>
    </div>
  );
}
