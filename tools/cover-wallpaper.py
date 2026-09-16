#!/usr/bin/env python3
"""検証済みFold7の前面ホーム壁紙を設定する。操作を省略すると確認だけ行う。"""
import argparse
import shlex
import shutil
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'apply', 'restore-stock'], nargs='?', default='status')
    parser.add_argument('--adb', default=shutil.which('adb'))
    parser.add_argument('--serial', help='複数接続されている場合の対象端末')
    args = parser.parse_args()
    if not args.adb:
        parser.error('--adb でAndroidのadbを指定してください。')
    if not args.serial:
        result = subprocess.run([args.adb, 'devices'], check=True, capture_output=True, text=True, timeout=15)
        devices = [line.split()[0] for line in result.stdout.splitlines()[1:]
                   if len(line.split()) == 2 and line.split()[1] == 'device']
        if len(devices) != 1:
            parser.error('端末を一台だけ接続するか、--serial を指定してください。')
        args.serial = devices[0]
    base = [args.adb, '-s', args.serial]
    current_user = subprocess.run(base + ['shell', 'am', 'get-current-user'],
                                  check=True, capture_output=True, text=True, timeout=15).stdout.strip()
    if current_user != '0':
        parser.error('This helper requires the owner Android user (0).')
    jar = Path(__file__).with_name('cover-wallpaper-setup.jar')
    if not jar.is_file():
        parser.error('cover-wallpaper-setup.jarが見つかりません。先に tools/build-wallpaper-helper.py を実行してください。')
    remote = '/data/local/tmp/foldthrough-cover-wallpaper-setup.jar'
    subprocess.run(base + ['push', str(jar), remote], check=True, timeout=30)
    command = f'CLASSPATH={shlex.quote(remote)} app_process /system/bin CoverWallpaperSetup {shlex.quote(args.action)}'
    subprocess.run(base + ['shell', command], check=True, timeout=30)


if __name__ == '__main__':
    main()
