# 💓 rPPG Pro — 心率監測器

> 使用手機攝影機即時偵測心率、HRV、血氧、呼吸率的純前端 PWA 應用

🌐 **[立即體驗 → mccoychang.github.io/rppg-pro](https://mccoychang.github.io/rppg-pro/)**

## ✨ 功能特色

| 功能 | 說明 |
|------|------|
| ❤️ 心率偵測 | rPPG 技術，透過攝影機分析臉部血液脈動 |
| 📊 HRV 分析 | RMSSD、pNN50、SDNN、LF/HF 比值 |
| 🫁 血氧估計 | SpO2 即時估算 |
| 🌬️ 呼吸率 | 自動偵測呼吸頻率 |
| ☯️ 脈診分析 | 中醫五行諧波分析（心/肝/脾/肺/腎） |
| 🔍 壓力偵測 | 基線比對的壓力評估模式 |
| 👤 多使用者 | 本地帳號切換，各自獨立記錄 |
| 📱 PWA | 可安裝到 iPhone/Android 主畫面 |
| 🔀 自訂排列 | 拖拽卡片順序，自動記憶 |

## 📱 安裝到手機

### iPhone
1. Safari 打開上方連結
2. 點底部 **↑ 分享**
3. 選 **「加入主畫面」**

### Android
1. Chrome 打開上方連結
2. 點 **「安裝應用程式」** 或選單中的 **「新增至主畫面」**

## 🛠️ 技術架構

```
純前端 (No Server Required)
├── index.html      — 主應用程式 (HTML + CSS + JS)
├── signal.js       — rPPG 訊號處理引擎
├── analysis.js     — HRV / 脈診 / 情緒分析
├── history.js      — localStorage 資料管理
├── sw.js           — Service Worker (離線快取)
└── manifest.json   — PWA 設定
```

- **rPPG 演算法**：ICA + 帶通濾波 (0.75–3.0 Hz)
- **臉部偵測**：MediaPipe Face Detection
- **資料儲存**：localStorage（完全在地端，無雲端）
- **部署**：GitHub Pages（免費靜態託管）

## 📋 使用說明

1. 開啟網頁，允許攝影機權限
2. 將臉部對準攝影機
3. 點擊 **🚀 開始偵測**
4. 等待 5-10 秒穩定後即可看到數據
5. 停止偵測時會自動儲存記錄

> ⚠️ **免責聲明**：本工具僅供參考與學習用途，非醫療器材，不可用於臨床診斷。

## 📄 授權

MIT License — 詳見 [LICENSE](LICENSE)

---

Made with 💓 by McCoychang
