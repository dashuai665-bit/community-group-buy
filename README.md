# 鄰里湊湊

「鄰里湊湊」是一個以手機使用者為優先的社區共同採購／揪團平台。平台品牌不綁定特定賣場；不同零售商與供應商未來都可成為商品來源。

## 技術架構

- Vinext、React 19、TypeScript（strict mode）
- Tailwind CSS 與 shadcn/ui，採手機優先的介面設計
- Cloudflare Workers 相容的 Vite ESM 輸出
- Cloudflare D1（SQLite）作為預計資料庫，透過 Drizzle ORM 與 migration 管理 schema
- Git 版本管理，pnpm 鎖定相依套件版本

目前已完成專案初始化、品牌首頁，以及 Phase 2 的會員、登入身份、多社區 membership、預設社區與 server-side authorization 基礎。尚未串接真實登入供應商，也未實作商品、訂單、付款或完整管理後台。

## Phase 2 資料與權限基礎

- `users.id` 使用應用層產生的 UUID，email、phone 與 provider ID 均不是平台主鍵。
- `user_identities` 以 `(provider, provider_user_id)` 唯一限制支援多登入身份；相同 email 或 phone 不會自動合併帳號。
- `community_members` 以 `(user_id, community_id)` 唯一限制支援一位會員加入多個社區。
- memberships、目前瀏覽社區與 `default_community_id` 是三個獨立概念；切換瀏覽社區不會修改預設社區。
- `platform_roles` 獨立於社區 membership，使 platform admin 可安全地跨社區授權。
- `domain/authorization.ts` 提供 server-side authentication、active user、membership、community admin 與 platform admin 檢查。
- public serializer 不輸出電話、email 或 identity metadata；logging helper 會遮罩電話並排除 token、OTP 等敏感欄位。

## Phase 3 API 與 persistence

- `server/repositories` 集中所有 prepared statements，route 不直接撰寫 SQL。
- D1 `batch()` 作為 atomic unit of work；provisioning、join、leave/default reassignment、identity link/unlink 與 audit 同批提交。
- provider-neutral session boundary 先把外部 identity 解析成 `users.id`，protected API 後續只使用平台 user ID。
- 公開社區、我的社區、加入、離開、預設社區、identity、phone 與 community-scoped contact APIs 均透過 service layer 執行 invariant。
- `audit_logs` 僅存最小化 metadata；禁止 raw phone、OTP、OAuth/session token 或 provider secrets。
- 本機 HTTP 測試使用 dependency-injected auth adapter；production route 不信任 `X-User-Id` 類型的自訂身份 header。

## 本機開發

需求：Node.js 22.13 以上與 pnpm。

```powershell
pnpm install
pnpm dev
```

品質檢查請分別執行：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 資料庫變更原則

所有 D1 schema 變更都必須修改 `db/schema.ts`，再使用 `pnpm db:generate` 產生並審查 migration。禁止直接修改正式資料庫 schema，migration 也不得在未審查的情況下套用至正式環境。

## Git workflow

1. 從最新的 `main` 建立短期功能分支，例如 `codex/feature-name`。
2. 每次提交只處理一個清楚目的，提交前執行 lint、型別檢查、測試與 build。
3. 透過 Pull Request 審查後合併回 `main`，資料庫 migration 必須與對應程式碼一起審查。
4. 不提交建置產物、套件目錄、本機工具狀態或任何敏感資訊。

## Secrets 安全

絕對不可將 secret、token、API key、OAuth secret、Cloudflare credential 或真實個資提交到 Git。`.env`、`.env.*`、`.dev.vars` 與 `.wrangler` 已被忽略；若未來需要提供設定範例，應另外建立不含真實值且經團隊審查的範例檔規則。

提交前應使用 `git status` 與 `git diff --cached` 再次確認內容。
