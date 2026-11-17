import { useEffect, useState } from "react";
import { BoardSummary, createBoard, deleteBoard, duplicateBoard, listBoards, updateBoardMeta } from "./model";
import { fsx } from "./storage";

type Dialog = { kind: "new" } | { kind: "edit"; b: BoardSummary } | { kind: "delete"; b: BoardSummary } | null;

const fmt = (iso: string) => new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Menu({ onOpen }: { onOpen: (dir: string) => void }) {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [root, setRoot] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const refresh = () => listBoards().then(setBoards);
  useEffect(() => { refresh(); fsx.rootPath().then(setRoot); }, []);

  const openDialog = (d: Dialog) => {
    setDialog(d);
    if (d?.kind === "edit") { setName(d.b.name); setDesc(d.b.description); } else { setName(""); setDesc(""); }
  };

  const submit = async () => {
    if (!dialog) return;
    if (dialog.kind === "new") {
      if (!name.trim()) return;
      const dir = await createBoard(name.trim(), desc.trim());
      setDialog(null);
      onOpen(dir);
      return;
    }
    if (dialog.kind === "edit") await updateBoardMeta(dialog.b.dir, name.trim() || dialog.b.name, desc.trim());
    if (dialog.kind === "delete") await deleteBoard(dialog.b.dir);
    setDialog(null);
    refresh();
  };

  return (
    <div className="menu">
      <header className="menu-header">
        <div>
          <h1>Pizarras</h1>
          <p className="muted">Todo se guarda automáticamente en tu ordenador.</p>
        </div>
        <button className="btn primary" onClick={() => openDialog({ kind: "new" })}>＋ Nueva pizarra</button>
      </header>

      {boards && boards.length === 0 && (
        <div className="empty">
          <div className="empty-icon" />
          <p>Aún no tienes pizarras.</p>
          <button className="btn primary" onClick={() => openDialog({ kind: "new" })}>Crear la primera</button>
        </div>
      )}

      <div className="grid">
        {boards?.map((b) => (
          <div key={b.dir} className="card" onDoubleClick={() => onOpen(b.dir)}>
            <div className="card-preview" onClick={() => onOpen(b.dir)}>
              <div className="mini-sheet" />
            </div>
            <div className="card-body">
              <div className="card-title">{b.name}</div>
              <div className="card-desc">{b.description || <span className="muted">Sin descripción</span>}</div>
              <div className="card-meta">{b.itemCount} elementos · {fmt(b.updatedAt)}</div>
            </div>
            <div className="card-actions">
              <button className="btn small" onClick={() => onOpen(b.dir)}>Abrir</button>
              <button className="btn small ghost" onClick={() => openDialog({ kind: "edit", b })}>Editar</button>
              <button className="btn small ghost" onClick={async () => { await duplicateBoard(b); refresh(); }}>Duplicar</button>
              <button className="btn small ghost danger" onClick={() => openDialog({ kind: "delete", b })}>Eliminar</button>
            </div>
          </div>
        ))}
      </div>

      <footer className="menu-footer muted">Carpeta: {root}</footer>

      {dialog && (
        <div className="modal-bg" onMouseDown={() => setDialog(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            {dialog.kind === "delete" ? (
              <>
                <h2>¿Eliminar «{dialog.b.name}»?</h2>
                <p className="muted">Se borrará su carpeta con todos los post-its, textos e imágenes. No se puede deshacer.</p>
              </>
            ) : (
              <>
                <h2>{dialog.kind === "new" ? "Nueva pizarra" : "Editar pizarra"}</h2>
                <label>Nombre<input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Ideas del proyecto" /></label>
                <label>Descripción<textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="Opcional" /></label>
              </>
            )}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setDialog(null)}>Cancelar</button>
              <button className={`btn ${dialog.kind === "delete" ? "danger-fill" : "primary"}`} onClick={submit}>
                {dialog.kind === "new" ? "Crear" : dialog.kind === "edit" ? "Guardar" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
