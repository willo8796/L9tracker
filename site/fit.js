// 화면 비율 맞추기 (v1.4.0): 넓은 화면(가로 1100px 이상)에서는 기준 폭 1320px 화면을 창 폭에 맞춰 같은 비율로 키우거나 줄임.
// 어떤 해상도(FHD · QHD · 4K)에서도 같은 비율로 보이게 함. 1100px 미만(태블릿 세로 · 휴대폰)은 그 크기에 맞춘 화면 배치를 그대로 씀.
(function(){
  'use strict';
  var BASE = 1320, MIN_W = 1100, MAX_Z = 3;
  function fit(){
    var w = window.innerWidth || document.documentElement.clientWidth;
    var z = w >= MIN_W ? Math.min(MAX_Z, w / BASE) : 1;
    z = Math.round(z * 1000) / 1000;
    var s = document.documentElement.style;
    s.zoom = z === 1 ? '' : String(z);
    s.setProperty('--z', String(z));
    window.L9_ZOOM = z;
  }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
})();
