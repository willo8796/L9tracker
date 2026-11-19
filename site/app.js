'use strict';
/* 로드나인 캐릭터 추적기 — 웹 화면 (GitHub 웹 · 내 PC 프로그램 공용) */
const VERSION = '1.7.2';
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
function freshStore(){ return {v:1, tracked:[], mastery:{}, integ:{}, imported:false, expr:[], gnote:{}, memos:{}}; }
// v1.4.0: 캐릭터 메모 — 추적 중이면 tracked[].memo, 아니면 memos['월드|이름'] (추적 추가 · 해제 때 서로 옮김)
function memoGet(k){ const t = ST.tracked.find(x => key(x.w, x.n) === k); return t ? (t.memo || '') : ((ST.memos || {})[k] || ''); }
function memoSet(k, v){
  v = String(v || '').slice(0, 20000);
  const t = ST.tracked.find(x => key(x.w, x.n) === k);
  if(!ST.memos) ST.memos = {};
  if(t){ if(v.trim()) t.memo = v; else delete t.memo; delete ST.memos[k]; }
  else if(v.trim()) ST.memos[k] = v; else delete ST.memos[k];
}
function memoMoveOut(t){ if(t && t.memo && t.memo.trim()){ if(!ST.memos) ST.memos = {}; ST.memos[key(t.w, t.n)] = t.memo; } }
function memoBox(k, rows, label){
  const v = memoGet(k);
  return `<div class="tmemo-box"><label>${label || '메모'}</label><div class="memo-in"><textarea class="memo" maxlength="20000" data-memo="${esc(k)}" rows="${rows || 2}" placeholder="이 캐릭터에 대한 메모 (이 브라우저에만 저장 · Ctrl+Enter로 등록)">${esc(v)}</textarea>
    <div class="memo-bar"><span class="memo-st" data-memost="${esc(k)}">${v ? '등록됨' : ''}</span><button type="button" class="btn pri memo-save" data-act="memo-save" data-k="${esc(k)}">등록</button></div></div></div>`;
}
// v0.9.9: 즐겨찾기 기능 삭제 → 메모가 있던 즐겨찾기는 추적 캐릭터 메모로 옮김 (추적 안 하던 캐릭터는 추적에 추가)
function migrateFav(){
  const fs = ST.fav; if(!fs) return false;
  for(const f of fs){
    const memo = (f.memo || '').trim(); if(!memo) continue;
    let t = ST.tracked.find(x => x.w === f.w && x.n === f.n);
    if(!t){ t = {w: f.w, n: f.n, added: f.added || todayKST()}; ST.tracked.push(t); }
    if(!t.memo) t.memo = memo; else if(!t.memo.includes(memo)) t.memo += '\n' + memo;
  }
  delete ST.fav; return true;
}
// 저장값·백업 파일 검증 (v1.4.1): 허용된 키만, 형식이 맞는 항목만 복사 — 나머지는 버리고 개수를 돌려줌
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/, RE_AT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, RE_ID = /^[a-z0-9_-]{1,40}$/i, RE_MC = /^Mastery_[A-Za-z0-9]{1,40}$/;
const isObj = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const badKey = k => k === '__proto__' || k === 'constructor' || k === 'prototype';
const isInt = v => typeof v === 'number' && Number.isInteger(v);
const CTRL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const inR = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const LIM = {tracked: 5000, ev: 50, expr: 2000, gnote: 2000, integ: 500, mastery: 500, calib: 500};
function cleanStore(j){
  let drop = 0;
  const out = freshStore();
  if(!isObj(j)) return {st: out, drop: 1};
  out.imported = j.imported === true;
  const SUR_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;   // 짝 없는 서로게이트
  const okChar = t => isObj(t) && isInt(t.w) && t.w >= 0 && t.w <= 9999 && isStr(t.n, 40) && !t.n.includes('|') && !SUR_RE.test(t.n) && t.n.replace(CTRL_RE, '').trim() && (t.memo == null || typeof t.memo === 'string');
  for(const t of Array.isArray(j.tracked) ? j.tracked : []){
    if(!okChar(t)){ drop++; continue; }
    if(out.tracked.length >= LIM.tracked){ drop++; continue; }
    const o = {w: t.w, n: t.n.replace(CTRL_RE, '').trim(), added: isStr(t.added, 10) && RE_DATE.test(t.added) ? t.added : '', ev: []};
    if(t.memo) o.memo = t.memo.slice(0, 20000);   // 너무 길면 버리지 않고 값만 자름
    for(const e of Array.isArray(t.ev) ? t.ev.slice(-LIM.ev * 4) : []){
      if(isObj(e) && isStr(e.d, 10) && RE_DATE.test(e.d) && typeof e.kind === 'string' && typeof e.before === 'string' && typeof e.after === 'string') o.ev.push({d: e.d, kind: e.kind.slice(0, 30), before: e.before.slice(0, 80), after: e.after.slice(0, 80)}); else drop++;
    }
    o.ev = o.ev.slice(-LIM.ev);   // 이력은 최근 것부터 남김 (오래된 순으로 쌓임)
    out.tracked.push(o);
  }
  // 옛 버전의 즐겨찾기 (migrateFav 가 추적 메모로 옮김)
  if(Array.isArray(j.fav)) out.fav = j.fav.filter(f => okChar(f)).slice(0, LIM.tracked).map(f => ({w: f.w, n: f.n.replace(CTRL_RE, '').trim(), memo: (f.memo || '').slice(0, 20000), added: isStr(f.added, 10) && RE_DATE.test(f.added) ? f.added : ''}));
  if(isObj(j.mastery)) for(const [k, v] of Object.entries(j.mastery)){
    if(badKey(k) || k.length > 80 || !isObj(v) || Object.keys(out.mastery).length >= LIM.mastery){ drop++; continue; }
    const m = {};
    for(const [code, x] of Object.entries(v)){
      if(RE_MC.test(code) && isObj(x) && isInt(x.l) && x.l >= 0 && x.l <= 1000 && isStr(x.d, 10) && RE_DATE.test(x.d)) m[code] = {l: x.l, d: x.d}; else drop++;
    }
    out.mastery[k] = m;
  }
  if(isObj(j.integ)) for(const [k, v] of Object.entries(j.integ)){
    if(badKey(k) || k.length > 80 || !Array.isArray(v) || Object.keys(out.integ).length >= LIM.integ){ drop++; continue; }
    out.integ[k] = v.filter(x => { const ok = isObj(x) && isStr(x.d, 10) && RE_DATE.test(x.d) && inR(x.l, 0, 100000) && (x.p == null || inR(x.p, 0, 1000)); if(!ok) drop++; return ok; })
      .slice(-LIM.integ).map(x => ({d: x.d, l: x.l, p: x.p == null ? null : x.p}));
  }
  for(const r of Array.isArray(j.expr) ? j.expr : []){
    if(out.expr.length >= LIM.expr){ drop++; continue; }
    if(isObj(r) && typeof r.id === 'string' && RE_ID.test(r.id) && typeof r.place === 'string' && inR(r.exp, 0, 1e15) && inR(r.secs, 1, 1e7) && isStr(r.at, 19) && RE_AT.test(r.at))
      out.expr.push({id: r.id, place: r.place.slice(0, 100), exp: r.exp, secs: r.secs, at: r.at}); else drop++;
  }
  let gnTotal = 0;
  if(isObj(j.gnote)) for(const [k, v] of Object.entries(j.gnote)){
    if(badKey(k) || k.length > 80 || !Array.isArray(v) || gnTotal >= LIM.gnote){ drop++; continue; }
    out.gnote[k] = v.slice(0, LIM.gnote - gnTotal).filter(x => { const ok = isObj(x) && typeof x.id === 'string' && RE_ID.test(x.id) && typeof x.t === 'string' && isStr(x.at, 19); if(!ok) drop++; return ok; })
      .map(x => ({id: x.id, t: x.t.slice(0, 20000), at: x.at}));
    gnTotal += out.gnote[k].length;
  }
  if(isObj(j.memos)){
    let n = 0;
    for(const [k, v] of Object.entries(j.memos)){
      if(n >= LIM.tracked){ drop++; break; }
      if(typeof k !== 'string' || !/^\d{1,4}\|[^|\u0000-\u001f]{1,40}$/.test(k) || typeof v !== 'string' || SUR_RE.test(k)){ drop++; continue; }
      if(v.trim()){ out.memos[k] = v.slice(0, 20000); n++; }
    }
  }
  if(Array.isArray(j.calib)) out.calib = j.calib.filter(x => isObj(x) && isStr(x.k, 80) && inR(x.sum, 0, 11000) && inR(x.v, 0, 10000)).slice(0, LIM.calib).map(x => ({k: x.k, sum: x.sum, v: x.v}));
  if(isObj(j.lvc)){
    const w = {};
    if(isObj(j.lvc.w)) for(const [k, v] of Object.entries(j.lvc.w)) if(/^\d{1,2}[lp]$/.test(k) && (typeof v === 'string' || typeof v === 'number') && String(v).length <= 12) w[k] = String(v);
    out.lvc = {my: isStr(j.lvc.my, 40) ? j.lvc.my : '', op: isStr(j.lvc.op, 40) ? j.lvc.op : '', w, opw: isStr(j.lvc.opw, 200) ? j.lvc.opw : ''};
  }
  return {st: out, drop};
}
// 시작할 때 정리하면서 항목을 버렸으면: 정리 결과를 저장하기 전에 원본을 한 번 보관해 둠
let LOAD_NOTE = '';
function cleanLoaded(s, raw){
  const cl = cleanStore(s);
  if(cl.drop > 0){
    try{ if(localStorage.getItem(SKEY + '.bak') === null) localStorage.setItem(SKEY + '.bak', raw != null ? raw : JSON.stringify(s)); }catch(e){}
    LOAD_NOTE = `${cl.drop}개 항목을 정리했습니다 (원본은 ${SKEY}.bak 에 보관)`;
  }
  return cl.st;
}
function loadStore(){
  try{ const raw = localStorage.getItem(SKEY), s = JSON.parse(raw || 'null'); if(s && s.v === 1) return cleanLoaded(s, raw); }catch(e){}
  return freshStore();
}
let ST = loadStore(); migrateFav();
function memoSaveFrom(el){
  const box = el.closest('.memo-in'), ta = box?.querySelector('textarea[data-memo]'); if(!ta) return;
  const k = ta.dataset.memo; memoSet(k, ta.value); saveStore();
  const v = memoGet(k);
  document.querySelectorAll(`[data-memo="${CSS.escape(k)}"]`).forEach(x => { if(x !== ta) x.value = v; });
  document.querySelectorAll(`[data-memost="${CSS.escape(k)}"]`).forEach(x => { x.textContent = v ? '등록됨' : ''; x.classList.remove('dirty'); });
  toast(v ? '메모를 등록했습니다' : '메모를 지웠습니다');
}
document.addEventListener('keydown', e => { if((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target?.dataset?.memo){ e.preventDefault(); memoSaveFrom(e.target); } });
function persisted(){ const o = Object.assign({}, ST); delete o.cur; delete o.recent; return o; }
function saveStore(){
  try{ localStorage.setItem(SKEY, JSON.stringify(persisted())); }catch(e){ if(!SYNC.on) toast('브라우저에 저장하지 못했습니다 — [백업 저장]으로 보관하세요'); }
  if(SYNC.on){ clearTimeout(SYNC.t); SYNC.t = setTimeout(() => syncPush({store: persisted()}), 400); }
}
// 내 PC 프로그램: 기록을 프로그램 폴더(data\\store.json)에도 저장 — 창(브라우저)이 바뀌어도 그대로
const SYNC = {on: false, t: null, pt: null};
function syncPush(body){ fetch('api/store', {method:'POST', headers:{'Content-Type':'application/json', 'X-L9':'1'}, body: JSON.stringify(body)}).catch(() => {}); }
// 내 PC 프로그램과 주고받는 설정 키 (이 목록에 있는 것만)
const PREF_KEYS = ['l9trsel', 'l9trf', 'l9trtab', 'l9scope', 'l9rank', 'l9cgtab', 'l9toptab', 'l9bgmList', 'l9bgmVol', 'l9bgmMini', 'l9bgmShuf', 'l9bgmAuto', 'l9phos'];
function prefsNow(){ const o = {}; try{ for(const k of PREF_KEYS){ const v = localStorage.getItem(k); if(v !== null && v.length <= 2000) o[k] = v; } }catch(e){} return o; }
// 저장값은 믿지 않고 항목별로 형식·범위를 확인해서 복사: s=문자열(최대 길이) · n=정수(최소, 최대) · e=허용 값 목록
function lsJson(k, st){ try{ const v = JSON.parse((st || localStorage).getItem(k) || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }catch(e){ return {}; } }
function pickVals(src, spec, base){
  const o = Object.assign({}, base);
  for(const k of Object.keys(spec)){
    const [t, a, b] = spec[k], v = src[k];
    if(t === 's'){ if(typeof v === 'string' && v.length <= a) o[k] = v; }
    else if(t === 'n'){ if(typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b) o[k] = Math.trunc(v); }
    else if(t === 'e'){ if(a.includes(v)) o[k] = v; }
  }
  return o;
}
function lsEnum(k, ok, d){ const v = lsGet(k, d); return ok.includes(v) ? v : d; }
function lsGet(k, d){ try{ const v = localStorage.getItem(k); return v === null ? d : v; }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} if(SYNC.on){ clearTimeout(SYNC.pt); SYNC.pt = setTimeout(() => syncPush({prefs: prefsNow()}), 600); } }
const key = (w, n) => `${w}|${n}`;

/* ------------------------------------------------------------ 데이터 */
const D = {meta:null, worlds:{}, hist:{}, moves:null, local:null, gen:'', sortCache:{}, quick:null};
const CRC = (() => { const t = new Uint32Array(256); for(let i=0;i<256;i++){ let c=i; for(let k=0;k<8;k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i]=c>>>0; } return t; })();
function crc32(str){ const b = new TextEncoder().encode(str); let c = 0xFFFFFFFF; for(const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
/* ------------------------------------------------------------ 데이터 잠금 (v1.4.0)
   웹에 올린 데이터는 seal.py 로 암호화돼 있음 (data/key.json 이 있으면). 입장 화면(index.html)에서 비밀번호로 꺼낸
   데이터 키를 sessionStorage(또는 '로그인 유지' 때 localStorage)의 l9key 에 두고 여기서 파일을 풂.
   내 PC 프로그램 데이터는 암호화하지 않음 (key.json 없음). */
const SEAL = {on: false, key: null, kid: ''};
const SEAL_MAGIC = [76, 57, 69, 49];   // "L9E1"
function sealStored(){
  for(const st of [sessionStorage, localStorage]){
    try{ const v = JSON.parse(st.getItem('l9key') || 'null'); if(v && typeof v.k === 'string' && typeof v.kid === 'string') return v; }catch(e){}
  }
  return null;
}
function sealForget(){ for(const st of [sessionStorage, localStorage]){ try{ st.removeItem('l9key'); }catch(e){} } }
function sealGate(){ location.replace('index.html' + (/^#[a-z]{1,12}$/.test(location.hash) ? location.hash : '')); }
function b64bytes(s){ const b = atob(s), u = new Uint8Array(b.length); for(let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
async function sealInit(){
  let kj = null;
  try{ const r = await fetch('data/key.json?t=' + Date.now(), {cache: 'no-store'}); if(r.ok) kj = await r.json(); }catch(e){}
  if(!kj || typeof kj.kid !== 'string'){ SEAL.on = false; return true; }   // 잠기지 않은 데이터 (내 PC 등)
  SEAL.on = true; SEAL.kid = kj.kid;
  const v = sealStored();
  if(!v || v.kid !== kj.kid){ sealForget(); sealGate(); return false; }   // 비밀번호가 바뀌었거나 입장 전
  try{ SEAL.key = await crypto.subtle.importKey('raw', b64bytes(v.k), 'AES-GCM', false, ['decrypt']); }
  catch(e){ sealForget(); sealGate(); return false; }
  return true;
}
async function readData(r){
  const u = new Uint8Array(await r.arrayBuffer());
  if(u.length > 17 && SEAL_MAGIC.every((x, i) => u[i] === x)){
    if(!SEAL.key){ sealGate(); throw new Error('잠긴 데이터입니다'); }
    let plain;
    try{ plain = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: u.slice(5, 17), additionalData: new Uint8Array(SEAL_MAGIC)}, SEAL.key, u.slice(17))); }
    catch(e){ sealForget(); sealGate(); throw new Error('데이터를 풀지 못했습니다'); }
    if(u[4] & 1) plain = new Uint8Array(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    return JSON.parse(new TextDecoder().decode(plain));
  }
  return JSON.parse(new TextDecoder().decode(u));
}
async function getJSON(path){
  const r = await fetch(path + '?t=' + encodeURIComponent(D.gen || Date.now()), {cache:'no-cache'});
  if(!r.ok) throw new Error('데이터를 불러오지 못했습니다 (' + path + ' ' + r.status + ')');
  return readData(r);
}
async function loadMeta(){
  let m = null;
  try{ const r = await fetch('data/meta.json?t=' + Date.now(), {cache:'no-store'}); if(r.ok) m = await readData(r); }catch(e){}
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
const GROUP_RULE = {'구월드': '전투력 17만 이상', '신월드': '서버별 전투력 상위 500위'};
function ruleTxt(g){ return GROUP_RULE[g]; }
function critText(){ return (D.meta?.worlds || []).some(w => w.rule) ? `구월드 ${ruleTxt('구월드')} · 신월드 ${ruleTxt('신월드').replace('서버별 전투력 ', '서버별 ')} 기준` : '서버별 전투력 1,000위 안 캐릭터 기준'; }
const CRIT_SHORT = () => (D.meta?.worlds || []).some(w => w.rule) ? '수집 기준' : '서버 전투력 1,000위';
const readyWorlds = () => (D.meta?.worlds || []).filter(w => w.ready !== false && w.count > 0);
async function allWorlds(){ return Promise.all(readyWorlds().map(w => world(w.code))); }
async function loadQuick(){
  if(!D.local){ D.quick = null; return null; }
  try{ const r = await fetch('data/quick.json?t=' + Date.now(), {cache:'no-store'}); D.quick = r.ok ? await readData(r) : null; }catch(e){ D.quick = null; }
  return D.quick;
}
function histShard(i){
  if(!D.hist[i]) D.hist[i] = getJSON(`data/hist/${pad2(i)}.json`).catch(() => ({}));
  return D.hist[i];
}
async function histOf(k){ if(!D.meta) return null; const sh = await histShard(crc32(k) % (D.meta.shards || 64)); return sh[k] || null; }
async function moves(){ if(!D.moves) D.moves = getJSON('data/moves.json').then(trLegalMoves).catch(() => []); return D.moves; }
// v1.3.0: 수집기가 이전 기간 확인을 하기 전(2026-11-17 전)에 만든 연결 중 이전 기간 밖에 월드 · 서버가 바뀐 것은 따라가지 않음
function trLegalMoves(l){
  if(!Array.isArray(l)) return [];
  const W = trWins(null), since = dayNum('2026-11-17');
  return l.filter(m => {
    if(!m || m.d >= since || !['확실', '유력'].includes(m.lv) || !m.from || !m.to) return true;
    const fw = m.from[0], tw = m.to[0], fs = (m.fs || [0])[0], ts = (m.ts || [0])[0];
    if(fw !== tw) return !!trWinOf(W, 2, m.d - TR_GRACE, m.d, wName(fw), wName(tw));
    if(fs && ts && fs !== ts) return !!trWinOf(W, 3, m.d - TR_GRACE, m.d, wName(fw));
    return true;
  });
}

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
const INTEG_AUTO = true;    // v1.2.0: 계산식 확인 (통합레벨 계산기와 같은 방식)
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
      if(ST.cur && t !== ST.cur && ST.cur.w === t.w && ST.cur.n === t.n){ ST.cur.w = w; ST.cur.n = n; }
      t.w = w; t.n = n;
    }
  }
  saveStore(); saveSession();
  return notes;
}
// 유력 후보로 직접 바꾸기 (추적 · 메모 · 입력한 마스터리를 새 캐릭터로 옮김)
function applyMove(ow, on, w, n){
  ow = Number(ow); w = Number(w);
  const ok = key(ow, on), nk = key(w, n);
  const t = ST.tracked.find(x => x.w === ow && x.n === on);
  if(t && ST.tracked.some(x => key(x.w, x.n) === nk)) ST.tracked = ST.tracked.filter(x => x !== t);
  else if(t){ t.w = w; t.n = n; }
  if(ST.mastery[ok] && !ST.mastery[nk]){ ST.mastery[nk] = ST.mastery[ok]; delete ST.mastery[ok]; }
  if(ST.integ[ok] && !ST.integ[nk]){ ST.integ[nk] = ST.integ[ok]; delete ST.integ[ok]; }
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
    const est = allM ? (() => { const e = lvRange(masteryList().slice(0, 11).map(([code]) => ms[code].level), 3000); return e && {l: e.top[0], p: null, lo: e.min, hi: e.max, pr: e.top[1]}; })() : null;
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
  return `<div role="button" tabindex="0" class="m ${isEq ? 'eq' : ''} ${m ? '' : 'none'} ${old ? 'old' : ''}" data-act="medit" data-k="${esc(c.k)}" data-code="${esc(code)}"
      title="${esc(name)} — ${m ? esc(m.date + ' · ' + m.source) + ' · 클릭해서 수정' : '클릭해서 레벨 입력'}">
    ${isRep ? '<span class="tag">대표</span>' : ''}
    <div class="mt">${esc(name)}</div><div class="mv">${m ? esc(m.level) : '--'}</div><div class="hint">+ 입력</div>
    <div class="md">${m ? esc(m.date.slice(5)) : '&nbsp;'}</div><div class="mc">${esc(cap)}</div></div>`;
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
      ${trk ? `<button data-act="del" data-k="${esc(c.k)}">추적 해제</button>` : ''}
    </div>
    <div class="dots" title="검색됨 · 일별 기록 · 통합 레벨"><i class="${ok ? 'on' : ''}"></i><i class="${c.series.length ? 'on' : ''}"></i><i class="${it ? 'on' : ''}"></i></div>
  </div>`;
  h += memoBox(c.k, 2);
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
      <div class="blocks">${blocks}</div><div class="s">${useEst ? `마스터리 11종 레벨로 계산 · 경험치 % 모름 → ${c.est.lo === c.est.hi ? c.est.lo : c.est.lo + '~' + c.est.hi} 중 ${c.est.l} 가능성 ${Math.round(c.est.pr * 100)}%` : it ? esc(it.d) + ' 게임 화면 입력' : '마스터리 입력에서 기록하세요'}</div></div>
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
const BACKUP_NOTE = `<div class="note fr" style="margin-top:14px">추적 · 메모 · 직접 입력한 마스터리는 <b>이 브라우저</b>에 저장됩니다. 다른 기기로 옮기거나 보관하려면
     <button class="mini-btn" data-act="backup">백업 저장</button> <button class="mini-btn" data-act="restore">백업 불러오기</button></div>`;
// 검색한 캐릭터·최근 본 캐릭터는 이번 접속(탭) 동안만 기억 — 새로 접속하면 첫 화면은 비어 있음
// (추적 · 메모 · 경험치 기록은 그대로 저장)
function saveSession(){ try{ sessionStorage.setItem('l9session', JSON.stringify({cur: ST.cur || null, recent: ST.recent || []})); }catch(e){} }
function loadSession(){
  const x = lsJson('l9session', sessionStorage);
  const one = c => c && typeof c === 'object' && Number.isInteger(c.w) && c.w >= 0 && c.w <= 999999 && typeof c.n === 'string' && c.n && c.n.length <= 40 ? {w: c.w, n: c.n} : null;
  ST.cur = one(x.cur); ST.recent = Array.isArray(x.recent) ? x.recent.slice(0, 8).map(one).filter(Boolean) : [];
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
  return `<div class="recent fr">${rec.length ? `<span class="lbl">최근 본 캐릭터</span>${rec.map(x => `<button class="chip" data-act="setcur" data-w="${Number(x.w)}" data-n="${esc(x.n)}"><b>${esc(x.n)}</b> <small>${esc(wName(x.w))}</small></button>`).join('')}` : '<span class="lbl">검색한 캐릭터 1명이 표시됩니다</span>'}
      <button class="btn myreset" data-act="my-reset" title="표시 중인 캐릭터와 최근 본 캐릭터를 지웁니다 (추적 · 메모는 그대로)">화면 초기화</button></div>`
    + subject(CARDS[0], 0, 'main') + BACKUP_NOTE;
}
let TRSEL = lsGet('l9trsel', ''); if(TRSEL.length > 100) TRSEL = '';
// 목록의 [해제] 버튼이 [모두 해제] 버튼 가운데에 오도록 맞춤 (화면 폭이 달라도)
function alignTrBar(){
  const bar = document.querySelector('.trbar'), tbl = document.querySelector('.trk');
  if(!bar || !tbl) return;
  // 버튼 3개를 가장 넓은 버튼 너비로 통일
  const bs = [...bar.querySelectorAll('.btn')]; bs.forEach(x => x.style.width = '');
  const Z = window.L9_ZOOM || 1;   // 화면 비율(fit.js) — 화면 좌표를 CSS 크기로 바꿀 때 나눔
  const w = Math.max(...bs.map(x => x.offsetWidth)); bs.forEach(x => x.style.width = Math.ceil(w) + 'px');
  // 목록의 [해제] 버튼을 [모두 해제] 가운데로
  const btn = bar.querySelector('[data-act=tr-delall]'), row = tbl.querySelector('[data-act=del]');
  if(!btn || !row) return;
  const cell = row.closest('td'), cur = parseFloat(getComputedStyle(cell).paddingRight) || 0;
  const b = btn.getBoundingClientRect(), r = row.getBoundingClientRect();
  const diff = ((r.left + r.right) / 2 - (b.left + b.right) / 2) / Z;
  if(Math.abs(diff) > .5) tbl.style.setProperty('--delpad', Math.max(0, cur + diff) + 'px');
}
window.addEventListener('resize', () => alignTrBar());
const TRF = pickVals(lsJson('l9trf'), {q: ['s', 100], g: ['s', 100], w: ['n', 0, 999999], sort: ['e', ['add', 'bp', 'ml', 'sp', 'name', 'guild']], page: ['n', 0, 100000], gq: ['s', 100], gsort: ['e', ['n', 'avg', 'max', 'name']]}, {q: '', g: '', w: 0, sort: 'add'});   // 추적 목록 찾기 · 필터
function saveTRF(){ lsSet('l9trf', JSON.stringify(TRF)); }
const TRVIEW = {keys: []};   // 지금 화면에 보이는 (필터 적용된) 추적 캐릭터
let TRTAB = lsEnum('l9trtab', ['list', 'guild', 'ov', 'detail'], 'list');
if(!['list', 'guild', 'ov', 'detail'].includes(TRTAB)) TRTAB = 'list';
function setTrTab(v){ TRTAB = v; lsSet('l9trtab', v); }
// 길드별: 추적 캐릭터를 길드로 묶어 보기
function trGuildTab(gl){
  const q = (TRF.gq || '').trim();
  const groups = new Map();
  for(const c of CARDS){ const g = trGuild(c) || '-'; if(!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
  let rows = [...groups].map(([g, l]) => {
    const bps = l.map(c => (c.r ? c.r[C.bp] : c.last?.bp) || 0), mls = l.map(c => (c.r ? c.r[C.ml] : c.last?.ml) || 0).filter(Boolean);
    const ws = [...new Set(l.map(c => wName(c.t.w) + (c.r ? ' ' + serverLabel(c.r[C.s]) : '')))];
    return {g, l: l.slice().sort((a, b) => ((b.r ? b.r[C.bp] : b.last?.bp) || 0) - ((a.r ? a.r[C.bp] : a.last?.bp) || 0)), n: l.length,
      avg: bps.length ? Math.round(bps.reduce((a, b) => a + b, 0) / bps.length) : 0, max: Math.max(0, ...bps), ml: mls.length ? Math.round(mls.reduce((a, b) => a + b, 0) / mls.length) : 0, ws};
  });
  if(q) rows = rows.filter(x => (x.g === '-' ? '길드 없음' : x.g).includes(q) || x.l.some(c => c.t.n.includes(q)));
  const by = {n: (a, b) => b.n - a.n || b.avg - a.avg, avg: (a, b) => b.avg - a.avg, max: (a, b) => b.max - a.max, name: (a, b) => (a.g === '-' ? '힣' : a.g).localeCompare(b.g === '-' ? '힣' : b.g, 'ko')}[TRF.gsort || 'n'];
  rows.sort(by);
  return `<section class="ov fr">${NODES}<div class="bar"><span class="sid g">길드별 추적 캐릭터</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">${rows.length}개 길드 · 길드를 누르면 그 길드원만 목록에서 보기</span></div>
    <div class="ctrls"><input class="q" data-in="tr-gq" value="${esc(TRF.gq || '')}" placeholder="길드명 · 캐릭터명 찾기">
      <span class="lbl">정렬</span>${seg('tr-gsort', TRF.gsort || 'n', [['n', '인원'], ['avg', '평균 전투력'], ['max', '최고 전투력'], ['name', '길드명']])}</div>
    ${rows.length ? `<div class="trgl">${rows.map(x => `<div class="trg">
      <div class="trgh" data-act="tr-gopen" data-g="${esc(x.g)}"><div><b>${x.g === '-' ? '길드 없음' : esc(x.g)}</b><div class="sub">${esc(x.ws.slice(0, 2).join(', '))}${x.ws.length > 2 ? ` 외 ${x.ws.length - 2}` : ''}</div></div>
        <div class="trgs"><span><small>인원</small><b>${x.n}</b></span><span><small>평균 전투력</small><b>${nf(x.avg)}</b></span><span><small>최고</small><b>${nf(x.max)}</b></span><span class="hide-s"><small>평균 마스터리</small><b>${nf(x.ml)}</b></span></div></div>
      <div class="trgm">${x.l.slice(0, 12).map(c => `<button class="chip" data-act="trsel" data-k="${esc(c.k)}"><b>${esc(c.t.n)}</b> <small>${nf((c.r ? c.r[C.bp] : c.last?.bp) || 0)}</small></button>`).join('')}${x.l.length > 12 ? `<button class="chip" data-act="tr-gopen" data-g="${esc(x.g)}">+ ${x.l.length - 12}명 더 (목록에서 보기)</button>` : ''}</div></div>`).join('')}</div>`
      : '<div class="empty" style="padding:14px 16px">찾는 길드가 없습니다</div>'}</section>`;
}
function trGuild(c){ return c.r ? (c.r[C.g] || '') : (c.h?.g || ''); }
function trFilter(cards){
  const q = TRF.q.trim().toLowerCase();
  let v = cards.filter(c => (!TRF.w || c.t.w === TRF.w)
    && (!TRF.g || (TRF.g === '-' ? !trGuild(c) : trGuild(c) === TRF.g))
    && (!q || c.t.n.toLowerCase().includes(q) || trGuild(c).toLowerCase().includes(q) || (c.t.memo || '').toLowerCase().includes(q)));
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
  // 이전 세탁 의심 대상(이전 후 캐릭터)인 추적 캐릭터 표시
  const ldTo = new Map(); for(const x of ((await changes().catch(() => null))?.launder || [])) if(x?.to) { const t = x.now || x.to, kk = key(t.w, t.n), o = ldTo.get(kk); if(!o || x.d > o.d) ldTo.set(kk, x); }
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
  // 소메뉴: 목록 · 길드별 · 종합 현황 · 상세 (한 화면에 다 펼치지 않음)
  const TP = 20, pages = Math.max(1, Math.ceil(view.length / TP));
  TRF.page = Math.min(Math.max(0, TRF.page || 0), pages - 1);
  const pv = view.slice(TRF.page * TP, TRF.page * TP + TP);
  const selC = CARDS[sel];
  const tabs = `<div class="trtabs fr">${[['list', '캐릭터 목록', CARDS.length + '명'], ['guild', '길드별', (gl.length) + '개'], ['ov', '종합 현황', ''], ['detail', '상세', selC ? selC.t.n : '']].map(([v, l, n]) =>
    `<button class="${TRTAB === v ? 'on' : ''}" data-act="tr-tab" data-v="${v}">${l}${n ? `<small>${esc(n)}</small>` : ''}</button>`).join('')}</div>`;
  const list = `<section class="ov fr">${NODES}<div class="bar"><span class="sid g">추적 캐릭터 관리</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">${filtered ? `${view.length} / ${CARDS.length}명` : `${CARDS.length}명`} · 줄을 누르면 상세 화면으로</span></div>
    <div class="ctrls trf"><input class="q" data-in="tr-q" value="${esc(TRF.q)}" placeholder="캐릭터명 · 길드명 · 메모 찾기">
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
    ${pv.map((c, i) => { const r = c.r, lc = lastCh(c);
      return `<tr class="rkrow ${c === CARDS[sel] ? 'mine' : ''} ${TRCHK.has(c.k) ? 'chk' : ''}" data-act="trsel" data-k="${esc(c.k)}"><td class="chk"><button class="cb ${TRCHK.has(c.k) ? 'on' : ''}" data-act="tr-chk" data-k="${esc(c.k)}" title="선택">${TRCHK.has(c.k) ? '✓' : ''}</button></td><td class="no">${TRF.page * TP + i + 1}</td>
        <td class="l"><div class="nm">${esc(c.t.n)}</div><div class="sub">${esc(wName(c.t.w))} ${r ? serverLabel(r[C.s]) : ''}</div>${ldTo.has(c.k) ? `<div class="trld">${ldBadge(ldTo.get(c.k).level, '이전 · 세탁 의심 ')}</div>` : ''}${c.t.memo ? `<div class="trmemo" title="${esc(c.t.memo)}">메모 · ${esc(c.t.memo.split('\n')[0])}</div>` : ''}</td>
        <td class="hide-s l">${esc(r ? (r[C.g] || '-') : '--')}</td>
        <td>${r ? `<span class="big" style="font-size:19px">${nf(r[C.ml])}</span><div class="sub">${esc(mname(mcode(r[C.mc])))}</div>` : '--'}</td>
        <td><span class="big" style="font-size:19px">${nf(r ? r[C.bp] : c.last?.bp)}</span>${delta(c.last?.bp, c.prev?.bp)}</td>
        <td><span class="big" style="font-size:19px">${nf(r ? r[C.sp] : c.last?.sp)}</span>${delta(c.last?.sp, c.prev?.sp)}</td>
        <td class="hide-s">${r ? esc(jobName(r[C.j])) : '--'}</td>
        <td class="l">${lc ? `<span class="kt k-${esc(lc.kind.split(' ')[0])}">${esc(lc.kind)}</span> <span class="sub" style="display:inline">${esc(lc.d.slice(5))}</span>` : '<span class="sub">없음</span>'}</td>
        <td><button class="mini-btn" data-act="del" data-k="${esc(c.k)}">해제</button></td></tr>`; }).join('')}
    </table></div>
    ${pages > 1 ? `<div class="pager"><button class="btn" data-act="tr-page" data-p="0" ${TRF.page ? '' : 'disabled'}>처음</button><button class="btn" data-act="tr-page" data-p="${TRF.page - 1}" ${TRF.page ? '' : 'disabled'}>이전</button>
      <span class="pi">${TRF.page + 1} / ${pages} 쪽 · ${TRF.page * TP + 1}~${Math.min(view.length, TRF.page * TP + TP)}번째</span>
      <button class="btn" data-act="tr-page" data-p="${TRF.page + 1}" ${TRF.page < pages - 1 ? '' : 'disabled'}>다음</button><button class="btn" data-act="tr-page" data-p="${pages - 1}" ${TRF.page < pages - 1 ? '' : 'disabled'}>끝</button></div>` : ''}
    </section>`;
  let body = '';
  if(TRTAB === 'guild') body = trGuildTab(gl);
  else if(TRTAB === 'ov') body = overview();
  else if(TRTAB === 'detail'){
    const dl = view.length ? view : CARDS, di = Math.max(0, dl.indexOf(selC));
    const nav = `<div class="trdnav fr"><button class="btn" data-act="tr-step" data-k="${esc(dl[(di - 1 + dl.length) % dl.length].k)}" ${dl.length > 1 ? '' : 'disabled'}>◀ 이전</button>
      <select data-ch="tr-pick">${dl.map(c => `<option value="${esc(c.k)}" ${c === selC ? 'selected' : ''}>${esc(c.t.n)} · ${esc(wName(c.t.w))}${trGuild(c) ? ' · ' + esc(trGuild(c)) : ''}</option>`).join('')}</select>
      <button class="btn" data-act="tr-step" data-k="${esc(dl[(di + 1) % dl.length].k)}" ${dl.length > 1 ? '' : 'disabled'}>다음 ▶</button>
      <span class="sub">${di + 1} / ${dl.length}${dl === view && filtered ? ' (필터 적용)' : ''}</span></div>`;
    body = nav + subject(selC, sel, 'track');
  }
  else body = list;
  setTimeout(fillMissCands, 0); if(TRTAB === 'list') setTimeout(alignTrBar, 0);
  return tabs + body + BACKUP_NOTE;
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
  el.querySelector('.mv').innerHTML = `<input class="min" type="number" min="1" max="300" inputmode="numeric" value="${m ? esc(m.level) : ''}" aria-label="${esc(mname(code))} 레벨">`;
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
  document.querySelector(`.m[data-k="${CSS.escape(k)}"][data-code="${CSS.escape(code)}"]`)?.classList.add('flash');
  toast(`${k.split('|')[1]} · ${mname(code)} ${val} 저장했습니다`);
}

/* ============================================================ 범위 선택 (랭킹 · TOP 20 · 통계 공용) */
const SC = pickVals(lsJson('l9scope'), {scope: ['e', ['all', 'world', 'server']], w: ['n', 0, 999999], s: ['n', 0, 999999]}, {scope:'all', w:null, s:0});
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
    ${SC.scope !== 'all' ? `<select data-ch="sc-w">${ws.map(w => `<option value="${esc(w.code)}" ${w.code === SC.w ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>` : ''}
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
const RK = pickVals(lsJson('l9rank'), {by: ['e', ['ml', 'bp']], job: ['s', 40], q: ['s', 100], page: ['n', 0, 100000]}, {by:'ml', job:'', q:'', page:0});
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
    <td style="white-space:nowrap">      ${isTracked(r) ? '<span class="sub">추적 중</span>' : `<button class="mini-btn" data-act="track" data-w="${r[C.w]}" data-n="${esc(r[C.n])}">+ 추적</button>`}</td></tr>`;
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
function kv(k, v, cls = ''){ return `<div class="k">${k}</div><div class="v ${cls}">${v}</div>`; }
async function charDialog(w, n){
  w = Number(w);
  const got = await rowOf(w, n);
  if(!got){ toast(`${n}: 정보를 찾지 못했습니다`); return; }
  const r = got.r, tm = ST.tracked.find(t => t.w === w && t.n === n), tracked = !!tm;
  const html = `<div class="kv">
      ${kv('월드', esc(wName(w)) + ' ' + serverLabel(r[C.s]))}${kv('직업', esc(jobName(r[C.j])))}${kv('길드', (r[C.g] ? `<a class="glink" data-act="guildgo" data-w="${w}" data-s="${r[C.s]}" data-g="${esc(r[C.g])}" title="길드원 보기">${esc(r[C.g])}</a>` : '--'))}
      ${kv('대표 마스터리', `${esc(mname(mcode(r[C.mc])))} <b class="dg">${nf(r[C.ml])}</b>`)}
      ${kv('장착 무기', `${esc(mname(mcode(r[C.m1c])))} ${nf(r[C.m1l])} · ${esc(mname(mcode(r[C.m2c])))} ${nf(r[C.m2l])}`)}
      ${kv('마스터리 랭크', '#' + nf(r[C.mr]), 'dg')}${kv('전투력', nf(r[C.bp]), 'dg')}
      ${kv('전투력 순위', `월드 <b class="dg">#${nf(r[C.bwr])}</b> · 서버 <b class="dg">#${nf(r[C.bsr])}</b>`)}
      ${kv('업적점수', nf(r[C.ach]), 'dg')}${kv('전문화', nf(r[C.sp]), 'dg')}</div>
    <div style="margin:14px 0 0">${memoBox(key(w, n), 3)}</div>`;
  showDlg(`<b class="cname">${esc(n)}</b> <small>${esc(got.date || '')} 기준</small>`, html, [
    {id:'main', label:'캐릭터에서 보기', run:() => { $('#dlgAdd').open && $('#dlgAdd').close(); setCur(w, n); if(route() !== 'my') location.hash = '#my'; else render(); }},
    tracked ? {id:'go', label:'추적에서 보기', pri:true, run:() => { TRSEL = key(w, n); lsSet('l9trsel', TRSEL); setTrTab('detail'); location.hash = '#track'; }}
            : {id:'add', label:'+ 추적 추가', pri:true, run:() => { $('#dlgAdd').open && $('#dlgAdd').close(); track(w, n); }}], true);
}
function track(w, n){
  w = Number(w);
  if(ST.tracked.some(t => t.w === w && t.n === n)){ toast('이미 추적 중입니다'); return; }
  if(ST.tracked.length >= LIM.tracked){ toast(`추적은 최대 ${LIM.tracked}명까지입니다`); return; }
  const mk = key(w, n), mo = (ST.memos || {})[mk];
  ST.tracked.push(Object.assign({w, n, added: todayKST(), ev: []}, mo ? {memo: mo} : {})); if(mo) delete ST.memos[mk]; saveStore();
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
const GS = (() => { const x = pickVals(lsJson('l9guild', sessionStorage), {q: ['s', 100], sel: ['s', 200], per: ['e', [7, 30, 999]]}, {q: '', sel: null, per: 30}); if(x.sel && x.sel.split('|').length !== 3) x.sel = null; return x; })();
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
// 길드 코멘트 (ST.gnote — 이 브라우저에 저장, 백업 · 내 PC 동기화에 포함)
const GCD = {};   // 입력 중인 코멘트 (다시 그려도 유지)
function nowKST(){ return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); }
function guildComments(g){
  const l = ((ST.gnote || {})[g.k] || []).slice().reverse().sort((a, b) => a.at < b.at ? 1 : a.at > b.at ? -1 : 0);   // 같은 분이면 나중에 쓴 것 먼저
  return `<div class="sec">코멘트 <small>${nf(l.length)}개 · 최신 순 · 이 브라우저에만 저장됩니다 (다른 기기로 옮기려면 [캐릭터] · [추적] 아래 [백업 저장])</small></div>
    <div class="gcm"><div class="gcm-in"><textarea class="memo" maxlength="20000" id="gcmText" data-gk="${esc(g.k)}" rows="2" placeholder="이 길드에 대한 코멘트 입력 (Ctrl+Enter로 추가)">${esc(GCD[g.k] || '')}</textarea>
      <button class="btn pri" data-act="gc-add" data-k="${esc(g.k)}">코멘트 추가</button></div>
    ${l.length ? `<ul class="gcm-l">${l.map(c => `<li><div class="gcm-h"><span class="dg">${esc(c.at)}</span><button class="mini-btn" data-act="gc-del" data-k="${esc(g.k)}" data-id="${esc(c.id)}">삭제</button></div><div class="gcm-t">${esc(c.t)}</div></li>`).join('')}</ul>` : '<div class="empty gcm-e">아직 코멘트가 없습니다</div>'}</div>`;
}
function addGComment(k){
  const ta = $('#gcmText'), t = (ta?.value || '').trim();
  if(!t){ toast('코멘트를 입력하세요'); ta?.focus(); return false; }
  ST.gnote ||= {};
  (ST.gnote[k] ||= []).push({id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t, at: nowKST()});
  delete GCD[k]; saveStore(); return true;
}
// 길드원이 월드 · 서버를 옮겼거나 행방 불명인 경우 (변경 이력 data/changes.json 의 launder · gone)
const LDLV = {'높음': 3, '보통': 2, '낮음': 1};
function ldBadge(level, pre = '세탁 의심 '){ return level ? `<span class="ldb l${LDLV[level] || 1}">${esc(pre + level)}</span>` : ''; }
async function guildLaunder(g){
  const ch = await changes().catch(() => null);
  if(!ch) return '';
  // 같은 길드원이 유력 후보 여러 명으로 나오면 한 줄로 (확실 · 일치도 높은 것 우선) · 유력 후보가 있는 길드원은 행방 불명에서 뺌
  const best = new Map();
  for(const x of (ch.launder || []).filter(x => x.from && x.to && x.from.g === g.g && x.from.w === g.w && x.from.s === g.s)){
    const fk = key(x.from.w, x.from.n), o = best.get(fk);
    if(!o || (x.lv === '확실') > (o.lv === '확실') || (x.lv === o.lv && (x.score ?? 0) > (o.score ?? 0))) best.set(fk, Object.assign({}, x, {cands: (o?.cands || 0) + 1}));
    else o.cands = (o.cands || 1) + 1;
  }
  const mv = [...best.values()].sort((a, b) => b.d - a.d);
  const gone = (ch.gone || []).filter(x => x.g === g.g && x.w === g.w && x.s === g.s && !best.has(key(x.w, x.n))).sort((a, b) => b.last - a.last || (b.bp || 0) - (a.bp || 0));
  if(!mv.length && !gone.length) return '';
  const mvT = mv.length ? `<div class="tbl" style="margin:0;border:0"><table class="rk gmv gld"><tr><th>날짜</th><th class="l">이전 닉네임</th><th class="l">옮긴 곳</th><th>단계</th></tr>
    ${mv.map(x => `<tr class="${x.seen ? 'rkrow' : ''}" ${x.seen ? `data-act="char" data-w="${(x.now || x.to).w}" data-n="${esc((x.now || x.to).n)}"` : ''}><td class="dg" style="font-size:16px">${esc(dayStr(x.d).slice(5))}</td>
      <td class="l"><span class="nm">${esc(x.from.n)}</span></td>
      <td class="l"><b>${esc(x.to.n)}</b>${x.now && x.now.n !== x.to.n ? `<div class="sub">지금 이름 · <b>${esc(x.now.n)}</b></div>` : ''}<div class="sub">${esc(wName(x.to.w))} ${serverLabel(x.to.s)} · ${esc(x.to.g || '길드 없음')}</div></td>
      <td>${ldBadge(x.level, '')}${x.lv === '유력' ? `<div><span class="cfb c2">유력${x.cands > 1 ? ` · 후보 ${x.cands}명` : ''}</span></div>` : ''}</td></tr>`).join('')}</table></div>`
    : '<div class="empty" style="padding:12px 16px">옮긴 길드원 없음</div>';
  const goT = gone.length ? `<div class="tbl" style="margin:0;border:0"><table class="rk gmv gld"><tr><th>마지막 확인</th><th class="l">캐릭터</th><th>전투력</th><th>대표 마스터리</th></tr>
    ${gone.map(x => `<tr><td class="dg" style="font-size:16px">${esc(dayStr(x.last).slice(5))}</td><td class="l"><span class="nm">${esc(x.n)}</span><div class="sub">${esc(x.j || '')}</div></td>
      <td><span class="big" style="font-size:18px">${nf(x.bp)}</span></td><td><span class="big" style="font-size:18px">${nf(x.ml)}</span><div class="sub">${esc(mname(x.mc))}</div></td></tr>`).join('')}</table></div>`
    : '<div class="empty" style="padding:12px 16px">행방 불명 길드원 없음</div>';
  return `<div class="sec">최근 이전 · 행방 불명 길드원 <small>월드 · 서버를 옮겼거나 사라진 길드원 · 자세한 내용은 [변경 이력]</small></div>
    <div class="hpanels gpanels">
      <div class="hpanel ${mv.length ? 'has' : ''}"><div class="hp-h"><span>옮긴 길드원</span><b class="cnt">${mv.length}명</b></div>${mvT}</div>
      <div class="hpanel ${gone.length ? 'has' : ''}"><div class="hp-h"><span>행방 불명 길드원</span><b class="cnt">${gone.length}명</b></div>${goT}</div>
    </div>`;
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
        ${hits.slice(0, 100).map(g => `<tr class="rkrow ${g.k === GS.sel ? 'mine' : ''}" data-act="g-open" data-k="${esc(g.k)}"><td class="l"><span class="nm">${esc(g.g)}</span>${(ST.gnote?.[g.k] || []).length ? `<span class="cfb c3 gcb">코멘트 ${ST.gnote[g.k].length}</span>` : ''}</td>
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
    ${await guildLaunder(g)}
    ${guildComments(g)}
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
      <td class="act">
        ${isTracked(r) ? '<span class="sub">추적 중</span>' : `<button class="mini-btn" data-act="track" data-w="${r[C.w]}" data-n="${esc(r[C.n])}">+ 추적</button>`}</td></tr>`).join('')}
    </table></div></section>`;
  return h;
}

/* ============================================================ 변경 이력 */
const CG = (() => {
  const x = pickVals(lsJson('l9chg', sessionStorage), {per: ['n', 1, 9999], kind: ['n', -1, 99], w: ['n', 0, 999999], s: ['n', 0, 999999], q: ['s', 100], cf: ['n', 0, 99],
    sort: ['e', ['d', 'kind', 'name', 'world', 'server', 'bp', 'ml', 'sp']], dir: ['e', [1, -1]], ld: ['e', ['', '높음', '보통', '낮음']], lcf: ['n', 0, 99], mcf: ['n', 0, 99], mk: ['n', -1, 99],
    msort: ['e', ['d', 'bp']], gsort: ['e', ['d', 'bp']], gw: ['e', ['', '기준선 근처', '이전 기간', '닉변·삭제 추정']], ak: ['e', ['', '사라진 캐릭터', '다른 캐릭터의 예전 이름', '같은 월드 현재 캐릭터']]}, {});
  return Object.assign({per: 7, kind: -1, w: 0, s: 0, q: '', page: 0, mv: 24, cf: 0, sort: 'd', dir: -1, ld: '', lcf: 0, mcf: 0, mk: -1, msort: 'd', gsort: 'd', gw: '', ak: ''}, x, {page: 0, mv: 24, asm: 24, ldm: 24, gom: 50}); })();
function saveCG(){ try{ sessionStorage.setItem('l9chg', JSON.stringify({per: CG.per, kind: CG.kind, w: CG.w, s: CG.s, q: CG.q, cf: CG.cf, sort: CG.sort, dir: CG.dir, ld: CG.ld, lcf: CG.lcf, mcf: CG.mcf, mk: CG.mk, msort: CG.msort, gsort: CG.gsort, gw: CG.gw, ak: CG.ak})); }catch(e){} }
function cfBadge(c, n, sc){ return c === 1 ? '<span class="cfb c1" title="이 캐릭터로 확실히 이어 붙였습니다">확실</span>' : c === 2 ? `<span class="cfb c2" title="비슷한 캐릭터 — 확실하지 않아 이어 붙이지 않았습니다">유력${n > 1 ? ` · 후보 ${n}명` : ''}</span>` : ''; }
const CK = ['닉네임 변경', '길드 변경', '월드 이전', '서버 이전'];
async function changes(){ if(!D.chg) D.chg = getJSON('data/changes.json').then(trLegalize).catch(() => null); return D.chg; }
// v1.3.0: 월드/서버 이전은 공지된 이전 기간에만 가능. 수집기(v1.3.0~)가 만든 데이터에는 windows 가 들어 있고 이미 걸러져 있음.
// 예전 데이터(windows 없음)는 아래 확인된 일정으로 화면에서 거름. 일정 출처: 스토브 공지사항 '월드/서버 이전 사전 안내'
const TR_OLD3 = ['린드리스', '울란', '디엔'], TR_NEW2 = ['가르바나', '디나페리'];
const TR_SEED = [
  {s: '2026-11-25', e: '2026-11-28', world: TR_OLD3, server: TR_NEW2, id: '14630114'},
  {s: '2026-10-14', e: '2026-10-17', world: TR_OLD3, server: TR_NEW2, id: '14570860'},
  {s: '2026-09-02', e: '2026-09-05', world: TR_OLD3, server: TR_NEW2, id: '14438523'},
  {s: '2026-07-22', e: '2026-07-25', world: TR_OLD3, server: TR_NEW2, id: '13993310'},
  {s: '2026-06-10', e: '2026-06-13', world: TR_OLD3, server: TR_NEW2, id: '13525538'},
  {s: '2026-05-06', e: '2026-05-08', world: [], server: ['디나페리'], id: '13178687'}];
const TR_GRACE = 1;   // 날짜 하나만 아는 기록은 [날짜-1, 날짜]로 확인 → 기간 끝난 다음 날 수집분까지 인정 (수집기와 같음)
function dayNum(iso){ return Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(2024, 0, 1)) / 864e5); }
function trWins(ch){ return ((ch && ch.windows && ch.windows.length) ? ch.windows : TR_SEED).map(w => ({...w, sn: dayNum(w.s), en: dayNum(w.e)})); }
// 날짜 d0~d1 사이에 열린 이전 기간이 있고 대상이면 그 기간을 돌려줌. kind 2 월드 이전(wa→wb 이름), 3 서버 이전(wa 이름)
function trWinOf(W, kind, d0, d1, wa, wb){
  for(const w of W){ if(w.sn > d1 || w.en < d0) continue;
    if(kind === 2 ? (w.world.includes(wa) && (!wb || w.world.includes(wb))) : w.server.includes(wa)) return w; }
  return null;
}
// v1.4.3: 예전 수집 데이터의 행방 불명(why 없음)은 구월드 17만 기준으로 화면에서 정리 (수집기 v1.4.3~ 는 수집기가 함)
const OLD_LINE = 170000, OLD_WORLDS = ['울란', '디엔', '린드리스'];
function goneLegacy(ch){
  if(!ch || !Array.isArray(ch.gone) || ch.gone.some(x => x && x.why) || ch.gone_below != null) return ch;
  let below = 0;
  ch.gone = ch.gone.filter(x => {
    const old = OLD_WORLDS.includes(wName(x.w));
    if(old && (x.bp || 0) < OLD_LINE * 0.97){ below++; return false; }
    x.why = old && (x.bp || 0) < OLD_LINE * 1.03 ? '기준선 근처' : '닉변·삭제 추정';
    return true;
  });
  ch.gone_below = below; ch.gone_total = Math.max(0, (ch.gone_total || 0) - below);
  return ch;
}
function trLegalize(ch){
  goneLegacy(ch);
  if(!ch || ch.windows) return ch;      // 수집기가 이미 거른 데이터
  const W = trWins(null); let n = 0;
  const wn = v => typeof v === 'number' ? wName(v) : v;
  const ok = (kind, d, wa, wb) => !!trWinOf(W, kind, d - TR_GRACE, d, wn(wa), wb == null ? null : wn(wb));
  // 변경 목록: [날짜, 종류, 월드, 서버, 닉네임, 이전, 이후, ..., 확실도(12)] — 유력 월드 이전은 이전/이후 칸이 '월드 NN서버 · 이름' 형식
  const wOf = t => (String(t).match(/^(\S+)/) || [])[1] || '';
  const badDay = new Set();   // 기간 밖 월드 이전으로 이어 붙인 날 → 그날 같은 캐릭터의 닉네임 · 길드 · 서버 변경도 제외
  ch.list = (ch.list || []).filter(x => {
    let good = true;
    if(x[1] === 2) good = x[12] === 2 ? ok(2, x[0], wOf(x[5]), wOf(x[6])) : ok(2, x[0], x[5], x[6]);
    else if(x[1] === 3) good = ok(3, x[0], x[2]);
    if(!good){ n++; if(x[1] === 2 && x[12] !== 2) badDay.add(x[0] + '|' + x[2] + '|' + x[4]); }
    return good;
  });
  if(badDay.size){
    ch.list = ch.list.filter(x => !(x[12] !== 2 && badDay.has(x[0] + '|' + x[2] + '|' + x[4])) || (n++, false));
    ch.names = (ch.names || []).map(([w, nm, l, seen]) => [w, nm, l.filter(e => !badDay.has(e[0] + '|' + w + '|' + nm)), seen]).filter(x => x[2].length);
  }
  ch.moved = (ch.moved || []).map(m => {
    if(m.lv === '유력'){ const e = m.e[0]; return (e[1] === 2 ? ok(2, e[0], e[2], e[3]) : ok(3, e[0], m.w)) ? m : null; }
    const bd = new Set(m.e.filter(e => e[1] === 2 && !ok(2, e[0], e[2], e[3])).map(e => e[0]));
    const e = m.e.filter(e => !bd.has(e[0]) && (e[1] === 3 ? ok(3, e[0], m.w) : true));
    if(!e.some(e => e[1] >= 2)) return null;
    const last = Math.max(...e.filter(e => e[1] >= 2).map(e => e[0]));
    return {...m, e, last};
  }).filter(Boolean);
  ch.launder = (ch.launder || []).filter(x => !x || !x.from || !x.to ? false
    : x.from.w !== x.to.w ? ok(2, x.d, x.from.w, x.to.w) : ok(3, x.d, x.from.w));
  ch.illegal = n; ch.trLegacy = true;
  return ch;
}
// 평시 / 이전 기간 상태: 이전 기간(끝난 뒤 14일까지 — 사라졌다 나타난 캐릭터를 잇는 기간)이면 이전 · 세탁 의심, 평시엔 닉네임 변경 확인
const TR_LINK_DAYS = 14;
function trMode(ch){
  const W = trWins(ch), t = ch.date;
  const act = W.find(w => w.sn <= t && w.en >= t - TR_LINK_DAYS), next = W.filter(w => w.sn > t).sort((a, b) => a.sn - b.sn)[0];
  return {act, next, now: !!act && t <= act.en};
}
const STOVE = id => `https://page.onstove.com/l9/global/view/${encodeURIComponent(id)}`;
function trModeBar(ch){
  const {act, next, now} = trMode(ch), cal = ch.trinfo?.calendar;
  const lk = w => w.id ? ` <a href="${STOVE(w.id)}" target="_blank" rel="noopener">공지</a>` : '';
  const main = act ? `<span class="cfb c1">${now ? '이전 기간 진행 중' : '이전 기간 반영 중'}</span> ${trWinLabel(act)}${lk(act)} — 월드 · 서버 이전과 <b>세탁 의심</b>을 찾습니다${now ? '' : ' (기간 끝난 뒤 14일까지 늦게 나타난 캐릭터도 이어 붙임)'}`
    : `<span class="cfb c3">평시</span> 이전 기간이 아니라 <b>닉네임 변경</b>만 찾습니다 (월드 · 서버가 다른 캐릭터와는 잇지 않음)`;
  return `<div class="note trmode">${main}${next && next !== act ? ` · 다음 이전 기간 <b>${trWinLabel(next)}</b>${lk(next)}` : ''}${cal?.id ? ` · <a href="${STOVE(cal.id)}" target="_blank" rel="noopener">${esc(cal.t.replace(/\s*\(.*\)$/, ''))}</a>` : ''}</div>`;
}
function trWinLabel(w){ return `${w.s.slice(5).replace('-', '/')}~${w.e.slice(5).replace('-', '/')}`; }
function trWinNote(ch){
  const W = trWins(ch).slice(0, 4), today = ch.date;
  const row = w => `<div class="trwin ${w.sn <= today && today <= w.en ? 'now' : w.sn > today ? 'next' : ''}"><b>${trWinLabel(w)}</b>${w.sn > today ? ' <span class="cfb c2">예정</span>' : w.sn <= today && today <= w.en ? ' <span class="cfb c1">진행 중</span>' : ''}
    <span class="sub" style="display:inline">${w.world.length ? '월드 이전 ' + esc(w.world.join(' · ')) : ''}${w.world.length && w.server.length ? ' / ' : ''}${w.server.length ? '서버 이전 ' + esc(w.server.join(' · ')) : ''}</span>${lk(w)}</div>`;
  const lk = w => w.id ? ` <a href="${STOVE(w.id)}" target="_blank" rel="noopener">공지</a>` : '';
  return `<div class="note trwins"><b>월드 · 서버 이전은 공지된 이전 기간에만 가능</b>합니다. 이 기간(+다음 날 수집분)에 대상 월드 · 서버에서 옮긴 것만 이전으로 인정하고, 기간 밖에 월드 · 서버가 달라 보이는 경우는 같은 캐릭터로 잇지 않습니다 (같은 이름을 다른 캐릭터가 쓰게 된 경우 등).
    ${W.map(row).join('')}${ch.illegal ? `<div class="sub">이전 기간 밖이라 제외한 기록 ${nf(ch.illegal)}건</div>` : ''}</div>`;
}
// 세탁 의심 이유 (화면 문장)
function ldReasons(x, W){
  const r = [], f = x.from, t = x.to, wch = f.w !== t.w;
  const win = wch ? trWinOf(W, 2, x.d - 1, x.d, wName(f.w), wName(t.w)) : trWinOf(W, 3, x.d - 1, x.d, wName(f.w));
  const at = `${dayStr(x.d).slice(5)}${win ? ` (이전 기간 ${trWinLabel(win)})` : ''}`;
  r.push(wch ? `${at} <b>월드 이전</b> — ${esc(wName(f.w))} ${f.s ? serverLabel(f.s) : ''} → ${esc(wName(t.w))} ${t.s ? serverLabel(t.s) : ''}`
    : `${at} <b>서버 이전</b> — ${esc(wName(f.w))} ${serverLabel(f.s)} → ${serverLabel(t.s)}`);
  if(f.n !== t.n) r.push(`<b>닉네임 변경</b> — ${esc(f.n)} → ${esc(t.n)} (이전과 동시에 이름을 바꿔 찾기 어렵게 함)`);
  const fg = (f.g || '').trim(), tg = (t.g || '').trim();
  if(fg !== tg) r.push(`<b>길드 변경</b> — ${fg ? esc(fg) : '길드 없음'} → ${tg ? esc(tg) : '길드 없음'}`);
  if((x.flags || []).includes('의상 변경')) r.push('<b>의상 변경</b> — 이전 전후 겉모습(의상)이 다름');
  if((x.flags || []).includes('기준 밖에서 발견')) r.push('<b>수집 기준 밖에서 발견</b> — 옮긴 뒤 랭킹 기준 밖 자리에서 찾음 (눈에 덜 띄는 곳으로 옮김)');
  if(x.hops >= 2) r.push(`<b>반복</b> — 최근 45일 동안 이전 · 닉네임 변경을 ${nf(x.hops)}번 한 캐릭터`);
  if(x.now && (x.now.n !== t.n || x.now.w !== t.w)) r.push(`이후에도 다시 바뀜 — 지금 ${esc(wName(x.now.w))} · ${esc(x.now.n)}`);
  r.push(x.lv === '확실' ? '같은 캐릭터 판정: <b>확실</b> (업적점수 · 무기별 마스터리 · 전문화 · 전투력이 맞는 캐릭터가 한 명뿐이거나 점수 차이가 뚜렷함)'
    : `같은 캐릭터 판정: <b>유력</b>${x.nc > 1 ? ` (후보 ${nf(x.nc)}명` : ' ('}${x.score != null ? `${x.nc > 1 ? ' · ' : ''}일치도 ${esc(x.score)}%` : ''}) — 다른 캐릭터일 수 있음`);
  return r;
}

function ckBadge(k){ return `<span class="ckb ck${k}">${CK[k]}</span>`; }
function ckFromTo(k, a, b){
  const f = v => v ? esc(v) : '<span class="sub" style="display:inline">없음</span>';
  return `<span class="old">${f(a)}</span><span class="arrow">→</span><b>${f(b)}</b>`;
}
function chgTrackBtn(w, n, seen){
  if(!seen) return '<span class="sub">수집 기준 밖</span>';
  const t = ST.tracked.some(x => x.w === w && x.n === n);
  return (t ? '<span class="sub">추적 중</span>' : `<button class="mini-btn" data-act="track" data-w="${w}" data-n="${esc(n)}">+ 추적</button>`);
}
async function oldNameNote(q, ch, wf){
  const hits = [];
  for(const [w, n, l, seen] of ch.names || []) for(const e of l) if(e[1] && e[1].includes(q) && (!wf || w === wf)) hits.push({w, cur: n, old: e[1], d: e[0], seen});
  if(!hits.length) return '';
  hits.sort((a, b) => b.d - a.d);
  const out = [];
  for(const x of hits.slice(0, 8)){
    let holder = null;
    if(readyWorlds().some(v => v.code === x.w)){ const j = await world(x.w).catch(() => null); const r = j?.byName.get(x.old); if(r) holder = r; }
    out.push(`<div class="onr"><span><b class="hit">${esc(x.old)}</b> <span class="sub" style="display:inline">${esc(wName(x.w))}</span> 은(는) 예전 닉네임 → 지금 <a class="nmlink" ${x.seen ? `data-act="char" data-w="${x.w}" data-n="${esc(x.cur)}"` : ''}><b>${esc(x.cur)}</b></a> <span class="sub" style="display:inline">(${esc(dayStr(x.d).slice(5))} 변경)</span></span>
      ${holder ? `<span class="onr-o"><span class="cfb c2">주의</span> 지금 <b>${esc(x.old)}</b> 이름은 <b>다른 캐릭터</b>가 쓰는 중 · ${serverLabel(holder[C.s])} · ${esc(holder[C.g] || '길드 없음')} · ${esc(jobName(holder[C.j]))} · 전투력 ${nf(holder[C.bp])} <a class="nmlink" data-act="char" data-w="${x.w}" data-n="${esc(x.old)}">보기</a></span>`
        : `<span class="onr-o sub">지금 이 이름을 쓰는 캐릭터는 수집 기준 안에 없음</span>`}</div>`);
  }
  return `<div class="oldnote"><div class="sub">찾는 이름이 <b>다른 캐릭터의 예전 닉네임</b>이기도 합니다 — 같은 이름이라도 지금 그 이름을 쓰는 캐릭터와 다른 캐릭터일 수 있습니다</div>${out.join('')}</div>`;
}
// 이전 세탁 의심 · 행방 불명 (수집기가 만든 launder · gone — 예전 데이터에는 없음)
const LDFLAGS = ['월드 이전', '서버 이전', '닉네임 변경', '길드 변경', '의상 변경', '기준 밖에서 발견'];
function ldPlace(p, o){
  // o: 비교 대상 (이전 전) — 바뀐 부분 강조
  const hl = (on, v) => on ? `<mark class="ldc">${v}</mark>` : v;
  const ws = `${esc(wName(p.w))}`, sv = p.s ? serverLabel(p.s) : '';
  const g = p.g ? esc(p.g) : '<span class="sub" style="display:inline">길드 없음</span>';
  if(!o) return `${ws} ${sv} · <span class="old">${esc(p.n)}</span> · ${g}`;
  return `${hl(o.w !== p.w, ws)} ${hl(o.w !== p.w || o.s !== p.s, sv)} · ${hl(o.n !== p.n, `<b>${esc(p.n)}</b>`)} · ${hl((o.g || '') !== (p.g || ''), g)}`;
}
// v1.3.0: 변경 이력 소메뉴 — 변경 목록 · 이전 추적 · 세탁 의심 · 행방 불명 · 연관 추정 (한 화면에 다 펼치지 않음)
const CGTABS = [['list', '변경 목록'], ['moved', '이전 추적'], ['ld', '세탁 의심'], ['gone', '행방 불명'], ['assoc', '연관 추정']];
let CGTAB = lsGet('l9cgtab', 'list'); if(typeof CGTAB !== 'string') CGTAB = 'list';
if(!CGTABS.some(t => t[0] === CGTAB)) CGTAB = 'list';
function setCgTab(v){ CGTAB = v; lsSet('l9cgtab', v); }
function cgResetFilters(){ Object.assign(CG, {per: 7, kind: -1, w: 0, s: 0, q: '', cf: 0, ld: '', lcf: 0, mcf: 0, mk: -1, msort: 'd', gsort: 'd', gw: '', ak: ''}); cgResetMore(); saveCG(); }
function cgResetMore(){ CG.page = 0; CG.mv = 24; CG.asm = 24; CG.ldm = 24; CG.gom = 50; }
const cgNote = (html, open) => `<details class="note cgnote" ${open ? 'open' : ''}><summary>이 화면 설명</summary><div>${html}</div></details>`;
const cgMore = (act, n, unit) => n > 0 ? `<div class="pager"><button class="btn" data-act="${act}">더 보기 (${nf(n)}${unit} 남음)</button></div>` : '';
// 이전 세탁 의심 · 행방 불명 (수집기가 만든 launder · gone — 예전 데이터에는 없음)
function launderData(ch, {inP, inWS, q}){
  if(!Array.isArray(ch.launder) && !Array.isArray(ch.gone)) return null;   // 예전 수집 데이터
  const ok = x => x && x.from && x.to;
  let ld = (ch.launder || []).filter(x => ok(x) && inP(x.d) && (inWS(x.from.w, x.from.s) || inWS(x.to.w, x.to.s)));
  if(q) ld = ld.filter(x => [x.from.n, x.to.n, x.now?.n, x.from.g, x.to.g].some(v => (v || '').includes(q)));
  if(CG.lcf) ld = ld.filter(x => (x.lv === '확실' ? 1 : 2) === CG.lcf);
  const lc = {'높음': 0, '보통': 0, '낮음': 0}, seenFrom = new Set();
  for(const x of [...ld].sort((a, b) => (LDLV[b.level] || 0) - (LDLV[a.level] || 0))){ const fk = key(x.from.w, x.from.n) + '|' + x.d; if(seenFrom.has(fk)) continue; seenFrom.add(fk); if(x.level in lc) lc[x.level]++; }
  if(CG.ld) ld = ld.filter(x => x.level === CG.ld);
  ld.sort((a, b) => (LDLV[b.level] || 0) - (LDLV[a.level] || 0) || b.d - a.d || (b.score ?? -1) - (a.score ?? -1));
  let gone = (ch.gone || []).filter(x => (CG.per >= 999 || x.last >= ch.date - CG.per) && inWS(x.w, x.s));
  if(q) gone = gone.filter(x => (x.n || '').includes(q) || (x.g || '').includes(q));
  const gc = {'기준선 근처': 0, '이전 기간': 0, '닉변·삭제 추정': 0}; for(const x of gone) if(x.why in gc) gc[x.why]++;
  if(CG.gw) gone = gone.filter(x => x.why === CG.gw);
  gone.sort(CG.gsort === 'bp' ? (a, b) => (b.bp || 0) - (a.bp || 0) || b.last - a.last : (a, b) => b.last - a.last || (b.bp || 0) - (a.bp || 0));
  return {ld, lc, gone, gc};
}
function ldTab(L, perLbl, ch){
  if(!L) return '<div class="empty" style="padding:14px 16px">예전 수집 데이터에는 이전 세탁 의심 기록이 없습니다</div>';
  const {ld, lc} = L, W = trWins(ch);
  const stat = x => [['전투력', nf(x.bp)], ['대표 마스터리', x.mc ? `${esc(mname(x.mc))} ${nf(x.ml)}` : nf(x.ml)], ['전문화', nf(x.sp)], ['업적점수', nf(x.ach)]]
    .map(([l, v]) => `<span><small>${l}</small> <b class="dg">${v}</b></span>`).join('');
  const card = x => {
    const fl = (x.flags || []).filter(f => LDFLAGS.includes(f));
    return `<div class="mvcard ldcard lv${LDLV[x.level] || 1} ${x.seen ? 'rkrow' : ''} ${x.lv === '유력' ? 'lk2' : ''}" ${x.seen ? `data-act="char" data-w="${(x.now || x.to).w}" data-n="${esc((x.now || x.to).n)}"` : ''}>
      <div class="mvlv">${ldBadge(x.level)}${cfBadge(x.lv === '확실' ? 1 : 2, x.nc)}<span class="sub" style="display:inline"> ${esc(dayStr(x.d).slice(5))} 확인${x.score != null ? ` · 일치도 ${esc(x.score)}%` : ''}</span></div>
      <div class="ldft"><div class="ldr"><span class="ldk">이전 전</span><span class="ldv">${ldPlace(x.from)}</span></div>
        <div class="ldr"><span class="ldk">이전 후</span><span class="ldv">${ldPlace(x.to, x.from)}</span></div>
        ${x.now && (x.now.n !== x.to.n || x.now.w !== x.to.w) ? `<div class="ldr"><span class="ldk">지금</span><span class="ldv">${esc(wName(x.now.w))} · <b>${esc(x.now.n)}</b></span></div>` : ''}</div>
      <div class="ldwhy"><div class="sub">의심 이유 · ${ldBadge(x.level, '')} 단계</div><ul>${ldReasons(x, W).map(t => `<li>${t}</li>`).join('')}</ul></div>
      <div class="ldstat">${stat(x)}</div>
      <div class="mvf">${x.hops >= 2 ? `<span class="ldhop">이전 · 닉변 ${nf(x.hops)}회</span>` : ''}${chgTrackBtn((x.now || x.to).w, (x.now || x.to).n, x.seen)}</div></div>`;
  };
  const LVN = {'높음': '이전 + 닉네임 변경 + 길드나 의상까지 변경, 또는 최근 이전 · 닉네임 변경을 2번 이상', '보통': '이전 + 닉네임 변경', '낮음': '닉네임은 그대로 두고 이전 + 길드 변경'};
  return cgNote(`월드 · 서버를 옮기면서 <b>닉네임 · 길드 · 의상</b>을 바꾼 캐릭터입니다. 단계는 함께 바꾼 정도입니다.
      ${Object.entries(LVN).map(([l, t]) => `<div class="ldn">${ldBadge(l, '')} ${t}</div>`).join('')}
      <b class="cfb c1">확실</b> <b class="cfb c2">유력</b>은 이전 전후가 <b>같은 캐릭터라는 판정</b>의 확실도입니다 (유력: 후보가 여럿이거나 일부 값이 다름). 이전 전 또는 이전 후의 월드 · 서버가 위 필터에 맞으면 표시합니다.`)
    + trWinNote(ch) + `<div class="kpis ldk3">${Object.keys(lc).map(l => `<div class="kpi"><div class="lb">${ldBadge(l)} (명)</div><div class="v">${nf(lc[l])}</div><div class="s">${esc(perLbl)}${CG.w ? ' · ' + esc(wName(CG.w)) : ''}</div></div>`).join('')}</div>
    <div class="ctrls"><span class="lbl">단계</span>${seg('cg-ld', CG.ld, [['', '전체'], ['높음', '높음'], ['보통', '보통'], ['낮음', '낮음']])}
      <span class="lbl">확실도</span>${seg('cg-lcf', CG.lcf, [[0, '전체'], [1, '확실'], [2, '유력']])}</div>
    <div class="sec">세탁 의심 목록 <small>${nf(ld.length)}명 · 단계 높은 순 · 카드를 누르면 캐릭터 정보</small></div>
    ${ld.length ? `<div class="mvgrid ldgrid">${ld.slice(0, CG.ldm).map(card).join('')}</div>${cgMore('cg-ldmore', ld.length - CG.ldm, '명')}`
      : '<div class="empty" style="padding:14px 16px">조건에 맞는 이전 세탁 의심 캐릭터가 없습니다</div>'}`;
}
function goneTab(L, ch){
  if(!L) return '<div class="empty" style="padding:14px 16px">예전 수집 데이터에는 행방 불명 기록이 없습니다</div>';
  const {gone, gc} = L;
  const WHY = {'기준선 근처': 'c2', '이전 기간': 'c1', '닉변·삭제 추정': 'c3'};
  return cgNote(`공식 사이트 목록(서버별 전투력 1,000위까지)에서 <b>이름이 사라졌는데 아직 이어 붙일 캐릭터를 찾지 못한</b> 캐릭터입니다. 사라진 뒤 <b>14일 동안</b> 같은 캐릭터를 계속 찾습니다.<br>
      마지막 전투력이 <b>수집 기준 아래</b>(구월드 17만 · 신월드 서버 500위 컷의 97% 미만)였던 캐릭터는 매크로 · 저레벨 정리일 가능성이 커서 목록에서 뺐습니다${ch.gone_below ? ` (${nf(ch.gone_below)}명)` : ''}.<br>
      <b class="cfb c2">기준선 근처</b> 1,000위 밖으로 밀려났을 수 있음 &nbsp; <b class="cfb c1">이전 기간</b> 이전 기간 중이라 옮긴 캐릭터일 수 있음 &nbsp; <b class="cfb c3">닉변·삭제 추정</b> 기준보다 충분히 높았는데 사라짐 — 닉네임을 바꿨거나 캐릭터를 지운 경우`)
    + `<div class="ctrls"><span class="lbl">이유</span>${seg('cg-gw', CG.gw, [['', '전체'], ...Object.keys(gc).map(k => [k, `${k} ${nf(gc[k])}`])])}
      <span class="lbl">정렬</span>${seg('cg-gsort', CG.gsort, [['d', '마지막 확인 최근 순'], ['bp', '전투력 높은 순']])}</div>
    <div class="sec">행방 불명 목록 <small>${nf(gone.length)}명${ch.gone_total > (ch.gone || []).length ? ` · 전체 ${nf(ch.gone_total)}명 중 최근 ${nf((ch.gone || []).length)}명만 보관` : ''}</small></div>
    ${gone.length ? `<div class="tbl" style="margin:0;border:0"><table class="rk gone"><tr><th>마지막 확인</th><th>이유</th><th class="l">캐릭터</th><th class="cgws">월드</th><th class="cgws">서버</th><th class="l hide-s">길드</th><th class="hide-s">직업</th><th>전투력</th><th>대표 마스터리</th><th>전문화</th></tr>
      ${gone.slice(0, CG.gom).map(x => `<tr><td class="dg" style="font-size:16px">${esc(dayStr(x.last).slice(5))}</td><td>${x.why ? `<span class="cfb ${WHY[x.why] || 'c3'}">${esc(x.why)}</span>` : '<span class="sub">-</span>'}</td>
        <td class="l"><div class="nm">${esc(x.n)}${x.sw ? ' <small class="sub" style="display:inline" title="계정 매매 · 닉네임 맞바꾸기 등으로 지금 이 이름은 다른 캐릭터가 씀">(이름 넘겨줌)</small>' : ''}</div><div class="sub msub">${esc(wName(x.w))} ${serverLabel(x.s)}${x.g ? ' · ' + esc(x.g) : ''}</div></td>
        <td class="cgws">${esc(wName(x.w))}</td><td class="cgws dg" style="font-size:16px">${x.s ? pad2(x.s) : '--'}</td>
        <td class="l hide-s">${x.g ? esc(x.g) : '<span class="sub">-</span>'}</td><td class="hide-s">${esc(x.j || '--')}</td>
        <td><span class="big" style="font-size:18px">${nf(x.bp)}</span></td><td><span class="dg" style="font-size:17px">${nf(x.ml)}</span><div class="sub">${esc(mname(x.mc))}</div></td>
        <td><span class="dg" style="font-size:17px">${nf(x.sp)}</span></td></tr>`).join('')}</table></div>${cgMore('cg-gomore', gone.length - CG.gom, '명')}`
      : '<div class="empty" style="padding:14px 16px">조건에 맞는 행방 불명 캐릭터가 없습니다</div>'}`;
}
function assocTab(as){
  const AK = [['', '전체'], ['사라진 캐릭터', '사라진 캐릭터'], ['다른 캐릭터의 예전 이름', '예전 이름'], ['같은 월드 현재 캐릭터', '현재 캐릭터']];
  return cgNote(`닉네임을 바꾼 캐릭터의 <b>새 이름</b>이 다른 캐릭터의 이름과 비슷한 경우입니다. 예를 들어 A가 B 캐릭터를 사서 A와 관련된 이름(원래 이름, 번호만 붙인 이름 등)으로 바꾼 경우를 찾습니다.
      비교 대상: 최근 30일 안에 <b>사라진 캐릭터</b> · 다른 캐릭터가 <b>예전에 쓰던 이름</b> · 같은 월드의 <b>현재 캐릭터</b>(3글자 이상).
      <b>이름만 비교한 것이라 같은 사람이라는 근거가 되지 않습니다. 참고용으로만 보세요.</b>`, true)
    + `<div class="ctrls"><span class="lbl">비교 대상</span>${seg('cg-ak', CG.ak, AK)}</div>
    <div class="sec">연관 추정 목록 <small>${nf(as.length)}건 · 참고용</small></div>
    ${as.length ? `<div class="asgrid">${as.slice(0, CG.asm).map(a => `<div class="ascard">
        <div class="ash ${a.seen ? 'rkrow' : ''}" ${a.seen ? `data-act="char" data-w="${a.w}" data-n="${esc(a.n)}"` : ''}><div><span class="sub" style="display:inline">${esc(dayStr(a.d).slice(5))} 닉네임 변경</span>
          <div class="nh"><span class="old">${esc(a.old)}</span><span class="arrow">→</span><b>${esc(a.n)}</b></div>
          <div class="sub">${esc(wName(a.w))} ${serverLabel(a.s)} · ${esc(a.g || '길드 없음')}</div></div>
          <div class="mvr"><span class="big" style="font-size:18px">${nf(a.bp)}</span><div class="sub">전투력</div></div></div>
        <div class="asrel"><div class="sub">비슷한 이름</div>${a.rel.map(r => `<div class="asr"><span class="cfb c3">${esc(r.why)}</span>
          <b>${esc(r.n)}</b> <span class="sub" style="display:inline">${esc(r.kind)}${r.now ? ` (지금 이름: ${esc(r.now)})` : ''} · ${esc(wName(r.w))} ${r.s ? serverLabel(r.s) : ''}${r.g ? ' · ' + esc(r.g) : ''}${r.kind === '사라진 캐릭터' ? ` · 마지막 ${esc(dayStr(r.d).slice(5))}` : ''}${r.bp ? ' · ' + nf(r.bp) : ''}</span></div>`).join('')}</div></div>`).join('')}</div>${cgMore('cg-asmore', as.length - CG.asm, '건')}`
      : '<div class="empty" style="padding:14px 16px">조건에 맞는 연관 추정 닉네임 변경이 없습니다</div>'}`;
}
function movedTab(mv, ch){
  return cgNote(`월드나 서버를 옮긴 캐릭터를 자동으로 따라가서, 옮긴 뒤 <b>닉네임과 길드가 어떻게 바뀌었는지</b> 순서대로 보여줍니다. 별도로 등록할 필요 없이 이전이 확인되면 자동으로 이 목록에 들어옵니다.<br>
      <b class="cfb c1">확실</b> 업적점수 · 무기별 마스터리 · 전문화 · 전투력이 맞는 캐릭터가 한 명뿐(또는 점수 차이가 뚜렷함)이라 같은 캐릭터로 이어 붙임 (직업 · 무기는 자유롭게 바꿀 수 있어 보지 않음) &nbsp;
      <b class="cfb c2">유력</b> 비슷하지만 후보가 여럿이거나 일부 값이 달라 단정할 수 없음 (추적은 자동으로 옮기지 않고, [추적]에서 직접 바꿀 수 있음)`)
    + trWinNote(ch) + `<div class="ctrls"><span class="lbl">이전 종류</span>${seg('cg-mk', CG.mk, [[-1, '전체'], [2, '월드 이전'], [3, '서버 이전']])}
      <span class="lbl">확실도</span>${seg('cg-mcf', CG.mcf, [[0, '전체'], [1, '확실'], [2, '유력']])}
      <span class="lbl">정렬</span>${seg('cg-msort', CG.msort, [['d', '최근 순'], ['bp', '전투력 순']])}</div>
    <div class="sec">이전 캐릭터 목록 <small>${nf(mv.length)}명 · 카드를 누르면 캐릭터 정보</small></div>
    ${mv.length ? `<div class="mvgrid">${mv.slice(0, CG.mv).map(m => {
      const ev = m.e.slice().sort((a, b) => a[0] - b[0] || (b[1] >= 2) - (a[1] >= 2) || a[1] - b[1]);
      return `<div class="mvcard ${m.seen ? 'rkrow' : ''} ${m.lv === '유력' ? 'lk2' : ''}" ${m.seen ? `data-act="char" data-w="${m.w}" data-n="${esc(m.n)}"` : ''}>
        <div class="mvlv">${m.lv === '유력' ? `<span class="cfb c2">유력${m.nc > 1 ? ` · 후보 ${m.nc}명` : ''}</span><span class="sub" style="display:inline"> 일치도 ${m.score}% · 확실하지 않아 이어 붙이지 않음</span>` : '<span class="cfb c1">확실</span><span class="sub" style="display:inline"> 같은 캐릭터로 이어 붙임</span>'}</div>
        ${m.lv === '유력' && m.from ? `<div class="sub">이전 전: ${esc(wName(m.from[0]))} ${m.from[2] ? serverLabel(m.from[2]) : ''} · <b>${esc(m.from[1])}</b> · ${esc(m.from[3] || '길드 없음')}</div>` : ''}
        <div class="mvh"><div><div class="nm">${esc(m.n)}</div><div class="sub">${esc(wName(m.w))} ${serverLabel(m.s)} · ${m.g ? esc(m.g) : '길드 없음'}</div></div>
          <div class="mvr"><span class="big" style="font-size:20px">${nf(m.bp)}</span><div class="sub">전투력</div></div></div>
        <ol class="tl">${ev.map(e => `<li><span class="dg">${esc(dayStr(e[0]).slice(5))}</span>${ckBadge(e[1])}<span class="nh">${ckFromTo(e[1], e[2], e[3])}</span></li>`).join('')}</ol>
        <div class="mvf">${chgTrackBtn(m.w, m.n, m.seen)}</div></div>`; }).join('')}</div>${cgMore('cg-more', mv.length - CG.mv, '명')}`
      : '<div class="empty" style="padding:14px 16px">조건에 맞는 월드 · 서버 이전 캐릭터가 없습니다</div>'}`;
}
const CGSORT = [['d', '날짜'], ['kind', '종류'], ['name', '캐릭터명'], ['world', '월드'], ['server', '서버'], ['bp', '전투력'], ['ml', '대표 마스터리'], ['sp', '전문화']];
const CGDIR0 = {d: -1, kind: 1, name: 1, world: 1, server: 1, bp: -1, ml: -1, sp: -1};   // 처음 고를 때 방향
async function pageChg(){
  if(!readyWorlds().length) return noData();
  const ch = await changes();
  if(!ch) return `<section class="ov fr">${NODES}<div class="bar"><span class="sid g">변경 이력</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">기준일 ${esc(D.meta.date)} · ${critText()}</span></div>
    <div class="note">변경 이력은 v0.9.0 이후 첫 자동 수집부터 기록됩니다. 전날 수집 결과와 비교하므로 이틀 이상 수집되면 표시됩니다.</div></section>`;
  const today = ch.date, per = CG.per;
  const amap = new Map((ch.assoc || []).map(a => [a.d + '|' + key(a.w, a.n), a]));
  const th = (k, l, cls = '') => `<th class="${cls} sortable ${CG.sort === k ? 'on' : ''}" data-act="cg-sorth" data-v="${k}" title="눌러서 정렬">${l}${CG.sort === k ? (CG.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`;
  const assocOf = x => x[1] === 0 ? amap.get(x[0] + '|' + key(x[2], x[4])) : null;
  const inP = d => per >= 999 || d > today - per;
  const q = CG.q.trim();
  const ws = readyWorlds(), svs = CG.w ? (ws.find(w => w.code === CG.w)?.servers || []) : [];
  if(!svs.includes(CG.s)) CG.s = 0;
  const inWS = (w, sv) => (!CG.w || w === CG.w) && (!CG.s || sv === CG.s);
  // 이전 닉네임: 캐릭터(월드|현재 닉네임) → 예전 닉네임들
  const olds = new Map(); for(const [w, n, l] of ch.names || []) olds.set(key(w, n), l);
  const oldNames = (w, n) => (olds.get(key(w, n)) || []).map(e => e[1]).filter(Boolean);
  const qm = x => { const o = oldNames(x[2], x[4]); return x[4].includes(q) || String(x[5]).includes(q) || String(x[6]).includes(q) || (x[7] || '').includes(q) || o.some(v => v.includes(q)); };
  const perLbl = per === 1 ? '최근 수집일' : per >= 999 ? `전체 (최근 ${ch.days}일)` : `최근 ${per}일`;
  // --- 소메뉴마다 목록 (건수를 소메뉴에 같이 보여주려고 먼저 계산) ---
  const base = ch.list.filter(x => inP(x[0]) && inWS(x[2], x[3]));
  const cnt = [0, 0, 0, 0]; let lk = 0; for(const x of base){ if(x[12] === 2) lk++; else cnt[x[1]]++; }
  let view = base.filter(x => (CG.kind < 0 || x[1] === CG.kind) && (!CG.cf || x[12] === CG.cf));
  if(q) view = view.filter(qm);
  let mv = (ch.moved || []).filter(m => inP(m.last) && ((inWS(m.w, m.s)) || (!CG.s && m.e.some(e => e[1] === 2 && (e[2] === wName(CG.w) || e[3] === wName(CG.w))))));
  if(q) mv = mv.filter(m => m.n.includes(q) || (m.g || '').includes(q) || m.e.some(e => String(e[2]).includes(q) || String(e[3]).includes(q)) || oldNames(m.w, m.n).some(v => v.includes(q)));
  if(CG.mk >= 2) mv = mv.filter(m => m.e.some(e => e[1] === CG.mk));
  if(CG.mcf) mv = mv.filter(m => (m.lv === '유력' ? 2 : 1) === CG.mcf);
  mv = mv.slice().sort(CG.msort === 'bp' ? (a, b) => (b.bp || 0) - (a.bp || 0) : (a, b) => (b.last || 0) - (a.last || 0) || (b.bp || 0) - (a.bp || 0));
  let as = (ch.assoc || []).filter(a => inP(a.d) && (inWS(a.w, a.s) || a.rel.some(r => inWS(r.w, r.s))));
  if(q) as = as.filter(a => a.n.includes(q) || a.old.includes(q) || (a.g || '').includes(q) || a.rel.some(r => r.n.includes(q) || (r.now || '').includes(q) || (r.g || '').includes(q)));
  if(CG.ak) as = as.map(a => ({...a, rel: a.rel.filter(r => r.kind === CG.ak)})).filter(a => a.rel.length);
  const L = launderData(ch, {inP, inWS, q});
  const N = {list: view.length, moved: mv.length, ld: L ? L.ld.length : null, gone: L ? L.gone.length : null, assoc: as.length};
  const tabs = `<div class="trtabs cgtabs fr">${CGTABS.map(([v, l]) =>
    `<button class="${CGTAB === v ? 'on' : ''}" data-act="cg-tab" data-v="${v}">${l}<small>${N[v] == null ? '-' : nf(N[v]) + (v === 'list' || v === 'assoc' ? '건' : '명')}</small></button>`).join('')}</div>`;
  const dirty = per !== 7 || CG.w || CG.q || CG.kind >= 0 || CG.cf || CG.ld || CG.lcf || CG.mcf || CG.mk >= 0 || CG.ak || CG.gw;
  const head = `<div class="bar"><span class="sid g">변경 이력 · ${esc((CGTABS.find(t => t[0] === CGTAB) || CGTABS[0])[1])}</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">기준일 ${esc(D.meta.date)} · ${critText()}</span></div>
    <div class="ctrls cgcom"><span class="lbl">기간</span>${seg('cg-per', per, [[1, '최근 수집일'], [7, '7일'], [30, '30일'], [999, '전체']])}
      <span class="lbl">월드</span><select data-ch="cg-w"><option value="0">전체</option>${ws.map(w => `<option value="${esc(w.code)}" ${w.code === CG.w ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
      <span class="lbl">서버</span><select data-ch="cg-s" ${CG.w ? '' : 'disabled title="월드를 먼저 고르세요"'}><option value="0">전체</option>${svs.map(v => `<option value="${v}" ${v === CG.s ? 'selected' : ''}>${serverLabel(v)}</option>`).join('')}</select>
      <span class="sp"></span><input class="q" data-in="cg-q" value="${esc(CG.q)}" placeholder="닉네임(이전 닉네임 포함) · 길드 찾기">
      ${dirty ? '<button class="btn" data-act="cg-reset" title="모든 소메뉴의 필터를 처음 상태로">필터 초기화</button>' : ''}</div>`;
  let body = '';
  if(CGTAB === 'moved') body = movedTab(mv, ch);
  else if(CGTAB === 'ld') body = ldTab(L, perLbl, ch);
  else if(CGTAB === 'gone') body = goneTab(L, ch);
  else if(CGTAB === 'assoc') body = assocTab(as);
  else {
    // 예전 수집기로 만든 기록에는 전문화 · 업적점수가 없어서 지금 수집 데이터로 채움
    if(view.some(x => x[15] === undefined)){
      const rows = new Map(); for(const j of await allWorlds()) for(const r of j.rows) rows.set(key(r[C.w], r[C.n]), r);
      for(const x of ch.list){ if(x[15] !== undefined) continue; const r = rows.get(key(x[2], x[4])); x[15] = r ? r[C.sp] : null; x[16] = r ? r[C.ach] : null; if(r && x[9] == null){ x[9] = r[C.ml]; x[10] = mcode(r[C.mc]); } }
    }
    const SV = {d: x => x[0], kind: x => x[1], name: x => x[4], world: x => wName(x[2]), server: x => x[3] || 0, bp: x => x[8], ml: x => x[9], sp: x => x[15]};
    const sv = SV[CG.sort] || SV.d, dir = CG.dir || -1;
    view = view.map((x, i) => [x, i]).sort(([a, i], [b, j]) => {
      const va = sv(a), vb = sv(b);
      if(va == null && vb == null) return i - j; if(va == null) return 1; if(vb == null) return -1;
      const c = typeof va === 'string' ? va.localeCompare(vb, 'ko') : va - vb;
      return c ? c * dir : (b[0] - a[0]) || i - j;
    }).map(([x]) => x);
    const pages = Math.max(1, Math.ceil(view.length / PAGE)); CG.page = Math.min(CG.page, pages - 1);
    const slice = view.slice(CG.page * PAGE, CG.page * PAGE + PAGE);
    body = cgNote(`매일 자동 수집 때 <b>전날 수집 결과와 비교</b>해 닉네임 · 길드 · 월드 · 서버가 바뀐 캐릭터를 바로 기록합니다. 공식 사이트가 하루 한 번(10~12시) 갱신되므로 하루 단위로 쌓입니다.
      닉네임을 바꾸거나 월드를 옮긴 캐릭터는 업적점수 · 무기별 마스터리 · 전문화 · 전투력이 이어지는 캐릭터를 찾아 자동으로 이어 붙입니다 (직업이 바뀌어도 찾음).`)
    + `<div class="kpis">${CK.map((l, i) => `<div class="kpi"><div class="lb">${l} (명)</div><div class="v">${nf(cnt[i])}</div><div class="s">${esc(perLbl)}${CG.w ? ' · ' + esc(wName(CG.w)) : ''}</div></div>`).join('')}
      <div class="kpi"><div class="lb">유력 후보 (건)</div><div class="v" style="color:var(--amb)">${nf(lk)}</div><div class="s">확실하지 않아 이어 붙이지 않음</div></div></div>
    <div class="ctrls"><span class="lbl">종류</span>${seg('cg-kind', CG.kind, [[-1, '전체'], [0, '닉네임'], [1, '길드'], [2, '월드 이전'], [3, '서버 이전']])}
      <span class="lbl">확실도</span>${seg('cg-cf', CG.cf, [[0, '전체'], [1, '확실'], [2, '유력']])}
      <span class="lbl">정렬</span><select data-ch="cg-sort">${CGSORT.map(([v, l]) => `<option value="${v}" ${v === CG.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn cgdir" data-act="cg-dir" title="오름차순 / 내림차순 바꾸기">${dir < 0 ? '내림차순 ▼' : '오름차순 ▲'}</button></div>
    ${q ? await oldNameNote(q, ch, CG.w) : ''}
    <div class="sec" id="cglist">변경 목록 <small>${nf(view.length)}건 · ${esc((CGSORT.find(x => x[0] === CG.sort) || CGSORT[0])[1])} ${dir < 0 ? '내림차순' : '오름차순'} · 표 제목을 눌러도 정렬 · 줄을 누르면 캐릭터 정보</small></div>
    <div class="tbl" style="margin:0;border:0"><table class="rk chg"><tr>${th('d', '날짜', 'cgd')}${th('kind', '종류')}${th('name', '캐릭터 (현재)', 'l')}${th('world', '월드', 'cgws')}${th('server', '서버', 'cgws')}<th class="l">이전 → 이후</th><th class="l hide-s">현재 길드</th>${th('bp', '전투력')}${th('ml', '대표 마스터리', 'hide-s')}${th('sp', '전문화')}<th class="hide-s">업적점수</th><th></th></tr>
    ${slice.map(x => `<tr class="${x[11] ? 'rkrow' : ''}" ${x[11] ? `data-act="char" data-w="${x[2]}" data-n="${esc(x[4])}"` : ''}>
      <td class="dg cgd" style="font-size:16px">${esc(dayStr(x[0]).slice(5))}</td><td><span class="mdate dg">${esc(dayStr(x[0]).slice(5))}</span>${ckBadge(x[1])}${cfBadge(x[12], x[13], x[14])}</td>
      <td class="l"><div class="nm">${esc(x[4])}</div><div class="sub msub">${esc(wName(x[2]))} ${serverLabel(x[3])}</div>${(() => { const o = oldNames(x[2], x[4]).filter(v => v !== x[5] || x[1] !== 0); return o.length ? `<div class="oldnm">이전 닉네임 · ${o.map(v => `<span class="${q && v.includes(q) ? 'hit' : ''}">${esc(v)}</span>`).join(', ')}</div>` : ''; })()}${assocOf(x) ? `<div class="sub"><span class="cfb c3">연관 추정 ${assocOf(x).rel.length}</span></div>` : ''}</td>
      <td class="cgws">${esc(wName(x[2]))}</td><td class="cgws dg" style="font-size:16px">${x[3] ? pad2(x[3]) : '--'}</td>
      <td class="l nh">${ckFromTo(x[1], x[5], x[6])}</td><td class="l hide-s">${x[7] ? esc(x[7]) : '<span class="sub">-</span>'}</td>
      <td><span class="big" style="font-size:18px">${nf(x[8])}</span></td><td class="hide-s"><span class="dg" style="font-size:17px">${nf(x[9])}</span><div class="sub">${esc(mname(x[10]))}</div></td>
      <td><span class="dg" style="font-size:17px">${nf(x[15])}</span></td><td class="hide-s"><span class="dg" style="font-size:17px">${nf(x[16])}</span></td>
      <td style="white-space:nowrap">${chgTrackBtn(x[2], x[4], x[11])}</td></tr>`).join('') || '<tr><td colspan="12" class="emptyrow">이 조건에 맞는 변경이 없습니다</td></tr>'}
    </table></div>
    ${pages > 1 ? `<div class="pager"><button class="btn" data-act="cg-page" data-p="0" ${CG.page ? '' : 'disabled'}>처음</button><button class="btn" data-act="cg-page" data-p="${CG.page - 1}" ${CG.page ? '' : 'disabled'}>이전</button>
      <span class="pi">${CG.page + 1} / ${pages} 쪽</span>
      <button class="btn" data-act="cg-page" data-p="${CG.page + 1}" ${CG.page < pages - 1 ? '' : 'disabled'}>다음</button><button class="btn" data-act="cg-page" data-p="${pages - 1}" ${CG.page < pages - 1 ? '' : 'disabled'}>끝</button></div>` : ''}`;
  }
  return tabs + `<section class="ov fr" id="cgtop">${NODES}${head}${trModeBar(ch)}${body}</section>`;
}

/* ============================================================ 통합레벨 계산기 */
// 게임 클라이언트 데이터(Mastery_Level · Mastery_PvPLevelAdjust)에서 가져온 값.
// 통합 레벨 = 무기 11종 누적 경험치를 모두 더해 무기와 같은 경험치 곡선에 넣은 레벨 (최대 130).
// 검증: 게임 표시 114 · 17.04% ↔ 계산 114 · 17.03%
const LV_PVP = [[-20,-2500,-2000,-2000,-5000],[-19,-2400,-1900,-1900,-4500],[-18,-2300,-1800,-1800,-4000],[-17,-2200,-1700,-1700,-3900],[-16,-2100,-1600,-1600,-3800],[-15,-2000,-1500,-1500,-3700],[-14,-1900,-1400,-1400,-3600],[-13,-1800,-1300,-1300,-3500],[-12,-1700,-1200,-1200,-3400],[-11,-1600,-1100,-1100,-3300],[-10,-1500,-1000,-1000,-3200],[-9,-1400,-900,-900,-3000],[-8,-1300,-800,-800,-2800],[-7,-1200,-700,-700,-2400],[-6,-1100,-600,-600,-2000],[-5,-1000,-500,-500,-1500],[-4,-900,-400,-400,-1000],[-3,-800,-300,-300,-500],[-2,-700,0,0,-200],[-1,-500,0,0,0],[0,0,0,0,0],[1,50,0,0,0],[2,100,0,0,100],[3,150,0,0,150],[4,200,0,0,200],[5,250,0,0,250],[6,300,0,0,300],[7,350,0,0,350],[8,400,0,0,400],[9,450,0,0,450],[10,500,0,0,500],[11,550,0,0,550],[12,600,0,0,600],[13,650,0,0,650],[14,700,0,0,700],[15,750,0,0,750],[16,800,0,0,800],[17,850,0,0,850],[18,900,0,0,900],[19,950,0,0,950],[20,1000,0,0,1000]]; // [레벨 차이, 명중, 치명타, 피해량, 상태이상] 단위 1/100 %
const LV_EXP = ["22","80","120","168","280","420","637","788","893","1120","1415","1590","1874","2214","2693","3260","4164","5058","6256","7360","11981","13200","15034","17261","20276","26924","33370","40392","49018","59520","122204","158400","212475","291411","372082","630694","870265","1145205","1492885","1670760","4216212","5096520","6089078","7405609","7904150","9684589","12446269","15568936","19324899","20714400","43867980","51700275","60463260","72105877","79091130","95376453","120654425","148764712","182556860","216928530","386305266","448457764","512851909","597640499","695999804","820769378","1004859286","1204381483","1443601142","1724956884","2420234593","2737919653","3086787623","3525526445","4006718521","4597613348","5451362025","6243781376","7186180252","8296726219","13120101166","15195392772","17487569176","20273580227","23280103643","26888882452","31991576376","36673262153","42153898306","48519114818","56909531662","64076307902","86049044105","120468661747","192749858795","308399774072","524279615923","891275347069","1515168090017","2419200000000","2851200000000","3317760000000","3818880000000","4354560000000","4924800000000","5529600000000","6168960000000","6842880000000","7551360000000","8294400000000","9072000000000","9884160000000","10730880000000","11612160000000","12528000000000","13478400000000","14463360000000","15482880000000","16536960000000","194758275825026","356961292206976","713201643936026","1151331339798630","1751212248444150","2472372673173620","3572232191216350","4900102914588620","6463353436631740","8268480000000000","21597569177581500","41648619007943400","72983285703294800","108408897023830000","146876506977166000","187768299918505000","230676043964005000","276811252756806000","332173503308167000","398608203969801000","398608203969801000"]; // 레벨별 다음 레벨까지 필요 경험치 (1~140)
const LV_MAX = 130;
const LV_E = LV_EXP.map(s => BigInt(s));
const LV_CUM = [0n]; LV_E.forEach((e, i) => LV_CUM.push(LV_CUM[i] + e));
const LV_EN = LV_E.map(Number), LV_CN = LV_CUM.map(Number);
const lvAdj = d => { const r = LV_PVP[Math.max(-20, Math.min(20, d)) + 20]; return {d: r[0], hit: r[1], crit: r[2], dmg: r[3], mez: r[4]}; };
const lvOfN = t => { let L = 1; while(L < LV_MAX && LV_CN[L] <= t) L++; return L; };
function lvWeaponCum(lv, p){ lv = Math.max(1, Math.min(140, Math.floor(lv))); p = Math.max(0, Math.min(100, p || 0));
  return LV_CUM[lv - 1] + (LV_E[lv - 1] * BigInt(Math.round(p * 1e6))) / 100000000n; }
// 레벨 + 경험치 % → 통합 레벨 · %
function lvExact(list){
  let tot = 0n, any = false;
  for(const [lv, p] of list) if(lv >= 1){ any = true; tot += lvWeaponCum(lv, p); }
  if(!any) return null;
  let L = 1; while(L < LV_MAX && LV_CUM[L] <= tot) L++;
  const pr = L >= LV_MAX ? 100 : Number((tot - LV_CUM[L - 1]) * 10000n / LV_E[L - 1]) / 100;
  return {l: L, p: pr};
}
// 레벨만 알 때(경험치 % 모름): 각 무기 경험치 0~100%를 고르게 가정해 나올 수 있는 통합 레벨 분포
function lvRange(levels, N = 20000){
  levels = levels.filter(l => l >= 1 && l <= 140);
  if(!levels.length) return null;
  let mn = 0, mx = 0; for(const l of levels){ mn += LV_CN[l - 1]; mx += LV_CN[l]; }
  const h = {};
  for(let k = 0; k < N; k++){ let t = 0; for(const l of levels) t += LV_CN[l - 1] + LV_EN[l - 1] * Math.random(); const L = lvOfN(t); h[L] = (h[L] || 0) + 1; }
  const dist = Object.entries(h).map(([L, c]) => [+L, c / N]).sort((a, b) => a[0] - b[0]);
  const top = dist.reduce((a, b) => b[1] > a[1] ? b : a);
  return {min: lvOfN(mn), max: lvOfN(mx - 1), dist, top, n: levels.length};
}
const lvPct = v => v === 0 ? '0%' : (v < 0 ? '−' : '+') + Number((Math.abs(v) / 100).toFixed(2)) + '%';
const lvSgn = d => d > 0 ? '+' + d : d < 0 ? '−' + (-d) : '0';
const lvCls = v => v < 0 ? 'neg' : v > 0 ? 'pos' : 'zero';
function lvState(){ return (ST.lvc ||= {my: '', op: '', w: {}, opw: ''}); }
// 추적 캐릭터의 마스터리 (사이트 + 직접 입력) → 무기별 레벨
async function lvLevelsOf(k){
  const c = (await buildCards()).find(x => x.k === k);
  if(!c) return null;
  return masteryList().slice(0, 11).map(([code]) => c.ms[code]?.level || 0);
}
function pageLvl(){
  const S = lvState();
  const opts = ST.tracked.map(t => `<option value="${esc(key(t.w, t.n))}">${esc(t.n)} · ${esc(wName(t.w))}</option>`).join('');
  const pick = id => ST.tracked.length ? `<select id="${id}" class="lvpick"><option value="">추적 캐릭터에서 불러오기</option>${opts}</select>` : '';
  const ws = masteryList().slice(0, 11);
  return `<div class="lvwrap">
  <section class="ov fr">${NODES}
    <div class="bar"><span class="sid g">통합레벨 계산기</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">PvP 통합 레벨 차이 보정</span></div>
    <div class="note">통합 레벨 차이에 따라 <b>피해량 · 치명타 · 명중 · 상태이상 성공률</b>이 보정됩니다. 피해량은 <b>3레벨 낮을 때부터 −3%</b>, 1레벨마다 −1%씩 커져 20레벨 이상 낮으면 <b>−20%</b>입니다. 레벨이 높은 쪽은 피해량 보너스가 없고 명중 · 상태이상만 조금 오릅니다.</div>
    <div class="lvcalc">
      <div class="lvin"><label for="lv-my">내 통합 레벨</label><input id="lv-my" type="number" inputmode="numeric" min="1" max="130" placeholder="1~130" value="${esc(S.my)}"></div>
      <div class="lvdiff"><span>레벨 차이</span><b id="lv-diff">-</b></div>
      <div class="lvin"><label for="lv-op">상대 통합 레벨</label><input id="lv-op" type="number" inputmode="numeric" min="1" max="130" placeholder="1~130" value="${esc(S.op)}"></div>
    </div>
    <div class="lvstatus" id="lv-status">레벨을 입력하세요</div>
    <div class="lvres"><div class="lvcol"><div class="lvh">내가 공격할 때</div><div id="lv-r1"></div></div><div class="lvcol"><div class="lvh">상대가 공격할 때</div><div id="lv-r2"></div></div></div>
  </section>
  <div class="lvhelpers">
    <section class="ov fr">${NODES}
      <div class="bar"><span class="sid g">내 통합 레벨 계산</span></div>
      <div class="lvbody">
        <p class="hint2">게임 마스터리 창의 무기별 <b>레벨</b>과 <b>경험치 %</b>를 넣으세요. 안 쓴 무기는 비워 두면 됩니다.</p>
        ${pick('lv-pick1')}
        <div class="lvwh"><span>무기</span><span>레벨</span><span>경험치 %</span></div>
        ${ws.map(([code, name], i) => `<div class="lvwr"><span>${esc(name)}</span><input type="number" inputmode="numeric" min="1" max="140" data-lvw="${i}" data-f="l" placeholder="Lv" value="${esc(S.w[i + 'l'] ?? '')}"><input type="number" inputmode="decimal" min="0" max="100" step="0.01" data-lvw="${i}" data-f="p" placeholder="%" value="${esc(S.w[i + 'p'] ?? '')}"></div>`).join('')}
        <div class="lvout"><div><div class="sub">통합 레벨</div><div class="lvv" id="lv-mine">-</div></div>
          <div class="lvbtns"><button class="btn" data-act="lv-wclear">비우기</button><button class="btn pri" data-act="lv-apply1" id="lv-apply1" disabled>내 레벨에 적용</button></div></div>
      </div>
    </section>
    <section class="ov fr">${NODES}
      <div class="bar"><span class="sid g">상대 통합 레벨 추정</span></div>
      <div class="lvbody">
        <p class="hint2">상대는 경험치 %를 모르니 <b>무기 레벨만</b> 넣으세요 (공백이나 쉼표로 구분, 11개까지). 각 무기의 경험치를 0~100% 고르게 가정해 나올 수 있는 통합 레벨과 확률을 계산합니다.</p>
        ${pick('lv-pick2')}
        <input id="lv-opw" class="lvtxt" type="text" autocomplete="off" placeholder="예: 110 107 100 95 89 54 50 47 1 1 1" value="${esc(S.opw)}">
        <div id="lv-est"></div>
        <div class="lvout"><div><div class="sub">가장 가능성 높은 레벨</div><div class="lvv" id="lv-estv">-</div></div>
          <div class="lvbtns"><button class="btn pri" data-act="lv-apply2" id="lv-apply2" disabled>상대 레벨에 적용</button></div></div>
      </div>
    </section>
  </div>
  <section class="ov fr">${NODES}
    <div class="bar"><span class="sid g">레벨 차이별 보정</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">가로: 내 통합 레벨 − 상대 통합 레벨 (공격하는 쪽 기준)</span></div>
    <div class="lvlegend"><span><i class="c-dmg"></i>피해량 · 치명타</span><span><i class="c-hit"></i>명중</span><span><i class="c-mez"></i>상태이상</span></div>
    <div id="lv-chart"><svg id="lv-svg" role="img" aria-label="레벨 차이별 보정 그래프"></svg><div id="lv-tip"></div></div>
    <details class="lvdet"><summary>전체 보정표 (−20 ~ +20)</summary><div class="tbl" style="margin:0;border:0;max-height:420px;overflow:auto"><table class="rk lvtbl"><tr><th>레벨 차이</th><th>피해량</th><th>치명타</th><th>명중</th><th>상태이상</th></tr>
      ${LV_PVP.map(r => `<tr data-lvd="${r[0]}"><td class="dg">${lvSgn(r[0])}</td>${[r[3], r[2], r[1], r[4]].map(v => `<td class="${lvCls(v)}">${lvPct(v)}</td>`).join('')}</tr>`).join('')}</table></div></details>
    <div class="note" style="border-top:1px solid var(--line2)">출처: 게임 클라이언트 데이터 (Mastery_Level · Mastery_PvPLevelAdjust). 통합 레벨은 무기 11종의 누적 경험치를 합쳐 무기와 같은 경험치 곡선으로 계산합니다 (최대 130). 게임 표시 114 · 17.04% ↔ 계산 114 · 17.03%로 확인했습니다. 실제 판정은 서버에서 하므로 다를 수 있습니다.</div>
  </section></div>`;
}
let LVCUR = null;
function lvRows(a){
  return [['피해량', a.dmg], ['치명타', a.crit], ['명중', a.hit], ['상태이상 성공률', a.mez]]
    .map(([n, v]) => `<div class="lvrow"><span>${n}</span><b class="${lvCls(v)}">${lvPct(v)}</b></div>`).join('');
}
function lvCalc(){
  const S = lvState(), cl = v => { v = parseInt(v); return isNaN(v) ? NaN : Math.max(1, Math.min(LV_MAX, v)); };
  S.my = $('#lv-my').value; S.op = $('#lv-op').value; saveStore();
  const my = cl(S.my), op = cl(S.op);
  if(isNaN(my) || isNaN(op)){
    $('#lv-diff').textContent = '-'; $('#lv-status').textContent = '레벨을 입력하세요'; $('#lv-status').className = 'lvstatus';
    const z = lvRows({dmg: 0, crit: 0, hit: 0, mez: 0}).replace(/>0%</g, '>-<'); $('#lv-r1').innerHTML = z; $('#lv-r2').innerHTML = z;
    LVCUR = null; lvChart(); lvMark(); return;
  }
  const d = my - op; LVCUR = d;
  const a = lvAdj(d), b = lvAdj(-d);
  let msg, c = '';
  if(d === 0){ msg = '같은 레벨 · 보정 없음'; }
  else if(a.dmg < 0){ msg = `내가 주는 피해 ${lvPct(a.dmg)}`; c = 'neg'; }
  else if(b.dmg < 0){ msg = `상대가 주는 피해 ${lvPct(b.dmg)}`; c = 'pos'; }
  else if(d < 0){ msg = `피해량 보정 없음 · 내 명중 ${lvPct(a.hit)}`; c = 'neg'; }
  else { msg = `피해량 보정 없음 · 상대 명중 ${lvPct(b.hit)}`; c = 'pos'; }
  $('#lv-diff').textContent = lvSgn(d); $('#lv-status').textContent = msg; $('#lv-status').className = 'lvstatus ' + c;
  $('#lv-r1').innerHTML = lvRows(a); $('#lv-r2').innerHTML = lvRows(b);
  lvChart(); lvMark();
}
let LVMINE = null, LVEST = null, LVT = 0;
function lvMine(){
  const S = lvState(); S.w ||= {};
  const list = [];
  document.querySelectorAll('[data-lvw]').forEach(inp => { S.w[inp.dataset.lvw + inp.dataset.f] = inp.value; });
  for(let i = 0; i < 11; i++){ const lv = parseFloat(S.w[i + 'l']), p = parseFloat(S.w[i + 'p']); if(!isNaN(lv)) list.push([lv, isNaN(p) ? 0 : p]); }
  saveStore();
  const r = lvExact(list); LVMINE = r ? r.l : null;
  $('#lv-mine').innerHTML = r ? (r.l >= LV_MAX ? `${r.l}<small>최대</small>` : `${r.l}<small>${r.p.toFixed(2)}%</small>`) : '-';
  $('#lv-apply1').disabled = !r;
}
function lvEst(){
  const S = lvState(); S.opw = $('#lv-opw').value; saveStore();
  const ol = (S.opw.match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= 140).slice(0, 11);
  const o = $('#lv-est');
  if(!ol.length){ LVEST = null; o.innerHTML = ''; $('#lv-estv').textContent = '-'; $('#lv-apply2').disabled = true; return; }
  const e = lvRange(ol); LVEST = e;
  const mp = e.top[1];
  o.innerHTML = `<div class="lvrange">입력 ${e.n}개 · 나올 수 있는 범위 <b>${e.min === e.max ? e.min : e.min + ' ~ ' + e.max}</b></div><div class="lvbars">`
    + e.dist.map(([L, p]) => `<div class="lvbar ${L === e.top[0] ? 'top' : ''}"><span>${L}</span><div class="tr"><i style="width:${(p / mp * 100).toFixed(1)}%"></i></div><em>${(p * 100).toFixed(1)}%</em></div>`).join('') + '</div>';
  $('#lv-estv').innerHTML = `${e.top[0]}<small>${(e.top[1] * 100).toFixed(0)}%</small>`;
  $('#lv-apply2').disabled = false;
}
function lvMark(){
  const cd = LVCUR == null ? null : Math.max(-20, Math.min(20, LVCUR));
  document.querySelectorAll('.lvtbl tr[data-lvd]').forEach(tr => tr.classList.toggle('mine', cd != null && +tr.dataset.lvd === cd));
}
function lvChart(){
  const box = $('#lv-chart'), svg = $('#lv-svg'), tip = $('#lv-tip'); if(!box) return;
  const cs = getComputedStyle(document.documentElement), col = n => cs.getPropertyValue(n).trim() || '#9ad';
  const SER = [{k: 'dmg', n: '피해량 · 치명타', c: '#ff6b6b', w: 2.5}, {k: 'hit', n: '명중', c: col('--hi'), w: 2}, {k: 'mez', n: '상태이상', c: col('--amb'), w: 2}];
  const W = Math.max(260, (box.clientWidth || 620) - 20), H = W < 500 ? 230 : 290, m = {l: W < 500 ? 42 : 50, r: 12, t: 12, b: 28};   // 20 = #lv-chart 좌우 여백
  const NS = 'http://www.w3.org/2000/svg', el = (t, a, p) => { const e = document.createElementNS(NS, t); for(const k in a) e.setAttribute(k, a[k]); p && p.append(e); return e; };
  svg.setAttribute('width', W); svg.setAttribute('height', H); svg.innerHTML = '';
  const ymin = -5000, ymax = 1000, x = d => m.l + (d + 20) / 40 * (W - m.l - m.r), y = v => m.t + (ymax - v) / (ymax - ymin) * (H - m.t - m.b);
  const dim = col('--dim'), line = col('--line2');
  for(let v = -5000; v <= 1000; v += 1000){ el('line', {x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: v === 0 ? dim : line, 'stroke-opacity': v === 0 ? .8 : .5}, svg);
    el('text', {x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', fill: dim, 'font-size': 11}, svg).textContent = (v < 0 ? '−' + (-v / 100) : v / 100) + '%'; }
  for(let d = -20; d <= 20; d += 5) el('text', {x: x(d), y: H - 8, 'text-anchor': 'middle', fill: dim, 'font-size': 11}, svg).textContent = lvSgn(d);
  if(LVCUR != null){ const cd = Math.max(-20, Math.min(20, LVCUR));
    el('line', {x1: x(cd), x2: x(cd), y1: m.t, y2: H - m.b, stroke: col('--hi'), 'stroke-width': 1.5, 'stroke-dasharray': '3 3'}, svg);
    SER.forEach(s => el('circle', {cx: x(cd), cy: y(lvAdj(cd)[s.k]), r: 4.5, fill: s.c}, svg)); }
  SER.forEach(s => el('path', {d: LV_PVP.map((r, i) => (i ? 'L' : 'M') + x(r[0]).toFixed(1) + ',' + y(lvAdj(r[0])[s.k]).toFixed(1)).join(''), fill: 'none', stroke: s.c, 'stroke-width': s.w, 'stroke-linejoin': 'round'}, svg));
  const vl = el('line', {y1: m.t, y2: H - m.b, stroke: dim, visibility: 'hidden'}, svg);
  const dots = SER.map(s => el('circle', {r: 4, fill: s.c, visibility: 'hidden'}, svg));
  const ov = el('rect', {x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent'}, svg);
  const move = e => { const r = svg.getBoundingClientRect(), cx = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) * (W / (r.width || W));
    const d = Math.max(-20, Math.min(20, Math.round((cx - m.l) / (W - m.l - m.r) * 40 - 20))), a = lvAdj(d);
    vl.setAttribute('x1', x(d)); vl.setAttribute('x2', x(d)); vl.setAttribute('visibility', 'visible');
    SER.forEach((s, i) => { dots[i].setAttribute('cx', x(d)); dots[i].setAttribute('cy', y(a[s.k])); dots[i].setAttribute('visibility', 'visible'); });
    tip.innerHTML = `<b>레벨 차이 ${lvSgn(d)}</b>` + SER.map(s => `<div class="r"><span style="color:${s.c}">${s.n}</span><b class="${lvCls(a[s.k])}">${lvPct(a[s.k])}</b></div>`).join('');
    tip.style.display = 'block'; const tw = tip.offsetWidth; let lx = x(d) + 12; if(lx + tw > W) lx = x(d) - tw - 12; tip.style.left = Math.max(0, lx) + 'px'; tip.style.top = (m.t + 4) + 'px'; };
  const hide = () => { tip.style.display = 'none'; vl.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); };
  ov.addEventListener('mousemove', move); ov.addEventListener('mouseleave', hide);
  ov.addEventListener('touchstart', move, {passive: true}); ov.addEventListener('touchmove', move, {passive: true}); ov.addEventListener('touchend', hide);
}
function initLvl(){
  if(!$('#lv-my')) return;
  $('#lv-my').addEventListener('input', lvCalc); $('#lv-op').addEventListener('input', lvCalc);
  document.querySelectorAll('[data-lvw]').forEach(i => i.addEventListener('input', lvMine));
  $('#lv-opw').addEventListener('input', () => { clearTimeout(LVT); LVT = setTimeout(lvEst, 150); });
  const pk = async (id, fn) => { const s = $('#' + id); if(!s) return; s.addEventListener('change', async () => { if(!s.value) return; const l = await lvLevelsOf(s.value); s.value = ''; if(l) fn(l); }); };
  pk('lv-pick1', l => { l.forEach((v, i) => { const a = document.querySelector(`[data-lvw="${i}"][data-f="l"]`); a.value = v || ''; }); lvMine(); toast('마스터리 레벨을 불러왔습니다 — 경험치 %를 넣으면 더 정확합니다'); });
  pk('lv-pick2', l => { $('#lv-opw').value = l.filter(v => v > 0).join(' '); lvEst(); const miss = 11 - l.filter(v => v > 0).length; toast(miss ? `${11 - miss}개 무기 레벨을 불러왔습니다 (모르는 ${miss}개는 빠짐)` : '무기 11개 레벨을 불러왔습니다'); });
  lvMine(); lvEst(); lvCalc();
}
let LVRT = 0; addEventListener('resize', () => { clearTimeout(LVRT); LVRT = setTimeout(() => { if($('#lv-chart')) lvChart(); }, 150); });


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
      <dt>캐릭터</dt><dd>[검색]으로 찾은 캐릭터 1명의 정보 — 전투력 · 업적 · 마스터리 · 전문화 일별 그래프, 마스터리 11종 입력, 통합 레벨, 변경 내역. [화면 초기화]로 표시 중인 캐릭터와 최근 본 캐릭터를 지웁니다(추적 · 메모는 그대로).</dd>
      <dt>길드</dt><dd>길드명으로 찾기 → 월드 · 서버별 길드 목록. 길드원 수, 신규 가입 · 탈퇴(7일/30일/전체), 평균 전투력 · 마스터리 · 전문화, 직업 구성, 길드원 표, [+ 길드원 모두 추적]. 월드 · 서버를 옮긴 길드원과 행방 불명 길드원도 보여줍니다. 길드마다 <b>코멘트</b>를 남길 수 있습니다(이 브라우저에만 저장 · 백업에 포함).</dd>
      <dt>랭킹</dt><dd>대표 마스터리 또는 전투력 순위 — 전체 월드 / 월드 / 서버, 직업 필터, 닉네임 · 길드 찾기. 전문화 레벨도 함께 표시합니다.</dd>
      <dt>TOP 20</dt><dd>대표 마스터리 TOP 20과 전투력 TOP 20.</dd>
      <dt>통계</dt><dd>캐릭터 수 · 평균 · 최고, 전투력 · 마스터리 · 전문화 분포, 직업 · 무기 통계, 서버별 비교, 순위 컷.</dd>
      <dt>변경 이력</dt><dd>위쪽 소메뉴로 <b>변경 목록</b> · <b>이전 추적</b> · <b>세탁 의심</b> · <b>행방 불명</b> · <b>연관 추정</b>을 나눠 봅니다(소메뉴에 건수 표시). 기간 · 월드 · 서버 · 찾기는 모든 소메뉴에 같이 적용되고, 소메뉴마다 종류 · 확실도 · 단계 · 비교 대상 · 정렬 필터가 따로 있습니다. 각 화면 설명은 [이 화면 설명]을 눌러 펼칩니다. 월드 · 서버 이전은 스토브 공지에 나온 <b>이전 기간</b>(+다음 날 수집분)에 대상 월드 · 서버에서 옮긴 것만 인정합니다. 일정은 월초(주요 일정 캘린더) · 평시 7일마다 · 이전 기간 7일 전부터 매일 공지사항으로 확인합니다. 평시에는 닉네임 변경만, 이전 기간에는 이전 · 세탁 의심까지 찾습니다(위쪽 상태 표시). 세탁 의심 카드에는 <b>의심 이유</b>(이전 · 닉네임 · 길드 · 의상 변경, 반복 횟수, 같은 캐릭터 판정)가 적혀 있습니다. 변경 목록은 매일 수집 때 닉네임 · 길드 · 월드 · 서버가 바뀐 캐릭터 목록(최근 수집일 / 7일 / 30일 / 전체). 이전 추적에는 월드 · 서버를 옮긴 캐릭터를 자동으로 따라가서 옮긴 뒤 닉네임 · 길드 변화를 보여줍니다. 이어 붙인 결과는 <b>확실</b> / <b>유력</b>으로 구분합니다. 월드 · 서버 필터, 이전 닉네임으로도 찾기(지금 그 이름을 쓰는 다른 캐릭터와 구분 표시), 캐릭터를 산 뒤 관련 닉네임으로 바꾼 경우를 찾는 <b>닉네임 연관 추정(참고)</b>, 월드 · 서버를 옮기며 닉네임 · 길드 · 의상을 바꾼 <b>이전 세탁 의심</b>과 <b>행방 불명</b> 캐릭터 목록이 있습니다.</dd>
      <dt>드랍율</dt><dd>게임 클라이언트 데이터로 만든 몬스터 드랍표 · 상자 내용물 확률표입니다. 아이템 · 몬스터 · 상자 · 사냥터 이름으로 찾고 출처(몬스터/상자), 등급 · 사냥터 · 몬스터 구분으로 좁힐 수 있습니다. 아이템을 누르면 드랍율이 가장 높은 몬스터, 1,000마리당 기대 개수가 가장 많은 몬스터(몬스터 효율), 일반 · 정예를 고르게 잡을 때 가장 많이 나오는 사냥터(사냥터 효율)를 보여 줍니다. 게임 패치 뒤에는 bat\\4_드랍DB만들기.bat 로 다시 만들어 올리세요.</dd>
      <dt>경험치 계산기</dt><dd>사냥 결과 창 캡처를 끌어다 놓거나 Ctrl+V로 붙여넣으면 사냥터 · 사냥 시간 · M 경험치를 읽어 1분당 · 1시간당 경험치를 기록하고, 가장 효율 좋은 사냥터를 ★로 표시합니다. 사냥터 이름 앞뒤에 잘못 읽힌 글자는 자동으로 떼어냅니다. 잘못 읽은 기록은 [수정]으로 고칠 수 있습니다.</dd>
      <dt>통합레벨 계산기</dt><dd>내 · 상대 통합 레벨을 넣으면 PvP 레벨 차이 보정(피해량 · 치명타 · 명중 · 상태이상)을 보여줍니다. 무기 11종 레벨 · 경험치 %로 내 통합 레벨을 계산하고, 상대는 무기 레벨만으로 나올 수 있는 통합 레벨과 확률을 추정합니다. 추적 캐릭터의 마스터리를 불러올 수 있습니다.</dd>
      <dt>추적</dt><dd>추적 등록한 캐릭터 관리 — 위쪽 소메뉴로 <b>캐릭터 목록</b>(20명씩 쪽 넘김) · <b>길드별</b>(길드로 묶어 인원 · 평균/최고 전투력, 누르면 그 길드원만 목록) · <b>종합 현황</b> · <b>상세</b>(이전/다음으로 넘겨 보기)를 나눠 봅니다. 캐릭터명 · 길드명 찾기, 길드 · 월드 필터와 정렬, 목록 · 종합 현황 · 상세, 닉네임 · 길드 변경 이력, 여러 명 선택 해제.</dd>
    </dl>`)
  + sec('캐릭터 추적 방식 (닉네임 변경 · 월드 · 서버 이전)', `
    <p>공식 사이트에는 캐릭터 고유 번호가 없어서, 매일 수집 때 <b>어제 있다가 오늘 사라진 캐릭터</b>와 <b>오늘 처음 보이는 캐릭터</b>의 수치를 비교해 같은 캐릭터를 찾습니다.</p>
    <table class="htbl"><tr><th>비교 항목</th><th>같은 캐릭터로 보는 범위</th></tr>
      <tr><td>직업 · 무기 종류</td><td>보지 않음 (언제든 자유롭게 바꿀 수 있음)</td></tr>
      <tr><td>업적점수</td><td>줄지 않고 하루 1% 이내로 늘어남 (실제로는 대부분 하루 0.1% 안팎)</td></tr>
      <tr><td>무기별 마스터리</td><td>같은 무기의 레벨은 줄지 않음 (마스터리 체인지로 무기끼리 레벨을 바꾼 경우는 레벨 묶음으로 비교)</td></tr>
      <tr><td>전문화</td><td>줄지 않고 하루 2 이내로 오름</td></tr>
      <tr><td>전투력</td><td>−40% ~ +5%(하루 1%씩 더) — 장비 교체로 크게 떨어지기도 함</td></tr>
      <tr><td>서버 · 월드</td><td>이전 기간이 아니면 같아야 함</td></tr></table>
    <p class="mut">실측(가르바나 전투력 20만 이상 371명, 이틀 간격): 위 범위로 370명이 자기 자신만 찾았고, 다른 캐릭터와 겹친 4명도 점수 1등이 모두 본인이었습니다.</p>
    <ul><li><b>확실</b>: 위 범위에 맞는 캐릭터가 <b>서로 한 명뿐</b>이거나, 여럿이어도 서로 1등이고 2등과 점수 차이가 뚜렷할 때 같은 캐릭터로 이어 붙입니다. 이름 · 월드 · 서버 · 직업이 모두 바뀌어도 찾습니다. 추적 · 메모도 새 이름으로 자동으로 옮겨집니다.</li>
      <li><b>이름 넘겨받기</b>: 계정 매매 · 닉네임 맞바꾸기로 <b>다른 캐릭터가 같은 이름</b>을 쓰게 되면(업적점수 · 전문화가 줄어드는 등) 예전 기록을 떼어 내 '<b>이름(예전)</b>'으로 두고, 예전 캐릭터의 새 이름을 찾아 이어 붙입니다.</li>
      <li>업적점수가 0인 캐릭터는 비교할 값이 적어 <b>유력</b>으로만 표시합니다.</li>
      <li><b>유력</b>: 맞는 후보가 여럿이거나 일부 값이 조금 다를 때는 단정하지 않고 [변경 이력]에 유력으로만 표시합니다. 추적 중인 캐릭터라면 [추적] 화면에 후보가 나오고 [이 캐릭터로 바꾸기]로 직접 옮길 수 있습니다.</li>
      <li>사라진 뒤 <b>14일 안</b>에 다시 나타나면 이어 붙입니다. 옮긴 곳에서 수집 기준(구월드 17만 · 신월드 500위) 밖이면 기준 안으로 들어온 날 찾습니다.</li></ul>`)
  + sec('월드 · 서버 이전 세탁 추적', `
    <p>월드 · 서버를 옮기면서 닉네임 · 길드 · 의상까지 바꿔 다른 캐릭터처럼 보이게 하는 경우(세탁)를 찾아 [변경 이력]의 <b>이전 세탁 의심</b>에 보여줍니다.</p>
    <ul><li>위 비교 항목에 더해 <b>의상(코스튬)</b> 정보도 비교합니다.</li>
      <li>사라진 캐릭터는 <b>14일 동안</b> 옮긴 곳을 찾습니다. 수집 기준 밖으로 옮겨도 새로 나타난 캐릭터는 <b>모두</b> 비교합니다.</li>
      <li>한 번 이전이 확인된 캐릭터는 <b>30일 동안</b> 수집 기준과 관계없이 계속 수집합니다.</li>
      <li>세탁 의심 단계: ${ldBadge('높음', '')} 이전 + 닉네임 변경 + 길드나 의상까지 변경, 또는 최근 이전 · 닉네임 변경을 2번 이상 · ${ldBadge('보통', '')} 이전 + 닉네임 변경 · ${ldBadge('낮음', '')} 닉네임은 그대로 두고 이전 + 길드 변경. 이전만 하고 아무것도 안 바꾼 캐릭터는 넣지 않습니다. 확실 / 유력은 같은 캐릭터라는 판정의 확실도입니다.</li>
      <li><b>행방 불명</b>: 사라졌지만 14일 안에 같은 캐릭터를 아직 찾지 못한 캐릭터입니다. 삭제됐거나 순위 밖으로 밀려난 경우일 수도 있습니다.</li></ul>`)
  + sec('알아둘 점', `
    <ul><li>추적 · 메모 · 마스터리 입력 · 경험치 기록은 <b>이 브라우저에만</b> 저장됩니다. 다른 기기로 옮기려면 [캐릭터] · [추적] 아래 [백업 저장] / [백업 불러오기]를 쓰세요.</li>
      <li>닉네임 변경은 업적점수 · 무기별 마스터리 · 전문화 · 전투력이 이어지는 캐릭터가 확실할 때만 자동으로 연결합니다(잘못 연결 방지). 못 따라가면 [추적]의 [닉네임/월드]로 직접 바꾸세요.</li>
      <li>공식 공개 API가 아니라 공식 사이트가 쓰는 데이터를 이용합니다. 공식 사이트가 바뀌면 수정이 필요할 수 있습니다.</li>
      <li>버전 ${VERSION}</li></ul>`)
  + `</div>`;
}

/* ============================================================ TOP 20 */
let TOPTAB = lsEnum('l9toptab', ['ml', 'bp'], 'ml');   // 휴대폰: TOP 20 두 순위 중 보이는 쪽
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
    <div class="tops" data-tab="${esc(TOPTAB)}">
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
// 예전에 잘못 읽힌 사냥터 이름('심연 1층')을 알려진 이름('태고의 심연 1층')으로 고침
function fixExpPlaces(){
  let ch = false;
  for(const r of expRecs()){ const b = basePlace(r.place), v = cleanPlace(b);
    if(v !== b && PLACES.includes(v)){ r.place = v + r.place.slice(b.length); ch = true; } }
  if(ch) saveStore();
}
function pageExp(){
  fixExpPlaces();
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
          <div class="f"><label>획득 경험치 (M)</label><input id="exGain" inputmode="decimal" value="${e ? esc(e.exp) : ''}" placeholder="예: 678,513,354 또는 6.8억"></div>
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
          <td style="white-space:nowrap"><button class="mini-btn" data-act="exp-edit" data-id="${esc(r.id)}">수정</button> <button class="mini-btn" data-act="exp-del" data-id="${esc(r.id)}">삭제</button></td></tr>`; }).join('')
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
  if(out.exp > 1e15) out.exp = null;     // 말이 안 되는 큰 숫자는 인식 실패로 처리
  if(out.secs > 1e7) out.secs = 0;
  if(out.exp == null){ // "Exp" 글자를 못 읽은 경우: (0.0238%) 처럼 % 가 붙은 첫 숫자
    for(const l of lines){ const x = l.match(/(\d[\d,.]{3,})\s*\(\s*[\d.]+\s*%/); if(x){ out.exp = Number(x[1].replace(/\D/g, '')); break; } }
    if(out.exp > 1e15) out.exp = null;
  }
  return out;
}
let TESS = null;
function loadTess(){
  if(TESS) return TESS;
  TESS = new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; s.integrity = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F'; s.crossOrigin = 'anonymous';
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
  t = t.replace(/(\d)\s*[충총증]$/, '$1층').replace(/(\d)\s*[충총증](\s)/, '$1층$2');   // '1충' → '1층' (자주 틀리는 글자)
  const sp = x => x.replace(/\s/g, '');
  const T = sp(t);
  const known = [...new Set(expRecs().map(r => basePlace(r.place)).concat(PLACES))].filter(x => x && x !== '알 수 없는 사냥터').sort((a, b) => b.length - a.length);
  for(const k of PLACES){ if(T === sp(k)) return k; }
  if(T.length >= 3){ const l = PLACES.filter(k => sp(k).endsWith(T)); if(l.length === 1) return l[0]; }   // 알려진 이름의 뒷부분만 읽힘
  for(const k of known){ if(T === sp(k)) return k; }                                      // 띄어쓰기만 다름
  for(const k of known){ if(T.endsWith(sp(k)) && T.length - sp(k).length <= 3) return k; }  // 앞에 잡글자
  // 앞부분을 못 읽음 ('심연 1층' → '태고의 심연 1층'): 그렇게 끝나는 사냥터가 하나뿐일 때만
  if(T.length >= 3){ const l = PLACES.concat(known).filter((k, i, a) => a.indexOf(k) === i && sp(k).endsWith(T) && sp(k) !== T); if(l.length === 1) return l[0]; }
  for(const k of known){ if(T.length >= 4 && lev(T, sp(k)) <= 1) return k; }               // 한 글자 틀림
  return t;
}
// 알려진 사냥터 이름 (캡처에서 일부만 읽혔을 때 맞춰 줌). 기록한 사냥터 이름도 함께 씀
const PLACES = ['태고의 심연 1층', '태고의 심연 2층', '에르바노크', '그림자 숲'];
function lev(a, b){ const m = a.length, n = b.length; if(Math.abs(m - n) > 1) return 9; const d = Array.from({length: m + 1}, (_, i) => [i]); for(let j = 1; j <= n; j++) d[0][j] = j;
  for(let i = 1; i <= m; i++) for(let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
// 두 번 읽은 결과 중 더 나은 사냥터 이름: 알려진 이름과 맞는 쪽 → 한글이 더 많은 쪽
function bestPlace(list){
  const c = list.filter(Boolean).map(x => ({raw: x, v: cleanPlace(x)}));
  if(!c.length) return '';
  const known = new Set(PLACES.concat(expRecs().map(r => basePlace(r.place))));
  const hit = c.filter(x => known.has(x.v)); if(hit.length) return hit.sort((a, b) => b.v.length - a.v.length)[0].v;
  return c.sort((a, b) => (b.v.match(/[가-힣]/g) || []).length - (a.v.match(/[가-힣]/g) || []).length)[0].v;
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
  const r = {id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19), place: uniqPlace(cleanPlace(place) || '알 수 없는 사냥터').slice(0, 100), exp, secs};
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
      // 원본과 2배 확대본을 모두 읽어서 더 정확한 쪽을 씀 (사냥터 이름 앞부분이 빠지는 경우 대비)
      const p1 = parseExpText((await w.recognize(s.file)).data.text);
      const p2 = parseExpText((await w.recognize(await scaled(s.file, 2))).data.text);
      const p = {exp: p1.exp || p2.exp, secs: p1.secs || p2.secs, place: bestPlace([p1.place, p2.place])};
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
function route(){ const r = (location.hash || '#my').slice(1); return ['my', 'guild', 'rank', 'top', 'stats', 'chg', 'drop', 'exp', 'lvl', 'track', 'help'].includes(r) ? r : r === 'fav' ? 'track' : 'my'; }
let RENDERING = null;
/* ============================================================ 드랍율 (v1.6.0 몬스터, v1.7.0 상자 추가)
   data/drops.json — dropdb.py 로 만든 작은 파일. 몬스터 드랍 줄(d)과 상자 내용물 줄(b)을 한 줄 번호로 다룸:
   줄 번호 i < G.nm 이면 몬스터 줄, 그 밖은 상자 줄 (G.u = d 뒤에 b 를 이어 붙인 5칸 배열).
   효율: 몬스터 = 1,000마리당 기대 개수(드랍율 × 평균 수량), 사냥터 = 그 사냥터 몬스터를 고르게 잡을 때 1,000마리당 기대 개수,
   상자 = 1,000개 열 때 기대 개수 */
const DR = (() => {
  const x = pickVals(lsJson('l9drop', sessionStorage), {q: ['s', 60], by: ['e', ['', 'item', 'mon', 'map']], map: ['n', -1, 9999], tier: ['n', -1, 99],
    gs: ['s', 20], sort: ['e', ['rate', 'grade', 'name', 'src']], item: ['n', -1, 999999], view: ['e', ['src', 'map']], eb: ['e', ['hunt', 'all']], sk: ['e', ['', 'mon', 'box']]}, {});
  return Object.assign({q: '', by: '', map: -1, tier: -1, gs: '', sort: 'rate', item: -1, view: 'src', eb: 'hunt', sk: ''}, x, {more: 60, dmore: 40});
})();
function saveDR(){ try{ sessionStorage.setItem('l9drop', JSON.stringify({q: DR.q, by: DR.by, map: DR.map, tier: DR.tier, gs: DR.gs, sort: DR.sort, item: DR.item, view: DR.view, eb: DR.eb, sk: DR.sk})); }catch(e){} }
let DROPS = null, DROPS_ERR = '';
async function loadDrops(){
  if(DROPS || DROPS_ERR) return DROPS;
  try{
    const j = await getJSON('data/drops.json');
    if(!j || j.v !== 1 || !Array.isArray(j.d) || !Array.isArray(j.items) || !Array.isArray(j.mons)) throw new Error('드랍 데이터 형식이 맞지 않습니다');
    const b = Array.isArray(j.b) ? j.b : [], boxes = Array.isArray(j.boxes) ? j.boxes : [];
    const nm = Math.floor(j.d.length / 5), u = j.d.concat(b), n = Math.floor(u.length / 5);
    const byItem = new Map(), mapMons = new Array(j.maps.length).fill(0), mapHunt = new Array(j.maps.length).fill(0), hunt = new Set(['일반', '정예'].map(t => j.tiers.indexOf(t)));
    for(let i = 0; i < n; i++){ const ii = u[i * 5 + 1]; let a = byItem.get(ii); if(!a) byItem.set(ii, a = []); a.push(i); }
    for(const m of j.mons) for(const p of m[4] || []) if(p >= 0 && p < mapMons.length){ mapMons[p]++; if(hunt.has(m[3])) mapHunt[p]++; }
    const lower = s => String(s || '').toLowerCase().replace(/\s+/g, '');   // 띄어쓰기 무시 검색
    DROPS = Object.assign(j, {u, nm, n, boxes, byItem, mapMons, mapHunt, hunt, itemL: j.items.map(it => lower(it[1])), monL: j.mons.map(m => lower(m[1])), boxL: boxes.map(x => lower(x[1])), mapL: j.maps.map(lower)});
  }catch(e){ DROPS_ERR = /404/.test(e.message || '') ? 'none' : (e.message || String(e)); }
  return DROPS;
}
const GRADE_C = ['#c9d3dc', '#7dffb0', '#6cb8ff', '#d39bff', '#ffb35c', '#ff6b6b'];
function dropBase(G){   // 드랍표 기준 날짜 · 게임 버전
  const m = /(20\d\d)[-./ ]?(\d{1,2})[-./ ]?(\d{1,2})/.exec(G.date || G.ver || '');
  let d = '';
  if(m){ const dt = new Date(+m[1], +m[2] - 1, +m[3]); d = `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}(${'일월화수목금토'[dt.getDay()]}) 업데이트`; }
  return {d, gv: G.gv || '', made: G.made || ''};
}
function gradeTag(G, gi){ return `<span class="drg" style="color:${GRADE_C[gi] || 'var(--ink)'}">${esc(G.grades[gi] || '')}</span>`; }
function rateStr(r){ return r >= 100 ? nf(Math.round(r * 10) / 10) + '%' : r >= 1 ? r.toFixed(2).replace(/\.?0+$/, '') + '%' : r >= 0.001 ? r.toPrecision(3).replace(/\.?0+$/, '') + '%' : r >= 0.0001 ? r.toPrecision(2).replace(/\.?0+$/, '') + '%' : '0.0001% 미만'; }
function oneIn(r, unit){ if(r >= 100) return '매번'; const k = 100 / r; return k >= 1e8 ? '사실상 없음' : '약 ' + (k >= 100 ? nf(Math.round(k)) : k.toFixed(k < 10 ? 1 : 0)) + (unit || '마리'); }
function oneInT(r, unit){ const s = oneIn(r, unit); return r >= 100 ? '매번 나옴' : s === '사실상 없음' ? s : s + '당 1번'; }
function amtStr(a, b){ return a === b ? nf(a) : nf(a) + '~' + nf(b); }
const isBox = (G, i) => i >= G.nm;
const srcOf = (G, i) => G.u[i * 5];                 // 몬스터 번호 또는 상자 번호
const rateOf = (G, i) => G.u[i * 5 + 2];
function expPer(G, i){ const o = i * 5; return G.u[o + 2] / 100 * (G.u[o + 3] + G.u[o + 4]) / 2; }   // 1마리 · 1개당 기대 개수
function expStr(v){ return v >= 100 ? nf(Math.round(v)) : v >= 0.01 ? v.toFixed(2).replace(/\.?0+$/, '') : v > 0 ? '0.01 미만' : '0'; }
const condBox = (G, i) => isBox(G, i) && !!G.boxes[srcOf(G, i)][4];
const unitOf = (G, i) => isBox(G, i) ? '개' : '마리';
function srcMaps(G, i){ return isBox(G, i) ? [] : (G.mons[srcOf(G, i)][4] || []); }
function srcNameL(G, i){ return isBox(G, i) ? G.boxL[srcOf(G, i)] : G.monL[srcOf(G, i)]; }
function dropRowOk(G, i, q){
  const box = isBox(G, i);
  if(DR.sk === 'mon' && box || DR.sk === 'box' && !box) return false;
  if(box && (DR.map >= 0 || DR.tier >= 0)) return false;           // 사냥터 · 몬스터 구분을 고르면 몬스터만
  if(!box){
    const m = G.mons[srcOf(G, i)];
    if(DR.map >= 0 && !(m[4] || []).includes(DR.map)) return false;
    if(DR.tier >= 0 && m[3] !== DR.tier) return false;
  }
  if(q && DR.by === 'mon' && !srcNameL(G, i).includes(q)) return false;
  if(q && DR.by === 'map' && !srcMaps(G, i).some(p => G.mapL[p].includes(q))) return false;
  return true;
}
function dropSearch(G){
  const q = DR.q.toLowerCase().replace(/\s+/g, ''), gs = new Set(DR.gs.split(',').filter(Boolean).map(Number)), out = [];
  for(const [ii, rows] of G.byItem){
    const it = G.items[ii];
    if(gs.size && !gs.has(it[2])) continue;
    const nameHit = !q || G.itemL[ii].includes(q);
    if(DR.by === 'item' && !nameHit) continue;
    let src = rows.filter(i => dropRowOk(G, i, q));
    if(q && DR.by === '' && !nameHit) src = src.filter(i => srcNameL(G, i).includes(q) || srcMaps(G, i).some(p => G.mapL[p].includes(q)));
    if(!src.length) continue;
    // 최고 확률: '조건 지급 의심' 상자는 확률을 믿기 어려우므로 다른 출처가 있으면 그쪽에서 고름
    const sure = src.filter(i => !condBox(G, i)), pool = sure.length ? sure : src;
    let best = pool[0], nb = 0; for(const i of pool) if(rateOf(G, i) > rateOf(G, best)) best = i;
    for(const i of src) if(isBox(G, i)) nb++;
    out.push({ii, it, src, best, rate: rateOf(G, best), nb, nmo: src.length - nb});
  }
  const s = DR.sort;
  out.sort(s === 'grade' ? (a, b) => b.it[2] - a.it[2] || b.rate - a.rate : s === 'name' ? (a, b) => a.it[1].localeCompare(b.it[1], 'ko') : s === 'src' ? (a, b) => b.src.length - a.src.length || b.rate - a.rate : (a, b) => b.rate - a.rate || b.it[2] - a.it[2]);
  return out;
}
function mapEff(G, src){
  // 사냥터별: 이 아이템을 주는 몬스터의 기대 개수 합 ÷ 그 사냥터의 몬스터 종류 수 (고르게 잡을 때 1마리당). 상자는 제외
  const m = new Map(), all = DR.eb === 'all';
  for(const i of src){
    if(isBox(G, i)) continue;
    const mo = G.mons[srcOf(G, i)], e = expPer(G, i);
    if(!all && !G.hunt.has(mo[3])) continue;      // 기본: 보스 · 네임드처럼 가끔 나오는 몬스터는 사냥터 효율에서 뺌
    for(const p of mo[4] || []){ if(G.maps[p] === '기타') continue; let o = m.get(p); if(!o) m.set(p, o = {p, sum: 0, n: 0, best: i}); o.sum += e; o.n++; if(e > expPer(G, o.best)) o.best = i; }
  }
  return [...m.values()].map(o => Object.assign(o, {tot: (all ? G.mapMons : G.mapHunt)[o.p], eff: o.sum / Math.max(1, (all ? G.mapMons : G.mapHunt)[o.p])})).sort((a, b) => b.eff - a.eff);
}
function srcTitle(G, i){   // 출처 이름 + 설명
  const s = srcOf(G, i);
  if(isBox(G, i)){ const x = G.boxes[s]; return `<span class="drk box">상자</span>${esc(x[1])} <span class="sub" style="display:inline">${esc(G.grades[x[2]] || '')} · ${nf(x[3])}칸 추첨</span>${x[4] ? '<span class="cfb c2" title="모든 칸이 100%인 상자 — 직업 · 조건에 따라 하나만 지급될 가능성이 큼. 확률을 그대로 믿지 마세요">조건 지급 의심</span>' : ''}`; }
  const m = G.mons[s]; return `<span class="drk mon">몬스터</span>${esc(m[1])} <span class="sub" style="display:inline">Lv.${m[2]} · ${esc(G.tiers[m[3]] || '')}</span>`;
}
function srcWhere(G, i){ if(isBox(G, i)) return '<span class="sub">상자를 열 때</span>'; const p = srcMaps(G, i); return p.length ? p.map(x => esc(G.maps[x])).join(', ') : '<span class="sub">사냥터 정보 없음</span>'; }
function srcShort(G, i){ return esc((isBox(G, i) ? G.boxes : G.mons)[srcOf(G, i)][1]); }
function kv(txt, unit){   // KPI 값: 숫자는 큰 숫자 글꼴, 단위 · 글자는 작게 (글꼴이 섞여 줄이 어긋나지 않게)
  const m = /^([0-9.,%~\-]+)(.*)$/.exec(String(txt));
  if(!m) return `<span class="u">${esc(txt)}</span>`;
  const w = m[2].trim(), rest = (w === '미만' && unit ? unit + ' 미만' : w + (unit || '')).trim();
  return esc(m[1]) + (rest ? `<span class="u">${esc(rest)}</span>` : '');
}
function nu(txt){ return kv(txt).replace('<span class="u">', '<span class="u2">'); }   // 표 칸: 숫자 뒤 '미만' 같은 글자는 작게
function dropDetail(G, r){
  const it = r.it, src = r.src.slice(), eff = mapEff(G, src);
  const mons = src.filter(i => !isBox(G, i)), bx = src.filter(i => isBox(G, i));
  const pick = (a, f) => a.length ? a.reduce((x, i) => f(i) > f(x) ? i : x, a[0]) : -1;
  const bestMon = pick(mons, i => expPer(G, i));
  const bxOk = bx.filter(i => !G.boxes[srcOf(G, i)][4]), bestBox = pick(bxOk.length ? bxOk : bx, i => rateOf(G, i));
  src.sort((a, b) => rateOf(G, b) - rateOf(G, a));
  const top = eff[0], all = r.src.length < (G.byItem.get(r.ii) || []).length;
  const kp = [
    ['최고 확률', kv(rateStr(r.rate)), `${srcShort(G, r.best)} · ${oneInT(r.rate, unitOf(G, r.best))}${condBox(G, r.best) ? ' · 조건 지급 의심' : ''}`],
    ['몬스터 효율 1위', bestMon >= 0 ? kv(expStr(expPer(G, bestMon) * 1000), '개') : '--', bestMon >= 0 ? `${srcShort(G, bestMon)} · 1,000마리당 기대 개수` : '몬스터는 주지 않음'],
    ['사냥터 효율 1위', top ? kv(expStr(top.eff * 1000), '개') : '--', top ? `${esc(G.maps[top.p])} · ${DR.eb === 'all' ? '전체' : '일반 · 정예'} 고르게 1,000마리 잡을 때` : (!mons.length ? '몬스터는 주지 않음' : DR.eb === 'all' ? '사냥터 정보 없음' : '일반 · 정예는 주지 않음')],
    ['상자 1위', bestBox >= 0 ? kv(rateStr(rateOf(G, bestBox))) : '--', bestBox >= 0 ? `${srcShort(G, bestBox)} · ${oneInT(rateOf(G, bestBox), '개')}${G.boxes[srcOf(G, bestBox)][4] ? ' · 조건 지급 의심' : ''}` : '상자에서는 나오지 않음'],
    ['나오는 곳', kv(nf(src.length), '곳'), `몬스터 ${nf(mons.length)}${G.boxes.length ? ` · 상자 ${nf(bx.length)}` : ''}${eff.length ? ` · 사냥터 ${nf(eff.length)}` : ''}`]];
  if(!G.boxes.length) kp.splice(3, 1);   // 상자 없는 드랍표(몬스터 전용)
  const srcT = `<div class="tbl" style="margin:0;border:0"><table class="rk drt"><tr><th class="l">출처</th><th class="l">어디서</th><th>확률</th><th>몇 번당 1번</th><th class="hide-s">한 번에</th><th>1,000번당 기대 개수</th></tr>
    ${src.slice(0, DR.dmore).map(i => { const o = i * 5, d = G.u, hot = i === bestMon || i === bestBox; return `<tr${hot ? ' class="drbest"' : ''}><td class="l">${srcTitle(G, i)}${i === bestMon ? '<span class="cfb c1">몬스터 효율 1위</span>' : i === bestBox ? '<span class="cfb c1">상자 1위</span>' : ''}</td><td class="l drmap">${srcWhere(G, i)}</td>
      <td><b class="dg">${nu(rateStr(d[o + 2]))}</b></td><td>${oneIn(d[o + 2], unitOf(G, i))}</td><td class="hide-s">${amtStr(d[o + 3], d[o + 4])}개</td><td class="dg">${nu(expStr(expPer(G, i) * 1000))}</td></tr>`; }).join('')}</table></div>
    ${cgMore('dr-dmore', src.length - DR.dmore, '곳')}
    <div class="sub" style="padding:8px 16px">몬스터는 1마리 처치, 상자는 1개 열기 기준입니다. '조건 지급 의심' 상자는 모든 칸이 100%라 직업 · 조건에 따라 그중 하나만 받을 가능성이 커서 표의 확률을 그대로 믿으면 안 됩니다.</div>`;
  const mapT = eff.length ? `<div class="tbl" style="margin:0;border:0"><table class="rk drt"><tr><th>순위</th><th class="l">사냥터</th><th>효율 (1,000마리당)</th><th>드랍 몬스터</th><th class="l">가장 잘 주는 몬스터</th><th>그 몬스터 드랍율</th></tr>
    ${eff.map((o, k) => `<tr${k === 0 ? ' class="drbest"' : ''}><td class="dg">${k + 1}</td><td class="l">${esc(G.maps[o.p])}${k === 0 ? '<span class="cfb c1">효율 1위</span>' : ''}</td><td><b class="dg">${nu(expStr(o.eff * 1000))}</b><span class="u2">개</span></td>
      <td>${nf(o.n)} / ${nf(o.tot)}종</td><td class="l">${srcTitle(G, o.best)}</td><td class="dg">${nu(rateStr(rateOf(G, o.best)))}</td></tr>`).join('')}</table></div>
    <div class="sub" style="padding:8px 16px">효율 = 그 사냥터에 나오는 ${DR.eb === 'all' ? '모든' : '일반 · 정예'} 몬스터 종류를 고르게 잡는다고 볼 때 1,000마리당 기대 개수입니다 (몬스터 수 · 리젠 속도는 반영하지 않음). 출현 장소가 '기타'(이벤트 던전 등)이거나 사냥터 정보가 없는 몬스터(${nf(mons.filter(i => { const p = srcMaps(G, i); return !p.length || p.every(x => G.maps[x] === '기타'); }).length)}종)${G.boxes.length ? '와 상자' : ''}는 출처별 표에만 있습니다.</div>`
    : `<div class="empty" style="padding:14px 16px">${!mons.length ? '몬스터는 이 아이템을 주지 않습니다 (상자에서만 나옴) — 출처별 표를 보세요' : DR.eb === 'all' ? '이 아이템을 주는 몬스터의 사냥터 정보가 없습니다' : '일반 · 정예 몬스터는 이 아이템을 주지 않습니다 (보스 · 네임드 · 기타만) — 위에서 <b>보스 · 네임드 포함</b>을 누르거나 출처별 표를 보세요'}</div>`;
  return `<div class="drdet">
    <div class="sec">${esc(it[1])} ${gradeTag(G, it[2])} <small>아이템 ID ${it[0]}</small><button class="btn" data-act="dr-close" style="margin-left:auto">목록으로</button></div>
    ${all ? `<div class="sub" style="padding:8px 16px;color:var(--amb)">위에서 고른 조건(출처 · 사냥터 · 몬스터 구분 · 이름 검색)에 맞는 곳만으로 계산했습니다 (${nf(r.src.length)} / ${nf((G.byItem.get(r.ii) || []).length)}곳). 전체를 보려면 [조건 지우기] 후 다시 여세요.</div>` : ''}
    <div class="kpis drkpis${kp.length === 4 ? ' k4' : ''}">${kp.map(([l, v, s]) => `<div class="kpi"><div class="lb">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('')}</div>
    <div class="ctrls"><span class="lbl">보기</span>${seg('dr-view', DR.view, [['src', `출처별 ${nf(src.length)}`], ['map', `사냥터별 효율 ${nf(eff.length)}`]])}
      ${DR.view === 'map' ? `<span class="lbl">사냥터 효율 계산</span>${seg('dr-eb', DR.eb, [['hunt', '일반 · 정예만'], ['all', '보스 · 네임드 포함']])}` : ''}</div>
    ${DR.view === 'map' ? mapT : srcT}</div>`;
}
async function pageDrop(){
  const G = await loadDrops();
  if(!G) return blank('드랍율 데이터가 없습니다', DROPS_ERR === 'none'
    ? (D.local ? '프로그램 폴더에서 4_드랍DB만들기.bat 를 실행해 data\\web\\data\\drops.json 을 만드세요' : '저장소 site 폴더에 drops.l9e 를 올리면 다음 배포부터 보입니다 (사용 설명서 참고)')
    : esc(DROPS_ERR));
  if(!G.boxes.length && DR.sk){ DR.sk = ''; saveDR(); }
  const res = dropSearch(G);
  const sel = DR.item >= 0 ? res.find(r => r.ii === DR.item) : null;
  const gs = new Set(DR.gs.split(',').filter(Boolean).map(Number));
  const mapOpts = G.maps.map((m, i) => [i, m]).sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  const ng = Math.min(G.grades.length, 6);
  const ctrls = `<div class="ctrls"><input class="q" data-in="dr-q" value="${esc(DR.q)}" placeholder="${G.boxes.length ? '아이템 · 몬스터 · 상자 · 사냥터 이름' : '아이템 · 몬스터 · 사냥터 이름'}" style="width:240px">
      <span class="lbl">찾는 곳</span>${seg('dr-by', DR.by, [['', '전체'], ['item', '아이템'], ['mon', G.boxes.length ? '몬스터 · 상자' : '몬스터'], ['map', '사냥터']])}
      <span class="sp"></span><span class="lbl">정렬</span><select data-ch="dr-sort">${[['rate', '확률 높은 순'], ['grade', '등급 높은 순'], ['src', '나오는 곳 많은 순'], ['name', '이름 순']].map(([v, l]) => `<option value="${v}"${DR.sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="ctrls">${G.boxes.length ? `<span class="lbl">출처</span>${seg('dr-sk', DR.sk, [['', '전체'], ['mon', '몬스터'], ['box', '상자']])}` : ''}
      <span class="lbl">등급</span><div class="seg">${G.grades.slice(0, ng).map((g, i) => `<button data-act="dr-g" data-v="${i}" class="${gs.has(i) ? 'on' : ''}" style="${gs.has(i) ? '' : `color:${GRADE_C[i] || ''}`}">${esc(g)}</button>`).join('')}</div>
      ${DR.sk === 'box' ? '' : `<span class="lbl">사냥터</span><select data-ch="dr-map"><option value="-1">전체</option>${mapOpts.map(([i, m]) => `<option value="${i}"${DR.map === i ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>
      <span class="lbl">몬스터</span><select data-ch="dr-tier"><option value="-1">전체</option>${G.tiers.map((t, i) => `<option value="${i}"${DR.tier === i ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`}
      ${DR.q || DR.by || DR.map >= 0 || DR.tier >= 0 || DR.gs || DR.sk ? '<button class="btn" data-act="dr-reset">조건 지우기</button>' : ''}</div>`;
  const list = res.length ? `<div class="tbl" style="margin:0;border:0"><table class="rk drt"><tr><th class="l">아이템</th><th>등급</th><th>최고 확률</th><th class="l">가장 잘 나오는 곳</th><th class="l hide-s">어디서</th><th>나오는 곳</th></tr>
      ${res.slice(0, DR.more).map(r => `<tr class="rkrow" data-act="dr-item" data-v="${r.ii}" tabindex="0"><td class="l"><b style="color:${GRADE_C[r.it[2]] || ''}">${esc(r.it[1])}</b></td><td>${gradeTag(G, r.it[2])}</td>
        <td><b class="dg">${nu(rateStr(r.rate))}</b><div class="sub">${oneInT(r.rate, unitOf(G, r.best))}</div></td><td class="l">${srcTitle(G, r.best)}</td><td class="l hide-s drmap">${srcWhere(G, r.best)}</td>
        <td>${r.nmo ? `몬스터 ${nf(r.nmo)}` : ''}${r.nmo && r.nb ? '<br>' : ''}${r.nb ? `상자 ${nf(r.nb)}` : ''}</td></tr>`).join('')}</table></div>
      ${cgMore('dr-more', res.length - DR.more, '개')}`
    : `<div class="empty" style="padding:14px 16px">조건에 맞는 아이템이 없습니다${G.boxes.length ? '' : ' (이 드랍표에는 상자 내용물이 없습니다)'}</div>`;
  const b0 = dropBase(G);
  return `<section class="ov fr">${NODES}
    <div class="bar"><span class="sid g">드랍율</span><span style="margin-left:auto;font-size:12px;color:var(--dim)">몬스터 ${nf(G.mons.length)}종${G.boxes.length ? ` · 상자 ${nf(G.boxes.length)}종` : ''} · 아이템 ${nf(G.items.length)}종</span></div>
    <div class="drbase"><span>드랍표 기준 <b>${esc(b0.d || G.ver || '알 수 없음')}</b></span>${b0.gv ? `<span>게임 버전 <b>${esc(b0.gv)}</b></span>` : ''}<span>출처 <b>로드나인 PC 클라이언트 데이터</b></span>${b0.made ? `<span class="sub">표 만든 날 ${esc(b0.made)}</span>` : ''}</div>
    ${cgNote(`아이템 · 몬스터 · 상자 · 사냥터 이름으로 찾고, 출처(몬스터/상자) · 등급 · 사냥터 · 몬스터 구분으로 좁힐 수 있습니다. 아이템을 누르면 어디서 가장 잘 나오는지 보여 줍니다.
      <br><b>몬스터 드랍율</b> = 1마리 처치당 기대 획득 횟수(%) — 낮을 때는 드랍 확률과 같고, 골드처럼 여러 번 나오는 항목은 100%를 넘을 수 있습니다.
      <br><b>상자 확률</b> = 상자 1개를 열 때 나올 확률(%) — 여러 칸에서 나오면 합산, 100%를 넘으면 기대 개수. '조건 지급 의심' 상자는 직업 · 조건에 따라 하나만 받을 수 있어 확률을 그대로 믿으면 안 됩니다.
      <br><b>몬스터 효율</b> = 1,000마리 잡을 때 기대 개수(드랍율 × 평균 수량). <b>사냥터 효율</b> = 그 사냥터 몬스터를 고르게 1,000마리 잡을 때 기대 개수 — 기본은 늘 사냥하는 일반 · 정예만 (보스 · 네임드는 가끔 나오므로 따로 고를 수 있음).
      <br>${esc(G.note || '이벤트 한정 드랍 · 레벨 차이 보정 · 서버 보정은 반영하지 않았습니다')}. 게임 패치 뒤에는 데이터를 다시 만들어야 합니다.`)}
    ${ctrls}
    ${sel ? dropDetail(G, sel) : `<div class="sec">검색 결과 <small>${nf(res.length)}개</small></div>${list}`}
  </section>`;
}

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
        html = r === 'rank' ? await pageRank() : r === 'top' ? await pageTop() : r === 'stats' ? await pageStats() : r === 'exp' ? pageExp() : r === 'lvl' ? pageLvl() : r === 'track' ? await pageTrack() : r === 'guild' ? await pageGuild() : r === 'chg' ? await pageChg() : r === 'drop' ? await pageDrop() : r === 'help' ? pageHelp() : await pageMy();
      }catch(e){ html = blank('불러오기 오류', esc(e.message || e)); }
      const focus = document.activeElement?.dataset?.in;
      const pos = focus ? document.activeElement.selectionStart : 0;
      $('#main').innerHTML = NB(html);
      if(r === 'lvl') initLvl();
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
// 검색 결과 (모든 월드에서 한 번에 찾고, 월드 · 서버로 좁힘)
const SR = {q: '', hits: [], w: 0, s: 0, lim: 100, tok: 0};
async function setSearchMode(m){
  SMODE = m; SR.tok++;
  $('#sTab').querySelectorAll('[data-st]').forEach(b => b.classList.toggle('on', b.dataset.st === m));
  $('#sLabel').textContent = m === 'guild' ? '길드명' : '캐릭터 명';
  $('#addName').placeholder = m === 'guild' ? '예: 별빛' : '예: 스타일러';
  $('#sHint').innerHTML = NB(m === 'guild'
    ? '모든 월드에서 한 번에 찾습니다. 길드명을 입력하고 [찾기] → 월드 · 서버로 좁힌 뒤 길드를 누르면 [길드]에 정보가 표시됩니다.<br>' + critText() + '입니다.'
    : '모든 월드에서 한 번에 찾습니다. 캐릭터 명 일부만 입력하고 [찾기] → 월드 · 서버로 좁힌 뒤 캐릭터를 누르면 [캐릭터]에 표시됩니다.<br>' + critText().replace(' 기준', '') + ' 캐릭터만 검색됩니다.');
  SR.q = ''; SR.hits = []; SR.w = 0; SR.s = 0; SR.lim = 100;
  $('#sFil').hidden = true; $('#sFil').innerHTML = '';
  $('#cands').innerHTML = m === 'guild' && !readyWorlds().length ? '<span style="color:var(--dim);font-size:12px">길드 검색은 전체 수집 데이터가 있어야 합니다 — 첫 수집이 끝나면 쓸 수 있습니다.</span>' : '';
  if($('#addName').value.trim()) await findNames();
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
const SEMPTY = t => `<span style="color:var(--dim);font-size:12px">${t}</span>`;
async function findNames(){
  const q = $('#addName').value.trim(); if(!q) return;
  const tok = ++SR.tok, mode = SMODE;   // 늦게 온 이전 검색 결과가 새 결과를 덮지 않도록
  SR.q = q; SR.w = 0; SR.s = 0; SR.lim = 100; SR.hits = [];
  $('#sFil').hidden = true;
  $('#cands').innerHTML = '<span class="spin"></span>찾는 중';
  try{
    if(SMODE === 'guild'){
      const gh = (await findGuilds(q)).map(g => ({w: g.w, s: g.s, g}));
      if(tok !== SR.tok || mode !== SMODE) return;
      SR.hits = gh;
    } else {
      // 1) 수집 데이터 (준비된 모든 월드)
      const hits = [];
      for(const j of await allWorlds()) for(const r of j.rows) if(r[C.n].includes(q)) hits.push({w: r[C.w], s: r[C.s], n: r[C.n], r});
      hits.sort((a, b) => (b.r[C.bp] || 0) - (a.r[C.bp] || 0));
      // 2) 내 PC
      if(D.local){
        // 수집 기준 밖 캐릭터도 찾도록 모든 월드를 사이트에서 이름만 실시간 조회해 수집 데이터에 없는 이름을 덧붙임
        const have = new Set(hits.map(x => key(x.w, x.n)));
        const rest = (await addWorlds()).map(w => Number(w[0]));
        const got = await Promise.all(rest.map(wc => localApi('api/names?world=' + wc + '&q=' + encodeURIComponent(q)).then(r => [wc, r.names || []]).catch(() => [wc, null])));
        if(!hits.length && got.length && got.every(([, l]) => l === null)) throw new Error('게임 사이트에 연결할 수 없습니다');
        for(const [wc, l] of got) for(const n of l || []) if(!have.has(key(wc, n))) hits.push({w: wc, s: 0, n, r: null});
      }
      if(tok !== SR.tok || mode !== SMODE) return;
      SR.hits = hits;
    }
    drawCands();
  }catch(e){ if(tok === SR.tok) $('#cands').textContent = '오류: ' + e.message; }
}
function drawCands(){
  const all = SR.hits, guild = SMODE === 'guild';
  if(!all.length){
    $('#sFil').hidden = true;
    $('#cands').innerHTML = SEMPTY(guild ? '찾는 길드가 없습니다 — 길드원이 모두 수집 기준 밖이면 검색되지 않습니다.' : '후보 없음 — 수집 기준 밖이면 검색되지 않습니다.');
    return;
  }
  // 월드별 · 서버별 개수
  const wc = new Map(); for(const x of all) wc.set(x.w, (wc.get(x.w) || 0) + 1);
  if(SR.w && !wc.has(SR.w)){ SR.w = 0; SR.s = 0; }
  const inW = all.filter(x => !SR.w || x.w === SR.w);
  const sc = new Map(); if(SR.w) for(const x of inW) if(x.s) sc.set(x.s, (sc.get(x.s) || 0) + 1);
  if(SR.s && !sc.has(SR.s)) SR.s = 0;
  const view = inW.filter(x => !SR.s || x.s === SR.s);
  const order = [...wc.keys()].sort((a, b) => wc.get(b) - wc.get(a) || a - b);
  const chip = (attr, v, cur, label, n) => `<button type="button" class="chip ${v === cur ? 'on' : ''}" ${attr}="${v}">${esc(label)} <small>${nf(n)}</small></button>`;
  $('#sFil').innerHTML = NB(`<div class="sfr"><span class="lbl">월드</span><div class="chips">${chip('data-sw', 0, SR.w, '전체', all.length)}${order.map(w => chip('data-sw', w, SR.w, wName(w), wc.get(w))).join('')}</div></div>`
    + (SR.w && sc.size ? `<div class="sfr"><span class="lbl">서버</span><div class="chips">${chip('data-ss', 0, SR.s, '전체', inW.length)}${[...sc.keys()].sort((a, b) => a - b).map(s => chip('data-ss', s, SR.s, serverLabel(s), sc.get(s))).join('')}</div></div>` : ''));
  $('#sFil').hidden = false;
  const gn = ST.gnote || {};
  const item = guild
    ? x => { const g = x.g, nc = (gn[g.k] || []).length; return `<button type="button" data-g="${esc(g.k)}"><b>${esc(g.g)}</b> <small style="color:var(--dim)">${esc(gLabel(g))} · ${nf(g.rows.length)}명 · 평균 ${krShort(g.avg)}</small>${nc ? `<span class="cfb c3">코멘트 ${nc}</span>` : ''}</button>`; }
    : x => `<button type="button" data-w="${Number(x.w)}" data-n="${esc(x.n)}">${esc(x.n)} <small style="color:var(--dim)">${esc(wName(x.w))}${x.r ? ` ${serverLabel(x.r[C.s])} · ${esc(x.r[C.g] || '길드 없음')} · ${krShort(x.r[C.bp])}` : ' · 수집 데이터에 없음 (누르면 사이트에서 조회)'}</small></button>`;
  $('#cands').innerHTML = NB(view.slice(0, SR.lim).map(item).join('')
    + (view.length > SR.lim ? `<button type="button" class="smore" data-more="1">더 보기 (${nf(view.length - SR.lim)}${guild ? '개' : '명'} 남음)</button>` : ''));
}
function cardOf(k){ return CARDS.find(c => c.k === k); }
function openMastery(k){
  const c = cardOf(k); if(!c) return;
  $('#dlgM').dataset.k = k;
  $('#mTitle').innerHTML = '마스터리 입력 <small>' + esc(c.t.n) + '</small>';
  $('#mDate').value = todayKST();
  $('#mForm').innerHTML = masteryList().map(([code, name]) => { const m = c.ms[code];
    return `<div class="f"><label>${esc(name)}</label><input data-code="${esc(code)}" inputmode="numeric" value="${m ? esc(m.level) : ''}"><small>${m ? esc(m.date + ' ' + m.source) : '미입력'}</small></div>`; }).join('');
  $('#mInteg').value = c.integ ? c.integ.l : '';
  $('#mPct').value = c.integ && c.integ.p != null ? c.integ.p : '';
  $('#dlgM').showModal();
}
function openEdit(k){
  const c = cardOf(k); if(!c) return;
  $('#dlgE').dataset.k = k;
  $('#eWorld').innerHTML = (D.meta?.worlds || [{code: c.t.w, name: wName(c.t.w)}]).map(w => `<option value="${esc(w.code)}" ${w.code === c.t.w ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
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
  const q = v => { if(typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) v = "'" + v; v = v == null ? '' : String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
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
  BG.list = lsGet('l9bgmList', DEFAULT_PLAYLIST); if(!/^[A-Za-z0-9_-]{10,80}$/.test(BG.list)) BG.list = DEFAULT_PLAYLIST;
  BG.vol = Number(lsGet('l9bgmVol', 40)); if(!Number.isFinite(BG.vol)) BG.vol = 40; BG.vol = Math.min(100, Math.max(0, BG.vol)); BG.mini = lsGet('l9bgmMini', '1') === '1';
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
        memoMoveOut(ST.tracked.find(t => key(t.w, t.n) === k));
        ST.tracked = ST.tracked.filter(t => key(t.w, t.n) !== k); saveStore(); await render(); toast('추적을 해제했습니다 (메모는 남습니다)');
      }
    }
    else if(act === 'memo-save'){ memoSaveFrom(b); }
    else if(act === 'ovk'){ OVK = b.dataset.v; render(); }
    else if(act === 'backup') download(`로드나인_추적기_백업_${todayKST()}.json`, JSON.stringify(ST, null, 1), 'application/json');
    else if(act === 'restore') $('#fileBackup').click();
    // 범위 · 랭킹
    else if(act === 'sc-scope'){ SC.scope = b.dataset.v; saveSC(); RK.page = 0; render(); }
    else if(act === 'rk-by'){ RK.by = b.dataset.v; RK.page = 0; lsSet('l9rank', JSON.stringify({by: RK.by})); render(); }
    else if(act === 'top-tab'){ TOPTAB = b.dataset.v; lsSet('l9toptab', TOPTAB); await render(); }
    else if(act === 'my-reset'){ ST.cur = null; ST.recent = []; saveSession(); await render(); window.scrollTo({top: 0}); toast('캐릭터 화면을 초기화했습니다 (추적 · 메모는 그대로)'); }
    else if(act === 'cg-per'){ CG.per = Number(b.dataset.v); CG.page = 0; CG.mv = 24; CG.asm = 24; CG.ldm = 24; CG.gom = 50; saveCG(); await render(); }
    else if(act === 'cg-sorth'){ if(CG.sort === b.dataset.v) CG.dir = -(CG.dir || -1); else { CG.sort = b.dataset.v; CG.dir = CGDIR0[CG.sort] || -1; } CG.page = 0; saveCG(); await render(); }
    else if(act === 'cg-dir'){ CG.dir = -(CG.dir || -1); CG.page = 0; saveCG(); await render(); }
    else if(act === 'cg-cf'){ CG.cf = Number(b.dataset.v); CG.page = 0; saveCG(); await render(); }
    else if(act === 'cg-kind'){ CG.kind = Number(b.dataset.v); CG.page = 0; saveCG(); await render(); }
    else if(act === 'cg-page'){ CG.page = Math.max(0, Number(b.dataset.p)); await render(); document.getElementById('cglist')?.scrollIntoView({block: 'start'}); }
    else if(act === 'cg-more'){ CG.mv += 24; await render(); }
    else if(act === 'cg-ld'){ CG.ld = b.dataset.v; CG.ldm = 24; saveCG(); await render(); }
    else if(act === 'cg-ldmore'){ CG.ldm += 24; await render(); }
    else if(act === 'cg-gomore'){ CG.gom += 50; await render(); }
    else if(act === 'cg-asmore'){ CG.asm += 24; await render(); }
    else if(act === 'cg-tab'){ setCgTab(b.dataset.v); CG.page = 0; await render(); }
    else if(act === 'cg-reset'){ cgResetFilters(); await render(); }
    else if(act === 'cg-lcf'){ CG.lcf = Number(b.dataset.v); CG.ldm = 24; saveCG(); await render(); }
    else if(act === 'cg-mcf'){ CG.mcf = Number(b.dataset.v); CG.mv = 24; saveCG(); await render(); }
    else if(act === 'cg-mk'){ CG.mk = Number(b.dataset.v); CG.mv = 24; saveCG(); await render(); }
    else if(act === 'cg-msort'){ CG.msort = b.dataset.v; CG.mv = 24; saveCG(); await render(); }
    else if(act === 'dr-by'){ DR.by = b.dataset.v; DR.more = 60; DR.item = -1; saveDR(); await render(); }
    else if(act === 'dr-g'){ const s = new Set(DR.gs.split(',').filter(Boolean)); s.has(b.dataset.v) ? s.delete(b.dataset.v) : s.add(b.dataset.v); DR.gs = [...s].sort().join(','); DR.more = 60; DR.item = -1; saveDR(); await render(); }
    else if(act === 'dr-reset'){ Object.assign(DR, {q: '', by: '', map: -1, tier: -1, gs: '', sk: '', item: -1, more: 60}); saveDR(); await render(); }
    else if(act === 'dr-sk'){ DR.sk = b.dataset.v; if(DR.sk === 'box'){ DR.map = -1; DR.tier = -1; } DR.more = 60; DR.item = -1; saveDR(); await render(); }
    else if(act === 'dr-item'){ DR.item = Number(b.dataset.v); DR.dmore = 40; saveDR(); await render(); window.scrollTo({top: ($('#main').offsetTop || 0) - 10}); }
    else if(act === 'dr-close'){ DR.item = -1; saveDR(); await render(); }
    else if(act === 'dr-eb'){ DR.eb = b.dataset.v; saveDR(); await render(); }
    else if(act === 'dr-view'){ DR.view = b.dataset.v; saveDR(); await render(); }
    else if(act === 'dr-more'){ DR.more += 60; await render(); }
    else if(act === 'dr-dmore'){ DR.dmore += 60; await render(); }
    else if(act === 'cg-gw'){ CG.gw = b.dataset.v; CG.gom = 50; saveCG(); await render(); }
    else if(act === 'cg-gsort'){ CG.gsort = b.dataset.v; CG.gom = 50; saveCG(); await render(); }
    else if(act === 'cg-ak'){ CG.ak = b.dataset.v; CG.asm = 24; saveCG(); await render(); }
    else if(act === 'rk-page'){ RK.page = Math.max(0, Number(b.dataset.p)); await render(); window.scrollTo({top: $('#main').offsetTop - 10}); }
    else if(act === 'rk-goto'){ const i = Number(b.dataset.i); RK.q = ''; RK.page = Math.floor(i / PAGE); await render(); document.getElementById('rk-' + i)?.scrollIntoView({block:'center'}); }
    else if(act === 'track'){ ev.stopPropagation(); track(b.dataset.w, b.dataset.n); }
    else if(act === 'char') charDialog(Number(b.dataset.w), b.dataset.n);
    else if(act === 'g-find'){ GS.q = ($('#gq')?.value || '').trim(); GS.sel = null; const hs = GS.q ? await findGuilds(GS.q) : []; if(hs.length === 1) GS.sel = hs[0].k; saveGS(); await render(); if(GS.sel) $('#gdetail')?.scrollIntoView({behavior:'smooth', block:'start'}); }
    else if(act === 'g-open'){ GS.sel = k; saveGS(); await render(); $('#gdetail')?.scrollIntoView({behavior:'smooth', block:'start'}); }
    else if(act === 'g-reset'){ GS.q = ''; GS.sel = null; saveGS(); await render(); $('#gq')?.focus(); }
    else if(act === 'g-per'){ GS.per = Number(b.dataset.v); saveGS(); render(); }
    else if(act === 'gc-add'){ if(addGComment(k)){ await render(); toast('코멘트를 추가했습니다'); } }
    else if(act === 'gc-del'){
      const l = ST.gnote?.[k] || [], c = l.find(x => x.id === b.dataset.id);
      if(c && confirm(`이 코멘트를 삭제할까요?\n\n${c.t.slice(0, 80)}`)){ ST.gnote[k] = l.filter(x => x !== c); if(!ST.gnote[k].length) delete ST.gnote[k]; saveStore(); await render(); toast('코멘트를 삭제했습니다'); }
    }
    else if(act === 'g-trackall'){
      const g = (await guildIndex()).get(k); if(!g) return;
      const add = g.rows.filter(r => !isTracked(r));
      if(!add.length){ toast('이미 모두 추적 중입니다'); return; }
      if(ST.tracked.length + add.length > LIM.tracked){ toast(`추적은 최대 ${LIM.tracked}명까지입니다 (지금 ${ST.tracked.length}명 · 추가하려는 ${add.length}명)`); return; }
      if(!confirm(`${g.g} (${gLabel(g)}) 길드원 ${add.length}명을 모두 추적할까요?`)) return;
      for(const r of add) ST.tracked.push({w: r[C.w], n: r[C.n], added: todayKST(), ev: []});
      saveStore(); if(D.local) localApi('api/tracked', {chars: ST.tracked.map(t => [t.w, t.n])}).catch(() => {});
      toast(`${add.length}명을 추적에 추가했습니다 — [추적]에서 관리합니다`); render();
    }
    else if(act === 'guildgo'){ ev.preventDefault(); if($('#dlgR').open) $('#dlgR').close(); GS.q = b.dataset.g; openGuild(gkey(b.dataset.w, b.dataset.s, b.dataset.g)); }
    else if(act === 'setcur'){ setCur(b.dataset.w, b.dataset.n); await render(); window.scrollTo({top: 0}); }
    else if(act === 'tr-chk'){ TRCHK.has(k) ? TRCHK.delete(k) : TRCHK.add(k); render(); }
    else if(act === 'mv-apply'){ if(!confirm(`${b.dataset.on} → ${b.dataset.n} (${wName(b.dataset.w)}) 로 바꿀까요?\n추적 · 메모 · 입력한 마스터리가 함께 옮겨집니다.`)) return; applyMove(b.dataset.ow, b.dataset.on, b.dataset.w, b.dataset.n); toast('바꿨습니다'); await render(); }
    else if(act === 'lv-apply1'){ if(LVMINE){ $('#lv-my').value = LVMINE; lvCalc(); $('#lv-my').scrollIntoView({behavior: 'smooth', block: 'center'}); } }
    else if(act === 'lv-apply2'){ if(LVEST){ $('#lv-op').value = LVEST.top[0]; lvCalc(); $('#lv-op').scrollIntoView({behavior: 'smooth', block: 'center'}); } }
    else if(act === 'lv-wclear'){ document.querySelectorAll('[data-lvw]').forEach(i => i.value = ''); lvMine(); }
    else if(act === 'tr-freset'){ Object.assign(TRF, {q: '', g: '', w: 0}); saveTRF(); render(); }
    else if(act === 'tr-chkall'){ const all = TRVIEW.keys.length ? TRVIEW.keys : ST.tracked.map(t => key(t.w, t.n)); if(all.every(x => TRCHK.has(x))) TRCHK.clear(); else all.forEach(x => TRCHK.add(x)); render(); }
    else if(act === 'tr-chknone'){ TRCHK.clear(); render(); }
    else if(act === 'tr-delsel' || act === 'tr-delall'){
      const keys = act === 'tr-delall' ? ST.tracked.map(t => key(t.w, t.n)) : [...TRCHK];
      if(!keys.length) return;
      if(!confirm(act === 'tr-delall' ? `추적 중인 ${keys.length}명을 모두 해제할까요?\n(직접 입력한 마스터리·통합 레벨 기록과 메모는 남습니다)` : `선택한 ${keys.length}명의 추적을 해제할까요?\n(직접 입력한 마스터리·통합 레벨 기록과 메모는 남습니다)`)) return;
      const ks = new Set(keys);
      for(const t of ST.tracked) if(ks.has(key(t.w, t.n))) memoMoveOut(t);
      ST.tracked = ST.tracked.filter(t => !ks.has(key(t.w, t.n))); TRCHK.clear(); saveStore();
      if(D.local) localApi('api/tracked', {chars: ST.tracked.map(t => [t.w, t.n])}).catch(() => {});
      await render(); toast(`${keys.length}명의 추적을 해제했습니다`);
    }
    else if(act === 'trsel'){ TRSEL = k; lsSet('l9trsel', k); setTrTab('detail'); await render(); document.querySelector('.trtabs')?.scrollIntoView({behavior:'smooth', block:'start'}); }
    else if(act === 'tr-tab'){ setTrTab(b.dataset.v); await render(); }
    else if(act === 'tr-page'){ TRF.page = Number(b.dataset.p); await render(); document.querySelector('.trtabs')?.scrollIntoView({block:'start'}); }
    else if(act === 'tr-step'){ TRSEL = b.dataset.k; lsSet('l9trsel', TRSEL); await render(); }
    else if(act === 'tr-gopen'){ TRF.g = b.dataset.g; TRF.q = ''; TRF.page = 0; saveTRF(); setTrTab('list'); await render(); }
    else if(act === 'tr-gsort'){ TRF.gsort = b.dataset.v; saveTRF(); await render(); }
    else if(act === 'gotrack'){ TRSEL = k; lsSet('l9trsel', k); setTrTab('detail'); location.hash = '#track'; await render(); }
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
    else if(act === 'lock'){ if(!confirm('이 기기에서 잠그고 입장 화면으로 이동합니다.\n(이 기기의 추적·메모 기록은 지우지 않습니다)')) return; sealForget(); location.replace('index.html'); }
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
  else if(t === 'tr-g'){ TRF.g = e.target.value; TRF.page = 0; saveTRF(); render(); }
  else if(t === 'tr-pick'){ TRSEL = e.target.value; lsSet('l9trsel', TRSEL); render(); }
  else if(t === 'tr-w'){ TRF.w = Number(e.target.value); TRF.page = 0; saveTRF(); render(); }
  else if(t === 'tr-sort'){ TRF.sort = e.target.value; saveTRF(); render(); }
  else if(t === 'cg-w'){ CG.w = Number(e.target.value); CG.s = 0; CG.page = 0; CG.mv = 24; CG.asm = 24; CG.ldm = 24; CG.gom = 50; saveCG(); render(); }
  else if(t === 'dr-sort'){ DR.sort = e.target.value; DR.more = 60; saveDR(); render(); }
  else if(t === 'dr-map'){ DR.map = Number(e.target.value); DR.more = 60; DR.item = -1; saveDR(); render(); }
  else if(t === 'dr-tier'){ DR.tier = Number(e.target.value); DR.more = 60; DR.item = -1; saveDR(); render(); }
  else if(t === 'cg-sort'){ CG.sort = e.target.value; CG.dir = CGDIR0[CG.sort] || -1; CG.page = 0; saveCG(); render(); }
  else if(t === 'cg-s'){ CG.s = Number(e.target.value); CG.page = 0; CG.mv = 24; CG.asm = 24; CG.ldm = 24; CG.gom = 50; saveCG(); render(); }
});
let QT = null;
document.addEventListener('input', e => {
  if(e.target.dataset?.in === 'tr-gq'){ TRF.gq = e.target.value; clearTimeout(QT); QT = setTimeout(render, 250); }
  if(e.target.dataset?.in === 'tr-q'){ TRF.q = e.target.value; TRF.page = 0; saveTRF(); clearTimeout(QT); QT = setTimeout(render, 250); }
  if(e.target.dataset?.in === 'cg-q'){ CG.q = e.target.value; cgResetMore(); clearTimeout(QT); QT = setTimeout(render, 250); }
  if(e.target.id === 'gcmText') GCD[e.target.dataset.gk] = e.target.value;
  if(e.target.dataset?.in === 'dr-q'){ DR.q = e.target.value; DR.more = 60; DR.item = -1; saveDR(); clearTimeout(QT); QT = setTimeout(render, 250); }
  if(e.target.dataset?.in === 'rk-q'){ RK.q = e.target.value; RK.page = 0; clearTimeout(QT); QT = setTimeout(render, 250); }
  const mk = e.target.dataset?.memo;
  if(mk){ const st = e.target.closest('.memo-in')?.querySelector('.memo-st'); if(st){ const dirty = e.target.value !== memoGet(mk); st.textContent = dirty ? '등록 안 됨' : (e.target.value ? '등록됨' : ''); st.classList.toggle('dirty', dirty); } }
});
let MT = null;
document.addEventListener('keydown', e => {
  const m = e.target.closest && e.target.closest('.m[data-act="medit"]');
  if(m && e.target === m && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); startMEdit(m); }
  if(e.key === 'Enter' && e.target.closest?.('.efields,.tsplit')){ e.preventDefault(); expSave(); }
  if(e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.id === 'gcmText'){ e.preventDefault(); document.querySelector('[data-act="gc-add"]')?.click(); }
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
    const cl = cleanStore(j);
    ST = cl.st; migrateFav(); loadSession(); saveStore(); await render();
    toast(`백업을 불러왔습니다 (추적 ${ST.tracked.length}명)` + (cl.drop ? ` · 형식이 맞지 않는 항목 ${cl.drop}개는 버렸습니다` : ''));
  }catch(err){ toast('불러오기 실패: ' + err.message); }
});
// 대화상자 버튼
$('#btnFind').onclick = findNames;
$('#addName').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); findNames(); } });
$('#sTab').addEventListener('click', e => { const b = e.target.closest('[data-st]'); if(b) setSearchMode(b.dataset.st); });
$('#sFil').addEventListener('click', e => {
  const b = e.target.closest('[data-sw],[data-ss]'); if(!b) return;
  if(b.dataset.sw !== undefined){ SR.w = Number(b.dataset.sw); SR.s = 0; } else SR.s = Number(b.dataset.ss);
  SR.lim = 100; drawCands(); $('#cands').scrollTop = 0; });
$('#cands').addEventListener('click', e => {
  if(e.target.closest('[data-more]')){ SR.lim += 100; drawCands(); return; }
  const gb = e.target.closest('[data-g]');
  if(gb){ openGuild(gb.dataset.g); $('#dlgAdd').close(); return; }
  const b = e.target.closest('[data-n]'); if(!b) return;
  const w = Number(b.dataset.w), n = b.dataset.n;
  setCur(w, n); $('#dlgAdd').close();
  if(route() !== 'my') location.hash = '#my'; else { render(); window.scrollTo({top: 0}); }
  if(D.local) quickRun([[w, n]]); });
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
      if(ST.tracked.length < LIM.tracked && !ST.tracked.some(t => key(t.w, t.n) === k)){ ST.tracked.push({w: c.world_code, n: c.name, added: c.created || todayKST(), ev: []}); n++; }
      for(const [code, m] of Object.entries(c.masteries || {})) if(m.source !== '사이트') (ST.mastery[k] ||= {})[code] = {l: m.level, d: m.date};
      if(c.integ?.length) ST.integ[k] = c.integ.map(x => ({d: x.date, l: x.level, p: x.pct}));
    }
    ST.imported = true; saveStore();
    if(n) toast(`이전 버전 기록을 가져왔습니다 (캐릭터 ${n}명)`);
  }catch(e){}
}
// 뒤로 가기 캐시(bfcache)로 돌아왔을 때 입장 키가 지워졌으면 다시 입장 화면으로
window.addEventListener('pageshow', e => { if(e.persisted && SEAL.on && !sealStored()) location.replace('index.html'); });
(async function start(){
  try{ const r = await fetch('api/hello', {cache:'no-store'}); if(r.ok){ const j = await r.json(); if(j.app === 'l9tracker') D.local = {version: j.version}; } }catch(e){}
  if(D.local){
    // 프로그램 폴더에 저장된 기록·설정 불러오기 (없으면 지금 브라우저 기록을 올림)
    try{
      const j = await localApi('api/store');
      if(j.store && j.store.v === 1){ ST = cleanLoaded(j.store); migrateFav(); }
      else if(ST.tracked.length || (ST.expr || []).length) syncPush({store: persisted()});
      if(migrateFav()) saveStore();
      for(const [k, v] of Object.entries(j.prefs || {})){ if(typeof v !== 'string' || v.length > 2000 || !PREF_KEYS.includes(k)) continue; try{ localStorage.setItem(k, v); }catch(e){} }
      SYNC.on = true;
      if(!j.prefs) syncPush({prefs: prefsNow()});
    }catch(e){}
  }
  if(!D.local && !(await sealInit())) return;   // 웹: 입장 비밀번호 확인 전이면 입장 화면으로
  if(SEAL.on){ const b = $('#btnLock'); if(b) b.hidden = false; }
  if(LOAD_NOTE){ toast(LOAD_NOTE); LOAD_NOTE = ''; }
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
    if(document.querySelector('dialog[open]') || document.querySelector('.m.editing') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const old = D.meta?.generated; await loadMeta(); await loadQuick(); if(D.meta?.generated !== old) render();
  }, 30 * 60e3);
})();
