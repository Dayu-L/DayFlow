#!/usr/bin/env bash
set -euo pipefail

# 重新生成 assets/www、编译 Java、打包并签名 APK。
# 默认使用当前机器上的临时工具链；换机器时用环境变量覆盖：
#   JAVA_HOME=/path/to/jdk17
#   ANDROID_SDK_ROOT=/path/to/android-sdk
# 需要：JDK 17、Android SDK Build-Tools 35.0.0、platform android-35、python3。

ROOT="$(cd "$(dirname "$0")" && pwd)"
SOURCE_ROOT="${SOURCE_ROOT:-$(cd "$ROOT/.." && pwd)}"
if [ -d "$SOURCE_ROOT" ]; then SOURCE_ROOT="$(cd "$SOURCE_ROOT" && pwd)"; fi
JAVA_HOME="${JAVA_HOME:-/mnt/c/Users/llyyt/AppData/Local/DayFlowBuild/jdk}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-/mnt/c/Users/llyyt/AppData/Local/DayFlowBuild/sdk}"
BUILD_TOOLS="$ANDROID_SDK_ROOT/build-tools/35.0.0"
PLATFORM="$ANDROID_SDK_ROOT/platforms/android-35"
OUT="${OUT:-$ROOT/build}"
VERSION_NAME="${VERSION_NAME:-1.22.0}"
VERSION_CODE="${VERSION_CODE:-29}"
MIN_SDK="24"
TARGET_SDK="34"
: "${DAYFLOW_STORE_PASS:?请先设置环境变量 DAYFLOW_STORE_PASS（签名密码，不写入仓库）}"
: "${DAYFLOW_KEY_PASS:?请先设置环境变量 DAYFLOW_KEY_PASS（签名密码，不写入仓库）}"
STORE_PASS="$DAYFLOW_STORE_PASS"
KEY_PASS="$DAYFLOW_KEY_PASS"
KEYSTORE="$ROOT/keystore/dayflow-release.jks"
DIST="${DIST:-$SOURCE_ROOT/DayFlow-$VERSION_NAME.apk}"

if [ ! -x "$JAVA_HOME/bin/javac" ]; then
  echo "找不到 JDK：$JAVA_HOME" >&2
  exit 1
fi
if [ ! -x "$BUILD_TOOLS/aapt2" ]; then
  echo "找不到 Android build-tools 35.0.0：$BUILD_TOOLS" >&2
  exit 1
fi

export PATH="$JAVA_HOME/bin:$PATH"

# 把最新的 Web 版复制进 APK
rm -rf "$ROOT/assets/www"
mkdir -p "$ROOT/assets/www"
cp "$SOURCE_ROOT/index.html" "$ROOT/assets/www/"
cp -R "$SOURCE_ROOT/assets" "$SOURCE_ROOT/js" "$ROOT/assets/www/"

rm -rf "$OUT"
mkdir -p "$OUT/compiled" "$OUT/classes" "$OUT/dex" "$OUT/gen"

"$BUILD_TOOLS/aapt2" compile --dir "$ROOT/res" -o "$OUT/compiled/res.zip"
"$BUILD_TOOLS/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$PLATFORM/android.jar" \
  --manifest "$ROOT/AndroidManifest.xml" \
  -R "$OUT/compiled/res.zip" \
  -A "$ROOT/assets" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  --java "$OUT/gen" \
  --auto-add-overlay

javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options \
  -classpath "$PLATFORM/android.jar" \
  -d "$OUT/classes" \
  "$OUT/gen/com/dayflow/app/R.java" \
  "$ROOT"/src/com/dayflow/app/*.java

"$BUILD_TOOLS/d8" --lib "$PLATFORM/android.jar" --min-api "$MIN_SDK" \
  --output "$OUT/dex" "$OUT"/classes/com/dayflow/app/*.class

python3 - "$OUT" <<'PY'
import os, shutil, sys, zipfile
out = sys.argv[1]
base = os.path.join(out, 'base.apk')
withdex = os.path.join(out, 'base-with-dex.apk')
shutil.copyfile(base, withdex)
with zipfile.ZipFile(withdex, 'a', zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(out, 'dex', 'classes.dex'), 'classes.dex')
PY

"$BUILD_TOOLS/zipalign" -f 4 "$OUT/base-with-dex.apk" "$OUT/aligned.apk"

mkdir -p "$ROOT/keystore"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -noprompt \
    -keystore "$KEYSTORE" \
    -alias dayflow \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$STORE_PASS" -keypass "$KEY_PASS" \
    -dname "CN=DayFlow,O=DayFlow,C=CN"
fi

"$BUILD_TOOLS/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias dayflow \
  --ks-pass "pass:$STORE_PASS" \
  --key-pass "pass:$KEY_PASS" \
  --out "$DIST" \
  "$OUT/aligned.apk"

"$BUILD_TOOLS/apksigner" verify --verbose "$DIST" | sed -n '1,8p'
"$BUILD_TOOLS/aapt2" dump badging "$DIST" | sed -n '1,6p'
echo
echo "APK: $DIST"
