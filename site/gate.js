// 입장 화면: 비밀번호 → PBKDF2 로 key.json 의 wrap 을 풀어 데이터 키를 얻고 app.html 로 이동 (seal.py 와 짝)
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const AAD = new Uint8Array([76, 57, 69, 49]);   // "L9E1"
  const hash = /^#[a-z]{1,12}$/.test(location.hash) ? location.hash : '';
  const go = () => location.replace('app.html' + hash);
  const b64d = s => { const b = atob(s), u = new Uint8Array(b.length); for(let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const b64e = u => { let s = ''; for(const x of u) s += String.fromCharCode(x); return btoa(s); };
  const msg = (t, bad) => { const m = $('msg'); m.textContent = t; m.classList.toggle('bad', !!bad); };
  try{ const p = localStorage.getItem('l9phos'); if(p && /^[a-z]{1,12}$/.test(p)) document.documentElement.dataset.phos = p; }catch(e){}
  let KJ = null, fails = 0, busy = false;

  function stored(){
    for(const st of [sessionStorage, localStorage]){
      try{ const v = JSON.parse(st.getItem('l9key') || 'null'); if(v && typeof v.kid === 'string') return v; }catch(e){}
    }
    return null;
  }
  async function init(){
    try{ const r = await fetch('data/key.json?t=' + Date.now(), {cache: 'no-store'}); if(r.ok) KJ = await r.json(); }catch(e){}
    if(KJ && (typeof KJ.kid !== 'string' || typeof KJ.salt !== 'string' || typeof KJ.wrap !== 'string')){
      msg('입장 설정이 올바르지 않습니다.', true); $('go').disabled = true; KJ = null; return;
    }
    if(!KJ){
      // 잠기지 않은 데이터(내 PC 프로그램) 또는 아직 데이터 없음 → 바로 입장
      try{ const r = await fetch('api/hello', {cache: 'no-store'}); if(r.ok){ go(); return; } }catch(e){}
      { msg('데이터를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.', true); $('go').disabled = true; return; }
    }
    const v = stored();
    if(v && v.kid === KJ.kid){ go(); return; }
    if(v){ msg('비밀번호가 바뀌었습니다. 새 비밀번호를 입력하세요.'); }
  }
  async function unlock(pin){
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    const kek = await crypto.subtle.deriveKey({name: 'PBKDF2', salt: b64d(KJ.salt), iterations: KJ.iter, hash: 'SHA-256'},
      base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
    const w = b64d(KJ.wrap);
    return new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: w.slice(0, 12), additionalData: AAD}, kek, w.slice(12)));
  }
  $('gateForm').addEventListener('submit', async e => {
    e.preventDefault();
    if(busy || !KJ) return;
    const pin = $('pin').value.trim();
    if(!/^\d{4,12}$/.test(pin)){ msg('숫자 4자리 이상을 입력하세요.', true); return; }
    if(!(Number.isInteger(KJ.iter) && KJ.iter >= 100000 && KJ.iter <= 5000000)){ msg('입장 설정이 올바르지 않습니다.', true); return; }
    busy = true; $('go').disabled = true; msg('확인 중…');
    try{
      const dk = await unlock(pin);
      const v = JSON.stringify({kid: KJ.kid, k: b64e(dk)});
      let okSes = false;
      try{ sessionStorage.setItem('l9key', v); okSes = sessionStorage.getItem('l9key') === v; }catch(e){}
      if(!okSes){ msg('브라우저 저장소가 막혀 있어 입장할 수 없습니다 (사생활 보호 모드·쿠키 차단 확인)', true); return; }
      try{ if($('keep').checked) localStorage.setItem('l9key', v); else localStorage.removeItem('l9key'); }catch(e){}
      msg('입장합니다'); go();
    }catch(err){
      fails++;
      $('pin').value = '';
      const wait = Math.min(30, fails >= 3 ? 2 ** (fails - 2) : 0);   // 여러 번 틀리면 잠깐 기다리게 함
      msg(`비밀번호가 맞지 않습니다${wait ? ` · ${wait}초 뒤 다시 입력` : ''}`, true);
      if(wait) await new Promise(ok => setTimeout(ok, wait * 1000));
      if(msg && wait) msg('다시 입력하세요.');
    }finally{ busy = false; $('go').disabled = false; $('pin').focus(); }
  });
  init();
})();
