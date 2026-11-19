# -*- coding: utf-8 -*-
"""
웹 배포용 데이터 암호화 (GitHub Actions 에서 crawler.py 다음에 실행)

  python seal.py public        # public/data/**/*.json 을 암호화하고 public/data/key.json 생성

필요한 값 (GitHub 저장소 Settings → Secrets and variables → Actions → Repository secrets)
  L9_PASS  사이트 입장 비밀번호 (숫자 4자리 이상). 바꾸려면 이 값만 고치고 Actions 에서 [Run workflow].
  L9_KEY   관리용 키 (아무도 모르는 긴 문자열, 한 번 정하면 바꾸지 않음). 수집기가 전날 데이터를 읽을 때 씀.

구조
  DK(데이터 키)  = HMAC-SHA256(MK, "dk|" + 비밀번호)     MK = SHA-256(L9_KEY)
                   → 비밀번호가 같으면 매일 같은 키(로그인 유지), 비밀번호를 바꾸면 키도 바뀜(예전 로그인 무효)
  데이터 파일    = b"L9E1" + 플래그(1바이트, 1=gzip) + IV(12) + AES-256-GCM(DK, gzip(JSON))
  key.json       = {kid, salt, iter, wrap: AES-GCM(PBKDF2(비밀번호, salt, iter), DK), mwrap: AES-GCM(MK, DK)}
                   wrap  → 브라우저가 비밀번호로 DK 를 꺼냄
                   mwrap → 수집기가 L9_KEY 로 DK 를 꺼내 전날 데이터를 읽음
  ※ 4자리 비밀번호는 경우의 수가 1만 개뿐이라, key.json 을 가져가 컴퓨터로 전부 대입하면 풀릴 수 있다
    (PBKDF2 60만 회로 느리게 만들었지만 막을 수는 없음). 사이트를 아무나 못 보게 하는 잠금 정도로 생각할 것.
"""
import os
import sys
import json
import gzip
import hmac
import re
import base64
import hashlib

MAGIC = b"L9E1"
ITER = 600000
AAD = MAGIC


def _aes():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM   # pip install cryptography
    return AESGCM


def b64(b):
    return base64.b64encode(b).decode("ascii")


def b64d(s):
    return base64.b64decode(s)


def master_key(l9_key):
    if not l9_key or len(l9_key) < 32 or len(set(l9_key)) < 12:
        raise SystemExit("L9_KEY 가 없거나 너무 짧거나 단순합니다 (32자 이상, 서로 다른 문자 12개 이상). "
                         "'openssl rand -hex 24' 같은 무작위 값을 쓰세요. 만들어 GitHub Secrets 에 넣으세요.")
    return hashlib.sha256(l9_key.encode("utf-8")).digest()


def data_key(mk, password):
    return hmac.new(mk, b"dk|" + password.encode("utf-8"), hashlib.sha256).digest()


def key_id(mk, password):
    return hmac.new(mk, b"kid|" + password.encode("utf-8"), hashlib.sha256).hexdigest()[:16]


def _wrap(key, plain):
    iv = os.urandom(12)
    return iv + _aes()(key).encrypt(iv, plain, AAD)


def _unwrap(key, blob):
    return _aes()(key).decrypt(blob[:12], blob[12:], AAD)


def seal_bytes(dk, raw):
    iv = os.urandom(12)
    return MAGIC + b"\x01" + iv + _aes()(dk).encrypt(iv, gzip.compress(raw, 6, mtime=0), AAD)


def unseal_bytes(dk, blob):
    if not blob.startswith(MAGIC):
        return blob
    flag, iv, ct = blob[4], blob[5:17], blob[17:]
    raw = _aes()(dk).decrypt(iv, ct, AAD)
    return gzip.decompress(raw) if flag & 1 else raw


def make_key_json(mk, password):
    pw = password.encode("utf-8")
    salt = os.urandom(16)
    kek = hashlib.pbkdf2_hmac("sha256", pw, salt, ITER, 32)
    dk = data_key(mk, password)
    return {"v": 1, "kid": key_id(mk, password), "salt": b64(salt), "iter": ITER,
            "wrap": b64(_wrap(kek, dk)), "mwrap": b64(_wrap(mk, dk))}


def dk_from_key_json(kj, l9_key):
    """수집기용: 전날 key.json 의 mwrap 을 L9_KEY 로 풀어 데이터 키를 얻음"""
    return _unwrap(master_key(l9_key), b64d(kj["mwrap"]))


def check_password(p):
    if not p or not re.fullmatch(r"[0-9]{4,12}", p):
        raise SystemExit("L9_PASS 는 숫자(0-9) 4~12자리여야 합니다. GitHub Secrets 에 넣으세요.")
    return p


DROPS_SRC = "drops.l9e"     # 저장소 site 폴더에 올리는 드랍율 데이터 (관리용 키로 잠금 — 공개 저장소에 평문이 올라가지 않게)


def drops_key(mk):
    return hmac.new(mk, b"drops|v1", hashlib.sha256).digest()


def unpack_drops(out, mk, log=print):
    """site/drops.l9e (화면 파일과 함께 복사됨) → data/drops.json (아래에서 비밀번호 키로 다시 잠김). 원본은 배포하지 않음"""
    src = os.path.join(out, DROPS_SRC)
    if not os.path.isfile(src) or os.path.islink(src):
        return False
    try:
        with open(src, "rb") as f:
            raw = unseal_bytes(drops_key(mk), f.read())
        j = json.loads(raw.decode("utf-8"))
        if j.get("v") != 1 or not isinstance(j.get("d"), list):
            raise ValueError("형식이 맞지 않음")
    except Exception as e:
        log(f"드랍율 데이터(drops.l9e)를 풀지 못했습니다 — 관리용 키(L9_KEY)로 다시 만드세요: {e}")
        os.remove(src)
        return False
    os.makedirs(os.path.join(out, "data"), exist_ok=True)
    with open(os.path.join(out, "data", "drops.json"), "wb") as f:
        f.write(raw)
    os.remove(src)
    log(f"드랍율 데이터 반영 ({j.get('ver', '')}, 드랍 {len(j['d']) // 5:,}줄)")
    return True


def seal_dir(out, password, l9_key, log=print):
    mk = master_key(l9_key)
    password = check_password(password)
    dk = data_key(mk, password)
    unpack_drops(out, mk, log)
    root = os.path.join(out, "data")
    keys = [dk]
    try:       # 이미 잠긴 파일이 있으면(예전 비밀번호) 예전 key.json 으로 풀어서 다시 잠금
        with open(os.path.join(root, "key.json"), encoding="utf-8") as f:
            keys.append(_unwrap(mk, b64d(json.load(f)["mwrap"])))
    except Exception:
        pass
    # 사전 점검: 심볼릭 링크 · .json 이 아닌 파일이 있으면 평문이 그대로 배포될 수 있으므로 중단
    if os.path.islink(root):
        raise SystemExit(f"data 폴더가 링크입니다: {root}")
    for base, dirs, files in os.walk(root):
        for d in dirs:
            if os.path.islink(os.path.join(base, d)):
                raise SystemExit(f"링크 폴더가 있어 암호화를 중단합니다: {os.path.join(base, d)}")
        for fn in files:
            p = os.path.join(base, fn)
            if os.path.islink(p):
                raise SystemExit(f"링크 파일이 있어 암호화를 중단합니다: {p}")
            if not fn.endswith(".json"):
                raise SystemExit(f"data 아래에 .json 이 아닌 파일이 있어 암호화를 중단합니다 (평문 배포 방지): {p}")
    n = 0
    for base, _, files in os.walk(root):
        for fn in files:
            if base == root and fn == "key.json":
                continue
            p = os.path.join(base, fn)
            with open(p, "rb") as f:
                raw = f.read()
            if raw.startswith(MAGIC):
                for k in keys:
                    try:
                        raw = unseal_bytes(k, raw)
                        break
                    except Exception:
                        continue
                else:
                    raise SystemExit(f"이미 잠긴 파일을 풀 수 없습니다: {p}")
            json.loads(raw.decode("utf-8"))      # JSON 이 아니면 여기서 멈춤 (깨진 파일을 배포하지 않도록)
            with open(p, "wb") as f:
                f.write(seal_bytes(dk, raw))
            n += 1
    with open(os.path.join(root, "key.json"), "w", encoding="utf-8") as f:
        json.dump(make_key_json(mk, password), f)
    log(f"데이터 파일 {n}개 암호화 · key.json 생성")
    return n


def seal_drops(src, dst, l9_key):
    """드랍율 파일(dropdb.py 결과)을 관리용 키로 잠가 site/drops.l9e 로 저장 — 이 파일만 저장소에 올림"""
    with open(src, "rb") as f:
        raw = f.read()
    j = json.loads(raw.decode("utf-8"))
    if j.get("v") != 1 or not isinstance(j.get("d"), list):
        raise SystemExit("dropdb.py 로 만든 drops.json 이 아닙니다: " + src)
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    with open(dst, "wb") as f:
        f.write(seal_bytes(drops_key(master_key(l9_key)), raw))
    print(f"잠금 완료 → {dst} ({os.path.getsize(dst) / 1024:,.0f}KB). 이 파일을 저장소 site 폴더에 올리세요.")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "drops":     # python seal.py drops data/web/data/drops.json site/drops.l9e
        src = sys.argv[2] if len(sys.argv) > 2 else os.path.join("data", "web", "data", "drops.json")
        dst = sys.argv[3] if len(sys.argv) > 3 else os.path.join("site", DROPS_SRC)
        key = os.environ.get("L9_KEY", "").strip()
        if not key:
            import getpass
            key = getpass.getpass("관리용 키(GitHub Secrets 의 L9_KEY)를 붙여 넣고 Enter (화면에 보이지 않음): ").strip()
        seal_drops(src, dst, key)
        return
    out = sys.argv[1] if len(sys.argv) > 1 else "public"
    if not os.path.isdir(os.path.join(out, "data")):
        print("암호화할 데이터가 없습니다:", out)
        return
    seal_dir(out, os.environ.get("L9_PASS", "").strip(), os.environ.get("L9_KEY", "").strip())


if __name__ == "__main__":
    main()
