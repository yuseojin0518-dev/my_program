"""나이스(NEIS) 교육정보 개방 포털 — 학교 검색, 학사일정, 급식.

인증키(.env NEIS_API_KEY)가 없으면 나이스는 한 번에 5건만 준다. 그래서 기간을 잘게 나눠 여러 번 부른다.
나이스에 연결이 안 되면 실제 고등학교와 비슷한 '예시 데이터'를 돌려준다 (화면에 '예시'라고 표시).
"""
import hashlib
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import requests

URL = "https://open.neis.go.kr/hub/"


class NeisError(Exception):
    pass


def call(service, params, key="", size=100, offline=False):
    if offline:
        raise NeisError("offline")
    p = {"Type": "json", "pIndex": 1, "pSize": size}
    if key:
        p["KEY"] = key
    p.update(params)
    try:
        r = requests.get(URL + service, params=p, timeout=8)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        raise NeisError(str(e)[:120]) from e
    if service not in data:
        res = data.get("RESULT", {})
        if res.get("CODE") == "INFO-200":  # 자료 없음
            return [], 0
        raise NeisError(res.get("MESSAGE") or "나이스 응답 오류")
    head, body = data[service][0]["head"], data[service][1]
    return body.get("row", []), head[0].get("list_total_count", 0)


def ymd(d):
    return d.strftime("%Y%m%d")


def iso(s):
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


# ───── 학교 검색 ─────
def search_schools(q, key="", offline=False):
    rows, _ = call("schoolInfo", {"SCHUL_NM": q}, key, 20, offline)
    return [
        {"office": r["ATPT_OFCDC_SC_CODE"], "code": r["SD_SCHUL_CODE"], "name": r["SCHUL_NM"],
         "region": r.get("LCTN_SC_NM", ""), "address": (r.get("ORG_RDNMA") or "")[:60], "kind": r.get("SCHUL_KND_SC_NM", "")}
        for r in rows
    ]


SAMPLE_SCHOOLS = [
    {"office": "K10", "code": "7801185", "name": "춘천고등학교", "region": "강원특별자치도", "address": "강원도 춘천시 중앙로68번길 37", "kind": "고등학교"},
    {"office": "B10", "code": "7010057", "name": "경복고등학교", "region": "서울특별시", "address": "서울특별시 종로구 자하문로 136", "kind": "고등학교"},
    {"office": "J10", "code": "7530060", "name": "수원고등학교", "region": "경기도", "address": "경기도 수원시 장안구 수성로 245", "kind": "고등학교"},
]


# ───── 학사일정 ─────
EXAM_RE = re.compile(r"(고사|중간고사|기말고사|지필)")
MOCK_RE = re.compile(r"(학력평가|모의|수능|대학수학능력)")
GRADE_FIELD = {1: "ONE_GRADE_EVENT_YN", 2: "TW_GRADE_EVENT_YN", 3: "THREE_GRADE_EVENT_YN"}


def classify(name, sub=""):
    if "토요휴업" in name:
        return None
    if MOCK_RE.search(name) and "휴업" not in name:
        return "mock"
    if EXAM_RE.search(name):
        return "exam"
    if sub in ("휴업일", "공휴일") or any(k in name for k in ("방학", "휴업", "공휴일", "대체")):
        return "holiday"
    return "event"


def schedule(office, school, grade, start, end, key="", offline=False):
    def one(a, b):
        return call("SchoolSchedule", {"ATPT_OFCDC_SC_CODE": office, "SD_SCHUL_CODE": school, "AA_FROM_YMD": ymd(a), "AA_TO_YMD": ymd(b)}, key, 1000 if key else 100, offline)

    step = 60 if key else 4
    wins, d = [], start
    while d <= end:
        wins.append((d, min(end, d + timedelta(days=step - 1))))
        d += timedelta(days=step)
    rows, retry = [], []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for (a, b), (rs, total) in zip(wins, ex.map(lambda w: one(*w), wins)):
            if len(rs) < total and a < b:
                retry += [(a + timedelta(days=i), a + timedelta(days=i)) for i in range((b - a).days + 1)]
            else:
                rows += rs
        if retry:
            for rs, _ in ex.map(lambda w: one(*w), retry):
                rows += rs
    field = GRADE_FIELD.get(grade)
    seen, out = set(), []
    for r in rows:
        if field and r.get(field) == "N":
            continue
        name = r.get("EVENT_NM") or ""
        t = classify(name, r.get("SBTR_DD_SC_NM") or "")
        if not t:
            continue
        k = (r["AA_YMD"], name)
        if k in seen:
            continue
        seen.add(k)
        out.append({"date": iso(r["AA_YMD"]), "name": name, "type": t})
    out.sort(key=lambda e: (e["date"], e["name"]))
    return out


def _monday_on_or_after(d):
    return d + timedelta(days=(7 - d.weekday()) % 7)


def sample_schedule(start, end, grade=2):
    """실제 고등학교 학사일정과 비슷한 예시 (나이스에 연결이 안 될 때)."""
    out = []

    def add(d, name, t):
        if start <= d <= end:
            out.append({"date": d.isoformat(), "name": name, "type": t})

    def span(d0, days, name, t, weekdays_only=True):
        for i in range(days):
            d = d0 + timedelta(days=i)
            if weekdays_only and d.weekday() >= 5:
                continue
            add(d, name, t)

    for y in range(start.year - 1, end.year + 1):
        for m, dd, n, t in [(1, 1, "신정", "holiday"), (3, 1, "삼일절", "holiday"), (3, 2, "입학식 및 1학기 개학식", "event"),
                            (5, 1, "개교기념일", "holiday"), (5, 5, "어린이날", "holiday"), (6, 6, "현충일", "holiday"),
                            (8, 15, "광복절", "holiday"), (8, 18, "2학기 개학식", "event"), (10, 3, "개천절", "holiday"),
                            (10, 9, "한글날", "holiday"), (12, 25, "성탄절", "holiday")]:
            add(date(y, m, dd), n, t)
        span(_monday_on_or_after(date(y, 4, 22)), 4, "1학기 1회고사(중간고사)", "exam")
        span(_monday_on_or_after(date(y, 7, 1)), 4, "1학기 2회고사(기말고사)", "exam")
        span(_monday_on_or_after(date(y, 9, 29)), 4, "2학기 1회고사(중간고사)", "exam")
        span(_monday_on_or_after(date(y, 12, 7)), 4, "2학기 2회고사(기말고사)", "exam")
        for m, dd in [(3, 26), (6, 4), (9, 3), (10, 21)]:
            d = date(y, m, dd)
            while d.weekday() >= 5:
                d += timedelta(days=1)
            add(d, "전국연합학력평가", "mock")
        add(date(y, 7, 18), "1학기 방학식", "event")
        span(date(y, 7, 19), 30, "여름방학", "holiday", False)
        add(date(y, 12, 30), "종업식", "event")
        span(date(y, 12, 31), 62, "겨울방학", "holiday", False)
        add(date(y, 11, 13 + (3 - date(y, 11, 13).weekday()) % 7), "대학수학능력시험(1,2학년 휴업일)", "holiday")
    seen, res = set(), []
    for e in sorted(out, key=lambda e: (e["date"], e["name"])):
        if (e["date"], e["name"]) not in seen:
            seen.add((e["date"], e["name"]))
            res.append(e)
    return res


# ───── 급식 ─────
ALLERGY = {1: "난류", 2: "우유", 3: "메밀", 4: "땅콩", 5: "대두", 6: "밀", 7: "고등어", 8: "게", 9: "새우", 10: "돼지고기",
           11: "복숭아", 12: "토마토", 13: "아황산류", 14: "호두", 15: "닭고기", 16: "쇠고기", 17: "오징어", 18: "조개류", 19: "잣"}
DISH_RE = re.compile(r"^(.*?)\s*\(([\d.\s]+)\)\s*$")


def parse_dish(raw):
    raw = re.sub(r"[*#]", "", raw or "").strip()
    m = DISH_RE.match(raw)
    if not m:
        return {"name": raw, "allergy": []}
    nums = sorted({int(x) for x in m.group(2).split(".") if x.strip().isdigit() and 1 <= int(x) <= 19})
    return {"name": m.group(1).strip(), "allergy": nums}


def meals(office, school, start, days=7, key="", offline=False):
    def one(d):
        rows, _ = call("mealServiceDietInfo", {"ATPT_OFCDC_SC_CODE": office, "SD_SCHUL_CODE": school, "MLSV_YMD": ymd(d)}, key, 10, offline)
        return rows

    ds = [start + timedelta(days=i) for i in range(days)]
    with ThreadPoolExecutor(max_workers=7) as ex:
        results = list(ex.map(one, ds))
    out = []
    for rows in results:
        for r in rows:
            dishes = [parse_dish(x) for x in re.split(r"<br\s*/?>", r.get("DDISH_NM") or "")]
            out.append({"date": iso(r["MLSV_YMD"]), "kind": r.get("MMEAL_SC_NM", ""), "dishes": [x for x in dishes if x["name"]][:14],
                        "cal": (r.get("CAL_INFO") or "").replace(" Kcal", "kcal").strip()})
    out.sort(key=lambda m: (m["date"], {"조식": 0, "중식": 1, "석식": 2}.get(m["kind"], 3)))
    return out


RICE = [("쌀밥", []), ("현미밥", []), ("흑미밥", []), ("기장밥", []), ("잡곡밥", []), ("카레라이스", [2, 5, 6, 10, 12]), ("김치볶음밥", [1, 5, 6, 9, 10])]
SOUP = [("미역국", [5, 6, 16]), ("된장찌개", [5, 6, 9]), ("어묵국", [1, 5, 6]), ("콩나물국", [5]), ("김치찌개", [5, 9, 10]),
        ("순두부찌개", [5, 9, 10, 18]), ("감자국", [5, 6]), ("소고기무국", [5, 6, 16]), ("유부장국", [5, 6])]
MAIN = [("고추장제육볶음", [5, 6, 10, 13]), ("닭갈비", [5, 6, 13, 15]), ("돈까스&소스", [1, 2, 5, 6, 10, 12]), ("고등어구이", [7]),
        ("소불고기", [5, 6, 13, 16]), ("치킨마요덮밥", [1, 5, 6, 15]), ("떡갈비", [5, 6, 10, 16]), ("오징어볶음", [5, 6, 13, 17]),
        ("닭볶음탕", [5, 6, 13, 15]), ("함박스테이크", [1, 2, 5, 6, 10, 12, 16])]
SIDE = [("시금치나물", [5]), ("계란말이", [1]), ("감자조림", [5, 6]), ("멸치볶음", [5, 6]), ("잡채", [5, 6, 10]), ("두부조림", [5, 6]),
        ("오이무침", [5, 6, 13]), ("어묵볶음", [1, 5, 6]), ("브로콜리숙회", []), ("떡볶이", [5, 6, 13]), ("콘샐러드", [1, 2, 5])]
KIMCHI = [("배추김치", [9]), ("깍두기", [9]), ("열무김치", [9]), ("총각김치", [9])]
DESSERT = [("요구르트", [2]), ("사과", []), ("귤", []), ("바나나", []), ("초코우유", [2]), ("식혜", []), ("수박", []), ("젤리", [])]


def sample_meals(start, days=7):
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        if d.weekday() >= 5:
            continue
        for kind, off in (("중식", 0), ("석식", 7)):
            h = int(hashlib.md5(f"{d}{kind}".encode()).hexdigest(), 16)
            pick = lambda pool, k: pool[(h >> (k * 5)) % len(pool)]  # noqa: E731
            items = [pick(RICE, 0), pick(SOUP, 1), pick(MAIN, 2), pick(SIDE, 3), pick(SIDE[::-1], 4), pick(KIMCHI, 5)]
            if kind == "중식":
                items.append(pick(DESSERT, 6))
            cal = 700 + (h % 260) - off * 10
            out.append({"date": d.isoformat(), "kind": kind, "dishes": [{"name": n, "allergy": a} for n, a in items], "cal": f"{cal}.{h % 10}kcal"})
    return out
