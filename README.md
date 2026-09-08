# Video URL Extractor

Webページ内に埋め込まれた動画URLを抽出するローカルWebアプリです。まずは静的HTMLに含まれる `.mp4`、`.m3u8`、`video` / `source` タグ、埋め込みURLを対象にしています。

## セットアップ

```powershell
cd C:\Users\izumi\VideoFinder\video-url-extractor
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

テストも実行する場合:

```powershell
pip install -r requirements-dev.txt
pytest -q
```

## 起動

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

ブラウザで `http://127.0.0.1:8000` を開きます。

## Dockerで起動

```powershell
docker build -t video-url-extractor .
docker run --rm -p 8000:8000 video-url-extractor
```

## 公開の流れ

1. GitHubにこのフォルダの内容をpush
2. Render、Railway、Fly.io、Google Cloud RunなどのWebサービスにデプロイ
3. `.dev` ドメインを取得
4. ホスティング先でカスタムドメインを追加
5. ドメイン管理画面でDNSレコードを設定
6. HTTPS証明書が有効になったら公開完了

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
  "page_url": "https://example.com/video-page",
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

## 今後の拡張

- PlaywrightによるJavaScript生成ページの解析
- HLSマニフェストの中身確認
- 対象サイトごとの抽出ルール追加
- `.dev` ドメインへのデプロイ設定

## 公開時の注意

このアプリは任意のURLをサーバー側で取得します。公開環境ではSSRF対策が重要なため、デフォルトではプライベートIP、localhost、リンクローカル宛のURLを拒否します。ローカル検証で必要な場合だけ `ALLOW_PRIVATE_URLS=true` を設定してください。
