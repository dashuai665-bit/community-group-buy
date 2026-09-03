# 鄰里湊湊

「鄰里湊湊」是一個以手機使用者為優先的社區共同採購／揪團平台。平台品牌不綁定特定賣場；不同零售商與供應商未來都可成為商品來源。

## 技術架構

- Vinext、React 19、TypeScript（strict mode）
- Tailwind CSS 與 shadcn/ui，採手機優先的介面設計
- Cloudflare Workers 相容的 Vite ESM 輸出
- Cloudflare D1（SQLite）作為預計資料庫，透過 Drizzle ORM 與 migration 管理 schema
- Git 版本管理，pnpm 鎖定相依套件版本

目前只完成專案初始化與品牌首頁，尚未實作登入、訂單、付款、管理後台或正式資料庫 schema。

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
