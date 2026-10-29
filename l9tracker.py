# -*- coding: utf-8 -*-
"""
로드나인 캐릭터 추적기 — 내 PC 프로그램 (v0.6)

웹 버전과 같은 화면(site 폴더)을 내 컴퓨터에서 띄운다.
- 매일 12:00 전체 캐릭터를 수집해 랭킹 · TOP 20 · 통계 · 추적 데이터를 만든다 (crawler.py)
- data/config.json 의 "web_url" 에 웹 버전 주소를 넣으면 직접 수집하지 않고 웹 버전 데이터를 받아온다

  python l9tracker.py          화면 열기
  python l9tracker.py --auto   작업 스케줄러용 (수집만 하고 종료)
"""
import os
import sys
import json
import time
import sqlite3
import threading
import webbrowser
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

import crawler

APP_NAME = "로드나인 캐릭터 추적기"
VERSION = "0.8.5"
PORT = 8765
AUTO_HOUR = 12


def app_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def site_dir():
    base = getattr(sys, "_MEIPASS", None) or app_dir()
    return os.path.join(base, "site")


DATA_DIR = os.path.join(app_dir(), "data")
WEB_DIR = os.path.join(DATA_DIR, "web")          # 수집 결과 (data/web/data/*.json)
DB_PATH = os.path.join(DATA_DIR, "l9tracker.db")  # 0.5 이하 기록 (가져오기용)
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")
LOG_PATH = os.path.join(DATA_DIR, "log.txt")

DEFAULT_CONFIG = {
    "web_url": "",      # 예: https://내아이디.github.io/l9tracker/  (넣으면 웹 버전 데이터를 받아옴)
    "rate": 6,          # 직접 수집할 때 초당 요청 수 (오류가 나면 저절로 느려짐)
    "workers": 4,
}


def now_kst():
    return crawler.now_kst()


def log(msg):
    os.makedirs(DATA_DIR, exist_ok=True)
    line = f"[{now_kst():%Y-%m-%d %H:%M:%S}] {msg}"
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass
    return line


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, encoding="utf-8") as f:
                old = json.load(f)
            cfg.update({k: v for k, v in old.items() if k in DEFAULT_CONFIG or k == "masteries"})
    except (OSError, ValueError):
        pass
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except OSError:
        pass
    return cfg


def local_meta():
    try:
        with open(os.path.join(WEB_DIR, "data", "meta.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------- 수집 (백그라운드)
class Crawl:
    lock = threading.Lock()
    state = {"running": False, "done": 0, "total": 0, "phase": "", "msg": "", "last_try": 0.0, "started": None,
             "worlds_done": 0, "worlds_total": 0}

    @classmethod
    def start(cls, mode="수동", force=False, wait=False):
        if not cls.lock.acquire(blocking=False):
            return "running"
        cls.state.update(running=True, done=0, total=0, phase="준비", msg="", last_try=time.time(),
                         started=now_kst().isoformat(timespec="seconds"), worlds_done=0, worlds_total=0)

        def job():
            try:
                cfg = load_config()
                os.makedirs(WEB_DIR, exist_ok=True)
                web = (cfg.get("web_url") or "").strip()

                def progress(kind, *x):
                    if kind == "names":
                        cls.state["phase"] = f"{x[0]} 목록"
                        cls.state["total"] += x[1]
                    elif kind == "chars":
                        cls.state.update(phase="조회", done=x[0], total=x[1])
                    elif kind == "world":
                        cls.state.update(worlds_done=x[1], worlds_total=x[2], phase=f"{x[0]} 완료")

                if web:
                    log(f"웹 버전 데이터 받아오기: {web}")
                    cls.state["phase"] = "웹 데이터 받는 중"
                    old = local_meta()
                    meta = crawler.copy_prev(WEB_DIR, crawler.Prev(web), log=log)
                    st = "copied" if meta else "error"
                    if meta and old and old.get("generated") == meta.get("generated"):
                        cls.state["msg"] = f"최신 데이터입니다 (기준일 {meta.get('date')})"
                    elif meta:
                        cls.state["msg"] = f"새 데이터를 받았습니다 (기준일 {meta.get('date')})"
                    else:
                        cls.state["msg"] = "웹 버전 데이터를 받지 못했습니다. 주소를 확인하세요."
                else:
                    log(f"전체 수집 시작 ({mode})")
                    st, meta = crawler.run(WEB_DIR, WEB_DIR, mode=mode, rate=float(cfg.get("rate") or 6),
                                           workers=int(cfg.get("workers") or 4), force=force,
                                           progress=progress, log=log,
                                           first_worlds={w for w, _ in load_tracked()})
                    cls.state["msg"] = {
                        "done": f"수집 완료 (기준일 {meta['date'] if meta else ''})",
                        "skip": f"이미 최신 데이터입니다 (기준일 {meta['date'] if meta else ''})",
                        "refreshing": "지금은 사이트 데이터 갱신 시간(10~12시)입니다. 12시 이후에 다시 눌러 주세요.",
                        "stale": "사이트 데이터가 아직 갱신되지 않았습니다. 30분 뒤 자동으로 다시 시도합니다.",
                        "error": "수집 실패 — 인터넷 연결을 확인하세요. 30분 뒤 다시 시도합니다.",
                    }.get(st, st)
                log(cls.state["msg"])
            except Exception as e:
                cls.state["msg"] = "수집 실패 — 인터넷 연결을 확인하세요. 30분 뒤 다시 시도합니다."
                log(f"수집 오류: {e}")
            finally:
                cls.state["running"] = False
                cls.lock.release()

        if wait:
            job()
        else:
            threading.Thread(target=job, daemon=True).start()
        return "started"


def auto_due(now=None):
    """12시 이후, 받아야 할 기준일 데이터가 없고, 30분 안에 시도하지 않았으면 True"""
    now = now or now_kst()
    if now.hour < AUTO_HOUR:
        return False
    dd = crawler.data_date_for(now)
    m = local_meta()
    if dd is None or (m and m.get("date") == dd.isoformat() and not m.get("partial")):
        return False
    return time.time() - Crawl.state["last_try"] > 30 * 60


# ---------------------------------------------------------------- 추적 캐릭터 바로 조회
TRACKED_PATH = os.path.join(WEB_DIR, "tracked.json")
_quick_lock = threading.Lock()
_live = {"fetch": None, "worlds": None, "names": {}}


def live():
    if _live["fetch"] is None:
        _live["fetch"] = crawler.Fetcher(rate=4, log=log, tries=2, quick=True)
    return _live["fetch"]


def live_worlds():
    if not _live["worlds"]:
        try:
            _live["worlds"] = live().worlds()
        except Exception:
            m = local_meta()
            if m:
                return [(w["code"], w["name"]) for w in m.get("worlds", [])]
            raise
    return _live["worlds"]


def live_names(wc):
    c = _live["names"].get(wc)
    if not c or time.time() - c[0] > 600:
        c = _live["names"][wc] = (time.time(), live().names(wc))
    return c[1]


def load_tracked():
    try:
        with open(TRACKED_PATH, encoding="utf-8") as f:
            return [(int(w), n) for w, n in json.load(f)]
    except (OSError, ValueError, TypeError):
        return []


def save_tracked(chars):
    os.makedirs(WEB_DIR, exist_ok=True)
    with open(TRACKED_PATH, "w", encoding="utf-8") as f:
        json.dump([[int(w), n] for w, n in chars], f, ensure_ascii=False)


def quick(chars, stale_only=False):
    """추적 캐릭터를 사이트에서 바로 조회해 기록 (몇 초)"""
    chars = [(int(w), n) for w, n in chars if n]
    if not chars:
        return {"lines": [], "skipped": False}
    with _quick_lock:
        dd = crawler.data_date_for()
        qpath = os.path.join(WEB_DIR, "data", "quick.json")
        if stale_only and dd:
            try:
                with open(qpath, encoding="utf-8") as f:
                    q = json.load(f)
                have = set(q.get("rows", {}))
                if q.get("date") == dd.isoformat() and all(crawler.ckey(w, n) in have for w, n in chars):
                    return {"lines": [], "skipped": True}
            except (OSError, ValueError):
                pass
        try:
            worlds = live_worlds()
        except Exception:
            worlds = []
        res = crawler.quick_update(WEB_DIR, live(), chars, dd, worlds, log=log)
    for _, _, _, line in res:
        log("바로 조회: " + line)
    return {"lines": [r[3] for r in res], "results": [[r[0], r[1], r[2]] for r in res], "skipped": False,
            "date": dd.isoformat() if dd else None}


# ---------------------------------------------------------------- 예전 기록 가져오기 (0.5 이하)
def legacy_data():
    if not os.path.exists(DB_PATH):
        return {"chars": []}
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    out = []
    try:
        for ch in con.execute("SELECT * FROM characters ORDER BY id"):
            ms = {r["code"]: {"level": r["level"], "date": r["date"], "source": r["source"]}
                  for r in con.execute("SELECT * FROM masteries WHERE char_id=?", (ch["id"],))}
            integ = [dict(r) for r in con.execute("SELECT date, level, pct FROM integrated WHERE char_id=? ORDER BY date", (ch["id"],))]
            out.append({"world_code": ch["world_code"], "name": ch["name"], "created": (ch["created"] or "")[:10],
                        "masteries": ms, "integ": integ})
    except sqlite3.Error:
        pass
    finally:
        con.close()
    return {"chars": out}


# ---------------------------------------------------------------- 화면 열기 (전용 창)
STORE_PATH = os.path.join(DATA_DIR, "store.json")   # 추적·즐겨찾기·메모·설정 (브라우저 대신 프로그램 폴더에 저장)


def open_ui(url):
    """평소 쓰는 기본 브라우저로 화면 열기"""
    webbrowser.open(url)


def read_store():
    try:
        with open(STORE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_store(obj):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, STORE_PATH)


# ---------------------------------------------------------------- 오류 기록
def report_crash():
    import traceback
    tb = traceback.format_exc()
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(os.path.join(DATA_DIR, "error.txt"), "w", encoding="utf-8") as f:
            f.write(f"[{now_kst():%Y-%m-%d %H:%M:%S}] v{VERSION}\n{tb}")
    except OSError:
        pass
    print(tb)
    try:
        import tkinter as tk
        from tkinter import messagebox
        r = tk.Tk()
        r.withdraw()
        messagebox.showerror(APP_NAME, "오류로 프로그램이 종료되었습니다.\n\n"
                                       f"{tb.strip().splitlines()[-1]}\n\n자세한 내용: data\\error.txt")
    except Exception:
        pass


# ---------------------------------------------------------------- 화면 서버
CTYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
          ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".gif": "image/gif",
          ".txt": "text/plain; charset=utf-8"}


def safe_join(root, rel):
    p = os.path.normpath(os.path.join(root, *[x for x in rel.split("/") if x not in ("", ".", "..")]))
    return p if p.startswith(os.path.normpath(root)) else None


def run_web():
    from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

    port = PORT
    url = f"http://127.0.0.1:{port}/"

    def running_version():
        try:
            with urllib.request.urlopen(url + "api/hello", timeout=1.5) as r:
                j = json.loads(r.read())
                return j.get("version") if j.get("app") == "l9tracker" else "other"
        except Exception:
            return None

    # 이미 실행 중: 같은 버전이면 화면만 열고, 예전 버전이면 끄고 새로 시작
    old = running_version()
    if old == VERSION:
        open_ui(url)
        return
    if old and old != "other":
        log(f"예전 버전({old}) 실행 중 → 종료하고 v{VERSION} 으로 다시 시작")
        try:
            req = urllib.request.Request(url + "api/quit", data=b"{}", method="POST",
                                         headers={"X-L9": "1", "Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=3).read()
        except Exception:
            pass
        for _ in range(20):
            time.sleep(0.5)
            if running_version() is None:
                break

    load_config()
    SITE = site_dir()
    last_ping = {"t": None}
    migrated = threading.Event()
    srv_box = {}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj, code=200):
            self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

        def _file(self, path):
            if not path or not os.path.isfile(path):
                return self._json({"error": "없는 주소"}, 404)
            with open(path, "rb") as f:
                body = f.read()
            self._send(200, body, CTYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream"))

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            p = urllib.parse.unquote(u.path)
            try:
                if p == "/api/hello":
                    return self._json({"app": "l9tracker", "version": VERSION})
                if p == "/api/local":
                    m = local_meta()
                    return self._json({"version": VERSION, "crawl": Crawl.state, "auto_hour": AUTO_HOUR,
                                       "data_date": m.get("date") if m else None,
                                       "web_url": load_config().get("web_url", "")})
                if p == "/api/store":
                    return self._json(read_store() or {})
                if p == "/api/legacy":
                    return self._json(legacy_data())
                if p == "/api/worlds":
                    return self._json({"worlds": live_worlds()})
                if p == "/api/char":
                    q = urllib.parse.parse_qs(u.query)
                    v = live().character(int(q["world"][0]), q["name"][0])
                    dd = crawler.data_date_for()
                    return self._json({"row": crawler.raw_row(v, q["name"][0]) if v else None,
                                       "date": dd.isoformat() if dd else None})
                if p == "/api/names":
                    q = urllib.parse.parse_qs(u.query)
                    wc = int(q["world"][0])
                    s = q.get("q", [""])[0].strip()
                    return self._json({"names": [n for n in live_names(wc) if s in n][:60]})
                if p.startswith("/data/"):
                    return self._file(safe_join(WEB_DIR, p))
                if p in ("/", ""):
                    p = "/index.html"
                return self._file(safe_join(SITE, p))
            except Exception as e:
                self._json({"error": str(e)}, 500)

        def do_POST(self):
            if self.headers.get("X-L9") != "1":   # 다른 사이트가 몰래 조작하지 못하도록
                return self._json({"error": "허용되지 않은 요청"}, 403)
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                body = {}
            p = urllib.parse.urlparse(self.path).path
            try:
                if p == "/api/store":
                    cur = read_store() or {}
                    if body.get("migrate") and cur.get("store"):
                        migrated.set()               # 이미 옮겨져 있으면 덮어쓰지 않음
                        return self._json({"ok": True, "kept": True})
                    if "store" in body:
                        cur["store"] = body["store"]
                    if body.get("prefs"):
                        cur.setdefault("prefs", {}).update(body["prefs"])
                    write_store(cur)
                    if body.get("migrate"):
                        log("이전 기록을 프로그램 폴더로 옮김")
                        migrated.set()
                    return self._json({"ok": True})
                if p == "/api/ping":
                    last_ping["t"] = time.time()
                    return self._json({"ok": True})
                if p == "/api/quit":
                    self._json({"ok": True})
                    threading.Thread(target=srv_box["srv"].shutdown, daemon=True).start()
                    return
                if p == "/api/quick":
                    chars = body.get("chars") or []
                    if body.get("save_list"):
                        save_tracked(chars)
                    return self._json(quick(chars, stale_only=bool(body.get("stale_only"))))
                if p == "/api/tracked":
                    save_tracked(body.get("chars") or [])
                    return self._json({"ok": True})
                if p == "/api/refresh":
                    chars = body.get("chars") or []
                    if chars:
                        save_tracked(chars)
                    qr = quick(chars) if chars else {"lines": []}
                    cfg = load_config()
                    if not (cfg.get("web_url") or "").strip():
                        dd = crawler.data_date_for()
                        m = local_meta()
                        if dd is None and not body.get("force"):
                            return self._json({"state": "refreshing", "lines": qr["lines"],
                                               "message": "지금은 사이트 데이터 갱신 시간(10~12시)이라 랭킹·통계 수집은 12시 이후에 합니다."})
                        if m and dd and m.get("date") == dd.isoformat() and not m.get("partial") and not body.get("force"):
                            return self._json({"state": "skip", "lines": qr["lines"],
                                               "message": f"랭킹·통계는 이미 최신입니다 (기준일 {m['date']})."})
                    st = Crawl.start("수동", force=bool(body.get("force")))
                    return self._json({"state": "started" if st == "started" else "running", "lines": qr["lines"],
                                       "message": "랭킹·통계 전체 수집이 이미 진행 중입니다." if st == "running"
                                       else "랭킹·통계 전체 수집을 시작했습니다. 월드가 하나 끝날 때마다 바로 표시됩니다."})
                self._json({"error": "없는 주소"}, 404)
            except Exception as e:
                self._json({"error": str(e)}, 500)

    srv = None
    for p_try in range(PORT, PORT + 10):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", p_try), H)
            port = p_try
            break
        except OSError:
            continue
    if srv is None:
        raise RuntimeError("사용할 수 있는 포트가 없습니다. 컴퓨터를 다시 시작한 뒤 실행해 보세요.")
    url = f"http://127.0.0.1:{port}/"
    srv_box["srv"] = srv

    def watchdog():
        # 브라우저 탭을 닫고 2분이 지나면 자동 종료 (수집 중이면 끝날 때까지 기다림)
        while True:
            time.sleep(20)
            if last_ping["t"] and time.time() - last_ping["t"] > 120 and not Crawl.state["running"]:
                srv.shutdown()
                return
    threading.Thread(target=watchdog, daemon=True).start()

    def scheduler():
        time.sleep(5)
        while True:
            try:
                if not Crawl.state["running"] and auto_due():
                    tr = load_tracked()
                    if tr:
                        quick(tr)
                    Crawl.start("자동")
            except Exception as e:
                log(f"자동 수집 오류: {e}")
            time.sleep(60)
    threading.Thread(target=scheduler, daemon=True).start()
    def launch():
        open_ui(url)
    threading.Timer(0.8, launch).start()
    print(f"{APP_NAME} v{VERSION}\n브라우저에서 화면이 열립니다: {url}\n이 창을 닫으면 프로그램이 종료됩니다.")
    log(f"v{VERSION} 시작")
    srv.serve_forever()


def run_auto():
    """작업 스케줄러용: 받아야 할 데이터가 있으면 수집하고 종료"""
    force = "--force" in sys.argv
    # 화면 프로그램이 켜져 있으면 그쪽에 맡김 (같은 폴더를 두 번 수집하지 않도록)
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/hello", timeout=1.5) as r:
            if json.loads(r.read()).get("app") == "l9tracker":
                log("자동 수집: 켜져 있는 프로그램이 수집합니다")
                return
    except Exception:
        pass
    if not force and crawler.data_date_for() is None:
        log("자동 수집: 사이트 갱신 시간이라 건너뜀")
        return
    m = local_meta()
    dd = crawler.data_date_for()
    if not force and m and dd and m.get("date") == dd.isoformat() and not (load_config().get("web_url") or "").strip():
        log("자동 수집: 이미 최신")
        return
    tr = load_tracked()
    if tr and crawler.data_date_for():
        quick(tr)
    Crawl.start("자동", force=force, wait=True)


if __name__ == "__main__":
    try:
        if "--auto" in sys.argv:
            run_auto()
        else:
            run_web()
    except Exception:
        report_crash()
        sys.exit(1)
