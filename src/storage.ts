// Acceso a disco. En la app de escritorio (Tauri) todo vive en Documentos/MisPizarras.
// En un navegador normal (desarrollo) se simula con localStorage.
import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const LS = "wb-fs:";
const lsKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(LS)).map((k) => k.slice(LS.length));

export const fsx = {
  async rootPath(): Promise<string> {
    return isTauri ? invoke("root_path") : "(navegador) localStorage";
  },
  async listDirs(path = ""): Promise<string[]> {
    if (isTauri) return invoke("list_dir", { path, dirs: true });
    const pre = path ? path + "/" : "";
    const set = new Set<string>();
    for (const k of lsKeys()) if (k.startsWith(pre) && k.slice(pre.length).includes("/")) set.add(k.slice(pre.length).split("/")[0]);
    return [...set];
  },
  async listFiles(path: string): Promise<string[]> {
    if (isTauri) return invoke("list_dir", { path, dirs: false });
    const pre = path + "/";
    return lsKeys().filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map((k) => k.slice(pre.length));
  },
  async readText(path: string): Promise<string | null> {
    if (isTauri) return invoke("read_text", { path });
    return localStorage.getItem(LS + path);
  },
  async writeText(path: string, contents: string): Promise<void> {
    if (isTauri) return invoke("write_text", { path, contents });
    localStorage.setItem(LS + path, contents);
  },
  async writeBase64(path: string, data: string): Promise<void> {
    if (isTauri) return invoke("write_base64", { path, data });
    localStorage.setItem(LS + path, data);
  },
  async readBase64(path: string): Promise<string | null> {
    if (isTauri) return invoke("read_base64", { path });
    return localStorage.getItem(LS + path);
  },
  async remove(path: string): Promise<void> {
    if (isTauri) return invoke("remove_path", { path });
    for (const k of lsKeys()) if (k === path || k.startsWith(path + "/")) localStorage.removeItem(LS + k);
  },
  async copyDir(from: string, to: string): Promise<void> {
    if (isTauri) return invoke("copy_dir", { from, to });
    for (const k of lsKeys()) if (k.startsWith(from + "/")) localStorage.setItem(LS + to + k.slice(from.length), localStorage.getItem(LS + k)!);
  },
};
