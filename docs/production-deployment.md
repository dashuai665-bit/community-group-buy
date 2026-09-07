# 鄰里湊湊 Production Deployment Runbook

本文件適用 Wrangler 4.92.0。所有 staging 與 production 操作都必須由 operator 在確認帳號、環境、資料庫與 commit 後執行。不得把 secret、D1 dump 或真實會員資料提交至 Git。

## A. One-time Cloudflare setup

1. 執行 `pnpm exec wrangler login`，確認登入正確 Cloudflare account。
2. 決定並記錄 staging 與 production 的 HTTPS origin；兩者不得相同。
3. Worker 名稱預設為 `linli-coucou-staging` 與 `linli-coucou-production`，需要變更時修改 `wrangler.jsonc` 的 env name。
4. `nodejs_compat` 保留給 Vinext、Better Auth 與其 Node 相容 API；移除前必須重新通過完整 build/Auth tests。

## B. Create staging D1

執行 `pnpm exec wrangler d1 create linli-coucou-staging`，將回傳的 database ID 填入 `env.staging.d1_databases[0].database_id`。binding 必須保持 `DB`。

## C. Create production D1

執行 `pnpm exec wrangler d1 create linli-coucou-production`，將不同的 database ID 填入 production env。不得與 staging 共用 D1、Auth session 或 secret。

## D. Configure Wrangler IDs and origins

將 `.example.invalid` origin、`REPLACE_WITH_*_D1_DATABASE_ID` 與 Google Client ID placeholder 全部替換。執行：

```powershell
pnpm predeploy:check staging
pnpm predeploy:check production
```

任一檢查失敗都不得 migration 或 deploy。Wrangler 的 vars 與 bindings 不會在 env 間繼承，因此兩個 env 必須各自完整宣告。

## E. Configure Google OAuth

在 Google Cloud Console 建立彼此隔離的 OAuth client：

- Staging origin：`<STAGING_ORIGIN>`
- Staging callback：`<STAGING_ORIGIN>/api/auth/callback/google`
- Production origin：`<PRODUCTION_ORIGIN>`
- Production callback：`<PRODUCTION_ORIGIN>/api/auth/callback/google`

callback 是 Better Auth 的 Google callback route。`APP_ORIGIN` 是 base URL 與 trusted origin 的唯一來源；不得由 Host、X-Forwarded-Host 或 request Origin 推導。

## F. Configure secrets

`APP_ORIGIN` 與 `GOOGLE_CLIENT_ID` 是 env-specific Wrangler vars。以下必須用 Wrangler secret，不能寫入 config：

```powershell
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --env staging
pnpm exec wrangler secret put BETTER_AUTH_SECRET --env staging
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --env production
pnpm exec wrangler secret put BETTER_AUTH_SECRET --env production
```

可用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` 在 operator 終端產生 Better Auth secret；不要把輸出寫入 tracked file。staging 與 production 必須分別產生。

## G. Apply staging migrations

Production migration owner 是 Wrangler D1，fresh DB 從 byte-identical 的 `migrations/0000_current_schema.sql` 開始。`drizzle/` 不得用於正式 apply。

```powershell
pnpm db:migrations:list:staging
pnpm db:migrations:apply:staging
pnpm db:migrations:list:staging
```

確認 ledger `d1_migrations` 只記錄預期檔案，第二次 list 顯示沒有 pending migration。

## H. Staging deploy

先執行全部 gates，再執行 `pnpm predeploy:check staging` 與 `pnpm build:staging`。Cloudflare Vite plugin 在 build 時透過 `CLOUDFLARE_ENV=staging` 產生 flatten 後的 deploy config；build 後再傳 `wrangler deploy --env staging` 不會切換 artifact 環境。核對 `dist/server/wrangler.json` 的 Worker name、APP_ORIGIN 與 DB 後，只有使用者明確授權才可執行 `pnpm exec wrangler deploy --config dist/server/wrangler.json`。

## I. Bootstrap staging admin

1. 管理員先以 Google 正常登入 staging。
2. 以安全的 operator query 確認 Google identity 對應的 app `users.id`，不得用 email 當授權 identity。
3. 先 dry-run：`pnpm bootstrap:platform-admin staging <APP_USER_ID>`。
4. 核對 target 後執行：`pnpm bootstrap:platform-admin staging <APP_USER_ID> --apply --confirm staging:<APP_USER_ID>`。
5. 查詢 `platform_roles` 驗證唯一的 `platform_admin` row。重跑是 idempotent；不存在的 users.id 不會新增資料。

此流程沒有 public bootstrap endpoint、不會讓首位登入者自動成為 admin，也不依 email 授權。

## J. Staging smoke

驗證登入、登出、resident/community admin/platform admin 權限、下單、成團、採購、現金收款、取貨、Audit Log，以及 Auth/API response 為 `Cache-Control: no-store`。禁止使用 production PII、OAuth/session rows 或會員資料。

## K. Production backup/bookmark

部署前記錄 Git commit、目前 Worker version、目標 database name/ID，並執行：

```powershell
pnpm db:migrations:list:production
pnpm exec wrangler d1 info DB --env production
pnpm exec wrangler d1 time-travel info DB --env production
```

保存輸出的 current bookmark。D1 production backend 的 Time Travel 自動啟用；bookmark 有保存期限，實際期限依 Cloudflare plan。

## L. Production migration

順序固定為：bookmark → migration preflight → apply migration → DB verification → compatible Worker deploy → smoke。Worker 依賴新 schema 時，禁止先 deploy。

Production 沒有模糊的一鍵 apply script。operator 必須在再次核對環境後明確執行：

```powershell
pnpm exec wrangler d1 migrations apply DB --remote --env production
pnpm exec wrangler d1 migrations list DB --remote --env production
```

檢查 `d1_migrations`、schema inventory、foreign keys 與重要 invariants。

## M. Production deploy

確認 migration 與 DB verification 成功、working tree clean、commit 可追溯且 secrets 已設定，先執行 `pnpm predeploy:check production` 與 `pnpm build:production`。核對 flatten 後的 `dist/server/wrangler.json` 明確指向 production Worker、origin 與 D1；經明確授權後才執行 `pnpm exec wrangler deploy --config dist/server/wrangler.json`。不得在 production build 後用 `--env` 嘗試切換環境。

## N. Bootstrap first production admin

依 I 節相同步驟，將 environment 改為 production。必須由已正常登入、已確認 identity 的 app `users.id` bootstrap。

## O. Production smoke

驗證 Google callback、session cookie、登出、權限隔離、核心交易、no-store、安全 headers、runtime error log。log 不得包含 token、session、cookie、secret 或完整電話。

## P. Rollback / Time Travel

若 migration 或 deploy 後出現嚴重資料問題：停止 release 與可控的寫入、保留錯誤證據、回退 Worker 至與舊 schema 相容的已知 commit。若必須恢復 D1，先再次核對 database，依部署前 bookmark 執行：

```powershell
pnpm exec wrangler d1 time-travel restore DB --env production --bookmark=<RECORDED_BOOKMARK>
```

restore 會覆寫目標 DB 並取消進行中的 query，必須由 operator 互動確認。記錄 restore 回傳的 previous bookmark，以便必要時復原這次 restore。最後驗證 business data、Auth users/accounts/sessions、FK、ledger 與相容 Worker。若 CLI contract 改變，停止並改用 Cloudflare Dashboard 或官方 API 文件指示，不得猜命令。

## Logging minimum

使用 Cloudflare Worker runtime logs 調查 5xx、Auth failure 與 migration failure。應只記錄事件類型、request correlation 與安全錯誤碼，不記錄 Authorization、Cookie、OAuth token、session、secret 或完整電話。
