// 繳費、刷卡相關的參考資料

// 正規金流服務：正規商店的刷卡欄位通常放在這些服務的框架（iframe）或頁面裡，卡號不會經過商店自己的網站
export const GATEWAY_HOSTS = {
  'tappaysdk.com': 'TapPay', 'stripe.com': 'Stripe', 'stripe.network': 'Stripe', 'adyen.com': 'Adyen', 'adyenpayments.com': 'Adyen',
  'ecpay.com.tw': '綠界科技', 'newebpay.com': '藍新金流', 'ezpay.com.tw': 'ezPay 簡單付', 'payuni.com.tw': '統一金流 PAYUNi',
  'paypal.com': 'PayPal', 'braintreegateway.com': 'Braintree', 'checkout.com': 'Checkout.com', 'gomypay.asia': '萬事達金流',
  'esafe.com.tw': '紅陽科技', 'fisc.com.tw': '財金資訊', 'nccc.com.tw': '聯合信用卡處理中心', 'jkopay.com': '街口支付',
  'pay.line.me': 'LINE Pay', 'pay.google.com': 'Google Pay', 'squareup.com': 'Square', 'shopline.tw': 'SHOPLINE Payments',
};

// 信用卡 3D 驗證（3-D Secure）服務商：真正的 3D 驗證頁會在發卡銀行或這些服務的網域
export const ACS_HOSTS = ['cardinalcommerce.com', 'arcot.com', 'modirum.com', 'gpayments.net', 'netcetera.com', 'hitrust.com.tw',
  'twca.com.tw', 'wlp-acs.com', 'securecode.com', 'visa.com', 'mastercard.com', 'jcb.co.jp', 'americanexpress.com'];

// 很多正常網站會直接載入的政府圖示（無障礙標章、政府入口網），不算「抄襲官網」
export const COMMON_EMBED_HOSTS = /^(accessibility\.[a-z.]+\.gov\.tw|www\.gov\.tw|egov\.gov\.tw|maps\.nlsc\.gov\.tw)$/;

// 各種繳費名目的正確管道（警告畫面告訴使用者該去哪裡繳）
export const PAYMENT_CHANNELS = [
  {
    topic: '關稅、包裹報關', match: /關稅|易利委|ezway|海關|報關/i,
    items: [{ name: 'EZ WAY 易利委 App（財政部關務署）' }, { name: '財政部關務署', url: 'https://web.customs.gov.tw/' }],
  },
  {
    topic: 'ETC 通行費', match: /通行費|etag|\betc\b|遠通電收|高速公路/i,
    items: [{ name: '遠通電收官網', url: 'https://www.fetc.net.tw/' }, { name: '遠通電收 eTag App' }, { name: '超商繳費' }],
  },
  {
    topic: '停車費', match: /停車/,
    items: [
      { name: '各縣市停車管理單位網站（網址以 .gov.tw 結尾，臺北市為 .gov.taipei）' },
      { name: '超商繳費（7-ELEVEN、全家、萊爾富、OK）' },
      { name: '行動支付 App 內的停車費功能（台灣 Pay、街口、LINE Pay 等）' },
      { name: '全國繳費網', url: 'https://ebill.ba.org.tw/' },
    ],
  },
  {
    topic: '交通罰單', match: /罰單|罰鍰|交通違規|監理/,
    items: [{ name: '監理服務網', url: 'https://www.mvdis.gov.tw/' }, { name: '各地監理站、超商（帶繳費單）' }, { name: '全國繳費網', url: 'https://ebill.ba.org.tw/' }],
  },
  {
    topic: '電費', match: /電費|台電|臺電|台灣電力|臺灣電力|停止供電|斷電/,
    items: [{ name: '台灣電力公司', url: 'https://www.taipower.com.tw/' }, { name: '台灣電力 App' }, { name: '超商、銀行代繳' }],
  },
  {
    topic: '水費', match: /水費|自來水|停水/,
    items: [{ name: '台灣自來水公司', url: 'https://www.water.gov.tw/' }, { name: '臺北自來水事業處', url: 'https://www.water.gov.taipei/' }, { name: '超商、銀行代繳' }],
  },
  {
    topic: '包裹、郵件', match: /包裹|投遞|(?<!電子)郵件|地址不完整|地址有誤|補運費|再配達|配達/,
    items: [
      { name: '中華郵政郵件查詢', url: 'https://www.post.gov.tw/' },
      { name: '黑貓宅急便', url: 'https://www.t-cat.com.tw/' },
      { name: '新竹物流', url: 'https://www.hct.com.tw/' },
      { name: '包裹不會因為「地址不完整」要你先付小額運費或刷卡' },
    ],
  },
  {
    topic: '健保費', match: /健保/,
    items: [{ name: '衛生福利部中央健康保險署', url: 'https://www.nhi.gov.tw/' }, { name: '健保快易通 App' }],
  },
  {
    topic: '日本的稅務、還付金', match: /還付金|e-?tax|国税庁|税務署/i,
    items: [{ name: 'e-Tax（日本国税庁）', url: 'https://www.e-tax.nta.go.jp/' }, { name: '還付金會直接匯入你登記的帳戶，不需要點信件連結' }],
  },
  {
    topic: '稅務、退稅', match: /稅|國稅局|退稅/,
    items: [{ name: '財政部稅務入口網', url: 'https://www.etax.nat.gov.tw/' }, { name: '退稅會直接退回你登記的帳戶，不需要點簡訊連結或刷卡' }],
  },
  {
    topic: '政府補助、運動幣、普發現金', match: /補助|補貼|運動幣|動滋券|健康幣|普發|振興券|紓困/,
    items: [{ name: '政府活動網站都在 .gov.tw，請從主辦機關官網或「我的E政府」進入', url: 'https://www.gov.tw/' }, { name: '政府發放的補助不會要你先付錢、輸入信用卡或簡訊驗證碼' }],
  },
];
