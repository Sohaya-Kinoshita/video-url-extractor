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
https://twimg.com.pl/d/ZHrNY3
https://gofile.io/d/65pGBWhc
```

## 保存リスト

抽出結果の「記憶」ボタンを押すと、動画URLをCloudflare D1に保存します。パスワードでログインすると、別の端末からも同じ保存リストを確認、再度開く、保存、コピー、削除できます。動画ファイル自体はDBに保存しません。

以前のブラウザ内保存データが残っている場合、保存リストに「この端末の保存リストを取り込む」が表示されます。同じブラウザ・同じURLでログインして取り込んでください。元データは消さず、同じURLは重複させません。途中で失敗した場合も再実行でき、DBの新しい保存内容は古いデータで上書きしません。

探索が成功すると、入力URL・到達先URL・件数・探索ページ数・日時をD1の抽出履歴に保存します。`/history.html` の「再探索」はフォームにURLを戻します。再取得は「探索」を押して開始します。抽出結果全体や動画データは履歴に保存しません。

```text
https://<your-project>.pages.dev/saved.html
```

「保存」ボタンは `/api/download` 経由でURL先のファイル保存をブラウザに依頼します。HLS（`.m3u8`）の結果では「MP4」から変換画面を開き、「変換スタート」を押してから変換します。画面を開いた時や、戻る・進むで画面に戻った時には自動で変換を開始しません。画質を変えずにMP4として視聴・保存できます。「再生」は変換せず元の配信URLを直接開きます。変換はブラウザ内のWorkerで行います。iPhoneでは準備完了後に「MP4を保存」を押してください。

MP4変換はH.264/AACのMPEG-TSによる完結したHLS動画（最大300セグメント、128 MBまで）に対応します。暗号化、ライブ配信、fMP4セグメント、バイト範囲指定、途中で形式が切り替わる動画は対象外です。対応しない場合は「元のURLから開く」で配信元を開けます。従来の `/api/download?url=<HLS URL>` によるTS保存も引き続き利用できます。

MP4への再格納には同梱のMediabunny 1.62.0（MPL-2.0）を使用します。iPhone Safariなどでの互換性を高めるため、ストリーミング用の分割MP4ではなく、映像・音声のサンプルテーブルを持つ通常のMP4（Fast Start）を書き出します。再エンコードは行いません。配布物、ライセンス、ソースの参照先は `public/vendor/` にあります。

抽出ページでは直近の抽出結果を `sessionStorage` に一時保存します。動画を開いてから戻った場合でも、同じタブでは前回の結果が復元されます。

「リンク先ページも探索」をオンにすると、入力ページ内のリンク先を最大8ページまで1階層だけ追加解析します。

対応済みのVilolo系ページ、および同じ短い共有ID形式の互換ページでは、動画下部に表示される関連動画リストもスクロール相当で最大100件まで検出します。既知ドメイン以外でも、`https://example.com/AbC123` のような1階層の短いIDページは互換APIを試し、API側で一致した場合だけ結果に含めます。

Gofileの公開共有フォルダ（`https://gofile.io/d/<id>`）では、フォルダ内の動画ファイルをAPI経由で検出します。パスワード付き、期限切れ、非公開の共有フォルダは検出できません。

対応ドメイン例: `video.twimg-image.com`、`video.twimgx.com`、`twimg.com.pl`、`cdn*.mvfile.com`、`cdn*.twimg-media.com`、`cdn*.image-share.cc`、`gofile.io`

配信元APIのファイル名やタイトル（例: `movie.mp4`）は動画URLとして扱いません。実際の配信用URLを抽出し、ファイル名から存在しない `.mp4` リンクが生成されることを防ぎます。

## 専用DBとログインの設定

1. `wrangler login --scopes account:read user:read d1:write pages:write` で接続します。
2. `wrangler.toml` の `DB` に専用D1を指定します。このプロジェクトでは `video-url-extractor-db` を作成済みです。
3. `wrangler d1 migrations apply video-url-extractor-db --remote` を実行します。
4. `node scripts/create-owner-password.mjs` で256ビットのランダムパスワードを生成します。既存ファイルがあれば上書きしません。
5. `.dev.vars` の `OWNER_PASSWORD_SHA256` の値を、Pagesプロジェクトの同名の**シークレット**に設定します。`wrangler pages secret put OWNER_PASSWORD_SHA256 --project-name video-url-extractor` でも設定できます。
6. GitHubの `main` に反映してデプロイします。パスワードは `owner-access.local.txt` を開いて確認し、安全な場所に保管してください。

生成される `.dev.vars`、`owner-access.local.txt`、`.local/` はGitの対象外です。平文パスワードはCloudflareへ設定せず、256ビットのランダム値のSHA-256だけをシークレットとして保持します。この方式を人が考えた短いパスワードに流用しないでください。パスワード用ハッシュを変更すると既存のログインも無効になります。プレビュー環境には本番DB・シークレットを割り当てず、未設定時は専用画面・APIを503で閉じます。

ログイン状態はHttpOnly・Secure・SameSite=StrictのCookieで30日間保持し、DBにはCookieトークンのハッシュを保存します。ログアウト時にトークンを無効化します。ログイン試行はIPごとに15分間5回までに制限し、変更APIは同じサイトからの送信だけを受け付けます。DBやシークレットが未設定の場合、APIは公開状態に戻りません。

### ローカル確認

Node.jsが入っている環境で実行します。

```powershell
cd C:\Users\izumi\VideoFinder\video-url-extractor
npm install
wrangler d1 migrations apply video-url-extractor-db --local
npm run dev
```

表示されたローカルURLをブラウザで開きます。

Node.js 24では `node local-dev.mjs` でも起動できます。実際のSQLiteと同じ認証・APIを使用し、データは `.local/storage.sqlite` に保存します。本番DBは変更しません。上記で生成した `.dev.vars` とパスワードを使用します。

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
