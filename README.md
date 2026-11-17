# WhiteBoard

Pizarra blanca personal, minimalista, para Windows. Hecha con **Tauri 2 + React + TypeScript** y **TipTap** para el texto.

## Qué hace (v0.1)

- **Menú de pizarras**: crear (nombre y descripción), abrir, editar, duplicar y eliminar.
- **Lienzo infinito**: fondo gris con una hoja blanca inicial de 1920×1080 que puedes agrandar arrastrando su borde derecho, inferior o la esquina. Rueda del ratón = zoom; arrastrar el fondo, botón central o Espacio = mover.
- **Texto** con formato estilo Obsidian: `# ` títulos, `**negrita**`, `*cursiva*`, `- ` listas, `1. `, `[ ] ` tareas, `> ` citas. Barra de formato al editar.
- **Post-its** de 6 colores y 2 tamaños. Se pueden **levantar** con la esquina inferior derecha para ver lo que hay debajo (siguen pegados por arriba).
- **Imágenes**: botón Imagen, arrastrar archivos o pegar (Ctrl+V).
- **Deshacer / rehacer** (botones y Ctrl+Z / Ctrl+Y) y **guardado automático** (punto verde = guardado; Ctrl+S fuerza el guardado).

## Atajos

| Tecla | Acción |
|---|---|
| Ctrl+P | Nuevo post-it donde está el ratón (panel: nombre, tamaño y color; Intro = crear) |
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
| Intro / Esc | Editar / terminar (Esc también sale del rotulador) |
| Ctrl + / − / 0 | Acercar / alejar / ajustar a la hoja |
| Espacio, botón central o derecho + arrastrar | Mover el lienzo |
| Alt al mover | Desactiva las guías magnéticas |

- **Flechas conectadas**: al seleccionar cualquier elemento salen 4 puntos (centro de cada lado); arrastra desde uno para crear una flecha unida. Los extremos de cualquier flecha o línea se enganchan al soltarlos cerca de un punto, y siguen al elemento al moverlo.
- **Rotulador**: botón «Rotulador», 3 grosores y 4 colores (negro, azul, verde, rojo). Cada trazo se guarda como SVG.
- **Clic derecho** sobre un elemento: copiar, duplicar, orden, «siempre al frente» (post-its y timelines), agrupar, bloquear y eliminar.

## Dónde se guarda

`Documentos\MisPizarras\<nombre-pizarra>\`

```
board.json        posiciones, tamaños, colores, hoja y cámara
postits/<id>.md   texto de cada post-it (markdown)
textos/<id>.md    cada bloque de texto (markdown)
imagenes/         las imágenes usadas
formas/<id>.svg   cada forma/flecha como SVG
```

## Descargar el instalador

1. En GitHub, pestaña **Actions** → workflow **Instalador Windows** → la ejecución más reciente en verde.
2. Abajo, en **Artifacts**, descarga `WhiteBoard-instalador-windows` (un .zip).
3. Dentro hay un `.exe` (recomendado) y un `.msi`. Ejecútalo. Windows puede avisar de "editor desconocido": *Más información → Ejecutar de todas formas*.

Para versiones fijas: crea una etiqueta `v0.1.0` y el instalador aparecerá en **Releases**.

## Desarrollo

```
npm install
npm run tauri dev     # app de escritorio (necesita Rust)
npm run dev           # solo en el navegador, guarda en localStorage
```
