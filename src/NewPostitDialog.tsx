import { useEffect, useRef, useState } from "react";
import { POSTIT_COLORS, POSTIT_SIZES } from "./model";

export interface NewPostit { name: string; size: "s" | "l"; color: string }

interface Props {
  defaultName: string;
  /** posición en pantalla junto a la que aparece (se ajusta para no salirse) */
  anchor: { x: number; y: number };
  onCreate: (p: NewPostit) => void;
  onClose: () => void;
}

const W = 340, H = 300;

export default function NewPostitDialog({ defaultName, anchor, onCreate, onClose }: Props) {
  const [name, setName] = useState(defaultName);
  const [size, setSize] = useState<"s" | "l">("l");
  const [color, setColor] = useState(POSTIT_COLORS[0]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.select(); }, []);

  const create = () => onCreate({ name: name.trim() || defaultName, size, color });

  const left = Math.min(Math.max(16, anchor.x + 16), window.innerWidth - W - 16);
  const top = Math.min(Math.max(70, anchor.y - 40), window.innerHeight - H - 16);

  return (
    <div className="np-bg" onPointerDown={onClose}>
      <div
        className="np"
        style={{ left, top, width: W }}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") { e.preventDefault(); create(); }
          if (e.key === "Escape") onClose();
        }}
      >
        <button className="np-close" title="Cerrar (Esc)" onClick={onClose} aria-label="Cerrar">
          <svg viewBox="0 0 10 10" width="8" height="8"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>

        <input ref={input} className="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del post-it" spellCheck={false} />

        <div className="np-label">Tamaño</div>
        <div className="np-sizes">
          {(["s", "l"] as const).map((k) => (
            <button key={k} className={`np-size ${size === k ? "on" : ""}`} onClick={() => setSize(k)}>
              <span className="np-size-ico" style={{ width: k === "s" ? 18 : 26, height: k === "s" ? 18 : 26, background: color }} />
              <span>{k === "s" ? "Pequeño" : "Grande"}</span>
              <span className="np-size-px">{POSTIT_SIZES[k]} px</span>
            </button>
          ))}
        </div>

        <div className="np-label">Color</div>
        <div className="np-colors">
          {POSTIT_COLORS.map((c) => (
            <button key={c} className={`np-color ${c === color ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>

        <div className="np-actions">
          <button className="np-create" onClick={create}>Crear</button>
        </div>
      </div>
    </div>
  );
}
