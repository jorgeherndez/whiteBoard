import { useEffect, useRef, useState } from "react";
import type { ObjClass } from "./model";

export const OBJECT_COLORS = ["#0071e3", "#34c759", "#ff9f0a", "#af52de", "#ff3b30", "#5ac8fa", "#8e8e93", "#1d1d1f"];

export interface NewObject {
  name: string;
  color: string;
  classId?: string;
  newClass?: { name: string; description: string };
}

interface Props { anchor: { x: number; y: number }; classes: ObjClass[]; onCreate: (o: NewObject) => void; onClose: () => void }

const W = 360;

export default function NewObjectDialog({ anchor, classes, onCreate, onClose }: Props) {
  const [name, setName] = useState("");
  const [cls, setCls] = useState<string>(""); // "" = sin clase, "+" = nueva
  const [clsName, setClsName] = useState("");
  const [clsDesc, setClsDesc] = useState("");
  const [color, setColor] = useState(OBJECT_COLORS[0]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const pick = (id: string) => {
    setCls(id);
    const c = classes.find((k) => k.id === id);
    if (c) setColor(c.color);
  };
  const create = (over?: { cls?: string; color?: string }) => onCreate({
    name: name.trim(), color: over?.color ?? (over?.cls ? classes.find((k) => k.id === over.cls)?.color : undefined) ?? color,
    classId: (over?.cls ?? cls) && (over?.cls ?? cls) !== "+" ? over?.cls ?? cls : undefined,
    newClass: cls === "+" && clsName.trim() ? { name: clsName.trim(), description: clsDesc.trim() } : undefined,
  });
  const left = Math.min(Math.max(16, anchor.x + 16), window.innerWidth - W - 16);
  const top = Math.min(Math.max(70, anchor.y - 40), window.innerHeight - 460);

  return (
    <div className="np-bg" onPointerDown={onClose}>
      <div className="np" style={{ left, top, width: W }} onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") { e.preventDefault(); create(); } if (e.key === "Escape") onClose(); }}>
        <button className="np-close" title="Cerrar (Esc)" onClick={onClose} aria-label="Cerrar">
          <svg viewBox="0 0 10 10" width="8" height="8"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
        <input ref={input} className="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del objeto" spellCheck={false} />

        <div className="np-label">Clase</div>
        <div className="cls-chips">
          <button className={`cls-chip ${cls === "" ? "on" : ""}`} onClick={() => setCls("")} onDoubleClick={() => create({ cls: "" })} title="Doble clic para crear">Sin clase</button>
          {classes.map((c) => (
            <button key={c.id} className={`cls-chip ${cls === c.id ? "on" : ""}`} title={c.description || c.name} onClick={() => pick(c.id)} onDoubleClick={() => create({ cls: c.id })}>
              <span className="cls-dot" style={{ background: c.color }} />{c.name}
            </button>
          ))}
          <button className={`cls-chip add ${cls === "+" ? "on" : ""}`} onClick={() => setCls("+")}>＋ Nueva clase</button>
        </div>
        {cls === "+" && (
          <div className="cls-card" style={{ "--cc": color } as React.CSSProperties}>
            <div className="cls-card-head">
              <span className="cls-card-ico" />
              <input className="cls-card-name" value={clsName} onChange={(e) => setClsName(e.target.value)} placeholder="Nombre de la clase" spellCheck={false} autoFocus />
            </div>
            <textarea className="cls-card-desc" value={clsDesc} onChange={(e) => setClsDesc(e.target.value)} placeholder="Descripción (opcional)" rows={2} />
          </div>
        )}

        <div className="np-label">Color</div>
        <div className="np-colors">
          {OBJECT_COLORS.map((c) => (
            <button key={c} className={`np-color ${c === color ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} onDoubleClick={() => create({ color: c })} aria-label={c} />
          ))}
        </div>
        <div className="np-actions"><button className="np-create" onClick={() => create()}>Crear</button></div>
      </div>
    </div>
  );
}
