# YouTube Windowed Fullscreen for Mac

macOSにおいてYouTubeの「f」キー押下時に発生する「新しい操作スペース（Space）への強制移動」を阻止し、現在のブラウザウィンドウ内のみで全画面表示を実現するChrome拡張機能です。

## 機能

- YouTubeのフルスクリーンキー（f）インターセプト
- Spaceの新規作成防止
- 擬似フルスクリーン表示（CSS固定位置）
- 入力フォーム時の通常動作保持
- ポップアップUIでON/OFF切り替え
- Escキーでの終了対応（YouTube）
- クロムレス最大化ウィンドウ（タブ・アドレスバー無しの最大化表示。Spaceを作成しない）
- **任意のサイト**（Google Drive など）への汎用対応。ポップアップUIからオリジン単位で許可／解除（YouTube は標準で有効）
  - 許可サイトでは、ページの全画面ボタンを押しても `requestFullscreen` を横取りして擬似全画面化し、**新しい Space を作らせない**（MAINワールドのコンテンツスクリプトを動的注入）
  - クロムレス最大化の切替は `⌘⇧F`

## セットアップ

### 前提条件

- Node.js 18以上
- npm または yarn

### インストール

```bash
# 依存パッケージのインストール
npm install
```

### 開発

```bash
# 開発サーバーの起動
npm run dev
```

詳細は [DEVELOPMENT.md](DEVELOPMENT.md) を参照してください。Vite HMR設定、コンテキスト無効化エラーの対応方法なども記載されています。

### ビルド

```bash
# 本番ビルド
npm run build
```

生成された `dist/` フォルダを Chrome拡張管理画面（`chrome://extensions/`）に「パッケージ化されていない拡張機能を読み込む」から追加できます。

## 技術スタック

- TypeScript 5.x
- Vite 6.x + @crxjs/vite-plugin
- Manifest Version 3 (MV3)
- CSS Modules

## ポップアップUI

- ON/OFFトグルスイッチ
- バージョン表示
- 機能説明

## テスト項目

- [ ] 「f」キー押下時にSpaceが追加されないか
- [ ] シアターモード、ミニプレーヤーモードからの遷移が正常か
- [ ] ライブ配信のチャット入力中に「f」を打っても全画面化しないか
- [ ] マルチディスプレイ環境での動作確認

## ライセンス

MIT
