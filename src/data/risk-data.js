// 依實測資料調整的風險參數
//
// TLD_RISK：頂級網域風險分數。
//   計算方式：TWNIC 停止解析詐騙網域（1,734 筆，2023/6–2026/10）中各頂級網域的比例，
//   除以 Chrome 台灣熱門網站（246,948 個，2026/9）中的比例。
//   比值 ≥30 → 30 分、≥10 → 22 分、≥5 → 15 分、≥2.5 → 8 分。
//   .cc、.cn、.io、.me 在台灣正常網站一樣常見（比值約 1），所以不加分。
//   少數沒有足夠樣本、但國際上公認濫用嚴重的後綴（tk、ml…）給 15 分。
export const TLD_RISK = {
  cyou: 30, bond: 30, qpon: 30, bid: 30, xin: 30, cfd: 30, top: 30, ink: 30, sbs: 30,
  beer: 22, online: 22, lat: 22, store: 22, space: 22, buzz: 22, my: 22, shop: 22, life: 22, icu: 22, art: 22, pw: 22, xyz: 22,
  mobi: 15, vip: 15, fun: 15, site: 15, club: 15, live: 15, one: 15,
  biz: 8, link: 8, cloud: 8, asia: 8,
  // 樣本不足、依國際濫用紀錄
  tk: 15, ml: 15, ga: 15, cf: 15, gq: 15, rest: 15, monster: 15, click: 15, work: 15, loan: 15, win: 15, mom: 15, lol: 15,
  quest: 15, fit: 15, hair: 15, skin: 15, makeup: 15, autos: 15, boats: 15, homes: 15, yachts: 15, beauty: 15, website: 15,
  today: 8, su: 8, ws: 8, help: 8, support: 8, ltd: 8, run: 8,
};

// 品牌專屬頂級網域：只有該公司能註冊，底下的網址都是官方的（例：gemini.google、outlook.cloud.microsoft）
// 值是 official-sites.js 裡的機構名稱
export const BRAND_TLDS = {
  google: 'Google', goog: 'Google', youtube: 'Google', android: 'Google', chrome: 'Google', gmail: 'Google',
  microsoft: 'Microsoft', office: 'Microsoft', windows: 'Microsoft', xbox: 'Microsoft', azure: 'Microsoft', bing: 'Microsoft',
  skype: 'Microsoft', hotmail: 'Microsoft',
  apple: 'Apple', amazon: 'Amazon', aws: 'Amazon', netflix: 'Netflix', yahoo: 'Yahoo 奇摩', hsbc: '滙豐（台灣）商業銀行',
};

// 一般英文單字：和品牌名稱只差一兩個字，但本身是正常用字（finance ≠ binance、wikimedia ≠ wikipedia）
export const COMMON_WORDS = new Set([
  'finance', 'finances', 'office', 'offices', 'general', 'water', 'customs', 'custom', 'wikimedia', 'money', 'mobile', 'online',
  'global', 'market', 'travel', 'health', 'energy', 'service', 'central', 'national', 'network', 'digital', 'telecom', 'premium',
  'partner', 'social', 'studio', 'design', 'camera', 'career', 'school', 'member', 'united', 'planet', 'power', 'media', 'music',
  'video', 'photo', 'games', 'sports', 'store', 'house', 'garden', 'golden', 'happy', 'lucky', 'smart', 'space', 'light', 'green',
  'family', 'ticket', 'tickets', 'booking', 'books', 'capital', 'trip', 'trips', 'library', 'telegraph', 'agora',
  'english', 'america', 'apples', 'applied', 'ample', 'amazing', 'shopper', 'shoppers',
]);
