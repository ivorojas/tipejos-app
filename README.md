# Tipejos 🐾

Mascotas de escritorio con los clásicos asistentes de Microsoft Office
(Clippy, Merlin, Rover, El Genio y muchos más). Flotan en tu pantalla,
animan, reaccionan al mouse y te hacen compañía.

**50 personajes** · Windows y Mac · se actualiza solo (Windows)

---

## 📥 Descargar (para usar)

Andá a la pestaña **[Releases](../../releases/latest)** y bajá el archivo
según tu sistema.

### 🪟 Windows

1. Bajá **`Tipejos-Setup-x.x.x.exe`**
2. Doble clic → se instala solo y crea un acceso directo en el escritorio

> Windows puede mostrar un aviso de "editor desconocido" (SmartScreen).
> Es normal en apps sin firma digital de pago: **Más información → Ejecutar de todas formas**.

Una vez instalado, **se actualiza solo**: cada vez que sale una versión
nueva, la app la baja y te pregunta si querés reiniciar para aplicarla.

### 🍎 Mac

1. Bajá **`Tipejos-Mac-x.x.x.dmg`**
2. Doble clic en el `.dmg` y **arrastrá Tipejos a la carpeta Aplicaciones**
3. **La primera vez** (y solo la primera), macOS va a decir que la app es de
   un "desarrollador no identificado". Es normal: la app no está firmada
   (firmarla cuesta una cuenta de Apple paga). Para abrirla igual:
   - **Clic derecho** sobre Tipejos → **Abrir** → en el cartel, **Abrir** de nuevo.
   - Si tu Mac es nueva (macOS Sequoia o posterior) y no aparece la opción:
     andá a **Ajustes del Sistema → Privacidad y Seguridad**, bajá hasta el
     aviso sobre Tipejos y tocá **"Abrir igualmente"**.

   Después de esa primera vez, abre normal con doble clic para siempre.

> En Mac **no hay auto-update** (también requiere firma de pago). Cuando salga
> una versión nueva, volvé a [Releases](../../releases/latest) y bajá el `.dmg`
> nuevo. La app funciona igual de bien que en Windows.

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

Para publicar una versión nueva (Windows **y** Mac salen solos vía GitHub Actions):

```bash
# 1. subir el número de "version" en package.json (ej: 0.2.3 -> 0.2.4)
# 2. commitear y pushear un tag con ese número:
git commit -am "v0.2.4"
git push
git tag v0.2.4
git push origin v0.2.4
```

El push del tag dispara el workflow `.github/workflows/release.yml`, que
buildea el `.exe` (Windows) y el `.dmg` (Mac universal) en runners de GitHub
y los sube al mismo Release. No hace falta tener una Mac.

Para buildear solo Windows localmente sin publicar: `npm run dist`.

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
