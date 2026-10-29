'use strict';
/* 로드나인 캐릭터 추적기 — 웹 화면 (GitHub 웹 · 내 PC 프로그램 공용) */
const VERSION = '0.9.8';
const DEFAULT_PLAYLIST = 'PLa0HLtbB3Lvw';
const AUTO_HOUR = 12;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf = n => (n === null || n === undefined || n === '' || Number.isNaN(n)) ? '--' : Number(n).toLocaleString('ko-KR');
const pad2 = n => String(n).padStart(2, '0');
const NODES = '<i class="nd tl"></i><i class="nd tr"></i><i class="nd bl"></i><i class="nd br"></i>';
const PHOS = [['blue','파랑','#7cc4ff'],['green','초록','#6effaa'],['amber','주황','#ffbe64'],['red','빨강','#ff6969'],['purple','보라','#c096ff'],['yellow','노랑','#ffe14d']];
// 월드 파일 열 순서 (crawler.py COLS) + 마지막에 월드 코드
const C = {n:0,s:1,j:2,mc:3,ml:4,mr:5,bp:6,bwr:7,bsr:8,ach:9,sp:10,g:11,m1c:12,m1l:13,m2c:14,m2l:15,w:16};
// 마스터리 현황 표시 순서
const DEFAULT_MASTERIES = [['Mastery_Hand','맨손'],['Mastery_Sword','검과 방패'],['Mastery_WarDrum','워드럼'],['Mastery_QuarterStaff','전투봉'],['Mastery_BattleShield','전투 방패'],['Mastery_TwohandedSword','대검'],['Mastery_Scythe','사이드'],['Mastery_Staff','지팡이'],['Mastery_DualDagger','단검'],['Mastery_Bow','활'],['Mastery_CrossBow','석궁']];

/* ------------------------------------------------------------ 저장소 (이 브라우저에만 저장) */
const SKEY = 'l9tracker.v6';
function freshStore(){ return {v:1, tracked:[], mastery:{}, integ:{}, imported:false, fav:[], expr:[]}; }
function loadStore(){
  try{ const s = JSON.parse(localStorage.getItem(SKEY) || 'null'); if(s && s.v === 1) return Object.assign(freshStore(), s); }catch(e){}
  return freshStore();
}
let ST = loadStore();
function persisted(){ const o = Object.assign({}, ST); delete o.cur; delete o.recent; return o; }
function saveStore(){
  try{ localStorage.setItem(SKEY, JSON.stringify(persisted())); }catch(e){ if(!SYNC.on) toast('브라우저에 저장하지 못했습니다 — [백업 저장]으로 보관하세요'); }
  if(SYNC.on){ clearTimeout(SYNC.t); SYNC.t = setTimeout(() => syncPush({store: persisted()}), 400); }
}
// 내 PC 프로그램: 기록을 프로그램 폴더(data\\store.json)에도 저장 — 창(브라우저)이 바뀌어도 그대로
const SYNC = {on: false, t: null, pt: null};
function syncPush(body){ fetch('api/store', {method:'POST', headers:{'Content-Type':'application/json', 'X-L9':'1'}, body: JSON.stringify(body)}).catch(() => {}); }
function prefsNow(){ const o = {}; try{ for(let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if(k.startsWith('l9') && k !== SKEY) o[k] = localStorage.getItem(k); } }catch(e){} return o; }
function lsGet(k, d){ try{ const v = localStorage.getItem(k); return v === null ? d : v; }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} if(SYNC.on){ clearTimeout(SYNC.pt); SYNC.pt = setTimeout(() => syncPush({prefs: prefsNow()}), 600); } }
const key = (w, n) => `${w}|${n}`;

/* ------------------------------------------------------------ 데이터 */
const D = {meta:null, worlds:{}, hist:{}, moves:null, local:null, gen:'', sortCache:{}, quick:null};
const CRC = (() => { const t = new Uint32Array(256); for(let i=0;i<256;i++){ let c=i; for(let k=0;k<8;k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i]=c>>>0; } return t; })();
function crc32(str){ const b = new TextEncoder().encode(str); let c = 0xFFFFFFFF; for(const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function getJSON(path){
  const r = await fetch(path + '?t=' + encodeURIComponent(D.gen || Date.now()), {cache:'no-cache'});
  if(!r.ok) throw new Error('데이터를 불러오지 못했습니다 (' + path + ' ' + r.status + ')');
  return r.json();
}
async function loadMeta(){
  let m = null;
  try{ const r = await fetch('data/meta.json?t=' + Date.now(), {cache:'no-store'}); if(r.ok) m = await r.json(); }catch(e){}
  if(!m){ D.meta = null; return null; }
  if(!D.meta || m.generated !== D.meta.generated){ D.worlds = {}; D.hist = {}; D.moves = null; D.sortCache = {}; D.gev = null; D.chg = null; }
  D.meta = m; D.gen = m.generated;
  return m;
}
function world(wc){
  wc = Number(wc);
  if(!D.worlds[wc]) D.worlds[wc] = getJSON(`data/chars/${wc}.json`).then(j => {
    j.byName = new Map();
    for(const r of j.rows){ r[C.w] = wc; j.byName.set(r[C.n], r); }
    return j;
  }).catch(e => { delete D.worlds[wc]; throw e; });
  return D.worlds[wc];
}
// 수집 기준 (crawler.py 의 WORLD_RULES 와 같게 유지)
const WORLD_GROUPS = {'구월드': ['울란', '디엔', '린드리스'], '신월드': ['가르바나', '디나페리', '하칸']};
const GROUP_RULE = {'구월드': '전투력 14만 이상', '신월드': '서버별 전투력 상위 500위'};
function ruleTxt(g){ return GROUP_RULE[g]; }
function critText(){ return (D.meta?.worlds || []).some(w => w.rule) ? `구월드 ${ruleTxt('구월드')} · 신월드 ${ruleTxt('신월드').replace('서버별 전투력 ', '서버별 ')} 기준` : '서버별 전투력 1,000위 안 캐릭터 기준'; }
const CRIT_SHORT = () => (D.meta?.worlds || []).some(w => w.rule) ? '수집 기준' : '서버 전투력 1,000위';
const readyWorlds = () => (D.meta?.worlds || []).filter(w => w.ready !== false && w.count > 0);
async function allWorlds(){ return Promise.all(readyWorlds().map(w => world(w.code))); }
async function loadQuick(){
  if(!D.local){ D.quick = null; return null; }
  try{ const r = await fetch('data/quick.json?t=' + Date.now(), {cache:'no-store'}); D.quick = r.ok ? await r.json() : null; }catch(e){ D.quick = null; }
  return D.quick;
}
function histShard(i){
  if(!D.hist[i]) D.hist[i] = getJSON(`data/hist/${pad2(i)}.json`).catch(() => ({}));
  return D.hist[i];
}
async function histOf(k){ if(!D.meta) return null; const sh = await histShard(crc32(k) % (D.meta.shards || 64)); return sh[k] || null; }
async function moves(){ if(!D.moves) D.moves = getJSON('data/moves.json').catch(() => []); return D.moves; }

const wName = wc => (D.meta?.worlds || []).find(w => w.code === Number(wc))?.name || (D.wlist || []).find(w => w[0] === Number(wc))?.[1] || String(wc);
const jobName = j => typeof j === 'string' ? j : ((D.meta?.jobs || [])[j] ?? '--');
const mcode = i => typeof i === 'string' ? i : (i == null || i < 0) ? null : (D.meta?.mcodes || [])[i] || null;
function masteryList(){
  const extra = (D.meta?.mcodes || []).filter(c => !DEFAULT_MASTERIES.some(x => x[0] === c));
  return DEFAULT_MASTERIES.concat(extra.map(c => [c, D.meta?.mnames?.[c] || c.replace('Mastery_', '')]));
}
const mname = c => c ? ((DEFAULT_MASTERIES.find(x => x[0] === c) || masteryList().find(x => x[0] === c) || [0, c.replace('Mastery_', '')])[1]) : '--';
function dayStr(n){ const e = new Date((D.meta?.epoch || '2024-01-01') + 'T00:00:00Z'); e.setUTCDate(e.getUTCDate() + n); return e.toISOString().slice(0, 10); }
function todayKST(){ return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
function serverLabel(s){ return s ? `${pad2(s)}서버` : ''; }

/* ------------------------------------------------------------ 공통 화면 도구 */
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 3400); }
// 줄바꿈 정리: ' · ' 구분점이 줄 맨 앞에 오지 않도록 앞 칸을 붙는 공백으로
const NB = h => String(h).replace(/ · /g, '\u00a0· ');
function showDlg(title, html, buttons, plain){
  $('#rTitle').innerHTML = title;
  $('#rLines').className = plain ? 'dlgbody' : 'lines';
  $('#rLines').innerHTML = NB(html);
  const df = $('#dlgR .df');
  df.innerHTML = (buttons || []).map(b => `<button type="button" class="btn ${b.pri ? 'pri' : ''}" data-dlg="${esc(b.id)}">${esc(b.label)}</button>`).join('') + '<button class="btn" value="ok">닫기</button>';
  df.onclick = e => { const b = e.target.closest('[data-dlg]'); if(!b) return; const f = (buttons || []).find(x => x.id === b.dataset.dlg); $('#dlgR').close(); f && f.run(); };
  $('#dlgR').showModal();
}
function showLines(title, lines){ showDlg(esc(title), (lines || []).map(l => '<div>' + esc(l) + '</div>').join('') || '<div>결과 없음</div>'); }
function delta(c, p, invert){
  if(c == null || p == null) return '';
  const d = c - p; if(!d) return '';
  const good = invert ? d < 0 : d > 0;
  return `<span class="d ${good ? 'up' : 'dn'}">${d > 0 ? '▲' : '▼'}${Math.abs(d).toLocaleString('ko-KR')}</span>`;
}
function seg(act, cur, opts){ return `<div class="seg">${opts.map(([v, l]) => `<button data-act="${act}" data-v="${esc(v)}" class="${String(v) === String(cur) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`; }
function row(lb, v, cls = ''){ return `<div class="row"><span class="lb">${lb}</span><span class="v ${cls}">${v}</span></div>`; }
function blank(title, msg){ return `<div class="blank fr">${NODES}<h2 class="g">${title}</h2><p>${msg}<span class="blink">_</span></p></div>`; }

/* 한글 단위 (조 · 억 · 만) */
function krNum(n){
  if(n == null || !isFinite(n)) return '--';
  const neg = n < 0; n = Math.round(Math.abs(n));
  if(n < 10000) return (neg ? '-' : '') + n.toLocaleString('ko-KR');
  const units = [[1e12, '조'], [1e8, '억'], [1e4, '만']];
  const parts = []; let rest = n;
  for(const [u, l] of units){ const q = Math.floor(rest / u); if(q){ parts.push(q.toLocaleString('ko-KR') + l); rest -= q * u; } }
  if(rest && n < 1e6) parts.push(rest.toLocaleString('ko-KR'));
  return (neg ? '-' : '') + parts.slice(0, 2).join(' ');
}
function krShort(n){
  if(n == null || !isFinite(n)) return '--';
  const a = Math.abs(n);
  if(a >= 1e12) return (n / 1e12).toFixed(a >= 1e13 ? 1 : 2).replace(/\.?0+$/, '') + '조';
  if(a >= 1e8) return (n / 1e8).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + '억';
  if(a >= 1e4) return (a >= 1e6 ? Math.round(n / 1e4).toLocaleString('ko-KR') : (n / 1e4).toFixed(1).replace(/\.0$/, '')) + '만';
  return Math.round(n).toLocaleString('ko-KR');
}

/* ------------------------------------------------------------ 그래프 */
function scope(pts){
  pts = pts.filter(p => p.v !== null && p.v !== undefined);
  if(!pts.length) return '<div class="nodata">기록 없음</div>';
  const W = 380, H = 128, L = 6, R = W - 6, T = 10, B = H - 22;
  const vs = pts.map(p => p.v); let lo = Math.min(...vs), hi = Math.max(...vs);
  const minR = Math.max(2, Math.abs(hi) * .01); if(hi - lo < minR){ const m = (hi + lo) / 2; hi = m + minR / 2; lo = m - minR / 2; }
  const n = pts.length;
  const xy = pts.map((p, i) => [L + (R - L) * (n > 1 ? i / (n - 1) : .5), T + (B - T) * (1 - (p.v - lo) / (hi - lo))]);
  let grid = '';
  for(let i = 0; i <= 12; i++){ const x = L + (R - L) * i / 12; grid += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T}" y2="${B}" stroke="rgba(var(--c),${i % 3 ? '.10' : '.22'})"/>`; }
  for(let i = 0; i <= 4; i++){ const y = T + (B - T) * i / 4; grid += `<line x1="${L}" x2="${R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(var(--c),${i === 2 ? '.28' : '.12'})"/>`; }
  const line = xy.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
  const dots = xy.map(([x, y], i) => `<rect x="${(x - 1.6).toFixed(1)}" y="${(y - 1.6).toFixed(1)}" width="3.2" height="3.2" fill="#fff"><title>${esc(pts[i].d)} · ${nf(pts[i].v)}</title></rect>`).join('');
  const [lx, ly] = xy[n - 1];
  return `<svg class="osc" viewBox="0 0 ${W} ${H}" role="img">
    <rect x="${L}" y="${T}" width="${R - L}" height="${B - T}" fill="rgba(var(--c),.03)" stroke="rgba(var(--c),.35)"/>${grid}
    <polyline class="trace" points="${line}" fill="none" stroke="rgba(var(--c),1)" stroke-width="2.2" stroke-linejoin="round"/>
    <polyline points="${line}" fill="none" stroke="#fff" stroke-width=".9" stroke-linejoin="round" opacity=".9"/>${dots}
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="5" fill="none" stroke="#fff" opacity=".8"/>
    <text x="${L}" y="${H - 5}" class="ax">${esc(pts[0].d.slice(5))}</text>
    <text x="${R}" y="${H - 5}" class="ax" text-anchor="end">${esc(pts[n - 1].d.slice(5))}</text>
    <text x="${(L + R) / 2}" y="${H - 5}" class="ax" text-anchor="middle">${n}일</text></svg>`;
}
function readout(vals, invert){
  const v = vals.filter(x => x !== null && x !== undefined); if(!v.length) return '';
  const last = v[v.length - 1], w = v.length > 7 ? v[v.length - 8] : v[0];
  const d7 = last - w, good = invert ? d7 < 0 : d7 > 0;
  return `<div class="readout"><span>최저 <b>${nf(Math.min(...v))}</b></span><span>최고 <b>${nf(Math.max(...v))}</b></span><span>7일 <b class="${d7 ? (good ? 'up' : 'dn') : ''}">${d7 > 0 ? '+' : ''}${nf(d7)}</b></span></div>`;
}
/* 세로 막대 분포도 */
function vhist(bins, fmtLabel, unit, color){
  if(!bins.length) return '<div class="nodata">데이터 없음</div>';
  const W = 560, H = 210, L = 56, R = W - 8, T = 10, B = H - 34;
  const mx = Math.max(...bins.map(b => b.c), 1);
  const bw = (R - L) / bins.length;
  let g = '';
  for(let i = 0; i <= 4; i++){ const y = T + (B - T) * i / 4; g += `<line x1="${L}" x2="${R}" y1="${y}" y2="${y}" stroke="rgba(var(--c),.12)"/><text x="${L - 6}" y="${y + 4}" class="ax" text-anchor="end">${nf(Math.round(mx * (1 - i / 4)))}</text>`; }
  const step = Math.ceil(bins.length / 8);
  const bars = bins.map((b, i) => {
    const h = (B - T) * b.c / mx, x = L + i * bw + 1;
    const lab = i % step === 0 ? `<text x="${(x + bw / 2 - 1).toFixed(1)}" y="${B + 15}" class="ax" text-anchor="middle">${esc(fmtLabel(b.lo))}</text>` : '';
    return `<rect class="hbr" ${color ? `style="fill:${color}"` : ''} x="${x.toFixed(1)}" y="${(B - h).toFixed(1)}" width="${Math.max(bw - 2, 1).toFixed(1)}" height="${h.toFixed(1)}"><title>${esc(fmtLabel(b.lo))} ~ ${esc(fmtLabel(b.hi))}${unit || ''} · ${nf(b.c)}명</title></rect>${lab}`;
  }).join('');
  return `<svg class="osc hist" viewBox="0 0 ${W} ${H}" role="img"><rect x="${L}" y="${T}" width="${R - L}" height="${B - T}" fill="rgba(var(--c),.03)" stroke="rgba(var(--c),.35)"/>${g}${bars}</svg>`;
}
function niceStep(range, n){ const raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw || 1))); for(const m of [1, 2, 2.5, 5, 10]) if(m * p >= raw) return m * p; return 10 * p; }
function binsOf(vals, n){
  vals = vals.filter(v => v != null); if(!vals.length) return [];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const step = niceStep(hi - lo || 1, n);
  lo = Math.floor(lo / step) * step;
  const k = Math.max(1, Math.floor((hi - lo) / step) + 1);
  const bins = Array.from({length:k}, (_, i) => ({lo: lo + i * step, hi: lo + (i + 1) * step - 1, c: 0}));
  for(const v of vals) bins[Math.min(k - 1, Math.floor((v - lo) / step))].c++;
  return bins;
}
function hbars(rows, opt = {}){
  if(!rows.length) return '<div class="nodata">데이터 없음</div>';
  const mx = Math.max(...rows.map(r => r.c), 1), tot = rows.reduce((a, r) => a + r.c, 0);
  return (opt.head ? `<div class="hb hbh"><span></span><span></span><span class="c">${opt.head[0]}</span><span class="a">${opt.head[1] || ''}</span></div>` : '')
    + rows.map(r => `<div class="hb" title="${esc(r.nm)} · ${nf(r.c)}명 (${(r.c / tot * 100).toFixed(1)}%)"><span class="nm">${esc(r.nm)}</span><span class="tr"><b style="width:${(r.c / mx * 100).toFixed(1)}%${opt.color ? ';background:' + opt.color : ''}"></b></span><span class="c">${nf(r.c)}</span><span class="a">${r.a != null ? esc(r.a) : (r.c / tot * 100).toFixed(1) + '%'}</span></div>`).join('');
}
function spBands(sps){
  if(!sps.length) return [];
  const lo = Math.floor(Math.min(...sps) / 50) * 50, hi = Math.max(...sps);
  const out = [];
  for(let a = lo; a <= hi; a += 50) out.push({nm: `${a} ~ ${a + 49}`, c: sps.filter(v => v >= a && v < a + 50).length});
  return out.reverse();
}

/* ============================================================ 통합 레벨 추정 */
// 게임의 공식이 공개되지 않아, 실제 게임 화면 값(마스터리 11종 합계 → 통합 레벨)으로 맞춘 추정치.
// 기본 2개 기준점 + 사용자가 [마스터리 입력]에서 통합 레벨을 직접 넣을 때마다 기준점이 늘어 정확해짐.
const INTEG_AUTO = false;   // 계산식 확인 전까지 자동 계산 보류
const INTEG_BASE = [{sum: 653, v: 113.1405}, {sum: 631, v: 104.4605}];
function integFit(){
  const pts = INTEG_BASE.concat((ST.calib || []).filter(p => p.sum > 11 && p.v > 0));
  const n = pts.length, mx = pts.reduce((a, p) => a + p.sum, 0) / n, my = pts.reduce((a, p) => a + p.v, 0) / n;
  const sxx = pts.reduce((a, p) => a + (p.sum - mx) ** 2, 0), sxy = pts.reduce((a, p) => a + (p.sum - mx) * (p.v - my), 0);
  const a = sxx ? sxy / sxx : 0.3945;
  return {a, b: my - a * mx, n};
}
function integEstimate(sum){
  const f = integFit(), v = Math.max(1, f.a * sum + f.b);
  return {sum, v, l: Math.floor(v), p: (v - Math.floor(v)) * 100, n: f.n};
}

/* ============================================================ 내 캐릭터 */
function siteMasteries(rowv, date){
  const out = {};
  if(!rowv) return out;
  for(const [ci, li] of [[C.mc, C.ml], [C.m1c, C.m1l], [C.m2c, C.m2l]]){
    const c = mcode(rowv[ci]), l = rowv[li];
    if(c && l) if(!out[c] || l > out[c].level) out[c] = {level:l, date, source:'사이트'};
  }
  return out;
}
function mergeM(a, b){ // 더 최근 날짜 우선, 같은 날이면 높은 값
  const out = Object.assign({}, a);
  for(const [c, m] of Object.entries(b)){ const o = out[c]; if(!o || m.date > o.date || (m.date === o.date && m.level >= o.level)) out[c] = m; }
  return out;
}
async function followMoves(){
  // 닉네임 변경 · 월드 이전 자동 추적: 최신 목록에 없으면 이동 연결표를 따라감 (추적 캐릭터 + 01. 캐릭터)
  const list = ST.tracked.concat(ST.cur ? [ST.cur] : []);
  if(!D.meta || !list.length) return [];
  const mv = await moves(), notes = [];
  for(const t of list){
    if(!readyWorlds().some(w => w.code === t.w)) continue;
    const j = await world(t.w).catch(() => null);
    if(!j || j.byName.has(t.n) || D.quick?.rows?.[key(t.w, t.n)]) continue;
    let w = t.w, n = t.n, hops = 0, found = null;
    while(hops++ < 5){
      const m = mv.filter(x => x.from[0] === w && x.from[1] === n && (!x.lv || x.lv === '확실')).pop();
      if(!m) break;
      [w, n] = m.to; found = m;
    }
    if(found){
      const ok = key(t.w, t.n), nk = key(w, n);
      if(t !== ST.cur && ST.tracked.some(x => key(x.w, x.n) === nk)) continue;
      if(t !== ST.cur) notes.push(`${wName(t.w)} ${t.n} → ${wName(w)} ${n} (일치도 ${found.score}%)`);
      if(ST.mastery[ok]){ ST.mastery[nk] = ST.mastery[ok]; delete ST.mastery[ok]; }
      if(ST.integ[ok]){ ST.integ[nk] = ST.integ[ok]; delete ST.integ[ok]; }
      const f = favOf(t.w, t.n); if(f){ f.w = w; f.n = n; }
      if(ST.cur && t !== ST.cur && ST.cur.w === t.w && ST.cur.n === t.n){ ST.cur.w = w; ST.cur.n = n; }
      t.w = w; t.n = n;
    }
  }
  saveStore(); saveSession();
  return notes;
}
// 유력 후보로 직접 바꾸기 (추적 · 즐겨찾기 · 메모 · 입력한 마스터리를 새 캐릭터로 옮김)
function applyMove(ow, on, w, n){
  ow = Number(ow); w = Number(w);
  const ok = key(ow, on), nk = key(w, n);
  const t = ST.tracked.find(x => x.w === ow && x.n === on);
  if(t && ST.tracked.some(x => key(x.w, x.n) === nk)) ST.tracked = ST.tracked.filter(x => x !== t);
  else if(t){ t.w = w; t.n = n; }
  if(ST.mastery[ok] && !ST.mastery[nk]){ ST.mastery[nk] = ST.mastery[ok]; delete ST.mastery[ok]; }
  if(ST.integ[ok] && !ST.integ[nk]){ ST.integ[nk] = ST.integ[ok]; delete ST.integ[ok]; }
  const f = favOf(ow, on); if(f && !favOf(w, n)){ f.w = w; f.n = n; }
  if(ST.cur && ST.cur.w === ow && ST.cur.n === on){ ST.cur = {w, n}; }
  if(TRSEL === ok){ TRSEL = nk; lsSet('l9trsel', nk); }
  saveStore(); saveSession();
}
async function buildCards(list){
  const out = [];
  for(const t of (list || ST.tracked)){
    const k = key(t.w, t.n);
    const wr = readyWorlds().some(w => w.code === t.w);
    const j = wr ? await world(t.w).catch(() => null) : null;
    let r = j ? j.byName.get(t.n) || null : null;
    const qr = D.quick?.rows?.[k];
    if(qr && (!r || (D.quick.date && D.quick.date > (j?.date || '')))){ r = qr.slice(); r[C.w] = t.w; }
    if(!r && D.local) r = (await rowOf(t.w, t.n))?.r || null;
    let h = D.meta ? await histOf(k) : null;
    const qh = D.quick?.hist?.[k];
    if(qh){
      if(!h) h = qh;
      else { const days = new Set(h.p.map(p => p[0])); h = Object.assign({}, h, {p: h.p.concat(qh.p.filter(p => !days.has(p[0]))).sort((a, b) => a[0] - b[0]), e: h.e.concat(qh.e)}); }
    }
    const series = (h?.p || []).map(p => ({d: dayStr(p[0]), bp: p[1], ach: p[2], ml: p[3], mr: p[4], sp: p[5], mc: mcode(p[6])}));
    let ms = {};
    for(const s of series) if(s.mc && s.ml) ms = mergeM(ms, {[s.mc]: {level: s.ml, date: s.d, source: '사이트'}});
    if(r) ms = mergeM(ms, siteMasteries(r, (D.quick?.rows?.[k] && D.quick.date) || D.meta?.date || todayKST()));
    const man = ST.mastery[k] || {};
    ms = mergeM(ms, Object.fromEntries(Object.entries(man).map(([c, m]) => [c, {level: m.l, date: m.d, source: '직접 입력'}])));
    const integs = (ST.integ[k] || []).slice().sort((a, b) => a.d < b.d ? -1 : 1);
    const ev = (h?.e || []).map(e => ({d: dayStr(e[0]), kind: e[1], before: e[2], after: e[3], score: e[4]}))
      .concat((t.ev || []).map(e => ({d: e.d, kind: e.kind, before: e.before, after: e.after, score: null, manual: true})))
      .sort((a, b) => a.d < b.d ? 1 : -1);
    const last = series[series.length - 1], prev = series.length > 1 ? series[series.length - 2] : null;
    const allM = INTEG_AUTO && masteryList().slice(0, 11).every(([code]) => ms[code]?.level);
    const est = allM ? integEstimate(masteryList().slice(0, 11).reduce((a, [code]) => a + ms[code].level, 0)) : null;
    const mLast = allM ? masteryList().slice(0, 11).map(([code]) => ms[code].date).sort().pop() : null;
    out.push({t, k, r, h, series, last, prev, ms, integ: integs[integs.length - 1] || null, integs, ev, est, mLast});
  }
  return out;
}
let CARDS = [];
function mcell(c, code, name){
  const m = c.ms[code], r = c.r;
  const isEq = r ? [mcode(r[C.m1c]), mcode(r[C.m2c])].includes(code) : false;
  const isRep = r && mcode(r[C.mc]) === code;
  const old = m && (Date.parse(todayKST()) - Date.parse(m.date)) / 864e5 > 14;
  const cap = isEq ? '장착 중' : (m ? m.source : '미입력');
  return `<div role="button" tabindex="0" class="m ${isEq ? 'eq' : ''} ${m ? '' : 'none'} ${old ? 'old' : ''}" data-act="medit" data-k="${esc(c.k)}" data-code="${code}"
      title="${esc(name)} — ${m ? esc(m.date + ' · ' + m.source) + ' · 클릭해서 수정' : '클릭해서 레벨 입력'}">
    ${isRep ? '<span class="tag">대표</span>' : ''}
    <div class="mt">${esc(name)}</div><div class="mv">${m ? m.level : '--'}</div><div class="hint">+ 입력</div>
    <div class="md">${m ? esc(m.date.slice(5)) : '&nbsp;'}</div><div class="mc">${cap}</div></div>`;
}
function print(seed){
  let s = '';
  for(let i = 0; i < 9; i++){
    const rx = 8 + i * 6.5, ry = 12 + i * 8.2, gap = (seed * 7 + i * 13) % 40 + 10;
    s += `<ellipse cx="60" cy="62" rx="${rx}" ry="${ry}" fill="none" stroke="rgba(var(--c),.9)" stroke-width="1.6" stroke-dasharray="${40 + i * 9} ${gap}" transform="rotate(${(seed * 11 + i * 17) % 30 - 15} 60 62)"/>`;
  }
  return `<svg width="120" height="124" viewBox="0 0 120 124">${s}</svg>`;
}
function subject(c, idx, mode){
  const trk = mode === 'track', tracked = ST.tracked.some(t => key(t.w, t.n) === c.k);
  const r = c.r, L = c.last, P = c.prev, it = c.integ;
  const ok = !!r;
  const job = r ? jobName(r[C.j]) : (c.h ? jobName(c.h.j) : '직업 미확인');
  let h = `<section class="subj fr" id="card-${idx}">${NODES}
  <div class="bar">
    <span class="sid g"><em>${trk ? '추적 ' + pad2(idx + 1) : '캐릭터'}</em><b class="cname">${esc(c.t.n)}</b></span>
    <div class="acts">
      ${D.local ? `<button data-act="quick1" data-k="${esc(c.k)}">조회</button>` : ''}
      <button data-act="mastery" data-k="${esc(c.k)}">마스터리 입력</button>
      ${trk ? `<button data-act="edit" data-k="${esc(c.k)}">닉네임/월드</button>` : (tracked ? `<button data-act="gotrack" data-k="${esc(c.k)}">✓ 추적 중 · 추적에서 보기</button>` : `<button data-act="track" data-w="${c.t.w}" data-n="${esc(c.t.n)}">+ 추적 추가</button>`)}
      <button data-act="rankof" data-k="${esc(c.k)}">랭킹에서 보기</button>
      <button data-act="fav" data-w="${c.t.w}" data-n="${esc(c.t.n)}">${isFav(c.t.w, c.t.n) ? '★ 즐겨찾기' : '☆ 즐겨찾기'}</button>
      ${trk ? `<button data-act="del" data-k="${esc(c.k)}">추적 해제</button>` : ''}
    </div>
    <div class="dots" title="검색됨 · 일별 기록 · 통합 레벨"><i class="${ok ? 'on' : ''}"></i><i class="${c.series.length ? 'on' : ''}"></i><i class="${it ? 'on' : ''}"></i></div>
  </div>`;
  if((D.meta || D.quick) && !ok) h += `<div class="alert" data-miss="${esc(c.k)}">${esc(wName(c.t.w))}에서 검색되지 않습니다 — ${CRIT_SHORT()} 밖이거나 닉네임 변경·월드 이전 가능성 <span class="cands-msg"></span></div>`;
  const useEst = c.est && (!it || (c.mLast && c.mLast > it.d));
  const shown = useEst ? {l: c.est.l, p: c.est.p, d: c.mLast} : it;
  const pct = shown && shown.p != null && shown.p !== '' ? Number(shown.p) : null;
  const blocks = Array.from({length:20}, (_, i) => `<i class="${pct != null && i < Math.round(pct / 5) ? 'on' : ''}"></i>`).join('');
  const bp = r ? r[C.bp] : L?.bp;
  h += `<div class="dossier"><div class="scan">
    <div class="viz body"><img src="body.gif" alt=""><i class="brk a"></i><i class="brk b"></i><i class="brk c"></i><i class="brk e"></i><div class="job">${esc(job)}</div></div>
    <div class="big"><div class="lb">전투력</div><div class="v">${nf(bp)}${delta(L?.bp, P?.bp)}</div></div>
    <div class="big amb"><div class="lb">통합 레벨${useEst ? ' <span class="est">자동 계산 · 추정</span>' : ''}</div><div class="v">${shown ? shown.l : '--'}${pct != null ? `<small>${pct.toFixed(2)}%</small>` : ''}</div>
      <div class="blocks">${blocks}</div><div class="s">${useEst ? `마스터리 11종 합계 ${c.est.sum} 기준 추정 (기준점 ${c.est.n}개)` : it ? esc(it.d) + ' 게임 화면 입력' : '마스터리 입력에서 기록하세요'}</div></div>
  </div>`;
  const lastOf = k => c.ev.find(x => x.kind === k);
  const pn = lastOf('닉네임 변경'), pg = lastOf('길드 변경');
  h += '<div class="rows">';
  h += row('닉네임', (pn ? `<span class="prevv">이전 ${esc(pn.before)}</span>` : '') + `<b class="cname">${esc(c.t.n)}</b>`);
  h += row('월드', esc(wName(c.t.w)) + ' ' + serverLabel(r ? r[C.s] : c.h?.s));
  h += row('직업', esc(job));
  h += row('길드', (pg ? `<span class="prevv">이전 ${esc(pg.before || '없음')}</span>` : '') + (r && r[C.g] && readyWorlds().length ? `<a class="glink" data-act="guildgo" data-w="${c.t.w}" data-s="${r[C.s]}" data-g="${esc(r[C.g])}" title="길드원 보기">${esc(r[C.g])}</a>` : esc(r ? (r[C.g] || '--') : (c.h?.g || '--'))));
  h += row('마스터리', r ? `${esc(mname(mcode(r[C.mc])))} <span class="dg" style="font-size:26px">${nf(r[C.ml])}</span>${delta(L?.ml, P?.ml)}` : '--');
  h += row('마스터리 랭크', r ? `#${nf(r[C.mr])}${delta(L?.mr, P?.mr, true)}` : '--', 'dg');
  h += row('전투력 순위', r ? `월드 <span class="dg rk-n">#${nf(r[C.bwr])}</span> · 서버 <span class="dg rk-n">#${nf(r[C.bsr])}</span>` : '--');
  h += row('전문화', r ? `${nf(r[C.sp])}${delta(L?.sp, P?.sp)}` : '--', 'dg');
  h += row('업적점수', r ? `${nf(r[C.ach])}${delta(L?.ach, P?.ach)}` : '--', 'dg');
  h += row('마지막 기록', L ? esc(L.d) : '----', 'dg');
  const hasData = D.meta || D.quick;
  h += row('상태', !hasData ? (D.local ? '[조회]를 누르세요' : '데이터 없음') : (ok ? '정상' : '검색 안됨'), !hasData ? '' : (ok ? 'ok' : 'bad'));
  h += '</div></div>';

  const ML = masteryList();
  const known = ML.filter(([code]) => c.ms[code]).length;
  h += `<div class="sec">마스터리 현황 <small>확인 ${known}/${ML.length} · 칸을 누르면 바로 입력 · 밝은 칸 = 장착 중</small></div><div class="mgrid">`;
  for(const [code, name] of ML) h += mcell(c, code, name);
  h += '</div>';

  const sr = c.series;
  h += '<div class="sec">일별 통계</div><div class="scopes">';
  for(const [t, k, inv] of [['전투력', 'bp', false], ['업적점수', 'ach', false], ['마스터리 레벨', 'ml', false], ['마스터리 랭크', 'mr', true], ['전문화', 'sp', false]]){
    const vals = sr.map(s => s[k]);
    const last = sr.length ? vals[vals.length - 1] : null, prev = sr.length > 1 ? vals[vals.length - 2] : null;
    h += `<div class="scope"><div class="sh"><span class="lb">${t}</span><span class="cv">${nf(last)}${delta(last, prev, inv)}</span></div>${scope(sr.map(s => ({d: s.d, v: s[k]})))}${readout(vals, inv)}</div>`;
  }
  if(c.integs.length){
    const vals = c.integs.map(s => Number(s.l)), last = vals[vals.length - 1], prev = vals.length > 1 ? vals[vals.length - 2] : null;
    h += `<div class="scope"><div class="sh"><span class="lb">통합 레벨</span><span class="cv" style="color:var(--amb)">${nf(last)}${delta(last, prev)}</span></div>${scope(c.integs.map(s => ({d: s.d, v: Number(s.l)})))}${readout(vals)}</div>`;
  }
  h += '</div>';
  if(sr.length){
    h += `<details><summary>표로 보기</summary><div class="tbl"><table><tr><th>기준일</th><th>전투력</th><th>업적점수</th><th>대표 마스터리</th><th>랭크</th><th>전문화</th></tr>`
      + sr.slice().reverse().map(s => `<tr><td>${esc(s.d)}</td><td class="num">${nf(s.bp)}</td><td class="num">${nf(s.ach)}</td><td>${esc(mname(s.mc))} ${nf(s.ml)}</td><td class="num">${nf(s.mr)}</td><td class="num">${nf(s.sp)}</td></tr>`).join('')
      + '</table></div></details>';
  }
  if(trk) return h + histPanels(c) + '</section>';
  h += `<div class="sec">변경 내역 <small>닉네임 · 길드 · 월드 · 서버 변경 자동 기록</small></div><div class="chg">`;
  if(c.ev.length){
    h += '<div class="tbl" style="margin-top:0"><table><tr><th>기준일</th><th>구분</th><th>이전 → 이후</th><th>비고</th></tr>'
      + c.ev.map(x => `<tr><td>${esc(x.d)}</td><td><span class="kt k-${esc(x.kind.split(' ')[0])}">${esc(x.kind)}</span></td>
          <td><span class="old">${esc(x.before || '없음')}</span><span class="arrow">→</span><span class="new">${esc(x.after || '없음')}</span></td>
          <td style="color:var(--dim);font-size:12px">${x.manual ? '직접 변경' : (x.score ? '일치도 ' + x.score + '%' : '')}</td></tr>`).join('') + '</table></div>';
  } else h += '<div class="empty">변경 내역 없음 — 매일 수집할 때 길드·닉네임·월드·서버 변경이 감지되면 여기에 기록됩니다.</div>';
  return h + '</div></section>';
}

/* 종합 현황 */
const PAL = ['#ffffff', '#ffd27a', '#7dffb0', '#ff8ad8', '#8ae8ff', '#ff9a6b', '#c3a6ff', '#f4ff7a'];
let OVK = 'bp';
const OVDEF = {bp:'전투력', ach:'업적점수', ml:'마스터리', sp:'전문화'};
function multi(k){
  // 가로 막대: 값이 큰 순 최대 20명 · 막대 = 현재 값, 밝은 끝부분 = 최근 7일 증가분
  const all = CARDS.filter(c => c.series.some(s => s[k] != null));
  if(!all.length) return '<div class="nodata">기록이 쌓이면 표시됩니다</div>';
  const pts = c => c.series.filter(s => s[k] != null);
  const rows = all.map((c, i) => { const v = pts(c), last = v[v.length - 1][k], old = (v.length > 7 ? v[v.length - 8] : v[0])[k]; return {c, last, old, ci: i}; })
    .sort((a, b) => b.last - a.last).slice(0, 20);
  const vals = rows.flatMap(r => [r.last, r.old]);
  const mx = Math.max(...vals), mn = Math.min(...vals);
  let lo = mn - (mx - mn) * .25 - Math.abs(mx) * .01; if(lo < 0 || mn <= 0) lo = 0;
  const pct = v => Math.max(1.5, (v - lo) / (mx - lo || 1) * 100);
  return `<div class="hbx">${rows.map((r, i) => { const d = r.last - r.old, up = d > 0;
      const base = pct(Math.min(r.old, r.last)), top = pct(r.last);
      return `<div class="hbx-r" title="${esc(r.c.t.n)} · 현재 ${nf(r.last)} · 7일 ${d >= 0 ? '+' : ''}${nf(d)}">
        <span class="no">${i + 1}</span><span class="nm">${esc(r.c.t.n)}</span>
        <span class="tr"><b class="base" style="width:${(up ? base : top).toFixed(1)}%"></b>${up ? `<b class="gain" style="left:${base.toFixed(1)}%;width:${(top - base).toFixed(1)}%"></b>` : ''}</span>
        <span class="v">${nf(r.last)}</span><span class="dd ${d > 0 ? 'up' : d < 0 ? 'dn' : ''}">${d ? (d > 0 ? '▲' : '▼') + Math.abs(d).toLocaleString('ko-KR') : '-'}</span></div>`; }).join('')}</div>
    <div class="legend"><span><i style="background:rgba(var(--c),.55)"></i>현재 값</span><span><i style="background:var(--up)"></i>최근 7일 증가분</span>
      <span class="sub">막대는 ${esc(krShort(lo))}부터 시작${all.length > rows.length ? ` · 상위 ${rows.length}명 표시 (전체 ${all.length}명)` : ''}</span></div>`;
}
function gains(){
  const rows = CARDS.filter(c => c.series.length).map(c => { const v = c.series.map(s => s.bp).filter(x => x != null); if(!v.length) return null;
    const last = v[v.length - 1], w = v.length > 7 ? v[v.length - 8] : v[0]; return {n: c.t.n, g: last - w}; }).filter(Boolean).sort((a, b) => b.g - a.g);
  if(!rows.length) return '<div class="nodata">기록 없음</div>';
  const mx = Math.max(...rows.map(r => Math.abs(r.g)), 1);
  return `<div class="bars bars2" style="--rows:${Math.ceil(rows.length / 2)}">` + rows.map(r => `<div class="bar-r"><span class="nm">${esc(r.n)}</span><span class="tr"><b class="${r.g < 0 ? 'neg' : ''}" style="width:${(Math.abs(r.g) / mx * 100).toFixed(1)}%"></b></span><span class="vv ${r.g > 0 ? 'up' : (r.g < 0 ? 'dn' : '')}">${r.g > 0 ? '+' : ''}${nf(r.g)}</span></div>`).join('') + '</div>';
}
function board(){
  const cs = CARDS.filter(c => c.r).slice().sort((a, b) => (b.r[C.bp] || 0) - (a.r[C.bp] || 0));
  if(!cs.length) return '<div class="nodata">기록 없음</div>';
  return '<div class="tbl" style="margin-top:0"><table class="lb-t"><tr><th>순위</th><th style="text-align:left">캐릭터</th><th>전투력</th><th>마스터리</th><th>전문화</th><th>통합 레벨</th></tr>'
    + cs.map((c, i) => `<tr><td class="rk2 num">${i + 1}</td><td>${esc(c.t.n)}<div style="font-size:11px;color:var(--dim)">${esc(wName(c.t.w))} ${serverLabel(c.r[C.s])}</div></td><td class="num">${nf(c.r[C.bp])}${delta(c.last?.bp, c.prev?.bp)}</td><td style="text-align:center">${esc(mname(mcode(c.r[C.mc])))} <span class="dg" style="font-size:19px">${nf(c.r[C.ml])}</span></td><td class="num">${nf(c.r[C.sp])}${delta(c.last?.sp, c.prev?.sp)}</td><td class="num" style="color:var(--amb)">${c.integ ? c.integ.l : '--'}</td></tr>`).join('')
    + '</table></div>';
}
function ulog(){
  const runs = (D.meta?.runs || []).slice().reverse().slice(0, 8);
  if(!runs.length) return `<div class="ulog">아직 수집 기록이 없습니다. 매일 ${pad2(AUTO_HOUR)}:00쯤 자동으로 수집합니다.</div>`;
  return '<div class="ulog">' + runs.map(u => `<div><span style="color:var(--dim)">${esc(u.at.slice(5, 16).replace('T', ' '))}</span><span class="md ${u.mode === '자동' ? 'auto' : ''}">${esc(u.mode)}</span>기준 ${esc(u.date.slice(5))} · 캐릭터 <b class="up">${nf(u.ok)}</b>${u.fail ? ` · 실패 <b class="dn">${u.fail}</b>` : ''}${u.moves ? ` · 이동 ${u.moves}` : ''}</div>`).join('') + '</div>';
}
function overview(){
  return `<section class="ov fr">${NODES}
    <div class="bar"><span class="sid g">종합 현황</span>
      <span style="margin-left:auto;font-size:12px;color:var(--dim)">데이터 기준일 ${esc(D.meta?.date || '----')} · 매일 ${pad2(AUTO_HOUR)}:05쯤 자동 수집 · 새벽 05:00 재확인</span></div>
    <div class="ovgrid">
      <div style="grid-column:1/-1;border-right:0"><div class="ovh"><span class="t">최근 7일 전투력 증가</span></div>${gains()}</div>
      <div style="grid-column:1/-1;border-right:0"><div class="ovh"><span class="t">수집 기록</span></div>${ulog()}</div>
      <div style="grid-column:1/-1;border-right:0;border-bottom:0"><div class="ovh"><span class="t">전투력 순위</span></div>${board()}</div>
    </div></section>`;
}
function histPanels(c){
  const names = c.ev.filter(x => x.kind === '닉네임 변경'), guilds = c.ev.filter(x => x.kind === '길드 변경');
  const others = c.ev.filter(x => x.kind !== '닉네임 변경' && x.kind !== '길드 변경');
  const since = c.series[0]?.d || c.t.added || '';
  const curG = c.r ? (c.r[C.g] || '') : (c.h?.g || '');
  const item = x => `<div class="hi-row"><span class="hd">${esc(x.d)}</span><span class="old">${esc(x.before || '없음')}</span><span class="arrow">→</span><b class="new">${esc(x.after || '없음')}</b>
      <span class="hn">${x.manual ? '직접 변경' : (x.score ? '일치도 ' + x.score + '%' : '')}</span></div>`;
  const panel = (title, list, cur, emptyMsg) => `<div class="hpanel ${list.length ? 'has' : ''}">
      <div class="hp-h"><span>${title}</span><b class="cnt">${list.length}회</b></div>
      <div class="hp-cur">현재 <b>${esc(cur || '없음')}</b>${since ? `<span>기록 시작 ${esc(since)}</span>` : ''}</div>
      ${list.length ? list.map(item).join('') : `<div class="empty">${emptyMsg}</div>`}</div>`;
  return `<div class="sec hsec">변경 이력 <small>매일 수집할 때 자동 기록 · 최신순</small></div>
    <div class="hpanels">${panel('닉네임 변경 이력', names, c.t.n, '닉네임 변경 없음')}${panel('길드 변경 이력', guilds, curG, '길드 변경 없음')}</div>
    ${others.length ? `<div class="chg"><div class="tbl" style="margin-top:0"><table><tr><th>기준일</th><th>구분</th><th>이전 → 이후</th></tr>${others.map(x => `<tr><td>${esc(x.d)}</td><td><span class="kt k-${esc(x.kind.split(' ')[0])}">${esc(x.kind)}</span></td><td><span class="old">${esc(x.before || '없음')}</span><span class="arrow">→</span><span class="new">${esc(x.after || '없음')}</span></td></tr>`).join('')}</table></div></div>` : ''}`;
}
const BACKUP_NOTE = `<div class="note fr" style="margin-top:14px">추적 · 즐겨찾기 · 직접 입력한 마스터리는 <b>이 브라우저</b>에 저장됩니다. 다른 기기로 옮기거나 보관하려면
     <button class="mini-btn" data-act="backup">백업 저장</button> <button class="mini-btn" data-act="restore">백업 불러오기</button></div>`;
// 검색한 캐릭터·최근 본 캐릭터는 이번 접속(탭) 동안만 기억 — 새로 접속하면 첫 화면은 비어 있음
// (추적 · 즐겨찾기 · 메모 · 경험치 기록은 그대로 저장)
function saveSession(){ try{ sessionStorage.setItem('l9session', JSON.stringify({cur: ST.cur || null, recent: ST.recent || []})); }catch(e){} }
function loadSession(){
  let x = null; try{ x = JSON.parse(sessionStorage.getItem('l9session') || 'null'); }catch(e){}
  ST.cur = x?.cur || null; ST.recent = x?.recent || [];
}
function setCur(w, n){
  ST.cur = {w: Number(w), n};
  ST.recent = [{w: Number(w), n}].concat((ST.recent || []).filter(x => !(x.w === Number(w) && x.n === n))).slice(0, 8);
  saveSession();
}
async function pageMy(){
  await followMoves().then(n => n.length && showLines('닉네임 변경 · 월드 이전을 따라갔습니다', n));
  if(!ST.cur) return blank('캐릭터를 검색하세요', '상단의 [ 검색 ]에서 캐릭터를 찾으면 이곳에 정보가 표시됩니다 · 랭킹에서 캐릭터를 눌러도 됩니다') + BACKUP_NOTE;
  CARDS = await buildCards([ST.cur]);
  const rec = (ST.recent || []).filter(x => !(x.w === ST.cur.w && x.n === ST.cur.n));
  setTimeout(fillMissCands, 0);
  return `<div class="recent fr">${rec.length ? `<span class="lbl">최근 본 캐릭터</span>${rec.map(x => `<button class="chip" data-act="setcur" data-w="${x.w}" data-n="${esc(x.n)}"><b>${esc(x.n)}</b> <small>${esc(wName(x.w))}</small></button>`).join('')}` : '<span class="lbl">검색한 캐릭터 1명이 표시됩니다</span>'}
      <button class="btn myreset" data-act="my-reset" title="표시 중인 캐릭터와 최근 본 캐릭터를 지웁니다 (추적 · 즐겨찾기는 그대로)">화면 초기화</button></div>`
    + subject(CARDS[0], 0, 'main') + BACKUP_NOTE;
}
let TRSEL = lsGet('l9trsel', '');
// 목록의 [해제] 버튼이 [모두 해제] 버튼 가운데에 오도록 맞춤 (화면 폭이 달라도)
function alignTrBar(){
  const bar = document.querySelector('.trbar'), tbl = document.querySelector('.trk');
  if(!bar || !tbl) return;
  // 버튼 3개를 가장 넓은 버튼 너비로 통일
  const bs = [...bar.querySelectorAll('.btn')]; bs.forEach(x => x.style.width = '');
  const w = Math.max(...bs.map(x => x.getBoundingClientRect().width)); bs.forEach(x => x.style.width = Math.ceil(w) + 'px');
  // 목록의 [해제] 버튼을 [모두 해제] 가운데로
  const btn = bar.querySelector('[data-act=tr-delall]'), row = tbl.querySelector('[data-act=del]');
  if(!btn || !row) return;
  const cell = row.closest('td'), cur = parseFloat(getComputedStyle(cell).paddingRight) || 0;
  const b = btn.getBoundingClientRect(), r = row.getBoundingClientRect();
  const diff = (r.left + r.right) / 2 - (b.left + b.right) / 2;
  if(Math.abs(diff) > .5) tbl.style.setProperty('--delpad', Math.max(0, cur + diff) + 'px');
}
window.addEventListener('resize', () => alignTrBar());
const TRF = Object.assign({q: '', g: '', w: 0, sort: 'add'}, JSON.parse(lsGet('l9trf', '{}') || '{}'));   // 추적 목록 찾기 · 필터
function saveTRF(){ lsSet('l9trf', JSON.stringify(TRF)); }
const TRVIEW = {keys: []};   // 지금 화면에 보이는 (필터 적용된) 추적 캐릭터
function trGuild(c){ return c.r ? (c.r[C.g] || '') : (c.h?.g || ''); }
function trFilter(cards){
  const q = TRF.q.trim().toLowerCase();
  let v = cards.filter(c => (!TRF.w || c.t.w === TRF.w)
    && (!TRF.g || (TRF.g === '-' ? !trGuild(c) : trGuild(c) === TRF.g))
    && (!q || c.t.n.toLowerCase().includes(q) || trGuild(c).toLowerCase().includes(q)));
  const bp = c => (c.r ? c.r[C.bp] : c.last?.bp) || 0, ml = c => (c.r ? c.r[C.ml] : c.last?.ml) || 0, sp = c => (c.r ? c.r[C.sp] : c.last?.sp) || 0;
  const by = {bp: (a, b) => bp(b) - bp(a), ml: (a, b) => ml(b) - ml(a) || bp(b) - bp(a), sp: (a, b) => sp(b) - sp(a),
    name: (a, b) => a.t.n.localeCompare(b.t.n, 'ko'), guild: (a, b) => (trGuild(a) || '힣').localeCompare(trGuild(b) || '힣', 'ko') || bp(b) - bp(a)}[TRF.sort];
  return by ? v.slice().sort(by) : v;
}
const TRCHK = new Set();   // 추적 목록에서 선택한 캐릭터
async function pageTrack(){
  await followMoves().then(n => n.length && showLines('닉네임 변경 · 월드 이전을 따라갔습니다', n));
  if(!ST.tracked.length) return blank('추적 중인 캐릭터가 없습니다', '[ 검색 ] 또는 랭킹에서 캐릭터를 열고 [+ 추적 추가]를 누르세요') + BACKUP_NOTE;
  CARDS = await buildCards();
  let sel = CARDS.findIndex(c => c.k === TRSEL); if(sel < 0) sel = 0;
  const lastCh = c => c.ev.find(x => x.kind === '닉네임 변경' || x.kind === '길드 변경');
  for(const k of [...TRCHK]) if(!CARDS.some(c => c.k === k)) TRCHK.delete(k);
  const view = trFilter(CARDS); TRVIEW.keys = view.map(c => c.k);
  const allOn = view.length && view.every(c => TRCHK.has(c.k));
  const gm = new Map(); for(const c of CARDS){ const g = trGuild(c) || '-'; gm.set(g, (gm.get(g) || 0) + 1); }
  const gl = [...gm].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  if(TRF.g && !gm.has(TRF.g)) TRF.g = '';
  const wl = [...new Set(CARDS.map(c => c.t.w))];
  const filtered = view.length !== CARDS.length;
  const list = `<section class="ov fr">${NODES}<div class="bar"><span class="sid g">추적 캐릭터 관리</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">${filtered ? `${view.length} / ${CARDS.length}명` : `${CARDS.length}명`} · 줄을 누르면 아래에 상세 표시</span></div>
    <div class="ctrls trf"><input class="q" data-in="tr-q" value="${esc(TRF.q)}" placeholder="캐릭터명 · 길드명 찾기">
      <span class="lbl">길드</span><select data-ch="tr-g"><option value="">전체 (${CARDS.length})</option>${gl.map(([g, n]) => `<option value="${esc(g)}" ${g === TRF.g ? 'selected' : ''}>${g === '-' ? '길드 없음' : esc(g)} (${n})</option>`).join('')}</select>
      ${wl.length > 1 ? `<span class="lbl">월드</span><select data-ch="tr-w"><option value="0">전체</option>${wl.map(w => `<option value="${w}" ${w === TRF.w ? 'selected' : ''}>${esc(wName(w))}</option>`).join('')}</select>` : ''}
      <span class="lbl">정렬</span><select data-ch="tr-sort">${[['add', '추가한 순'], ['bp', '전투력'], ['ml', '대표 마스터리'], ['sp', '전문화'], ['name', '캐릭터명'], ['guild', '길드명']].map(([v, l]) => `<option value="${v}" ${v === TRF.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${filtered || TRF.q || TRF.g || TRF.w ? '<button class="btn" data-act="tr-freset">필터 초기화</button>' : ''}</div>
    <div class="ctrls trbar"><span class="lbl">선택 <b class="hi">${TRCHK.size}</b> 명</span>
      <button class="btn" data-act="tr-delsel" ${TRCHK.size ? '' : 'disabled'}>선택 해제${TRCHK.size ? ` (${TRCHK.size}명)` : ''}</button>
      <button class="btn" data-act="tr-chknone" ${TRCHK.size ? '' : 'disabled'}>선택 취소</button>
      <span class="sp"></span>
      <button class="btn" data-act="tr-delall">모두 해제 (${CARDS.length}명)</button></div>
    <div class="tbl" style="margin:0;border:0"><table class="rk trk"><tr><th class="chk"><button class="cb ${allOn ? 'on' : ''}" data-act="tr-chkall" title="${filtered ? '보이는 캐릭터 모두 선택' : '모두 선택'}">${allOn ? '✓' : ''}</button></th><th>#</th><th class="l">캐릭터</th><th class="hide-s l">길드</th><th>대표 마스터리</th><th>전투력</th><th>전문화</th><th class="hide-s">직업</th><th class="l">최근 변경</th><th></th></tr>
    ${view.length ? '' : `<tr><td colspan="10" class="emptyrow">찾는 캐릭터가 없습니다 — 검색어나 길드 필터를 바꿔 보세요</td></tr>`}
    ${view.map((c, i) => { const r = c.r, lc = lastCh(c);
      return `<tr class="rkrow ${c === CARDS[sel] ? 'mine' : ''} ${TRCHK.has(c.k) ? 'chk' : ''}" data-act="trsel" data-k="${esc(c.k)}"><td class="chk"><button class="cb ${TRCHK.has(c.k) ? 'on' : ''}" data-act="tr-chk" data-k="${esc(c.k)}" title="선택">${TRCHK.has(c.k) ? '✓' : ''}</button></td><td class="no">${i + 1}</td>
        <td class="l"><div class="nm">${esc(c.t.n)}</div><div class="sub">${esc(wName(c.t.w))} ${r ? serverLabel(r[C.s]) : ''}</div></td>
        <td class="hide-s l">${esc(r ? (r[C.g] || '-') : '--')}</td>
        <td>${r ? `<span class="big" style="font-size:19px">${nf(r[C.ml])}</span><div class="sub">${esc(mname(mcode(r[C.mc])))}</div>` : '--'}</td>
        <td><span class="big" style="font-size:19px">${nf(r ? r[C.bp] : c.last?.bp)}</span>${delta(c.last?.bp, c.prev?.bp)}</td>
        <td><span class="big" style="font-size:19px">${nf(r ? r[C.sp] : c.last?.sp)}</span>${delta(c.last?.sp, c.prev?.sp)}</td>
        <td class="hide-s">${r ? esc(jobName(r[C.j])) : '--'}</td>
        <td class="l">${lc ? `<span class="kt k-${esc(lc.kind.split(' ')[0])}">${esc(lc.kind)}</span> <span class="sub" style="display:inline">${esc(lc.d.slice(5))}</span>` : '<span class="sub">없음</span>'}</td>
        <td><button class="mini-btn" data-act="del" data-k="${esc(c.k)}">해제</button></td></tr>`; }).join('')}
    </table></div></section>`;
  setTimeout(fillMissCands, 0); setTimeout(alignTrBar, 0);
  return list + overview() + subject(CARDS[sel], sel, 'track') + BACKUP_NOTE;
}
async function fillMissCands(){
  const els = document.querySelectorAll('[data-miss]'); if(!els.length || !readyWorlds().length) return;
  const ws = await allWorlds();
  els.forEach(el => {
    const [w, n] = el.dataset.miss.split('|');
    const c = [];
    for(const j of ws) for(const r of j.rows){ const nm = r[C.n];
      if((nm === n && r[C.w] !== Number(w)) || (nm.startsWith(n) && /^\d+$/.test(nm.slice(n.length)))) c.push(`${wName(r[C.w])} ${nm}`); }
    el.querySelector('.cands-msg').textContent = c.length ? ' · 후보: ' + c.slice(0, 5).join(', ') + ' — [닉네임/월드]로 바꿀 수 있습니다' : '';
  });
  const mv = await moves();
  els.forEach(el => {
    const [w, n] = el.dataset.miss.split('|');
    const l = mv.filter(m => m.lv === '유력' && m.from[0] === Number(w) && m.from[1] === n).slice(-3);
    if(!l.length) return;
    const box = document.createElement('div'); box.className = 'likely';
    box.innerHTML = NB(`<b class="cfb c2">유력</b> 월드 · 서버 이전 또는 닉네임 변경으로 보이는 캐릭터가 있습니다 (단정할 수 없어 자동으로 옮기지 않았습니다)`
      + l.map(m => `<div class="lk"><span><b>${esc(m.to[1])}</b> ${esc(wName(m.to[0]))} ${m.ts?.[0] ? serverLabel(m.ts[0]) : ''} · ${esc(m.ts?.[1] || '길드 없음')} · 일치도 ${m.score}%${m.n > 1 ? ` · 후보 ${m.n}명` : ''} · ${esc(dayStr(m.d).slice(5))}</span>
        <button class="mini-btn" data-act="mv-apply" data-ow="${w}" data-on="${esc(n)}" data-w="${m.to[0]}" data-n="${esc(m.to[1])}">이 캐릭터로 바꾸기</button></div>`).join(''));
    el.after(box);
  });
}

/* 마스터리 칸 바로 입력 */
function startMEdit(el){
  if(el.classList.contains('editing')) return;
  document.querySelectorAll('.m.editing').forEach(x => cancelMEdit(x));
  const c = CARDS.find(x => x.k === el.dataset.k), code = el.dataset.code, m = c.ms[code];
  el.classList.add('editing'); el._html = el.innerHTML;
  el.querySelector('.mv').innerHTML = `<input class="min" type="number" min="1" max="300" inputmode="numeric" value="${m ? m.level : ''}" aria-label="${esc(mname(code))} 레벨">`;
  el.querySelector('.md').textContent = 'Enter 저장';
  el.querySelector('.hint')?.remove();
  const inp = el.querySelector('.min');
  inp.focus(); inp.select();
  inp.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); saveMEdit(el, inp.value); }
    else if(e.key === 'Escape'){ e.preventDefault(); cancelMEdit(el); }
  });
  inp.addEventListener('blur', () => setTimeout(() => { if(el.classList.contains('editing')) saveMEdit(el, inp.value); }, 120));
  inp.addEventListener('click', e => e.stopPropagation());
}
function cancelMEdit(el){ if(!el.classList.contains('editing')) return; el.classList.remove('editing'); el.innerHTML = el._html; }
async function saveMEdit(el, val){
  const k = el.dataset.k, code = el.dataset.code, c = CARDS.find(x => x.k === k), m = c?.ms[code];
  val = String(val).trim();
  if(!val || !/^\d+$/.test(val) || Number(val) < 1 || (m && Number(val) === m.level)){ cancelMEdit(el); return; }
  el.classList.remove('editing');
  (ST.mastery[k] ||= {})[code] = {l: Number(val), d: todayKST()};
  saveStore();
  await render();
  document.querySelector(`.m[data-k="${CSS.escape(k)}"][data-code="${code}"]`)?.classList.add('flash');
  toast(`${k.split('|')[1]} · ${mname(code)} ${val} 저장했습니다`);
}

/* ============================================================ 범위 선택 (랭킹 · TOP 20 · 통계 공용) */
const SC = Object.assign({scope:'all', w:null, s:0}, JSON.parse(lsGet('l9scope', '{}') || '{}'));
function saveSC(){ lsSet('l9scope', JSON.stringify(SC)); }
function partialNote(){
  const m = D.meta; if(!m?.partial && !readyWorlds().some(w => w.stale)) return '';
  const rw = readyWorlds(), c = D.local?.crawl;
  const run = c?.running ? ` · 진행 ${nf(c.done)}/${nf(c.total)}` : '';
  const stale = rw.filter(w => w.stale).map(w => w.name);
  return `<div class="note">전체 수집 ${m.partial ? '진행 중' : '일부 실패'}: <b>${rw.filter(w => !w.stale).length}/${m.worlds.length}</b> 월드 완료${run}${stale.length ? ` · ${esc(stale.join(', '))}은(는) 이전 기준일 데이터` : ''} — 끝난 월드부터 바로 표시됩니다</div>`;
}
function scopeCtrls(){
  const ws = readyWorlds();
  if(SC.w == null || !ws.find(w => w.code === SC.w)) SC.w = ws[0]?.code;
  const sv = ws.find(w => w.code === SC.w)?.servers || [];
  if(!sv.includes(SC.s)) SC.s = sv[0] || 0;
  return `<span class="lbl">범위</span>${seg('sc-scope', SC.scope, [['all', '전체 월드'], ['world', '월드'], ['server', '서버']])}
    ${SC.scope !== 'all' ? `<select data-ch="sc-w">${ws.map(w => `<option value="${w.code}" ${w.code === SC.w ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>` : ''}
    ${SC.scope === 'server' ? `<select data-ch="sc-s">${sv.map(s => `<option value="${s}" ${s === SC.s ? 'selected' : ''}>${serverLabel(s)}</option>`).join('')}</select>` : ''}`;
}
async function scopeRows(){
  if(SC.scope === 'all') return (await allWorlds()).flatMap(j => j.rows);
  const j = await world(SC.w);
  return SC.scope === 'server' ? j.rows.filter(r => r[C.s] === SC.s) : j.rows;
}
function scopeName(){ return SC.scope === 'all' ? '전체 월드' : wName(SC.w) + (SC.scope === 'server' ? ' ' + serverLabel(SC.s) : ''); }
const byBp = (a, b) => (b[C.bp] || 0) - (a[C.bp] || 0) || (b[C.ml] || 0) - (a[C.ml] || 0);
const byMl = (a, b) => (b[C.ml] || 0) - (a[C.ml] || 0) || (b[C.bp] || 0) - (a[C.bp] || 0);
async function sorted(by, job){
  const ck = [by, SC.scope, SC.w, SC.s, job].join('/');
  if(!D.sortCache[ck]){
    let rows = await scopeRows();
    if(job !== '' && job != null) rows = rows.filter(r => r[C.j] === Number(job));
    D.sortCache[ck] = rows.slice().sort(by === 'ml' ? byMl : byBp);
  }
  return D.sortCache[ck];
}
const isTracked = r => ST.tracked.some(t => t.w === r[C.w] && t.n === r[C.n]);

/* ============================================================ 랭킹 */
const RK = Object.assign({by:'ml', job:'', q:'', page:0}, JSON.parse(lsGet('l9rank', '{}') || '{}'));
const PAGE = 50;
async function pageRank(){
  if(!readyWorlds().length) return noData();
  const list = await sorted(RK.by, RK.job);
  const q = RK.q.trim();
  const view = q ? list.map((r, i) => [r, i]).filter(([r]) => r[C.n].includes(q) || (r[C.g] || '').includes(q)) : list.map((r, i) => [r, i]);
  const pages = Math.max(1, Math.ceil(view.length / PAGE));
  RK.page = Math.min(RK.page, pages - 1);
  const slice = view.slice(RK.page * PAGE, RK.page * PAGE + PAGE);
  const mine = list.map((r, i) => [r, i]).filter(([r]) => isTracked(r));
  const jobs = D.meta.jobs.map((j, i) => [i, j]).filter(([, j]) => j && j !== '-').sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  let h = `<section class="ov fr">${NODES}
    <div class="bar"><span class="sid g">랭킹 <em style="margin-left:10px">${esc(scopeName())}</em></span>
      <span style="margin-left:auto;font-size:12px;color:var(--dim)">기준일 ${esc(D.meta.date)} · ${nf(list.length)}명 · ${critText()}</span></div>
    ${partialNote()}<div class="ctrls"><span class="lbl">기준</span>${seg('rk-by', RK.by, [['ml', '대표 마스터리'], ['bp', '전투력']])}
      ${scopeCtrls()}
      <span class="lbl">직업</span><select data-ch="rk-job"><option value="">전체</option>${jobs.map(([i, j]) => `<option value="${i}" ${String(i) === String(RK.job) ? 'selected' : ''}>${esc(j)}</option>`).join('')}</select>
      <span class="sp"></span><input class="q" data-in="rk-q" value="${esc(RK.q)}" placeholder="닉네임 · 길드 찾기"></div>`;
  if(mine.length) h += `<div class="ctrls"><span class="lbl">추적 캐릭터</span><div class="chips">${mine.map(([r, i]) => `<button class="chip" data-act="rk-goto" data-i="${i}">${esc(r[C.n])}<b>${i + 1}위</b></button>`).join('')}</div></div>`;
  h += `<div class="tbl" style="margin:0;border:0"><table class="rk rkm"><tr><th>순위</th><th class="l">캐릭터</th><th class="hide-s">직업</th><th>대표 마스터리</th><th>전투력</th><th>전문화</th><th class="hide-s">업적점수</th><th class="hide-s l">길드</th><th></th></tr>`;
  h += slice.map(([r, i]) => rankRow(r, i)).join('') || `<tr><td colspan="9" class="emptyrow">찾는 캐릭터가 없습니다</td></tr>`;
  h += '</table></div>';
  h += `<div class="pager"><button class="btn" data-act="rk-page" data-p="0" ${RK.page ? '' : 'disabled'}>처음</button><button class="btn" data-act="rk-page" data-p="${RK.page - 1}" ${RK.page ? '' : 'disabled'}>이전</button>
    <span class="pi">${RK.page + 1} / ${pages} 쪽 · ${nf(view.length)}명</span>
    <button class="btn" data-act="rk-page" data-p="${RK.page + 1}" ${RK.page < pages - 1 ? '' : 'disabled'}>다음</button><button class="btn" data-act="rk-page" data-p="${pages - 1}" ${RK.page < pages - 1 ? '' : 'disabled'}>끝</button></div></section>`;
  return h;
}
function rankRow(r, i){
  const t = i < 3 ? 't' + (i + 1) : '';
  const main = RK.by === 'ml'
    ? `<td><span class="big">${nf(r[C.ml])}</span><div class="sub">${esc(mname(mcode(r[C.mc])))}</div></td><td><span class="dg" style="font-size:19px">${nf(r[C.bp])}</span></td>`
    : `<td><span class="dg" style="font-size:19px">${nf(r[C.ml])}</span><div class="sub">${esc(mname(mcode(r[C.mc])))}</div></td><td><span class="big">${nf(r[C.bp])}</span></td>`;
  return `<tr class="rkrow ${isTracked(r) ? 'mine' : ''}" data-act="char" data-w="${r[C.w]}" data-n="${esc(r[C.n])}" id="rk-${i}">
    <td class="no ${t}">${i + 1}</td><td class="l"><div class="nm">${esc(r[C.n])}</div><div class="sub">${esc(wName(r[C.w]))} ${serverLabel(r[C.s])}</div></td>
    <td class="hide-s">${esc(jobName(r[C.j]))}</td>${main}<td class="dg" style="font-size:18px">${nf(r[C.sp])}</td><td class="hide-s dg" style="font-size:18px">${nf(r[C.ach])}</td><td class="hide-s l">${esc(r[C.g] || '-')}</td>
    <td style="white-space:nowrap"><button class="star ${isFav(r[C.w], r[C.n]) ? 'on' : ''}" data-act="fav" data-w="${r[C.w]}" data-n="${esc(r[C.n])}" title="즐겨찾기">${isFav(r[C.w], r[C.n]) ? '★' : '☆'}</button>
      ${isTracked(r) ? '<span class="sub">추적 중</span>' : `<button class="mini-btn" data-act="track" data-w="${r[C.w]}" data-n="${esc(r[C.n])}">+ 추적</button>`}</td></tr>`;
}
async function rowOf(w, n){
  // 수집 데이터 → 바로 조회 기록 → (내 PC) 사이트 실시간 조회
  w = Number(w);
  if(readyWorlds().some(x => x.code === w)){ const j = await world(w).catch(() => null); const r = j?.byName.get(n); if(r) return {r, date: j.date || D.meta?.date}; }
  const q = D.quick?.rows?.[key(w, n)]; if(q){ const r = q.slice(); r[C.w] = w; return {r, date: D.quick.date}; }
  const lk = key(w, n);
  if(D.local){
    if(!(lk in (D.live ||= {}))){
      try{ const j = await localApi('api/char?world=' + w + '&name=' + encodeURIComponent(n)); D.live[lk] = j.row ? Object.assign(j.row.slice(), {[C.w]: w}) : null; D.liveDate = j.date; }
      catch(e){ return null; }
    }
    if(D.live[lk]) return {r: D.live[lk], date: D.liveDate || todayKST()};
  }
  return null;
}
const isFav = (w, n) => (ST.fav || []).some(f => f.w === Number(w) && f.n === n);
function favOf(w, n){ return (ST.fav || []).find(f => f.w === Number(w) && f.n === n); }
function toggleFav(w, n){
  w = Number(w); ST.fav ||= [];
  if(isFav(w, n)){ ST.fav = ST.fav.filter(f => !(f.w === w && f.n === n)); saveStore(); toast(`${n} 즐겨찾기 해제`); return false; }
  ST.fav.push({w, n, memo: '', added: todayKST()}); saveStore(); toast(`${n} 즐겨찾기에 추가했습니다`); return true;
}
function kv(k, v, cls = ''){ return `<div class="k">${k}</div><div class="v ${cls}">${v}</div>`; }
async function charDialog(w, n){
  w = Number(w);
  const got = await rowOf(w, n);
  if(!got){ toast(`${n}: 정보를 찾지 못했습니다`); return; }
  const r = got.r, tracked = ST.tracked.some(t => t.w === w && t.n === n), fav = favOf(w, n);
  const html = `<div class="kv">
      ${kv('월드', esc(wName(w)) + ' ' + serverLabel(r[C.s]))}${kv('직업', esc(jobName(r[C.j])))}${kv('길드', (r[C.g] ? `<a class="glink" data-act="guildgo" data-w="${w}" data-s="${r[C.s]}" data-g="${esc(r[C.g])}" title="길드원 보기">${esc(r[C.g])}</a>` : '--'))}
      ${kv('대표 마스터리', `${esc(mname(mcode(r[C.mc])))} <b class="dg">${nf(r[C.ml])}</b>`)}
      ${kv('장착 무기', `${esc(mname(mcode(r[C.m1c])))} ${nf(r[C.m1l])} · ${esc(mname(mcode(r[C.m2c])))} ${nf(r[C.m2l])}`)}
      ${kv('마스터리 랭크', '#' + nf(r[C.mr]), 'dg')}${kv('전투력', nf(r[C.bp]), 'dg')}
      ${kv('전투력 순위', `월드 <b class="dg">#${nf(r[C.bwr])}</b> · 서버 <b class="dg">#${nf(r[C.bsr])}</b>`)}
      ${kv('업적점수', nf(r[C.ach]), 'dg')}${kv('전문화', nf(r[C.sp]), 'dg')}</div>
    ${fav ? `<div class="f" style="margin:14px 0 0"><label>즐겨찾기 메모</label><textarea class="memo" data-memo="${esc(key(w, n))}" rows="3" placeholder="메모 입력 (자동 저장)">${esc(fav.memo || '')}</textarea></div>` : ''}`;
  showDlg(`<b class="cname">${esc(n)}</b> <small>${esc(got.date || '')} 기준</small>`, html, [
    {id:'main', label:'캐릭터에서 보기', run:() => { $('#dlgAdd').open && $('#dlgAdd').close(); setCur(w, n); if(route() !== 'my') location.hash = '#my'; else render(); }},
    {id:'fav', label: fav ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기', run: () => { toggleFav(w, n); render(); charDialog(w, n); }},
    tracked ? {id:'go', label:'추적에서 보기', pri:true, run:() => { TRSEL = key(w, n); lsSet('l9trsel', TRSEL); location.hash = '#track'; }}
            : {id:'add', label:'+ 추적 추가', pri:true, run:() => { $('#dlgAdd').open && $('#dlgAdd').close(); track(w, n); }}], true);
}
function track(w, n){
  w = Number(w);
  if(ST.tracked.some(t => t.w === w && t.n === n)){ toast('이미 추적 중입니다'); return; }
  ST.tracked.push({w, n, added: todayKST(), ev: []}); saveStore();
  toast(`${n} 추적을 시작합니다 — [추적]에서 관리합니다`);
  if(D.local) quickRun([[w, n]], true); else render();
}
async function quickRun(chars, announce){
  try{
    const r = await localApi('api/quick', {chars, save_list: false});
    localApi('api/tracked', {chars: ST.tracked.map(t => [t.w, t.n])}).catch(() => {});
    await loadQuick();
    if(announce) toast(r.lines?.[0] || '조회했습니다');
    return r;
  }catch(e){ toast('조회 실패: ' + e.message); }
  finally{ await render(); }
}

/* ============================================================ 길드 */
// 길드는 월드 · 서버별로 따로 (같은 이름이라도 서버가 다르면 다른 길드)
const gkey = (w, s, g) => `${w}|${s}|${g}`;
const gLabel = g => `${wName(g.w)} ${serverLabel(g.s)}`;
async function guildIndex(){
  if(!D.sortCache.guilds){
    const idx = new Map();
    for(const j of await allWorlds()) for(const r of j.rows){
      if(!r[C.g]) continue;
      const k = gkey(r[C.w], r[C.s], r[C.g]);
      let g = idx.get(k); if(!g){ g = {k, w: r[C.w], s: r[C.s], g: r[C.g], rows: []}; idx.set(k, g); }
      g.rows.push(r);
    }
    for(const g of idx.values()){ g.rows.sort(byBp); g.avg = g.rows.reduce((a, r) => a + (r[C.bp] || 0), 0) / g.rows.length; }
    D.sortCache.guilds = idx;
  }
  return D.sortCache.guilds;
}
async function findGuilds(q, w, sv){
  const idx = await guildIndex(), out = [];
  for(const g of idx.values()) if((!w || g.w === w) && (!sv || g.s === sv) && g.g.includes(q)) out.push(g);
  return out.sort((a, b) => (b.g === q) - (a.g === q) || b.rows.length - a.rows.length || b.avg - a.avg);
}
// 길드 화면 상태는 이번 접속(탭) 동안만 기억
const GS = (() => { let x = null; try{ x = JSON.parse(sessionStorage.getItem('l9guild') || 'null'); }catch(e){} x = x || {}; if(x.sel && x.sel.split('|').length !== 3) x.sel = null; return {q: x.q || '', sel: x.sel || null, per: x.per || 30}; })();
function saveGS(){ try{ sessionStorage.setItem('l9guild', JSON.stringify(GS)); }catch(e){} }
function openGuild(k){ GS.sel = k; saveGS(); if(route() !== 'guild') location.hash = '#guild'; else { render().then(() => $('#gdetail')?.scrollIntoView({block:'start'})); } }
async function gevents(){ if(!D.gev) D.gev = getJSON('data/gevents.json').catch(() => []); return D.gev; }
function nameHist(e){
  if(!e.names?.length) return '<span class="sub">-</span>';
  return e.names.map(x => `<div class="nh"><span class="old">${esc(x[1])}</span><span class="arrow">→</span><b>${esc(x[2])}</b> <span class="sub" style="display:inline">${esc(dayStr(x[0]).slice(5))}</span></div>`).join('');
}
function moveTable(list, kind){
  if(!list.length) return `<div class="empty" style="padding:12px 16px">${kind === 'in' ? '신규 가입' : '탈퇴'} 기록 없음</div>`;
  return `<div class="tbl" style="margin:0;border:0"><table class="rk gmv"><tr><th>날짜</th><th class="l">캐릭터 (현재 닉네임)</th><th>전투력</th><th>대표 마스터리</th><th class="l">${kind === 'in' ? '이전 길드' : '옮긴 길드'}</th><th class="l">닉네임 변경</th></tr>
    ${list.map(e => `<tr class="${e.seen ? 'rkrow' : ''}" ${e.seen ? `data-act="char" data-w="${e.w}" data-n="${esc(e.n)}"` : ''}>
      <td class="dg" style="font-size:16px">${esc(dayStr(e.d).slice(5))}</td>
      <td class="l"><div class="nm">${esc(e.n)}</div>${e.seen ? '' : '<div class="sub">현재 수집 기준 밖</div>'}</td>
      <td><span class="big" style="font-size:18px">${nf(e.bp)}</span></td>
      <td><span class="big" style="font-size:18px">${nf(e.ml)}</span><div class="sub">${esc(mname(e.mc))}</div></td>
      <td class="l">${(kind === 'in' ? e.from : e.to) ? `<b class="gprev">${esc(kind === 'in' ? e.from : e.to)}</b>` : '<span class="sub">길드 없음</span>'}</td>
      <td class="l">${nameHist(e)}</td></tr>`).join('')}</table></div>`;
}
async function pageGuild(){
  if(!readyWorlds().length) return noData();
  const hits = GS.q ? await findGuilds(GS.q) : [];
  let h = `<section class="ov fr">${NODES}
    <div class="bar"><span class="sid g">길드</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">기준일 ${esc(D.meta.date)} · ${critText()}</span></div>
    <div class="ctrls"><span class="lbl">길드명</span><input class="q" id="gq" value="${esc(GS.q)}" placeholder="길드명 입력 (일부만 입력해도 됨)" style="width:260px">
      <button class="btn pri" data-act="g-find">찾기</button><button class="btn" data-act="g-reset">초기화</button></div>`;
  if(GS.q){
    h += `<div class="sec">검색 결과 <small>${nf(hits.length)}개 · 길드를 누르면 길드 정보</small></div>`
      + (hits.length ? `<div class="tbl" style="margin:0;border:0"><table class="rk glist"><tr><th class="l">길드명</th><th>월드</th><th>서버</th><th>인원</th><th>평균 전투력</th><th>최고 전투력</th></tr>
        ${hits.slice(0, 100).map(g => `<tr class="rkrow ${g.k === GS.sel ? 'mine' : ''}" data-act="g-open" data-k="${esc(g.k)}"><td class="l"><span class="nm">${esc(g.g)}</span></td>
          <td>${esc(wName(g.w))}</td><td>${serverLabel(g.s)}</td><td><span class="big" style="font-size:19px">${nf(g.rows.length)}</span></td>
          <td><span class="big" style="font-size:19px">${nf(Math.round(g.avg))}</span></td><td><span class="big" style="font-size:19px">${nf(g.rows[0][C.bp])}</span></td></tr>`).join('')}</table></div>`
        : '<div class="empty" style="padding:14px 16px">찾는 길드가 없습니다 — 길드원이 모두 수집 기준 밖이면 검색되지 않습니다.</div>');
  }
  h += '</section>';
  if(!GS.sel) return h + (GS.q ? '' : blank('길드명을 검색하세요', '길드명을 입력하고 [찾기] → 목록에서 길드를 누르면 길드원 · 가입 · 탈퇴 정보가 표시됩니다'));
  const g = (await guildIndex()).get(GS.sel);
  if(!g) return h + blank('길드를 찾을 수 없습니다', '길드 이름이 바뀌었거나 길드원이 모두 수집 기준 밖입니다');
  const rows = g.rows, avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const bps = rows.map(r => r[C.bp] || 0), mls = rows.map(r => r[C.ml]).filter(v => v != null), sps = rows.map(r => r[C.sp]).filter(v => v != null);
  const jm = new Map(); for(const r of rows) jm.set(r[C.j], (jm.get(r[C.j]) || 0) + 1);
  const wm = new Map(); for(const r of rows){ const c = mcode(r[C.mc]); if(c) wm.set(c, (wm.get(c) || 0) + 1); }
  // 가입 · 탈퇴
  const ev = await gevents(), today = Math.max(...ev.map(e => e.d), 0);
  const inP = e => GS.per >= 999 || e.d > today - GS.per;
  const same = e => e.w === g.w && e.s === g.s;
  const joins = ev.filter(e => same(e) && e.to === g.g && inP(e)), leaves = ev.filter(e => same(e) && e.from === g.g && inP(e));
  const untracked = rows.filter(r => !isTracked(r)).length;
  const kpis = [['길드원 (명)', nf(rows.length), esc(gLabel(g))], ['신규 가입 (명)', nf(joins.length), GS.per >= 999 ? '전체 기록' : `최근 ${GS.per}일`], ['탈퇴 (명)', nf(leaves.length), GS.per >= 999 ? '전체 기록' : `최근 ${GS.per}일`],
    ['평균 전투력', nf(Math.round(avg(bps))), '최고 ' + nf(bps[0])], ['평균 대표 마스터리', avg(mls) ? avg(mls).toFixed(1) : '--', '최고 ' + nf(Math.max(...mls))],
    ['평균 전문화', avg(sps) ? avg(sps).toFixed(1) : '--', '최고 ' + nf(Math.max(...sps))]];
  h += `<section class="ov fr" id="gdetail">${NODES}
    <div class="bar"><span class="sid g"><b class="cname">${esc(g.g)}</b><em style="margin-left:10px">${esc(gLabel(g))}</em></span></div>
    <div class="kpis">${kpis.map(([l, v, s2]) => `<div class="kpi"><div class="lb">${l}</div><div class="v">${v}</div><div class="s">${s2}</div></div>`).join('')}</div>
    <div class="sec hsec">가입 · 탈퇴 기록 ${seg('g-per', GS.per, [[7, '7일'], [30, '30일'], [999, '전체']])}</div>
    <div class="note">수집 대상 캐릭터의 길드가 바뀐 날을 기록합니다 (매일 수집 기준, 최근 45일). 수집 기준 밖으로 밀려난 길드원은 탈퇴로 잡히지 않습니다. 닉네임 변경은 바뀐 뒤 이름으로 이어서 보여줍니다.</div>
    <div class="hpanels gpanels">
      <div class="hpanel ${joins.length ? 'has' : ''}"><div class="hp-h"><span>신규 가입</span><b class="cnt">${joins.length}명</b></div>${moveTable(joins, 'in')}</div>
      <div class="hpanel ${leaves.length ? 'has' : ''}"><div class="hp-h"><span>탈퇴</span><b class="cnt">${leaves.length}명</b></div>${moveTable(leaves, 'out')}</div>
    </div>
    <div class="sgrid">
      <div><div class="st">직업 구성</div>${hbars([...jm].map(([j, c]) => ({nm: jobName(j), c})).sort((a, b) => b.c - a.c), {head: ['인원', '비율'], color: '#6effa8'})}</div>
      <div><div class="st">대표 마스터리 무기</div>${hbars([...wm].map(([c, n]) => ({nm: mname(c), c: n})).sort((a, b) => b.c - a.c), {head: ['인원', '비율'], color: '#ff7ac8'})}</div>
    </div>
    <div class="sec">길드원 <small>${nf(rows.length)}명 · 전투력 순 · 이름을 누르면 캐릭터 정보</small></div>
    <div class="tbl" style="margin:0;border:0"><table class="rk gmt"><tr><th>#</th><th class="l">캐릭터</th><th class="hide-s">직업</th><th>대표 마스터리</th><th>전투력</th><th class="hide-s">서버 순위</th><th class="hide-s">업적점수</th><th class="hide-s">전문화</th>
      <th class="act">${untracked ? `<button class="mini-btn all" data-act="g-trackall" data-k="${esc(g.k)}">+ 길드원 모두 추적 (${untracked}명)</button>` : '<span class="sub">✓ 모두 추적 중</span>'}</th></tr>
    ${rows.map((r, i) => `<tr class="rkrow ${isTracked(r) ? 'mine' : ''}" data-act="char" data-w="${r[C.w]}" data-n="${esc(r[C.n])}"><td class="no ${i < 3 ? 't' + (i + 1) : ''}">${i + 1}</td>
      <td class="l"><div class="nm">${esc(r[C.n])}</div><div class="sub">${esc(wName(r[C.w]))} ${serverLabel(r[C.s])}</div></td><td class="hide-s">${esc(jobName(r[C.j]))}</td>
      <td><span class="big" style="font-size:19px">${nf(r[C.ml])}</span><div class="sub">${esc(mname(mcode(r[C.mc])))}</div></td>
      <td><span class="big" style="font-size:19px">${nf(r[C.bp])}</span></td><td class="hide-s dg" style="font-size:17px">#${nf(r[C.bsr])}</td>
      <td class="hide-s dg" style="font-size:17px">${nf(r[C.ach])}</td><td class="hide-s dg" style="font-size:17px">${nf(r[C.sp])}</td>
      <td class="act"><button class="star ${isFav(r[C.w], r[C.n]) ? 'on' : ''}" data-act="fav" data-w="${r[C.w]}" data-n="${esc(r[C.n])}" title="즐겨찾기">${isFav(r[C.w], r[C.n]) ? '★' : '☆'}</button>
        ${isTracked(r) ? '<span class="sub">추적 중</span>' : `<button class="mini-btn" data-act="track" data-w="${r[C.w]}" data-n="${esc(r[C.n])}">+ 추적</button>`}</td></tr>`).join('')}
    </table></div></section>`;
  return h;
}

/* ============================================================ 변경 이력 */
const CG = (() => { let x = null; try{ x = JSON.parse(sessionStorage.getItem('l9chg') || 'null'); }catch(e){} return Object.assign({per: 7, kind: -1, w: 0, q: '', page: 0, mv: 24, cf: 0}, x || {}, {page: 0, mv: 24}); })();
function saveCG(){ try{ sessionStorage.setItem('l9chg', JSON.stringify({per: CG.per, kind: CG.kind, w: CG.w, q: CG.q, cf: CG.cf})); }catch(e){} }
function cfBadge(c, n, sc){ return c === 1 ? '<span class="cfb c1" title="이 캐릭터로 확실히 이어 붙였습니다">확실</span>' : c === 2 ? `<span class="cfb c2" title="비슷한 캐릭터 — 확실하지 않아 이어 붙이지 않았습니다">유력${n > 1 ? ` · 후보 ${n}명` : ''}</span>` : ''; }
const CK = ['닉네임 변경', '길드 변경', '월드 이전', '서버 이전'];
async function changes(){ if(!D.chg) D.chg = getJSON('data/changes.json').catch(() => null); return D.chg; }
function ckBadge(k){ return `<span class="ckb ck${k}">${CK[k]}</span>`; }
function ckFromTo(k, a, b){
  const f = v => v ? esc(v) : '<span class="sub" style="display:inline">없음</span>';
  return `<span class="old">${f(a)}</span><span class="arrow">→</span><b>${f(b)}</b>`;
}
function chgTrackBtn(w, n, seen){
  if(!seen) return '<span class="sub">수집 기준 밖</span>';
  const t = ST.tracked.some(x => x.w === w && x.n === n);
  return `<button class="star ${isFav(w, n) ? 'on' : ''}" data-act="fav" data-w="${w}" data-n="${esc(n)}" title="즐겨찾기">${isFav(w, n) ? '★' : '☆'}</button>`
    + (t ? '<span class="sub">추적 중</span>' : `<button class="mini-btn" data-act="track" data-w="${w}" data-n="${esc(n)}">+ 추적</button>`);
}
async function pageChg(){
  if(!readyWorlds().length) return noData();
  const ch = await changes();
  let h = `<section class="ov fr">${NODES}
    <div class="bar"><span class="sid g">변경 이력</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">기준일 ${esc(D.meta.date)} · ${critText()}</span></div>`;
  if(!ch) return h + `<div class="note">변경 이력은 v0.9.0 이후 첫 자동 수집부터 기록됩니다. 전날 수집 결과와 비교하므로 이틀 이상 수집되면 표시됩니다.</div></section>`;
  const today = ch.date, per = CG.per;
  const inP = d => per >= 999 || d > today - per;
  const q = CG.q.trim();
  const base = ch.list.filter(x => inP(x[0]) && (!CG.w || x[2] === CG.w));
  const cnt = [0, 0, 0, 0]; let lk = 0; for(const x of base){ if(x[12] === 2) lk++; else cnt[x[1]]++; }
  let view = base.filter(x => (CG.kind < 0 || x[1] === CG.kind) && (!CG.cf || x[12] === CG.cf));
  if(q) view = view.filter(x => x[4].includes(q) || String(x[5]).includes(q) || String(x[6]).includes(q) || (x[7] || '').includes(q));
  const pages = Math.max(1, Math.ceil(view.length / PAGE)); CG.page = Math.min(CG.page, pages - 1);
  const slice = view.slice(CG.page * PAGE, CG.page * PAGE + PAGE);
  const ws = readyWorlds();
  const perLbl = per === 1 ? '최근 수집일' : per >= 999 ? `전체 (최근 ${ch.days}일)` : `최근 ${per}일`;
  h += `<div class="note">매일 자동 수집 때 <b>전날 수집 결과와 비교</b>해 닉네임 · 길드 · 월드 · 서버가 바뀐 캐릭터를 바로 기록합니다. 공식 사이트가 하루 한 번(10~12시) 갱신되므로 하루 단위로 쌓입니다.
      닉네임을 바꾸거나 월드를 옮긴 캐릭터는 직업 · 전투력 · 업적점수 · 전문화가 거의 같은 캐릭터를 찾아 자동으로 이어 붙입니다.</div>
    <div class="kpis">${CK.map((l, i) => `<div class="kpi"><div class="lb">${l} (명)</div><div class="v">${nf(cnt[i])}</div><div class="s">${esc(perLbl)}${CG.w ? ' · ' + esc(wName(CG.w)) : ''}</div></div>`).join('')}
      <div class="kpi"><div class="lb">유력 후보 (건)</div><div class="v" style="color:var(--amb)">${nf(lk)}</div><div class="s">확실하지 않아 이어 붙이지 않음</div></div></div>
    <div class="ctrls"><span class="lbl">기간</span>${seg('cg-per', per, [[1, '최근 수집일'], [7, '7일'], [30, '30일'], [999, '전체']])}
      <span class="lbl">종류</span>${seg('cg-kind', CG.kind, [[-1, '전체'], [0, '닉네임'], [1, '길드'], [2, '월드 이전'], [3, '서버 이전']])}
      <span class="lbl">확실도</span>${seg('cg-cf', CG.cf, [[0, '전체'], [1, '확실'], [2, '유력']])}
      <span class="lbl">월드</span><select data-ch="cg-w"><option value="0">전체</option>${ws.map(w => `<option value="${w.code}" ${w.code === CG.w ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
      <span class="sp"></span><input class="q" data-in="cg-q" value="${esc(CG.q)}" placeholder="닉네임 · 길드 찾기"></div>
    <div class="sec" id="cglist">변경 목록 <small>${nf(view.length)}건 · 최근 순 · 줄을 누르면 캐릭터 정보</small></div>
    <div class="tbl" style="margin:0;border:0"><table class="rk chg"><tr><th>날짜</th><th>종류</th><th class="l">캐릭터 (현재)</th><th class="l">이전 → 이후</th><th class="l hide-s">현재 길드</th><th>전투력</th><th class="hide-s">대표 마스터리</th><th></th></tr>
    ${slice.map(x => `<tr class="${x[11] ? 'rkrow' : ''}" ${x[11] ? `data-act="char" data-w="${x[2]}" data-n="${esc(x[4])}"` : ''}>
      <td class="dg" style="font-size:16px">${esc(dayStr(x[0]).slice(5))}</td><td>${ckBadge(x[1])}${cfBadge(x[12], x[13], x[14])}</td>
      <td class="l"><div class="nm">${esc(x[4])}</div><div class="sub">${esc(wName(x[2]))} ${serverLabel(x[3])}</div></td>
      <td class="l nh">${ckFromTo(x[1], x[5], x[6])}</td><td class="l hide-s">${x[7] ? esc(x[7]) : '<span class="sub">-</span>'}</td>
      <td><span class="big" style="font-size:18px">${nf(x[8])}</span></td><td class="hide-s"><span class="dg" style="font-size:17px">${nf(x[9])}</span><div class="sub">${esc(mname(x[10]))}</div></td>
      <td style="white-space:nowrap">${chgTrackBtn(x[2], x[4], x[11])}</td></tr>`).join('') || '<tr><td colspan="8" class="emptyrow">이 기간에 기록된 변경이 없습니다</td></tr>'}
    </table></div>
    ${pages > 1 ? `<div class="pager"><button class="btn" data-act="cg-page" data-p="0" ${CG.page ? '' : 'disabled'}>처음</button><button class="btn" data-act="cg-page" data-p="${CG.page - 1}" ${CG.page ? '' : 'disabled'}>이전</button>
      <span class="pi">${CG.page + 1} / ${pages} 쪽</span>
      <button class="btn" data-act="cg-page" data-p="${CG.page + 1}" ${CG.page < pages - 1 ? '' : 'disabled'}>다음</button><button class="btn" data-act="cg-page" data-p="${pages - 1}" ${CG.page < pages - 1 ? '' : 'disabled'}>끝</button></div>` : ''}
  </section>`;
  // 월드 · 서버 이전 캐릭터 자동 추적
  let mv = (ch.moved || []).filter(m => inP(m.last) && (!CG.w || m.w === CG.w || m.e.some(e => e[1] === 2 && (e[2] === wName(CG.w) || e[3] === wName(CG.w)))));
  if(q) mv = mv.filter(m => m.n.includes(q) || (m.g || '').includes(q) || m.e.some(e => String(e[2]).includes(q) || String(e[3]).includes(q)));
  h += `<section class="ov fr" style="margin-top:14px">${NODES}
    <div class="bar"><span class="sid g">월드 · 서버 이전 캐릭터 자동 추적</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">${nf(mv.length)}명 · ${esc(perLbl)}</span></div>
    <div class="note">월드나 서버를 옮긴 캐릭터를 자동으로 따라가서, 옮긴 뒤 <b>닉네임과 길드가 어떻게 바뀌었는지</b> 순서대로 보여줍니다. 별도로 등록할 필요 없이 이전이 확인되면 자동으로 이 목록에 들어옵니다.<br>
      <b class="cfb c1">확실</b> 직업 · 업적점수 · 마스터리 3종 · 전문화 · 전투력이 모두 맞는 캐릭터가 한 명뿐이라 같은 캐릭터로 이어 붙임 &nbsp;
      <b class="cfb c2">유력</b> 비슷하지만 후보가 여럿이거나 일부 값이 달라 단정할 수 없음 (추적은 자동으로 옮기지 않고, [추적]에서 직접 바꿀 수 있음)</div>
    ${mv.length ? `<div class="mvgrid">${mv.slice(0, CG.mv).map(m => {
      const ev = m.e.slice().sort((a, b) => a[0] - b[0] || (b[1] >= 2) - (a[1] >= 2) || a[1] - b[1]);
      return `<div class="mvcard ${m.seen ? 'rkrow' : ''} ${m.lv === '유력' ? 'lk2' : ''}" ${m.seen ? `data-act="char" data-w="${m.w}" data-n="${esc(m.n)}"` : ''}>
        <div class="mvlv">${m.lv === '유력' ? `<span class="cfb c2">유력${m.nc > 1 ? ` · 후보 ${m.nc}명` : ''}</span><span class="sub" style="display:inline"> 일치도 ${m.score}% · 확실하지 않아 이어 붙이지 않음</span>` : '<span class="cfb c1">확실</span><span class="sub" style="display:inline"> 같은 캐릭터로 이어 붙임</span>'}</div>
        ${m.lv === '유력' && m.from ? `<div class="sub">이전 전: ${esc(wName(m.from[0]))} ${m.from[2] ? serverLabel(m.from[2]) : ''} · <b>${esc(m.from[1])}</b> · ${esc(m.from[3] || '길드 없음')}</div>` : ''}
        <div class="mvh"><div><div class="nm">${esc(m.n)}</div><div class="sub">${esc(wName(m.w))} ${serverLabel(m.s)} · ${m.g ? esc(m.g) : '길드 없음'}</div></div>
          <div class="mvr"><span class="big" style="font-size:20px">${nf(m.bp)}</span><div class="sub">전투력</div></div></div>
        <ol class="tl">${ev.map(e => `<li><span class="dg">${esc(dayStr(e[0]).slice(5))}</span>${ckBadge(e[1])}<span class="nh">${ckFromTo(e[1], e[2], e[3])}</span></li>`).join('')}</ol>
        <div class="mvf">${chgTrackBtn(m.w, m.n, m.seen)}</div></div>`; }).join('')}</div>
      ${mv.length > CG.mv ? `<div class="pager"><button class="btn" data-act="cg-more">더 보기 (${nf(mv.length - CG.mv)}명 남음)</button></div>` : ''}`
      : '<div class="empty" style="padding:14px 16px">이 기간에 월드 · 서버를 옮긴 캐릭터가 없습니다</div>'}
  </section>`;
  return h;
}

/* ============================================================ 사용 설명서 */
function pageHelp(){
  const ws = D.meta?.worlds || [];
  const oldW = WORLD_GROUPS['구월드'].join(' · '), newW = WORLD_GROUPS['신월드'].join(' · ');
  const sec = (t, body) => `<section class="ov fr help">${NODES}<div class="bar"><span class="sid g">${t}</span></div><div class="hlpb">${body}</div></section>`;
  return `<div class="helpwrap">`
  + sec('데이터 수집 기준', `
    <p>이 사이트의 모든 정보는 공식 홈페이지 <b>캐릭터 정보</b>(l9.onstove.com)에서 검색되는 값을 모은 것입니다. 공식 사이트에서는 서버별 전투력 1,000위 안 캐릭터만 검색되며, 그중 아래 기준에 맞는 캐릭터를 수집합니다.</p>
    <table class="htbl"><tr><th>구분</th><th>월드</th><th>수집 기준</th></tr>
      <tr><td><b>구월드</b></td><td>${esc(oldW)}</td><td><b>${esc(ruleTxt('구월드'))}</b> 캐릭터</td></tr>
      <tr><td><b>신월드</b></td><td>${esc(newW)}</td><td><b>${esc(ruleTxt('신월드'))}</b></td></tr></table>
    <ul><li>기준보다 조금 낮은 캐릭터도 매일 함께 확인하고, 기준 밖 캐릭터는 7일에 한 번씩 다시 확인해서 기준을 넘으면 바로 포함합니다.</li>
      <li>기준 밖 캐릭터는 랭킹 · 통계 · 검색에 나오지 않습니다. 추적 중인 캐릭터가 기준 밖으로 밀려나면 "검색되지 않습니다"로 표시됩니다.</li></ul>`)
  + sec('갱신 시간', `
    <p>공식 사이트는 <b>매일 10~12시</b>에 전날 기준 데이터로 갱신됩니다. 이 사이트는 <b>10~12시에 기록된 그 데이터를 바탕으로</b> 수집하므로, 화면의 <b>기준일은 어제 날짜</b>입니다.</p>
    <ul><li>자동 수집: 매일 <b>12:05</b> (공식 사이트 갱신이 늦은 날은 12:35 · 13:05 · 14:05에 다시 확인)</li>
      <li>새벽 <b>05:00</b>에도 한 번 더 확인합니다. 전날 수집이 실패했으면 이때 다시 수집하고, 이미 수집했으면 바로 끝납니다.</li>
      <li>수집 전에 상위 캐릭터 값이 어제와 그대로인지 확인해서, 공식 사이트가 아직 갱신되지 않았으면 옛 데이터를 저장하지 않고 다음 시간에 다시 시도합니다.</li>
      <li>수집에는 1~2시간 정도 걸리고, 끝나면 사이트가 자동으로 바뀝니다. 그동안에는 전날 데이터가 보입니다.</li>
      <li>일별 기록 · 변경 이력은 최근 45일까지 보관합니다.</li></ul>`)
  + sec('메뉴', `
    <dl class="hdl">
      <dt>캐릭터</dt><dd>[검색]으로 찾은 캐릭터 1명의 정보 — 전투력 · 업적 · 마스터리 · 전문화 일별 그래프, 마스터리 11종 입력, 통합 레벨, 변경 내역. [화면 초기화]로 표시 중인 캐릭터와 최근 본 캐릭터를 지웁니다(추적 · 즐겨찾기는 그대로).</dd>
      <dt>길드</dt><dd>길드명으로 찾기 → 월드 · 서버별 길드 목록. 길드원 수, 신규 가입 · 탈퇴(7일/30일/전체), 평균 전투력 · 마스터리 · 전문화, 직업 구성, 길드원 표, [+ 길드원 모두 추적].</dd>
      <dt>랭킹</dt><dd>대표 마스터리 또는 전투력 순위 — 전체 월드 / 월드 / 서버, 직업 필터, 닉네임 · 길드 찾기. 전문화 레벨도 함께 표시합니다.</dd>
      <dt>TOP 20</dt><dd>대표 마스터리 TOP 20과 전투력 TOP 20.</dd>
      <dt>통계</dt><dd>캐릭터 수 · 평균 · 최고, 전투력 · 마스터리 · 전문화 분포, 직업 · 무기 통계, 서버별 비교, 순위 컷.</dd>
      <dt>변경 이력</dt><dd>매일 수집 때 닉네임 · 길드 · 월드 · 서버가 바뀐 캐릭터 목록(최근 수집일 / 7일 / 30일 / 전체). 아래에는 월드 · 서버를 옮긴 캐릭터를 자동으로 따라가서 옮긴 뒤 닉네임 · 길드 변화를 보여줍니다. 이어 붙인 결과는 <b>확실</b> / <b>유력</b>으로 구분합니다.</dd>
      <dt>경험치 계산기</dt><dd>사냥 결과 창 캡처를 끌어다 놓거나 Ctrl+V로 붙여넣으면 사냥터 · 사냥 시간 · M 경험치를 읽어 1분당 · 1시간당 경험치를 기록하고, 가장 효율 좋은 사냥터를 ★로 표시합니다. 사냥터 이름 앞뒤에 잘못 읽힌 글자는 자동으로 떼어냅니다. 잘못 읽은 기록은 [수정]으로 고칠 수 있습니다.</dd>
      <dt>즐겨찾기</dt><dd>☆로 즐겨찾기한 캐릭터의 현재 정보와 메모.</dd>
      <dt>추적</dt><dd>추적 등록한 캐릭터 관리 — 캐릭터명 · 길드명 찾기, 길드 · 월드 필터와 정렬, 목록 · 종합 현황 · 상세, 닉네임 · 길드 변경 이력, 여러 명 선택 해제.</dd>
    </dl>`)
  + sec('캐릭터 추적 방식 (닉네임 변경 · 월드 · 서버 이전)', `
    <p>공식 사이트에는 캐릭터 고유 번호가 없어서, 매일 수집 때 <b>어제 있다가 오늘 사라진 캐릭터</b>와 <b>오늘 처음 보이는 캐릭터</b>의 수치를 비교해 같은 캐릭터를 찾습니다.</p>
    <table class="htbl"><tr><th>비교 항목</th><th>같은 캐릭터로 보는 범위</th></tr>
      <tr><td>직업</td><td>같아야 함</td></tr>
      <tr><td>업적점수</td><td>줄지 않고 하루 0.3% 이내로 늘어남</td></tr>
      <tr><td>마스터리 3종</td><td>무기 3개 레벨이 각각 그대로이거나 1 이내로 오름</td></tr>
      <tr><td>전문화</td><td>줄지 않고 2~3 이내로 오름</td></tr>
      <tr><td>전투력</td><td>−5% ~ +10%</td></tr></table>
    <ul><li><b>확실</b>: 위 항목이 모두 맞는 캐릭터가 <b>한 명뿐</b>일 때(또는 같은 서버 · 같은 길드에서 닉네임만 바뀐 경우) 같은 캐릭터로 이어 붙입니다. 이름 · 월드 · 서버가 모두 바뀌어도 찾습니다. 추적 · 즐겨찾기 · 메모도 새 이름으로 자동으로 옮겨집니다.</li>
      <li><b>유력</b>: 맞는 후보가 여럿이거나 일부 값이 조금 다를 때는 단정하지 않고 [변경 이력]에 유력으로만 표시합니다. 추적 중인 캐릭터라면 [추적] 화면에 후보가 나오고 [이 캐릭터로 바꾸기]로 직접 옮길 수 있습니다.</li>
      <li>사라진 뒤 <b>7일 안</b>에 다시 나타나면 이어 붙입니다. 옮긴 곳에서 수집 기준(구월드 14만 · 신월드 500위) 밖이면 기준 안으로 들어온 날 찾습니다.</li></ul>`)
  + sec('알아둘 점', `
    <ul><li>추적 · 즐겨찾기 · 메모 · 마스터리 입력 · 경험치 기록은 <b>이 브라우저에만</b> 저장됩니다. 다른 기기로 옮기려면 [캐릭터] · [추적] 아래 [백업 저장] / [백업 불러오기]를 쓰세요.</li>
      <li>같은 월드 안 닉네임 변경은 직업 · 업적점수 · 길드 · 서버가 거의 같을 때만 자동으로 연결합니다(잘못 연결 방지). 못 따라가면 [추적]의 [닉네임/월드]로 직접 바꾸세요.</li>
      <li>공식 공개 API가 아니라 공식 사이트가 쓰는 데이터를 이용합니다. 공식 사이트가 바뀌면 수정이 필요할 수 있습니다.</li>
      <li>버전 ${VERSION}</li></ul>`)
  + `</div>`;
}

/* ============================================================ 즐겨찾기 */
async function pageFav(){
  const fs = ST.fav || [];
  if(!fs.length) return blank('즐겨찾기한 캐릭터가 없습니다', '[검색] · 랭킹 · TOP 20에서 캐릭터를 누르고 [☆ 즐겨찾기]를 누르세요');
  const rows = [];
  for(const f of fs) rows.push([f, (await rowOf(f.w, f.n))?.r || null]);
  return `<section class="ov fr">${NODES}
    <div class="bar"><span class="sid g">즐겨찾기</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">${fs.length}명 · 메모는 입력하면 바로 저장됩니다</span></div>
    <div class="tbl" style="margin:0;border:0"><table class="rk favt"><tr><th></th><th class="l">캐릭터</th><th class="hide-s">직업</th><th>대표 마스터리</th><th>전투력</th><th class="hide-s l">길드</th><th class="l">메모</th><th></th></tr>
    ${rows.map(([f, r]) => { const tr = ST.tracked.some(t => t.w === f.w && t.n === f.n);
      return `<tr><td><button class="star on" data-act="fav" data-w="${f.w}" data-n="${esc(f.n)}" title="즐겨찾기 해제">★</button></td>
      <td class="l"><a class="nmlink" data-act="char" data-w="${f.w}" data-n="${esc(f.n)}"><span class="nm">${esc(f.n)}</span></a><div class="sub">${esc(wName(f.w))} ${r ? serverLabel(r[C.s]) : ''}</div></td>
      <td class="hide-s">${r ? esc(jobName(r[C.j])) : '--'}</td>
      <td>${r ? `<span class="big">${nf(r[C.ml])}</span><div class="sub">${esc(mname(mcode(r[C.mc])))}</div>` : '<span class="sub">검색 안 됨</span>'}</td>
      <td>${r ? `<span class="big">${nf(r[C.bp])}</span>` : '--'}</td><td class="hide-s l">${r ? esc(r[C.g] || '-') : '--'}</td>
      <td class="l"><input class="memo1" data-memo="${esc(key(f.w, f.n))}" value="${esc(f.memo || '')}" placeholder="메모 입력"></td>
      <td>${tr ? '<span class="sub">추적 중</span>' : `<button class="mini-btn" data-act="track" data-w="${f.w}" data-n="${esc(f.n)}">+ 추적</button>`}</td></tr>`; }).join('')}
    </table></div></section>`;
}

/* ============================================================ TOP 20 */
let TOPTAB = lsGet('l9toptab', 'ml');   // 휴대폰: TOP 20 두 순위 중 보이는 쪽
async function pageTop(){
  if(!readyWorlds().length) return noData();
  const [bp, ml] = await Promise.all([sorted('bp', ''), sorted('ml', '')]);
  const podium = (list, by) => {
    const p = list.slice(0, 3), order = [0, 1, 2];
    return `<div class="podium">${order.map(i => p[i] ? `<button class="podi p${i + 1}" data-act="char" data-w="${p[i][C.w]}" data-n="${esc(p[i][C.n])}">
      <div class="pn">${i + 1}</div><div class="pnm">${esc(p[i][C.n])}</div><div class="pw">${esc(wName(p[i][C.w]))} ${serverLabel(p[i][C.s])} · ${esc(jobName(p[i][C.j]))}</div>
      <div class="pv">${by === 'bp' ? nf(p[i][C.bp]) : nf(p[i][C.ml])}</div><div class="psub">${by === 'bp' ? '전투력' : esc(mname(mcode(p[i][C.mc])))}</div></button>` : '<div></div>').join('')}</div>`;
  };
  const table = (list, by) => `<div class="toplist"><table class="rk">` + list.slice(3, 20).map((r, k) => {
    const i = k + 3;
    return `<tr class="rkrow ${isTracked(r) ? 'mine' : ''}" data-act="char" data-w="${r[C.w]}" data-n="${esc(r[C.n])}"><td class="no">${i + 1}</td>
      <td class="l"><div class="nm">${esc(r[C.n])}</div><div class="sub">${esc(wName(r[C.w]))} ${serverLabel(r[C.s])} · ${esc(jobName(r[C.j]))}</div></td>
      <td class="tv"><span class="big">${by === 'bp' ? nf(r[C.bp]) : nf(r[C.ml])}</span><div class="sub">${by === 'bp' ? '전투력' : esc(mname(mcode(r[C.mc])))}</div></td></tr>`;
  }).join('') + '</table></div>';
  return `<section class="ov fr">${NODES}
    <div class="bar"><span class="sid g">TOP 20 탑랭커 <em style="margin-left:10px">${esc(scopeName())}</em></span>
      <span style="margin-left:auto;font-size:12px;color:var(--dim)">기준일 ${esc(D.meta.date)}</span></div>
    ${partialNote()}<div class="ctrls">${scopeCtrls()}</div>
    <div class="toptab">${seg('top-tab', TOPTAB, [['ml', '대표 마스터리 TOP 20'], ['bp', '전투력 TOP 20']])}</div>
    <div class="tops" data-tab="${TOPTAB}">
      <div class="tml"><div class="sec tsec" style="border-top:0"><span class="tbadge">마스터리</span>대표 마스터리 TOP 20 <small>같은 레벨이면 전투력 순</small></div>${podium(ml, 'ml')}${table(ml, 'ml')}</div>
      <div class="tbp"><div class="sec tsec" style="border-top:0"><span class="tbadge">전투력</span>전투력 TOP 20</div>${podium(bp, 'bp')}${table(bp, 'bp')}</div>
    </div></section>`;
}

/* ============================================================ 통계 */
async function pageStats(){
  if(!readyWorlds().length) return noData();
  const rows = await scopeRows();
  if(!rows.length) return blank('데이터가 없습니다', '다른 범위를 선택하세요');
  const bps = rows.map(r => r[C.bp]).filter(v => v != null).sort((a, b) => b - a);
  const mls = rows.map(r => r[C.ml]).filter(v => v != null);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const med = bps.length ? bps[Math.floor(bps.length / 2)] : null;
  const sps = rows.map(r => r[C.sp]).filter(v => v != null), spMed = sps.length ? sps.slice().sort((a, b) => a - b)[Math.floor(sps.length / 2)] : null;
  const kpis = [['캐릭터 수', nf(rows.length), '명'], ['평균 전투력', nf(Math.round(avg(bps))), '중앙값 ' + nf(med)], ['최고 전투력', nf(bps[0]), ''],
    ['평균 대표 마스터리', avg(mls) ? avg(mls).toFixed(1) : '--', '최고 ' + nf(Math.max(...mls))], ['평균 전문화', sps.length ? avg(sps).toFixed(1) : '--', '최고 ' + nf(Math.max(...sps)) + ' · 중앙값 ' + nf(spMed)],
    ['직업 수', nf(new Set(rows.map(r => r[C.j])).size), '']];
  // 직업 통계
  const jm = new Map();
  for(const r of rows){ const o = jm.get(r[C.j]) || {c:0, bp:0, ml:0}; o.c++; o.bp += r[C.bp] || 0; o.ml += r[C.ml] || 0; jm.set(r[C.j], o); }
  const jobRows = [...jm].map(([j, o]) => ({nm: jobName(j), c: o.c})).sort((a, b) => b.c - a.c);
  // 대표 무기
  const wm = new Map();
  for(const r of rows){ const c = mcode(r[C.mc]); if(!c) continue; const o = wm.get(c) || {c:0, ml:0}; o.c++; o.ml += r[C.ml] || 0; wm.set(c, o); }
  const wRows = [...wm].map(([c, o]) => ({nm: mname(c), c: o.c})).sort((a, b) => b.c - a.c);
  // 서버별 비교 (월드 범위일 때만)
  let cmp = '';
  if(SC.scope === 'world'){
    const m = new Map(); for(const r of rows){ const o = m.get(r[C.s]) || {c:0, bp:0}; o.c++; o.bp += r[C.bp] || 0; m.set(r[C.s], o); }
    cmp = hbars([...m].sort((a, b) => a[0] - b[0]).map(([s, o]) => ({nm: serverLabel(s), c: o.c, a: krShort(o.bp / o.c)})), {head: ['인원', '평균 전투력']});
  }
  // 순위 컷
  const cuts = [1, 10, 50, 100, 300, 500, 1000, 3000, 5000, 10000].filter(n => n <= bps.length);
  const mlsS = mls.slice().sort((a, b) => b - a);
  const cutT = `<table class="cuts"><tr><th>순위</th>${cuts.map(n => `<th style="text-align:center">${nf(n)}위</th>`).join('')}</tr>
    <tr><td>전투력</td>${cuts.map(n => `<td class="num">${nf(bps[n - 1])}</td>`).join('')}</tr>
    <tr><td>대표 마스터리</td>${cuts.map(n => `<td class="num">${nf(mlsS[n - 1])}</td>`).join('')}</tr></table>`;
  return `<section class="ov fr">${NODES}
    <div class="bar"><span class="sid g">통계 <em style="margin-left:10px">${esc(scopeName())}</em></span>
      <span style="margin-left:auto;font-size:12px;color:var(--dim)">기준일 ${esc(D.meta.date)} · ${critText()}</span></div>
    ${partialNote()}<div class="ctrls">${scopeCtrls()}</div>
    <div class="kpis">${kpis.map(([l, v, s]) => `<div class="kpi"><div class="lb">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('')}</div>
    <div class="sgrid">
      <div><div class="st">전투력 인원 분포 <small>막대에 마우스를 올리면 구간·인원</small></div>${vhist(binsOf(bps, 18), v => krShort(v), '', '#5ec8ff')}</div>
      <div><div class="st">대표 마스터리 레벨 분포</div>${vhist(binsOf(mls, 16), v => String(v), '레벨', '#ffc857')}</div>
      <div><div class="st">전문화 레벨 분포</div>${vhist(binsOf(sps, 16), v => String(v), '레벨', '#c3a6ff')}</div>
      <div><div class="st">전문화 레벨 구간</div>${hbars(spBands(sps), {head: ['인원', '비율'], color: '#c3a6ff'})}</div>
      <div><div class="st">직업 통계</div>${hbars(jobRows, {head: ['인원', '비율'], color: '#6effa8'})}</div>
      <div><div class="st">대표 마스터리 무기</div>${hbars(wRows, {head: ['인원', '비율'], color: '#ff7ac8'})}</div>
      ${cmp ? `<div class="full"><div class="st">서버별 비교</div>${cmp}</div>` : ''}
      <div class="full"><div class="st">순위 컷</div><div class="tbl" style="margin:0">${cutT}</div></div>
    </div></section>`;
}

/* ============================================================ 경험치 계산기 */
// 캡처 1장 = 기록 1개 (사냥터 · 사냥 시간 · M 경험치). 기록은 이 브라우저에 저장.
const EX = {queue: [], edit: null, chart: 'ph'};
const expRecs = () => (ST.expr ||= []);
function fmtDur(secs){
  secs = Math.round(secs || 0);
  const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60;
  return [h ? h + '시간' : '', m ? m + '분' : '', s ? s + '초' : ''].filter(Boolean).join(' ') || '0초';
}
function expStats(){
  const by = new Map();
  for(const r of expRecs()){
    const bp = basePlace(r.place);
    const o = by.get(bp) || {place: bp, exp: 0, secs: 0, n: 0, best: 0};
    o.exp += r.exp; o.secs += r.secs; o.n++; o.best = Math.max(o.best, r.exp / r.secs * 3600);
    by.set(bp, o);
  }
  const places = [...by.values()].map(o => ({...o, ph: o.exp / o.secs * 3600, pm: o.exp / o.secs * 60})).sort((a, b) => b.ph - a.ph);
  return {places, best: places[0] || null};
}
function expBars(places, k){
  if(!places.length) return '<div class="nodata">기록이 쌓이면 표시됩니다</div>';
  const mx = Math.max(...places.map(p => p[k]), 1);
  return places.map((p, i) => `<div class="hb eb ${i === 0 ? 'top' : ''}" title="${esc(p.place)} · ${p.n}회 · ${fmtDur(p.secs)}">
    <span class="nm">${i === 0 ? '★ ' : ''}${esc(p.place)}</span><span class="tr"><b style="width:${(p[k] / mx * 100).toFixed(1)}%"></b></span>
    <span class="c">${esc(krShort(p[k]))}</span><span class="a">${p.n}회</span></div>`).join('');
}
function expTrend(k){
  const rs = expRecs().slice().sort((a, b) => a.at < b.at ? -1 : 1);
  if(!rs.length) return '<div class="nodata">기록이 쌓이면 표시됩니다</div>';
  const best = expStats().best?.place;
  const W = 760, H = 230, L = 64, R = W - 10, T = 14, B = H - 40;
  const vals = rs.map(r => r.exp / r.secs * (k === 'ph' ? 3600 : 60));
  const mx = Math.max(...vals) * 1.1 || 1;
  const bw = Math.min(46, (R - L) / rs.length);
  const places = [...new Set(rs.map(r => basePlace(r.place)))];
  const sameDay = new Set(rs.map(r => r.at.slice(0, 10))).size === 1;
  let g = '';
  for(let i = 0; i <= 4; i++){ const y = T + (B - T) * i / 4; g += `<line x1="${L}" x2="${R}" y1="${y}" y2="${y}" stroke="rgba(var(--c),.12)"/><text x="${L - 6}" y="${y + 4}" class="ax" text-anchor="end">${esc(krShort(mx * (1 - i / 4)))}</text>`; }
  const bars = rs.map((r, i) => {
    const v = vals[i], h = (B - T) * v / mx, x = L + i * ((R - L) / rs.length) + ((R - L) / rs.length - bw) / 2;
    const col = PAL[places.indexOf(basePlace(r.place)) % PAL.length];
    return `<rect x="${x.toFixed(1)}" y="${(B - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}" opacity="${basePlace(r.place) === best ? 1 : .7}"><title>${esc(r.at.slice(5, 16).replace('T', ' '))} · ${esc(r.place)} · ${esc(krNum(v))}</title></rect>
      ${rs.length <= 14 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${B + 14}" class="ax" text-anchor="middle">${esc(sameDay ? r.at.slice(11, 16) : r.at.slice(5, 10))}</text>` : ''}`;
  }).join('');
  return `<svg class="osc" viewBox="0 0 ${W} ${H}" role="img"><rect x="${L}" y="${T}" width="${R - L}" height="${B - T}" fill="rgba(var(--c),.03)" stroke="rgba(var(--c),.35)"/>${g}${bars}</svg>
    <div class="legend">${places.map((p, i) => `<span><i style="background:${PAL[i % PAL.length]}"></i>${esc(p)}${p === best ? ' ★' : ''}</span>`).join('')}</div>`;
}
function pageExp(){
  const {places, best} = expStats();
  const rs = expRecs().slice().sort((a, b) => a.at < b.at ? 1 : -1);
  const e = EX.edit ? expRecs().find(r => r.id === EX.edit) : null;
  const kk = EX.chart, kl = kk === 'ph' ? '1시간당' : '1분당';
  return `<section class="ov fr">${NODES}
    <div class="bar"><span class="sid g">경험치 계산기</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">사냥 결과 캡처 → 사냥터 · 1분당 · 1시간당 경험치 (M 경험치 기준)</span></div>
    <div class="expg">
      <div>
        <button class="drop" data-act="exp-file" id="expDrop"><b>사냥 결과 캡처를 여기에 끌어다 놓기</b><br>또는 <b>Ctrl + V</b> 붙여넣기 · 누르면 파일 선택 (여러 장 가능)<br><span style="font-size:11px">사냥터 · 사냥 시간 · M 경험치를 읽어 자동으로 기록합니다</span></button>
        ${EX.queue.length ? `<div class="shots">${EX.queue.map((s, i) => `<div class="shot ${s.ok ? 'ok' : s.fail ? 'bad' : ''}"><img src="${s.url}" alt="캡처 ${i + 1}"><div class="cap"><span>${esc(s.state)}</span></div></div>`).join('')}</div>` : ''}
        <div class="sec" style="margin:14px -16px 12px;border-bottom:1px solid var(--line2)">${e ? '기록 수정' : '직접 입력'} <small>캡처를 잘못 읽었으면 표에서 [수정]</small></div>
        <div class="efields">
          <div class="f"><label>사냥터</label><input id="exPlace" value="${esc(e?.place || '')}" placeholder="예: 그림자 숲"></div>
          <div class="f"><label>획득 경험치 (M)</label><input id="exGain" inputmode="decimal" value="${e ? e.exp : ''}" placeholder="예: 678,513,354 또는 6.8억"></div>
        </div>
        <div class="f" style="margin-top:10px"><label>사냥 시간</label>
          <div class="tsplit"><input id="exH" inputmode="numeric" value="${e ? Math.floor(e.secs / 3600) || '' : ''}" placeholder="시간"><input id="exM" inputmode="numeric" value="${e ? Math.floor(e.secs % 3600 / 60) || '' : ''}" placeholder="분"><input id="exS" inputmode="numeric" value="${e ? e.secs % 60 || '' : ''}" placeholder="초"></div></div>
        <div style="display:flex;gap:8px;margin-top:6px">${e ? `<button class="btn pri" data-act="exp-save">수정 저장</button><button class="btn" data-act="exp-cancel">취소</button>` : `<button class="btn pri" data-act="exp-save">기록 추가</button>`}<button class="btn" data-act="exp-reset">초기화</button></div>
      </div>
      <div>
        <div class="ebox main best"><div class="lb">가장 효율 좋은 사냥터</div>
          ${best ? `<div class="kr">★ ${esc(best.place)}</div><div class="raw" style="color:var(--ink)">1시간당 <b class="hi">${esc(krNum(best.ph))}</b></div><div class="raw" style="color:var(--ink)">1분당 <b class="hi">${esc(krNum(best.pm))}</b></div>
            <div class="raw">${best.n}회 · 합계 ${fmtDur(best.secs)} · 획득 ${esc(krShort(best.exp))}</div>${places.length > 1 ? `<div class="raw">2위 ${esc(places[1].place)}보다 ${((best.ph / places[1].ph - 1) * 100).toFixed(1)}% 높음</div>` : ''}`
            : '<div class="kr" style="font-size:18px;color:var(--dim)">캡처를 올리면 계산합니다</div>'}</div>
        <div class="st" style="margin-top:16px">사냥터별 ${kl} 경험치 <small>사냥 시간 가중 평균</small>${seg('exp-chart', kk, [['ph', '1시간당'], ['pm', '1분당']])}</div>
        ${expBars(places, kk)}
      </div>
    </div>
    <div class="sec">기록 <small>${rs.length}건 · 최신순</small>${rs.length ? '<button class="mini-btn" data-act="exp-clearall" style="margin-left:10px">전체 삭제</button>' : ''}</div>
    <div class="tbl" style="margin:0;border:0"><table class="rk extbl"><tr><th>날짜</th><th class="l">사냥터</th><th>사냥 시간</th><th>획득 경험치</th><th>1분당</th><th>1시간당</th><th></th></tr>
      ${rs.map(r => { const ph = r.exp / r.secs * 3600, pm = r.exp / r.secs * 60, top = best && basePlace(r.place) === best.place;
        return `<tr class="${top ? 'mine' : ''}"><td class="dg" style="font-size:16px">${esc(r.at.slice(5, 16).replace('T', ' '))}</td><td class="l"><span class="nm">${esc(r.place)}</span></td>
          <td>${fmtDur(r.secs)}</td><td>${esc(krNum(r.exp))}</td><td><span class="big" style="font-size:18px">${esc(krNum(pm))}</span></td><td><span class="big">${esc(krNum(ph))}</span></td>
          <td style="white-space:nowrap"><button class="mini-btn" data-act="exp-edit" data-id="${r.id}">수정</button> <button class="mini-btn" data-act="exp-del" data-id="${r.id}">삭제</button></td></tr>`; }).join('')
        || '<tr><td colspan="7" class="emptyrow">아직 기록이 없습니다</td></tr>'}</table></div>
    <div class="sec">기록별 ${kl} 경험치 <small>색 = 사냥터 · ★ = 가장 효율 좋은 사냥터</small></div>
    <div style="padding:14px 16px">${expTrend(kk)}</div>
  </section>`;
}
function parseNum(s){
  s = String(s || '').replace(/[,\s]/g, '').trim(); if(!s) return null;
  let m = s.match(/^(-?\d+(?:\.\d+)?)(조|억|만)?$/);
  if(m){ return Number(m[1]) * ({'조':1e12, '억':1e8, '만':1e4}[m[2]] || 1); }
  let total = 0, ok = false;
  for(const [u, v] of [['조', 1e12], ['억', 1e8], ['만', 1e4]]){ const x = s.match(new RegExp('(\\d+(?:\\.\\d+)?)' + u)); if(x){ total += Number(x[1]) * v; ok = true; s = s.replace(x[0], ''); } }
  if(ok){ if(/^\d+$/.test(s)) total += Number(s); return total; }
  return null;
}
/* 사냥 결과 캡처 글자 → {place, secs, exp} */
function parseExpText(text){
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const out = {place: '', secs: 0, exp: null};
  for(const l of lines){
    const t = l.replace(/\s+/g, '');
    if(!out.secs && /\d+(시간|분|초)/.test(t) && !/exp/i.test(t)){
      const h = t.match(/(\d+)시간/), m = t.match(/(\d+)분/), s = t.match(/(\d+)초/);
      out.secs = (h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0) + (s ? +s[1] : 0);
      continue;
    }
    if(out.exp == null && /e\s*x\s*p/i.test(l)){
      const x = l.replace(/^.*?e\s*x\s*p/i, '').match(/\d[\d,.\s]*\d|\d/);
      if(x) out.exp = Number(x[0].replace(/\D/g, ''));
      continue;
    }
    if(!out.place && /[가-힣]{2,}/.test(l) && !/(분|초|시간)\s*\d|\d\s*(분|초)/.test(l)){
      const m = l.match(/[가-힣][가-힣A-Za-z0-9 ()·'-]*[가-힣A-Za-z0-9)]/);
      if(m) out.place = m[0].trim();
    }
  }
  if(out.exp == null){ // "Exp" 글자를 못 읽은 경우: (0.0238%) 처럼 % 가 붙은 첫 숫자
    for(const l of lines){ const x = l.match(/(\d[\d,.]{3,})\s*\(\s*[\d.]+\s*%/); if(x){ out.exp = Number(x[1].replace(/\D/g, '')); break; } }
  }
  return out;
}
let TESS = null;
function loadTess(){
  if(TESS) return TESS;
  TESS = new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.onload = async () => { try{ ok(await Tesseract.createWorker('kor+eng')); }catch(e){ bad(e); } };
    s.onerror = () => bad(new Error('글자 인식 도구를 불러오지 못했습니다 (인터넷 연결 확인)'));
    document.head.appendChild(s);
  });
  TESS.catch(() => { TESS = null; });
  return TESS;
}
async function scaled(file, k){
  const img = await createImageBitmap(file);
  const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
/* 캡처에서 읽은 사냥터 이름 정리: 아이콘 등이 글자로 잘못 읽혀 앞뒤에 붙는 한 글자('이 어둠의 숲')를 떼고,
   이미 기록한 사냥터 이름으로 끝나면 그 이름으로 맞춤 */
function cleanPlace(p){
  let t = String(p || '').replace(/[|_~`'"·.,:;!?<>\[\]{}]+/g, ' ').replace(/\s+/g, ' ').trim();
  let parts = t.split(' ');
  while(parts.length > 1 && parts[0].length === 1 && parts.slice(1).join('').length >= 2) parts.shift();
  while(parts.length > 1 && parts[parts.length - 1].length === 1 && !/[가-힣]/.test(parts[parts.length - 1])) parts.pop();
  t = parts.join(' ').replace(/^[^가-힣A-Za-z]+/, '').trim();
  const known = [...new Set(expRecs().map(r => basePlace(r.place)))].filter(x => x && x !== '알 수 없는 사냥터').sort((a, b) => b.length - a.length);
  for(const k of known){
    if(t === k) return k;
    if(t.endsWith(k) && t.length - k.length <= 3) return k;
    if(t.replace(/\s/g, '') === k.replace(/\s/g, '')) return k;
  }
  return t;
}
const basePlace = p => String(p || '').replace(/-\d+$/, '');
function uniqPlace(p){
  // 같은 사냥터를 다시 올리면 '그림자 숲-1', '그림자 숲-2' … 로 번호를 붙여 따로 기록
  p = basePlace(p.trim());
  const used = new Set(expRecs().map(r => r.place));
  if(!used.has(p)) return p;
  let i = 1; while(used.has(`${p}-${i}`)) i++;
  return `${p}-${i}`;
}
function addRec(place, exp, secs){
  const r = {id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19), place: uniqPlace(cleanPlace(place) || '알 수 없는 사냥터'), exp, secs};
  expRecs().push(r); saveStore(); return r;
}
async function addShots(files){
  files = [...files].filter(f => f.type.startsWith('image/')).slice(0, 10);
  if(!files.length) return;
  if(route() !== 'exp') location.hash = '#exp';
  const items = files.map(f => ({url: URL.createObjectURL(f), file: f, state: '읽는 중…'}));
  EX.queue = items.concat(EX.queue).slice(0, 12);
  await render();
  let w;
  try{ w = await loadTess(); }catch(e){ items.forEach(s => { s.state = '읽기 실패 — 직접 입력'; s.fail = true; }); toast(e.message); render(); return; }
  for(const s of items){
    try{
      let p = parseExpText((await w.recognize(s.file)).data.text);
      if(!p.exp || !p.secs) p = Object.assign(p, Object.fromEntries(Object.entries(parseExpText((await w.recognize(await scaled(s.file, 2))).data.text)).filter(([k, v]) => v && !p[k])));
      if(p.exp && p.secs){
        const r = addRec(p.place, p.exp, p.secs);
        s.ok = true; s.state = `${r.place} · 시간당 ${krShort(p.exp / p.secs * 3600)}`;
      } else {
        s.fail = true; s.state = '일부만 읽음 — 아래 칸 확인 후 [기록 추가]';
        EX.edit = null; EX.pre = p;
      }
    }catch(e){ s.fail = true; s.state = '읽기 실패 — 직접 입력'; }
    await render();
    if(EX.pre){ const p = EX.pre; EX.pre = null; if(p.place) $('#exPlace').value = cleanPlace(p.place); if(p.exp) $('#exGain').value = p.exp.toLocaleString('ko-KR');
      if(p.secs){ $('#exH').value = Math.floor(p.secs / 3600) || ''; $('#exM').value = Math.floor(p.secs % 3600 / 60) || ''; $('#exS').value = p.secs % 60 || ''; } }
  }
  const okN = items.filter(s => s.ok).length;
  if(okN) toast(`${okN}건을 기록했습니다`);
}
function expSave(){
  const place = $('#exPlace').value.trim(), exp = parseNum($('#exGain').value);
  const secs = (Number($('#exH').value) || 0) * 3600 + (Number($('#exM').value) || 0) * 60 + (Number($('#exS').value) || 0);
  if(!exp || exp <= 0){ toast('획득 경험치를 입력하세요'); return; }
  if(!secs){ toast('사냥 시간을 입력하세요'); return; }
  if(EX.edit){ const r = expRecs().find(x => x.id === EX.edit); if(r){ r.place = place || r.place; r.exp = exp; r.secs = secs; } EX.edit = null; saveStore(); toast('수정했습니다'); }
  else { addRec(place, exp, secs); toast(`기록했습니다 — 1시간당 ${krNum(exp / secs * 3600)}`); }
  render();
}

/* ============================================================ 화면 그리기 */
function noData(){
  const c = D.local?.crawl;
  if(c?.running){
    const pct = c.total ? Math.floor(c.done / c.total * 100) : 0;
    return blank('전체 캐릭터 수집 중', `${esc(c.phase || '')} · ${nf(c.done)}/${nf(c.total)}명 (${pct}%) — 첫 월드가 끝나면 (약 15~25분) 바로 표시됩니다.<br>그동안 [캐릭터]와 [검색]은 지금 바로 쓸 수 있습니다`);
  }
  if(D.local) return blank('랭킹 · 통계 데이터가 아직 없습니다', `[갱신하기]를 누르면 전체 캐릭터 수집을 시작합니다. 월드 하나가 끝날 때마다 (약 15~25분) 바로 표시됩니다${c?.msg ? '<br>' + esc(c.msg) : ''}`);
  return blank('아직 수집된 데이터가 없습니다', '첫 수집이 끝나면 표시됩니다. 매일 12시쯤 자동으로 수집합니다');
}
function route(){ const r = (location.hash || '#my').slice(1); return ['my', 'guild', 'rank', 'top', 'stats', 'chg', 'exp', 'fav', 'track', 'help'].includes(r) ? r : 'my'; }
let RENDERING = null;
async function render(){
  if(RENDERING){ RENDERING.again = true; return RENDERING.p; }
  const st = {again: false};
  st.p = (async () => {
    do{
      st.again = false;
      const r = route();
      document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === r));
      const na = document.querySelector('#nav a.on'), nv = $('#nav');   // 휴대폰: 선택한 메뉴가 보이도록 가로 스크롤
      if(na && nv.scrollWidth > nv.clientWidth) nv.scrollTo({left: na.offsetLeft - (nv.clientWidth - na.offsetWidth) / 2, behavior: 'smooth'});
      renderStatus(); renderTicker();
      let html = '';
      try{
        html = r === 'rank' ? await pageRank() : r === 'top' ? await pageTop() : r === 'stats' ? await pageStats() : r === 'exp' ? pageExp() : r === 'fav' ? await pageFav() : r === 'track' ? await pageTrack() : r === 'guild' ? await pageGuild() : r === 'chg' ? await pageChg() : r === 'help' ? pageHelp() : await pageMy();
      }catch(e){ html = blank('불러오기 오류', esc(e.message || e)); }
      const focus = document.activeElement?.dataset?.in;
      const pos = focus ? document.activeElement.selectionStart : 0;
      $('#main').innerHTML = NB(html);
      if(focus){ const el = document.querySelector(`[data-in="${focus}"]`); if(el){ el.focus(); el.setSelectionRange(pos, pos); } }
    }while(st.again);
  })();
  RENDERING = st;
  try{ await st.p; } finally { RENDERING = null; }
}
function renderStatus(){
  const m = D.meta, L = D.local;
  let crawl = '';
  if(L?.crawl?.running){
    const c = L.crawl, pct = c.total ? c.done / c.total * 100 : 0;
    crawl = `<span>수집 중 <b>${nf(c.done)}/${nf(c.total)}</b><i class="prog"><b style="width:${pct.toFixed(1)}%"></b></i></span>`;
  }
  $('#status').innerHTML = `<span class="s-sys">시스템 <b>정상</b><span class="blink">_</span></span>`
    + `<span>데이터 기준일 <b>${esc(m?.date || '----')}</b></span>`
    + `<span>전체 캐릭터 <b>${m ? nf(m.worlds.reduce((a, w) => a + w.count, 0)) + '명' : '--'}</b></span>`
    + `<span>추적 <b>${ST.tracked.length}명</b></span>`
    + crawl
    + `<span class="s-auto">자동 수집 <b>매일 ${pad2(AUTO_HOUR)}:${D.local ? '00' : '05'} · 05:00</b></span>`
    + `<span class="s-ver">${D.local ? '내 PC' : '웹'} · 버전 <b>${VERSION}</b></span>`;
}
function renderTicker(){
  if(!$('#ticker')) return;
  const items = CARDS.filter(c => c.r).map(c => {
    const d = c.prev && c.last ? c.last.bp - c.prev.bp : 0;
    return `<span class="tk"><span class="n">${esc(c.t.n)}</span>${esc(wName(c.t.w))}<b>${nf(c.r[C.bp])}</b>${d ? `<span class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '▲' : '▼'}${Math.abs(d).toLocaleString('ko-KR')}</span>` : ''}${esc(mname(mcode(c.r[C.mc])))} ${nf(c.r[C.ml])}</span>`;
  });
  const seq = items.length ? items.join('') : '<span class="tk">캐릭터를 추가하면 이곳에 전투력이 흐릅니다</span><span class="tk">랭킹 · TOP 20 · 통계 · 경험치 계산기는 위 메뉴에서</span>';
  let rep = seq; while(rep.length < 4000) rep += seq;
  $('#ticker').innerHTML = rep + rep;
}

/* ============================================================ 갱신하기 */
async function localApi(path, body){
  const opt = body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json', 'X-L9':'1'}, body: JSON.stringify(body)};
  const r = await fetch(path, opt); let j = {}; try{ j = await r.json(); }catch(e){}
  if(!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
const busyUI = () => !!(document.querySelector('dialog[open]') || document.querySelector('.m.editing') || ['INPUT', 'SELECT'].includes(document.activeElement?.tagName));
let POLLT = null, WASRUN = false;
async function pollLocal(){
  clearTimeout(POLLT);
  try{ D.local = await localApi('api/local'); }catch(e){ POLLT = setTimeout(pollLocal, 8000); return; }
  renderStatus();
  const btn = $('#btnRefresh'), c = D.local.crawl || {};
  if(c.running){
    if(!btn.disabled) btn.innerHTML = '<span class="spin"></span>수집 중';
    const wd = c.worlds_done || 0;
    if(!WASRUN || wd !== D.lastWd){
      D.lastWd = wd; await loadMeta();
      if(!busyUI()) render();
    } else if(['rank', 'top', 'stats'].includes(route()) && !readyWorlds().length && !busyUI()) render();
  } else if(!WASRUN && D.ready){
    // 수집 중이 아닐 때도 데이터 파일이 바뀌었는지 확인 (data 폴더를 붙여넣은 경우 바로 반영)
    const old = D.meta?.generated; await loadMeta();
    if(D.meta?.generated !== old){ toast(`새 데이터를 불러왔습니다 (기준일 ${D.meta?.date || '-'})`); if(!busyUI()) render(); }
  }
  if(!c.running && WASRUN){
    if(!btn.disabled) btn.textContent = '갱신하기';
    const old = D.meta?.generated; await loadMeta();
    if(D.meta?.generated !== old) toast(`새 데이터를 불러왔습니다 (기준일 ${D.meta.date})`);
    else if(c.msg) toast(c.msg);
    if(!busyUI()) render();
  }
  WASRUN = !!c.running;
  POLLT = setTimeout(pollLocal, c.running ? 2500 : 6000);
}
async function doRefresh(btn){
  if(D.local){
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span>조회 중';
    try{
      const r = await localApi('api/refresh', {chars: ST.tracked.map(t => [t.w, t.n])});
      await loadQuick(); await loadMeta(); await render();
      showLines('갱신 결과', [...(r.lines || []).map(l => '추적 캐릭터 · ' + l), r.message || ''].filter(Boolean));
      if(r.state === 'started' || r.state === 'running') pollLocal();
    }catch(e){ toast('갱신 실패: ' + e.message); }
    finally{ btn.disabled = false; if(!D.local?.crawl?.running) btn.textContent = '갱신하기'; }
    return;
  }
  const old = D.meta?.generated;
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>갱신 중';
  try{ await loadMeta(); }finally{ btn.disabled = false; btn.textContent = '갱신하기'; }
  if(!D.meta) toast('아직 수집된 데이터가 없습니다');
  else if(D.meta.generated !== old) toast(`새 데이터를 불러왔습니다 (기준일 ${D.meta.date})`);
  else if(!D.local) toast(`최신 데이터입니다 (기준일 ${D.meta.date}) — 매일 12시쯤 자동으로 새로 수집합니다`);
  await render();
}

/* ============================================================ 대화상자 */
async function addWorlds(){
  if(D.local){
    try{ D.wlist = (await localApi('api/worlds')).worlds; return D.wlist; }catch(e){}
  }
  return (D.meta?.worlds || []).map(w => [w.code, w.name]);
}
let SMODE = 'char';
async function setSearchMode(m){
  SMODE = m;
  $('#sTab').querySelectorAll('[data-st]').forEach(b => b.classList.toggle('on', b.dataset.st === m));
  $('#sLabel').textContent = m === 'guild' ? '길드명' : '캐릭터 명';
  $('#addName').placeholder = m === 'guild' ? '예: 별빛' : '예: 스타일러';
  $('#sHint').innerHTML = NB(m === 'guild'
    ? '길드명을 입력하고 [찾기] → 월드 · 서버 · 인원이 표시된 목록에서 길드를 누르면 [길드]에 정보가 표시됩니다.<br>' + critText() + '입니다.'
    : critText().replace(' 기준', '') + ' 캐릭터만 검색됩니다.<br>' + '캐릭터 명 일부만 입력하고 [찾기] → 캐릭터를 누르면 [캐릭터]에 표시됩니다.');
  $('#addWorld').closest('.f').hidden = m === 'guild';
  const prev = $('#addWorld').value;
  const ws = m === 'guild' ? [[0, '전체 월드']].concat(readyWorlds().map(w => [w.code, w.name])) : await addWorlds();
  $('#addWorld').innerHTML = ws.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('');
  if(m === 'char' && ws.some(w => String(w[0]) === prev)) $('#addWorld').value = prev;
  $('#cands').innerHTML = m === 'guild' && !readyWorlds().length ? '<span style="color:var(--dim);font-size:12px">길드 검색은 전체 수집 데이터가 있어야 합니다 — 첫 수집이 끝나면 쓸 수 있습니다.</span>' : '';
  $('#addName').focus();
}
async function openAdd(mode){
  if((mode || 'char') === 'char'){
    const ws = await addWorlds();
    if(!ws.length && !readyWorlds().length){ toast(D.local ? '게임 사이트에 연결할 수 없습니다 — 인터넷 연결을 확인하세요' : '아직 수집된 데이터가 없어 찾을 수 없습니다'); return; }
  }
  $('#addName').value = '';
  await setSearchMode(mode || 'char');
  $('#dlgAdd').showModal(); $('#addName').focus();
}
async function findNames(){
  const q = $('#addName').value.trim(); if(!q) return;
  if(SMODE === 'guild'){
    const hits = await findGuilds(q);
    $('#cands').innerHTML = hits.length ? hits.slice(0, 40).map(g => `<button type="button" data-g="${esc(g.k)}"><b>${esc(g.g)}</b> <small style="color:var(--dim)">${esc(gLabel(g))} · ${nf(g.rows.length)}명 · 평균 ${krShort(g.avg)}</small></button>`).join('')
      : '<span style="color:var(--dim);font-size:12px">찾는 길드가 없습니다 — 길드원이 모두 수집 기준 밖이면 검색되지 않습니다.</span>';
    return;
  }
  $('#cands').innerHTML = '<span class="spin"></span>찾는 중';
  try{
    const wc = Number($('#addWorld').value);
    if(D.local){
      try{
        const r = await localApi('api/names?world=' + wc + '&q=' + encodeURIComponent(q));
        const ready = readyWorlds().some(w => w.code === wc) ? await world(wc).catch(() => null) : null;
        $('#cands').innerHTML = r.names.length ? r.names.map(n => { const x = ready?.byName.get(n);
          return `<button type="button" data-n="${esc(n)}">${esc(n)}${x ? ` <small style="color:var(--dim)">${serverLabel(x[C.s])} · ${esc(x[C.g] || '길드 없음')} · ${krShort(x[C.bp])}</small>` : ''}</button>`; }).join('')
          : '<span style="color:var(--dim);font-size:12px">후보 없음 — 수집 기준 밖이면 검색되지 않습니다.</span>';
        return;
      }catch(e){ if(!readyWorlds().some(w => w.code === wc)) throw e; }
    }
    const j = await world(wc);
    const hits = j.rows.filter(r => r[C.n].includes(q)).slice(0, 40);
    $('#cands').innerHTML = hits.length ? hits.map(r => `<button type="button" data-n="${esc(r[C.n])}">${esc(r[C.n])} <small style="color:var(--dim)">${serverLabel(r[C.s])} · ${esc(r[C.g] || '길드 없음')} · ${krShort(r[C.bp])}</small></button>`).join('')
      : '<span style="color:var(--dim);font-size:12px">후보 없음 — 수집 기준 밖이면 검색되지 않습니다.</span>';
  }catch(e){ $('#cands').textContent = '오류: ' + e.message; }
}
function cardOf(k){ return CARDS.find(c => c.k === k); }
function openMastery(k){
  const c = cardOf(k); if(!c) return;
  $('#dlgM').dataset.k = k;
  $('#mTitle').innerHTML = '마스터리 입력 <small>' + esc(c.t.n) + '</small>';
  $('#mDate').value = todayKST();
  $('#mForm').innerHTML = masteryList().map(([code, name]) => { const m = c.ms[code];
    return `<div class="f"><label>${esc(name)}</label><input data-code="${code}" inputmode="numeric" value="${m ? m.level : ''}"><small>${m ? esc(m.date + ' ' + m.source) : '미입력'}</small></div>`; }).join('');
  $('#mInteg').value = c.integ ? c.integ.l : '';
  $('#mPct').value = c.integ && c.integ.p != null ? c.integ.p : '';
  $('#dlgM').showModal();
}
function openEdit(k){
  const c = cardOf(k); if(!c) return;
  $('#dlgE').dataset.k = k;
  $('#eWorld').innerHTML = (D.meta?.worlds || [{code: c.t.w, name: wName(c.t.w)}]).map(w => `<option value="${w.code}" ${w.code === c.t.w ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
  $('#eName').value = c.t.n;
  $('#dlgE').showModal();
}

/* 백업 · 엑셀 */
function download(name, text, type){
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function exportCsv(){
  if(!ST.tracked.length){ toast('추적 중인 캐릭터가 없습니다'); return; }
  const CARDS = await buildCards();
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [['기준일', '월드', '닉네임', '직업', '전투력', '업적점수', '대표 마스터리', '마스터리 레벨', '마스터리 랭크', '전문화'].join(',')];
  for(const c of CARDS){ const job = c.r ? jobName(c.r[C.j]) : (c.h ? jobName(c.h.j) : '');
    for(const s of c.series) lines.push([s.d, wName(c.t.w), c.t.n, job, s.bp, s.ach, mname(s.mc), s.ml, s.mr, s.sp].map(q).join(',')); }
  lines.push('', ['닉네임', '무기', '레벨', '확인일', '출처'].join(','));
  for(const c of CARDS) for(const [code, m] of Object.entries(c.ms)) lines.push([c.t.n, mname(code), m.level, m.date, m.source].map(q).join(','));
  lines.push('', ['닉네임', '통합 레벨', '%', '입력일'].join(','));
  for(const c of CARDS) for(const it of c.integs) lines.push([c.t.n, it.l, it.p, it.d].map(q).join(','));
  download(`로드나인_추적기록_${todayKST()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

/* ============================================================ 배경음악 (열면 자동 재생) */
// 음악 버튼 아이콘: 글자 기호(⏸ ⏭)는 아이폰에서 이모티콘으로 바뀌어 그림으로 그림
const ICO = {play: `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>`, pause: `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/></svg>`, up: `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10.5l5-5 5 5z" fill="currentColor"/></svg>`, down: `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5.5l5 5 5-5z" fill="currentColor"/></svg>`};
const BG = {player:null, ready:false, playing:false, shuffle:false, list:DEFAULT_PLAYLIST, vol:40, mini:true, auto:true, muted:false, apiFailed:false};
function parseList(s){ s = (s || '').trim(); const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/); if(m) return m[1]; return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null; }
function bgmUI(){
  const box = $('#bgm');
  box.classList.toggle('playing', BG.playing); box.classList.toggle('mini', BG.mini); box.classList.toggle('muted', BG.muted && BG.playing);
  $('#bgmPlay').innerHTML = $('#bgmPlay2').innerHTML = BG.playing ? ICO.pause : ICO.play;
  $('#bgmFold').innerHTML = BG.mini ? ICO.up : ICO.down;
  $('#bgmShuf').classList.toggle('on', BG.shuffle);
  $('#bgmAuto').classList.toggle('on', BG.auto);
}
function bgmTitle(){
  let t = ''; try{ t = BG.player.getVideoData().title || ''; }catch(e){}
  $('#bgmSong').innerHTML = `<span>${esc(t || (BG.playing ? '재생 중' : '재생 버튼을 눌러 시작하세요'))}${BG.muted && BG.playing ? ' (소리 꺼짐)' : ''}</span>`;
}
function bgmCreate(){
  if(!window.YT || !YT.Player) return;
  if(BG.player){ try{ BG.player.destroy(); }catch(e){} $('.ytbox').innerHTML = '<div id="ytp"></div>'; }
  BG.ready = false;
  BG.player = new YT.Player('ytp', {
    width:'100%', height:'100%',
    playerVars:{listType:'playlist', list:BG.list, rel:0, playsinline:1, modestbranding:1, origin:location.origin},
    events:{
      onReady:() => { BG.ready = true; BG.player.setVolume(BG.vol); if(BG.shuffle) BG.player.setShuffle(true); $('#bgmMsg').textContent = ''; bgmTitle();
        if(BG.autoplay || BG.auto){ BG.autoplay = false; bgmAutoplay(); } },
      onStateChange:e => { BG.playing = e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING; bgmUI(); bgmTitle(); },
      onError:e => { $('#bgmMsg').textContent = '재생할 수 없는 곡이라 다음 곡으로 넘어갑니다 (오류 ' + e.data + ')'; try{ BG.player.nextVideo(); }catch(_){} }
    }
  });
}
function bgmAutoplay(){
  // 소리 있는 자동 재생이 막히면 소리를 끈 채 재생하고, 화면을 처음 누를 때 소리를 켬
  try{ BG.player.unMute(); BG.player.playVideo(); }catch(e){ return; }
  setTimeout(() => {
    if(!BG.ready) return;
    const s = BG.player.getPlayerState();
    if(s !== 1 && s !== 3){ BG.player.mute(); BG.muted = true; BG.player.playVideo(); bgmUI(); setTimeout(bgmTitle, 800); }
  }, 1600);
}
function bgmUnlock(){
  if(!BG.muted || !BG.ready) return;
  try{ BG.player.unMute(); BG.player.setVolume(BG.vol); if(!BG.playing) BG.player.playVideo(); }catch(e){}
  BG.muted = false; bgmUI(); bgmTitle();
}
window.onYouTubeIframeAPIReady = bgmCreate;
function bgmInit(){
  BG.list = lsGet('l9bgmList', DEFAULT_PLAYLIST); BG.vol = Number(lsGet('l9bgmVol', 40)); BG.mini = lsGet('l9bgmMini', '1') === '1';
  BG.shuffle = lsGet('l9bgmShuf', '0') === '1'; BG.auto = lsGet('l9bgmAuto', '1') === '1';
  $('#bgmVol').value = BG.vol; $('#bgmList').value = 'https://www.youtube.com/playlist?list=' + BG.list;
  bgmUI();
  const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
  s.onerror = () => { BG.apiFailed = true; $('#bgmMsg').textContent = '유튜브에 연결할 수 없습니다. 인터넷 연결을 확인하세요.'; $('#bgmSong').innerHTML = '<span>연결 안 됨</span>'; };
  document.head.appendChild(s);
}
function bgmToggle(){
  if(BG.apiFailed){ BG.mini = false; bgmUI(); toast('유튜브에 연결할 수 없습니다'); return; }
  if(!BG.ready){ BG.autoplay = true; toast('플레이어를 불러오는 중입니다'); return; }
  if(BG.muted){ bgmUnlock(); return; }
  if(BG.playing) BG.player.pauseVideo(); else BG.player.playVideo();
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, e => { if(!e.target.closest?.('[data-act="bgm-play"]')) bgmUnlock(); }, true));
$('#bgmVol').addEventListener('input', e => { BG.vol = Number(e.target.value); lsSet('l9bgmVol', BG.vol); if(BG.ready) BG.player.setVolume(BG.vol); });
$('#bgmList').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); document.querySelector('[data-act="bgm-load"]').click(); } });

/* ============================================================ 색상 */
function setPhos(p){
  const f = PHOS.find(x => x[0] === p) || PHOS[0];
  document.documentElement.dataset.phos = f[0];
  $('#btnPhos').textContent = '색상 · ' + f[1];
  $('#palbox').innerHTML = PHOS.map(([k, l, c]) => `<button class="sw ${k === f[0] ? 'on' : ''}" data-act="phos" data-v="${k}"><i style="background:${c};color:${c}"></i>${l}</button>`).join('');
  lsSet('l9phos', f[0]);
}

/* ============================================================ 이벤트 */
document.addEventListener('click', async ev => {
  if(!ev.target.closest('#pal')) $('#pal').classList.remove('open');
  const b = ev.target.closest('[data-act]'); if(!b) return;
  const act = b.dataset.act, k = b.dataset.k;
  try{
    if(act === 'refresh') await doRefresh(b);
    else if(act === 'add') await openAdd(route() === 'guild' ? 'guild' : 'char');
    else if(act === 'export') await exportCsv();
    else if(act === 'pal') $('#pal').classList.toggle('open');
    else if(act === 'phos'){ setPhos(b.dataset.v); $('#pal').classList.remove('open'); }
    else if(act === 'quick1'){
      const c = cardOf(k); if(!c) return;
      b.disabled = true; b.innerHTML = '<span class="spin"></span>조회 중';
      const r = await quickRun([[c.t.w, c.t.n]]);
      if(r) showLines('조회 결과', r.lines);
    }
    else if(act === 'mastery') openMastery(k);
    else if(act === 'medit') startMEdit(b);
    else if(act === 'edit') openEdit(k);
    else if(act === 'rankof'){
      const c = cardOf(k); if(c?.r){ SC.scope = 'server'; SC.w = c.t.w; SC.s = c.r[C.s]; saveSC(); RK.q = ''; RK.page = 0; }
      location.hash = '#rank';
      if(c?.r){ await render(); const list = await sorted(RK.by, RK.job); const i = list.indexOf(c.r); if(i >= 0){ RK.page = Math.floor(i / PAGE); await render(); document.getElementById('rk-' + i)?.scrollIntoView({block:'center'}); } }
    }
    else if(act === 'del'){
      const c = cardOf(k);
      if(c && confirm(`${c.t.n} 추적을 해제할까요? (직접 입력한 마스터리 기록은 남습니다)`)){
        ST.tracked = ST.tracked.filter(t => key(t.w, t.n) !== k); saveStore(); await render(); toast('추적을 해제했습니다');
      }
    }
    else if(act === 'ovk'){ OVK = b.dataset.v; render(); }
    else if(act === 'backup') download(`로드나인_추적기_백업_${todayKST()}.json`, JSON.stringify(ST, null, 1), 'application/json');
    else if(act === 'restore') $('#fileBackup').click();
    // 범위 · 랭킹
    else if(act === 'sc-scope'){ SC.scope = b.dataset.v; saveSC(); RK.page = 0; render(); }
    else if(act === 'rk-by'){ RK.by = b.dataset.v; RK.page = 0; lsSet('l9rank', JSON.stringify({by: RK.by})); render(); }
    else if(act === 'top-tab'){ TOPTAB = b.dataset.v; lsSet('l9toptab', TOPTAB); await render(); }
    else if(act === 'my-reset'){ ST.cur = null; ST.recent = []; saveSession(); await render(); window.scrollTo({top: 0}); toast('캐릭터 화면을 초기화했습니다 (추적 · 즐겨찾기는 그대로)'); }
    else if(act === 'cg-per'){ CG.per = Number(b.dataset.v); CG.page = 0; CG.mv = 24; saveCG(); await render(); }
    else if(act === 'cg-cf'){ CG.cf = Number(b.dataset.v); CG.page = 0; saveCG(); await render(); }
    else if(act === 'cg-kind'){ CG.kind = Number(b.dataset.v); CG.page = 0; saveCG(); await render(); }
    else if(act === 'cg-page'){ CG.page = Math.max(0, Number(b.dataset.p)); await render(); document.getElementById('cglist')?.scrollIntoView({block: 'start'}); }
    else if(act === 'cg-more'){ CG.mv += 24; await render(); }
    else if(act === 'rk-page'){ RK.page = Math.max(0, Number(b.dataset.p)); await render(); window.scrollTo({top: $('#main').offsetTop - 10}); }
    else if(act === 'rk-goto'){ const i = Number(b.dataset.i); RK.q = ''; RK.page = Math.floor(i / PAGE); await render(); document.getElementById('rk-' + i)?.scrollIntoView({block:'center'}); }
    else if(act === 'track'){ ev.stopPropagation(); track(b.dataset.w, b.dataset.n); }
    else if(act === 'char') charDialog(Number(b.dataset.w), b.dataset.n);
    else if(act === 'fav'){ ev.stopPropagation(); toggleFav(b.dataset.w, b.dataset.n); render(); }
    else if(act === 'g-find'){ GS.q = ($('#gq')?.value || '').trim(); GS.sel = null; const hs = GS.q ? await findGuilds(GS.q) : []; if(hs.length === 1) GS.sel = hs[0].k; saveGS(); await render(); if(GS.sel) $('#gdetail')?.scrollIntoView({behavior:'smooth', block:'start'}); }
    else if(act === 'g-open'){ GS.sel = k; saveGS(); await render(); $('#gdetail')?.scrollIntoView({behavior:'smooth', block:'start'}); }
    else if(act === 'g-reset'){ GS.q = ''; GS.sel = null; saveGS(); await render(); $('#gq')?.focus(); }
    else if(act === 'g-per'){ GS.per = Number(b.dataset.v); saveGS(); render(); }
    else if(act === 'g-trackall'){
      const g = (await guildIndex()).get(k); if(!g) return;
      const add = g.rows.filter(r => !isTracked(r));
      if(!add.length){ toast('이미 모두 추적 중입니다'); return; }
      if(!confirm(`${g.g} (${gLabel(g)}) 길드원 ${add.length}명을 모두 추적할까요?`)) return;
      for(const r of add) ST.tracked.push({w: r[C.w], n: r[C.n], added: todayKST(), ev: []});
      saveStore(); if(D.local) localApi('api/tracked', {chars: ST.tracked.map(t => [t.w, t.n])}).catch(() => {});
      toast(`${add.length}명을 추적에 추가했습니다 — [추적]에서 관리합니다`); render();
    }
    else if(act === 'guildgo'){ ev.preventDefault(); if($('#dlgR').open) $('#dlgR').close(); GS.q = b.dataset.g; openGuild(gkey(b.dataset.w, b.dataset.s, b.dataset.g)); }
    else if(act === 'setcur'){ setCur(b.dataset.w, b.dataset.n); await render(); window.scrollTo({top: 0}); }
    else if(act === 'tr-chk'){ TRCHK.has(k) ? TRCHK.delete(k) : TRCHK.add(k); render(); }
    else if(act === 'mv-apply'){ if(!confirm(`${b.dataset.on} → ${b.dataset.n} (${wName(b.dataset.w)}) 로 바꿀까요?\n추적 · 즐겨찾기 · 메모 · 입력한 마스터리가 함께 옮겨집니다.`)) return; applyMove(b.dataset.ow, b.dataset.on, b.dataset.w, b.dataset.n); toast('바꿨습니다'); await render(); }
    else if(act === 'tr-freset'){ Object.assign(TRF, {q: '', g: '', w: 0}); saveTRF(); render(); }
    else if(act === 'tr-chkall'){ const all = TRVIEW.keys.length ? TRVIEW.keys : ST.tracked.map(t => key(t.w, t.n)); if(all.every(x => TRCHK.has(x))) TRCHK.clear(); else all.forEach(x => TRCHK.add(x)); render(); }
    else if(act === 'tr-chknone'){ TRCHK.clear(); render(); }
    else if(act === 'tr-delsel' || act === 'tr-delall'){
      const keys = act === 'tr-delall' ? ST.tracked.map(t => key(t.w, t.n)) : [...TRCHK];
      if(!keys.length) return;
      if(!confirm(act === 'tr-delall' ? `추적 중인 ${keys.length}명을 모두 해제할까요?\n(직접 입력한 마스터리·통합 레벨 기록은 남습니다)` : `선택한 ${keys.length}명의 추적을 해제할까요?\n(직접 입력한 마스터리·통합 레벨 기록은 남습니다)`)) return;
      const ks = new Set(keys);
      ST.tracked = ST.tracked.filter(t => !ks.has(key(t.w, t.n))); TRCHK.clear(); saveStore();
      if(D.local) localApi('api/tracked', {chars: ST.tracked.map(t => [t.w, t.n])}).catch(() => {});
      await render(); toast(`${keys.length}명의 추적을 해제했습니다`);
    }
    else if(act === 'trsel'){ TRSEL = k; lsSet('l9trsel', k); await render(); document.querySelector('.subj')?.scrollIntoView({behavior:'smooth', block:'start'}); }
    else if(act === 'gotrack'){ TRSEL = k; lsSet('l9trsel', k); location.hash = '#track'; }
    // 경험치
    else if(act === 'exp-file') $('#fileShot').click();
    else if(act === 'exp-save') expSave();
    else if(act === 'exp-cancel'){ EX.edit = null; render(); }
    else if(act === 'exp-edit'){ EX.edit = b.dataset.id; await render(); window.scrollTo({top: $('#main').offsetTop - 10}); $('#exGain')?.focus(); }
    else if(act === 'exp-del'){ if(confirm('이 기록을 삭제할까요?')){ ST.expr = expRecs().filter(r => r.id !== b.dataset.id); if(EX.edit === b.dataset.id) EX.edit = null; saveStore(); render(); } }
    else if(act === 'exp-clearall'){ if(confirm(`경험치 기록 ${expRecs().length}건을 모두 삭제할까요?`)){ ST.expr = []; EX.edit = null; EX.queue = []; saveStore(); render(); } }
    else if(act === 'exp-chart'){ EX.chart = b.dataset.v; render(); }
    else if(act === 'exp-reset'){
      if(confirm('경험치 계산기를 초기화할까요?\n입력 칸, 올린 캡처, 기록 ' + expRecs().length + '건이 모두 지워집니다.')){
        ST.expr = []; EX.edit = null; EX.queue = []; saveStore(); await render(); toast('초기화했습니다');
      }
    }
    // 음악
    else if(act === 'bgm-play') bgmToggle();
    else if(act === 'bgm-next'){ if(BG.ready) BG.player.nextVideo(); }
    else if(act === 'bgm-prev'){ if(BG.ready) BG.player.previousVideo(); }
    else if(act === 'bgm-fold'){ BG.mini = !BG.mini; lsSet('l9bgmMini', BG.mini ? '1' : '0'); bgmUI(); }
    else if(act === 'bgm-auto'){ BG.auto = !BG.auto; lsSet('l9bgmAuto', BG.auto ? '1' : '0'); bgmUI(); toast(BG.auto ? '열면 자동 재생: 켬' : '열면 자동 재생: 끔'); }
    else if(act === 'bgm-shuffle'){ BG.shuffle = !BG.shuffle; lsSet('l9bgmShuf', BG.shuffle ? '1' : '0'); if(BG.ready){ BG.player.setShuffle(BG.shuffle); if(BG.shuffle && BG.playing) BG.player.nextVideo(); } bgmUI(); toast(BG.shuffle ? '무작위 재생 켬' : '무작위 재생 끔'); }
    else if(act === 'bgm-load'){
      const l = parseList($('#bgmList').value); if(!l){ toast('재생목록 주소를 확인하세요 (list= 가 들어간 주소)'); return; }
      BG.list = l; lsSet('l9bgmList', l); BG.autoplay = true; bgmCreate(); toast('재생목록을 바꿨습니다');
    }
    else if(act === 'quit'){
      if(confirm('프로그램을 종료할까요?')){
        try{ await localApi('api/quit', {}); }catch(e){}
        try{ if(BG.ready) BG.player.stopVideo(); }catch(e){}
        document.querySelector('.wrap').innerHTML = '<div class="closed"><div><h2 class="g">프로그램을 종료했습니다</h2><p style="color:var(--dim)">이 탭을 닫아도 됩니다.</p></div></div>';
        $('#bgm').remove();
      }
    }
  }catch(e){ toast(e.message || String(e)); }
});
document.addEventListener('change', e => {
  const t = e.target.dataset?.ch; if(!t) return;
  if(t === 'sc-w'){ SC.w = Number(e.target.value); SC.s = 0; saveSC(); RK.page = 0; render(); }
  else if(t === 'sc-s'){ SC.s = Number(e.target.value); saveSC(); RK.page = 0; render(); }
  else if(t === 'rk-job'){ RK.job = e.target.value; RK.page = 0; render(); }
  else if(t === 'tr-g'){ TRF.g = e.target.value; saveTRF(); render(); }
  else if(t === 'tr-w'){ TRF.w = Number(e.target.value); saveTRF(); render(); }
  else if(t === 'tr-sort'){ TRF.sort = e.target.value; saveTRF(); render(); }
  else if(t === 'cg-w'){ CG.w = Number(e.target.value); CG.page = 0; CG.mv = 24; saveCG(); render(); }
});
let QT = null;
document.addEventListener('input', e => {
  if(e.target.dataset?.in === 'tr-q'){ TRF.q = e.target.value; saveTRF(); clearTimeout(QT); QT = setTimeout(render, 250); }
  if(e.target.dataset?.in === 'cg-q'){ CG.q = e.target.value; CG.page = 0; clearTimeout(QT); QT = setTimeout(render, 250); }
  if(e.target.dataset?.in === 'rk-q'){ RK.q = e.target.value; RK.page = 0; clearTimeout(QT); QT = setTimeout(render, 250); }
  const mk = e.target.dataset?.memo;
  if(mk){ const f = (ST.fav || []).find(x => key(x.w, x.n) === mk); if(f){ f.memo = e.target.value; clearTimeout(MT); MT = setTimeout(saveStore, 300); } }
});
let MT = null;
document.addEventListener('keydown', e => {
  const m = e.target.closest && e.target.closest('.m[data-act="medit"]');
  if(m && e.target === m && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); startMEdit(m); }
  if(e.key === 'Enter' && e.target.closest?.('.efields,.tsplit')){ e.preventDefault(); expSave(); }
  if(e.key === 'Enter' && e.target.id === 'gq'){ e.preventDefault(); document.querySelector('[data-act="g-find"]')?.click(); }
});
window.addEventListener('hashchange', () => { window.scrollTo({top: 0}); render(); });
// 위로 가기 버튼: 화면을 내리면 나타나서 오른쪽에 따라다님
window.addEventListener('scroll', () => { $('#toTop').classList.toggle('on', window.scrollY > 300); }, {passive: true});
$('#toTop').addEventListener('click', () => window.scrollTo({top: 0, behavior: 'smooth'}));
// 경험치 캡처: 붙여넣기 · 끌어다 놓기
document.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
  if(files.length){ e.preventDefault(); addShots(files); }
});
document.addEventListener('dragover', e => { if(route() === 'exp'){ e.preventDefault(); $('#expDrop')?.classList.add('over'); } });
document.addEventListener('dragleave', e => { if(!e.relatedTarget) $('#expDrop')?.classList.remove('over'); });
document.addEventListener('drop', e => { if(route() !== 'exp') return; e.preventDefault(); $('#expDrop')?.classList.remove('over'); addShots(e.dataTransfer.files); });
$('#fileShot').addEventListener('change', e => { addShots(e.target.files); e.target.value = ''; });
$('#fileBackup').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if(!f) return;
  try{
    const j = JSON.parse(await f.text());
    if(!j || j.v !== 1 || !Array.isArray(j.tracked)) throw new Error('백업 파일 형식이 아닙니다');
    if(!confirm(`백업을 불러오면 지금 기록(추적 ${ST.tracked.length}명)을 바꿉니다. 계속할까요?`)) return;
    ST = Object.assign(freshStore(), j); loadSession(); saveStore(); await render(); toast(`백업을 불러왔습니다 (추적 ${ST.tracked.length}명)`);
  }catch(err){ toast('불러오기 실패: ' + err.message); }
});
// 대화상자 버튼
$('#btnFind').onclick = findNames;
$('#addName').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); findNames(); } });
$('#sTab').addEventListener('click', e => { const b = e.target.closest('[data-st]'); if(b) setSearchMode(b.dataset.st); });
$('#cands').addEventListener('click', e => {
  const gb = e.target.closest('[data-g]');
  if(gb){ openGuild(gb.dataset.g); $('#dlgAdd').close(); return; }
  const b = e.target.closest('[data-n]'); if(!b) return;
  setCur(Number($('#addWorld').value), b.dataset.n); $('#dlgAdd').close();
  if(route() !== 'my') location.hash = '#my'; else { render(); window.scrollTo({top: 0}); }
  if(D.local) quickRun([[Number($('#addWorld').value), b.dataset.n]]); });
$('#btnMOk').onclick = async () => {
  const k = $('#dlgM').dataset.k, d = $('#mDate').value || todayKST();
  const c = cardOf(k); let n = 0;
  document.querySelectorAll('#mForm input').forEach(i => { const v = i.value.trim();
    if(/^\d+$/.test(v) && (!c.ms[i.dataset.code] || c.ms[i.dataset.code].level !== Number(v))){ (ST.mastery[k] ||= {})[i.dataset.code] = {l: Number(v), d}; n++; } });
  const il = $('#mInteg').value.trim(), ip = $('#mPct').value.trim();
  if(/^\d+$/.test(il)){
    const arr = (ST.integ[k] ||= []).filter(x => x.d !== d);
    arr.push({d, l: Number(il), p: ip === '' ? null : Number(ip)}); ST.integ[k] = arr; n++;
    // 마스터리 11종이 모두 있으면 추정 기준점으로 저장
    const lv = {}; for(const [code] of masteryList().slice(0, 11)) lv[code] = c.ms[code]?.level;
    document.querySelectorAll('#mForm input').forEach(i => { if(/^\d+$/.test(i.value.trim())) lv[i.dataset.code] = Number(i.value.trim()); });
    if(Object.values(lv).every(Boolean)){
      const sum = Object.values(lv).reduce((a, b) => a + b, 0), v = Number(il) + (ip === '' ? 0 : Number(ip) / 100);
      ST.calib = (ST.calib || []).filter(x => x.k !== k).concat([{k, sum, v}]);
    }
  }
  saveStore(); $('#dlgM').close(); await render(); toast(`저장했습니다 (${n}건)`);
};
$('#btnEOk').onclick = async () => {
  const k = $('#dlgE').dataset.k, t = ST.tracked.find(x => key(x.w, x.n) === k);
  const w = Number($('#eWorld').value), n = $('#eName').value.trim();
  if(!t || !n) return;
  const nk = key(w, n);
  if(nk !== k && ST.tracked.some(x => key(x.w, x.n) === nk)){ toast('이미 추적 중인 캐릭터입니다'); return; }
  const d = todayKST(); t.ev ||= [];
  if(w !== t.w) t.ev.push({d, kind: '월드 이전', before: wName(t.w), after: wName(w)});
  if(n !== t.n) t.ev.push({d, kind: '닉네임 변경', before: t.n, after: n});
  if(ST.mastery[k] && nk !== k){ ST.mastery[nk] = ST.mastery[k]; delete ST.mastery[k]; }
  if(ST.integ[k] && nk !== k){ ST.integ[nk] = ST.integ[k]; delete ST.integ[k]; }
  t.w = w; t.n = n; saveStore(); $('#dlgE').close(); await render(); toast('변경했습니다');
};

/* ============================================================ 시작 */
async function importLegacy(){
  // 내 PC 프로그램 0.5 이하에서 쓰던 기록(추적 캐릭터 · 직접 입력 마스터리 · 통합 레벨)을 한 번 가져옴
  if(!D.local || ST.imported) return;
  try{
    const r = await localApi('api/legacy');
    let n = 0;
    for(const c of r.chars || []){
      const k = key(c.world_code, c.name);
      if(!ST.tracked.some(t => key(t.w, t.n) === k)){ ST.tracked.push({w: c.world_code, n: c.name, added: c.created || todayKST(), ev: []}); n++; }
      for(const [code, m] of Object.entries(c.masteries || {})) if(m.source !== '사이트') (ST.mastery[k] ||= {})[code] = {l: m.level, d: m.date};
      if(c.integ?.length) ST.integ[k] = c.integ.map(x => ({d: x.date, l: x.level, p: x.pct}));
    }
    ST.imported = true; saveStore();
    if(n) toast(`이전 버전 기록을 가져왔습니다 (캐릭터 ${n}명)`);
  }catch(e){}
}
(async function start(){
  try{ const r = await fetch('api/hello', {cache:'no-store'}); if(r.ok){ const j = await r.json(); if(j.app === 'l9tracker') D.local = {version: j.version}; } }catch(e){}
  if(D.local){
    // 프로그램 폴더에 저장된 기록·설정 불러오기 (없으면 지금 브라우저 기록을 올림)
    try{
      const j = await localApi('api/store');
      if(j.store && j.store.v === 1){ ST = Object.assign(freshStore(), j.store); }
      else if(ST.tracked.length || (ST.fav || []).length || (ST.expr || []).length) syncPush({store: persisted()});
      for(const [k, v] of Object.entries(j.prefs || {})){ try{ localStorage.setItem(k, v); }catch(e){} }
      SYNC.on = true;
      if(!j.prefs) syncPush({prefs: prefsNow()});
    }catch(e){}
  }
  loadSession(); saveStore();   // 예전에 저장된 '검색한 캐릭터' 기록은 지움
  setPhos(lsGet('l9phos', 'blue'));
  bgmInit();
  if(D.local){
    $('#btnQuit').hidden = false;
    setInterval(() => { fetch('api/ping', {method:'POST', headers:{'X-L9':'1'}}).catch(() => {}); }, 15000);
    await importLegacy();
    await pollLocal();
    await loadQuick();
  }
  await loadMeta(); D.ready = true;
  await render();
  if(D.local && (ST.tracked.length || ST.cur)){
    // 오늘 아직 조회하지 않은 추적 캐릭터는 열자마자 바로 조회 (몇 초)
    localApi('api/quick', {chars: ST.tracked.map(t => [t.w, t.n]).concat(ST.cur ? [[ST.cur.w, ST.cur.n]] : []), stale_only: true, save_list: false})
      .then(r => { localApi('api/tracked', {chars: ST.tracked.map(t => [t.w, t.n])}).catch(() => {}); return r; })
      .then(async r => { if(!r.skipped){ await loadQuick(); if(!busyUI()) render(); } }).catch(() => {});
  }
  // 30분마다 새 데이터 확인 (입력 중이면 건너뜀)
  setInterval(async () => {
    if(document.querySelector('dialog[open]') || document.querySelector('.m.editing') || document.activeElement?.tagName === 'INPUT') return;
    const old = D.meta?.generated; await loadMeta(); await loadQuick(); if(D.meta?.generated !== old) render();
  }, 30 * 60e3);
})();
