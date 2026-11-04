// 測試語料
// LEGIT：台灣常見、但「不在」官方清單的正常網站 → 不可以判成「危險」
// SCAM：依新聞與 165 公告常見手法編寫的詐騙網址樣式（皆為虛構範例）→ 必須判成「危險」或至少「可疑」

export const LEGIT = [
  // 新聞媒體
  'https://news.ltn.com.tw/', 'https://udn.com/news/index', 'https://www.chinatimes.com/', 'https://www.ettoday.net/',
  'https://www.setn.com/', 'https://news.tvbs.com.tw/', 'https://www.cna.com.tw/', 'https://www.storm.mg/',
  'https://www.businesstoday.com.tw/', 'https://www.cw.com.tw/', 'https://www.cmoney.tw/', 'https://www.moneydj.com/',
  'https://www.twreporter.org/', 'https://www.thenewslens.com/', 'https://www.nownews.com/', 'https://www.mirrormedia.mg/',
  // 論壇、社群、工具
  'https://www.mobile01.com/', 'https://forum.gamer.com.tw/', 'https://www.dcard.tw/f', 'https://www.ptt.cc/bbs/',
  'https://medium.com/', 'https://www.reddit.com/', 'https://stackoverflow.com/', 'https://apple.stackexchange.com/',
  'https://www.notion.so/', 'https://www.canva.com/', 'https://zoom.us/', 'https://www.dropbox.com/', 'https://chat.openai.com/',
  'https://claude.ai/', 'https://www.linkedin.com/', 'https://www.pinterest.com/', 'https://www.twitch.tv/',
  // 購物、品牌
  'https://www.ikea.com.tw/', 'https://www.uniqlo.com/tw/', 'https://www.nike.com/tw/', 'https://www.asus.com/tw/',
  'https://www.acer.com/tw-zh', 'https://www.mi.com/tw/', 'https://www.samsung.com/tw/', 'https://www.sony.com.tw/',
  'https://www.kingstone.com.tw/', 'https://www.friday.tw/', 'https://www.gomaji.com/', 'https://www.buy123.com.tw/',
  'https://www.decathlon.tw/', 'https://www.muji.com/tw/', 'https://www.starbucks.com.tw/', 'https://www.mcdonalds.com/tw/',
  'https://www.kfcclub.com.tw/', 'https://www.dominos.com.tw/', 'https://www.pizzahut.com.tw/', 'https://www.mos.com.tw/',
  'https://www.cathaycinemas.com.tw/', 'https://www.vscinemas.com.tw/', 'https://www.showtimes.com.tw/',
  'https://www.applebees.com/', 'https://www.pineapple.com/', 'https://www.capitalone.com/', 'https://www.capital.com/',
  'https://www.entrust.com/', 'https://www.family.com/', 'https://www.ticketmaster.com/', 'https://www.booking-engine.com/',
  // 旅遊、交通
  'https://www.eztravel.com.tw/', 'https://travel.liontravel.com/', 'https://www.colatour.com.tw/', 'https://www.hotels.com/',
  'https://www.expedia.com.tw/', 'https://www.skyscanner.com.tw/', 'https://www.easyrent.com.tw/', 'https://www.ubike.com.tw/',
  // 醫療、教育、非營利
  'https://www.cgmh.org.tw/', 'https://www.mmh.org.tw/', 'https://www.tzuchi.org.tw/', 'https://www.genesis.org.tw/',
  'https://www.coursera.org/', 'https://www.hahow.in/', 'https://www.ted.com/',
  // 開發者、雲端
  'https://www.cloudflare.com/', 'https://aws.amazon.com/', 'https://azure.microsoft.com/', 'https://vercel.com/',
  'https://www.netlify.com/', 'https://www.npmjs.com/', 'https://pypi.org/', 'https://docs.python.org/',
  // 國際品牌在其他國家的官方網域
  'https://www.google.co.jp/', 'https://www.google.de/', 'https://www.amazon.de/', 'https://www.apple.com.cn/',
  'https://www.carrefour.fr/', 'https://www.rakuten.co.jp/', 'https://www.paypal.me/abc', 'https://www.netflix.co.uk/',
  'https://www.booking.cn/', 'https://www.costco.co.jp/', 'https://www.agoda.co.jp/',
  // 金融資訊（非清單上的機構）
  'https://www.finance.yahoo.com/', 'https://www.investing.com/', 'https://www.tradingview.com/', 'https://www.cnyes.com/',
  'https://www.wantgoo.com/', 'https://www.goodinfo.tw/', 'https://www.stockfeel.com.tw/', 'https://www.moneyweekly.com.tw/',
];

export const SCAM = [
  // 監理站、罰單
  'https://mvdis-gov.tw-vip.top/', 'https://mvdis.gov-tw.cc/fine', 'https://www.mvdis-gov.xyz/pay', 'https://thb-gov-tw.icu/',
  'https://tw-mvdis.bond/', 'https://mvdis.tw-fine.cyou/', 'https://mvdls.gov-tw.net/',
  // ETC 通行費
  'https://fetc-net-tw.cc/', 'https://www.fetc.net.tw-pay.top/', 'https://fetc-tw.sbs/etag', 'https://etc-fetc.vip/',
  'https://fetcnet-tw.com/', 'https://fetc.tw-etc.xyz/',
  // 中華郵政、包裹、關稅
  'https://post-gov-tw.cfd/', 'https://www.post.gov.tw.track-parcel.top/', 'https://tw-post.icu/track', 'https://twpost-delivery.top/',
  'https://chunghwapost-tw.com/', 'https://post.gov-tw.vip/', 'https://ezway-customs.xyz/', 'https://ezway-tw.cc/tax',
  // 停車費
  'https://pma.gov-taipei.top/', 'https://parking-gov-tw.cc/', 'https://gov-taipei.vip/parking',
  // 健保、電子發票、台電
  'https://nhi-gov-tw.xyz/', 'https://einvoice-tw.cc/', 'https://einvoice.nat.gov.tw.prize.top/', 'https://taipower-tw.bond/',
  'https://taipower-bill.cc/', 'https://tw-taipower.top/',
  // 銀行
  'https://ctbc-card.vip/', 'https://ctbcbank-tw.com/', 'https://www.ctbcbank.com-login.top/', 'https://ctbcbamk.com/',
  'https://esun-reward.top/', 'https://esunbank.tw-point.cc/', 'https://cathaybk-tw.com/', 'https://cathay-bk.top/',
  'https://fubon-card.xyz/', 'https://taishinbank.com.tw.login-verify.cc/', 'https://megabank-tw.top/', 'https://sinopac-tw.vip/',
  'https://www.bot-com-tw.cc/', 'https://landbank-tw.xyz/', 'https://firstbank.com.tw.secure.top/', 'https://hncb-tw.top/',
  // 電商、超商、賣貨便
  'https://shopee-tw-service.com/', 'https://shopee.tw-verify.top/', 'https://shopee-tw.cc/', 'https://shoppe-tw.com/',
  'https://7-11-myship.com/', 'https://myship-711.cc/', 'https://myship.7-11.com.tw.order.top/', 'https://ibon-tw.vip/',
  'https://momoshop-tw.top/', 'https://pchome-24h.vip/', 'https://famiport-tw.cc/',
  // 支付、電信
  'https://line-pay-tw.com/', 'https://linepay-tw.top/', 'https://jkopay-tw.cc/', 'https://cht-point.shop/',
  'https://hinet-tw.cc/', 'https://taiwanmobile-point.top/',
  // 國際品牌
  'https://apple-id-verify.top/', 'https://xn--pple-43d.com/', 'https://icloud-support.cc/', 'https://paypal-resolution.top/',
  'https://netflix-billing.xyz/', 'https://binance-tw.vip/', 'https://maicoin-tw.top/', 'https://steamcommunity-gift.xyz/',
  // 政府泛稱
  'https://gov-tw.top/', 'https://www.gov.tw.subsidy.cc/', 'https://tw-gov.vip/', 'https://moda-gov-tw.xyz/',
];

// 第二批：先寫好、未經調校就測（當時 44 個抓到 38 個危險），之後才依原則修正並加入回歸測試
export const SCAM_HOLDOUT = [
  'https://twmvdis.com/', 'https://mvdis-tw.org/', 'https://e-mvdis.net/', 'https://fetc-etag.com/', 'https://etag-fetc.net/',
  'https://www.fetcpay.cc/', 'https://twpost-parcel.com/', 'https://post-tw.org/', 'https://einvoice-prize.com/',
  'https://nhi-refund.top/', 'https://taipower-refund.com/', 'https://ctbcbank.net/', 'https://ctbc.cc/', 'https://my-ctbc.com/',
  'https://esunbank.co/', 'https://esun-bank.net/', 'https://cathaybank-tw.com/', 'https://fubonbank.top/', 'https://taishin-card.com/',
  'https://shopee.com.tw.cc/', 'https://shopeetw.net/', 'https://shopee-seller.top/', 'https://711-myship.top/', 'https://myship7-11.com/',
  'https://ibon-ticket.cc/', 'https://linepay.tw/', 'https://line-points.top/', 'https://jkopay.cc/', 'https://apple-icloud.com/',
  'https://appleid-support.net/', 'https://paypa1.com/', 'https://netfllx.com/', 'https://binance-verify.com/', 'https://gov-taipei.net/',
  'https://taipei-gov.top/', 'https://www.gov-tw.org/', 'https://customs-ezway.com/', 'https://ezway.tw/', 'https://momo-shop.cc/',
  'https://pchome24h.cc/', 'https://thsrc-ticket.top/', 'https://railway-gov.cc/', 'https://hinet-mail.top/', 'https://cht-reward.com/',
];
