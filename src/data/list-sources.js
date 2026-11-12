// 公開的涉詐網域清單來源。任一來源失敗時，其他來源照常更新。
//
// 兩層設計：
// 1. FEED：本專案每天用 GitHub Actions 把標示 inFeed 的來源彙整成一份清單（tools/build-feed.mjs），
//    發布在專案網站。擴充功能與 Gmail 收件匣過濾優先下載這一份：比較小、已淨化，
//    而且新增來源或來源搬家時，只要改這個檔案，不用等使用者更新擴充功能。
// 2. LIST_SOURCES：原始來源。彙整清單下載不到或太舊時，改成直接下載這些（inFeed 的來源）；
//    沒有標示 inFeed 的來源（只接受台灣網路連線，GitHub 的機器抓不到）一律由使用者的電腦直接下載。
//
// 新增來源：在 LIST_SOURCES 加一筆。國外也能下載的加上 inFeed: true，隔天就會出現在彙整清單裡。
import { PROJECT } from './project.js';

export const FEED = {
  id: 'feed', name: '官網守門員彙整清單（每天更新）',
  url: PROJECT.pages + 'blocklist.txt',
  metaUrl: PROJECT.pages + 'blocklist-meta.json',
  page: PROJECT.home + '/tree/main/feed',
  minCount: 1000, // 筆數少於這個數字視為清單壞了，改用原始來源
  maxAgeDays: 4, // 超過這麼多天沒更新視為彙整流程停擺，改用原始來源
};

export const LIST_SOURCES = [
  {
    id: 'twnic', name: 'TWNIC 停止解析詐騙網址（社群整理）', inFeed: true,
    url: 'https://raw.githubusercontent.com/lf94878964/Taiwan-Blocked-Domains/main/blocked_domains.txt',
    page: 'https://github.com/lf94878964/Taiwan-Blocked-Domains',
  },
  {
    id: 'g0v165', name: '165 假投資（博弈）網站（g0v 鏡像）', inFeed: true,
    url: 'https://raw.githubusercontent.com/g0v-data/165-data/main/gamble.csv',
    page: 'https://github.com/g0v-data/165-data',
  },
  {
    id: 'moi165', name: '165 假投資（博弈）網站（內政部官方，限台灣網路連線）',
    url: 'https://data.moi.gov.tw/MoiOD/System/DownloadFile.aspx?DATA=3BB8E3CE-8223-43AF-B1AB-5824FA889883',
    page: 'https://data.gov.tw/dataset/160055',
  },
];
