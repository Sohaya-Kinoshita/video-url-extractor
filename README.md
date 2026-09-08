# Video URL Extractor

Cloudflare Pages + Pages Functionsで動く、Webページ内の動画URL抽出ツールです。静的HTMLに含まれる `.mp4`、`.m3u8`、`video` / `source` タグ、埋め込みURLを対象にしています。

## Cloudflare PagesのBuild settings

```text
Framework preset: None
Build command: exit 0
Build output directory: public
```

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
