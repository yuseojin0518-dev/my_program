"""화면 시험 (진짜 브라우저 두 개 = 학생 두 명): python tests/ui_smoke.py [주소]
- 체험 반으로 들어가서 모든 탭을 열고 자바스크립트 오류가 없는지
- 실시간: A가 일정을 추가하면 B 달력에 바로, A가 노트에 쓰면 B 노트에 바로, 동시에 쓰면 둘 다 같은 글
스크린샷은 tests/shots/
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000"
SHOTS = os.path.join(os.path.dirname(__file__), "shots")
os.makedirs(SHOTS, exist_ok=True)
errors = []


def new_student(b, w, h, role="student", name=None):
    ctx = b.new_context(viewport={"width": w, "height": h}, locale="ko-KR", timezone_id="Asia/Seoul")
    p = ctx.new_page()
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "favicon" not in m.text else None)
    p.goto(BASE + "/")
    p.click("text=체험 선생님으로 들어가기" if role == "teacher" else "text=체험 반으로 바로 들어가기")
    p.wait_for_selector(".cal .grid")
    if name:  # 체험 반에 이름을 가진 학생으로 (같은 이름이면 늘 같은 계정)
        p.evaluate("""n => fetch('/api/login/quick', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-ES': '1'},
            body: JSON.stringify({name: n, school: {office: 'K10', code: '7801185', name: '춘천고등학교'}, grade: 2, classNum: 1})})""", name)
        p.reload()
        p.wait_for_selector(".cal .grid")
    p.wait_for_selector(".live.on", state="attached", timeout=8000)
    return p


with sync_playwright() as pw:
    b = pw.chromium.launch()
    a = new_student(b, 1440, 900, name="시험 학생A")
    m = new_student(b, 390, 844, name="시험 학생B")
    a.wait_for_timeout(800)
    a.screenshot(path=f"{SHOTS}/pc-calendar.png", full_page=True)
    m.screenshot(path=f"{SHOTS}/phone-calendar.png", full_page=True)

    # 1) 일정 추가 → 다른 학생 달력에 바로
    a.click(".page-h >> text=＋ 일정 추가")
    a.fill("#ef-title", "실시간 시험 일정")
    a.click("button[type=submit]")
    a.wait_for_selector("#drawer.open .dr-title >> text=실시간 시험 일정")
    a.screenshot(path=f"{SHOTS}/pc-event.png")
    m.wait_for_function("() => document.body.innerText.includes('실시간 시험 일정')", timeout=8000)
    print("일정 실시간: OK")
    a.click("#drawer [data-act=closeDrawer]")

    # 2) 클래스룸: 학생 A가 과제를 내면 → 선생님이 채점·반환 → A 화면에 점수
    t = new_student(b, 1280, 860, role="teacher")
    a.click("#side [data-to=class]")
    a.wait_for_selector(".todo-card")
    a.wait_for_timeout(900)
    a.screenshot(path=f"{SHOTS}/pc-class.png", full_page=True)
    a.click(".ccard >> text=통합과학")
    a.wait_for_selector(".banner")
    a.wait_for_timeout(600)
    a.screenshot(path=f"{SHOTS}/pc-stream.png", full_page=True)
    a.click(".ctabs >> text=수업 과제")
    a.click(".cw-row >> text=산화 환원 실험 보고서")
    a.wait_for_selector(".mywork")
    if a.locator("[data-act=unsubmit]").count():  # 지난번 시험에서 낸 것 → 취소하고 다시
        a.click("[data-act=unsubmit]")
        a.click("#modal [data-r='1']")
        a.wait_for_selector("[data-act=submitWork]")
    a.set_input_files("[data-ch=drPick]", {"name": "보고서.txt", "mimeType": "text/plain", "buffer": "실험 결과".encode()})
    a.wait_for_selector(".mywork >> text=보고서.txt")
    a.click("[data-act=submitWork]")
    a.wait_for_selector(".mywork .st-ok")
    a.screenshot(path=f"{SHOTS}/pc-submit.png", full_page=True)
    print("과제 제출: OK")
    t.click("#side [data-to=class]")
    t.click(".ccard >> text=통합과학")
    t.click(".ctabs >> text=수업 과제")
    t.click(".cw-row >> text=산화 환원 실험 보고서")
    t.wait_for_selector(".sub-list")
    me = a.evaluate("App.me.name")
    row = t.locator(".sub-list li", has_text=me)
    row.locator("input[type=number]").fill("18")
    row.locator("input[type=number]").press("Tab")
    t.wait_for_timeout(400)
    row.locator("input[type=checkbox]").check()
    t.click("[data-act=returnSel]")
    t.wait_for_selector("text=돌려줬어요")
    t.screenshot(path=f"{SHOTS}/pc-teacher.png", full_page=True)
    a.wait_for_selector(".grade-big >> text=18", timeout=8000)
    print("채점·반환 실시간: OK")

    # 3) 문서함
    a.click("#side [data-to=docs]")
    a.click(".subj-card >> text=영어")
    a.wait_for_selector(".table .tr:not(.th)")
    a.locator(".td.name").first.click()
    a.wait_for_selector("#drawer.open .vers")
    a.screenshot(path=f"{SHOTS}/pc-docs.png")
    a.click("#drawer [data-act=closeDrawer]")

    # 4) 공유 노트: 같은 노트를 열고, A가 가운데에 글상자를 넣으면 B 화면에도
    a.click("#side [data-to=notes]")
    a.click(".subj-card >> text=수학")
    a.click(".nl >> text=미적분 개념 정리")
    a.wait_for_selector(".ink-page canvas.base")
    m.goto(a.url)
    m.wait_for_selector(".ink-page canvas.base")
    m.wait_for_timeout(600)
    a.wait_for_function("() => document.querySelectorAll('#nt-people .pp').length >= 2")  # 함께 보는 사람 표시
    a.click("[data-act=inkAddText]")
    a.wait_for_selector(".ink-text")
    a.keyboard.type("A가 넣은 글상자 입니다", delay=10)
    a.keyboard.press("Control+Enter")
    m.wait_for_function("() => Array.from(Ink.st.strokes.values()).some(x => x.tool === 'text' && x.text.includes('A가 넣은 글상자'))", timeout=8000)
    print("글상자 실시간: OK")
    # 펜 종류 (네온펜)
    a.click("[data-act=inkTool][data-v=pen]")
    a.click("[data-act=inkPen][data-v=neon]")
    a.wait_for_timeout(200)
    a.screenshot(path=f"{SHOTS}/pc-pens.png")
    a.click("[data-act=inkPen][data-v=ball]")
    before = m.evaluate("Ink.st.strokes.size")
    box = a.locator(".ink-page").first.bounding_box()
    a.mouse.move(box["x"] + 120, box["y"] + 160)
    a.mouse.down()
    for i in range(25):
        a.mouse.move(box["x"] + 120 + i * 12, box["y"] + 160 + (i % 5) * 8, steps=2)
    a.mouse.up()
    m.wait_for_function(f"() => Ink.st.strokes.size > {before} && Array.from(Ink.st.strokes.values()).some(x => x.id)", timeout=8000)
    print("손필기 실시간: OK")
    a.wait_for_function("() => Array.from(Ink.st.strokes.values()).every(x => x.id)")  # 내 획 저장 끝
    new_id = a.evaluate("Math.max(...Array.from(Ink.st.strokes.values()).map(x => x.id))")
    a.click("[data-act=inkTool][data-v=eraser]")
    a.mouse.move(box["x"] + 200, box["y"] + 170)
    a.mouse.down(); a.mouse.move(box["x"] + 330, box["y"] + 180, steps=10); a.mouse.up()
    m.wait_for_function(f"() => !Ink.st.strokes.has({new_id})", timeout=8000)
    print("지우개 실시간: OK")
    a.wait_for_function("() => !Ink.st.undo.length || !document.querySelector('[data-act=inkUndo]').disabled")
    a.click("[data-act=inkUndo]")
    m.wait_for_function(f"() => Array.from(Ink.st.strokes.values()).filter(x => x.id).length >= 1", timeout=8000)
    # 새 페이지(수학 노트) → 친구 화면에도 쪽이 생긴다
    pages = m.evaluate("Ink.st.layout.length")
    a.click(".ink-add >> text=새 페이지")
    a.click(".tpl >> text=수학")
    m.wait_for_function(f"() => Ink.st.layout.length === {pages} + 1", timeout=8000)
    print("쪽 추가 실시간: OK")
    a.evaluate(f"fetch('/api/notes/' + Ink.st.id + '/pages', {{method: 'POST', headers: {{'Content-Type': 'application/json', 'X-ES': '1'}}, body: JSON.stringify({{action: 'remove', at: {pages}}})}})")
    # 도형 → 올가미로 옮기기
    a.wait_for_timeout(900)  # 새 쪽으로 부드럽게 넘어가는 것이 끝날 때까지
    a.evaluate("document.querySelector('#ink-scroll').scrollTop = 0")
    a.wait_for_timeout(200)
    box = a.locator(".ink-page").first.bounding_box()
    a.click("[data-act=inkTool][data-v=shape]")
    a.click("[data-act=inkShape][data-v=ellipse]")
    a.mouse.move(box["x"] + 300, box["y"] + 300); a.mouse.down(); a.mouse.move(box["x"] + 420, box["y"] + 380, steps=8); a.mouse.up()
    a.wait_for_function("() => Array.from(Ink.st.strokes.values()).some(x => x.shape && x.id)")
    a.click("[data-act=inkTool][data-v=lasso]")
    a.mouse.move(box["x"] + 280, box["y"] + 280); a.mouse.down()
    for x, y in [(440, 280), (440, 400), (280, 400), (280, 285)]:
        a.mouse.move(box["x"] + x, box["y"] + y, steps=4)
    a.mouse.up()
    a.wait_for_selector(".sel-bar")
    a.mouse.move(box["x"] + 360, box["y"] + 340); a.mouse.down(); a.mouse.move(box["x"] + 560, box["y"] + 500, steps=8); a.mouse.up()
    m.wait_for_function("() => Array.from(Ink.st.strokes.values()).some(x => x.shape && x.box[0] > 400)", timeout=8000)
    print("올가미로 옮기기 실시간: OK")
    a.screenshot(path=f"{SHOTS}/pc-ink.png")
    a.click("[data-act=inkSelDone]")
    a.click("[data-act=inkTool][data-v=pen]")
    m.screenshot(path=f"{SHOTS}/phone-ink.png")

    # 6) 공부 타이머: A가 시작하면 B 순위에 '공부 중'
    a.click("#side [data-to=study]")
    m.goto(BASE + "/#/study")
    m.wait_for_selector(".timer-card")
    a.wait_for_selector(".timer-card")
    if a.locator("[data-act=stStop]").count():
        a.click("[data-act=stStop]")
    a.click(".sp >> text=수학")
    a.click("[data-act=stStart]")
    a.wait_for_selector(".timer-card.running")
    m.wait_for_selector(".rank li:has-text('시험 학생A') .rm small.on", timeout=8000)
    print("공부 타이머 실시간: OK")
    a.wait_for_timeout(1500)
    a.screenshot(path=f"{SHOTS}/pc-study.png", full_page=True)
    m.screenshot(path=f"{SHOTS}/phone-study.png", full_page=True)
    a.click("[data-act=stStop]")
    a.wait_for_selector(".timer-card:not(.running)")

    # 5) 다른 반은 보기만
    a.click("#side .class-switch")
    a.click(".switcher-pop [data-c='2']")
    a.wait_for_selector(".ro-banner")
    a.click(".ro-banner [data-act=myClass]")
    a.wait_for_selector(".ro-banner", state="detached")
    b.close()

# 시험이 체험 반에 남긴 것 지우기 (일정·댓글·획·글상자)
import sqlite3  # noqa: E402
_c = sqlite3.connect(os.path.join(os.path.dirname(__file__), "..", "app.db"))
_ids = [r[0] for r in _c.execute("SELECT id FROM es_users WHERE name LIKE '시험 학생%'")]
if _ids:
    _q = ",".join("?" * len(_ids))
    _c.execute(f"DELETE FROM es_ink WHERE author_id IN ({_q})", _ids)
    _c.execute(f"DELETE FROM es_study WHERE user_id IN ({_q})", _ids)
_c.execute("DELETE FROM es_events WHERE title = '실시간 시험 일정'")
_c.execute("DELETE FROM es_comments WHERE text = '실시간 댓글 시험'")
_c.commit()
_c.close()
print("errors:", len(errors))
for e in errors:
    print("  ", e)
sys.exit(1 if errors else 0)
