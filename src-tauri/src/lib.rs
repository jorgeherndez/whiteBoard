use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Carpeta raíz donde viven todas las pizarras: Documentos/MisPizarras
fn root_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let docs = app.path().document_dir().map_err(|e| e.to_string())?;
    let root = docs.join("MisPizarras");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

/// Resuelve una ruta relativa a la raíz impidiendo salir de ella.
fn resolve(app: &tauri::AppHandle, rel: &str) -> Result<PathBuf, String> {
    let root = root_dir(app)?;
    let rel = Path::new(rel);
    for c in rel.components() {
        match c {
            std::path::Component::Normal(_) => {}
            _ => return Err("Ruta no permitida".into()),
        }
    }
    Ok(root.join(rel))
}

#[tauri::command]
fn root_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(root_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn list_dir(app: tauri::AppHandle, path: String, dirs: bool) -> Result<Vec<String>, String> {
    let p = if path.is_empty() { root_dir(&app)? } else { resolve(&app, &path)? };
    if !p.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for e in fs::read_dir(p).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        if e.path().is_dir() == dirs {
            out.push(e.file_name().to_string_lossy().to_string());
        }
    }
    Ok(out)
}

#[tauri::command]
fn read_text(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    let p = resolve(&app, &path)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

fn write_atomic(p: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("tmp~");
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, p).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text(app: tauri::AppHandle, path: String, contents: String) -> Result<(), String> {
    write_atomic(&resolve(&app, &path)?, contents.as_bytes())
}

#[tauri::command]
fn write_base64(app: tauri::AppHandle, path: String, data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    write_atomic(&resolve(&app, &path)?, &bytes)
}

#[tauri::command]
fn read_base64(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    let p = resolve(&app, &path)?;
    if !p.exists() {
        return Ok(None);
    }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    Ok(Some(STANDARD.encode(bytes)))
}

#[tauri::command]
fn remove_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = resolve(&app, &path)?;
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

fn copy_rec(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for e in fs::read_dir(src)? {
        let e = e?;
        let to = dst.join(e.file_name());
        if e.path().is_dir() {
            copy_rec(&e.path(), &to)?;
        } else {
            fs::copy(e.path(), to)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn copy_dir(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    copy_rec(&resolve(&app, &from)?, &resolve(&app, &to)?).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            root_path, list_dir, read_text, write_text, write_base64, read_base64, remove_path, copy_dir
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar WhiteBoard");
}
