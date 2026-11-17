import { useEffect, useRef, useState } from "react";
import { SHAPES, SHAPE_COLORS, ShapeKind, shapeDefaults, shapeSvg } from "./shapes";

export interface NewShape { name: string; kind: ShapeKind | "text"; color: string }

interface Props { anchor: { x: number; y: number }; onCreate: (s: NewShape) => void; onClose: () => void }

const W = 360, H = 330;

function Icon({ kind, color }: { kind: ShapeKind | "text"; color: string }) {
  if (kind === "text") return <span className="ns-text-ico" style={{ color }}>Aa</span>;
  const d = shapeDefaults(kind);
  const scale = isFinite(d.w) ? 30 / Math.max(d.w, d.h || 1) : 1;
  const pts = d.points?.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const svg = shapeSvg({ id: "i", type: "shape", x: 0, y: 0, w: d.w * scale, h: (d.h || 0) * scale, shape: kind, color, points: pts });
  return <span className="ns-ico" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function NewShapeDialog({ anchor, onCreate, onClose }: Props) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ShapeKind | "text">("arrow");
  const [color, setColor] = useState(SHAPE_COLORS[0]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const create = () => onCreate({ name: name.trim(), kind, color });
  const left = Math.min(Math.max(16, anchor.x + 16), window.innerWidth - W - 16);
  const top = Math.min(Math.max(70, anchor.y - 40), window.innerHeight - H - 16);
  const options: { kind: ShapeKind | "text"; label: string }[] = [...SHAPES, { kind: "text", label: "Campo de texto" }];

  return (
    <div className="np-bg" onPointerDown={onClose}>
      <div className="np" style={{ left, top, width: W }} onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); create(); } if (e.key === "Escape") onClose(); }}>
        <button className="np-close" title="Cerrar (Esc)" onClick={onClose} aria-label="Cerrar">
          <svg viewBox="0 0 10 10" width="8" height="8"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
        <input ref={input} className="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (opcional)" spellCheck={false} />

        <div className="np-label">Forma</div>
        <div className="ns-grid">
          {options.map((o) => (
            <button key={o.kind} className={`np-size ns-opt ${kind === o.kind ? "on" : ""}`} data-tip={o.label} aria-label={o.label} onClick={() => setKind(o.kind)}>
              <Icon kind={o.kind} color={color} />
            </button>
          ))}
        </div>

        <div className="np-label">Color</div>
        <div className="np-colors">
          {SHAPE_COLORS.map((c) => (
            <button key={c} className={`np-color ${c === color ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
        <div className="np-actions"><button className="np-create" onClick={create}>Crear</button></div>
      </div>
    </div>
  );
}
