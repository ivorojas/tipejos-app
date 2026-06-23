#!/usr/bin/env bash
# Publica una nueva versión del pet de Android (estilo "un comando").
#
#   bash android/scripts/publish-android.sh 0.1.1 "Arreglé el sonido y tal"
#
# Hace todo:
#   1) bump versionCode (+1) y versionName en app/build.gradle.kts
#   2) compila el APK release firmado
#   3) crea el GitHub release android-v<ver> y sube el APK
#   4) actualiza latest.json y lo pushea -> las apps instaladas ven la actualización
set -euo pipefail

VER="${1:?Uso: publish-android.sh <versionName> [notas]}"
NOTES="${2:-Nueva versión $VER}"

export JAVA_HOME="C:\android-tools\jdk\jdk-17.0.19+10"
GRADLE="/c/android-tools/gradle-dist/gradle-8.7/bin/gradle"
REPO="ivorojas/tipejos-app"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"      # carpeta android/
GRADLE_FILE="$ROOT/app/build.gradle.kts"

# 1) bump versionCode (+1) y versionName
CUR_CODE=$(grep -oE 'versionCode = [0-9]+' "$GRADLE_FILE" | grep -oE '[0-9]+')
NEW_CODE=$((CUR_CODE + 1))
sed -i "s/versionCode = $CUR_CODE/versionCode = $NEW_CODE/" "$GRADLE_FILE"
sed -i "s/versionName = \"[^\"]*\"/versionName = \"$VER\"/" "$GRADLE_FILE"
echo "→ versionCode $CUR_CODE→$NEW_CODE, versionName $VER"

# 2) compilar
echo "→ compilando release..."
( cd "$ROOT" && "$GRADLE" :app:assembleRelease --no-daemon --console=plain >/dev/null )
APK_OUT="$ROOT/app/build/outputs/apk/release/app-release.apk"
APK_NAMED="$ROOT/app/build/outputs/apk/release/Tipejos-$VER.apk"
cp "$APK_OUT" "$APK_NAMED"
echo "→ APK: $APK_NAMED"

# 3) GitHub release
echo "→ publicando release android-v$VER..."
gh release create "android-v$VER" "$APK_NAMED#Tipejos-$VER.apk" \
  --repo "$REPO" --title "Android v$VER" --notes "$NOTES"

# 4) actualizar latest.json y pushear
APK_URL="https://github.com/$REPO/releases/download/android-v$VER/Tipejos-$VER.apk"
cat > "$ROOT/latest.json" <<JSON
{
  "versionCode": $NEW_CODE,
  "versionName": "$VER",
  "apkUrl": "$APK_URL",
  "notes": "$NOTES"
}
JSON
( cd "$ROOT/.." && git add android/latest.json android/app/build.gradle.kts \
  && git commit -q -m "release(android): v$VER" \
  && git push origin android-mvp )

echo "✓ Listo. Las apps instaladas van a ver la actualización a v$VER."
