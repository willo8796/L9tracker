# -*- coding: utf-8 -*-
"""
로드나인 전체 캐릭터 수집기 (랭킹 · 통계 · 추적용 데이터 생성)

공식 캐릭터 정보(l9.onstove.com)에서 검색 가능한 캐릭터(서버별 전투력 1,000위 안) 중
수집 기준(WORLD_RULES)에 맞는 캐릭터를 월드별로 조회해 웹 화면이 읽는 JSON 파일을 만든다.
  구월드(울란·디엔·린드리스): 전투력 17만 이상 (2026-11-17 14만 → 17만 상향: 그 아래는 대부분 매크로) / 신월드(가르바나·디나페리·하칸): 서버별 전투력 상위 500위
  사이트 목록은 전투력 순이 아니라 이름 순이라, 전날 값으로 조회할 캐릭터를 미리 고르고
  기준 밖 캐릭터는 skip/<월드>.json 에 적어 두었다가 7일에 한 번씩 다시 확인한다.

  python crawler.py --out public                 # 수집 + 파일 생성
  python crawler.py --out public --prev URL/폴더  # 이전 기록(히스토리)을 이어받아 생성
  python crawler.py --out public --no-crawl      # 수집 없이 이전 데이터만 복사(화면만 갱신)

생성 파일 (out/data/)
  meta.json            기준일, 월드·서버, 직업·마스터리 목록, 수집 기록
  chars/<월드>.json    월드별 전체 캐릭터 최신 값
  hist/<00~63>.json    캐릭터별 최근 일별 기록과 변경 내역(닉네임·길드·월드·서버)
  moves.json           최근 닉네임 변경 · 월드 이전 연결표
  changes.json         변경 이력 (닉네임·길드·월드·서버) + 월드/서버 이전 캐릭터 추적
  skip/<월드>.json     수집 기준 밖 캐릭터의 마지막 전투력 (조회 대상 고르기용)
  transfer.json        월드/서버 이전 기간 (스토브 공지에서 읽음) — 이 기간에만 이전 연결 · 서버 변경을 인정
  watch.json           감시 캐릭터 {"월드|닉네임": 감시 끝 날짜번호} — 이전·닉변 직후 30일간 기준 밖이어도 계속 수집
"""
import os
import math
import bisect
import sys
import json
import time
import re
import zlib
import shutil
import argparse
import threading
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone, date

try:
    import requests
except ImportError:
    requests = None

KST = timezone(timedelta(hours=9))
API = "https://api.onstove.com/pub-meta/v1.0/l9/gg/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) L9Tracker/0.6",
    "Origin": "https://l9.onstove.com",
    "Referer": "https://l9.onstove.com/",
    "Accept": "application/json",
}
SHARDS = 64
HIST_DAYS = 45            # 히스토리 보관 일수
MOVE_DAYS = 60            # 닉네임/월드 이동 연결표 보관 일수
RUN_KEEP = 30             # 수집 기록 보관 개수
EPOCH = date(2024, 1, 1)  # 날짜를 정수로 줄여 저장하기 위한 기준일
TEST_SESSION = None       # 테스트용 가짜 API

MASTERIES = [
    ("Mastery_Hand", "맨손"), ("Mastery_BattleShield", "전투 방패"), ("Mastery_WarDrum", "워드럼"),
    ("Mastery_Staff", "지팡이"), ("Mastery_QuarterStaff", "전투봉"), ("Mastery_DualDagger", "단검"),
    ("Mastery_Scythe", "사이드"), ("Mastery_Sword", "검과 방패"), ("Mastery_TwohandedSword", "대검"),
    ("Mastery_Bow", "활"), ("Mastery_CrossBow", "석궁"),
]
# 월드별 캐릭터 파일 열 순서 (화면 app.js 와 같아야 함)
# 월드별 수집 기준: ("bp", 최소 전투력) 또는 ("top", 서버별 상위 N위). 목록에 없는 월드는 전부 수집.
WORLD_RULES = {"울란": ("bp", 170000), "디엔": ("bp", 170000), "린드리스": ("bp", 170000),
               "가르바나": ("top", 500), "디나페리": ("top", 500), "하칸": ("top", 500)}
RULE_MARGIN = 0.97        # 기준보다 3% 낮은 캐릭터까지 매일 조회 (기준을 막 넘는 캐릭터를 놓치지 않도록)
RECHECK_DAYS = 7          # 기준 밖 캐릭터는 7일에 한 번 다시 조회
CHANGE_DAYS = 45          # 변경 이력 보관 일수
CHANGE_MAX = 20000


def rule_of(wname):
    return WORLD_RULES.get(wname)


def rule_text(r):
    if not r:
        return "서버별 전투력 1,000위"
    return f"전투력 {r[1] // 10000}만 이상" if r[0] == "bp" else f"서버별 전투력 상위 {r[1]}위"


COLS = ["n", "s", "j", "mc", "ml", "mr", "bp", "bwr", "bsr", "ach", "sp", "g", "m1c", "m1l", "m2c", "m2l"]


def now_kst():
    return datetime.now(KST)


def data_date_for(now=None):
    """사이트는 매일 10~12시 전일 기준 갱신. 12시 이후=어제, 10시 이전=그제, 10~12시=None"""
    now = now or now_kst()
    if now.hour >= 12:
        return now.date() - timedelta(days=1)
    if now.hour < 10:
        return now.date() - timedelta(days=2)
    return None


def dnum(d):
    return (d - EPOCH).days


def ddate(n):
    return EPOCH + timedelta(days=n)


def shard_of(key):
    return zlib.crc32(key.encode("utf-8")) % SHARDS


def ckey(world, name):
    return f"{world}|{name}"


# ------------------------------------------------------------------ 요청
class RateLimiter:
    """초당 요청 수 제한. 오류가 나면 저절로 느려지고, 잘 되면 원래 속도로 돌아옴"""
    def __init__(self, per_sec):
        self.base = self.gap = 1.0 / max(per_sec, 0.1)
        self.lock = threading.Lock()
        self.next = 0.0

    def slower(self):
        with self.lock:
            self.gap = min(2.0, self.gap * 1.6)

    def faster(self):
        with self.lock:
            self.gap = max(self.base, self.gap * 0.97)

    def wait(self):
        with self.lock:
            t = time.monotonic()
            if self.next > t:
                time.sleep(self.next - t)
                t = self.next
            self.next = t + self.gap


class Fetcher:
    def __init__(self, rate=6.0, session=None, log=print, tries=4, quick=False):
        self.tries = tries
        self.quick = quick      # 화면에서 바로 조회할 때: 짧게 재시도
        self.rl = RateLimiter(rate)
        self.log = log
        self.local = threading.local()
        self.session = session or TEST_SESSION  # 테스트용 주입

    def _s(self):
        if self.session is not None:
            return self.session
        s = getattr(self.local, "s", None)
        if s is None:
            if requests is None:
                raise RuntimeError("requests 모듈이 없습니다. 'pip install requests' 후 다시 실행하세요.")
            s = requests.Session()
            s.headers.update(HEADERS)
            self.local.s = s
        return s

    def get(self, path, params, tries=None):
        err = None
        tries = tries or self.tries
        for i in range(tries):
            self.rl.wait()
            try:
                r = self._s().get(API + path, params=params, timeout=8 if self.quick else 20)
                if r.status_code in (429, 500, 502, 503, 504):
                    raise RuntimeError(f"HTTP {r.status_code}")
                r.raise_for_status()
                j = r.json()
                if j.get("code") not in (0, None):
                    raise RuntimeError(f"API 오류 {j.get('code')} {j.get('message')}")
                self.rl.faster()
                return j.get("value")
            except Exception as e:  # 네트워크·일시 오류는 잠시 쉬고 다시
                err = e
                self.rl.slower()
                if i < tries - 1:
                    time.sleep(1 if self.quick else min(30, 2 * (i + 1) ** 2))
        raise err

    def worlds(self):
        v = self.get("worlds/names", {"lang_code": "ko"}) or []
        return [(int(w["world_code"]), w["world_name"]) for w in v]

    def names(self, wc):
        return [n for n in (self.get("characters/names", {"world_code": wc}) or []) if n]

    def character(self, wc, name):
        return self.get("characters", {"world_code": wc, "character_name": name, "lang_code": "ko"})


# ------------------------------------------------------------------ 이전 데이터 읽기
class Prev:
    """이전 결과물(폴더 또는 웹 주소)에서 파일 읽기"""

    def __init__(self, src):
        self.src = (src or "").strip()
        self._dk = None
        self.net_err = False     # 파일이 '없음'(404)이 아니라 네트워크·서버 오류로 못 읽은 적이 있으면 True

    def _raw(self, rel):
        if not re.fullmatch(r"data/[A-Za-z0-9_./-]+", rel) or ".." in rel.split("/"):
            return None
        if self.src.startswith("http"):
            url = self.src.rstrip("/") + "/" + rel
            req = urllib.request.Request(url, headers={"User-Agent": "L9Tracker"})
            for i in range(3):
                try:
                    with urllib.request.urlopen(req, timeout=60) as r:
                        return r.read()
                except urllib.error.HTTPError as e:
                    if e.code in (404, 410):
                        return None
                    if i == 2:
                        raise
                except Exception:
                    if i == 2:
                        raise
                time.sleep(2 * (i + 1))
        p = os.path.join(self.src, *rel.split("/"))
        if os.path.exists(p):
            with open(p, "rb") as f:
                return f.read()
        return None

    def _key(self):
        """웹에 올린 데이터가 암호화돼 있으면(seal.py) key.json 의 mwrap 을 L9_KEY 로 풀어 데이터 키를 얻음"""
        if self._dk is None:
            import seal
            kj = json.loads((self._raw("data/key.json") or b"{}").decode("utf-8"))
            if not kj.get("mwrap"):
                raise RuntimeError("전날 데이터가 암호화돼 있는데 data/key.json 이 없습니다")
            self._dk = seal.dk_from_key_json(kj, os.environ.get("L9_KEY", "").strip())
        return self._dk

    def read(self, rel):
        if not self.src:
            return None
        try:
            b = self._raw(rel)
        except Exception:
            self.net_err = True
            return None
        if b is None:
            return None
        if b.startswith(b"L9E1"):
            # 암호화된 전날 데이터 — 풀지 못하면 기록이 끊기지 않도록 수집을 멈춤 (조용히 None 을 돌려주지 않음)
            import seal
            try:
                b = seal.unseal_bytes(self._key(), b)
            except SystemExit as e:
                raise RuntimeError(str(e))
            except Exception as e:
                raise RuntimeError(f"전날 데이터({rel})를 풀지 못했습니다 — L9_KEY 를 확인하세요 ({type(e).__name__})")
        try:
            return json.loads(b.decode("utf-8"))
        except Exception:
            return None


# ------------------------------------------------------------------ 일치도 (닉변·월드 이전 추적)
def _close(old, new, down, up):
    if not old or new is None:
        return 0.5
    r = (new - old) / old
    if r < -down or r > up:
        return 0.0
    return 1 - (abs(r) / (up if r > 0 else down))


def match_score(old, new):
    """old/new: dict(j, bp, ach, sp). 직업이 다르거나 업적점수 범위를 벗어나면 0"""
    if old["j"] != new["j"]:
        return 0.0
    ach = _close(old["ach"], new["ach"], 0.01, 0.15)
    if ach == 0:
        return 0.0
    s = _close(old["bp"], new["bp"], 0.05, 0.20) * 0.45 + ach * 0.35 + _close(old["sp"], new["sp"], 0.02, 0.10) * 0.20
    return round(100 * (0.5 + 0.5 * s), 1) if s > 0 else 0.0


LINK_DAYS = 14   # 사라진 뒤 이 기간 안에 다시 나타나면 이어 붙임 (이전 기간에는 며칠씩 접속하지 않기도 함)
WATCH_DAYS = 30  # 이전 · 닉네임 변경으로 연결된 캐릭터를 기준 밖이어도 계속 수집하는 기간


def m_levels(m):
    """[대표 무기, 대표 레벨, 무기1, 레벨1, 무기2, 레벨2] → 무기 3개 레벨 (작은 순)"""
    if not m:
        return []
    return sorted(x for x in (m[1], m[3] if len(m) > 3 else None, m[5] if len(m) > 5 else None) if isinstance(x, int))


def fingerprint(old, new, gap):
    """직업 · 업적점수 · 마스터리 3종 · 전문화 · 전투력을 모두 비교. 맞으면 {'full': 마스터리 3종 모두 비교했는지, 'score'}"""
    gap = max(1, gap)
    if old["j"] != new["j"] or not old.get("ach") or not new.get("ach"):
        return None
    r = (new["ach"] - old["ach"]) / old["ach"]
    if r < -0.001 or r > min(0.02, 0.003 * gap):
        return None
    if old.get("sp") is not None and new.get("sp") is not None:
        d = new["sp"] - old["sp"]
        if d < 0 or d > 2 + gap:
            return None
    if old.get("bp") and new.get("bp"):
        r = (new["bp"] - old["bp"]) / old["bp"]
        if r < -0.05 or r > min(0.20, 0.10 + 0.02 * gap):
            return None
    up = 1 + gap // 4
    a, b = old.get("lv") or [], new.get("lv") or []
    full = len(a) == 3 and len(b) == 3
    if full:
        if any(y - x < 0 or y - x > up for x, y in zip(a, b)):
            return None
    else:
        x, y = old.get("ml"), new.get("ml")
        if isinstance(x, int) and isinstance(y, int) and (y - x < 0 or y - x > up):
            return None
    return {"full": full, "score": match_score(old, new)}


# ------------------------------------------------------------------ v1.5.0 같은 캐릭터 판정 (직업 제외)
# 로드나인은 무기 · 직업(어빌리티)을 언제든 자유롭게 바꿀 수 있고, 계정 매매로 주인 · 닉네임도 바뀐다 → 직업은 판정에 쓰지 않음.
# 가르바나 실측(2026-11-15 → 11-17, 전투력 20만 이상 371명, 이름 그대로인 캐릭터):
#   직업 16% 변경 · 서버 100% 유지 · 업적점수 · 전문화 · 무기별 마스터리 레벨이 줄어든 캐릭터 0명
#   업적점수 증가 중앙값 +0.2% / 최대 +1.9% (2일), 전문화 +0~4, 전투력 대부분 ±1.5% 이나 5~10% 가 10% 넘게 하락(최대 -34%)
# 아래 조건(LINK_GATE)으로 371명 중 370명이 자기 자신만 찾음(놓친 1명은 업적점수 0), 다른 캐릭터와 겹친 4명(1.1%)은 점수 1등이 모두 본인.
LG_ACH_DAY = 0.01        # 업적점수: 하루 +1% 까지
LG_ACH_DOWN = 0.001      # 업적점수: 반올림 등으로 0.1% 까지는 줄어도 인정
LG_SP_DAY = 2            # 전문화: 하루 +2 까지 (감소 불가)
LG_BP_LOW = 0.60         # 전투력: 예전의 60% 까지 하락 인정 (장비 교체)
LG_BP_HIGH = 0.05        # 전투력: +5% + 하루 1%
LG_SURE_GAP = 8.0        # 후보가 여럿일 때 1등이 2등보다 이만큼 높으면 확실
LG_SURE_MIN = -16.0      # 후보가 한 명뿐이어도 점수가 이보다 낮으면(수치 차이가 큼) 확실 대신 유력 — 우연히 한 명만 맞은 다른 캐릭터 방지


def weapon_levels(m):
    """[대표 무기, 레벨, 무기1, 레벨1, 무기2, 레벨2] → {무기 번호: 가장 높은 레벨}"""
    out = {}
    if not m:
        return out
    for i in (0, 2, 4):
        if i + 1 < len(m):
            c, lv = m[i], m[i + 1]
            if isinstance(c, int) and c >= 0 and isinstance(lv, int) and lv > 1:
                out[c] = max(out.get(c, 0), lv)
    return out


def link_gate(old, new, gap):
    """같은 캐릭터일 수 있는지 (직업은 보지 않음). old/new: dict(bp, ach, sp, wl={무기: 레벨}).
    → None(불가) 또는 {'ach': 업적점수로 비교했는지}"""
    gap = max(1, gap)
    oa, na = old.get("ach") or 0, new.get("ach") or 0
    if oa and na:
        r = (na - oa) / oa
        if r < -LG_ACH_DOWN or r > LG_ACH_DAY * gap:
            return None
    elif oa or na:
        return None             # 한쪽만 업적점수가 있으면 다른 캐릭터
    os_, ns = old.get("sp"), new.get("sp")
    if isinstance(os_, int) and isinstance(ns, int) and (ns < os_ or ns > os_ + LG_SP_DAY * gap):
        return None
    ob, nb = old.get("bp") or 0, new.get("bp") or 0
    if ob and nb and (nb < ob * LG_BP_LOW or nb > ob * (1 + LG_BP_HIGH + 0.01 * gap)):
        return None
    ow, nw = old.get("wl") or {}, new.get("wl") or {}
    for c, lv in ow.items():
        if c in nw and (nw[c] < lv or nw[c] > lv + 2 + gap):
            return None
    return {"ach": bool(oa and na)}


def link_score(old, new, gap):
    """후보가 여럿일 때 순위: 업적 증가가 전형값(하루 0.1%)에 가까울수록 · 전투력 변화가 작을수록 · 같은 무기가 많을수록 높음"""
    gap = max(1, gap)
    sc = 0.0
    oa, na = old.get("ach") or 0, new.get("ach") or 0
    if oa and na:
        sc -= min(abs(math.log(na / oa) - 0.001 * gap) / (0.003 * math.sqrt(gap)), 30)
    ob, nb = old.get("bp") or 0, new.get("bp") or 0
    if ob and nb:
        sc -= min(abs(math.log(nb / ob)) / 0.02, 20)   # 장비 교체로 크게 떨어지기도 해 비중을 낮춤
    ow, nw = old.get("wl") or {}, new.get("wl") or {}
    common = [c for c in ow if c in nw]
    sc += len(common) - sum(nw[c] - ow[c] for c in common) / 2
    if old.get("mc") is not None and old.get("mc") == new.get("mc"):
        sc += 2
    if isinstance(old.get("sp"), int) and isinstance(new.get("sp"), int):
        sc -= (new["sp"] - old["sp"]) / 2
    return round(sc, 2)


def clearly_other(old, new, gap):
    """같은 이름인데 수치가 확실히 맞지 않음 → 다른 캐릭터가 이 이름을 쓰게 됨(이름 넘겨받기 · 계정 매매 등).
    기록을 잘못 나누면 안 되므로 넉넉하게: 업적점수 0.5% 넘게 감소 또는 5%+하루 1% 넘게 증가, 전문화 2 이상 감소, 같은 무기 레벨 2 이상 감소."""
    gap = max(1, gap)
    oa, na = old.get("ach") or 0, new.get("ach") or 0
    if oa and na and (na < oa * 0.995 or na > oa * (1.05 + 0.01 * gap)):
        return True
    os_, ns = old.get("sp"), new.get("sp")
    if isinstance(os_, int) and isinstance(ns, int) and ns <= os_ - 2:
        return True
    ow, nw = old.get("wl") or {}, new.get("wl") or {}
    return any(c in nw and nw[c] <= lv - 2 for c, lv in ow.items())


def name_norm(n):
    """비교용 이름: 소문자, 숫자 · 기호 · 공백 · 낱자(ㅋ, ㅇ 등) 제거"""
    return re.sub(r"[^a-z가-힣]", "", (n or "").lower())


def name_assoc(a, b):
    """두 닉네임이 같은 사람 것으로 보일 만큼 비슷한지 → 이유 문자열 또는 None"""
    if not a or not b:
        return None
    if a == b:
        return "같은 이름"
    if name_related(a, b):
        return "번호만 다름"
    na, nb = name_norm(a), name_norm(b)
    if len(na) >= 2 and na == nb:
        return "숫자 · 기호만 다름"
    if min(len(na), len(nb)) >= 3 and (na in nb or nb in na) and abs(len(na) - len(nb)) <= 2:
        return "이름 일부 같음"
    return None


ASSOC_GONE_DAYS = 30


def name_related(a, b):
    """월드 이전 후 닉네임 뒤에 번호가 붙는 경우 포함"""
    if a == b:
        return True
    for x, y in ((a, b), (b, a)):
        if y.startswith(x) and y[len(x):].isdigit():
            return True
    return False


# ------------------------------------------------------------------ 월드/서버 이전 기간 (공식 공지)
# 로드나인은 공지된 이전 기간에만 월드 · 서버를 옮길 수 있다. 이 기간 밖에 월드나 서버가 바뀐 것처럼 보이면
# 같은 캐릭터가 아니다(다른 캐릭터가 같은 이름을 쓰게 됨 등). 그래서 이전 연결 · 서버 변경 기록은 기간 안일 때만 인정한다.
# 일정 확인은 매일 하지 않는다 (data/transfer.json 에 마지막 확인일 저장):
#  - 월초(그달 첫 수집): 주요 일정 캘린더 글(월말에 다음 달 것이 올라옴 · 이미지라 날짜는 못 읽고 글만 기록) + 공지사항 확인
#  - 평시: 공지사항은 7일에 한 번 (이전 사전 안내는 보통 열흘쯤 전에 올라옴)
#  - 알려진 이전 기간 7일 전 ~ 기간 끝: 매일 공지사항 확인 (최종 확인 · 일정 변경 공지)
# 읽지 못하면 아래 확인된 일정 + 지난번 저장한 일정을 쓴다.
# 평시(이전 기간이 아닐 때)에는 월드 · 서버가 다른 후보와 잇지 않으므로 닉네임 변경만 찾고, 이전 기간에는 이전 · 세탁 의심까지 찾는다.
NOTICE_API = "https://api.onstove.com/cwms/v3.0/article_group/BOARD/128074/article/list"
CALENDAR_API = "https://api.onstove.com/cwms/v3.0/article_group/BOARD/144289/article/list"   # 주요 일정 캘린더
TR_CHECK_DAYS = 7         # 평시 공지 확인 간격
TR_PRE_DAYS = 7           # 이전 기간 며칠 전부터 매일 확인
NOTICE_HEADERS = {"User-Agent": HEADERS["User-Agent"], "Origin": "https://page.onstove.com",
                  "Referer": "https://page.onstove.com/", "Accept": "application/json"}
WORLD_NAMES = ["린드리스", "울란", "디엔", "가르바나", "디나페리", "하칸"]
TR_GRACE = 1              # 기간 끝난 다음 날 기준일 데이터까지 인정 (22시 마감 직전 이전 · 사이트 갱신 시각 차이)
TR_SINCE = date(2026, 11, 17)
SV_MASS = 30              # 한 월드에서 하루에 이보다 많이 '기간 밖 서버 변경'이 보이면 서버 통합 등으로 보고 기록을 지우지 않음   # 이 날 이전 기록은 이전 기간 확인 없이 쌓인 것 → 화면용으로 다시 거름
_OLD3, _NEW2 = ["린드리스", "울란", "디엔"], ["가르바나", "디나페리"]
TRANSFER_SEED = [   # 스토브 공지사항에서 확인한 일정 (2026-11-16)
    {"s": "2026-11-25", "e": "2026-11-28", "world": _OLD3, "server": _NEW2, "id": "14630114", "t": "11/25(수) 월드/서버 이전 사전 안내"},
    {"s": "2026-10-14", "e": "2026-10-17", "world": _OLD3, "server": _NEW2, "id": "14570860", "t": "10/14(수) 월드/서버 이전 사전 안내"},
    {"s": "2026-09-02", "e": "2026-09-05", "world": _OLD3, "server": _NEW2, "id": "14438523", "t": "9/2(수) 월드/서버 이전 사전 안내"},
    {"s": "2026-07-22", "e": "2026-07-25", "world": _OLD3, "server": _NEW2, "id": "13993310", "t": "7/22(수) 월드/서버 이전 사전 안내"},
    {"s": "2026-06-10", "e": "2026-06-13", "world": _OLD3, "server": _NEW2, "id": "13525538", "t": "6/10(수) 월드/서버 이전 사전 안내"},
    {"s": "2026-05-06", "e": "2026-05-08", "world": [], "server": ["디나페리"], "id": "13178687", "t": "5/6(수) 디나페리 서버 이전 사전 안내"},
]


def _names_in(s):
    return [w for w in WORLD_NAMES if w in (s or "")]


def parse_transfer(title, summary, posted):
    """공지 한 건 → 이전 기간 {"s","e","world","server","t"} 또는 None.
    posted: 게시일(date) — 공지 속 '11/25' 같은 날짜에 연도를 붙일 때 씀"""
    t = title or ""
    if "이전" not in t or not re.search(r"(사전 )?안내", t) or re.search(r"현상|이슈|불가|오류|길드 이전", t):
        return None
    if not re.search(r"월드|서버", t):
        return None
    s = re.sub(r"\s+", " ", summary or "")
    m = re.search(r"이전 (?:진행 )?(?:기간|일정)\s*:?\s*(\d{1,2})/(\d{1,2})[^~]{0,30}~\s*(\d{1,2})/(\d{1,2})", s)
    if not m:
        m = re.search(r"(\d{1,2})/(\d{1,2})\s*\([^)]*\)[^~]{0,30}~\s*(\d{1,2})/(\d{1,2})", s)
    if not m:
        return None
    m1, d1, m2, d2 = (int(x) for x in m.groups())
    y1 = posted.year + (1 if m1 < posted.month - 6 else 0)
    y2 = y1 + (1 if m2 < m1 else 0)
    try:
        st, en = date(y1, m1, d1), date(y2, m2, d2)
    except ValueError:
        return None
    if not (0 <= (en - st).days <= 14):
        return None
    i = s.find("대상")
    seg = s[i:i + 260] if i >= 0 else ""
    seg = seg.split("※")[0]
    world, server = [], []
    seg = seg.replace("월드/서버 이전", "월드 서버 이전")     # 합친 표기는 라벨 없음으로 처리
    wi, si = seg.find("월드 이전"), seg.find("서버 이전")
    if wi >= 0 and si >= 0 or (wi >= 0) != (si >= 0) and "월드 서버 이전" not in seg:
        if wi >= 0:
            world = _names_in(seg[wi:si] if si > wi else seg[wi:])
        if si >= 0:
            server = _names_in(seg[si:wi] if wi > si else seg[si:])
    else:
        names = _names_in(seg) or _names_in(t)
        if "월드" in t and "서버" not in t.replace("서버 이전", "") and "서버 이전" not in t:
            world = names
        elif "서버 이전" in t and "월드" not in t:
            server = names
        else:
            world, server = names, names
    if not world and not server:
        return None
    return {"s": st.isoformat(), "e": en.isoformat(), "world": world, "server": server, "t": t}


def _stove_list(url, session=None):
    if session is not None:
        j = session.get(url, headers=NOTICE_HEADERS, timeout=20).json()
    elif requests:
        j = requests.get(url, headers=NOTICE_HEADERS, timeout=20).json()
    else:
        with urllib.request.urlopen(urllib.request.Request(url, headers=NOTICE_HEADERS), timeout=20) as r:
            j = json.loads(r.read().decode("utf-8"))
    return ((j or {}).get("value") or {}).get("list") or []


def fetch_calendar(log=print, session=None):
    """주요 일정 캘린더 최신 글 {id, t, d} — 실패하면 None (캘린더는 이미지라 글 정보만)"""
    try:
        for a in _stove_list(f"{CALENDAR_API}?content_yn=N&summary_yn=N&sort_type_code=LATEST&page=1&size=5", session):
            t = a.get("title") or ""
            if "캘린더" in t:
                d = datetime.fromtimestamp(int(a.get("create_datetime") or 0) / 1000, KST).date().isoformat()
                return {"id": str(a.get("article_id") or ""), "t": t, "d": d}
    except Exception as e:
        log(f"주요 일정 캘린더 읽기 실패 ({e})")
    return None


def fetch_transfer(log=print, pages=2, session=None):
    """스토브 공지사항에서 이전 기간 목록 읽기. 실패하면 None"""
    out = []
    for p in range(1, pages + 1):
        url = f"{NOTICE_API}?content_yn=N&summary_yn=Y&sort_type_code=LATEST&page={p}&size=50"
        try:
            lst = _stove_list(url, session)
        except Exception as e:
            log(f"이전 일정 공지 읽기 실패 ({e}) — 저장된 일정을 씁니다")
            return None
        for a in lst:
            try:
                posted = datetime.fromtimestamp(int(a.get("create_datetime") or 0) / 1000, KST).date()
                w = parse_transfer(a.get("title"), a.get("summary"), posted)
                if w:
                    w["id"] = str(a.get("article_id") or "")
                    out.append(w)
            except Exception:
                continue
        if not lst:
            break
    return out


def merge_transfer(*lists):
    """같은 기간(시작 · 끝)은 하나로 합치고 대상 월드 · 서버는 합집합"""
    by = {}
    for l in lists:
        for w in l or ():
            if not isinstance(w, dict) or not w.get("s") or not w.get("e"):
                continue
            k = (w["s"], w["e"])
            if k not in by:
                by[k] = {"s": w["s"], "e": w["e"], "world": [], "server": [], "id": w.get("id") or "", "t": w.get("t") or ""}
            x = by[k]
            for f in ("world", "server"):
                for n in w.get(f) or ():
                    if n not in x[f]:
                        x[f].append(n)
            if not x["id"] and w.get("id"):
                x["id"], x["t"] = w["id"], w.get("t") or x["t"]
    return sorted(by.values(), key=lambda w: w["s"], reverse=True)


class Transfer:
    """이전 기간 판정. kind: 'world'(월드 이전) · 'server'(같은 월드 안 서버 이전)"""

    def __init__(self, windows, info=None):
        self.info = dict(info or {})       # 마지막 확인일 · 캘린더 글 (data/transfer.json 에 같이 저장)
        self.windows, self.w = [], []
        for x in windows or ():
            try:
                s, e = dnum(date.fromisoformat(x["s"])), dnum(date.fromisoformat(x["e"]))
                x = dict(x, world=[n for n in x.get("world") or [] if n in WORLD_NAMES] if isinstance(x.get("world"), list) else [],
                         server=[n for n in x.get("server") or [] if n in WORLD_NAMES] if isinstance(x.get("server"), list) else [])
            except (KeyError, TypeError, ValueError, AttributeError):
                continue        # 깨진 일정 한 건 때문에 수집 전체가 멈추지 않도록
            if s <= e:
                self.windows.append(x)
                self.w.append((s, e, x))

    def ok(self, kind, d0, d1, wa, wb=None):
        """d0 = 옮기기 전 자리에서 마지막으로 본 기준일, d1 = 옮긴 자리에서 처음 본 기준일.
        이전 기간 [시작, 끝] 동안 옮겼어야 하므로 시작 <= d1 이고 d0 <= 끝 이며 그 기간의 대상이면 True.
        (기록 날짜 하나만 아는 예전 기록은 d0 = 날짜-1 로 불러 '기간 끝난 다음 날 수집분'까지 인정 — TR_GRACE)
        월드 이전: 떠난 월드 · 옮긴 월드 모두 월드 이전 대상. 서버 이전(같은 월드 안): 그 월드가 서버 이전 대상.
        일정을 하나도 모르면(읽기 실패 + 저장 없음) 막지 않음."""
        if not self.w:
            return True
        for s, e, x in self.w:
            if s > d1 or e < d0:
                continue
            if kind == "world":
                if wa in x["world"] and (wb is None or wb in x["world"]):
                    return True
            elif wa in x["server"]:
                return True
        return False

    def active(self, d0, d1):
        """d0~d1 사이에 열린 이전 기간이 하나라도 있으면 그 기간 (평시면 None)"""
        for s, e, x in self.w:
            if s <= d1 and e >= d0:
                return x
        return None

    def window_of(self, kind, d, wa, wb=None):
        for s, e, x in self.w:
            if s <= d <= e and self.ok(kind, s, e, wa, wb):
                return x
        return None


def load_transfer(prev, log=print, session=None, today=None, fetch=True):
    """저장된 일정을 읽고, 확인할 때가 됐을 때만 스토브 공지 · 캘린더를 읽는다. today: 날짜(date)"""
    today = today or now_kst().date()
    saved = prev.read("data/transfer.json") if prev else None
    if not isinstance(saved, dict):
        saved = {"windows": saved if isinstance(saved, list) else []}
    info = {k: saved.get(k) for k in ("checked", "cal_month", "calendar") if saved.get(k)}
    base = Transfer(merge_transfer(saved.get("windows"), TRANSFER_SEED), info)
    td = dnum(today)
    try:
        last = dnum(date.fromisoformat(info["checked"])) if info.get("checked") else None
    except ValueError:
        last = None
    month = today.strftime("%Y-%m")
    near = base.active(td - 1, td + TR_PRE_DAYS)       # 이전 기간 7일 전 ~ 끝(+1일)
    why = ("월초 확인" if info.get("cal_month") != month else
           f"이전 기간({near['s'][5:]}~{near['e'][5:]}) 확인" if near else
           f"{TR_CHECK_DAYS}일마다 확인" if last is None or td - last >= TR_CHECK_DAYS else None)
    if not fetch or not why:
        return base
    if info.get("cal_month") != month:
        cal = fetch_calendar(log, session)
        if cal:
            info["calendar"], info["cal_month"] = cal, month
            log(f"주요 일정 캘린더: {cal['t']} (이미지라 날짜는 공지로 확인)")
    got = fetch_transfer(log, session=session)
    if got is None:
        return Transfer(base.windows, info)
    info["checked"] = today.isoformat()
    wins = merge_transfer(got, saved.get("windows"), TRANSFER_SEED)
    log(f"이전 일정 공지 확인 ({why}) — 이전 안내 {len(got)}건 · 최근 일정 {wins[0]['s']} ~ {wins[0]['e']}" if wins else f"이전 일정 공지 확인 ({why})")
    return Transfer(wins, info)


# ------------------------------------------------------------------ 변환
def to_int(x):
    try:
        return int(x)
    except (TypeError, ValueError):
        return None


RE_MCODE = re.compile(r"Mastery_[A-Za-z0-9]{1,40}")


def _mc(x):
    """마스터리 코드는 형식이 맞는 것만 (화면 HTML 에 들어가므로)"""
    return x if isinstance(x, str) and RE_MCODE.fullmatch(x) else None


def raw_row(v, name=None):
    """사이트 응답 → 열 배열 (직업·무기는 문자열 그대로)"""
    return [v.get("character_name") or name, to_int(v.get("server_code")) or 0, v.get("job_name") or "-",
            _mc(v.get("mastery_image")), to_int(v.get("mastery_level")), to_int(v.get("mastery_rank")),
            to_int(v.get("battle_power_point")), to_int(v.get("battle_power_world_rank")),
            to_int(v.get("battle_power_server_rank")), to_int(v.get("achievement_point")),
            to_int(v.get("specialize_level")), (v.get("guild_name") or "").strip(),
            _mc(v.get("mastery_image1")), to_int(v.get("mastery_level1")),
            _mc(v.get("mastery_image2")), to_int(v.get("mastery_level2"))]


def _dump(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)   # 쓰는 도중 화면이 읽어도 깨지지 않도록


# ------------------------------------------------------------------ 결과물 만들기 (월드가 끝날 때마다 저장)
class Builder:
    def __init__(self, out, dd, old_meta, worlds):
        self.out = out
        self.data = os.path.join(out, "data")
        os.makedirs(os.path.join(self.data, "chars"), exist_ok=True)
        os.makedirs(os.path.join(self.data, "hist"), exist_ok=True)
        self.dd = dd
        self.today = dnum(dd)
        self.old = old_meta or {}
        self.order = list(worlds)
        self.jobs = list(self.old.get("jobs") or [])
        self.mcodes = [c for c, _ in MASTERIES]
        for c in self.old.get("mcodes") or []:
            if _mc(c) and c not in self.mcodes:
                self.mcodes.append(c)
        self.cur = {}
        self.wmeta = {}
        self.skip = {}
        self.alive = {}          # 월드별 오늘 사이트 목록에 있는 이름 (기준 밖이라 안 모은 캐릭터를 '사라짐'으로 보지 않도록)
        self.extra = {}
        self.hidden = set()          # 기준 밖이지만 전날 몰랐던 이름 (기준 밖 자리로 이전한 캐릭터 찾기용 연결 후보)
        self.watch = {}          # 감시 캐릭터 {키: 끝 날짜번호}
        self.tr = Transfer(merge_transfer(TRANSFER_SEED))   # 월드/서버 이전 기간 (run 에서 공지를 읽어 바꿈)

    def jidx(self, j):
        j = j or "-"
        if j not in self.jobs:
            self.jobs.append(j)
        return self.jobs.index(j)

    def midx(self, c):
        if not c:
            return -1
        if not _mc(c):
            return -1       # 형식이 다른 코드는 화면에 쓰지 않음 (HTML 삽입 방지)
        if c not in self.mcodes:
            self.mcodes.append(c)
        return self.mcodes.index(c)

    def entry(self, wc, v):
        """사이트 응답 → (열 배열, cur 항목)"""
        r = raw_row(v, v.get("_q"))
        r[2], r[3], r[12], r[14] = self.jidx(r[2]), self.midx(r[3]), self.midx(r[12]), self.midx(r[14])
        return r, {"w": wc, "n": r[0], "s": r[1], "j": r[2], "mc": r[3], "ml": r[4], "mr": r[5],
                   "bp": r[6] or 0, "ach": r[9] or 0, "sp": r[10] or 0, "g": r[11],
                   "m": [r[3], r[4], r[12], r[13], r[14], r[15]], "av": v.get("avatar_image1") or ""}

    def add_extra(self, wc, raws):
        for v in raws:
            r, e = self.entry(wc, v)
            self.extra[ckey(wc, r[0])] = e

    def add_world(self, wc, wn, raws):
        out_rows, servers = [], {}
        for v in raws:
            r, e = self.entry(wc, v)
            servers[r[1]] = servers.get(r[1], 0) + 1
            out_rows.append(r)
            self.cur[ckey(wc, r[0])] = e
        out_rows.sort(key=lambda r: -(r[6] or 0))
        srank = {}
        for i, r in enumerate(out_rows):   # 전투력 월드·서버 순위: 사이트 값이 없으면 직접 계산
            srank[r[1]] = srank.get(r[1], 0) + 1
            if not r[7]:
                r[7] = i + 1
            if not r[8]:
                r[8] = srank[r[1]]
        _dump(os.path.join(self.data, "chars", f"{wc}.json"),
              {"world": wc, "date": self.dd.isoformat(), "cols": COLS, "rows": out_rows})
        r = rule_of(wn)
        self.wmeta[wc] = {"code": wc, "name": wn, "count": len(out_rows), "servers": sorted(servers),
                          "ready": True, "date": self.dd.isoformat(), "rule": list(r) if r else None,
                          "group": ("구월드" if r and r[0] == "bp" else "신월드" if r else "")}
        if wc in self.skip:
            os.makedirs(os.path.join(self.data, "skip"), exist_ok=True)
            _dump(os.path.join(self.data, "skip", f"{wc}.json"), self.skip[wc])

    def worlds_meta(self):
        old = {w["code"]: w for w in self.old.get("worlds") or []}
        out = []
        for wc, wn in self.order:
            if wc in self.wmeta:
                out.append(self.wmeta[wc])
            elif wc in old and os.path.exists(os.path.join(self.data, "chars", f"{wc}.json")):
                e = dict(old[wc]); e["ready"] = True; e.setdefault("date", self.old.get("date")); e["stale"] = True
                out.append(e)
            else:
                out.append({"code": wc, "name": wn, "count": 0, "servers": [], "ready": False})
        return out

    def meta(self, partial, runs=None):
        return {"version": 1, "date": self.dd.isoformat(), "generated": now_kst().isoformat(timespec="seconds"),
                "epoch": EPOCH.isoformat(), "worlds": self.worlds_meta(), "jobs": self.jobs, "mcodes": self.mcodes,
                "mnames": dict(MASTERIES), "cols": COLS, "shards": SHARDS, "hist_days": HIST_DAYS,
                "partial": partial, "progress": {"done": len(self.wmeta), "total": len(self.order)},
                "runs": (runs if runs is not None else self.old.get("runs") or [])[-RUN_KEEP:]}

    def write_partial(self):
        _dump(os.path.join(self.data, "meta.json"), self.meta(True))

    def finish(self, prev, mode, fail, total, secs, log=print):
        today, jobs, cur = self.today, self.jobs, self.cur
        hist = {}
        for i in range(SHARDS):
            h = prev.read(f"data/hist/{i:02d}.json")
            if h:
                hist.update(h)
        moves = prev.read("data/moves.json") or []
        wname = dict(self.order)
        for w in self.old.get("worlds") or []:
            wname.setdefault(w["code"], w["name"])
        done_w = set(self.wmeta)

        # 사라진 캐릭터 → 새로 나타난 캐릭터 연결 (닉네임 변경 · 월드 이전 · 서버 이전). 이번에 수집한 월드만 대상.
        #  확실: 아래 규칙으로 한 명만 맞을 때 → 기록을 이어 붙이고 추적 · 즐겨찾기도 따라감
        #  유력: 비슷하지만 단정할 수 없을 때(후보 여러 명 · 마스터리 정보 부족 등) → 변경 이력에 '유력'으로만 표시
        tr, act = self.tr, None
        def take(nk):        # 연결된 후보가 기준 밖(extra)이면 오늘 기록 대상에 넣고 True
            if nk in extra:
                cur[nk] = extra[nk]
                self.hidden.add(nk)     # 오늘 chars 파일에는 없음 (내일부터 감시 목록으로 수집)
                return True
            return False

        def old_fp(h):
            lp = list(h["p"][-1]) + [None] * 7      # 예전 형태(필드가 적은) 기록도 견딤
            m = h.get("m") or [lp[6], lp[3]]
            return {"j": h.get("j"), "bp": lp[1], "ach": lp[2], "sp": lp[5], "ml": lp[3], "lv": m_levels(m),
                    "wl": weapon_levels(m), "mc": m[0] if m else None}

        def new_fp(c):
            return {"j": c["j"], "bp": c["bp"], "ach": c["ach"], "sp": c["sp"], "ml": c["ml"], "lv": m_levels(c["m"]),
                    "wl": weapon_levels(c["m"]), "mc": c.get("mc")}

        blocked = {"n": 0}
        act = tr.active(today - LINK_DAYS, today)
        log(f"이전 기간({act['s'][5:]}~{act['e'][5:]}) 반영 — 월드 · 서버 이전과 세탁 의심까지 확인" if act
            else "평시(최근 이전 기간 없음) — 닉네임 변경만 확인 (월드 · 서버가 다른 캐릭터와는 잇지 않음)")

        def move_ok(gk, h, c):
            """사라진 캐릭터 gk → 후보 c 연결이 월드 · 서버를 바꾸는 경우, 그 사이에 열린 이전 기간이 있고 대상 월드 · 서버일 때만 True"""
            gw = int(gk.split("|", 1)[0])
            d0 = h["p"][-1][0] if h.get("p") else today - LINK_DAYS
            if gw != c["w"]:
                ok = tr.ok("world", d0, today, wname.get(gw, gw), wname.get(c["w"], c["w"]))
            elif h.get("s") and c.get("s") and h["s"] != c["s"]:
                ok = tr.ok("server", d0, today, wname.get(gw, gw))
            else:
                return True     # 같은 월드 · 서버 (닉네임 변경)는 언제든 가능
            if not ok:
                blocked.setdefault("k", set()).add(gk)
            return ok


        # (v1.5.0) 이름 넘겨받기 감지: 같은 이름인데 수치가 확실히 다른 캐릭터(업적점수 · 전문화 · 무기 레벨이 줄어듦 등)이거나
        # 이전 기간이 아닌데 서버가 바뀜 → 다른 캐릭터가 이 이름을 쓰게 된 것(닉네임 맞바꾸기 · 계정 매매 후 이름 변경).
        # 예전 기록은 'name(예전)' 으로 떼어 내 사라진 캐릭터로 다루고(새 이름을 찾아 이어 붙임), 지금 캐릭터는 새로 나타난 캐릭터로 다룸.
        sv_odd = {}
        for k, c in cur.items():
            h = hist.get(k)
            if h is not None and h.get("p") and h.get("s") and c["s"] and h["s"] != c["s"] \
                    and not tr.ok("server", h["p"][-1][0], today, wname.get(c["w"], c["w"])):
                sv_odd.setdefault(c["w"], set()).add(k)
        sv_mass = {w for w, ks in sv_odd.items() if len(ks) > SV_MASS}
        for w in sv_mass:
            log(f"주의: {wname.get(w, w)} 에서 이전 기간이 아닌데 서버가 바뀐 캐릭터가 {len(sv_odd[w])}명 — 서버 통합 · 공지 누락일 수 있어 기록은 그대로 이어가고 서버 이전으로만 남기지 않음")
        n_split = 0
        for k, c in list(cur.items()):
            h = hist.get(k)
            if h is None or not h.get("p") or h["p"][-1][0] >= today:
                continue
            try:
                o, nf, gap = old_fp(h), new_fp(c), today - h["p"][-1][0]
                if k in sv_odd.get(c["w"], ()) and c["w"] not in sv_mass:
                    split = not link_gate(o, nf, gap)          # 서버가 바뀌었는데 수치도 이어지지 않음
                else:
                    split = clearly_other(o, nf, gap)
            except (IndexError, KeyError, TypeError, ValueError):
                split = False       # 비교할 수 없으면 기록을 나누지 않음
            if not split:
                continue
            w, n = k.split("|", 1)
            ok, i = f"{w}|{n}(예전)", 2
            while ok in hist or ok in cur:
                ok, i = f"{w}|{n}(예전{i})", i + 1
            hist[ok] = hist.pop(k)
            hist[ok]["on"] = h.get("on") or n
            if k in self.watch:
                self.watch[ok] = self.watch[k]
            n_split += 1
        if n_split:
            log(f"같은 이름의 다른 캐릭터 {n_split}명 — 예전 기록은 '(예전)' 으로 떼어 내 새 이름을 찾음")

        gone = [k for k, h in hist.items() if k not in cur and int(k.split("|", 1)[0]) in done_w
                and h["p"] and h["p"][-1][0] >= today - LINK_DAYS
                and k.split("|", 1)[1] not in self.alive.get(int(k.split("|", 1)[0]), ())]
        new = [k for k in cur if k not in hist]
        # 후보 = 새로 나타난 캐릭터 + 기준 밖에서 처음 보인 캐릭터(extra). extra 는 연결될 때만 오늘 기록에 넣음
        extra = {k: c for k, c in self.extra.items() if k not in cur and k not in hist and c["w"] in done_w}
        cand = dict(extra)
        cand.update(cur)
        # 업적점수 순으로 정렬해 두고 범위로 찾음 (모든 월드 · 직업 상관없이)
        ck = sorted(new + list(extra), key=lambda k: cand[k]["ach"] or 0)
        cach = [cand[k]["ach"] or 0 for k in ck]
        nfp = {}

        def nf(nk):
            if nk not in nfp:
                nfp[nk] = new_fp(cand[nk])
            return nfp[nk]

        # 사라진 캐릭터마다 조건(link_gate)을 통과한 후보와 점수
        cands = {}      # gk → [(점수, nk, 업적점수로 비교했는지)]
        for gk in gone:
            h = hist[gk]
            lp = h["p"][-1]
            o = old_fp(h)
            gap = max(1, today - lp[0])
            gn = h.get("on") or gk.split("|", 1)[1]
            oa = o["ach"] or 0
            if oa:
                lo, hi = bisect.bisect_left(cach, oa * (1 - LG_ACH_DOWN) - 1e-9), bisect.bisect_right(cach, oa * (1 + LG_ACH_DAY * gap) + 1e-9)
            else:
                lo, hi = 0, bisect.bisect_right(cach, 0)
            l = []
            for nk in ck[lo:hi]:
                c = cand[nk]
                g = link_gate(o, nf(nk), gap)
                if not g or not move_ok(gk, h, c):
                    continue
                sc = raw = link_score(o, nf(nk), gap)
                if h.get("g") and h.get("g") == c["g"]:
                    sc += 3
                if name_related(gn, c["n"]):
                    sc += 3
                if h.get("av") and h.get("av") == c.get("av"):
                    sc += 1
                l.append((sc, nk, g["ach"] and raw > LG_SURE_MIN))   # 수치만의 점수(보너스 제외)가 낮으면 확실 불가
            if l:
                l.sort(key=lambda x: -x[0])
                cands[gk] = l
        rev = {}        # nk → [(점수, gk)]
        for gk, l in cands.items():
            for sc, nk, _ in l:
                rev.setdefault(nk, []).append((sc, gk))
        for v in rev.values():
            v.sort(key=lambda x: -x[0])

        def pct(sc):
            return round(max(1.0, min(100.0, 100 + sc * 1.5)), 1)

        # 확실: 업적점수로 비교했고, 서로 유일한 후보이거나 서로 1등이며 2등과 점수 차이가 LG_SURE_GAP 이상
        pairs = []
        for gk, l in cands.items():
            sc, nk, by_ach = l[0]
            if not by_ach:
                continue        # 업적점수 0 이거나 수치 차이가 큼 → 유력만
            r = rev[nk]
            if r[0][1] != gk:
                continue
            m1 = l[0][0] - l[1][0] if len(l) > 1 else 99
            m2 = r[0][0] - r[1][0] if len(r) > 1 else 99
            if len(l) == 1 and len(r) == 1:
                pairs.append((sc + 100, gk, nk, pct(sc), "지문"))
            elif min(m1, m2) >= LG_SURE_GAP:
                pairs.append((sc + 50, gk, nk, pct(sc), "지문+점수"))
        pairs.sort(reverse=True)
        used_g, used_n = set(), set()
        renamed = []
        for _, gk, nk, sc, how in pairs:
            if gk in used_g or nk in used_n:
                continue
            used_g.add(gk)
            used_n.add(nk)
            h = hist.pop(gk)
            gw = gk.split("|", 1)[0]
            gn = h.pop("on", None) or gk.split("|", 1)[1]
            c = cand[nk]
            out = take(nk)
            if int(gw) != c["w"]:
                h["e"].append([today, "월드 이전", wname.get(int(gw), gw), wname.get(c["w"], c["w"]), sc])
            if gn != c["n"]:
                h["e"].append([today, "닉네임 변경", gn, c["n"], sc])
                renamed.append((nk, gn))
            hist[nk] = h
            mv = {"d": today, "from": [int(gw), gn], "to": [c["w"], c["n"]], "score": sc, "lv": "확실", "how": how,
                  "fs": [h.get("s") or 0, h.get("g") or ""], "ts": [c["s"], c["g"] or ""]}
            if h.get("av") and c.get("av") and h["av"] != c["av"]:
                mv["av"] = 1         # 의상 바뀜
            if out:
                mv["out"] = True     # 수집 기준 밖에서 발견
            moves.append(mv)
            if gk in self.watch:     # 감시 중이던 캐릭터는 새 이름으로 감시 이어감
                self.watch[nk] = max(self.watch.pop(gk), self.watch.get(nk, 0))
        # 유력: 연결하지 못한 사라진 캐릭터의 후보 (점수 상위 3명). 기준 밖(extra) 후보는 후보가 3명 이하일 때만
        seen_pair = {(tuple(m["from"]), tuple(m["to"])) for m in moves}
        likely = 0
        for gk, l in cands.items():
            if gk in used_g:
                continue
            h = hist[gk]
            gw = gk.split("|", 1)[0]
            gn = h.get("on") or gk.split("|", 1)[1]
            l = [x for x in l if x[1] not in used_n]
            if len(l) > 3:
                l = [x for x in l if x[1] not in extra]
            for sc, nk, by_ach in l[:3]:
                c = cand[nk]
                if ((int(gw), gn), (c["w"], c["n"])) in seen_pair:
                    continue
                likely += 1
                mv = {"d": today, "from": [int(gw), gn], "to": [c["w"], c["n"]], "score": pct(sc), "lv": "유력",
                      "n": len(l), "how": "지문" if by_ach else "수치",
                      "fs": [h.get("s") or 0, h.get("g") or ""], "ts": [c["s"], c["g"] or ""]}
                if h.get("av") and c.get("av") and h["av"] != c["av"]:
                    mv["av"] = 1
                if nk in extra:
                    mv["out"] = True
                moves.append(mv)
        if blocked.get("k"):
            log(f"이전 기간이 아닌데 월드 · 서버가 다른 후보만 있던 사라진 캐릭터 {len(blocked['k'])}명 — 그 후보와는 연결하지 않음")
        if likely:
            log(f"유력 후보 {likely}건 (확실히 단정할 수 없어 연결하지 않고 변경 이력에 표시)")
        n_out = sum(1 for k in extra if k in cur)
        if n_out:
            log(f"수집 기준 밖에서 찾은 이전 캐릭터 {n_out}명")
        # 감시 목록: 오늘 월드 · 서버 이전이나 닉네임 변경으로 연결된(확실 · 유력) 캐릭터는 WATCH_DAYS 동안 기준 밖이어도 수집
        for m in moves:
            if m["d"] == today and m.get("lv") in ("확실", "유력") and (
                    m["from"] != m["to"] or (m.get("fs") or [0])[0] != (m.get("ts") or [0])[0]):
                k = ckey(*m["to"])
                self.watch[k] = max(self.watch.get(k, 0), today + WATCH_DAYS)
        self.watch = {k: v for k, v in self.watch.items() if isinstance(v, int) and v >= today}

        # 연관 닉네임 추정 (참고용): 닉네임을 바꾼 캐릭터의 새 이름이 다른 캐릭터(사라진 캐릭터 · 다른 캐릭터의 예전 이름 ·
        # 같은 월드의 현재 캐릭터)의 이름과 비슷하면 기록. 예) A가 B 캐릭터를 사서 A와 관련된 이름으로 바꾼 경우
        if renamed:
            gone_pool = [(k, h) for k, h in hist.items() if k not in cur and h.get("p") and h["p"][-1][0] >= today - ASSOC_GONE_DAYS]
            old_pool = []
            for k, h in hist.items():
                for e in h.get("e", []):
                    if e[1] == "닉네임 변경" and e[0] >= today - 90 and e[2]:
                        old_pool.append((k, e[2], e[0]))
            by_norm = {}
            for k, c in cur.items():
                by_norm.setdefault((c["w"], name_norm(re.sub(r"\d+$", "", c["n"]))), []).append(k)
            na = 0
            for nk, oldn in renamed:
                c = cur[nk]
                newn = c["n"]
                rel = []
                for k, h in gone_pool:
                    w2, n2 = k.split("|", 1)
                    why = name_assoc(newn, n2)
                    if why:
                        rel.append({"w": int(w2), "n": n2, "s": h.get("s") or 0, "g": h.get("g") or "", "kind": "사라진 캐릭터",
                                    "why": why, "d": h["p"][-1][0], "bp": h["p"][-1][1]})
                for k, on, d in old_pool:
                    if k == nk or on == oldn:
                        continue
                    why = name_assoc(newn, on)
                    if why:
                        w2, n2 = k.split("|", 1)
                        o = cur.get(k) or {}
                        rel.append({"w": int(w2), "n": on, "now": n2, "s": o.get("s") or (hist.get(k) or {}).get("s") or 0,
                                    "g": o.get("g") or "", "kind": "다른 캐릭터의 예전 이름", "why": why, "d": d, "bp": o.get("bp")})
                base = name_norm(re.sub(r"\d+$", "", newn))
                if len(base) >= 3:      # 같은 월드 현재 캐릭터는 흔한 짧은 이름이 많아 3글자 이상만
                    for k in by_norm.get((c["w"], base), []):
                        if k == nk:
                            continue
                        o = cur[k]
                        why = name_assoc(newn, o["n"])
                        if why and why != "이름 일부 같음":
                            rel.append({"w": o["w"], "n": o["n"], "s": o["s"], "g": o["g"] or "", "kind": "같은 월드 현재 캐릭터",
                                        "why": why, "d": today, "bp": o["bp"]})
                if rel:
                    order = {"같은 이름": 0, "번호만 다름": 1, "숫자 · 기호만 다름": 2, "이름 일부 같음": 3}
                    korder = {"사라진 캐릭터": 0, "다른 캐릭터의 예전 이름": 0, "같은 월드 현재 캐릭터": 1}
                    rel.sort(key=lambda r: (korder.get(r["kind"], 9), order.get(r["why"], 9), -(r["d"] or 0)))
                    na += 1
                    moves.append({"d": today, "lv": "연관", "from": [c["w"], oldn], "to": [c["w"], newn], "rel": rel[:5]})
            if na:
                log(f"연관 닉네임 추정 {na}건 (참고용)")

        n_sv_skip = n_sv_other = 0
        def same_char(h, c):
            try:
                return bool(link_gate(old_fp(h), new_fp(c), max(1, today - h["p"][-1][0])))
            except (IndexError, KeyError, TypeError):
                return True     # 비교할 수 없으면 기록을 지우지 않음
        for k, c in cur.items():
            h = hist.get(k)
            if h is not None and k in sv_odd.get(c["w"], ()) and h.get("s") and h["s"] != c["s"]:
                # 이전 기간이 아닌데 같은 이름의 서버가 바뀜 → 서버 이전이 아님
                if c["w"] in sv_mass or same_char(h, c):
                    n_sv_skip += 1          # 같은 캐릭터로 보임 (서버 번호 표시 차이 등) — 기록은 이어가되 서버 이전으로 남기지 않음
                    h["s"] = c["s"]
                else:
                    n_sv_other += 1         # 다른 캐릭터가 이 이름을 쓰게 됨 — 예전 캐릭터 기록과 섞지 않고 새로 시작
                    h = hist[k] = {"j": c["j"], "g": c["g"], "s": c["s"], "p": [], "e": []}
            if h is None:
                h = hist[k] = {"j": c["j"], "g": c["g"], "s": c["s"], "p": [], "e": []}
            if h["p"] and h["p"][-1][0] == today:
                h["p"].pop()
            if h["p"]:
                if (h.get("g") or "") != (c["g"] or ""):
                    h["e"].append([today, "길드 변경", h.get("g") or "", c["g"] or "", None])
                if h.get("s") and c["s"] and h["s"] != c["s"] and not any(e[0] == today and e[1] == "월드 이전" for e in h["e"]):
                    h["e"].append([today, "서버 변경", f"{h['s']}서버", f"{c['s']}서버", None])   # 월드 이전 때 서버 번호 차이는 서버 이전이 아님
                if h.get("j") != c["j"] and isinstance(h.get("j"), int):
                    h["e"].append([today, "직업 변경", jobs[h["j"]] if 0 <= h["j"] < len(jobs) else "", jobs[c["j"]], None])
            h["j"], h["g"], h["s"] = c["j"], c["g"], c["s"]
            h["m"] = c["m"]
            h["av"] = c.get("av") or ""
            h["p"].append([today, c["bp"], c["ach"], c["ml"], c["mr"], c["sp"], c["mc"]])

        if n_sv_skip or n_sv_other:
            log(f"이전 기간 밖 서버 변경 무시: 같은 캐릭터 {n_sv_skip}명 · 같은 이름의 다른 캐릭터 {n_sv_other}명")
        cut = today - HIST_DAYS
        for k in list(hist):
            h = hist[k]
            h["p"] = [p for p in h["p"] if p[0] > cut]
            h["e"] = [e for e in h["e"] if e[0] > today - 365][-30:]
            if not h["p"]:
                del hist[k]
        legal = make_legal(tr, wname, today)
        moves = [m for m in moves if m["d"] > today - MOVE_DAYS and (m.get("lv") not in ("확실", "유력") or legal_move(legal, m))]
        vis = {k: v for k, v in cur.items() if k not in self.hidden} if self.hidden else cur   # 오늘 chars 파일에 있는 캐릭터
        _dump(os.path.join(self.data, "gevents.json"), build_gevents(hist, vis, self.mcodes, today))
        _dump(os.path.join(self.data, "changes.json"),
              build_changes(hist, vis, self.mcodes, today, wname, moves, {w: a for w, a in self.alive.items() if w in done_w}, jobs, self.hidden, tr))
        _dump(os.path.join(self.data, "transfer.json"), dict(tr.info, windows=tr.windows))
        _dump(os.path.join(self.data, "watch.json"), self.watch)
        shards = [dict() for _ in range(SHARDS)]
        for k, h in hist.items():
            shards[shard_of(k)][k] = h
        for i, sh in enumerate(shards):
            _dump(os.path.join(self.data, "hist", f"{i:02d}.json"), sh)
        _dump(os.path.join(self.data, "moves.json"), moves)

        runs = list(self.old.get("runs") or [])
        runs.append({"at": now_kst().isoformat(timespec="seconds"), "date": self.dd.isoformat(), "mode": mode,
                     "ok": sum(w["count"] for w in self.wmeta.values()), "fail": fail, "total": total,
                     "secs": round(secs), "moves": len(used_n),
                     "worlds": f"{len(self.wmeta)}/{len(self.order)}"})
        meta = self.meta(len(self.wmeta) < len(self.order), runs)
        _dump(os.path.join(self.data, "meta.json"), meta)
        log(f"완료: 기준일 {self.dd} · 캐릭터 {runs[-1]['ok']:,}명 · 월드 {runs[-1]['worlds']} · 실패 {fail} · 연결 {len(used_n)}건 · {round(secs)}초")
        return meta


GEVENT_DAYS = HIST_DAYS


def build_gevents(hist, cur, mcodes, today):
    """길드 가입·탈퇴 기록 (최근 GEVENT_DAYS일): 캐릭터별 '길드 변경' 기록을 모아 길드 화면에서 바로 쓰도록 정리.
    수집 기준 안에서 이틀 연속 보인 캐릭터끼리 비교한 것 — 순위 밖으로 밀려난 경우는 포함되지 않음."""
    out = []
    cut = today - GEVENT_DAYS
    for k, h in hist.items():
        gev = [e for e in h.get("e", []) if e[1] == "길드 변경" and e[0] > cut]
        if not gev:
            continue
        w, n = k.split("|", 1)
        c = cur.get(k)
        lp = h["p"][-1] if h.get("p") else None
        bp = c["bp"] if c else (lp[1] if lp else None)
        ml = c["ml"] if c else (lp[3] if lp else None)
        mi = c["mc"] if c else (lp[6] if lp else -1)
        mc = mcodes[mi] if isinstance(mi, int) and 0 <= mi < len(mcodes) else (mi if isinstance(mi, str) else None)
        names = [[e[0], e[2], e[3]] for e in h.get("e", []) if e[1] == "닉네임 변경"]
        for e in gev:
            out.append({"d": e[0], "w": int(w), "s": h.get("s") or 0, "n": n, "from": e[2] or "", "to": e[3] or "",
                        "bp": bp, "ml": ml, "mc": mc, "names": names, "seen": bool(c)})
    out.sort(key=lambda x: -x["d"])
    return out


def select_names(names, rule, prev_rows, skip, today, force=False, always=()):
    """조회할 이름 고르기. prev_rows: 전날 chars 행, skip: {이름: [전투력, 서버, 확인일]}, always: 늘 조회할 이름(감시 목록)"""
    if not rule or force or (not prev_rows and not skip):
        return list(names)
    known = {}
    for n, v in (skip or {}).items():
        known[n] = (v[0] or 0, v[1] or 0, v[2] or 0)
    for r in prev_rows or []:
        known[r[0]] = (r[6] or 0, r[1] or 0, today - 1)
    cut = {}
    if rule[0] == "top":
        by_s = {}
        for bp, sv, _ in known.values():
            by_s.setdefault(sv, []).append(bp)
        for sv, l in by_s.items():
            l.sort(reverse=True)
            cut[sv] = l[rule[1] - 1] if len(l) >= rule[1] else 0
    out = []
    for n in names:
        k = known.get(n)
        if k is None or n in always:
            out.append(n); continue
        bp, sv, day = k
        line = rule[1] if rule[0] == "bp" else cut.get(sv, 0)
        if bp >= line * RULE_MARGIN or today - day >= RECHECK_DAYS or zlib.crc32(n.encode("utf-8")) % RECHECK_DAYS == today % RECHECK_DAYS:
            out.append(n)
    return out


def apply_rule(raws, rule, always=()):
    """조회 결과 → (저장할 결과, 기준 밖 결과). always: 기준 밖이어도 저장할 이름(감시 목록)"""
    if not rule:
        return raws, []
    bp = lambda v: to_int(v.get("battle_power_point")) or 0
    if rule[0] == "bp":
        keep = [v for v in raws if bp(v) >= rule[1]]
    else:
        by_s = {}
        for v in raws:
            by_s.setdefault(to_int(v.get("server_code")) or 0, []).append(v)
        keep = []
        for l in by_s.values():
            l.sort(key=lambda v: -bp(v))
            keep += l[:rule[1]]
    ids = set(map(id, keep))
    if always:
        keep += [v for v in raws if id(v) not in ids and (v.get("character_name") in always or v.get("_q") in always)]
        ids = set(map(id, keep))
    return keep, [v for v in raws if id(v) not in ids]


CHANGE_KINDS = ["닉네임 변경", "길드 변경", "월드 이전", "서버 변경"]


def _mcode(mcodes, mi):
    return mcodes[mi] if isinstance(mi, int) and 0 <= mi < len(mcodes) else None


def _now_vals(c, mcodes):
    """현재(오늘 수집) 값 — 없으면 전부 None"""
    if not c:
        return {"bp": None, "ml": None, "mc": None, "sp": None, "ach": None}
    return {"bp": c["bp"], "ml": c["ml"], "mc": _mcode(mcodes, c["mc"]), "sp": c["sp"], "ach": c["ach"]}


LAUNDER_FLAGS = ["월드 이전", "서버 이전", "닉네임 변경", "길드 변경", "의상 변경", "기준 밖에서 발견"]


def launder_level(rn, gch, avch, hops):
    """이전(월드 · 서버) 했다는 전제에서 신분 세탁 의심 정도. None = 목록에 넣지 않음 (이전만 한 경우)"""
    if hops >= 2:
        return "높음"
    if rn:
        return "높음" if (gch or avch) else "보통"
    return "낮음" if gch else None


def build_launder(hist, cur, mcodes, today, wname, moves, hidden=frozenset(), legal=None):
    """신분 세탁 의심: 월드 · 서버 이전과 함께 닉네임 · 길드 · 의상을 바꾼 캐릭터 (최근 CHANGE_DAYS일, 최신 순)
    - 확실 · 유력 연결 중 월드나 서버가 바뀐 것 (서버 이전은 같은 월드 안에서만 비교 — 월드가 다르면 서버 번호는 의미 없음)
    - 같은 이름 그대로 서버만 바뀌고 같은 날 길드도 바뀐 기록
    hops = 이 캐릭터의 연결 사슬에서 최근 CHANGE_DAYS일 동안 이전 · 닉변이 있었던 날 수"""
    cut = today - CHANGE_DAYS
    wcode = {v: k for k, v in wname.items()}
    fwd = {}
    for m in moves:
        if m.get("lv") == "확실":
            fwd.setdefault(ckey(*m["from"]), []).append((m["d"], ckey(*m["to"])))

    def final(k, d):          # 확실 연결을 따라가 지금 키 찾기
        for _ in range(30):
            nx = [x for x in fwd.get(k, ()) if x[0] > d]
            if not nx:
                break
            d, k = min(nx)
        return k

    def tdays(k):
        return {e[0] for e in (hist.get(k) or {}).get("e", ()) if e[1] in ("월드 이전", "서버 변경", "닉네임 변경") and e[0] > cut}

    legal = legal or (lambda *a: True)
    out = []
    for m in moves:
        if m.get("lv") not in ("확실", "유력") or m["d"] <= cut or not legal_move(legal, m):
            continue
        fw, fn = m["from"]
        tw, tn = m["to"]
        fs, fg = (m.get("fs") or [0, ""])
        ts, tg = (m.get("ts") or [0, ""])
        wch = fw != tw
        sch = not wch and bool(fs) and bool(ts) and fs != ts
        if not (wch or sch):
            continue
        if m["lv"] == "유력" and m.get("how") == "수치":
            continue        # 수치만 비슷한 유력 후보는 다른 캐릭터일 때가 많음
        rn, gch, avch = fn != tn, (fg or "").strip() != (tg or "").strip(), bool(m.get("av")) and m["lv"] == "확실"
        tk = final(ckey(tw, tn), m["d"])
        days = tdays(tk) | {m["d"]}
        if m["lv"] == "유력":
            days |= tdays(ckey(fw, fn))     # 연결하지 않은 사라진 캐릭터의 지난 기록
        lvl = launder_level(rn, gch, avch, len(days))
        if not lvl:
            continue
        if m["lv"] == "유력" and lvl == "높음":
            lvl = "보통"    # 같은 캐릭터인지 확실하지 않으면 높음으로 올리지 않음
        flags = [f for f, on in zip(LAUNDER_FLAGS, (wch, sch, rn, gch, avch, bool(m.get("out")))) if on]
        c = cur.get(tk)
        e = {"d": m["d"], "lv": m["lv"], "level": lvl, "flags": flags, "from": {"w": fw, "s": fs or 0, "n": fn, "g": fg or ""},
             "to": {"w": tw, "s": ts or 0, "n": tn, "g": tg or ""}, "score": m.get("score"), "nc": 1 if m["lv"] == "확실" else (m.get("n") or 1)}
        e.update(_now_vals(c, mcodes))
        tw2, tn2 = tk.split("|", 1)
        e.update({"seen": bool(c) and tk not in hidden, "hops": len(days), "now": {"w": int(tw2), "n": tn2}})
        out.append(e)
    for k, h in hist.items():       # 같은 이름으로 서버만 이전 + 같은 날 길드 변경
        ev = h.get("e") or []
        for x in ev:
            if x[1] != "서버 변경" or x[0] <= cut or not legal(x, int(k.split("|", 1)[0])):
                continue
            same = [y for y in ev if y[0] == x[0]]
            ge = [y for y in same if y[1] == "길드 변경"]
            if not ge or any(y[1] in ("월드 이전", "닉네임 변경") for y in same):   # 연결로 생긴 서버 변경은 위에서 다룸
                continue
            w, n = k.split("|", 1)
            w = int(w)
            for y in sorted(ev, key=lambda y: y[0]):   # 그날 이후 바뀐 이름 · 월드가 있으면 그때 값으로
                if y[0] > x[0] and y[1] == "닉네임 변경":
                    n = y[2] or n
                    break
            for y in sorted(ev, key=lambda y: y[0]):
                if y[0] > x[0] and y[1] == "월드 이전":
                    w = wcode.get(y[2], w)
                    break
            days = tdays(k) | {x[0]}
            c = cur.get(k)
            e = {"d": x[0], "lv": "확실", "level": launder_level(False, True, False, len(days)), "flags": ["서버 이전", "길드 변경"],
                 "from": {"w": w, "s": to_int(re.sub(r"\D", "", x[2] or "")) or 0, "n": n, "g": ge[0][2] or ""},
                 "to": {"w": w, "s": to_int(re.sub(r"\D", "", x[3] or "")) or 0, "n": n, "g": ge[0][3] or ""}, "score": None, "nc": 1}
            e.update(_now_vals(c, mcodes))
            e.update({"seen": bool(c) and k not in hidden, "hops": len(days), "now": {"w": w, "n": n}})
            out.append(e)
    lo = {"높음": 0, "보통": 1, "낮음": 2}
    out.sort(key=lambda e: (-e["d"], lo[e["level"]]))
    return out[:3000]


GONE_MAX = 3000


GONE_NEAR = 1.03         # 마지막 전투력이 수집 기준선의 3% 안이면 '기준선 근처(밀려남 가능)'


def gone_lines(cur, wname):
    """월드 · 서버별 수집 기준선: 구월드는 최소 전투력, 신월드(서버별 상위 N위)는 오늘 그 서버에서 수집된 캐릭터의 최저 전투력(=N위 컷)"""
    cut = {}
    for c in cur.values():
        r = rule_of(wname.get(c["w"], ""))
        if r and r[0] == "top":
            k = (c["w"], c["s"])
            if c["bp"] and (k not in cut or c["bp"] < cut[k]):
                cut[k] = c["bp"]

    def line(w, s):
        r = rule_of(wname.get(w, ""))
        if not r:
            return 0
        if r[0] == "bp":
            return r[1]
        return cut.get((w, s), 0)
    return line


def build_gone(hist, cur, mcodes, today, alive, jobs, wname=None, tr=None):
    """사라졌고 아직 (확실히) 연결되지 않은 캐릭터: 오늘 수집한 월드의 사이트 목록에 이름이 없고 마지막 기록이 LINK_DAYS일 안.
    이전 · 닉변 후 아직 못 찾은 캐릭터 외에 삭제된 캐릭터, 사이트 목록(서버별 전투력 1,000위) 밖으로 밀려난 캐릭터도 섞여 있음.
    v1.4.3: 마지막 전투력이 수집 기준선 x RULE_MARGIN 아래였던 캐릭터는 수집 대상이 아니었으므로 빼고(건수만 셈),
    남은 캐릭터에는 이유(why)를 붙임 — 기준선 근처 / 이전 기간 / 닉변 · 삭제 추정."""
    line = gone_lines(cur, wname or {})
    out, below = [], 0
    for k, h in hist.items():
        if k in cur or not h.get("p"):
            continue
        w, n = k.split("|", 1)
        w = int(w)
        if w not in alive or n in alive[w]:
            continue
        lp = h["p"][-1]
        if lp[0] < today - LINK_DAYS:
            continue
        ln = line(w, h.get("s") or 0)
        bp = lp[1] or 0
        if ln and bp < ln * RULE_MARGIN:
            below += 1          # 기준 밖 캐릭터(예: 17만 미만 · 서버 500위 밖)가 사이트 목록에서 사라진 것 — 행방 불명으로 세지 않음
            continue
        if ln and bp < ln * GONE_NEAR:
            why = "기준선 근처"
        elif tr is not None and tr.active(lp[0], today):
            why = "이전 기간"
        else:
            why = "닉변·삭제 추정"
        j = h.get("j")
        if h.get("on"):
            n = h["on"]         # v1.5.0 이름 넘겨받기로 떼어 낸 예전 기록 — 원래 이름으로 표시(지금 그 이름은 다른 캐릭터)
        out.append({"why": why, "w": w, "s": h.get("s") or 0, "n": n, "g": h.get("g") or "",
                    "j": jobs[j] if isinstance(j, int) and 0 <= j < len(jobs) else (j if isinstance(j, str) else ""),
                    "bp": lp[1], "ml": lp[3], "mc": _mcode(mcodes, lp[6]), "sp": lp[5], "ach": lp[2], "last": lp[0]})
        if h.get("on"):
            out[-1]["sw"] = 1   # 이 이름은 지금 다른 캐릭터가 씀
    out.sort(key=lambda e: (-e["last"], -(e["bp"] or 0)))
    return out, below


def legal_move(legal, m):
    """연결표 한 건(m)이 이전 기간 확인을 통과하는지 (월드 · 서버가 바뀐 경우만 확인)"""
    fw, tw = m["from"][0], m["to"][0]
    fs, ts = (m.get("fs") or [0])[0], (m.get("ts") or [0])[0]
    if fw != tw:
        return legal([m["d"], "월드 이전", fw, tw], fw)
    if fs and ts and fs != ts:
        return legal([m["d"], "서버 변경", fs, ts], fw)
    return True


def make_legal(tr, wname, today):
    """변경 기록 e=[날짜, 종류, 이전, 이후, ...] 가 이전 기간에 맞는지. TR_SINCE 이후 기록은 수집할 때 이미 확인했으므로 통과.
    그 전 기록(확인 없이 쌓인 것)은 기록 날짜가 이전 기간(+여유) 안이고 대상 월드 · 서버일 때만 인정."""
    since = dnum(TR_SINCE)

    def nm(v):
        return wname.get(v, v) if isinstance(v, int) else v

    def legal(e, w):
        if e[1] not in ("월드 이전", "서버 변경") or e[0] >= since or tr is None:
            return True
        d = e[0]
        if e[1] == "월드 이전":
            return tr.ok("world", d - TR_GRACE, d, nm(e[2]), nm(e[3]))
        return tr.ok("server", d - TR_GRACE, d, nm(w))
    return legal


def build_changes(hist, cur, mcodes, today, wname, moves=(), alive=None, jobs=(), hidden=frozenset(), tr=None):
    """변경 이력: 최근 CHANGE_DAYS일 닉네임·길드·월드·서버 변경 목록 + 월드/서버 이전 캐릭터별 전체 변경 내역.
    list 한 줄 = [날짜, 종류번호, 월드, 서버, 현재 닉네임, 이전, 이후, 현재 길드, 전투력, 대표 마스터리 레벨, 대표 무기, 현재 수집 대상인지,
                 확실도(1 확실 · 2 유력 · 0 해당 없음), 유력 후보 수, 일치도, 전문화, 업적점수]
    names = 닉네임을 바꾼 적이 있는 캐릭터의 [월드, 현재 닉네임, [[날짜, 이전, 이후], ...], 현재 수집 대상인지] (이전 닉네임 검색용)
    assoc = 연관 닉네임 추정 (참고용)"""
    cut = today - CHANGE_DAYS
    legal = make_legal(tr, wname, today)
    lst, moved, names, assoc = [], [], [], []
    n_ill = 0
    for k, h in hist.items():
        ev = [e for e in h.get("e", []) if e[1] in CHANGE_KINDS]
        bad = [e for e in ev if not legal(e, int(k.split("|", 1)[0]))]
        bad_d = {e[0] for e in bad if e[1] == "월드 이전"}     # 기간 밖 월드 이전 연결 → 그날 함께 생긴 닉네임 · 길드 · 서버 변경도 다른 캐릭터를 잇다 생긴 것
        bad += [e for e in ev if e[0] in bad_d and e not in bad]
        if bad:
            n_ill += sum(1 for e in bad if e[0] > cut)
            ev = [e for e in ev if e not in bad]
        if not ev:
            continue
        w, n = k.split("|", 1)
        c = cur.get(k)
        lp = h["p"][-1] if h.get("p") else None
        bp = c["bp"] if c else (lp[1] if lp else None)
        ml = c["ml"] if c else (lp[3] if lp else None)
        mi = c["mc"] if c else (lp[6] if lp else -1)
        mc = mcodes[mi] if isinstance(mi, int) and 0 <= mi < len(mcodes) else None
        g = (c["g"] if c else h.get("g")) or ""
        s = (c["s"] if c else h.get("s")) or 0
        sp = c["sp"] if c else (lp[5] if lp else None)
        ach = c["ach"] if c else (lp[2] if lp else None)
        nm = [[e[0], e[2] or "", e[3] or ""] for e in ev if e[1] == "닉네임 변경"]
        if nm:
            names.append([int(w), n, nm, 1 if c else 0])
        for e in ev:
            if e[0] > cut:
                k = CHANGE_KINDS.index(e[1])
                conf = 1 if k in (0, 2, 3) else 0
                lst.append([e[0], k, int(w), s, n, e[2] or "", e[3] or "", g, bp, ml, mc, 1 if c else 0, conf, 0, e[4] if len(e) > 4 else None, sp, ach])
        if any(e[1] in ("월드 이전", "서버 변경") for e in ev):
            moved.append({"w": int(w), "s": s, "n": n, "g": g, "bp": bp, "ml": ml, "mc": mc, "seen": bool(c), "lv": "확실",
                          "e": [[e[0], CHANGE_KINDS.index(e[1]), e[2] or "", e[3] or ""] for e in ev],
                          "last": max(e[0] for e in ev if e[1] in ("월드 이전", "서버 변경"))})
    # 유력 후보 (연결하지 않음)
    for m in moves:
        if m.get("lv") == "연관" and m["d"] > cut:
            tw, tn = m["to"]
            c = cur.get(ckey(tw, tn))
            mi = c["mc"] if c else -1
            assoc.append({"d": m["d"], "w": tw, "n": tn, "old": m["from"][1], "s": c["s"] if c else 0, "g": (c["g"] or "") if c else "",
                          "bp": c["bp"] if c else None, "ml": c["ml"] if c else None,
                          "mc": mcodes[mi] if isinstance(mi, int) and 0 <= mi < len(mcodes) else None,
                          "seen": bool(c), "rel": m.get("rel") or []})
        if m.get("lv") != "유력" or m["d"] <= cut:
            continue
        if not legal_move(legal, m):
            n_ill += 1
            continue
        fw, fn = m["from"]
        tw, tn = m["to"]
        fs, fg = (m.get("fs") or [0, ""])
        ts, tg = (m.get("ts") or [0, ""])
        c = cur.get(ckey(tw, tn))
        k = 2 if fw != tw else 3 if fs != ts else 0
        a = f"{wname.get(fw, fw)} {fs:02d}서버 · {fn}" if fs else f"{wname.get(fw, fw)} · {fn}"
        b = f"{wname.get(tw, tw)} {ts:02d}서버 · {tn}" if ts else f"{wname.get(tw, tw)} · {tn}"
        mi = c["mc"] if c else -1
        mc = mcodes[mi] if isinstance(mi, int) and 0 <= mi < len(mcodes) else None
        lst.append([m["d"], k, tw, ts, tn, a, b, tg, c["bp"] if c else None, c["ml"] if c else None, mc, 1 if c else 0, 2, m.get("n") or 1, m.get("score"),
                    c["sp"] if c else None, c["ach"] if c else None])
        if k in (2, 3):
            moved.append({"w": tw, "s": ts, "n": tn, "g": tg, "bp": c["bp"] if c else None, "ml": c["ml"] if c else None, "mc": mc,
                          "seen": bool(c), "lv": "유력", "nc": m.get("n") or 1, "score": m.get("score"), "from": [fw, fn, fs, fg],
                          "e": [[m["d"], k, wname.get(fw, fw) if k == 2 else f"{fs:02d}서버", wname.get(tw, tw) if k == 2 else f"{ts:02d}서버"]]
                               + ([[m["d"], 0, fn, tn]] if fn != tn else []) + ([[m["d"], 1, fg, tg]] if fg != tg else []),
                          "last": m["d"]})
    lst.sort(key=lambda x: (-x[0], x[1]))
    moved.sort(key=lambda x: -x["last"])
    assoc.sort(key=lambda x: -x["d"])
    gone, gone_below = build_gone(hist, cur, mcodes, today, alive or {}, jobs or [], wname, tr)
    return {"date": today, "days": CHANGE_DAYS, "kinds": CHANGE_KINDS, "list": lst[:CHANGE_MAX], "moved": moved[:3000],
            "names": names, "assoc": assoc[:2000],
            "launder": build_launder(hist, cur, mcodes, today, wname, moves, hidden, legal),
            "gone": gone[:GONE_MAX], "gone_total": len(gone), "gone_below": gone_below,
            "windows": (tr.windows if tr else [])[:12], "illegal": n_ill,
            "trinfo": dict((tr.info if tr else {}), active=bool(tr and tr.active(today - LINK_DAYS, today)))}


def crawl_world(fetch, wc, names, workers, tick):
    rows, fail = [], 0

    def one(n):
        return n, fetch.character(wc, n)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(one, n) for n in names]
        for f in as_completed(futs):
            try:
                n, v = f.result()
                if v:
                    v["_q"] = n
                    rows.append(v)
            except Exception:
                fail += 1
            tick()
    return rows, fail


# ------------------------------------------------------------------ 추적 캐릭터 바로 조회 (내 PC 프로그램)
QUICK_DAYS = 120


def quick_update(out, fetch, chars, dd, worlds=None, log=print):
    """chars: [(world, name)]. 결과를 data/quick.json 에 저장하고 [(world, name, 상태, 줄)] 반환"""
    path = os.path.join(out, "data", "quick.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        with open(path, encoding="utf-8") as f:
            q = json.load(f)
    except (OSError, ValueError):
        q = {}
    q.setdefault("rows", {})
    q.setdefault("hist", {})
    wname = dict(worlds or [])
    res = []
    today = dnum(dd) if dd else None
    for w, n in chars:
        w = int(w)
        try:
            v = fetch.character(w, n)
        except Exception as e:
            res.append((w, n, "error", f"{n}: 조회 오류 ({type(e).__name__}) — 인터넷 연결 확인"))
            continue
        if not v:
            res.append((w, n, "missing", f"{n}: {wname.get(w, w)}에서 검색 안 됨 (서버 전투력 1,000위 밖이거나 닉네임 변경·월드 이전)"))
            continue
        r = raw_row(v, n)
        k = ckey(w, r[0])
        q["rows"][k] = r
        line = f"{r[0]}: 전투력 {r[6] or 0:,} · 대표 마스터리 {r[4] or '-'} · 업적 {r[9] or 0:,}"
        if today is not None:
            h = q["hist"].setdefault(k, {"j": r[2], "g": r[11], "s": r[1], "p": [], "e": []})
            if h["p"] and h["p"][-1][0] == today:
                h["p"].pop()
            if h["p"]:
                if (h.get("g") or "") != (r[11] or ""):
                    h["e"].append([today, "길드 변경", h.get("g") or "", r[11] or "", None])
                if h.get("s") and r[1] and h["s"] != r[1]:
                    h["e"].append([today, "서버 변경", f"{h['s']}서버", f"{r[1]}서버", None])
            h["j"], h["g"], h["s"] = r[2], r[11], r[1]
            h["p"].append([today, r[6] or 0, r[9] or 0, r[4], r[5], r[10] or 0, r[3]])
            h["p"] = [p for p in h["p"] if p[0] > today - QUICK_DAYS]
        else:
            line += "  (사이트 갱신 시간이라 기록하지 않음)"
        res.append((w, r[0], "ok", line))
    if dd:
        q["date"] = dd.isoformat()
    q["at"] = now_kst().isoformat(timespec="seconds")
    q["epoch"] = EPOCH.isoformat()
    _dump(path, q)
    return res


def _int_in(v, lo, hi):
    """정수이고 lo~hi 범위일 때만 그 값을, 아니면 None (bool·실수·문자열 거부)"""
    if isinstance(v, bool) or not isinstance(v, int) or v < lo or v > hi:
        return None
    return v


def sanitize_meta(meta, log=print):
    """이전 결과물의 meta.json 은 신뢰하지 않음: 월드 코드는 0~999999 정수만, shards 는 1~256 정수만 (파일 경로에 쓰이므로)"""
    if not isinstance(meta, dict):
        return meta
    ws = []
    for w in meta.get("worlds") or []:
        c = _int_in(w.get("code"), 0, 999999) if isinstance(w, dict) else None
        if c is None:
            log("meta 의 월드 코드가 올바르지 않아 건너뜁니다.")
            continue
        w = dict(w)
        w["code"] = c
        ws.append(w)
    meta = dict(meta)
    meta["worlds"] = ws
    meta["shards"] = _int_in(meta.get("shards"), 1, 256) or SHARDS
    return meta


def copy_prev(out, prev, log=print):
    """수집 없이 이전 데이터를 그대로 가져와 배치 (화면 코드만 바뀐 경우)"""
    prev.net_err = False
    meta = sanitize_meta(prev.read("data/meta.json"), log)
    if not meta:
        if prev.net_err:
            log("이전 데이터를 읽지 못했습니다 (네트워크·서버 오류).")
        else:
            log("이전 데이터가 없습니다 — 빈 화면으로 배포합니다.")
        return None
    data = os.path.join(out, "data")
    os.makedirs(os.path.join(data, "chars"), exist_ok=True)
    os.makedirs(os.path.join(data, "hist"), exist_ok=True)
    os.makedirs(os.path.join(data, "skip"), exist_ok=True)
    files_extra = ["data/gevents.json", "data/changes.json", "data/watch.json", "data/transfer.json"] + [f"data/skip/{w['code']}.json" for w in meta.get("worlds", []) if w.get("rule")]
    files = ["data/meta.json", "data/moves.json"] + files_extra + [f"data/chars/{w['code']}.json" for w in meta.get("worlds", [])] \
        + [f"data/hist/{i:02d}.json" for i in range(meta.get("shards", SHARDS))]
    out_real = os.path.realpath(out)
    for rel in files:
        j = prev.read(rel)
        if j is None:
            continue
        dst = os.path.join(out, *rel.split("/"))
        if not os.path.realpath(dst).startswith(out_real + os.sep):
            log(f"출력 폴더 밖으로 나가는 경로라 건너뜁니다: {rel[:80]!r}")
            continue
        with open(dst, "w", encoding="utf-8") as f:
            json.dump(j, f, ensure_ascii=False, separators=(",", ":"))
    if prev.net_err:
        log("이전 데이터 일부를 읽지 못했습니다 (네트워크·서버 오류) — 불완전한 데이터는 배포하지 않습니다.")
        return None
    log(f"이전 데이터 복사 완료 (기준일 {meta.get('date')})")
    return meta


def copy_site(site_dir, out):
    """화면 파일(index.html 등)을 결과 폴더로 복사"""
    for root, _, files in os.walk(site_dir):
        rel = os.path.relpath(root, site_dir)
        dst = os.path.join(out, rel) if rel != "." else out
        os.makedirs(dst, exist_ok=True)
        for fn in files:
            shutil.copy2(os.path.join(root, fn), os.path.join(dst, fn))


def fresh_check(fetch, prev, old, log=print, n=30):
    """사이트가 오늘 갱신됐는지 확인: 지난 수집의 상위 캐릭터 30명이 전부 그대로면 아직 갱신 전으로 봄"""
    ws = [w for w in old.get("worlds") or [] if w.get("count")]
    if not ws or not old.get("date") or old.get("partial"):
        return True
    j = prev.read(f"data/chars/{ws[0]['code']}.json")
    if not j or not j.get("rows"):
        return True
    same = checked = 0
    for r in j["rows"][:n]:
        try:
            v = fetch.character(ws[0]["code"], r[0])
        except Exception:
            continue
        if not v:
            continue
        checked += 1
        if (to_int(v.get("battle_power_point")), to_int(v.get("achievement_point")), to_int(v.get("specialize_level"))) == (r[6], r[9], r[10]):
            same += 1
    if checked >= 10 and same == checked:
        log(f"사이트 데이터가 아직 갱신되지 않았습니다 (상위 {checked}명 모두 {old['date']} 값과 같음) — 잠시 뒤 다시 시도")
        return False
    return True


def _newer(a, b):
    """meta a 가 b 보다 새 데이터인지 (기준일 → 완성 여부 → 생성 시각)"""
    if not a:
        return False
    if not b:
        return True
    ka = (a.get("date") or "", 0 if a.get("partial") else 1, a.get("generated") or "")
    kb = (b.get("date") or "", 0 if b.get("partial") else 1, b.get("generated") or "")
    return ka > kb


def find_seed(seed):
    """붙여넣은 data 폴더 찾기: seed, seed/web (내 PC 프로그램의 data 폴더째), 현재 폴더 순서로 data/meta.json 이 있는 곳"""
    cands = []
    for s in ([seed] if seed else []):
        cands += [s, os.path.join(s, "web"), os.path.dirname(os.path.abspath(s))]
    for c in cands:
        if c and os.path.exists(os.path.join(c, "data", "meta.json")):
            return c
    return None


def run(out, prev_src="", mode="자동", rate=6.0, workers=4, force=False, no_crawl=False,
        site_dir=None, progress=None, log=print, session=None, now=None, first_worlds=None, seed=None):
    """반환: (상태, meta)  상태 = done | skip | stale | refreshing | copied | error
    seed: 붙여넣은 data 폴더 — 이전 데이터보다 새것이면 그 데이터를 이어받아 바로 씀"""
    say = progress or (lambda *_: None)
    prev = Prev(prev_src)
    used_seed = False
    sd = find_seed(seed)
    if sd and os.path.abspath(sd) != os.path.abspath(out):
        sm = Prev(sd).read("data/meta.json")
        if _newer(sm, prev.read("data/meta.json")):
            log(f"붙여넣은 데이터를 사용합니다: {sd} (기준일 {sm.get('date')})")
            prev_src, prev, used_seed = sd, Prev(sd), True
    same = os.path.abspath(prev_src or "") == os.path.abspath(out)
    if site_dir:
        copy_site(site_dir, out)
    if no_crawl:
        meta = copy_prev(out, prev, log)
        if meta is None and prev_src:
            # 이전 데이터를 못 읽었는데 그대로 배포하면 빈 사이트가 올라감 → 실패로 처리해 배포를 막음
            log("이전 데이터를 읽지 못해 배포를 중단합니다.")
            return "error", None
        return "copied", meta
    dd = data_date_for(now)
    if dd is None and not force:
        log("지금은 사이트 데이터 갱신 시간(10~12시)입니다.")
        if not same:
            copy_prev(out, prev, log)
        return ("copied" if used_seed else "refreshing"), None
    dd = dd or (now or now_kst()).date() - timedelta(days=1)
    old = sanitize_meta(prev.read("data/meta.json"), log)
    if old is None and getattr(prev, "net_err", False):
        log("전날 데이터를 읽지 못했습니다 (네트워크 오류) — 기록이 끊기지 않도록 이번 수집을 멈춥니다")
        return "error", None
    if old and old.get("date") == dd.isoformat() and not old.get("partial") and not force:
        log(f"이미 {dd} 기준 데이터가 있습니다.")
        if not same:
            copy_prev(out, prev, log)
        return ("copied" if used_seed else "skip"), old
    fetch = Fetcher(rate=rate, session=session, log=log)
    if old and not force and not fresh_check(fetch, prev, old, log):
        if not same:
            copy_prev(out, prev, log)
        return ("copied" if used_seed else "stale"), old
    if not same and old:
        copy_prev(out, prev, log)      # 수집이 끝나지 않은 월드는 전날 데이터로 보이도록
    t0 = time.time()
    worlds = fetch.worlds()
    if first_worlds:                   # 추적 중인 캐릭터의 월드를 먼저
        worlds.sort(key=lambda w: (0 if w[0] in first_worlds else 1))
    B = Builder(out, dd, old or {}, worlds)
    B.tr = load_transfer(prev, log, today=(now or now_kst()).date())
    names = {}
    for wc, wn in worlds:
        try:
            names[wc] = list(dict.fromkeys(fetch.names(wc)))
        except Exception as e:
            log(f"{wn} 목록 오류: {e}")
            names[wc] = []
        say("names", wn, len(names[wc]))
    today = dnum(dd)
    plan, skips, prows = {}, {}, {}
    watch = {k: v for k, v in ((prev.read("data/watch.json") or {}) if old else {}).items() if isinstance(v, int) and v >= today}
    wnames = {}
    for k in watch:
        w, n = k.split("|", 1)
        wnames.setdefault(int(w), set()).add(n)
    for wc, wn in worlds:
        rule = rule_of(wn)
        pj = prev.read(f"data/chars/{wc}.json") if old else None
        prows[wc] = (pj or {}).get("rows") or []
        sk = (prev.read(f"data/skip/{wc}.json") or {}) if old else {}
        nameset = set(names[wc])
        skips[wc] = {n: v for n, v in sk.items() if n in nameset}
        plan[wc] = select_names(names[wc], rule, prows[wc], skips[wc], today, force, wnames.get(wc, ()))
        if rule:
            log(f"{wn}: 수집 기준 {rule_text(rule)} — 목록 {len(names[wc]):,}명 중 {len(plan[wc]):,}명 조회")
    B.alive = {wc: set(v) for wc, v in names.items()}
    B.watch = watch
    B.write_partial()
    total = sum(len(v) for v in plan.values())
    st = {"done": 0}
    lock = threading.Lock()

    def tick():
        with lock:
            st["done"] += 1
            if st["done"] % 100 == 0 or st["done"] == total:
                say("chars", st["done"], total)

    fail = 0
    for wc, wn in worlds:
        if not plan[wc]:
            continue
        rows, f = crawl_world(fetch, wc, plan[wc], workers, tick)
        fail += f
        if len(rows) < len(plan[wc]) * 0.5:
            log(f"{wn}: 조회 실패가 많아 저장하지 않습니다 ({len(rows)}/{len(plan[wc])})")
            continue
        rule = rule_of(wn)
        keep, out_rule = apply_rule(rows, rule, wnames.get(wc, ()))
        if rule and (prows[wc] or skips[wc]):   # 전날 몰랐던 이름은 기준 밖이어도 연결 후보로 (기준 밖 자리로 이전한 캐릭터)
            known = set(skips[wc]) | {r[0] for r in prows[wc]}
            B.add_extra(wc, [v for v in out_rule if (v.get("character_name") or v.get("_q")) not in known and v.get("_q") not in known])
        if rule:
            sk = dict(skips[wc])
            got = set()
            for v in rows:
                got.add(v.get("_q")); got.add(v.get("character_name"))
            for r in prows[wc]:          # 이번에 조회하지 않은 전날 캐릭터는 전날 값으로 남김
                if r[0] not in got:
                    sk.setdefault(r[0], [r[6] or 0, r[1] or 0, today - 1])
            for v in keep:
                sk.pop(v.get("_q"), None); sk.pop(v.get("character_name"), None)
            for v in out_rule:
                sk[v.get("character_name") or v.get("_q")] = [to_int(v.get("battle_power_point")) or 0, to_int(v.get("server_code")) or 0, today]
            nameset = set(names[wc])
            B.skip[wc] = {n: x for n, x in sk.items() if n in nameset}
        B.add_world(wc, wn, keep)
        B.write_partial()
        say("world", wn, len(B.wmeta), len(worlds))
        log(f"{wn} 완료 ({len(rows):,}명) — {len(B.wmeta)}/{len(worlds)} 월드")
    if not B.wmeta:
        log("수집 실패 — 저장한 월드가 없습니다.")
        if old:
            _dump(os.path.join(out, "data", "meta.json"), old)
        return "error", None
    meta = B.finish(prev, mode, fail, total, time.time() - t0, log=log)
    return "done", meta


def main():
    ap = argparse.ArgumentParser(description="로드나인 전체 캐릭터 수집기")
    ap.add_argument("--out", default="public", help="결과 폴더")
    ap.add_argument("--prev", default="", help="이전 결과 폴더 또는 웹 주소 (히스토리 이어받기)")
    ap.add_argument("--site", default="", help="함께 복사할 화면 폴더 (예: site)")
    ap.add_argument("--rate", type=float, default=6.0, help="초당 요청 수")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--force", action="store_true", help="갱신 시간·중복 여부와 관계없이 수집")
    ap.add_argument("--no-crawl", action="store_true", help="수집 없이 이전 데이터만 복사")
    ap.add_argument("--seed", default="", help="붙여넣은 data 폴더 (이전 데이터보다 새것이면 사용)")
    a = ap.parse_args()

    def progress(kind, *x):
        if kind == "names":
            print(f"[{now_kst():%H:%M:%S}] {x[0]}: 캐릭터 {x[1]:,}명", flush=True)
        elif kind == "world":
            print(f"[{now_kst():%H:%M:%S}] {x[0]} 완료 ({x[1]}/{x[2]} 월드)", flush=True)
        elif kind == "chars" and (x[0] % 2000 == 0 or x[0] == x[1]):
            print(f"[{now_kst():%H:%M:%S}] 조회 {x[0]:,}/{x[1]:,}", flush=True)

    st, _ = run(a.out, a.prev, mode="자동", rate=a.rate, workers=a.workers, force=a.force,
                no_crawl=a.no_crawl, site_dir=a.site or None, progress=progress, seed=a.seed or None)
    print("결과:", st)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, ".status"), "w") as f:   # GitHub Actions: 새 데이터가 없으면 배포 건너뜀
        f.write(st)
    sys.exit(1 if st == "error" else 0)


if __name__ == "__main__":
    main()
