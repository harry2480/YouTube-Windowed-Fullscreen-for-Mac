# 開発ガイド

## Vite開発環境でのセットアップ

### 開発サーバーの起動

```bash
npm run dev
```

Viteサーバーが `http://localhost:5173` で起動します。

### 拡張機能の読み込み

1. Chromeを開き、`chrome://extensions/` にアクセス
2. **開発者モード**を有効化（右上のトグル）
3. **パッケージ化されていない拡張機能を読み込む**をクリック
4. プロジェクトルートの `dist/` フォルダを選択

### HMRとコンテキスト無効化への対応

**重要:** Chrome拡張機能ではViteのHMR（Hot Module Replacement）をContentScriptで使用することができません。CORSポリシーとコンテキスト無効化によって、`/@vite/env` や `/@vite/client` へのアクセスが拒否されるため、HMRはContentScriptで意図的に無効化されています。

このプロジェクトは以下の対策を実装しています：

#### 1. Viteサーバー設定 (`vite.config.ts`)

```typescript
server: {
  hmr: {
    protocol: 'ws',
    host: 'localhost',
    port: 5173
  }
}
```

- WebSocket HMR接続は設定していますが、ContentScriptではViteクライアントを読み込まないよう実装している
- CORSエラーを避けるため、ContentScriptに `import.meta.hot` を使用しない

#### 2. コンテンツスクリプトの設計

- ContentScriptからは `import.meta.hot` を削除（HMRはContentScriptで非対応）
- エラーハンドリングでコンテキスト無効化に対応
- クリーンアップ関数で安全にリソースを解放

### 開発時に発生する可能性のある問題と対応

#### CORSエラーが発生する場合

**症状:**
```
Access to XMLHttpRequest at 'http://localhost:5173/@vite/env' from origin 
'chrome-extension://...' has been blocked by CORS policy
```

**原因と対応:**

- このエラーは、HMRクライアントコードがContentScriptで実行されようとしているときに発生します
- このプロジェクトではContentScriptでHMRを使用しないよう設計しているため、発生しません
- もし発生した場合は、以下を確認してください：
  - ContentScriptで `import.meta.hot` を使用していないか
  - Viteサーバーが起動しているか確認
  - ブラウザコンソール（DevTools）でエラーメッセージを確認

#### 拡張機能コンテキスト無効化エラー

**症状:**
```
Uncaught Error: Extension context invalidated.
```

**原因:**
- 拡張機能がChrome上で再読み込みされた
- 古いコンテキストを参照しようとしている

**対応:**
1. **最初のロード時:**
   - YouTubeページを再読み込み（`Cmd+R`）してください
   - これでコンテンツスクリプトが正しく実行されます

2. **開発中（コード修正後）:**
   - Viteサーバーが自動的に再ビルドします
   - YouTubeページを再読み込み（`Cmd+R`）してください
   - または、`chrome://extensions/` でリロードアイコンをクリック

3. **繰り返し発生する場合:**
   - `chrome://extensions/` で拡張機能をアンロード
   - Viteサーバーを停止（`Ctrl+C`）
   - `npm run build` で本番ビルド実行
   - 拡張機能を再度読み込み

### 本番ビルド

```bash
npm run build
```

`dist/` フォルダが生成されます。このフォルダを `chrome://extensions/` で読み込めば、本番環境として使用可能です。

### 推奨されるワークフロー

1. **初回セットアップ:**

```bash
   npm install
   npm run build
```

`dist/` を `chrome://extensions/` で読み込む

2. **開発:**

```bash
   npm run dev
```

コードを編集するたびに自動ビルドが実行されます

3. **テスト:**
   - YouTubeページを再読み込み（`Cmd+R`）
   - コンセプト無効化エラーが出た場合も、ページ再読み込みで解決します

4. **デバッグ:**
   - ブラウザDevTools（F12）を開く
   - Console タブでログを確認
   - `[YouTube WFS]` プリフィックスのログを探す

### トラブルシューティング

#### "Extension context invalidated" が繰り返し発生する場合

1. `chrome://extensions/` で拡張機能をアンロード
2. Viteサーバーを停止（`Ctrl+C`）
3. `npm run build` で本番ビルド
4. 拡張機能を再読み込み

#### CORSエラーが表示される場合

このプロジェクトではContentScriptでHMRを使用していないため、CORSエラーは発生しません。
もし発生する場合は：

1. ContentScriptで `import.meta.hot` を使用していないか確認
2. Viteサーバーが起動しているか確認（`http://localhost:5173` にアクセス可能か）
3. ブラウザキャッシュをクリア（DevTools → Application → Clear Storage）

#### 拡張機能が反応しない場合

1. `chrome://extensions/` で拡張機能をリロード
2. YouTubeページを再読み込み（`Cmd+R`）
3. ブラウザコンソール（F12）で エラーメッセージを確認
4. `[YouTube WFS]` プリフィックスのログを探す

### ログ出力

開発時のデバッグログはすべて `[YouTube WFS]` プリフィックスで出力されます：

```javascript
console.log('[YouTube WFS] Content script initialized');
console.warn('[YouTube WFS] Context invalidated while fetching storage', error);
console.error('[YouTube WFS] Initialization error:', error);
```

ブラウザDevToolsの Console タブでフィルタリングすると見やすくなります。

## ビルドシステムについて

このプロジェクトは以下のツールを使用しています：

- **Vite 6.x**: 高速ビルドツール
- **@crxjs/vite-plugin**: Chrome拡張機能用Viteプラグイン
- **TypeScript 5.x**: 型安全な開発環境

Manifest Version 3（MV3）に完全に準拠しており、Chrome拡張機能ストアに公開する際も追加の修正は不要です。
