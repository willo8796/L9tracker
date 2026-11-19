# -*- coding: utf-8 -*-
"""로드나인 드랍율 DB(lordnine_drop.db 또는 .json) → 추적기 화면용 작은 파일(drops.json)

  python dropdb.py lordnine_drop.db [출력 경로]
  출력 기본값: data/web/data/drops.json (내 PC 프로그램이 바로 씀)

drops.json 구조 (v=1)
  ver  : 데이터 기준(예: 2026-11-18 패치), date: 그 패치 날짜(YYYY-MM-DD), gv: 게임 클라이언트 버전(있을 때만), made: 만든 날
  maps : 사냥터 이름 목록
  tiers: 몬스터 구분 이름 목록, grades: 아이템 등급 이름 목록 (낮은 등급 → 높은 등급)
  mons : [[몬스터ID, 이름, 레벨, 구분번호, [사냥터번호...]], ...]
  items: [[아이템ID, 이름, 등급번호], ...]
  d    : [몬스터번호, 아이템번호, 드랍율(%), 최소수량, 최대수량, ...] 5개씩 이어 붙임
  boxes: [[상자ID, 이름, 등급번호, 추첨 횟수, 조건지급 의심(1/0)], ...]   (DB 에 boxes 표가 있을 때)
  b    : [상자번호, 아이템번호, 확률(%), 최소수량, 최대수량, ...] 5개씩
"""
import json
import os
import re
import sqlite3
import sys
from datetime import date

GRADES = ["일반", "고급", "희귀", "영웅", "전설", "신화"]
TIERS = ["일반", "정예", "네임드", "보스", "기타"]


def rows_from_db(p):
    c = sqlite3.connect(p)
    meta = dict(c.execute("select key, value from meta").fetchall()) if c.execute(
        "select 1 from sqlite_master where name='meta'").fetchone() else {}
    mons = c.execute("select monster_id, monster_name, level, tier, maps from monsters").fetchall()
    drops = c.execute("select monster_id, item_id, item_name, item_grade, drop_rate_pct, amount_min, amount_max, "
                      "monster_name, level, tier, maps from drops").fetchall()
    boxes = c.execute("select box_id, box_name, box_grade, rolls, conditional, item_id, item_name, item_grade, rate_pct, "
                      "amount_min, amount_max from boxes").fetchall() if c.execute(
        "select 1 from sqlite_master where name='boxes'").fetchone() else []
    return meta, mons, drops, boxes


def rows_from_json(p):
    with open(p, encoding="utf-8") as f:
        j = json.load(f)
    meta = j.get("meta") or {}
    mons = [(m["monster_id"], m["monster_name"], m.get("level"), m.get("tier"), m.get("maps") or "") for m in j.get("monsters", [])]
    drops = [(d["monster_id"], d["item_id"], d["item_name"], d.get("item_grade"), d["drop_rate_pct"], d.get("amount_min"),
              d.get("amount_max"), d.get("monster_name"), d.get("level"), d.get("tier"), d.get("maps") or "") for d in j.get("drops", [])]
    boxes = [(b["box_id"], b.get("box_name"), b.get("box_grade"), b.get("rolls"), b.get("conditional"), b["item_id"], b.get("item_name"),
              b.get("item_grade"), b["rate_pct"], b.get("amount_min"), b.get("amount_max")) for b in j.get("boxes", [])]
    return meta, mons, drops, boxes


def build(src, gv=""):
    meta, mons, drops, boxes = (rows_from_json if src.lower().endswith(".json") else rows_from_db)(src)
    maps, mi_of, mon_rows = [], {}, []
    map_ix = {}

    def map_ids(s):
        out = []
        for x in (s or "").split(","):
            x = x.strip()
            if not x:
                continue
            if x not in map_ix:
                map_ix[x] = len(maps)
                maps.append(x)
            out.append(map_ix[x])
        return out

    tiers = list(TIERS)

    def tier_id(t):
        t = t or "기타"
        if t not in tiers:
            tiers.append(t)
        return tiers.index(t)

    for mid, name, lvl, tier, mp in mons:
        mi_of[mid] = len(mon_rows)
        mon_rows.append([mid, name or "", lvl or 0, tier_id(tier), map_ids(mp)])
    grades = list(GRADES)
    items, ii_of, d = [], {}, []
    for mid, iid, iname, grade, rate, amin, amax, mname, lvl, tier, mp in drops:
        if mid not in mi_of:          # 몬스터 표에 없으면 드랍 줄의 값으로 추가
            mi_of[mid] = len(mon_rows)
            mon_rows.append([mid, mname or "", lvl or 0, tier_id(tier), map_ids(mp)])
        if iid not in ii_of:
            g = grade or "일반"
            if g not in grades:
                grades.append(g)
            ii_of[iid] = len(items)
            items.append([iid, iname or "", grades.index(g)])
        r = float(rate or 0)
        d += [mi_of[mid], ii_of[iid], float(f"{r:.4g}"), int(amin or 1), int(amax or amin or 1)]

    def item_ix(iid, iname, grade):
        if iid not in ii_of:
            g = grade or "일반"
            if g not in grades:
                grades.append(g)
            ii_of[iid] = len(items)
            items.append([iid, iname or "", grades.index(g)])
        return ii_of[iid]

    box_rows, bi_of, b = [], {}, []
    for bid, bname, bgrade, rolls, cond, iid, iname, igrade, rate, amin, amax in boxes:
        if bid not in bi_of:
            g = bgrade or "일반"
            if g not in grades:
                grades.append(g)
            bi_of[bid] = len(box_rows)
            box_rows.append([bid, bname or "", grades.index(g), int(rolls or 1), 1 if (cond or "").strip().upper() == "Y" else 0])
        r = float(rate or 0)
        b += [bi_of[bid], item_ix(iid, iname, igrade), float(f"{r:.4g}"), int(amin or 1), int(amax or amin or 1)]
    ver = meta.get("data_version", "")
    m = re.search(r"(20\d\d)[-./ ]?(\d{1,2})[-./ ]?(\d{1,2})", ver)
    pd = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else ""
    gv = gv or next((str(meta[k]) for k in ("client_version", "game_version", "app_version", "version") if meta.get(k)), "")
    return {"v": 1, "ver": ver, "date": pd, "gv": gv.strip()[:40], "made": date.today().isoformat(), "src": meta.get("source", ""),
            "note": meta.get("excluded", ""), "maps": maps, "tiers": tiers, "grades": grades,
            "mons": mon_rows, "items": items, "d": d, "boxes": box_rows, "b": b}


def main():
    if len(sys.argv) < 2:
        raise SystemExit("사용법: python dropdb.py lordnine_drop.db [출력 경로] [게임 버전]")
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join("data", "web", "data", "drops.json")
    j = build(sys.argv[1], sys.argv[3] if len(sys.argv) > 3 else "")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(j, f, ensure_ascii=False, separators=(",", ":"))
    print(f"기준: {j['ver'] or '(없음)'}{' · 게임 버전 ' + j['gv'] if j['gv'] else ''}")
    print(f"몬스터 {len(j['mons']):,}종 · 상자 {len(j['boxes']):,}종 · 아이템 {len(j['items']):,}종 · 드랍 {len(j['d']) // 5:,}줄 · 상자 {len(j['b']) // 5:,}줄 → {out} ({os.path.getsize(out) / 1024:,.0f}KB)")


if __name__ == "__main__":
    main()
