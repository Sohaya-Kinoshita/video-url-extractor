import { randomBytes, createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const accessFile = new URL('owner-access.local.txt', root);
const varsFile = new URL('.dev.vars', root);
if (existsSync(accessFile) || existsSync(varsFile)) throw new Error('既存の認証ファイルがあります。上書きしません。');
// SHA-256 is used only for this randomly generated 256-bit password, never a human-chosen password.
const password = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(password).digest('hex');
writeFileSync(accessFile, `Video URL Extractor 専用ログイン\nURL: https://video-url-extractor.pages.dev/\nパスワード: ${password}\n\nこのファイルはGitには含まれません。パスワードマネージャー等に保管してください。\n`, { mode: 0o600 });
writeFileSync(varsFile, `OWNER_PASSWORD_SHA256=${hash}\n`, { mode: 0o600 });
console.log(`ログイン情報を保存しました: ${fileURLToPath(accessFile)}`);
