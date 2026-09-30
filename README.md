# QuickBill Converter

將 PDF 或 Excel 帳單交給 Gemini 分析欄位，讓使用者確認欄位對應後，輸出可複製或下載的請款資料。

正式版採 Cloudflare Worker 同時提供前端與 API。Gemini API Key 僅存放於 Cloudflare Secret，不會進入前端 bundle 或 Git 紀錄。

## 正式網址

https://woodmall-quickbill-converter.irene-774.workers.dev

## 本地開發

需求：Node.js 20 以上、Cloudflare 帳號。

1. 執行 `npm install`
2. 建立 `.dev.vars`，加入 `GEMINI_API_KEY=您的金鑰`
3. 執行 `npm run dev`

## 部署

```bash
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npm run deploy
```

公開 API 僅接受同網域瀏覽器請求，並限制每個瀏覽器每分鐘最多 30 次 AI 請求。

## 驗證

```bash
npm test
npm run typecheck
npm run build
```
