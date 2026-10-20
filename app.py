"""EduSpace — 나이스 학사 데이터 + 실시간 학급 협업 플랫폼 (서버)

- 로그인: 빠른 로그인(이름·학교·학년·반), 체험 로그인, 구글 로그인(.env 에 키가 있을 때)
- 학급(교육청-학교-학년-반 = scope) 단위 데이터: 공유 달력, 과목별 패들렛, 공유 문서함, 공유 노트
- 실시간: /ws 웹소켓으로 변경 알림·접속자·노트 동시 편집(OT). 웹소켓이 안 되면 화면이 HTTP로 대신 주고받는다
- 나이스: 학교 검색·학사일정·급식 (키가 없거나 연결이 안 되면 예시 데이터)
"""
import io
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from flask import Flask, g, redirect, render_template, request, send_file, session
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_sock import Sock

import neis
import ot

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", "dev-change-me"),
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_HTTPONLY=True,
    PERMANENT_SESSION_LIFETIME=timedelta(days=60),
    MAX_CONTENT_LENGTH=12 * 1024 * 1024,
)
sock = Sock(app)
limiter = Limiter(get_remote_address, app=app, default_limits=[], storage_uri="memory://")
if os.environ.get("ES_TESTING") == "1":
    limiter.enabled = False

KST = ZoneInfo("Asia/Seoul")
DB_PATH = os.environ.get("ES_DB", os.path.join(app.root_path, "app.db"))
UPLOAD_DIR = os.environ.get("ES_UPLOADS", os.path.join(app.root_path, "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)
NEIS_KEY = os.environ.get("NEIS_API_KEY", "").strip()
NEIS_OFFLINE = os.environ.get("ES_NEIS_OFFLINE") == "1"
TEACHER_CODE = os.environ.get("TEACHER_CODE", "").strip()
GOOGLE_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
APP_URL = os.environ.get("APP_URL", "").rstrip("/")

DEMO = {"office": "K10", "code": "7801185", "name": "춘천고등학교", "grade": 2, "class": 1}
DEMO_SCOPE = f"{DEMO['office']}-{DEMO['code']}-{DEMO['grade']}-{DEMO['class']}"
AVATAR_COLORS = ["#3182f6", "#f04452", "#15c47e", "#fe9800", "#8b5cf6", "#06b6d4", "#ec4899", "#6366f1", "#84cc16", "#a16207"]
CATEGORIES = {"exam", "performance", "assignment", "event"}
DOC_TAGS = ["수행평가", "수업자료", "기출문제", "모둠과제", "기타"]
CARD_COLORS = {"#fff6d9", "#ffe4e6", "#e0f2fe", "#dcfce7", "#ede9fe", "#ffedd5", "#ffffff"}
ALLOWED_EXT = {"pdf", "hwp", "hwpx", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "md", "csv", "png", "jpg", "jpeg", "gif", "webp", "zip"}
IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "webp"}
INLINE_EXT = IMAGE_EXT | {"pdf", "txt", "md", "csv"}


# ───────────────────────── DB ─────────────────────────
def connect():
    c = sqlite3.connect(DB_PATH, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def db():
    if "db" not in g:
        g.db = connect()
    return g.db


@app.teardown_appcontext
def close_db(exc):
    c = g.pop("db", None)
    if c is not None:
        c.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS es_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student',
  email TEXT UNIQUE, office TEXT, school_code TEXT, school_name TEXT, grade INTEGER, class_num INTEGER,
  color TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS es_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS es_subjects_scope ON es_subjects(scope);
CREATE TABLE IF NOT EXISTS es_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, owner_id INTEGER, name TEXT NOT NULL, stored TEXT NOT NULL,
  size INTEGER NOT NULL, ext TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS es_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL, end_date TEXT, category TEXT NOT NULL, images TEXT NOT NULL DEFAULT '[]', attachments TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER, updated_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS es_events_scope ON es_events(scope, date);
CREATE TABLE IF NOT EXISTS es_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, subject_id INTEGER NOT NULL REFERENCES es_subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, tag TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS es_doc_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL REFERENCES es_docs(id) ON DELETE CASCADE, file_id INTEGER NOT NULL,
  version INTEGER NOT NULL, memo TEXT NOT NULL DEFAULT '', uploaded_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS es_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, subject_id INTEGER NOT NULL REFERENCES es_subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0, created_by INTEGER,
  last_edited_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS es_ink (
  id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL REFERENCES es_notes(id) ON DELETE CASCADE,
  page INTEGER NOT NULL, data TEXT NOT NULL, author_id INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS es_ink_note ON es_ink(note_id);
CREATE TABLE IF NOT EXISTS es_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, target TEXT NOT NULL, author_id INTEGER, text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS es_comments_target ON es_comments(target);
CREATE TABLE IF NOT EXISTS es_neis_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS es_meta (key TEXT PRIMARY KEY, value TEXT);
"""


def init_db():
    c = connect()
    c.execute("PRAGMA journal_mode=WAL")
    c.executescript(SCHEMA)
    # 손필기용 칸 (예전에 만든 DB에도 붙인다)
    for col, ddl in (("ink_pages", "INTEGER NOT NULL DEFAULT 1"), ("ink_bg", "TEXT NOT NULL DEFAULT 'lined'"), ("ink_layout", "TEXT NOT NULL DEFAULT ''")):
        try:
            c.execute(f"ALTER TABLE es_notes ADD COLUMN {col} {ddl}")
        except sqlite3.OperationalError:
            pass
    c.commit()
    c.close()


init_db()


def now_iso():
    return datetime.now(KST).isoformat(timespec="seconds")


def today_kst():
    return datetime.now(KST).date()


# ───────────────────────── 오류·입력 ─────────────────────────
class ApiError(Exception):
    def __init__(self, msg, code=400):
        super().__init__(msg)
        self.msg, self.code = msg, code


@app.errorhandler(ApiError)
def on_api_error(e):
    return {"error": e.msg}, e.code


@app.errorhandler(413)
def too_big(e):
    return {"error": "파일이 너무 커요. 10MB까지 올릴 수 있어요."}, 413


@app.errorhandler(429)
def too_many(e):
    return {"error": "요청이 너무 많아요. 잠시 뒤에 다시 해 주세요."}, 429


@app.before_request
def guard():
    """상태를 바꾸는 요청에는 화면이 붙이는 머리글(X-ES)이 있어야 한다 → 다른 사이트에서 몰래 보내는 요청을 막는다."""
    if request.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH", "DELETE"):
        if request.headers.get("X-ES") != "1":
            return {"error": "잘못된 요청이에요."}, 403
    return None


def body():
    d = request.get_json(silent=True)
    return d if isinstance(d, dict) else {}


def clean(s, n, required=False, label="내용"):
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(s if s is not None else "")).strip()
    if required and not s:
        raise ApiError(f"{label}을(를) 입력해 주세요.")
    if len(s) > n:
        raise ApiError(f"{label}은(는) {n}자까지 쓸 수 있어요.")
    return s


def valid_date(s, label="날짜"):
    try:
        return date.fromisoformat(str(s)).isoformat()
    except ValueError:
        raise ApiError(f"{label}가 이상해요.") from None


def ids(v, limit=12):
    if not isinstance(v, list) or len(v) > limit:
        raise ApiError(f"첨부는 {limit}개까지예요.")
    out = []
    for x in v:
        if not isinstance(x, int) or isinstance(x, bool):
            raise ApiError("첨부 목록이 이상해요.")
        out.append(x)
    return out


# ───────────────────────── 사용자·학급 범위 ─────────────────────────
SCOPE_RE = re.compile(r"^([A-Z0-9]{3})-(\d{7,10})-([1-6])-(\d{1,2})$")


def user_row(uid):
    return db().execute("SELECT * FROM es_users WHERE id = ?", (uid,)).fetchone()


def me():
    if "me" not in g:
        uid = session.get("uid")
        g.me = user_row(uid) if uid else None
    return g.me


def need_me(setup=True):
    u = me()
    if not u:
        raise ApiError("로그인이 필요해요.", 401)
    if setup and not u["school_code"]:
        raise ApiError("학교와 반을 먼저 정해 주세요.", 409)
    return u


def scope_of(u):
    return f"{u['office']}-{u['school_code']}-{u['grade']}-{u['class_num']}" if u and u["school_code"] else None


def can_view(u, scope):
    m = SCOPE_RE.match(scope or "")
    return bool(u and m and u["school_code"] and m.group(1) == u["office"] and m.group(2) == u["school_code"])


def can_write(u, scope):
    """내 반이면 쓸 수 있다. 선생님은 같은 학교의 모든 반에 쓸 수 있다. 다른 반은 보기만."""
    return can_view(u, scope) and (scope == scope_of(u) or u["role"] == "teacher")


def need_scope(scope, write=False):
    u = need_me()
    if not can_view(u, scope):
        raise ApiError("우리 학교 반만 볼 수 있어요.", 403)
    if write and not can_write(u, scope):
        raise ApiError("다른 반은 보기만 할 수 있어요. 내 반으로 돌아가서 고쳐 주세요.", 403)
    return u


def is_owner(u, owner_id):
    return u["id"] == owner_id or u["role"] == "teacher"


def brief(uid):
    cache = g.setdefault("briefs", {})
    if uid not in cache:
        r = user_row(uid) if uid else None
        cache[uid] = {"id": r["id"], "name": r["name"], "color": r["color"], "role": r["role"]} if r else {"id": None, "name": "알 수 없음", "color": "#b0b8c1", "role": "student"}
    return cache[uid]


def user_json(u):
    if not u:
        return None
    return {"id": u["id"], "name": u["name"], "role": u["role"], "email": u["email"], "office": u["office"], "schoolCode": u["school_code"],
            "schoolName": u["school_name"], "grade": u["grade"], "classNum": u["class_num"], "color": u["color"], "scope": scope_of(u), "demo": bool(u["demo"])}


def new_color():
    return AVATAR_COLORS[secrets.randbelow(len(AVATAR_COLORS))]


# ───────────────────────── 실시간 허브 ─────────────────────────
class Conn:
    def __init__(self, ws, user):
        self.ws, self.user, self.scope, self.note_id, self.client_id = ws, user, None, None, None
        self.lock = threading.Lock()

    def send(self, data):
        try:
            with self.lock:
                self.ws.send(data)
        except Exception:
            pass


class Hub:
    def __init__(self):
        self.lock = threading.RLock()
        self.conns = set()
        self.pulse = {}       # scope → {종류: 번호}
        self.http_seen = {}   # scope → {사용자 id: (시각, 사용자)}  (웹소켓이 안 되는 화면)

    def targets(self, pred):
        with self.lock:
            return [c for c in self.conns if pred(c)]

    def send_scope(self, scope, msg):
        data = json.dumps(msg)
        for c in self.targets(lambda c: c.scope == scope):
            c.send(data)

    def bump(self, scope, kind, item_id=None, by=None):
        with self.lock:
            p = self.pulse.setdefault(scope, {})
            p[kind] = p.get(kind, 0) + 1
        self.send_scope(scope, {"type": "changed", "kind": kind, "id": item_id, "by": by})

    def online(self, scope):
        users = {}
        for c in self.targets(lambda c: c.scope == scope):
            users[c.user["id"]] = c.user
        now = time.time()
        with self.lock:
            for uid, (t, u) in list(self.http_seen.get(scope, {}).items()):
                if now - t < 15:
                    users[uid] = u
        return sorted(users.values(), key=lambda u: u["name"])

    def send_online(self, scope):
        if scope:
            self.send_scope(scope, {"type": "online", "users": self.online(scope)})


hub = Hub()


def bump(scope, kind, item_id=None):
    u = me()
    hub.bump(scope, kind, item_id, {"id": u["id"], "name": u["name"]} if u else None)


# ───────────────────────── 노트 동시 편집 ─────────────────────────
class NoteDoc:
    def __init__(self, note_id, scope, content, version):
        self.id, self.scope = note_id, scope
        self.buf = ot.encode(content)
        self.version = version
        self.base = version          # history[0] 의 바로 앞 버전
        self.history = []            # [{"v", "ops", "clientId", "seq", "by"}]
        self.lock = threading.Lock()
        self.last_bump = 0


NOTES = {}
NOTES_LOCK = threading.Lock()
PRESENCE = {}   # 노트 id → {clientId: {...}}
PRESENCE_LOCK = threading.Lock()


def note_doc(note_id):
    with NOTES_LOCK:
        d = NOTES.get(note_id)
        if d:
            return d
        c = connect()
        r = c.execute("SELECT scope, content, version FROM es_notes WHERE id = ?", (note_id,)).fetchone()
        c.close()
        if not r:
            return None
        d = NOTES[note_id] = NoteDoc(note_id, r["scope"], r["content"], r["version"])
        return d


def note_drop(note_id):
    with NOTES_LOCK:
        NOTES.pop(note_id, None)


def note_apply(doc, user, base_v, ops, client_id, seq):
    """연산 하나를 받아 서버 순서대로 적용한다. 같은 연산이 두 번 오면 처음 결과를 다시 돌려준다."""
    with doc.lock:
        for h in doc.history:
            if h["clientId"] == client_id and h["seq"] == seq:
                return h, False
        if base_v < doc.base or base_v > doc.version:
            return {"resync": True, "content": ot.decode(doc.buf), "v": doc.version}, False
        for h in doc.history[base_v - doc.base:]:
            ops, _ = ot.xform(ops, h["ops"], False)
        new = ot.apply(doc.buf, ops)
        if len(new) // 2 > 100_000:
            return {"error": "노트가 너무 길어요 (10만 자까지)."}, False
        doc.buf = new
        doc.version += 1
        msg = {"type": "op", "noteId": doc.id, "v": doc.version, "ops": ops, "clientId": client_id, "seq": seq, "by": {"id": user["id"], "name": user["name"]}}
        doc.history.append(msg)
        if len(doc.history) > 400:
            cut = len(doc.history) - 300
            doc.history = doc.history[cut:]
            doc.base += cut
        c = connect()
        c.execute("UPDATE es_notes SET content = ?, version = ?, last_edited_by = ?, updated_at = ? WHERE id = ?", (ot.decode(doc.buf), doc.version, user["id"], now_iso(), doc.id))
        c.commit()
        c.close()
        bump_list = time.time() - doc.last_bump > 3
        if bump_list:
            doc.last_bump = time.time()
    return msg, bump_list


def note_since(doc, v):
    with doc.lock:
        if v < doc.base or v > doc.version:
            return None
        return doc.history[v - doc.base:]


def presence_set(note_id, client_id, user, pos, via_ws):
    with PRESENCE_LOCK:
        p = PRESENCE.setdefault(note_id, {})
        p[client_id] = {"clientId": client_id, "id": user["id"], "name": user["name"], "color": user["color"], "pos": pos, "t": time.time(), "ws": via_ws}


def presence_drop(note_id, client_id):
    with PRESENCE_LOCK:
        PRESENCE.get(note_id, {}).pop(client_id, None)


def presence_list(note_id):
    now = time.time()
    with PRESENCE_LOCK:
        p = PRESENCE.get(note_id, {})
        for k in [k for k, v in p.items() if not v["ws"] and now - v["t"] > 8]:
            p.pop(k)
        return [{k: v[k] for k in ("clientId", "id", "name", "color", "pos")} for v in p.values()]


def send_presence(note_id):
    data = json.dumps({"type": "presence", "noteId": note_id, "users": presence_list(note_id)})
    for c in hub.targets(lambda c: c.note_id == note_id):
        c.send(data)


def send_note(note_id, msg):
    data = json.dumps(msg)
    for c in hub.targets(lambda c: c.note_id == note_id):
        c.send(data)


# ───────────────────────── 웹소켓 ─────────────────────────
def user_dict(u):
    return {"id": u["id"], "name": u["name"], "color": u["color"], "role": u["role"]}


@sock.route("/ws")
def ws_route(ws):
    u = me()
    if not u or not u["school_code"]:
        ws.send(json.dumps({"type": "error", "msg": "로그인이 필요해요."}))
        return
    user = dict(u)
    conn = Conn(ws, user_dict(u))
    with hub.lock:
        hub.conns.add(conn)
    conn.send(json.dumps({"type": "hello"}))
    try:
        while True:
            raw = ws.receive(timeout=40)
            if raw is None:
                conn.send('{"type":"ping"}')
                continue
            if len(raw) > 300_000:
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            ws_handle(conn, user, msg)
    except Exception:
        pass
    finally:
        with hub.lock:
            hub.conns.discard(conn)
        if conn.note_id:
            presence_drop(conn.note_id, conn.client_id)
            send_presence(conn.note_id)
        hub.send_online(conn.scope)


def ws_handle(conn, user, msg):
    t = msg.get("type")
    if t == "join":
        scope = str(msg.get("scope") or "")
        if not can_view(user, scope):
            return conn.send(json.dumps({"type": "error", "msg": "볼 수 없는 반이에요."}))
        old, conn.scope = conn.scope, scope
        if old and old != scope:
            hub.send_online(old)
        hub.send_online(scope)
    elif t == "note_open":
        note_id, cid = msg.get("noteId"), str(msg.get("clientId") or "")[:40]
        doc = note_doc(note_id) if isinstance(note_id, int) else None
        if not doc or not can_view(user, doc.scope) or not cid:
            return conn.send(json.dumps({"type": "error", "msg": "노트를 열 수 없어요."}))
        if conn.note_id and conn.note_id != note_id:
            presence_drop(conn.note_id, conn.client_id)
            send_presence(conn.note_id)
        conn.note_id, conn.client_id = note_id, cid
        since = msg.get("since")
        missed = note_since(doc, since) if isinstance(since, int) else None
        if missed is None:
            with doc.lock:
                conn.send(json.dumps({"type": "note_state", "noteId": note_id, "content": ot.decode(doc.buf), "v": doc.version}))
        else:
            for h in missed:
                conn.send(json.dumps(h))
        presence_set(note_id, cid, user, int(msg.get("pos") or 0), True)
        send_presence(note_id)
    elif t == "note_close":
        if conn.note_id:
            presence_drop(conn.note_id, conn.client_id)
            nid, conn.note_id = conn.note_id, None
            send_presence(nid)
    elif t == "op":
        note_id = msg.get("noteId")
        doc = note_doc(note_id) if isinstance(note_id, int) else None
        ops = ot.clean(msg.get("ops"))
        v, seq = msg.get("v"), msg.get("seq")
        if not doc or ops is None or not isinstance(v, int) or not isinstance(seq, int):
            return
        if not can_write(user, doc.scope):
            return conn.send(json.dumps({"type": "error", "msg": "다른 반 노트는 보기만 할 수 있어요."}))
        res, bump_list = note_apply(doc, user, v, ops, str(msg.get("clientId") or "")[:40], seq)
        if res.get("resync"):
            conn.send(json.dumps({"type": "resync", "noteId": note_id, "content": res["content"], "v": res["v"]}))
        elif res.get("error"):
            conn.send(json.dumps({"type": "error", "msg": res["error"]}))
        elif res.get("type") == "op":
            send_note(note_id, res)
            if conn.note_id != note_id:
                conn.send(json.dumps(res))
            if bump_list:
                hub.bump(doc.scope, "notes", note_id, {"id": user["id"], "name": user["name"]})
    elif t == "ink_live":
        # 그리는 중인 획을 같은 노트를 보는 다른 사람에게 바로 보낸다 (저장은 다 그린 뒤 HTTP로)
        nid = msg.get("noteId")
        if conn.note_id != nid or not isinstance(nid, int):
            return
        doc = note_doc(nid)
        pts = msg.get("pts")
        if not doc or not can_view(user, doc.scope) or (msg.get("tool") != "laser" and not can_write(user, doc.scope)) or not isinstance(pts, list) or len(pts) > 400:
            return
        try:
            pts = [[round(float(p[0]), 1), round(float(p[1]), 1), round(float(p[2]), 2)] for p in pts]
            width = max(0.5, min(60.0, float(msg.get("width"))))
            page = int(msg.get("page"))
        except (TypeError, ValueError, IndexError):
            return
        color = msg.get("color") if HEX_RE.fullmatch(str(msg.get("color") or "")) else "#191f28"
        tool = msg.get("tool") if msg.get("tool") in PEN_TOOLS | {"laser"} else "pen"
        data = json.dumps({"type": "ink_live", "noteId": nid, "tmp": str(msg.get("tmp") or "")[:40], "page": page, "tool": tool, "shape": bool(msg.get("shape")), "reset": bool(msg.get("reset")),
                           "color": color, "width": width, "pts": pts, "end": bool(msg.get("end")), "by": {"id": user["id"], "name": user["name"], "color": user["color"]}})
        for c in hub.targets(lambda c: c.note_id == nid and c is not conn):
            c.send(data)
    elif t == "cursor":
        if conn.note_id and msg.get("noteId") == conn.note_id and isinstance(msg.get("pos"), int):
            presence_set(conn.note_id, conn.client_id, user, msg["pos"], True)
            send_presence(conn.note_id)


# ───────────────────────── 화면·계정 ─────────────────────────
def asset_version():
    folder = os.path.join(app.root_path, "static")
    try:
        return str(int(max(os.path.getmtime(os.path.join(folder, f)) for f in os.listdir(folder) if f.endswith((".js", ".css")))))
    except ValueError:
        return "1"


@app.get("/")
def index():
    return render_template("index.html", v=asset_version())


@app.get("/sw.js")
def service_worker():
    resp = app.send_static_file("sw.js")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["Service-Worker-Allowed"] = "/"
    return resp


@app.get("/api/me")
def api_me():
    u = me()
    return {"user": user_json(u), "google": bool(GOOGLE_ID and GOOGLE_SECRET), "teacherEnabled": bool(TEACHER_CODE), "neisKey": bool(NEIS_KEY), "today": today_kst().isoformat()}


def setup_fields(d):
    sc = d.get("school") or {}
    office, code, sname = str(sc.get("office") or "").upper(), str(sc.get("code") or ""), clean(sc.get("name"), 40, True, "학교 이름")
    if not re.fullmatch(r"[A-Z0-9]{3}", office) or not re.fullmatch(r"\d{7,10}", code):
        raise ApiError("학교를 목록에서 골라 주세요.")
    try:
        grade, cls = int(d.get("grade")), int(d.get("classNum"))
    except (TypeError, ValueError):
        raise ApiError("학년과 반을 골라 주세요.") from None
    if not (1 <= grade <= 6 and 1 <= cls <= 30):
        raise ApiError("학년과 반을 골라 주세요.")
    role = "teacher" if d.get("role") == "teacher" else "student"
    if role == "teacher" and (not TEACHER_CODE or not secrets.compare_digest(str(d.get("teacherCode") or ""), TEACHER_CODE)):
        raise ApiError("교사 코드가 맞지 않아요.", 403)
    return office, code, sname, grade, cls, role


def login_as(uid):
    session.clear()
    session.permanent = True
    session["uid"] = uid


@app.post("/api/login/quick")
@limiter.limit("20 per 10 minutes")
def login_quick():
    """같은 학교·학년·반·역할·이름이면 같은 사람으로 보고 그 계정으로 들어간다 (여러 번 들어와도 한 명)."""
    d = body()
    name = clean(d.get("name"), 12, True, "이름")
    office, code, sname, grade, cls, role = setup_fields(d)
    c = db()
    r = c.execute("SELECT id FROM es_users WHERE name = ? AND role = ? AND office = ? AND school_code = ? AND grade = ? AND class_num = ? AND demo = 0 AND email IS NULL ORDER BY id LIMIT 1",
                  (name, role, office, code, grade, cls)).fetchone()
    if r:
        uid = r["id"]
    else:
        uid = c.execute("INSERT INTO es_users (name, role, office, school_code, school_name, grade, class_num, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (name, role, office, code, sname, grade, cls, new_color(), now_iso())).lastrowid
        c.commit()
    login_as(uid)
    return api_me()


@app.post("/api/login/demo")
@limiter.limit("30 per 10 minutes")
def login_demo():
    """체험 계정은 학생 하나, 선생님 하나만 두고 함께 쓴다."""
    c = db()
    seed_demo(c)
    role = "teacher" if body().get("role") == "teacher" else "student"
    r = c.execute("SELECT id FROM es_users WHERE demo = 1 AND role = ? ORDER BY id LIMIT 1", (role,)).fetchone()
    if r:
        uid = r["id"]
    else:
        uid = c.execute("INSERT INTO es_users (name, role, office, school_code, school_name, grade, class_num, color, demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
                        ("체험 선생님" if role == "teacher" else "체험 학생", role, DEMO["office"], DEMO["code"], DEMO["name"], DEMO["grade"], DEMO["class"], new_color(), now_iso())).lastrowid
        c.commit()
    login_as(uid)
    return api_me()


@app.post("/api/me/setup")
def me_setup():
    u = need_me(setup=False)
    d = body()
    office, code, sname, grade, cls, role = setup_fields(d)
    if u["role"] == "teacher" and d.get("role") != "teacher":
        role = "student"
    name = clean(d.get("name") or u["name"], 12, True, "이름")
    c = db()
    c.execute("UPDATE es_users SET name = ?, role = ?, office = ?, school_code = ?, school_name = ?, grade = ?, class_num = ? WHERE id = ?",
              (name, role, office, code, sname, grade, cls, u["id"]))
    c.commit()
    g.pop("me", None)
    return api_me()


@app.patch("/api/me")
def me_patch():
    """내 반 바꾸기·이름 바꾸기 (학교는 그대로)."""
    u = need_me()
    d = body()
    name = clean(d.get("name") or u["name"], 12, True, "이름")
    try:
        grade, cls = int(d.get("grade", u["grade"])), int(d.get("classNum", u["class_num"]))
    except (TypeError, ValueError):
        raise ApiError("학년과 반을 확인해 주세요.") from None
    if not (1 <= grade <= 6 and 1 <= cls <= 30):
        raise ApiError("학년과 반을 확인해 주세요.")
    c = db()
    c.execute("UPDATE es_users SET name = ?, grade = ?, class_num = ? WHERE id = ?", (name, grade, cls, u["id"]))
    c.commit()
    g.pop("me", None)
    return api_me()


@app.post("/api/logout")
def logout():
    session.clear()
    return {"ok": True}


# 구글 로그인 (.env 에 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET 이 있을 때만)
oauth = None
if GOOGLE_ID and GOOGLE_SECRET:
    from authlib.integrations.flask_client import OAuth

    oauth = OAuth(app)
    oauth.register("google", client_id=GOOGLE_ID, client_secret=GOOGLE_SECRET,
                   server_metadata_url="https://accounts.google.com/.well-known/openid-configuration", client_kwargs={"scope": "openid email profile"})


@app.get("/auth/google")
def google_start():
    if not oauth:
        return redirect("/?err=google")
    return oauth.google.authorize_redirect((APP_URL or request.host_url.rstrip("/")) + "/auth/google/callback")


@app.get("/auth/google/callback")
def google_callback():
    if not oauth:
        return redirect("/?err=google")
    try:
        token = oauth.google.authorize_access_token()
        info = token.get("userinfo") or {}
    except Exception:
        return redirect("/?err=google")
    email = str(info.get("email") or "").lower()
    if not email or not info.get("email_verified", True):
        return redirect("/?err=google")
    c = db()
    r = c.execute("SELECT id FROM es_users WHERE email = ?", (email,)).fetchone()
    if r:
        uid = r["id"]
    else:
        uid = c.execute("INSERT INTO es_users (name, email, color, created_at) VALUES (?, ?, ?, ?)",
                        (clean(info.get("name") or email.split("@")[0], 12) or "학생", email, new_color(), now_iso())).lastrowid
        c.commit()
    login_as(uid)
    return redirect("/")


# ───────────────────────── 나이스 ─────────────────────────
def cache_get(key, max_age):
    r = db().execute("SELECT data, fetched_at FROM es_neis_cache WHERE key = ?", (key,)).fetchone()
    if r and time.time() - r["fetched_at"] < max_age:
        return json.loads(r["data"])
    return None


def cache_put(key, data):
    c = db()
    c.execute("INSERT OR REPLACE INTO es_neis_cache (key, data, fetched_at) VALUES (?, ?, ?)", (key, json.dumps(data, ensure_ascii=False), time.time()))
    c.commit()


CODE_RE = re.compile(r"^[A-Z0-9]{2,10}$")


def school_args():
    office, school = (request.args.get("office") or "").upper(), request.args.get("school") or ""
    if not CODE_RE.match(office) or not CODE_RE.match(school):
        raise ApiError("학교 코드가 이상해요.")
    return office, school


def date_arg(name, default):
    v = request.args.get(name)
    if not v:
        return default
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise ApiError("날짜가 이상해요.") from None


@app.get("/api/neis/schools")
@limiter.limit("60 per minute")
def api_schools():
    q = clean(request.args.get("q"), 30)
    if len(q) < 2:
        return {"schools": []}
    hit = cache_get("schools:" + q, 7 * 86400)
    if hit is not None:
        return {"schools": hit, "source": "neis"}
    try:
        res = [s for s in neis.search_schools(q, NEIS_KEY, NEIS_OFFLINE) if "고등학교" in s["kind"] or "중학교" in s["kind"]]
    except neis.NeisError:
        return {"schools": [s for s in neis.SAMPLE_SCHOOLS if q.replace("고", "") in s["name"]] or neis.SAMPLE_SCHOOLS, "source": "sample"}
    if res:
        cache_put("schools:" + q, res)
    return {"schools": res, "source": "neis"}


@app.get("/api/neis/schedule")
@limiter.limit("40 per minute")
def api_schedule():
    office, school = school_args()
    grade = request.args.get("grade", type=int) or 0
    t = today_kst()
    start, end = date_arg("from", t.replace(day=1) - timedelta(days=7)), date_arg("to", t + timedelta(days=60))
    if end < start or (end - start).days > 200:
        raise ApiError("기간은 200일까지예요.")
    key = f"sched:{office}:{school}:{grade}:{start}:{end}"
    hit = cache_get(key, 12 * 3600)
    if hit is not None:
        return {"events": hit, "source": "neis"}
    try:
        ev = neis.schedule(office, school, grade, start, end, NEIS_KEY, NEIS_OFFLINE)
    except neis.NeisError:
        return {"events": neis.sample_schedule(start, end, grade), "source": "sample"}
    cache_put(key, ev)
    return {"events": ev, "source": "neis"}


@app.get("/api/neis/meal")
@limiter.limit("40 per minute")
def api_meal():
    office, school = school_args()
    t = today_kst()
    start = date_arg("from", t - timedelta(days=t.weekday()))
    days = max(1, min(14, request.args.get("days", type=int) or 7))
    key = f"meal:{office}:{school}:{start}:{days}"
    hit = cache_get(key, 6 * 3600)
    if hit is not None:
        return {"meals": hit, "allergy": neis.ALLERGY, "source": "neis"}
    try:
        ms = neis.meals(office, school, start, days, NEIS_KEY, NEIS_OFFLINE)
    except neis.NeisError:
        return {"meals": neis.sample_meals(start, days), "allergy": neis.ALLERGY, "source": "sample"}
    if not ms:
        # 방학 등으로 급식이 없을 때는 '없음'으로 돌려준다 (가짜를 섞지 않는다)
        return {"meals": [], "allergy": neis.ALLERGY, "source": "neis"}
    cache_put(key, ms)
    return {"meals": ms, "allergy": neis.ALLERGY, "source": "neis"}


# ───────────────────────── 파일 ─────────────────────────
def file_meta(fid):
    r = db().execute("SELECT id, name, size, ext FROM es_files WHERE id = ?", (fid,)).fetchone()
    if not r:
        return None
    return {"id": r["id"], "name": r["name"], "size": r["size"], "type": r["ext"], "image": r["ext"] in IMAGE_EXT, "url": f"/files/{r['id']}/{r['name']}"}


def metas(raw):
    return [m for m in (file_meta(i) for i in json.loads(raw or "[]")) if m]


def check_files(file_ids, scope):
    for fid in file_ids:
        r = db().execute("SELECT scope FROM es_files WHERE id = ?", (fid,)).fetchone()
        if not r or r["scope"] != scope:
            raise ApiError("첨부 파일을 찾을 수 없어요.")


def save_upload(f, scope, owner_id, conn=None):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", os.path.basename(f.filename or "")).strip()[:100] or "file"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED_EXT:
        raise ApiError("올릴 수 없는 파일 형식이에요. (PDF·한글·워드·PPT·엑셀·사진·텍스트·ZIP)")
    stored = secrets.token_hex(16) + "." + ext
    path = os.path.join(UPLOAD_DIR, stored)
    f.save(path)
    size = os.path.getsize(path)
    if size == 0:
        os.remove(path)
        raise ApiError("빈 파일이에요.")
    c = conn or db()
    cur = c.execute("INSERT INTO es_files (scope, owner_id, name, stored, size, ext, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (scope, owner_id, name, stored, size, ext, now_iso()))
    c.commit()
    return cur.lastrowid


@app.post("/api/upload")
@limiter.limit("120 per hour")
def upload():
    scope = request.form.get("scope", "")
    u = need_scope(scope, write=True)
    f = request.files.get("file")
    if not f:
        raise ApiError("파일을 골라 주세요.")
    return file_meta(save_upload(f, scope, u["id"]))


@app.get("/files/<int:fid>/<path:name>")
def get_file(fid, name):
    u = me()
    r = db().execute("SELECT * FROM es_files WHERE id = ?", (fid,)).fetchone()
    if not r or not u or not can_view(u, r["scope"]):
        return {"error": "파일을 볼 수 없어요."}, 404
    inline = r["ext"] in INLINE_EXT and request.args.get("dl") != "1"
    mime = mimetypes.types_map.get("." + r["ext"], "application/octet-stream")
    if r["ext"] in ("txt", "md", "csv"):
        mime = "text/plain; charset=utf-8"
    resp = send_file(os.path.join(UPLOAD_DIR, r["stored"]), mimetype=mime, as_attachment=not inline, download_name=r["name"], max_age=3600)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    if r["ext"] != "pdf":
        resp.headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"
    return resp


# ───────────────────────── 과목 ─────────────────────────
DEFAULT_SUBJECTS = [
    ("국어", "📖", "#f472b6", "문학·독서·화법과 언어"), ("수학", "📐", "#3182f6", "수학·미적분·확률과 통계"), ("영어", "🔤", "#8b5cf6", "영어 독해·작문·발표"),
    ("한국사", "🏯", "#a16207", "한국사 탐구"), ("통합사회", "🌏", "#06b6d4", "사회·윤리·지리"), ("통합과학", "🔬", "#15c47e", "실험·탐구 보고서"),
    ("정보", "💻", "#6366f1", "프로그래밍·인공지능"), ("동아리·자율", "🎨", "#fe9800", "동아리·자율·진로 활동"),
]


def ensure_subjects(c, scope):
    if c.execute("SELECT 1 FROM es_subjects WHERE scope = ? LIMIT 1", (scope,)).fetchone():
        return
    for i, (n, ic, col, de) in enumerate(DEFAULT_SUBJECTS):
        c.execute("INSERT INTO es_subjects (scope, name, icon, color, description, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (scope, n, ic, col, de, i, now_iso()))
    c.commit()


def subject_row(sid):
    r = db().execute("SELECT * FROM es_subjects WHERE id = ?", (sid,)).fetchone()
    if not r:
        raise ApiError("과목을 찾을 수 없어요.", 404)
    return r


def subject_json(r):
    c = db()
    return {"id": r["id"], "name": r["name"], "icon": r["icon"], "color": r["color"], "description": r["description"],
            "counts": {"work": c.execute("SELECT COUNT(*) FROM es_cw WHERE subject_id = ?", (r["id"],)).fetchone()[0],
                       "docs": c.execute("SELECT COUNT(*) FROM es_docs WHERE subject_id = ?", (r["id"],)).fetchone()[0],
                       "notes": c.execute("SELECT COUNT(*) FROM es_notes WHERE subject_id = ?", (r["id"],)).fetchone()[0]}}


@app.get("/api/subjects")
def list_subjects():
    scope = request.args.get("scope", "")
    need_scope(scope)
    c = db()
    ensure_subjects(c, scope)
    rows = c.execute("SELECT * FROM es_subjects WHERE scope = ? ORDER BY sort, id", (scope,)).fetchall()
    return {"subjects": [subject_json(r) for r in rows]}


def subject_fields(d):
    icon = clean(d.get("icon") or "📘", 4, True, "아이콘")
    color = d.get("color") if re.fullmatch(r"#[0-9a-fA-F]{6}", str(d.get("color") or "")) else "#3182f6"
    return clean(d.get("name"), 20, True, "과목 이름"), icon, color, clean(d.get("description"), 60)


@app.post("/api/subjects")
def add_subject():
    d = body()
    scope = d.get("scope", "")
    u = need_scope(scope, write=True)
    name, icon, color, desc = subject_fields(d)
    c = db()
    if c.execute("SELECT 1 FROM es_subjects WHERE scope = ? AND name = ?", (scope, name)).fetchone():
        raise ApiError("같은 이름의 과목이 있어요.")
    sort = (c.execute("SELECT MAX(sort) FROM es_subjects WHERE scope = ?", (scope,)).fetchone()[0] or 0) + 1
    sid = c.execute("INSERT INTO es_subjects (scope, name, icon, color, description, sort, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (scope, name, icon, color, desc, sort, u["id"], now_iso())).lastrowid
    c.commit()
    bump(scope, "subjects", sid)
    return subject_json(subject_row(sid))


@app.patch("/api/subjects/<int:sid>")
def edit_subject(sid):
    r = subject_row(sid)
    need_scope(r["scope"], write=True)
    name, icon, color, desc = subject_fields(body())
    c = db()
    c.execute("UPDATE es_subjects SET name = ?, icon = ?, color = ?, description = ? WHERE id = ?", (name, icon, color, desc, sid))
    c.commit()
    bump(r["scope"], "subjects", sid)
    return subject_json(subject_row(sid))


@app.delete("/api/subjects/<int:sid>")
def del_subject(sid):
    r = subject_row(sid)
    u = need_scope(r["scope"], write=True)
    cnt = subject_json(r)["counts"]
    if sum(cnt.values()) and u["role"] != "teacher":
        raise ApiError("글·파일·노트가 있는 과목은 선생님만 지울 수 있어요.", 403)
    c = db()
    c.execute("DELETE FROM es_subjects WHERE id = ?", (sid,))
    c.commit()
    bump(r["scope"], "subjects", sid)
    return {"ok": True}


# ───────────────────────── 공유 달력 ─────────────────────────
def comment_count(target):
    return db().execute("SELECT COUNT(*) FROM es_comments WHERE target = ?", (target,)).fetchone()[0]


def event_json(r):
    return {"id": r["id"], "scope": r["scope"], "title": r["title"], "description": r["description"], "date": r["date"], "endDate": r["end_date"],
            "category": r["category"], "images": metas(r["images"]), "attachments": metas(r["attachments"]),
            "createdBy": brief(r["created_by"]), "updatedBy": brief(r["updated_by"]), "createdAt": r["created_at"], "updatedAt": r["updated_at"],
            "comments": comment_count(f"event:{r['id']}")}


def event_row(eid):
    r = db().execute("SELECT * FROM es_events WHERE id = ?", (eid,)).fetchone()
    if not r:
        raise ApiError("일정을 찾을 수 없어요.", 404)
    return r


@app.get("/api/events")
def list_events():
    scope = request.args.get("scope", "")
    need_scope(scope)
    t = today_kst()
    start, end = date_arg("from", t - timedelta(days=45)), date_arg("to", t + timedelta(days=90))
    rows = db().execute("SELECT * FROM es_events WHERE scope = ? AND date <= ? AND COALESCE(end_date, date) >= ? ORDER BY date, id",
                        (scope, end.isoformat(), start.isoformat())).fetchall()
    return {"events": [event_json(r) for r in rows]}


@app.get("/api/events/<int:eid>")
def get_event(eid):
    r = event_row(eid)
    need_scope(r["scope"])
    return event_json(r)


def event_fields(d, scope):
    title = clean(d.get("title"), 60, True, "제목")
    desc = clean(d.get("description"), 5000)
    day = valid_date(d.get("date"))
    end = valid_date(d.get("endDate"), "끝나는 날") if d.get("endDate") else None
    if end and end < day:
        raise ApiError("끝나는 날이 시작하는 날보다 빨라요.")
    if end and (date.fromisoformat(end) - date.fromisoformat(day)).days > 60:
        raise ApiError("일정은 60일까지 이어질 수 있어요.")
    if end == day:
        end = None
    cat = d.get("category") if d.get("category") in CATEGORIES else "event"
    images, atts = ids(d.get("images", [])), ids(d.get("attachments", []))
    check_files(images + atts, scope)
    return title, desc, day, end, cat, json.dumps(images), json.dumps(atts)


@app.post("/api/events")
def add_event():
    d = body()
    scope = d.get("scope", "")
    u = need_scope(scope, write=True)
    f = event_fields(d, scope)
    c = db()
    eid = c.execute("INSERT INTO es_events (scope, title, description, date, end_date, category, images, attachments, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (scope, *f, u["id"], u["id"], now_iso(), now_iso())).lastrowid
    c.commit()
    bump(scope, "events", eid)
    return event_json(event_row(eid))


@app.patch("/api/events/<int:eid>")
def edit_event(eid):
    r = event_row(eid)
    u = need_scope(r["scope"], write=True)
    f = event_fields(body(), r["scope"])
    c = db()
    c.execute("UPDATE es_events SET title = ?, description = ?, date = ?, end_date = ?, category = ?, images = ?, attachments = ?, updated_by = ?, updated_at = ? WHERE id = ?",
              (*f, u["id"], now_iso(), eid))
    c.commit()
    bump(r["scope"], "events", eid)
    return event_json(event_row(eid))


@app.delete("/api/events/<int:eid>")
def del_event(eid):
    r = event_row(eid)
    u = need_scope(r["scope"], write=True)
    if not is_owner(u, r["created_by"]):
        raise ApiError("일정을 만든 사람이나 선생님만 지울 수 있어요.", 403)
    c = db()
    c.execute("DELETE FROM es_events WHERE id = ?", (eid,))
    c.execute("DELETE FROM es_comments WHERE target = ?", (f"event:{eid}",))
    c.commit()
    bump(r["scope"], "events", eid)
    return {"ok": True}


# ───────────────────────── 댓글 ─────────────────────────
# 댓글을 달 수 있는 것: 종류 → (표, 바뀌었을 때 알릴 이름). 다른 모듈(클래스룸)이 더 붙인다
COMMENT_TARGETS = {"event": ("es_events", "events"), "doc": ("es_docs", "docs")}
COMMENT_GUARDS = {}  # 종류 → fn(사용자, id): 볼 수 없으면 ApiError (비공개 댓글용)


def target_scope(target):
    m = re.fullmatch(r"([a-z]+):(\d+)", target or "")
    if not m or m.group(1) not in COMMENT_TARGETS:
        raise ApiError("댓글 대상이 이상해요.")
    table = COMMENT_TARGETS[m.group(1)][0]
    r = db().execute(f"SELECT scope FROM {table} WHERE id = ?", (int(m.group(2)),)).fetchone()  # table 은 위 목록에 있는 이름뿐
    if not r:
        raise ApiError("댓글을 달 글을 찾을 수 없어요.", 404)
    return m.group(1), r["scope"]


def guard_target(u, target):
    kind, _, tid = target.partition(":")
    if kind in COMMENT_GUARDS:
        COMMENT_GUARDS[kind](u, int(tid))


def comment_json(r):
    return {"id": r["id"], "text": r["text"], "author": brief(r["author_id"]), "createdAt": r["created_at"]}


@app.get("/api/comments")
def list_comments():
    target = request.args.get("target", "")
    _, scope = target_scope(target)
    guard_target(need_scope(scope), target)
    rows = db().execute("SELECT * FROM es_comments WHERE target = ? ORDER BY id", (target,)).fetchall()
    return {"comments": [comment_json(r) for r in rows]}


@app.post("/api/comments")
@limiter.limit("60 per minute")
def add_comment():
    d = body()
    target = str(d.get("target") or "")
    kind, scope = target_scope(target)
    u = need_scope(scope, write=not kind == "sub")  # 비공개 댓글은 선생님이 다른 반에서도 단다
    guard_target(u, target)
    text = clean(d.get("text"), 500, True, "댓글")
    c = db()
    cid = c.execute("INSERT INTO es_comments (scope, target, author_id, text, created_at) VALUES (?, ?, ?, ?, ?)", (scope, target, u["id"], text, now_iso())).lastrowid
    c.commit()
    bump(scope, "comments", target)
    bump(scope, COMMENT_TARGETS[kind][1], int(target.split(":")[1]))
    return comment_json(c.execute("SELECT * FROM es_comments WHERE id = ?", (cid,)).fetchone())


@app.delete("/api/comments/<int:cid>")
def del_comment(cid):
    r = db().execute("SELECT * FROM es_comments WHERE id = ?", (cid,)).fetchone()
    if not r:
        raise ApiError("댓글을 찾을 수 없어요.", 404)
    u = need_scope(r["scope"])
    if not is_owner(u, r["author_id"]) or not (can_write(u, r["scope"]) or u["id"] == r["author_id"]):
        raise ApiError("내 댓글만 지울 수 있어요.", 403)
    c = db()
    c.execute("DELETE FROM es_comments WHERE id = ?", (cid,))
    c.commit()
    bump(r["scope"], "comments", r["target"])
    return {"ok": True}


# ───────────────────────── 공유 문서함 ─────────────────────────
def doc_json(r, full=False):
    c = db()
    vs = c.execute("SELECT * FROM es_doc_versions WHERE doc_id = ? ORDER BY version DESC", (r["id"],)).fetchall()
    latest = vs[0] if vs else None
    out = {"id": r["id"], "subjectId": r["subject_id"], "title": r["title"], "tag": r["tag"], "version": latest["version"] if latest else 0,
           "file": file_meta(latest["file_id"]) if latest else None, "uploadedBy": brief(latest["uploaded_by"] if latest else r["created_by"]),
           "createdBy": brief(r["created_by"]), "createdAt": r["created_at"], "updatedAt": r["updated_at"], "comments": comment_count(f"doc:{r['id']}")}
    if full:
        out["versions"] = [{"version": v["version"], "memo": v["memo"], "file": file_meta(v["file_id"]), "uploadedBy": brief(v["uploaded_by"]), "createdAt": v["created_at"]} for v in vs]
    return out


def doc_row(did):
    r = db().execute("SELECT * FROM es_docs WHERE id = ?", (did,)).fetchone()
    if not r:
        raise ApiError("문서를 찾을 수 없어요.", 404)
    return r


@app.get("/api/docs")
def list_docs():
    s = subject_row(request.args.get("subject", type=int))
    need_scope(s["scope"])
    rows = db().execute("SELECT * FROM es_docs WHERE subject_id = ? ORDER BY updated_at DESC, id DESC", (s["id"],)).fetchall()
    return {"docs": [doc_json(r) for r in rows]}


@app.get("/api/docs/<int:did>")
def get_doc(did):
    r = doc_row(did)
    need_scope(r["scope"])
    return doc_json(r, True)


@app.post("/api/docs")
@limiter.limit("60 per hour")
def add_doc():
    s = subject_row(request.form.get("subject", type=int))
    u = need_scope(s["scope"], write=True)
    f = request.files.get("file")
    if not f:
        raise ApiError("파일을 골라 주세요.")
    tag = request.form.get("tag") if request.form.get("tag") in DOC_TAGS else "기타"
    fid = save_upload(f, s["scope"], u["id"])
    title = clean(request.form.get("title"), 60) or file_meta(fid)["name"].rsplit(".", 1)[0][:60]
    c = db()
    did = c.execute("INSERT INTO es_docs (scope, subject_id, title, tag, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (s["scope"], s["id"], title, tag, u["id"], now_iso(), now_iso())).lastrowid
    c.execute("INSERT INTO es_doc_versions (doc_id, file_id, version, memo, uploaded_by, created_at) VALUES (?, ?, 1, '처음 올림', ?, ?)", (did, fid, u["id"], now_iso()))
    c.commit()
    bump(s["scope"], "docs", did)
    return doc_json(doc_row(did), True)


@app.post("/api/docs/<int:did>/versions")
@limiter.limit("60 per hour")
def add_doc_version(did):
    r = doc_row(did)
    u = need_scope(r["scope"], write=True)
    f = request.files.get("file")
    if not f:
        raise ApiError("파일을 골라 주세요.")
    fid = save_upload(f, r["scope"], u["id"])
    c = db()
    v = c.execute("SELECT MAX(version) FROM es_doc_versions WHERE doc_id = ?", (did,)).fetchone()[0] or 0
    c.execute("INSERT INTO es_doc_versions (doc_id, file_id, version, memo, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
              (did, fid, v + 1, clean(request.form.get("memo"), 60), u["id"], now_iso()))
    c.execute("UPDATE es_docs SET updated_at = ? WHERE id = ?", (now_iso(), did))
    c.commit()
    bump(r["scope"], "docs", did)
    return doc_json(doc_row(did), True)


@app.patch("/api/docs/<int:did>")
def edit_doc(did):
    r = doc_row(did)
    need_scope(r["scope"], write=True)
    d = body()
    tag = d.get("tag") if d.get("tag") in DOC_TAGS else r["tag"]
    c = db()
    c.execute("UPDATE es_docs SET title = ?, tag = ?, updated_at = ? WHERE id = ?", (clean(d.get("title") or r["title"], 60, True, "제목"), tag, now_iso(), did))
    c.commit()
    bump(r["scope"], "docs", did)
    return doc_json(doc_row(did), True)


@app.delete("/api/docs/<int:did>")
def del_doc(did):
    r = doc_row(did)
    u = need_scope(r["scope"], write=True)
    if not is_owner(u, r["created_by"]):
        raise ApiError("올린 사람이나 선생님만 지울 수 있어요.", 403)
    c = db()
    c.execute("DELETE FROM es_docs WHERE id = ?", (did,))
    c.execute("DELETE FROM es_comments WHERE target = ?", (f"doc:{did}",))
    c.commit()
    bump(r["scope"], "docs", did)
    return {"ok": True}


# ───────────────────────── 공유 노트 ─────────────────────────
def note_row(nid):
    r = db().execute("SELECT * FROM es_notes WHERE id = ?", (nid,)).fetchone()
    if not r:
        raise ApiError("노트를 찾을 수 없어요.", 404)
    return r


def note_json(r, full=False):
    content = r["content"]
    version = r["version"]
    doc = NOTES.get(r["id"])
    if doc:
        with doc.lock:
            content, version = ot.decode(doc.buf), doc.version
    preview = re.sub(r"[#*>`\-\[\]]", "", content)[:90].strip()
    if not preview:
        t = db().execute("""SELECT data FROM es_ink WHERE note_id = ? AND data LIKE '%"tool": "text"%' ORDER BY page, id LIMIT 1""", (r["id"],)).fetchone()
        preview = json.loads(t["data"])["text"][:90].replace("\n", " ") if t else ""
    out = {"id": r["id"], "subjectId": r["subject_id"], "title": r["title"], "preview": preview,
           "createdBy": brief(r["created_by"]), "lastEditedBy": brief(r["last_edited_by"] or r["created_by"]), "updatedAt": r["updated_at"],
           "viewers": len(presence_list(r["id"])),
           "ink": db().execute("SELECT COUNT(*) FROM es_ink WHERE note_id = ?", (r["id"],)).fetchone()[0], "inkPages": r["ink_pages"]}
    if full:
        out.update(content=content, v=version)
    return out


@app.get("/api/notes")
def list_notes():
    s = subject_row(request.args.get("subject", type=int))
    need_scope(s["scope"])
    rows = db().execute("SELECT * FROM es_notes WHERE subject_id = ? ORDER BY updated_at DESC, id DESC", (s["id"],)).fetchall()
    return {"notes": [note_json(r) for r in rows]}


@app.get("/api/notes/<int:nid>")
def get_note(nid):
    r = note_row(nid)
    need_scope(r["scope"])
    return note_json(r, True)


@app.post("/api/notes")
def add_note():
    d = body()
    s = subject_row(d.get("subject"))
    u = need_scope(s["scope"], write=True)
    c = db()
    nid = c.execute("INSERT INTO es_notes (scope, subject_id, title, content, created_by, last_edited_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (s["scope"], s["id"], clean(d.get("title") or "제목 없는 노트", 60), clean(d.get("content"), 20000), u["id"], u["id"], now_iso(), now_iso())).lastrowid
    c.commit()
    bump(s["scope"], "notes", nid)
    return note_json(note_row(nid), True)


@app.patch("/api/notes/<int:nid>")
def edit_note(nid):
    r = note_row(nid)
    u = need_scope(r["scope"], write=True)
    c = db()
    c.execute("UPDATE es_notes SET title = ?, last_edited_by = ?, updated_at = ? WHERE id = ?", (clean(body().get("title"), 60, True, "제목"), u["id"], now_iso(), nid))
    c.commit()
    bump(r["scope"], "notes", nid)
    return note_json(note_row(nid))


@app.delete("/api/notes/<int:nid>")
def del_note(nid):
    r = note_row(nid)
    u = need_scope(r["scope"], write=True)
    if not is_owner(u, r["created_by"]):
        raise ApiError("노트를 만든 사람이나 선생님만 지울 수 있어요.", 403)
    c = db()
    c.execute("DELETE FROM es_notes WHERE id = ?", (nid,))
    c.commit()
    note_drop(nid)
    bump(r["scope"], "notes", nid)
    return {"ok": True}


# ───────────────────────── 손필기 (펜으로 쓰기) ─────────────────────────
# 쪽 크기는 A4 비율로 가로 1000 × 세로 1414 (화면 크기와 상관없이 같은 자리)
INK_W, INK_H = 1000, 1414
INK_BGS = {"blank", "lined", "narrow", "grid", "math", "dots", "cornell", "music", "manuscript", "image"}
PEN_TOOLS = {"pen", "ball", "gel", "fountain", "calli", "brush", "pencil", "crayon", "marker", "neon", "dash", "hl"}
INK_MAX_PAGES, INK_MAX_STROKES = 60, 12000
HEX_RE = re.compile(r"#[0-9a-fA-F]{6}")
INK_REV = {}          # 노트 id → 바뀐 횟수 (웹소켓이 안 되는 화면이 비교한다)
INK_LIST_BUMP = {}    # 노트 목록 새로 고침 알림을 너무 자주 보내지 않게
INK_LOCK = threading.Lock()


def ink_changed(nid, scope, msg):
    with NOTES_LOCK:
        INK_REV[nid] = INK_REV.get(nid, 0) + 1
    msg["rev"] = INK_REV[nid]
    send_note(nid, msg)
    if time.time() - INK_LIST_BUMP.get(nid, 0) > 3:
        INK_LIST_BUMP[nid] = time.time()
        bump(scope, "notes", nid)


def num(v, lo, hi, nd=1):
    v = float(v)
    if v != v:  # NaN
        raise ValueError
    return round(min(hi, max(lo, v)), nd)


def ink_clean(s, scope):
    """획(펜 종류), 글상자(text), 사진(image) 하나를 검사한다."""
    if not isinstance(s, dict):
        raise ApiError("필기 내용이 이상해요.")
    tool = s.get("tool")
    try:
        if tool == "image":
            fid = s.get("file")
            if not isinstance(fid, int) or isinstance(fid, bool):
                raise ValueError
            f = db().execute("SELECT scope, ext FROM es_files WHERE id = ?", (fid,)).fetchone()
            if not f or f["scope"] != scope or f["ext"] not in IMAGE_EXT:
                raise ApiError("사진을 찾을 수 없어요.")
            x, y = num(s["x"], -INK_W, INK_W * 2), num(s["y"], -INK_H, INK_H * 2)
            w, h = num(s["w"], 20, INK_W * 2), num(s["h"], 20, INK_H * 2)
            return {"tool": "image", "file": fid, "x": x, "y": y, "w": w, "h": h}
        color = str(s.get("color") or "")
        if not HEX_RE.fullmatch(color):
            raise ApiError("색이 이상해요.")
        if tool == "text":
            text = clean(s.get("text"), 5000, True, "글")
            return {"tool": "text", "text": text, "color": color, "x": num(s["x"], 0, INK_W), "y": num(s["y"], 0, INK_H),
                    "size": num(s.get("size", 28), 10, 120), "w": num(s.get("w", 600), 40, INK_W)}
        if tool not in PEN_TOOLS:
            raise ApiError("펜 종류가 이상해요.")
        pts = s.get("pts")
        if not isinstance(pts, list) or not 1 <= len(pts) <= 4000:
            raise ApiError("획이 너무 길어요.")
        out = [[num(p[0], 0, INK_W), num(p[1], 0, INK_H), num(p[2], 0, 1, 2)] for p in pts]
        d = {"tool": tool, "color": color, "width": num(s.get("width"), 0.5, 60), "pts": out}
        if s.get("shape"):
            d["shape"] = True  # 도형: 곧은 선으로 잇는다
        return d
    except (TypeError, ValueError, KeyError, IndexError):
        raise ApiError("필기 내용이 이상해요.") from None


def ink_json(r):
    d = json.loads(r["data"])
    d.update(id=r["id"], page=r["page"], author=brief(r["author_id"]))
    if d.get("tool") == "image":
        m = file_meta(d["file"])
        d["url"] = m["url"] if m else None
    return d


def ink_layout(r):
    """쪽마다 배경: [{"bg": "lined"}, {"bg": "image", "file": 3, "url": ...}]"""
    try:
        lay = json.loads(r["ink_layout"] or "[]")
    except ValueError:
        lay = []
    if not lay:
        lay = [{"bg": r["ink_bg"] if r["ink_bg"] in INK_BGS else "lined"} for _ in range(max(1, r["ink_pages"]))]
    for pg in lay:
        if pg.get("bg") == "image":
            m = file_meta(pg.get("file"))
            pg["url"] = m["url"] if m else None
    return lay


def save_layout(c, nid, lay):
    plain = [{k: v for k, v in pg.items() if k in ("bg", "file", "src")} for pg in lay]
    c.execute("UPDATE es_notes SET ink_layout = ?, ink_pages = ? WHERE id = ?", (json.dumps(plain), len(plain), nid))


def page_spec(d, scope):
    bg = d.get("bg")
    if bg not in INK_BGS:
        raise ApiError("쪽 모양이 이상해요.")
    if bg == "image":
        fid = d.get("file")
        f = db().execute("SELECT scope, ext FROM es_files WHERE id = ?", (fid,)).fetchone() if isinstance(fid, int) else None
        if not f or f["scope"] != scope or f["ext"] not in IMAGE_EXT:
            raise ApiError("배경 그림을 찾을 수 없어요.")
        return {"bg": "image", "file": fid}
    return {"bg": bg}


@app.get("/api/notes/<int:nid>/ink")
def get_ink(nid):
    r = note_row(nid)
    need_scope(r["scope"])
    rows = db().execute("SELECT * FROM es_ink WHERE note_id = ? ORDER BY id", (nid,)).fetchall()
    lay = ink_layout(r)
    return {"pages": len(lay), "layout": lay, "rev": INK_REV.get(nid, 0), "strokes": [ink_json(x) for x in rows]}


@app.post("/api/notes/<int:nid>/ink")
@limiter.limit("1500 per minute")
def add_ink(nid):
    """획 하나({page, stroke}) 또는 여러 개({items: [{page, stroke, tmp}]}, 올가미로 옮길 때)를 저장한다."""
    r = note_row(nid)
    u = need_scope(r["scope"], write=True)
    d = body()
    items = d.get("items") if isinstance(d.get("items"), list) else [{"page": d.get("page"), "stroke": d.get("stroke"), "tmp": d.get("tmp")}]
    if not 1 <= len(items) <= 300:
        raise ApiError("한 번에 300개까지 저장할 수 있어요.")
    pages = len(ink_layout(r))
    clean_items = []
    for it in items:
        page = it.get("page") if isinstance(it, dict) else None
        if not isinstance(page, int) or isinstance(page, bool) or not 0 <= page < pages:
            raise ApiError("페이지가 이상해요.")
        clean_items.append((page, ink_clean(it.get("stroke"), r["scope"]), str(it.get("tmp") or "")[:40]))
    c = db()
    if c.execute("SELECT COUNT(*) FROM es_ink WHERE note_id = ?", (nid,)).fetchone()[0] + len(clean_items) > INK_MAX_STROKES:
        raise ApiError("이 노트에는 더 쓸 수 없어요. 새 노트를 만들어 주세요.")
    out = []
    for page, stroke, tmp in clean_items:
        sid = c.execute("INSERT INTO es_ink (note_id, page, data, author_id, created_at) VALUES (?, ?, ?, ?, ?)", (nid, page, json.dumps(stroke), u["id"], now_iso())).lastrowid
        x = ink_json(c.execute("SELECT * FROM es_ink WHERE id = ?", (sid,)).fetchone())
        x["tmp"] = tmp
        out.append(x)
    c.execute("UPDATE es_notes SET last_edited_by = ?, updated_at = ? WHERE id = ?", (u["id"], now_iso(), nid))
    c.commit()
    ink_changed(nid, r["scope"], {"type": "ink_add", "noteId": nid, "strokes": out})
    return {"strokes": out} if "items" in d else out[0]


@app.post("/api/notes/<int:nid>/ink/delete")
def del_ink(nid):
    """지우개·올가미 삭제: 획 id 목록, 또는 쪽 하나를 통째로 ({"page": n})."""
    r = note_row(nid)
    u = need_scope(r["scope"], write=True)
    d = body()
    c = db()
    if isinstance(d.get("page"), int) and not isinstance(d.get("page"), bool):
        sids = [x["id"] for x in c.execute("SELECT id FROM es_ink WHERE note_id = ? AND page = ?", (nid, d["page"]))]
    else:
        sids = d.get("ids")
        if not isinstance(sids, list) or not sids or len(sids) > 2000 or not all(isinstance(x, int) and not isinstance(x, bool) for x in sids):
            raise ApiError("지울 것이 이상해요.")
    for i in range(0, len(sids), 400):
        part = sids[i:i + 400]
        c.execute(f"DELETE FROM es_ink WHERE note_id = ? AND id IN ({','.join('?' * len(part))})", (nid, *part))  # 자리표시자 개수만 이어 붙인다
    c.execute("UPDATE es_notes SET last_edited_by = ?, updated_at = ? WHERE id = ?", (u["id"], now_iso(), nid))
    c.commit()
    if sids:
        ink_changed(nid, r["scope"], {"type": "ink_del", "noteId": nid, "ids": sids})
    return {"ids": sids}


@app.post("/api/notes/<int:nid>/pages")
def ink_pages(nid):
    """쪽 넣기·지우기·모양 바꾸기. {action: insert|remove|set|setAll, at, bg, file}"""
    r = note_row(nid)
    need_scope(r["scope"], write=True)
    d = body()
    act = d.get("action")
    with INK_LOCK:
        r = note_row(nid)
        lay = [{k: v for k, v in pg.items() if k != "url"} for pg in ink_layout(r)]
        at = d.get("at")
        if act in ("insert", "remove", "set") and (not isinstance(at, int) or isinstance(at, bool) or not 0 <= at <= len(lay) - (act != "insert")):
            raise ApiError("쪽 번호가 이상해요.")
        c = db()
        if act == "insert":
            if len(lay) >= INK_MAX_PAGES:
                raise ApiError(f"한 노트는 {INK_MAX_PAGES}쪽까지예요.")
            lay.insert(at, page_spec(d, r["scope"]))
            c.execute("UPDATE es_ink SET page = page + 1 WHERE note_id = ? AND page >= ?", (nid, at))
        elif act == "remove":
            if len(lay) <= 1:
                raise ApiError("마지막 한 쪽은 지울 수 없어요.")
            lay.pop(at)
            c.execute("DELETE FROM es_ink WHERE note_id = ? AND page = ?", (nid, at))
            c.execute("UPDATE es_ink SET page = page - 1 WHERE note_id = ? AND page > ?", (nid, at))
        elif act == "set":
            lay[at] = page_spec(d, r["scope"])
        elif act == "setAll":
            spec = page_spec(d, r["scope"])
            lay = [pg if pg.get("bg") == "image" else dict(spec) for pg in lay]
        else:
            raise ApiError("할 일이 이상해요.")
        save_layout(c, nid, lay)
        c.commit()
    lay = ink_layout(note_row(nid))
    ink_changed(nid, r["scope"], {"type": "ink_meta", "noteId": nid, "layout": lay, "reload": act in ("insert", "remove")})
    return {"layout": lay}


@app.post("/api/notes/<int:nid>/import")
@limiter.limit("30 per hour")
def ink_import(nid):
    """PDF(쪽마다 그림으로 바꿔서) 또는 사진을 새 쪽 배경으로 넣는다. 그 위에 펜으로 쓸 수 있다."""
    r = note_row(nid)
    u = need_scope(r["scope"], write=True)
    f = request.files.get("file")
    if not f:
        raise ApiError("파일을 골라 주세요.")
    at = request.form.get("at", type=int)
    name = os.path.basename(f.filename or "file")
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    data = f.read()
    if not data:
        raise ApiError("빈 파일이에요.")
    c = db()
    new_pages = []
    if ext == "pdf":
        import fitz  # PyMuPDF

        try:
            pdf = fitz.open(stream=data, filetype="pdf")
        except Exception:
            raise ApiError("PDF를 열 수 없어요.") from None
        if pdf.needs_pass:
            raise ApiError("비밀번호가 걸린 PDF는 넣을 수 없어요.")
        n = min(pdf.page_count, 30)
        base = name.rsplit(".", 1)[0][:60]
        for i in range(n):
            pg = pdf[i]
            zoom = 1400 / max(pg.rect.width, 1)
            pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            fid = save_upload(Blob(f"{base}-{i + 1}쪽.jpg", pix.tobytes("jpeg", jpg_quality=85)), r["scope"], u["id"], c)
            new_pages.append({"bg": "image", "file": fid, "src": "pdf"})
        skipped = pdf.page_count - n
        # 원래 PDF도 문서처럼 받을 수 있게 보관
        save_upload(Blob(name, data), r["scope"], u["id"], c)
    elif ext in IMAGE_EXT:
        fid = save_upload(Blob(name, data), r["scope"], u["id"], c)
        new_pages.append({"bg": "image", "file": fid, "src": "image"})
        skipped = 0
    else:
        raise ApiError("PDF나 사진만 넣을 수 있어요.")
    with INK_LOCK:
        r = note_row(nid)
        lay = [{k: v for k, v in pg.items() if k != "url"} for pg in ink_layout(r)]
        if len(lay) + len(new_pages) > INK_MAX_PAGES:
            raise ApiError(f"한 노트는 {INK_MAX_PAGES}쪽까지예요.")
        # 비어 있는 첫 쪽 하나뿐이면 그 자리를 쓴다
        if len(lay) == 1 and not c.execute("SELECT 1 FROM es_ink WHERE note_id = ? LIMIT 1", (nid,)).fetchone() and at is None:
            lay, at = [], 0
        at = len(lay) if at is None or not 0 <= at <= len(lay) else at
        c.execute("UPDATE es_ink SET page = page + ? WHERE note_id = ? AND page >= ?", (len(new_pages), nid, at))
        lay[at:at] = new_pages
        save_layout(c, nid, lay)
        c.commit()
    lay = ink_layout(note_row(nid))
    ink_changed(nid, r["scope"], {"type": "ink_meta", "noteId": nid, "layout": lay, "reload": True})
    return {"layout": lay, "at": at, "added": len(new_pages), "skipped": skipped}


@app.post("/api/notes/<int:nid>/export")
@limiter.limit("20 per hour")
def ink_export(nid):
    """화면이 그린 쪽 그림(JPEG)들을 PDF 하나로 묶어 돌려준다."""
    import base64

    import fitz

    r = note_row(nid)
    need_scope(r["scope"])
    pages = body().get("pages")
    if not isinstance(pages, list) or not 1 <= len(pages) <= INK_MAX_PAGES:
        raise ApiError("내보낼 쪽이 없어요.")
    doc = fitz.open()
    for p in pages:
        if not isinstance(p, str) or not p.startswith("data:image/jpeg;base64,"):
            raise ApiError("쪽 그림이 이상해요.")
        try:
            img = base64.b64decode(p.split(",", 1)[1], validate=True)
        except ValueError:
            raise ApiError("쪽 그림이 이상해요.") from None
        pg = doc.new_page(width=595, height=842)  # A4
        pg.insert_image(pg.rect, stream=img)
    out = io.BytesIO(doc.tobytes(deflate=True))
    name = re.sub(r'[\\/:*?"<>|]', "_", r["title"])[:60] or "필기"
    return send_file(out, mimetype="application/pdf", as_attachment=True, download_name=f"{name}.pdf")


class Blob:
    """메모리에 있는 내용을 업로드 파일처럼 저장하기."""

    def __init__(self, name, data):
        self.filename, self.data = name, data

    def save(self, path):
        with open(path, "wb") as fh:
            fh.write(self.data)


# 웹소켓이 안 되는 화면을 위한 같은 기능 (HTTP)
@app.post("/api/notes/<int:nid>/ops")
@limiter.limit("600 per minute")
def http_note_op(nid):
    r = note_row(nid)
    u = need_scope(r["scope"], write=True)
    d = body()
    ops, v, seq = ot.clean(d.get("ops")), d.get("v"), d.get("seq")
    if ops is None or not isinstance(v, int) or not isinstance(seq, int):
        raise ApiError("편집 내용이 이상해요.")
    doc = note_doc(nid)
    res, bump_list = note_apply(doc, dict(u), v, ops, str(d.get("clientId") or "")[:40], seq)
    if res.get("error"):
        raise ApiError(res["error"])
    if res.get("type") == "op":
        send_note(nid, res)
        if bump_list:
            bump(r["scope"], "notes", nid)
    return res


@app.get("/api/notes/<int:nid>/ops")
def http_note_poll(nid):
    r = note_row(nid)
    u = need_scope(r["scope"])
    cid = (request.args.get("clientId") or "")[:40]
    if cid:
        presence_set(nid, cid, dict(u), request.args.get("pos", type=int) or 0, False)
    doc = note_doc(nid)
    missed = note_since(doc, request.args.get("since", type=int) or 0)
    out = {"presence": presence_list(nid)}
    if missed is None:
        with doc.lock:
            out.update(resync=True, content=ot.decode(doc.buf), v=doc.version)
    else:
        out["ops"] = missed
    return out


# 웹소켓이 안 될 때 화면이 4초마다 묻는다: 무엇이 바뀌었나, 누가 접속해 있나
@app.get("/api/pulse")
def pulse():
    scope = request.args.get("scope", "")
    u = need_scope(scope)
    with hub.lock:
        hub.http_seen.setdefault(scope, {})[u["id"]] = (time.time(), user_dict(u))
        p = dict(hub.pulse.get(scope, {}))
    return {"pulse": p, "online": hub.online(scope)}


# ───────────────────────── 체험 데이터 ─────────────────────────
def seed_demo(c):
    from seed import seed  # 처음 한 번만 무거운 그림·PDF를 만든다

    if c.execute("SELECT value FROM es_meta WHERE key = 'demo_seeded'").fetchone():
        seed_demo_ink(c)
        seed_demo_class(c)
        return
    seed(c, DEMO_SCOPE, DEMO, now_iso, today_kst(), lambda f, scope, uid: save_upload(f, scope, uid, c), ensure_subjects)
    c.execute("INSERT OR REPLACE INTO es_meta (key, value) VALUES ('demo_seeded', ?)", (now_iso(),))
    c.commit()
    seed_demo_ink(c)
    seed_demo_class(c)
    notes_text_to_ink(c)


def seed_demo_ink(c):
    """체험 반 손필기 예시 (예전에 만든 체험 반에도 한 번 붙인다)."""
    from seed import seed_ink

    if c.execute("SELECT value FROM es_meta WHERE key = 'demo_ink'").fetchone():
        return
    seed_ink(c, DEMO_SCOPE, now_iso)
    c.execute("INSERT OR REPLACE INTO es_meta (key, value) VALUES ('demo_ink', ?)", (now_iso(),))
    c.commit()


def seed_demo_class(c):
    """체험 반 클래스룸 예시 (예전에 만든 체험 반에도 한 번 붙인다)."""
    from seed import seed_classroom

    if c.execute("SELECT value FROM es_meta WHERE key = 'demo_class'").fetchone():
        return
    seed_classroom(c, DEMO_SCOPE, now_iso, today_kst())
    c.execute("INSERT OR REPLACE INTO es_meta (key, value) VALUES ('demo_class', ?)", (now_iso(),))
    c.commit()


import classroom  # noqa: E402,F401  클래스룸 (스트림·과제·제출·채점)

import study  # noqa: E402,F401  공부 타이머


# ───────────────────────── 한 번만 하는 정리 ─────────────────────────
OWNER_COLS = [("es_events", "created_by"), ("es_events", "updated_by"), ("es_subjects", "created_by"), ("es_files", "owner_id"), ("es_docs", "created_by"),
              ("es_doc_versions", "uploaded_by"), ("es_notes", "created_by"), ("es_notes", "last_edited_by"), ("es_ink", "author_id"), ("es_comments", "author_id"),
              ("es_posts", "author_id"), ("es_cw", "author_id"), ("es_study", "user_id")]


def dedupe_users(c):
    """같은 정보(학교·학년·반·역할·이름)로 여러 번 만들어진 계정을 하나로 합친다. 체험 계정은 학생 하나·선생님 하나로."""
    groups = {}
    for r in c.execute("SELECT * FROM es_users WHERE email IS NULL AND school_code IS NOT NULL ORDER BY id"):
        key = ("demo", r["role"]) if r["demo"] else (r["role"], r["office"], r["school_code"], r["grade"], r["class_num"], r["name"])
        groups.setdefault(key, []).append(r["id"])
    merged = 0
    for key, uids in groups.items():
        keep = uids[0]
        for dup in uids[1:]:
            for table, col in OWNER_COLS:
                c.execute(f"UPDATE {table} SET {col} = ? WHERE {col} = ?", (keep, dup))  # 표·칸 이름은 위 목록에 있는 것뿐
            c.execute("UPDATE OR IGNORE es_subs SET student_id = ? WHERE student_id = ?", (keep, dup))
            c.execute("DELETE FROM es_subs WHERE student_id = ?", (dup,))
            c.execute("DELETE FROM es_users WHERE id = ?", (dup,))
            merged += 1
        if key[0] == "demo":
            c.execute("UPDATE es_users SET name = ? WHERE id = ?", ("체험 선생님" if key[1] == "teacher" else "체험 학생", keep))
    # 타이머가 둘 이상 켜져 있으면 가장 최근 것만 남긴다
    for r in c.execute("SELECT user_id FROM es_study WHERE seconds IS NULL GROUP BY user_id HAVING COUNT(*) > 1").fetchall():
        ids = [x[0] for x in c.execute("SELECT id FROM es_study WHERE user_id = ? AND seconds IS NULL ORDER BY id", (r[0],))]
        for i in ids[:-1]:
            c.execute("UPDATE es_study SET seconds = 0 WHERE id = ?", (i,))
    c.commit()
    return merged


def md_to_plain(t):
    out = []
    for ln in (t or "").split("\n"):
        ln = re.sub(r"^#{1,6}\s+", "", ln)
        ln = re.sub(r"^(\s*)[-*]\s+\[[xX]\]\s*", r"\1☑ ", ln)
        ln = re.sub(r"^(\s*)[-*]\s+\[ \]\s*", r"\1☐ ", ln)
        ln = re.sub(r"^(\s*)[-*]\s+", r"\1• ", ln)
        out.append(ln.replace("**", "").replace("`", ""))
    return "\n".join(out).strip()


def notes_text_to_ink(c):
    """글로 쓴 노트를 필기 노트 첫 쪽의 글상자로 옮긴다 (이제 노트는 필기 화면 하나)."""
    for r in c.execute("SELECT id, content, created_by, last_edited_by FROM es_notes WHERE content != ''").fetchall():
        text = md_to_plain(r["content"])[:5000]
        if text:
            c.execute("INSERT INTO es_ink (note_id, page, data, author_id, created_at) VALUES (?, 0, ?, ?, ?)",
                      (r["id"], json.dumps({"tool": "text", "text": text, "color": "#191f28", "x": 70, "y": 70, "size": 24, "w": 860}), r["last_edited_by"] or r["created_by"], now_iso()))
        c.execute("UPDATE es_notes SET content = '', version = version + 1 WHERE id = ?", (r["id"],))
    c.commit()


def _cleanup():
    c = connect()
    dedupe_users(c)
    notes_text_to_ink(c)
    c.close()


_cleanup()
