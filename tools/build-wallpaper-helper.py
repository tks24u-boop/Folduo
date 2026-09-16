#!/usr/bin/env python3
"""Android SDKとJava 17から、前面壁紙の設定補助をビルドする。端末の操作はしない。"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', default=os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT'))
    args = parser.parse_args()
    if not args.sdk:
        parser.error('ANDROID_HOME または --sdk でAndroid SDKを指定してください。')
    sdk = Path(args.sdk).expanduser().resolve()
    android = sdk / 'platforms/android-37.0/android.jar'
    if not android.is_file():
        android = sdk / 'platforms/android-37/android.jar'
    d8 = sdk / 'build-tools/36.0.0' / ('d8.bat' if os.name == 'nt' else 'd8')
    tools = Path(__file__).resolve().parent
    suffix = '.exe' if os.name == 'nt' else ''
    java_home = os.environ.get('JAVA_HOME')
    javac = str(Path(java_home) / 'bin' / ('javac' + suffix)) if java_home else shutil.which('javac')
    if not javac or not android.is_file() or not d8.is_file():
        parser.error('Java 17、Android SDK platform 37、build-tools 36.0.0 が必要です。')
    build = tools / 'build'
    build.mkdir(exist_ok=True)
    output = tools / 'cover-wallpaper-setup.jar'
    with tempfile.TemporaryDirectory(prefix='wallpaper-', dir=build) as temporary:
        temp = Path(temporary)
        classes = temp / 'classes'
        classes.mkdir()
        subprocess.run([javac, '--release', '17', '-encoding', 'UTF-8', '-cp', str(android),
                        '-d', str(classes), str(tools / 'CoverWallpaperSetup.java'),
                        str(tools.parent / 'app/src/main/java/jp/bunkaich/sukashimotion/DeviceProfile.java')], check=True)
        class_jar = temp / 'classes.jar'
        with zipfile.ZipFile(class_jar, 'w') as archive:
            for file in sorted(classes.rglob('*.class')):
                archive.write(file, file.relative_to(classes).as_posix())
        dex_jar = temp / 'cover-wallpaper-setup.jar'
        subprocess.run([str(d8), '--release', '--min-api', '33', '--lib', str(android),
                        '--output', str(dex_jar), str(class_jar)], check=True)
        with zipfile.ZipFile(dex_jar, 'a') as archive:
            if 'classes.dex' not in archive.namelist():
                raise RuntimeError('D8の出力にclasses.dexがありません。')
            archive.write(tools.parent / 'LICENSE', 'META-INF/LICENSE')
        shutil.copy2(dex_jar, output)
    print('生成しました:', output)


if __name__ == '__main__':
    main()
