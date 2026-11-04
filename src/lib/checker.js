// 判斷引擎：
//   assessUrl()  只看網址 → 官方／政府／未知／可疑／危險
//   assessPage() 再看網頁內容 → 「頁面自稱是某機構、要你付錢或輸入密碼，但網址不是那個機構的」
// 不依賴瀏覽器 API，可以在 Node.js 直接測試。

import {
  parseHost, findDomainInSet, toUnicodeLabel, toUnicodeHost, skeleton, hasMixedScripts, editDistance, isPrivateHost,
} from './domain.js';
import { TLD_RISK, BRAND_TLDS, COMMON_WORDS } from '../data/risk-data.js';
import { LABEL_MODEL } from '../data/label-model.js';
import { labelScore } from './label-model-core.js';
import {
  OFFICIAL_SITES, USER_CONTENT_RULES, GOV_ALIASES, GOV_PROGRAMS, PAYMENT_THEMES, BENEFIT_THEMES, TRANSFER_KEYWORDS,
  STORE_CODE_KEYWORDS, CRYPTO_KEYWORDS, INVESTMENT_GUARANTEE, INVESTMENT_HYPE, ANTI_FRAUD_WORDS,
} from '../data/official-sites.js';

export const DANGER_SCORE = 60;
export const CAUTION_SCORE = 30;

const SENSITIVE_CATEGORIES = new Set(['政府機關', '公用事業', '銀行', '證券金融', '保險', '支付', '物流', '加密貨幣']);
// 這些類別的名稱常以「付款方式」出現在一般商店結帳頁，所以只在網頁標題自稱時才算冒名
const TITLE_ONLY_CATEGORIES = new Set(['支付', '網路服務']);

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'reurl.cc', 'lihi.cc', 'lihi1.cc', 'lihi1.com', 'pse.is', 'ppt.cc', 'is.gd', 'cutt.ly',
  'shorturl.at', 'rb.gy', 't.ly', 'ow.ly', 'buff.ly', 'rebrand.ly', 's.id', 'tiny.cc', 'v.gd', 'qrco.de', 't.cn',
  'surl.li', 'short.gy', 'gg.gg', 'goo.su',
]);

const URL_BAIT_WORDS = new Set([
  'login', 'signin', 'verify', 'verification', 'secure', 'account', 'update', 'wallet', 'refund', 'bonus', 'claim',
  'reward', 'airdrop', 'kyc', 'unlock', 'suspend', 'confirm', 'billing', 'payment', 'pay', 'parking', 'toll', 'fine',
  'penalty', 'parcel', 'delivery', 'redelivery', 'invoice', 'tax', 'etc', 'unpaid', 'overdue', 'gift', 'prize', 'lucky',
  'lottery', 'coupon', 'voucher', 'points', 'point', 'subsidy', 'redeem', 'free', 'customs', 'tariff', 'duty',
]);

// 品牌字前後常被加上的字（ctbcbank-tw、applesupport、line-lite、anydesk-en…）
const AFFIX_WORDS = ['tw', 'taiwan', 'my', 'e', 'www', 'gov', 'app', 'apps', 'web', 'online', 'login', 'signin', 'secure', 'security', 'verify',
  'service', 'services', 'support', 'help', 'account', 'accounts', 'id', 'pay', 'card', 'cards', 'bank', 'official', 'vip', 'net',
  'center', 'update', 'member', 'members', 'client', 'customer', 'cs', 'info', 'point', 'points', 'reward', 'rewards', 'gift',
  'bonus', 'shop', 'store', 'mall', 'order', 'orders', 'fine', 'tax', 'bill', 'post', 'parcel', 'delivery', 'track', 'etc', 'go',
  '24h', 'en', 'android', 'ios', 'apk', 'lite', 'beta', 'mod', 'pro', 'plus', 'new', 'old', 'pc', 'download', 'install', 'get',
  'cn', 'hk', 'global', 'portal', 'gateway', 'max', 'star', 'cash', 'wallet', 'refund', 'buy', 'sale', 'tool', 'tools',
  'ticket', 'tickets'];
// 常被當成一般網域使用的國碼，不能視為「某國的官網」（paypal.cc 不是 PayPal 的可可斯群島網站）
const GENERIC_CC = new Set(['cc', 'co', 'io', 'me', 'tv', 'ai', 'ly', 'to', 'gg', 'ws', 'la', 'so', 'sh', 'fm', 'am', 'gl', 'tk',
  'ml', 'ga', 'cf', 'gq', 'pw', 'su', 'nu', 'cx', 'vc', 'ac', 'bz', 'st', 'is', 'im', 'in', 'li', 'lc', 'ms', 'mn', 'ph', 'tw']);
const BRAND_AFFIX = new RegExp(`^(\\d+|${AFFIX_WORDS.join('|')})$`);
// 由前述字詞與數字串接而成（twlogin、servicetw2）
const AFFIX_SEQ = new RegExp(`^(?:\\d+|${[...AFFIX_WORDS].sort((x, y) => y.length - x.length).join('|')})+$`);

// 和「gov」一起出現就代表在冒充地方政府的城市名
const CITY_TOKENS = new Set(['taipei', 'newtaipei', 'ntpc', 'taoyuan', 'tycg', 'taichung', 'tainan', 'kaohsiung', 'kcg', 'keelung',
  'hsinchu', 'miaoli', 'changhua', 'nantou', 'yunlin', 'chiayi', 'pingtung', 'yilan', 'hualien', 'taitung', 'penghu', 'kinmen', 'matsu']);

// ───────────────────────── 建立比對用的索引 ─────────────────────────

export function buildContext({ sites = OFFICIAL_SITES, userTrusted = [], userBlocked = [], blocklist = [], lineIds = [], useModel = true } = {}) {
  const officialDomains = new Map();
  const labels = [];
  const keywords = [];
  const claims = [];
  const stems = [];
  const genericDomains = new Set();
  const siteByName = new Map();
  for (const raw of sites) {
    const site = { ...raw, sensitive: SENSITIVE_CATEGORIES.has(raw.category) };
    siteByName.set(site.name, site);
    for (const d of site.domains) {
      officialDomains.set(d, site);
      // generic：true＝整個機構的網域都是一般單字；陣列＝只有列出的網域是一般單字（例：Microsoft 的 office.com）
      if (site.generic === true || (Array.isArray(site.generic) && site.generic.includes(d))) { genericDomains.add(d); continue; }
      const p = parseHost(d);
      if (p.registrable === d && p.label.length >= 5) {
        labels.push({ label: p.label, skel: skeleton(p.label), domain: d, site });
        if (p.label.length >= 6) stems.push({ stem: p.label, site, domain: d });
      }
    }
    site.kwSet = new Set((site.keywords || []).map((k) => k.replace(/\+$/, '').toLowerCase()));
    site.labelSet = new Set(site.domains.map((d) => parseHost(d).label));
    for (const raw of site.keywords || []) {
      // 「line+」：太常見的短字，只有搭配 points、pay、tw 這類字一起出現才算（line-points.top）
      const needsAffix = raw.endsWith('+');
      const kw = raw.replace(/\+$/, '').toLowerCase();
      keywords.push({ kw, site, needsAffix });
      if (!needsAffix && kw.length >= 6) stems.push({ stem: kw, site, domain: site.domains[0] });
    }
    // stems：夠獨特的品牌字，只要出現在網域開頭或結尾就算（shopeeta.cyou、newebservice.com）
    for (const st of site.stems || []) stems.push({ stem: st, site, domain: site.domains[0] });
    for (const alias of site.aliases || []) {
      const scope = site.anyText ? 'body' : TITLE_ONLY_CATEGORIES.has(site.category) ? 'title' : 'identity';
      claims.push({ alias: normText(alias), display: alias, site, scope });
    }
  }
  const brandTlds = new Map();
  for (const [tld, name] of Object.entries(BRAND_TLDS)) if (siteByName.has(name)) brandTlds.set(tld, siteByName.get(name));
  const uniqStems = [...new Map(stems.map((x) => [x.stem, x])).values()];
  return {
    officialDomains,
    genericDomains,
    labels,
    keywords,
    stems: uniqStems,
    claims,
    brandTlds,
    officialCount: officialDomains.size,
    userTrusted: new Set(userTrusted),
    userBlocked: new Set(userBlocked),
    blocklist: blocklist instanceof Set ? blocklist : new Set(blocklist),
    lineIds: lineIds instanceof Set ? lineIds : new Set(lineIds.map(normalizeLineId).filter(Boolean)),
    labelModel: useModel ? LABEL_MODEL : null,
  };
}

function officialUrl(site, domain) {
  const host = site.home || (domain && parseHost(domain).registrable === domain ? 'www.' + domain : domain) || site.domains[0];
  return 'https://' + host + '/';
}

function lookupOfficial(host, ctx) {
  const hit = findDomainInSet(host, new SetView(ctx.officialDomains));
  if (hit) return { site: ctx.officialDomains.get(hit), domain: hit };
  const tld = host.split('.').pop();
  if (ctx.brandTlds && ctx.brandTlds.has(tld)) return { site: ctx.brandTlds.get(tld), domain: '.' + tld };
  return null;
}

// 讓 Map 可以直接丟給 findDomainInSet 使用
class SetView {
  constructor(map) { this.map = map; this.size = map.size; }
  has(k) { return this.map.has(k); }
}

function matchUserContent(host, path) {
  return USER_CONTENT_RULES.find((r) => (r.host === host || (r.suffix && host.endsWith('.' + r.suffix))) && (!r.path || r.path.test(path))) || null;
}

function govLabel(host) {
  if (host.endsWith('.gov.tw') || host === 'gov.tw') return '中華民國政府機關網域（.gov.tw）';
  if (host.endsWith('.edu.tw')) return '教育／學術機構網域（.edu.tw）';
  if (host.endsWith('.mil.tw')) return '國軍網域（.mil.tw）';
  return null;
}

function affixMatch(token, brand) {
  if (token === brand) return true;
  if (token.startsWith(brand) && BRAND_AFFIX.test(token.slice(brand.length))) return true;
  if (token.endsWith(brand) && BRAND_AFFIX.test(token.slice(0, token.length - brand.length))) return true;
  return false;
}

/** 品牌字被通用字包住（myctbcbanktw、ctbcbankservice）；前後若有其他字（nanshangeneral）則不算 */
function wrappedMatch(s, brand) {
  let i = s.indexOf(brand);
  while (i >= 0) {
    const pre = s.slice(0, i), post = s.slice(i + brand.length);
    if ((pre === '' || AFFIX_SEQ.test(pre)) && (post === '' || AFFIX_SEQ.test(post)) && (pre || post)) return true;
    i = s.indexOf(brand, i + 1);
  }
  return false;
}

// 外觀容易看錯的字元：只差這種字（ctbcbamk、paypa1）比只差一般字母（taiwanplay）更像刻意仿冒
const VISUAL_PAIRS = ['mn', 'nm', 'il', 'li', '1l', 'l1', '1i', 'i1', '0o', 'o0', 'uv', 'vu', 'ce', 'ec', 'gq', 'qg', 'hn', 'nh'];
function visualEdit(a, b) {
  if (a.length !== b.length) {
    // 少打或多打一個重複字母（goggle、shopee→shope）
    const [l, s2] = a.length > b.length ? [a, b] : [b, a];
    for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s2) return i > 0 && l[i] === l[i - 1];
    return false;
  }
  const diff = [...a].map((c, i) => (c === b[i] ? null : i)).filter((i) => i !== null);
  if (diff.length === 2 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]) return true; // 前後對調
  if (diff.length !== 1) return false;
  const i = diff[0];
  // 重複字母換了位置（shoppe／shopee、goggle／google）看起來幾乎一樣
  const doubled = (w) => w[i] === w[i - 1] || w[i] === w[i + 1];
  return VISUAL_PAIRS.includes(a[i] + b[i]) || doubled(a) || doubled(b);
}

/** 網域開頭或結尾是品牌字（可容許一個字的差異） */
function stemAt(label, stem) {
  if (label.length <= stem.length) return null;
  if (label.startsWith(stem)) return 'prefix';
  if (label.endsWith(stem)) return 'suffix';
  if (stem.length >= 7) {
    for (const n of [stem.length - 1, stem.length, stem.length + 1]) {
      if (n < label.length && editDistance(label.slice(0, n), stem, 1) === 1) return 'prefix-typo';
    }
  }
  return null;
}

/** LINE ID 統一成小寫、去掉 @ 與 ~ */
export function normalizeLineId(id) {
  const t = String(id || '').trim().toLowerCase().replace(/^[@~]/, '');
  return /^[a-z0-9._-]{2,40}$/.test(t) ? t : '';
}

/** 從 line.me 加好友網址取出 LINE ID（line.me/ti/p/~abc、line.me/R/ti/p/@abc） */
export function lineIdFromUrl(u) {
  if (!/^(www\.)?line\.me$/.test(u.hostname)) return '';
  const m = u.pathname.match(/^\/(?:R\/)?ti\/p\/([^/?#]+)/i);
  return m ? normalizeLineId(decodeURIComponent(m[1])) : '';
}

/**
 * 清單淨化：外部清單（165、TWNIC、自訂網址）裡若混進官方網域、政府網域或「後綴本身」（com.tw），
 * 一律剔除，避免把 google.com、某個 .gov.tw 整個擋掉。
 */
export function isProtectedDomain(domain, ctx) {
  const p = parseHost(domain);
  if (!p.host || !p.label || p.registrable === p.suffix || !p.host.includes('.')) return true;
  const official = lookupOfficial(p.host, ctx);
  if (official) {
    // 雲端儲存空間（xxx.s3.amazonaws.com）的子網域屬於個別使用者，可以單獨封鎖；平台本身（amazonaws.com）不行
    const ugc = USER_CONTENT_RULES.find((r) => r.suffix && p.host.endsWith('.' + r.suffix));
    // s3.amazonaws.com、s3.ap-east-1.amazonaws.com 是共用服務端點，前面接了個別名稱的才是使用者自己的空間
    const endpoint = /^(s3([.-].*)?|storage|www|static|cdn)$/.test(p.host.split('.')[0]);
    return !(ugc && p.host !== ugc.suffix && !endpoint);
  }
  if (govLabel(p.host) || p.host === 'gov.taipei' || p.host.endsWith('.gov.taipei')) return true;
  // 清單項目是官方網域的上層（例如列了 com.tw）
  for (const d of ctx.officialDomains.keys()) if (d.endsWith('.' + p.host)) return true;
  return false;
}

function levelFor(score) {
  return score >= DANGER_SCORE ? 'danger' : score >= CAUTION_SCORE ? 'caution' : 'unknown';
}

// ───────────────────────── 網址判斷 ─────────────────────────

/**
 * @param {string} raw 網址
 * @param {object} ctx buildContext() 的結果
 * @param {{domainAgeDays?: number}} extra 額外資訊（例如網域註冊天數）
 */
export function assessUrl(raw, ctx, extra = {}) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { level: 'invalid', score: 0, url: String(raw), host: '', displayHost: '', registrable: '', reasons: [{ text: '這不是有效的網址', weight: 0 }], match: null, impersonating: null };
  }
  const p = parseHost(u.hostname);
  const out = {
    level: 'unknown', score: 0, url: u.href, host: p.host, displayHost: toUnicodeHost(p.host), registrable: p.registrable,
    reasons: [], match: null, impersonating: null,
  };
  if (!/^https?:$/.test(u.protocol) || !p.host) return { ...out, level: 'skip' };
  if (isPrivateHost(p.host)) return { ...out, level: 'skip', reasons: [{ text: '這是本機或區域網路位址', weight: 0 }] };

  // 1. 使用者自訂封鎖
  const blockedHit = findDomainInSet(p.host, ctx.userBlocked);
  if (blockedHit) return { ...out, level: 'danger', score: 100, source: 'list', reasons: [{ text: `你把「${blockedHit}」加入了自訂封鎖清單`, weight: 100 }] };

  // 2. 使用者自訂信任
  const trustedHit = findDomainInSet(p.host, ctx.userTrusted);
  if (trustedHit) return { ...out, level: 'trusted', reasons: [{ text: `你把「${trustedHit}」加入了自訂信任清單`, weight: 0 }] };

  // 3. 官方網站清單
  const official = lookupOfficial(p.host, ctx);
  if (official) {
    const { site, domain } = official;
    const match = { name: site.name, category: site.category, domain };
    const lineId = lineIdFromUrl(u);
    if (lineId && ctx.lineIds.has(lineId)) {
      return { ...out, level: 'danger', score: 100, match, reasons: [{ text: `這個 LINE 帳號「${lineId}」列在 165 詐騙 LINE ID 清單中，請不要加好友`, weight: 100 }] };
    }
    const ugc = matchUserContent(p.host, u.pathname);
    if (ugc) {
      return {
        ...out, level: 'platform', score: 10, match,
        reasons: [{ text: `網域確實屬於「${site.name}」，但這是${ugc.note}，內容不代表任何官方機構。官方機構不會用這種方式要你繳費或轉帳。`, weight: 10 }],
      };
    }
    const reasons = [{ text: `「${domain}」是「${site.name}」的官方網域（${site.category}）`, weight: 0 }];
    if (u.protocol === 'http:') reasons.push({ text: '目前連線沒有加密（http），請勿輸入密碼或付款資料', weight: 0 });
    return { ...out, level: 'official', match, reasons };
  }

  // 4. 165 涉詐網域清單
  const fraudHit = findDomainInSet(p.host, ctx.blocklist);
  if (fraudHit) {
    return { ...out, level: 'danger', score: 100, source: 'list', reasons: [{ text: `「${fraudHit}」列在 165 反詐騙「涉詐網域」清單中`, weight: 100 }] };
  }

  // 5. 受管制的政府／學術網域（只有政府機關、學校能申請）
  const gov = govLabel(p.host);
  if (gov) return { ...out, level: 'gov', match: { name: gov, category: '政府機關', domain: p.registrable }, reasons: [{ text: `這是${gov}，只有政府機關或學校能申請`, weight: 0 }] };

  // 6. 特徵分析
  const reasons = [];
  const tld = p.host.split('.').pop();
  // .com.tw、.org.tw 等需要公司或組織證件才能註冊；實測詐騙網址中只占 1%，品牌相關的線索減半計分
  const verifiedTw = /^(com|org|net|idv|game|ebiz|club)\.tw$/.test(p.suffix);
  let imp = null; // 冒名線索只取最強的一個，避免同一件事重複加分
  let globalCountry = false; // 跨國品牌在其他國家的網站
  const globalSites = new Set();
  const setImp = (weight, text, site, domain, kind = 'brand') => {
    // 明確的冒名線索（40 分以上）再加 10 分；政府泛稱已經是高分，不另加
    let w = weight + (site && site.domains && weight >= 40 ? 10 : 0);
    if (verifiedTw && kind === 'brand') w = Math.round(w / 2);
    if (!imp || w > imp.weight) imp = { weight: w, text, site, domain, kind };
  };

  const uLabel = toUnicodeLabel(p.label);
  const skel = skeleton(uLabel);
  const subTokens = p.sub ? p.sub.split(/[.\-_]/).filter(Boolean) : [];
  const labelTokens = uLabel.split(/[-_]/).filter(Boolean);
  const hostTokens = p.host.split(/[.\-_]/).filter(Boolean);
  const compactLabel = p.label.replace(/[-_]/g, '');
  const compactHost = p.host.replace(/[.\-_]/g, '');
  const isCommonWord = COMMON_WORDS.has(compactLabel);
  // 網域本身只由 tw、fine、point 這類通用字組成（例：tw-fine.cyou），代表它沒有自己的品牌，前段的品牌名就更可疑
  const genericRegistrable = labelTokens.every((t) => BRAND_AFFIX.test(t) || URL_BAIT_WORDS.has(t));
  // 便宜後綴上的隨機網域，前段又放品牌名（newebpay658.tw-0kj.shop）也一樣可疑
  const subBrandWeight = genericRegistrable || (TLD_RISK[tld] || 0) >= 15 ? 45 : 25;

  // 6a. 冒充政府網域（.com.tw 的「tw」是後綴本身，不算）
  const regGovTokens = [...labelTokens, ...(p.suffix === 'tw' ? ['tw'] : [])];
  const allGovTokens = [...subTokens, ...regGovTokens];
  const separated = (toks) => toks.includes('gov') && (toks.includes('tw') || toks.some((t) => CITY_TOKENS.has(t)));
  const concatenated = (toks) => /govtw|twgov/.test(toks.join(''));
  const riskyRegistrable = genericRegistrable || (TLD_RISK[tld] || 0) >= 15;
  if (separated(regGovTokens) || (separated(allGovTokens) && riskyRegistrable)) {
    // gov-tw.top、mvdis.gov-tw.cc、www.gov.tw.subsidy.cc
    setImp(70, '網址裡出現「gov.tw」字樣，但其實不是政府網域（真正的政府網址一定是以 .gov.tw 結尾）', { name: '政府機關' }, null, 'gov');
  } else if (concatenated(regGovTokens) || separated(allGovTokens) || concatenated(allGovTokens)) {
    // opengovtw.com、tw-gov.某公司.com：不是政府網域，但也可能是公民科技或廠商網站
    setImp(45, '網址裡有「gov」「tw」字樣，但不是政府網域（政府網址一定以 .gov.tw 結尾）', { name: '政府機關' }, null, 'gov');
  } else if (allGovTokens.includes('nat') && allGovTokens.includes('tw')) {
    setImp(60, '網址模仿財政部的「nat.gov.tw」，但不是政府網域', { name: '財政部' }, null, 'gov');
  } else if (labelTokens.includes('gov')) {
    setImp(35, '網址含「gov」字樣，但不是政府網域', { name: '政府機關' }, null, 'gov');
  } else if (subTokens.includes('gov')) {
    setImp(20, '網址前段含「gov」字樣，但不是政府網域', { name: '政府機關' }, null, 'gov');
  }

  // 6b. 把官方網址藏在前面，或用「-」假裝是官方子網域
  const dotted = '.' + p.host.replace(/[-_]/g, '.') + '.';
  for (const [d, site] of ctx.officialDomains) {
    if (d.split('.')[0].length < 3 || ctx.genericDomains.has(d)) continue;
    const dd = d.replace(/[-_]/g, '.'); // 7-11.com.tw 在 dotted 裡會變成 7.11.com.tw
    const idx = dotted.indexOf('.' + dd + '.');
    if (idx < 0) continue;
    const rest = dotted.slice(idx + dd.length + 2); // 官方網址後面還接了什麼
    if (rest === '') {
      // secure-ctbcbank.com：前面接的是 secure、login 這類字才是典型偽裝
      const prefix = dotted.slice(1, idx).split('.').filter(Boolean);
      const typical = prefix.every((t) => BRAND_AFFIX.test(t) || URL_BAIT_WORDS.has(t));
      setImp(typical ? 65 : 40, `用「-」把網址偽裝成「${d}」底下的網址，但實際網域是 ${p.registrable}`, site, d);
    } else if (/^[a-z]{2}\.$/.test(rest)) {
      const cc = rest.slice(0, -1);
      if (site.global && !GENERIC_CC.has(cc)) { globalCountry = true; setImp(15, `可能是「${site.name}」在其他國家的網站（${d}.${cc}）`, site, d); }
      else setImp(45, `網址是「${d}」後面再加上「.${cc}」，並不是官方網域`, site, d);
    } else {
      setImp(70, `把官方網址「${d}」藏在網址前段，實際網域其實是 ${p.registrable}`, site, d, 'embed');
    }
  }

  // 6c. 和官方網域名稱相同、外觀相似、差一兩個字
  const sameLabelSites = new Set();
  const countryDomain = (/^[a-z]{2}$/.test(tld) && !GENERIC_CC.has(tld)) || /^(com|co|net|org|ne|or)\.[a-z]{2}$/.test(p.suffix);
  const sameName = (site, domain, label) => {
    sameLabelSites.add(site.name);
    if (site.global && countryDomain) {
      globalCountry = true;
      setImp(15, `可能是「${site.name}」在其他國家的網站（.${p.suffix}），台灣官方網址是 ${domain}`, site, domain);
    } else {
      // 台灣的銀行、政府、支付機構不會換個後綴營業
      setImp(site.sensitive ? 55 : 45, `名稱「${label}」和「${site.name}」官方網址 ${domain} 相同，但後綴不同（.${p.suffix}）`, site, domain);
    }
  };
  for (const L of ctx.labels) {
    const name = L.site.name;
    if (uLabel === L.label) { sameName(L.site, L.domain, L.label); continue; }
    if (skel === L.skel) {
      setImp(70, `和「${name}」官方網址 ${L.domain} 幾乎一樣，只是換了長得像的字元或加了符號`, L.site, L.domain);
      continue;
    }
    if (isCommonWord) continue;
    const len = L.skel.length;
    if (Math.abs(skel.length - len) > 2) continue;
    const dist = editDistance(skel, L.skel, 2);
    if (dist === 1) {
      const visual = visualEdit(uLabel.replace(/[-_]/g, ''), L.label);
      const w = len >= 8 ? (visual ? 60 : 40) : len === 7 ? (visual ? 45 : 35) : 20;
      setImp(w, `和「${name}」官方網址 ${L.domain} 只差一個字`, L.site, L.domain);
    }
    else if (dist === 2 && len >= 10) setImp(45, `和「${name}」官方網址 ${L.domain} 只差兩個字`, L.site, L.domain);
  }

  // 6d. 網域名稱裡帶著官方品牌（ctbcbank-tw.com、shoppe-tw.com）
  // 網域名稱本身就是某個官方品牌（etmall.com 是東森），就不再拆出別的品牌（tmall）
  const ownBrand = sameLabelSites.size > 0;
  for (const L of ctx.labels) {
    if (uLabel === L.label || ownBrand) continue;
    if (labelTokens.length > 1 && L.skel.length >= 6) {
      const near = labelTokens.find((t) => t !== L.label && t.length >= 5 && !COMMON_WORDS.has(t) && editDistance(skeleton(t), L.skel, 1) <= 1
        && (skeleton(t) === L.skel || visualEdit(t, L.label)));
      if (near && labelTokens.some((t) => t !== near && BRAND_AFFIX.test(t))) {
        setImp(50, `網址裡的「${near}」很像「${L.site.name}」的「${L.label}」，又加上「-${labelTokens.filter((t) => t !== near).join('-')}」`, L.site, L.domain);
      }
    }
    const withLabel = labelTokens.some((t) => affixMatch(t, L.label)) || wrappedMatch(compactLabel, L.label);
    const plainCompanions = labelTokens.every((t) => t === L.label || affixMatch(t, L.label) || BRAND_AFFIX.test(t) || URL_BAIT_WORDS.has(t) || L.site.kwSet.has(t));
    if (withLabel && L.site.global && countryDomain) {
      globalCountry = true; // rakuten-card.co.jp、hsbc.com.my
      globalSites.add(L.site.name);
      setImp(15, `可能是「${L.site.name}」在其他國家的網站（${p.registrable}）`, L.site, L.domain);
    } else if (withLabel && (plainCompanions || wrappedMatch(compactLabel, L.label))) {
      setImp(55, `網址包含「${L.site.name}」的名稱「${L.label}」，但不是官方網域（官方是 ${L.domain}）`, L.site, L.domain);
    } else if (withLabel) {
      // ife-tigerairtw：品牌名稱加上不認得的字，可能是同集團網站，也可能是冒名
      setImp(30, `網址含「${L.site.name}」的名稱「${L.label}」，但不在官方清單中`, L.site, L.domain);
    } else if (subTokens.some((t) => affixMatch(t, L.label))) {
      setImp(subBrandWeight, `網址前段含「${L.site.name}」的名稱「${L.label}」，但實際網域是 ${p.registrable}`, L.site, L.domain);
    }
  }
  for (const { kw, site, needsAffix } of ctx.keywords) {
    if (sameLabelSites.has(site.name) || globalSites.has(site.name) || (ownBrand && compactLabel !== kw)) continue; // 已在 6c、6d 判斷過
    if (needsAffix) {
      const i = labelTokens.indexOf(kw);
      if (i >= 0 && labelTokens.some((t, j) => j !== i && BRAND_AFFIX.test(t))) {
        setImp(50, `網址用「${kw}」加上「${labelTokens.filter((_, j) => j !== i).join('-')}」，像在冒充「${site.name}」`, site, site.domains[0]);
      }
      continue;
    }
    if (compactLabel === kw) {
      // 關鍵字本身就是官方網域名稱（hsbc.com.hk）→ 依「後綴不同」判斷；不是網域名稱（linepay.tw）→ 直接當冒名
      if (site.labelSet.has(kw)) sameName(site, site.domains[0], kw);
      else setImp(50, `網址就是「${site.name}」的品牌字「${kw}」，但不是官方網域`, site, site.domains[0]);
      continue;
    }
    const companion = (t) => t === kw || affixMatch(t, kw) || BRAND_AFFIX.test(t) || URL_BAIT_WORDS.has(t) || site.kwSet.has(t);
    if (labelTokens.some((t) => affixMatch(t, kw)) && labelTokens.every(companion)) {
      setImp(50, `網址含「${site.name}」相關字樣「${kw}」，但不是官方網域`, site, site.domains[0]);
    } else if (wrappedMatch(compactLabel, kw)) {
      setImp(50, `網址含「${site.name}」相關字樣「${kw}」，但不是官方網域`, site, site.domains[0]);
    } else if (labelTokens.includes(kw)) {
      // cathay-cube：品牌字加上不認得的字，可能是同集團網站，也可能是冒名
      setImp(30, `網址含「${site.name}」相關字樣「${kw}」，但不在官方清單中`, site, site.domains[0]);
    } else if (subTokens.some((t) => affixMatch(t, kw))) {
      setImp(subBrandWeight, `網址前段含「${site.name}」相關字樣「${kw}」，但實際網域是 ${p.registrable}`, site, site.domains[0]);
    }
  }

  // 6e. 網域開頭或結尾就是品牌字（shopeeta.cyou、newebservice.com、vapeshopee.com、rakutsenaffilike.com）
  if (!isCommonWord && !ownBrand) {
    for (const { stem, site, domain } of ctx.stems) {
      if (sameLabelSites.has(site.name)) continue;
      const where = stemAt(compactLabel, stem);
      if (!where) continue;
      const typo = where === 'prefix-typo';
      // 品牌字後面接的是一個完整的長單字（youtuberepeat），比接上亂碼（shopeeta、shopeelem）更可能是正常網站
      const rest = where === 'suffix' ? compactLabel.slice(0, -stem.length) : compactLabel.slice(stem.length);
      const longWord = rest.length >= 5 && !AFFIX_SEQ.test(rest);
      // 品牌字後面只接 1～3 個亂碼字母（rakutenccb、rakutenxk）：正常的品牌延伸網域通常接完整單字
      const junk = where === 'prefix' && /^[bcdfghjklmnpqrstvwxz]{2,3}$/.test(rest);
      // 品牌字在結尾（ssstwitter、vapeshopee）多半是第三方工具或商店名，只算輕微線索
      setImp(longWord ? 25 : junk ? 50 : where === 'suffix' ? 30 : typo ? 35 : 40, `網域${where === 'suffix' ? '結尾' : '開頭'}${typo ? '很像' : '就是'}「${site.name}」的「${stem}」，但不是官方網域`, site, domain);
    }
  }

  // 6g. 免費架站平台上，網址路徑用了官方品牌名（xxx.github.io/shopee-coupon/）
  if (p.platform) {
    const pathTokens = new Set(u.pathname.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4));
    for (const { stem, site, domain } of ctx.stems) {
      if ([...pathTokens].some((t) => t === stem || t.startsWith(stem))) {
        setImp(30, `架站平台上的頁面用了「${site.name}」的名稱，但不是官方網站`, site, domain, 'path');
        break;
      }
    }
  }

  if (imp) {
    reasons.push({ text: imp.text, weight: imp.weight });
    if (imp.site && imp.site.domains) {
      out.impersonating = { name: imp.site.name, domain: imp.domain || imp.site.domains[0], url: officialUrl(imp.site, imp.domain) };
    } else {
      out.impersonating = { name: imp.site.name || '政府機關', domain: null, url: null, hint: '真正的政府網站網址以 .gov.tw 結尾（臺北市為 .gov.taipei）' };
    }
  }

  // 6f. 一般可疑特徵
  if (p.isIp) reasons.push({ text: '網址直接用 IP 位址，正規網站幾乎不會這樣', weight: 40 });
  if (u.username || u.password) reasons.push({ text: '網址含「@」帳號偽裝，真正前往的是 @ 後面的網站', weight: 40 });
  if (p.host.split('.').some((l) => l.startsWith('xn--'))) {
    const uni = toUnicodeHost(p.host);
    if (hasMixedScripts(uni)) reasons.push({ text: `網址混用外觀相似的外文字母（實際是 ${uni}）`, weight: 45 });
    else reasons.push({ text: `這是國際化網域（${uni}）`, weight: 10 });
  }
  const isShortener = SHORTENERS.has(p.registrable);
  const tldRisk = isShortener || p.platform || globalCountry ? 0 : TLD_RISK[tld] || 0;
  if (tldRisk) {
    const how = tldRisk >= 30 ? '最常用' : tldRisk >= 22 ? '常用' : '較常用';
    reasons.push({ text: `「.${tld}」是台灣詐騙網址${how}的網域後綴`, weight: tldRisk });
  }
  if (p.platform) reasons.push({ text: `架在免費架站平台（${p.platform}）上，任何人都能建立這種網址`, weight: 25 });
  // 網域名稱小模型：只在沒有其他冒名線索時補充，且只是輔助分數
  if (ctx.labelModel && !imp && !p.isIp && !p.platform && !isShortener && p.label.length >= 3) {
    const ms = labelScore(p.label, ctx.labelModel);
    if (ms >= ctx.labelModel.t2) reasons.push({ text: '網域名稱的拼法很像詐騙網站常見的隨機命名（本機小模型判斷）', weight: 25 });
    else if (ms >= ctx.labelModel.t1) reasons.push({ text: '網域名稱的拼法有點像詐騙網站常見的命名（本機小模型判斷）', weight: 15 });
  }
  if (isShortener) reasons.push({ text: '這是短網址，看不到真正的目的地（點開後會再檢查一次）', weight: 20 });
  if (u.protocol === 'http:') reasons.push({ text: '連線沒有加密（http）', weight: 10 });
  if (u.port && !['80', '443'].includes(u.port)) reasons.push({ text: `使用非標準連接埠（${u.port}）`, weight: 10 });
  if (subTokens.length >= 4) reasons.push({ text: '網址前段有很多層，常用來把真正的網域擠到看不見的地方', weight: 10 });
  if (p.host.length > 45) reasons.push({ text: '網址特別長', weight: 10 });
  if ((uLabel.match(/-/g) || []).length >= 2) reasons.push({ text: '網域名稱用了多個「-」', weight: 10 });

  const baitTokens = new Set([...hostTokens, ...u.pathname.toLowerCase().split(/[^a-z]+/)].filter((t) => URL_BAIT_WORDS.has(t)));
  if (baitTokens.size) reasons.push({ text: `網址含常見誘餌字（${[...baitTokens].slice(0, 3).join('、')}）`, weight: Math.min(15, baitTokens.size * 5) });

  if (typeof extra.domainAgeDays === 'number') {
    if (extra.domainAgeDays <= 30) reasons.push({ text: `這個網域才註冊 ${extra.domainAgeDays} 天`, weight: 40 });
    else if (extra.domainAgeDays <= 90) reasons.push({ text: `這個網域註冊不到三個月（${extra.domainAgeDays} 天）`, weight: 20 });
  }

  const score = Math.min(100, reasons.reduce((sum, r) => sum + r.weight, 0));
  reasons.sort((x, y) => y.weight - x.weight);
  if (!reasons.length) {
    reasons.push({ text: '不在官方網站清單中，但也沒發現明顯可疑特徵。若這個網站要你付款、轉帳或輸入個資，請先自行確認。', weight: 0 });
  }
  return { ...out, level: levelFor(score), score, reasons };
}

// ───────────────────────── 網頁內容判斷 ─────────────────────────

export function normText(s) {
  return String(s || '').replace(/[​-‏⁠﻿]/g, '').replace(/\s+/g, '').toLowerCase();
}

function findAny(haystack, words) {
  return words.filter((w) => haystack.includes(normText(w)));
}

/** 找出「轉帳／匯款到某帳號」的指示（關鍵字後面不遠處出現 10–16 位數字） */
export function findTransferInstruction(text) {
  const t = String(text || '').replace(/[​-‏﻿]/g, '');
  const lower = t.toLowerCase();
  for (const kw of TRANSFER_KEYWORDS) {
    let idx = lower.indexOf(kw.toLowerCase());
    let guard = 0;
    while (idx >= 0 && guard++ < 50) {
      const windowText = t.slice(idx, idx + 90);
      const m = windowText.match(/\d[\d\s-]{8,24}\d/g) || [];
      for (const run of m) {
        const digits = run.replace(/\D/g, '');
        if (digits.length >= 10 && digits.length <= 16 && !/^09\d{8}$/.test(digits)) return { keyword: kw, sample: windowText.trim().slice(0, 60) };
      }
      idx = lower.indexOf(kw.toLowerCase(), idx + kw.length);
    }
  }
  // 「(822) 1234-5678-9012」這種銀行代碼加帳號的寫法
  const bankCode = t.match(/[（(]\s*\d{3}\s*[)）]\s*[-－:：]?\s*(\d[\d\s-]{9,22}\d)/);
  if (bankCode && bankCode[1].replace(/\D/g, '').length >= 10) return { keyword: '銀行代碼', sample: bankCode[0].trim().slice(0, 60) };
  return null;
}

function findStoreCode(text) {
  const t = String(text || '');
  for (const kw of STORE_CODE_KEYWORDS) {
    const idx = t.toLowerCase().indexOf(kw.toLowerCase());
    if (idx < 0) continue;
    const windowText = t.slice(idx, idx + 80);
    if (/[A-Z0-9]{8,20}/.test(windowText.slice(kw.length)) && /\d{4,}/.test(windowText)) return { keyword: kw };
  }
  return null;
}

function findCrypto(text) {
  const t = String(text || '');
  const hasKw = CRYPTO_KEYWORDS.some((k) => t.toLowerCase().includes(k.toLowerCase()));
  if (!hasKw) return null;
  if (/\bT[1-9A-HJ-NP-Za-km-z]{33}\b/.test(t)) return { kind: 'TRON（USDT-TRC20）錢包地址' };
  if (/\b0x[a-fA-F0-9]{40}\b/.test(t)) return { kind: '以太坊（ERC20）錢包地址' };
  if (/\b(bc1[a-z0-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/.test(t)) return { kind: '比特幣錢包地址' };
  return null;
}

/**
 * @param {object} signals 內容腳本收集的頁面資訊
 *   title, siteName, identityText（h1、Logo、頁首）, bodyText
 *   fields  頁面上有哪些欄位 { card, cvv, expiry, password, otp, idNumber, bankAccount }
 *   typed   使用者正在輸入的內容「看起來像」什麼 { card（通過卡號檢查碼）, idNumber（通過身分證檢查碼）}，只有是非值，不含內容
 *   links   { apk: 有 APK 下載連結, chat: LINE／Telegram 加好友連結數, lineIds: 頁面上的 LINE ID }
 *   exfil   網頁程式把資料送往 Telegram／Discord 時的名稱
 *   formHosts 表單送出的目的網站
 *   isHttp  是否未加密
 * @param {object} ctx
 * @param {object} base assessUrl() 的結果
 */
export function assessPage(signals, ctx, base) {
  if (!base || ['official', 'gov', 'trusted', 'skip', 'invalid'].includes(base.level)) return { ...base, page: null };
  const f = { ...(signals.fields || {}) };
  if (signals.typed && signals.typed.card) f.card = true;
  if (signals.typed && signals.typed.idNumber) f.idNumber = true;
  const links = signals.links || {};
  const titleText = normText(`${signals.title || ''} ${signals.siteName || ''}`);
  const identityText = titleText + normText(signals.identityText);
  const bodyNorm = normText(signals.bodyText);
  const allNorm = identityText + bodyNorm;
  const rawBody = `${signals.identityText || ''}\n${signals.bodyText || ''}`;

  // 這個頁面「要什麼」
  const transfer = findTransferInstruction(rawBody);
  const storeCode = findStoreCode(rawBody);
  const crypto = findCrypto(rawBody);
  const asks = [];
  if (f.card || f.cvv || f.expiry) asks.push('信用卡資料');
  if (f.bankAccount) asks.push('銀行帳號');
  if (transfer) asks.push('轉帳／匯款');
  if (storeCode) asks.push('超商代碼繳費');
  if (crypto) asks.push('虛擬貨幣轉帳');
  const money = asks.length > 0;
  const creds = [];
  if (f.password) creds.push('密碼');
  if (f.otp) creds.push('簡訊驗證碼');
  if (f.idNumber) creds.push('身分證字號');
  if (f.bankAccount) creds.push('網銀帳號');

  // 這個頁面「自稱是誰」
  let claim = null;
  for (const c of ctx.claims) {
    const where = c.scope === 'title' ? titleText : c.scope === 'identity' ? identityText : allNorm;
    if (c.alias && where.includes(c.alias)) { claim = c; break; }
  }
  // 補助名目（運動幣、普發現金…）本身就代表「自稱政府」
  const govProgram = findAny(allNorm, GOV_PROGRAMS)[0] || null;
  const govStrong = findAny(identityText, GOV_ALIASES)[0] || null;
  const govBody = govStrong || findAny(bodyNorm, GOV_ALIASES)[0] || govProgram;
  const payThemes = findAny(allNorm, PAYMENT_THEMES);
  const benefitThemes = findAny(allNorm, BENEFIT_THEMES);
  const themes = [...payThemes, ...benefitThemes];
  const strongCreds = f.otp || f.idNumber || f.bankAccount || f.card || f.cvv;

  const reasons = [];
  let impersonating = base.impersonating;
  const asksText = asks.join('、');
  const add = (w, text) => { reasons.push({ text, weight: w }); };
  const govImp = (name) => ({ name, domain: null, url: null, hint: '真正的政府網站網址以 .gov.tw 結尾（臺北市為 .gov.taipei）' });

  if (money && claim) {
    add(85, `頁面自稱是「${claim.display}」，要你提供${asksText}，但網址 ${base.displayHost} 不是「${claim.site.name}」的官方網址（官方是 ${claim.site.domains[0]}）`);
    impersonating = { name: claim.site.name, domain: claim.site.domains[0], url: officialUrl(claim.site) };
  } else if (money && govStrong) {
    add(85, `頁面自稱是「${govStrong}」，要你提供${asksText}，但網址不是政府網域（政府網站以 .gov.tw 結尾）`);
    impersonating = govImp(govStrong);
  } else if (money && govProgram) {
    add(85, `頁面以政府的「${govProgram}」名義要你提供${asksText}，但網址不是政府網域。政府發放補助、運動幣、普發現金都不會要你先付錢或給卡號。`);
    impersonating = govImp(`「${govProgram}」主辦機關`);
  } else if (money && themes.length && govBody) {
    add(85, `頁面以「${themes[0]}」名義、提到「${govBody}」，要你提供${asksText}，但網址不是政府網域`);
    impersonating = govImp(govBody);
  } else if (money && benefitThemes.length) {
    add(60, `頁面以「${benefitThemes.slice(0, 2).join('、')}」等領獎名義要你提供${asksText}。正規抽獎、點數兌換不會要你先付錢或轉帳。`);
  } else if (money && payThemes.length) {
    add(55, `頁面以「${payThemes.slice(0, 2).join('、')}」等名義要你提供${asksText}，但網址 ${base.displayHost} 不在官方清單中`);
  } else if (money) {
    add(35, `這個頁面要你提供${asksText}，但網址 ${base.displayHost} 不在官方清單中，付款前請再次確認網址`);
  }

  if (creds.length && ((claim && claim.site.sensitive) || govStrong || (govProgram && strongCreds))) {
    const who = claim ? claim.display : govStrong || govProgram;
    const lead = claim || govStrong ? `頁面自稱是「${who}」` : `頁面以政府的「${who}」名義`;
    add(80, `${lead}，要你輸入${creds.join('、')}，但網址不是官方網站`);
    if (!impersonating) impersonating = claim ? { name: claim.site.name, domain: claim.site.domains[0], url: officialUrl(claim.site) } : govImp(claim || govStrong ? who : `「${who}」主辦機關`);
  } else if (creds.length && benefitThemes.length) {
    add(strongCreds ? 65 : 40, `頁面以「${benefitThemes[0]}」名義要你輸入${creds.join('、')}。領獎或兌換點數不需要提供簡訊驗證碼或網銀帳密。`);
  }

  if (base.level === 'platform' && (money || creds.length)) {
    add(80, `這是任何人都能建立的頁面，卻要你提供${[...new Set([...asks, ...creds])].join('、')}。官方機構不會用這種方式收費或要密碼。`);
  }

  // 165 詐騙 LINE ID
  const badLineIds = [...new Set((links.lineIds || []).map(normalizeLineId))].filter((id) => id && ctx.lineIds.has(id));
  if (badLineIds.length) add(90, `頁面上的 LINE 帳號「${badLineIds[0]}」列在 165 詐騙 LINE ID 清單中，請不要加好友`);

  // 資料被直接送到 Telegram／Discord（詐騙套件常見做法）
  if (signals.exfil) {
    add(money || creds.length ? 80 : 40, `這個網頁的程式會把資料直接傳到 ${signals.exfil}，正規網站不會這樣收集資料`);
  }

  // 要你下載 APK 安裝檔
  if (links.apk) {
    const who = claim ? claim.display : govStrong || govProgram;
    if (who) add(80, `頁面以「${who}」名義要你下載安裝 App 安裝檔（APK）。官方 App 只會在 Google Play、App Store 上架。`);
    else add(40, '頁面要你直接下載安裝 App 安裝檔（APK），可能是惡意程式。請到 Google Play、App Store 下載正規 App。');
  }

  // 假投資導流頁
  const guarantee = findAny(allNorm, INVESTMENT_GUARANTEE);
  const hype = findAny(allNorm, INVESTMENT_HYPE);
  const reportingFraud = findAny(allNorm, ANTI_FRAUD_WORDS).length >= 2; // 新聞、防詐宣導頁
  if (!reportingFraud) {
    if (guarantee.length && links.chat) add(65, `頁面用「${guarantee[0]}」吸引你加 LINE／Telegram，這是假投資詐騙的典型手法。合法投顧不得保證獲利。`);
    else if (guarantee.length >= 2) add(40, `頁面宣稱「${guarantee.slice(0, 2).join('、')}」。合法投資不會保證獲利。`);
    else if (hype.length >= 2 && links.chat) add(35, `頁面用「${hype.slice(0, 2).join('、')}」吸引你加入 LINE／Telegram 群組，請小心假投資`);
  }

  // 一頁式購物（假網拍是 165 受理件數最多的詐騙）：只能貨到付款、限時搶購，卻找不到公司統編或地址
  const rawAll = `${signals.title || ''}\n${rawBody}`;
  if (/貨到付款/.test(rawAll) && /限時|倒數|搶購|最後\s*\d|僅剩|只剩|剩下\s*\d|今日下單|清倉|破盤|特價/.test(rawAll)
      && !/統一編號|統編|營業人|公司地址|股份有限公司|有限公司/.test(rawAll)) {
    add(40, '這是「一頁式購物」頁面：只能貨到付款、用限時搶購催你下單，卻找不到公司統編或地址。假網拍是 165 受理件數最多的詐騙，下單前請先查證賣家。');
  }

  // 假投資平台出金：合法平台不會在出金前另外收錢
  if (/出金|提領|提款|提現/.test(rawAll) && /稅金|保證金|自證金|認證金|解凍金|手續費|稅款|驗資/.test(rawAll)
      && /(先|需|須|必須|才能|才可).{0,10}(繳|付|匯|儲值)|(繳|付|匯).{0,10}(才能|才可|後).{0,6}(出金|提領|提款|提現)/.test(rawAll)) {
    add(80, '頁面要你先繳稅金、保證金或手續費才能出金。合法投資平台不會在出金前另外向你收錢，這是假投資的典型手法。');
  }

  // 沒加密、資料送到別的網站
  if (signals.isHttp && (money || creds.length)) add(25, '連線沒有加密（http），卻要你輸入付款或登入資料');
  const foreign = (signals.formHosts || []).map((h) => parseHost(h).registrable).find((r) => r && r !== base.registrable);
  if (foreign && (money || creds.length)) add(15, `你填的資料會被送到另一個網站（${foreign}）`);

  if (transfer) reasons.push({ text: `頁面上有轉帳指示：「${transfer.sample}」`, weight: 0 });
  if (crypto) reasons.push({ text: `頁面上有${crypto.kind}`, weight: 0 });

  // 最強的一條全額計分，其餘線索減半累加
  const ws = reasons.map((r) => r.weight).sort((a, b) => b - a);
  let weight = ws.length ? ws[0] + 0.5 * ws.slice(1).reduce((a, b) => a + b, 0) : 0;
  // 網址本身已經像在冒充，頁面內容又自稱同一個機構 → 再加重
  if (base.impersonating && claim && base.impersonating.name === claim.site.name) weight += 15;
  weight = Math.round(weight);

  const score = Math.min(100, (base.score || 0) + weight);
  const level = base.level === 'platform' && weight < DANGER_SCORE ? (weight ? 'caution' : 'platform') : levelFor(score);
  return {
    ...base,
    level: level === 'unknown' && base.level === 'platform' ? 'platform' : level,
    score,
    reasons: [...reasons, ...base.reasons.filter((r) => r.weight > 0 || !reasons.length)].sort((a, b) => b.weight - a.weight),
    impersonating,
    page: { asks, creds, claim: claim ? claim.site.name : govStrong || govProgram, themes: themes.slice(0, 5), weight, apk: Boolean(links.apk), investment: guarantee.length > 0 },
  };
}

// ───────────────────────── 簡訊／訊息判斷 ─────────────────────────

const URL_IN_TEXT = /(?:https?:\/\/[^\s"'<>（）「」【】，。、]+)|(?:\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s"'<>（）「」【】，。、]*)?)/gi;

/** 從訊息中找出所有網址（沒有 https:// 的自動補上） */
export function extractUrls(text) {
  const out = [];
  for (const m of String(text || '').matchAll(URL_IN_TEXT)) {
    let u = m[0].replace(/[.,;:!?)\]]+$/, '');
    if (!/^https?:\/\//i.test(u)) {
      // 排除 email 與檔名之類（例：abc@gmail.com 的 gmail.com 已在前面被 @ 擋下，這裡再排除常見副檔名）
      if (/\.(jpg|png|gif|pdf|doc|docx|xls|xlsx|txt)$/i.test(u)) continue;
      const before = text[m.index - 1];
      if (before === '@') continue;
      u = 'https://' + u;
    }
    try { new URL(u); out.push(u); } catch { /* 略過 */ }
  }
  return [...new Set(out)].slice(0, 10);
}

// 訊息要你在連結裡做什麼（前五項是「秘密」，正規機構不會用簡訊連結跟你要）
const MSG_ASKS = [
  [/信用卡|卡號|安全碼|有效期限/, '信用卡資料', true],
  [/驗證碼|簡訊碼|OTP|認證碼|動態密碼|復原碼/i, '簡訊驗證碼', true],
  [/網銀|網路銀行|綁定.{0,4}(帳戶|銀行|帳號)|銀行帳號|帳戶資料|登入.{0,3}(銀行|帳戶)/, '銀行帳戶', true],
  [/密碼|帳號與密碼|登入.{0,8}帳號/, '帳號密碼', true],
  [/身分證|身份證/, '身分證字號', true],
  [/遠端|AnyDesk|TeamViewer|安裝.{0,8}(程式|軟體|工具|APP|App|app|APK)/i, '安裝遠端或不明程式', true],
  [/匯款|轉帳|匯入|付款|支付|繳納|繳費|手續費|運費|驗證費|保證金|儲值/, '付款', false],
];
const URGENCY = /今天|今日|今晚|明天|立即|立刻|馬上|盡速|儘速|限時|截止|只到|逾期|失效|停權|凍結|分鐘內|小時內|\d+\s*(分鐘|小時)|最後|即將/;
const LURE = /恭喜|免費|獲得|中獎|抽中|回饋|紅利|兌換|領取|退費|退款|補助|升級|優惠|禮物|獎金|加碼|收益|獲利/;
const THREAT = /異常|停權|凍結|扣款|自動續費|續費|罰|違規|吊扣|法院|地檢|警察|吊銷|取消資格|無法應試|款項會被/;

function messageNotesFor(text, norm, guarantee, themes) {
  const notes = [];
  if (/(驗證碼|復原碼|認證碼|簡訊碼).{0,15}(傳|給|回傳|截圖|告訴|唸)|(傳|給|回傳|截圖|告訴).{0,15}(驗證碼|復原碼|認證碼|簡訊碼)/.test(text)) {
    notes.push('對方要你把驗證碼或復原碼交出去。驗證碼等於你帳號的鑰匙，任何人（包括朋友、客服）都不該跟你要。');
  }
  if (/先(付|匯|繳|儲值|轉|墊).{0,24}(才|就|再|退|開通|領|送)|(開通|解鎖|領取|出金).{0,12}(先|需)(付|繳|匯)/.test(text)) {
    notes.push('要你「先付錢」才能領錢、開通或解鎖，這是詐騙的典型手法。');
  }
  if (/(不要|別|不用|不能)(告訴|跟|讓).{0,6}(爸媽|家人|父母|別人|任何人|老師)|不要打電話|不能接電話|不方便接電話|不走平台/.test(text)) {
    notes.push('要你保密、不要打電話，或不要透過平台交易，是詐騙常見手法。請直接打電話給本人或家人確認。');
  }
  if (findTransferInstruction(text) || /(轉|匯)(到|入|進).{0,10}(帳戶|帳號)/.test(text)) {
    notes.push('訊息要你轉帳到某個帳戶。轉帳前請先用你原本知道的電話打給對方確認，或撥 165 查詢。');
  }
  if (guarantee.length) notes.push(`訊息宣稱「${guarantee[0]}」，合法投資不會保證獲利，很可能是假投資`);
  if (/(加|私|密).{0,4}(LINE|line|賴)|LINE\s*ID|@[a-z0-9._-]{3,}/i.test(text) && (guarantee.length || themes.length)) notes.push('訊息要你加 LINE 帳號私下聯絡，這是詐騙常見手法');
  return [...new Set(notes)];
}

/**
 * 判斷一則簡訊／LINE 訊息：訊息「自稱是誰」和連結的「實際網址」是否一致，以及要你在連結裡做什麼。
 * @returns {{ items: object[], noUrl: boolean, messageNotes: string[] }}
 */
export function assessMessage(text, ctx) {
  const norm = normText(text);
  let claim = null;
  for (const c of ctx.claims) if (c.alias && norm.includes(c.alias)) { claim = c; break; }
  const gov = findAny(norm, GOV_ALIASES)[0] || findAny(norm, GOV_PROGRAMS)[0] || null;
  const themes = [...findAny(norm, PAYMENT_THEMES), ...findAny(norm, BENEFIT_THEMES)];
  const guarantee = findAny(norm, INVESTMENT_GUARANTEE);
  const asks = MSG_ASKS.filter(([re]) => re.test(text));
  const secrets = asks.filter(([, , secret]) => secret).map(([, label]) => label);
  const pressure = [URGENCY, LURE, THREAT].filter((re) => re.test(text)).length > 0;
  const urls = extractUrls(text);
  const items = urls.map((u) => {
    const v = assessUrl(u, ctx);
    if (['official', 'gov', 'trusted', 'skip', 'invalid'].includes(v.level)) {
      if (claim && v.match && !claim.site.domains.some((d) => v.host === d || v.host.endsWith('.' + d)) && v.level === 'official') {
        v.reasons.push({ text: `訊息自稱「${claim.display}」，但連結是「${v.match.name}」的網站，請確認`, weight: 0 });
      }
      return v;
    }
    const extra = [];
    let imp = v.impersonating;
    if (claim) {
      extra.push({ weight: 85, text: `訊息自稱「${claim.display}」，但連結 ${v.displayHost} 不是「${claim.site.name}」的官方網址（官方是 ${claim.site.domains[0]}）` });
      imp = { name: claim.site.name, domain: claim.site.domains[0], url: officialUrl(claim.site) };
    } else if (gov) {
      extra.push({ weight: 85, text: `訊息以「${gov}」名義要你點連結，但連結不是政府網域。政府網站以 .gov.tw 結尾（臺北市為 .gov.taipei）` });
      imp = { name: gov, domain: null, url: null, hint: '真正的政府網站網址以 .gov.tw 結尾（臺北市為 .gov.taipei）' };
    } else if (themes.length) {
      extra.push({ weight: 50, text: `訊息以「${themes.slice(0, 2).join('、')}」為由要你點連結，但連結不在官方清單中` });
    }
    if (secrets.length && pressure) {
      extra.push({ weight: 65, text: `訊息要你點連結後提供${secrets.join('、')}，還用時間限制、好處或停權來催你。正規機構不會用簡訊連結跟你要這些。` });
    } else if (secrets.length) {
      extra.push({ weight: 45, text: `訊息要你點連結後提供${secrets.join('、')}。請改從官方 App 或自己輸入官方網址進入確認。` });
    } else if (asks.length && pressure) {
      extra.push({ weight: 35, text: '訊息要你點連結付款，還限時催促。請改從官方 App 或自己輸入官方網址確認帳單。' });
    }
    if (guarantee.length) extra.push({ weight: 60, text: `訊息宣稱「${guarantee[0]}」。合法投資不會保證獲利，這是假投資常見話術` });
    if (!extra.length) return v;
    const ws = extra.map((e) => e.weight).sort((x, y) => y - x);
    const score = Math.min(100, v.score + ws[0] + 0.5 * ws.slice(1).reduce((x, y) => x + y, 0));
    return { ...v, score, level: levelFor(score), impersonating: imp, reasons: [...extra, ...v.reasons.filter((r) => r.weight > 0)].sort((x, y) => y.weight - x.weight) };
  });
  return { items, noUrl: !urls.length, messageNotes: messageNotesFor(text, norm, guarantee, themes), claim: claim ? claim.site.name : gov };
}
