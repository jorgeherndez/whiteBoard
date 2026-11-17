import { useEffect, useState } from "react";

type Up = { version: string; install: (onProgress: (p: number) => void) => Promise<void> };

/** Al abrir la app comprueba si hay una versión nueva en GitHub Releases y ofrece instalarla. */
export default function Updater() {
  const [up, setUp] = useState<Up | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const { relaunch } = await import("@tauri-apps/plugin-process");
        const u = await check();
        if (!u) return;
        setUp({
          version: u.version,
          install: async (onProgress) => {
            let total = 0, done = 0;
            await u.downloadAndInstall((ev) => {
              if (ev.event === "Started") total = ev.data.contentLength ?? 0;
              if (ev.event === "Progress") { done += ev.data.chunkLength; if (total) onProgress(done / total); }
            });
            await relaunch();
          },
        });
      } catch (e) {
        console.warn("No se pudo comprobar si hay actualizaciones", e);
      }
    })();
  }, []);

  if (!up || hidden) return null;
  return (
    <div className="update-toast">
      <div>
        <div className="update-title">Nueva versión {up.version}</div>
        <div className="update-sub">{progress === null ? "Tus pizarras no se tocan." : `Descargando… ${Math.round(progress * 100)}%`}</div>
      </div>
      {progress === null && (<>
        <button className="btn small ghost" onClick={() => setHidden(true)}>Más tarde</button>
        <button className="btn small primary" onClick={() => { setProgress(0); up.install(setProgress).catch(() => setProgress(null)); }}>Actualizar</button>
      </>)}
    </div>
  );
}
