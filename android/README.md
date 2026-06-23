# Tipejos — Android (MVP)

Mascota flotante que vive **encima de las demás apps** de Android, igual que la versión de escritorio pero nativa (Kotlin, sin Electron).

## Qué hace este MVP

- 🐾 **Overlay sobre otras apps** (permiso `SYSTEM_ALERT_WINDOW`) sostenido por un **foreground service** con notificación persistente (tocás la notif → abre la app).
- ✋ **Arrastre con el dedo**.
- 🎾 **Fling con rebote**: la tirás y rebota entre los 4 bordes de la pantalla, perdiendo energía por fricción.
- 👇 **Long-press**: animación de squash + menú flotante (Sonido on/off · Ajustes · Quitar mascota).
- 👆 **Tap**: el personaje hace un truco (animación al azar).
- 🎭 **12 personajes famosos** con animación real (sprites extraídos de los `agent.js` del escritorio).

## Estructura

```
android/
  app/src/main/
    AndroidManifest.xml        permisos + service
    java/com/tipejos/pet/
      MainActivity.kt          permisos + grilla para elegir personaje
      PetOverlayService.kt     ventana flotante + física de rebote + notificación + menú
      PetView.kt               dibuja/animа el sprite + detecta gestos
      CharacterRepo.kt         carga map.png + frames.json desde assets
    res/                       layouts, tema, iconos
    assets/agents/<Name>/      map.png, thumb.png, frames.json  (generados)
  scripts/extract-assets.js    regenera los assets desde ../assets/agents
```

## Cómo compilar el APK

Este proyecto **no se compila con lo que hay instalado hoy** (hace falta el SDK de Android + JDK 17). El camino más simple:

1. Instalá **Android Studio** (trae JDK, Gradle y descarga el SDK solo).
2. `File → Open` → elegí la carpeta `android/`.
3. Esperá el **Gradle sync** (descarga dependencias + genera el wrapper la primera vez).
4. Conectá el celu con **depuración USB** y dale **Run ▶**, o `Build → Build APK(s)` para sacar el `.apk` e instalarlo a mano.

### Regenerar los assets de personajes

```
node android/scripts/extract-assets.js
```

Edita la lista `WANT` en el script para sumar/quitar personajes.

## Permisos que pedirá en el celu

- **Mostrar sobre otras apps** (overlay) — obligatorio, se activa a mano la primera vez.
- **Notificaciones** (Android 13+) — para la notif persistente del service.

## Limitaciones conocidas del MVP

- El **sonido** todavía no suena (el toggle ya está, falta enganchar el audio).
- Sin **sincronización** con la versión de escritorio (es app aparte, a propósito).
- Android puede **matar el service** en segundo plano (battery optimizers de Xiaomi/Samsung/etc.) — robustez pendiente.
