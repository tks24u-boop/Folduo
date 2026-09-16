# Folduo SM-F966Q 実験版

対象候補：Samsung SM-F966Q / SM-F966Z、Android 16（SDK 36）。
Q版の実機動作は未検証です。ユーザー端末のOne UIは8.5です。
元コード：bunkaich/Folduo c9e5976cf1d5176652fcf0fc984bb5ec86751d29。

## 改修
- 起動UI・画面制御・壁紙補助・明示的実機テストで共通の機種判定を使用。
- Samsungが公開する同時点灯状態・論理画面0/1の既存確認を維持。
- 壁紙statusに内側動画、純正画像素材、変更/復元APIの診断を追加。
- 復元APIまたは純正画像がない場合は壁紙を変更しない。
- 壁紙補助は所有者ユーザー0だけで実行。
- 直接センサーが1500ms途切れた場合、壁紙からの角度取得へ切替可能。
- 解像度0/負値/非有限/10度以上のセンサーを細角度とは扱わない。
- アプリ移動・履歴選択・復帰時の起動失敗を検出。
- 描画・タッチ遮断・ロック/停止時の解除・監視タイマーは維持。

## ビルド
Java 17、Python 3、Android SDKが必要です。
SDK：platforms;android-37.0、build-tools;36.0.0、platform-tools。
JAVA_HOME / ANDROID_HOMEを設定し、次を実行します。

```sh
./gradlew :app:testDebugUnitTest :app:lintRelease :app:assembleRelease
python3 tools/build-wallpaper-helper.py
```

APK：app/build/outputs/apk/release/app-release.apk。
GitHub Actionsの「Folduo Q experimental build」でも生成できます。
実機テストは自動ビルドの単体テストとは別で、まだ実施していません。

## 導入
先に元のREADME.ja.mdを読んでください。
1. Shizukuを起動。元の壁紙画像・設定を手元に保存します。
2. 内側と前面に、元READMEで指定されたSamsung純正壁紙を設定。
3. MacにPython 3とADBを用意し、USBデバッグを許可して端末を1台接続。
4. 壁紙補助ZIPを展開し、その中のwallpaperフォルダで次を実行。

```sh
python3 cover-wallpaper.py status
```

型番/SDK、Inner angle wallpaper、Stock image resource、Exact apply/restore APIを確認。
statusは壁紙設定を変更しません（補助JARは端末の一時フォルダへ転送します）。
この結果だけで演出全体の互換性が確認できるわけではありません。
falseやエラーが出た場合は適用せず、その診断結果を確認してください。

5. 診断が揃った場合のみ次を実行。

```sh
python3 cover-wallpaper.py apply
```

6. APKを入れ、Shizuku接続・重ねて表示・通知を許可。
7. センサー診断後に有効化し、ロック解除したまま一度完全に閉じてから電卓でゆっくり開閉。

## 署名
元作者と同じapplicationIdですが署名は異なります。元作者版を入れている場合は
アプリ内で停止してからアンインストールし、この版を導入してください。
設定や権限は再設定が必要です。アンインストールだけでは壁紙は戻りません。
これはデバッグ鍵で署名したテスト版です。GitHub Actionsの別実行では署名鍵が変わるため、
その場合も上書き不可となり、停止・アンインストール後の再導入が必要です。

## 停止と復旧
アプリ内の停止を押します。操作不能なら端末を再起動し、
Shizukuを起動する前にFolduoの常時有効を止めてください。
壁紙はAndroid設定で選び直せます。既知の純正静止壁紙に戻す場合は次を使用できます。

```sh
python3 cover-wallpaper.py restore-stock
```

## 未確認事項
- Samsungの完全な壁紙API署名は実機未確認。不一致の場合は変更を拒否します。
- ベンダーセンサー65686の解像度0は、細かな値を出せても粗いセンサーとして扱います。
  Q版のメタデータ確認までは純正壁紙による角度取得が必要です。
- Q版での両画面同時点灯、連続角度、画面転送、ホーム/戻る/履歴、回転、
  ロック、Shizuku停止、再起動、壁紙復元、長時間の電池消費は実機確認が必要です。

## 壁紙補助 q2（実機ログに基づく修正）
- 004番のFoldInteractiveから細角度が返ることをユーザー端末ログで確認。
  ただし外側への適用・演出全体は未確認です。
- 002番に加え、video_004.mp4 と sub_wallpaper_004 の組を明示対応。
- 内側と外側が同じ組の純正壁紙である場合だけ適用。任意壁紙は上書きしません。
- 純正URIの拡張子なし／.pngの両形式を認識。復元は現在の外側動画と同じ番号。
- statusに実際の動画名・コンポーネント・外側URIを表示。
- APKの入れ直しは不要。別成果物 Folduo-wallpaper-helper-q2 を展開し、
  そのwallpaper/cover-wallpaper.pyでstatusを実行、対応確認後applyを実行します。
- Folduoは停止してから適用。非表示の壁紙ログを有効角度として採用する変更はしません。
