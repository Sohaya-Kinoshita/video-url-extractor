# Video URL Extractor

Cloudflare Pages + Pages Functionsで動く、Webページ内の動画URL抽出ツールです。静的HTMLに含まれる `.mp4`、`.m3u8`、`video` / `source` タグ、埋め込みURLを対象にしています。

## Cloudflare PagesのBuild settings

```text
Framework preset: None
Build command: exit 0
Build output directory: public
```

`wrangler.toml` でも `pages_build_output_dir = "public"` を指定しています。

## 動作確認用URL

デプロイ後、抽出フォームには次のように自分のPages URLの末尾に `/sample.html` を付けて入力します。

```text
https://<your-project>.pages.dev/sample.html
```

カスタムドメイン設定後は次の形式でも確認できます。

```text
https://<your-domain>.dev/sample.html
```

次のような短縮ページにも対応しています。

```text
https://video.twimg-image.com/jVU9c2
https://t.co/2YTXpnPofC
```

## 保存リスト

抽出結果の「記憶」ボタンを押すと、動画URLを端末のブラウザ内に保存します。保存済みURLは次のページで確認、再度開く、保存、コピー、削除できます。

```text
https://<your-project>.pages.dev/saved.html
```

「保存」ボタンは `/api/download` 経由でURL先のファイル保存をブラウザに依頼します。`.m3u8` の場合はHLSセグメントを結合し、再生可能性の高い `.ts` として保存します。iPhoneでは現在のタブでSafariのダウンロードを開始し、通常は「ファイル」アプリのダウンロード保存として扱われます。

抽出ページでは直近の抽出結果を `sessionStorage` に一時保存します。動画を開いてから戻った場合でも、同じタブでは前回の結果が復元されます。

「リンク先ページも探索」をオンにすると、入力ページ内のリンク先を最大8ページまで1階層だけ追加解析します。

## ローカル起動

Node.jsが入っている環境で実行します。

```powershell
cd C:\Users\izumi\VideoFinder\video-url-extractor
npm install
npm run dev
```

表示されたローカルURLをブラウザで開きます。

## テスト

```powershell
npm test
```

## API

```http
POST /api/extract
Content-Type: application/json

{
  "url": "https://example.com/video-page"
}
```

レスポンス例:

```json
{
  "pageUrl": "https://example.com/video-page",
  "count": 1,
  "results": [
    {
      "url": "https://cdn.example.com/movie/index.m3u8",
      "kind": "hls",
      "source": "HTML text scan"
    }
  ]
}
```

## 公開時の注意

このツールは公開WebページのHTML解析を目的にしています。ログインが必要なページ、DRMで保護された動画、JavaScript実行後にだけ生成されるURLは検出できない場合があります。著作権および各サイトの利用規約を守って利用してください。
