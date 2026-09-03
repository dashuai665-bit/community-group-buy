# 鄰里湊湊

「鄰里湊湊」是一個以手機使用者為優先的社區共同採購／揪團平台。平台品牌不綁定特定賣場；不同零售商與供應商未來都可成為商品來源。

## 技術架構

- Vinext、React 19、TypeScript（strict mode）
- Tailwind CSS 與 shadcn/ui，採手機優先的介面設計
- Cloudflare Workers 相容的 Vite ESM 輸出
- Cloudflare D1（SQLite）作為預計資料庫，透過 Drizzle ORM 與 migration 管理 schema
- Git 版本管理，pnpm 鎖定相依套件版本

目前已完成專案初始化、會員與多社區基礎，以及 Phase 4A 的商品目錄、社區供應、湊單批次與願望清單。尚未串接真實登入供應商，也未實作正式訂單、付款或完整管理後台。

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

## Phase 4A 商品與湊單

- `products` 是平台商品目錄，商品來源只是 `manual`、`costco`、`supplier`、`overseas` 或 `other` 等屬性，品牌不綁定任何供應商。
- `community_product_offerings` 表示各社區自己的售價、門檻、數量限制與供應狀態；同一商品可由多個社區各自供應。
- 金額一律用 `price_minor` 整數保存。目前 `currency` 為 `TWD`，慣例是以最小貨幣單位表示（NT$199 儲存為 `19900`），避免 floating point 誤差並預留多幣別演進。
- 本階段每個 `(community_id, product_id)` 只有一筆 current offering。若同社區需要並存多版本，後續 migration 應新增 version/effective period 並將目前唯一限制改為「僅 current 唯一」，舊資料不得覆寫。
- 每個 `group_buy_batches` 都保存不可變的 `threshold_quantity` snapshot 與連續 `sequence_number`。修改 offering 門檻只影響之後建立的批次。
- `batch_commitments` 是 Phase 4A 數量的單一 truth source；`committed_quantity` 是在同一 atomic batch 內由 commitment sum 重算的快取。Phase 4B 接上 `order_items` 時，應讓 commitment 參照 order item，並提供 reconciliation 檢查，避免雙重 truth source。
- 超出門檻的數量會依批次容量拆分，例如 `26 + 10` 形成 `30 formed + 6 open`；已 formed、closed 或 cancelled 的批次不再接受新增數量。
- D1 寫入透過單一 `batch()` 依序執行容量建立、commitment ledger、快取重算、成團與 audit，並以 unique constraints 防止 request/sequence 重複。本機 concurrency 測試用 `BEGIN IMMEDIATE` 序列化模擬；production D1 的真實跨請求排程仍須在 preview/staging D1 做負載驗證。
- 公開商品 API 僅回傳商品展示、價格與進度欄位；所有 offering 管理與 wish review 權限均由 server 驗證社區範圍。

## Phase 4B 訂單、取消與取貨基礎

- `orders` 是正式交易意圖，`order_items` 保存商品名稱、單位與下單價格 snapshot；offerings 日後改名或改價不會改寫歷史訂單。
- 下單要求 `(user_id, idempotency_key)` 唯一。訂單、全部 items、batch allocations、cache/status 與 audit 都在同一個 D1 atomic batch；任一品項失敗就整張回滾。
- 同一訂單禁止重複 offering，避免合併規則不透明；一張訂單可包含多個不同 offerings。
- `batch_commitments.order_item_id` 連回 immutable commercial source。reconciliation 只報告 item quantity、batch cache 與 order total drift，不會靜默修資料。
- 訂單 formation 狀態由 commitments 所在 batches 推導：全部未成團為 `submitted`、部分完成為 `partially_formed`、全部完成為 `formed`。
- 一般會員可取消 `pending/submitted/partially_formed`；`formed` 需要該社區管理員或平台管理員。取消會在同一交易停用 commitments、重算 batch cache，未鎖定的 formed batch 若低於門檻會回到 open。
- `locked` 是正式採購邊界。管理員將已成團訂單標記可取貨時，相關 batch 鎖定並建立 `pickup_records`；locked、ready-for-pickup 與 completed 訂單都不可取消。
- pickup 的 `ready` 與 `picked_up` 會原子同步 order 的 `ready_for_pickup` 與 `completed`，未完成 order 或 pickup 會阻止會員離開社區。
- 會員 API 不回傳 contact snapshots；只有經 server 驗證的 own-community admin 或 platform admin 可透過專用管理 API 取得訂單聯絡 snapshot。Audit 不保存取消原因、raw phone 或認證資料。

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
