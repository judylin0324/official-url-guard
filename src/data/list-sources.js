// 公開的涉詐網域清單來源。任一來源失敗時，其他來源照常更新。
export const LIST_SOURCES = [
  {
    id: 'twnic', name: 'TWNIC 停止解析詐騙網址（社群整理）',
    url: 'https://raw.githubusercontent.com/lf94878964/Taiwan-Blocked-Domains/main/blocked_domains.txt',
    page: 'https://github.com/lf94878964/Taiwan-Blocked-Domains',
  },
  {
    id: 'g0v165', name: '165 假投資（博弈）網站（g0v 鏡像）',
    url: 'https://raw.githubusercontent.com/g0v-data/165-data/main/gamble.csv',
    page: 'https://github.com/g0v-data/165-data',
  },
  {
    id: 'moi165', name: '165 假投資（博弈）網站（內政部官方，限台灣網路連線）',
    url: 'https://data.moi.gov.tw/MoiOD/System/DownloadFile.aspx?DATA=3BB8E3CE-8223-43AF-B1AB-5824FA889883',
    page: 'https://data.gov.tw/dataset/160055',
  },
];
