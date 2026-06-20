# Tipejos 🐾

Mascotas de escritorio con los clásicos asistentes de Microsoft Office
(Clippy, Merlin, Rover, El Genio y muchos más). Flotan en tu pantalla,
animan, reaccionan al mouse y te hacen compañía.

**50 personajes** · Windows · se actualiza solo

---

## 📥 Descargar (para usar)

1. Andá a la pestaña **[Releases](../../releases/latest)**
2. Bajá el archivo **`Tipejos-Setup-x.x.x.exe`**
3. Doble clic → se instala solo y crea un acceso directo en el escritorio

> Windows puede mostrar un aviso de "editor desconocido" (SmartScreen).
> Es normal en apps sin firma digital de pago: **Más información → Ejecutar de todas formas**.

Una vez instalado, **se actualiza solo**: cada vez que sale una versión
nueva, la app la baja y te pregunta si querés reiniciar para aplicarla.

## 🎮 Uso

- **Doble clic en el ícono de la bandeja** (la flechita ▲ abajo a la derecha) → abre Ajustes
- **Clic derecho en el muñeco** → cambiar personaje, agregar otro, salir
- **Arrastrá** al muñeco para moverlo por la pantalla
- En **Ajustes**: agregar varias mascotas, buscador de personajes,
  tamaño / opacidad, sonido, comportamiento y arranque con Windows

## 🛠️ Desarrollo

```bash
npm install
npm start          # correr en modo desarrollo
npm run dist       # generar el instalador en dist/
```

Para publicar una versión nueva (se actualiza sola en todas las compus):

```bash
# 1. subir el número de "version" en package.json (ej: 0.1.0 -> 0.1.1)
# 2. build + publish a GitHub Releases:
$env:GH_TOKEN = (gh auth token)
npx electron-builder --publish always
```

## Personajes

Clippy · Merlin · Rover · Bonzi · Peedy · Genie · F1 · Rocky · Links · Genius
y 41 más (Dolphin, Robby, Scribble, Santa, Earl, Becky...).

## Nota legal

El **código** es libre (MIT). Los **sprites y sonidos** son propiedad de
Microsoft (y Bonzi, de Bonzi Software). Se incluyen para uso **personal,
educativo y nostálgico**. No los uses en un producto comercial.

---

Hecho con [Electron](https://www.electronjs.org/). Personajes basados en
Microsoft Agent / ClippyJS.
