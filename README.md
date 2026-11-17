# WhiteBoard

Pizarra blanca personal, minimalista, para Windows. Hecha con **Tauri 2 + React + TypeScript** y **TipTap** para el texto.

## Qué hace (v0.1)

- **Menú de pizarras**: crear (nombre y descripción), abrir, editar, duplicar y eliminar.
- **Lienzo infinito**: fondo gris con una hoja blanca inicial de 1920×1080 que puedes agrandar arrastrando su borde derecho, inferior o la esquina. Rueda del ratón = zoom. Por defecto el ratón es la **mano**: arrastrar el fondo mueve el lienzo y arrastrar un elemento lo mueve. Tras crear cualquier cosa se vuelve a la mano. **Touchpad**: dos dedos = desplazarse, pellizcar = zoom.
- **Texto** con formato estilo Obsidian: `# ` títulos, `**negrita**`, `*cursiva*`, `- ` listas, `1. `, `[ ] ` tareas, `> ` citas. Barra de formato al editar.
- **Post-its** de 6 colores y 2 tamaños. Se pueden **levantar** con la esquina inferior derecha para ver lo que hay debajo (siguen pegados por arriba).
- **Objetos y relaciones** (Ctrl+O): círculos con nombre (visible u oculto), atributos y clase. Las **clases** (nombre, descripción, atributos y color) se reutilizan entre objetos de la pizarra. Arrastrar desde un punto de un objeto crea una **relación** con símbolos de cardinalidad (uno, cero o uno, muchos, uno o muchos, cero o muchos, flecha) en cada extremo.
- **Imágenes**: botón Imagen, arrastrar archivos o pegar (Ctrl+V).
- **Deshacer / rehacer** (botones y Ctrl+Z / Ctrl+Y) y **guardado automático** (punto verde = guardado; Ctrl+S fuerza el guardado).

## Atajos

| Tecla | Acción |
|---|---|
| Ctrl+P | Nuevo post-it donde está el ratón (panel: nombre, tamaño y color; Intro = crear) |
| Ctrl+O | Nuevo objeto donde está el ratón |
| Ctrl+E | Nueva forma donde está el ratón (flechas, líneas, curvas, figuras, campo de texto, timeline) |
| Ctrl+F | Buscar texto en la pizarra (Intro = siguiente) |
| T | Texto donde está el ratón |
| Arrastrar el fondo · Mayús+clic | Seleccionar varios |
| Ctrl+A / Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+D | Todo / copiar / pegar / cortar / duplicar |
| Ctrl+G / Ctrl+Mayús+G | Agrupar / desagrupar |
| Ctrl+L | Bloquear / desbloquear |
| Ctrl+] / Ctrl+[ | Traer al frente / enviar atrás |
| Ctrl+Z, Ctrl+Y | Deshacer, rehacer |
| Ctrl+S | Guardar ya |
| Supr | Eliminar selección |
| Intro / Esc | Editar / terminar (Esc también vuelve a la mano) |
| Ctrl + / − / 0 | Acercar / alejar / ajustar a la hoja |
| Espacio, botón central o derecho + arrastrar | Mover el lienzo (con cualquier herramienta) |
| H / V / B | Mano / Selección (recuadro) / Rotulador |
| Mayús + arrastrar el fondo | Recuadro de selección estando con la mano |
| Alt al mover | Desactiva las guías magnéticas |

- **Flechas conectadas**: al seleccionar cualquier elemento salen 4 puntos (centro de cada lado); arrastra desde uno para crear una flecha unida. Los extremos de cualquier flecha o línea se enganchan al soltarlos cerca de un punto, y siguen al elemento al moverlo.
- **Rotulador**: botón «Rotulador», 3 grosores y 4 colores (negro, azul, verde, rojo). Solo pinta dentro de la hoja. Cada trazo se guarda como SVG. **Goma**: arrastra sobre un trazo para borrarlo.
- **Hoja**: se redimensiona desde cualquier borde o esquina (mínimo 400 × 300). Si al reducirla queda dibujo fuera, no se borra: se oculta y vuelve a verse al agrandarla. El candado junto al tamaño bloquea el redimensionado.
- **Atajos**: botón del teclado abajo a la derecha.
- **Clic derecho** sobre un elemento: copiar, duplicar, orden, «siempre al frente» (post-its y timelines), agrupar, bloquear y eliminar.

## Dónde se guarda

`Documentos\MisPizarras\<nombre-pizarra>\`

```
board.json        posiciones, tamaños, colores, hoja y cámara
postits/<id>.md   texto de cada post-it (markdown)
textos/<id>.md    cada bloque de texto (markdown)
imagenes/         las imágenes usadas
formas/<id>.svg   cada forma/flecha como SVG
objetos/<id>.md   ficha legible de cada objeto (clase y atributos)
```

## Descargar el instalador

1. En GitHub, pestaña **Actions** → workflow **Instalador Windows** → la ejecución más reciente en verde.
2. Abajo, en **Artifacts**, descarga `WhiteBoard-instalador-windows` (un .zip).
3. Dentro hay un `.exe` (recomendado) y un `.msi`. Ejecútalo. Windows puede avisar de "editor desconocido": *Más información → Ejecutar de todas formas*.

Para versiones fijas: crea una etiqueta `v0.2.0` (igual que `version` en `src-tauri/tauri.conf.json`) y el instalador aparecerá en **Releases**.

### Actualizaciones automáticas

Desde la 0.2.0, al abrir la app se comprueba si hay una Release más nueva en GitHub y aparece un aviso «Nueva versión · Actualizar». Requisitos:

- El repositorio debe ser **público** (la app descarga `latest.json` de las Releases).
- El secreto `TAURI_SIGNING_PRIVATE_KEY` debe estar en *Settings → Secrets and variables → Actions*. Sin él, el workflow compila pero no genera los archivos firmados.
- Cada versión nueva: subir `version` en `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` y `package.json`. Al fusionar en `main`, el workflow crea la Release `vX.Y.Z` automáticamente.

## Desarrollo

```
npm install
npm run tauri dev     # app de escritorio (necesita Rust)
npm run dev           # solo en el navegador, guarda en localStorage
```
