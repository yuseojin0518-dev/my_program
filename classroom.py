"""클래스룸: 과목마다 스트림(공지·댓글), 수업 과제(과제·질문·자료), 제출·채점·반환, 비공개 댓글, 사람, 성적.

- 과제·질문·자료를 만들고 채점·반환하는 것은 선생님만
- 공지(스트림 글)는 반 누구나 (내 반), 선생님은 학교 모든 반
- 제출은 그 반 학생만. 학생은 내 제출물만, 선생님은 모두 본다
- 비공개 댓글(sub:ID)은 그 학생과 선생님만 본다
app.py 가 맨 끝에서 import 한다.
"""
import json
import re
from datetime import datetime

from flask import request

import app as A
from app import ApiError, app, body, brief, bump, can_view, can_write, clean, db, file_meta, ids, need_scope, now_iso, scope_of, subject_row, KST

SCHEMA = """
CREATE TABLE IF NOT EXISTS es_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, subject_id INTEGER NOT NULL REFERENCES es_subjects(id) ON DELETE CASCADE,
  text TEXT NOT NULL, attachments TEXT NOT NULL DEFAULT '[]', author_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS es_posts_subj ON es_posts(subject_id);
CREATE TABLE IF NOT EXISTS es_cw (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, subject_id INTEGER NOT NULL REFERENCES es_subjects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', points INTEGER, due TEXT,
  attachments TEXT NOT NULL DEFAULT '[]', question TEXT NOT NULL DEFAULT '', author_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS es_cw_subj ON es_cw(subject_id);
CREATE INDEX IF NOT EXISTS es_cw_scope_due ON es_cw(scope, due);
CREATE TABLE IF NOT EXISTS es_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, cw_id INTEGER NOT NULL REFERENCES es_cw(id) ON DELETE CASCADE, student_id INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '', attachments TEXT NOT NULL DEFAULT '[]', answer TEXT NOT NULL DEFAULT '', submitted_at TEXT, returned_at TEXT,
  grade REAL, updated_at TEXT NOT NULL, UNIQUE(cw_id, student_id));
"""

KINDS = {"assignment": "과제", "question": "질문", "material": "자료"}
DUE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")


def init():
    c = A.connect()
    c.executescript(SCHEMA)
    c.commit()
    c.close()


init()


def now_local():
    return datetime.now(KST).strftime("%Y-%m-%dT%H:%M:%S")


def is_teacher(u, scope):
    return u["role"] == "teacher" and can_write(u, scope)


def need_teacher(scope):
    u = need_scope(scope)
    if not is_teacher(u, scope):
        raise ApiError("선생님만 할 수 있어요.", 403)
    return u


def is_student_of(u, scope):
    return u["role"] == "student" and scope_of(u) == scope


def metas(raw):
    return [m for m in (file_meta(i) for i in json.loads(raw or "[]")) if m]


def check_files(file_ids, scope):
    A.check_files(file_ids, scope)
    return json.dumps(file_ids)


# ───── 사람 ─────
def people(scope):
    """반 학생과 선생님. 체험 반은 '체험 학생'이 많이 생기니, 나와 제출한 적 있는 체험 학생만 넣는다."""
    m = A.SCOPE_RE.match(scope)
    office, school, grade, cls = m.group(1), m.group(2), int(m.group(3)), int(m.group(4))
    c = db()
    me = A.me()
    rows = c.execute("SELECT * FROM es_users WHERE office = ? AND school_code = ? AND grade = ? AND class_num = ? ORDER BY role DESC, name, id",
                     (office, school, grade, cls)).fetchall()
    active = {r[0] for r in c.execute("SELECT DISTINCT student_id FROM es_subs WHERE scope = ? AND submitted_at IS NOT NULL", (scope,))}
    authors = {r[0] for r in c.execute("SELECT DISTINCT author_id FROM es_cw WHERE scope = ? UNION SELECT DISTINCT author_id FROM es_posts WHERE scope = ?", (scope, scope))}
    teachers, students = [], []
    for r in rows:
        if r["demo"] and r["id"] != (me["id"] if me else None) and r["id"] not in active and r["id"] not in authors:
            continue
        (teachers if r["role"] == "teacher" else students).append(r)
    # 다른 반 담당 선생님이 이 반에 과제를 냈으면 선생님 목록에 넣는다
    known = {t["id"] for t in teachers}
    for uid in authors:
        r = A.user_row(uid) if uid else None
        if r and r["role"] == "teacher" and r["id"] not in known and r["school_code"] == school:
            teachers.append(r)
            known.add(r["id"])
    return teachers, students


def person(r):
    return {"id": r["id"], "name": r["name"], "color": r["color"], "role": r["role"]}


@app.get("/api/class/people")
def api_people():
    scope = request.args.get("scope", "")
    need_scope(scope)
    t, s = people(scope)
    return {"teachers": [person(x) for x in t], "students": [person(x) for x in s]}


# ───── 상태 계산 ─────
def status_of(cw, sub):
    """assigned 할 일 / submitted 제출함 / late 늦게 제출 / missing 안 냄 / returned 돌려받음 / None(자료)"""
    if cw["kind"] == "material":
        return None
    if sub is not None and sub["returned_at"] and (not sub["submitted_at"] or sub["returned_at"] >= sub["submitted_at"]):
        return "returned"
    if sub is not None and sub["submitted_at"]:
        return "late" if cw["due"] and sub["submitted_at"][:16] > cw["due"] else "submitted"
    if cw["due"] and now_local()[:16] > cw["due"]:
        return "missing"
    return "assigned"


def my_sub(cw_id, uid):
    return db().execute("SELECT * FROM es_subs WHERE cw_id = ? AND student_id = ?", (cw_id, uid)).fetchone()


def ensure_sub(cw, uid):
    c = db()
    c.execute("INSERT OR IGNORE INTO es_subs (scope, cw_id, student_id, updated_at) VALUES (?, ?, ?, ?)", (cw["scope"], cw["id"], uid, now_iso()))
    c.commit()
    return my_sub(cw["id"], uid)


def sub_json(sub, cw, full=True):
    st = status_of(cw, sub)
    out = {"id": sub["id"] if sub else None, "status": st, "submittedAt": sub["submitted_at"] if sub else None,
           "returnedAt": sub["returned_at"] if sub else None, "grade": sub["grade"] if sub else None}
    if full and sub:
        out.update(text=sub["text"], attachments=metas(sub["attachments"]), answer=json.loads(sub["answer"]) if sub["answer"] else None,
                   privateComments=A.comment_count(f"sub:{sub['id']}"))
    return out


def cw_row(cid):
    r = db().execute("SELECT * FROM es_cw WHERE id = ?", (cid,)).fetchone()
    if not r:
        raise ApiError("과제를 찾을 수 없어요.", 404)
    return r


def counts(cw, students):
    c = {"assigned": 0, "submitted": 0, "late": 0, "missing": 0, "returned": 0, "total": len(students)}
    subs = {r["student_id"]: r for r in db().execute("SELECT * FROM es_subs WHERE cw_id = ?", (cw["id"],))}
    for s in students:
        st = status_of(cw, subs.get(s["id"]))
        if st:
            c[st] += 1
    c["turnedIn"] = c["submitted"] + c["late"]
    c["graded"] = sum(1 for s in students if subs.get(s["id"]) and subs[s["id"]]["grade"] is not None)
    return c


def cw_json(r, u, full=False, students=None):
    q = json.loads(r["question"]) if r["question"] else None
    out = {"id": r["id"], "subjectId": r["subject_id"], "kind": r["kind"], "topic": r["topic"], "title": r["title"], "instructions": r["instructions"],
           "points": r["points"], "due": r["due"], "attachments": metas(r["attachments"]), "question": q, "author": brief(r["author_id"]),
           "createdAt": r["created_at"], "updatedAt": r["updated_at"], "comments": A.comment_count(f"cw:{r['id']}")}
    if is_student_of(u, r["scope"]):
        out["mine"] = sub_json(my_sub(r["id"], u["id"]), r, full)
    elif is_teacher(u, r["scope"]) and r["kind"] != "material":
        out["counts"] = counts(r, students if students is not None else people(r["scope"])[1])
    return out


# ───── 스트림 ─────
def post_json(r):
    return {"id": r["id"], "type": "post", "text": r["text"], "attachments": metas(r["attachments"]), "author": brief(r["author_id"]),
            "createdAt": r["created_at"], "updatedAt": r["updated_at"], "comments": A.comment_count(f"post:{r['id']}")}


@app.get("/api/class/stream")
def api_stream():
    s = subject_row(request.args.get("subject", type=int))
    u = need_scope(s["scope"])
    c = db()
    posts = [post_json(r) for r in c.execute("SELECT * FROM es_posts WHERE subject_id = ? ORDER BY created_at DESC, id DESC LIMIT 100", (s["id"],))]
    work = c.execute("SELECT * FROM es_cw WHERE subject_id = ? ORDER BY created_at DESC, id DESC", (s["id"],)).fetchall()
    students = people(s["scope"])[1]
    items = posts + [dict(cw_json(r, u, students=students), type="work") for r in work]
    items.sort(key=lambda x: x["createdAt"], reverse=True)
    upcoming = []
    for r in sorted((w for w in work if w["due"] and w["due"] >= now_local()[:16]), key=lambda w: w["due"]):
        if is_student_of(u, s["scope"]) and status_of(r, my_sub(r["id"], u["id"])) not in ("assigned",):
            continue
        upcoming.append({"id": r["id"], "title": r["title"], "due": r["due"], "kind": r["kind"]})
    return {"items": items[:120], "upcoming": upcoming[:5]}


@app.post("/api/class/posts")
@A.limiter.limit("60 per hour")
def add_post():
    d = body()
    s = subject_row(d.get("subject"))
    u = need_scope(s["scope"], write=True)
    text = clean(d.get("text"), 3000, True, "공지 내용")
    atts = check_files(ids(d.get("attachments", [])), s["scope"])
    c = db()
    pid = c.execute("INSERT INTO es_posts (scope, subject_id, text, attachments, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (s["scope"], s["id"], text, atts, u["id"], now_iso(), now_iso())).lastrowid
    c.commit()
    bump(s["scope"], "classroom", pid)
    return post_json(c.execute("SELECT * FROM es_posts WHERE id = ?", (pid,)).fetchone())


def post_row(pid):
    r = db().execute("SELECT * FROM es_posts WHERE id = ?", (pid,)).fetchone()
    if not r:
        raise ApiError("글을 찾을 수 없어요.", 404)
    return r


@app.patch("/api/class/posts/<int:pid>")
def edit_post(pid):
    r = post_row(pid)
    u = need_scope(r["scope"], write=True)
    if u["id"] != r["author_id"]:
        raise ApiError("내 글만 고칠 수 있어요.", 403)
    c = db()
    c.execute("UPDATE es_posts SET text = ?, updated_at = ? WHERE id = ?", (clean(body().get("text"), 3000, True, "공지 내용"), now_iso(), pid))
    c.commit()
    bump(r["scope"], "classroom", pid)
    return post_json(post_row(pid))


@app.delete("/api/class/posts/<int:pid>")
def del_post(pid):
    r = post_row(pid)
    u = need_scope(r["scope"], write=True)
    if not A.is_owner(u, r["author_id"]):
        raise ApiError("내 글만 지울 수 있어요.", 403)
    c = db()
    c.execute("DELETE FROM es_posts WHERE id = ?", (pid,))
    c.execute("DELETE FROM es_comments WHERE target = ?", (f"post:{pid}",))
    c.commit()
    bump(r["scope"], "classroom", pid)
    return {"ok": True}


# ───── 수업 과제 ─────
@app.get("/api/class/work")
def api_work():
    s = subject_row(request.args.get("subject", type=int))
    u = need_scope(s["scope"])
    students = people(s["scope"])[1]
    rows = db().execute("SELECT * FROM es_cw WHERE subject_id = ? ORDER BY created_at DESC, id DESC", (s["id"],)).fetchall()
    return {"work": [cw_json(r, u, students=students) for r in rows], "teacher": is_teacher(u, s["scope"]), "student": is_student_of(u, s["scope"])}


def cw_fields(d, scope):
    kind = d.get("kind") if d.get("kind") in KINDS else None
    if not kind:
        raise ApiError("종류(과제·질문·자료)를 골라 주세요.")
    title = clean(d.get("title"), 100, True, "제목")
    ins = clean(d.get("instructions"), 5000)
    topic = clean(d.get("topic"), 30)
    points, due, q = None, None, ""
    if kind != "material":
        if d.get("points") not in (None, ""):
            try:
                points = int(d.get("points"))
            except (TypeError, ValueError):
                raise ApiError("점수는 숫자로 써 주세요.") from None
            if not 0 < points <= 1000:
                raise ApiError("점수는 1~1000점이에요.")
        if d.get("due"):
            due = str(d.get("due"))[:16]
            if not DUE_RE.match(due):
                raise ApiError("마감 날짜가 이상해요.")
            try:
                datetime.strptime(due, "%Y-%m-%dT%H:%M")
            except ValueError:
                raise ApiError("마감 날짜가 이상해요.") from None
    if kind == "question":
        qq = d.get("question") or {}
        qtype = qq.get("type") if qq.get("type") in ("short", "choice") else "short"
        spec = {"type": qtype, "showAnswers": bool(qq.get("showAnswers"))}
        if qtype == "choice":
            opts = [clean(o, 100) for o in (qq.get("options") or []) if str(o or "").strip()]
            if not 2 <= len(opts) <= 8:
                raise ApiError("보기는 2~8개 넣어 주세요.")
            spec["options"] = opts
        q = json.dumps(spec)
    atts = check_files(ids(d.get("attachments", [])), scope)
    return kind, topic, title, ins, points, due, atts, q


@app.post("/api/class/work")
def add_work():
    d = body()
    s = subject_row(d.get("subject"))
    u = need_teacher(s["scope"])
    f = cw_fields(d, s["scope"])
    c = db()
    cid = c.execute("INSERT INTO es_cw (scope, subject_id, kind, topic, title, instructions, points, due, attachments, question, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (s["scope"], s["id"], *f, u["id"], now_iso(), now_iso())).lastrowid
    c.commit()
    bump(s["scope"], "classroom", cid)
    if f[5]:
        bump(s["scope"], "events", None)  # 달력에 마감이 생긴다
    return cw_json(cw_row(cid), u, True)


@app.patch("/api/class/work/<int:cid>")
def edit_work(cid):
    r = cw_row(cid)
    u = need_teacher(r["scope"])
    d = body()
    d["kind"] = r["kind"]
    f = cw_fields(d, r["scope"])
    c = db()
    c.execute("UPDATE es_cw SET kind = ?, topic = ?, title = ?, instructions = ?, points = ?, due = ?, attachments = ?, question = ?, updated_at = ? WHERE id = ?", (*f, now_iso(), cid))
    c.commit()
    bump(r["scope"], "classroom", cid)
    bump(r["scope"], "events", None)
    return cw_json(cw_row(cid), u, True)


@app.delete("/api/class/work/<int:cid>")
def del_work(cid):
    r = cw_row(cid)
    need_teacher(r["scope"])
    c = db()
    subs = [x[0] for x in c.execute("SELECT id FROM es_subs WHERE cw_id = ?", (cid,))]
    c.execute("DELETE FROM es_cw WHERE id = ?", (cid,))
    c.execute("DELETE FROM es_comments WHERE target = ?", (f"cw:{cid}",))
    for sid in subs:
        c.execute("DELETE FROM es_comments WHERE target = ?", (f"sub:{sid}",))
    c.commit()
    bump(r["scope"], "classroom", cid)
    bump(r["scope"], "events", None)
    return {"ok": True}


def answers_visible(cw, u):
    q = json.loads(cw["question"]) if cw["question"] else None
    if not q or cw["kind"] != "question":
        return False
    if is_teacher(u, cw["scope"]):
        return True
    s = my_sub(cw["id"], u["id"])
    return bool(q.get("showAnswers") and s and s["submitted_at"])


@app.get("/api/class/work/<int:cid>")
def get_work(cid):
    r = cw_row(cid)
    u = need_scope(r["scope"])
    teachers, students = people(r["scope"])
    if is_student_of(u, r["scope"]) and r["kind"] != "material":
        ensure_sub(r, u["id"])  # 비공개 댓글을 달 수 있게
    out = cw_json(r, u, True, students)
    if is_teacher(u, r["scope"]) and r["kind"] != "material":
        c = db()
        for s in students:
            c.execute("INSERT OR IGNORE INTO es_subs (scope, cw_id, student_id, updated_at) VALUES (?, ?, ?, ?)", (r["scope"], cid, s["id"], now_iso()))
        c.commit()
        subs = {x["student_id"]: x for x in c.execute("SELECT * FROM es_subs WHERE cw_id = ?", (cid,))}
        out["submissions"] = [dict(sub_json(subs.get(s["id"]), r), student=person(s)) for s in students]
    if answers_visible(r, u):
        q = json.loads(r["question"])
        ans = []
        for x in db().execute("SELECT * FROM es_subs WHERE cw_id = ? AND submitted_at IS NOT NULL ORDER BY submitted_at", (cid,)):
            ans.append({"student": brief(x["student_id"]), "answer": json.loads(x["answer"]) if x["answer"] else None})
        out["classAnswers"] = ans
        if q["type"] == "choice":
            tally = [0] * len(q["options"])
            for a in ans:
                if isinstance(a["answer"], int) and 0 <= a["answer"] < len(tally):
                    tally[a["answer"]] += 1
            out["tally"] = tally
    out["teacher"] = is_teacher(u, r["scope"])
    out["student"] = is_student_of(u, r["scope"])
    return out


@app.post("/api/class/work/<int:cid>/submit")
@A.limiter.limit("60 per hour")
def submit(cid):
    r = cw_row(cid)
    u = need_scope(r["scope"])
    if not is_student_of(u, r["scope"]) or r["kind"] == "material":
        raise ApiError("이 반 학생만 제출할 수 있어요.", 403)
    d = body()
    text = clean(d.get("text"), 3000)
    atts = check_files(ids(d.get("attachments", []), 10), r["scope"])
    answer = ""
    if r["kind"] == "question":
        q = json.loads(r["question"])
        a = d.get("answer")
        if q["type"] == "choice":
            if not isinstance(a, int) or isinstance(a, bool) or not 0 <= a < len(q["options"]):
                raise ApiError("보기를 하나 골라 주세요.")
        else:
            a = clean(a, 1000, True, "답")
        answer = json.dumps(a)
    elif not text and atts == "[]" and not d.get("markDone"):
        raise ApiError("파일을 첨부하거나 내용을 써 주세요. 첨부 없이 끝내려면 '완료로 표시'를 눌러요.")
    ensure_sub(r, u["id"])
    c = db()
    c.execute("UPDATE es_subs SET text = ?, attachments = ?, answer = ?, submitted_at = ?, updated_at = ? WHERE cw_id = ? AND student_id = ?",
              (text, atts, answer, now_local(), now_iso(), cid, u["id"]))
    c.commit()
    bump(r["scope"], "classroom", cid)
    return get_work(cid)


@app.post("/api/class/work/<int:cid>/unsubmit")
def unsubmit(cid):
    r = cw_row(cid)
    u = need_scope(r["scope"])
    if not is_student_of(u, r["scope"]):
        raise ApiError("이 반 학생만 할 수 있어요.", 403)
    if r["kind"] == "question":
        raise ApiError("질문의 답은 제출하면 바꿀 수 없어요.")
    c = db()
    c.execute("UPDATE es_subs SET submitted_at = NULL, updated_at = ? WHERE cw_id = ? AND student_id = ?", (now_iso(), cid, u["id"]))
    c.commit()
    bump(r["scope"], "classroom", cid)
    return get_work(cid)


def sub_row(sid):
    r = db().execute("SELECT * FROM es_subs WHERE id = ?", (sid,)).fetchone()
    if not r:
        raise ApiError("제출물을 찾을 수 없어요.", 404)
    return r


@app.patch("/api/class/subs/<int:sid>")
def grade_sub(sid):
    s = sub_row(sid)
    cw = cw_row(s["cw_id"])
    need_teacher(cw["scope"])
    g = body().get("grade")
    if g in (None, ""):
        g = None
    else:
        try:
            g = round(float(g), 1)
        except (TypeError, ValueError):
            raise ApiError("점수는 숫자로 써 주세요.") from None
        top = cw["points"] or 1000
        if not 0 <= g <= top:
            raise ApiError(f"점수는 0~{top}점이에요.")
    c = db()
    c.execute("UPDATE es_subs SET grade = ?, updated_at = ? WHERE id = ?", (g, now_iso(), sid))
    c.commit()
    bump(cw["scope"], "classroom", cw["id"])
    return sub_json(sub_row(sid), cw)


@app.post("/api/class/work/<int:cid>/return")
def return_subs(cid):
    cw = cw_row(cid)
    need_teacher(cw["scope"])
    sids = ids(body().get("ids", []), 200)
    if not sids:
        raise ApiError("돌려줄 학생을 골라 주세요.")
    c = db()
    t = now_local()
    for sid in sids:
        c.execute("UPDATE es_subs SET returned_at = ?, updated_at = ? WHERE id = ? AND cw_id = ?", (t, now_iso(), sid, cid))
    c.commit()
    bump(cw["scope"], "classroom", cid)
    return {"ok": True, "returned": len(sids)}


# ───── 성적·할 일·달력 ─────
@app.get("/api/class/grades")
def api_grades():
    s = subject_row(request.args.get("subject", type=int))
    u = need_scope(s["scope"])
    work = [w for w in db().execute("SELECT * FROM es_cw WHERE subject_id = ? AND kind != 'material' ORDER BY COALESCE(due, created_at), id", (s["id"],))]
    students = people(s["scope"])[1]
    if not is_teacher(u, s["scope"]):
        students = [x for x in students if x["id"] == u["id"]]
    rows = []
    for st in students:
        subs = {x["cw_id"]: x for x in db().execute("SELECT * FROM es_subs WHERE student_id = ? AND scope = ?", (st["id"], s["scope"]))}
        cells, got, top = [], 0.0, 0
        for w in work:
            x = subs.get(w["id"])
            cells.append({"status": status_of(w, x), "grade": x["grade"] if x else None, "returned": bool(x and x["returned_at"])})
            if x and x["grade"] is not None and w["points"]:
                got += x["grade"]
                top += w["points"]
        rows.append({"student": person(st), "cells": cells, "avg": round(got / top * 100, 1) if top else None})
    return {"work": [{"id": w["id"], "title": w["title"], "points": w["points"], "due": w["due"], "kind": w["kind"]} for w in work], "rows": rows}


@app.get("/api/class/overview")
def api_overview():
    """과목 카드에 보여 줄 요약과 '할 일' (학생) / '검토할 것' (선생님)."""
    scope = request.args.get("scope", "")
    u = need_scope(scope)
    c = db()
    teachers, students = people(scope)
    subjects = {}
    todo = []
    for w in c.execute("SELECT * FROM es_cw WHERE scope = ? ORDER BY COALESCE(due, '9999'), id", (scope,)):
        sj = subjects.setdefault(w["subject_id"], {"next": [], "work": 0, "review": 0})
        sj["work"] += 1
        if w["kind"] == "material":
            continue
        if is_student_of(u, scope):
            st = status_of(w, my_sub(w["id"], u["id"]))
            item = {"id": w["id"], "subjectId": w["subject_id"], "title": w["title"], "due": w["due"], "kind": w["kind"], "status": st, "points": w["points"]}
            todo.append(item)
            if st == "assigned" and len(sj["next"]) < 2:
                sj["next"].append(item)
        elif is_teacher(u, scope):
            cn = counts(w, students)
            pending = cn["turnedIn"]  # 제출했는데 아직 안 돌려준 것
            if pending:
                sj["review"] += pending
                todo.append({"id": w["id"], "subjectId": w["subject_id"], "title": w["title"], "due": w["due"], "kind": w["kind"], "pending": pending, "counts": cn})
            if w["due"] and w["due"] >= now_local()[:16] and len(sj["next"]) < 2:
                sj["next"].append({"id": w["id"], "title": w["title"], "due": w["due"], "kind": w["kind"]})
    for sid, v in list(subjects.items()):
        v["posts"] = c.execute("SELECT COUNT(*) FROM es_posts WHERE subject_id = ?", (sid,)).fetchone()[0]
    return {"subjects": {str(k): v for k, v in subjects.items()}, "todo": todo, "teacher": u["role"] == "teacher" and can_write(u, scope),
            "student": is_student_of(u, scope), "teachers": [person(t) for t in teachers], "studentCount": len(students)}


@app.get("/api/class/due")
def api_due():
    """달력에 마감일 보여 주기."""
    scope = request.args.get("scope", "")
    u = need_scope(scope)
    start, end = request.args.get("from", "0000"), request.args.get("to", "9999") + "T23:59"
    out = []
    subs = {r["id"]: r for r in db().execute("SELECT id, name, icon, color FROM es_subjects WHERE scope = ?", (scope,))}
    for w in db().execute("SELECT * FROM es_cw WHERE scope = ? AND due IS NOT NULL AND due >= ? AND due <= ? ORDER BY due", (scope, start, end)):
        sj = subs.get(w["subject_id"])
        item = {"id": w["id"], "subjectId": w["subject_id"], "subject": sj["name"] if sj else "", "icon": sj["icon"] if sj else "📘",
                "title": w["title"], "due": w["due"], "kind": w["kind"], "points": w["points"]}
        if is_student_of(u, scope):
            item["status"] = status_of(w, my_sub(w["id"], u["id"]))
        out.append(item)
    return {"due": out}


# ───── 댓글 연결 (스트림 글·과제는 반 공개, 제출물은 비공개) ─────
def guard_sub(u, sid):
    s = sub_row(sid)
    if not (u["id"] == s["student_id"] or (u["role"] == "teacher" and can_view(u, s["scope"]) and u["school_code"] == A.SCOPE_RE.match(s["scope"]).group(2))):
        raise ApiError("비공개 댓글은 그 학생과 선생님만 볼 수 있어요.", 403)


A.COMMENT_TARGETS.update({"post": ("es_posts", "classroom"), "cw": ("es_cw", "classroom"), "sub": ("es_subs", "classroom")})
A.COMMENT_GUARDS["sub"] = guard_sub
