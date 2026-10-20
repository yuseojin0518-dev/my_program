"""화면 시험 (진짜 브라우저): 체험 모드로 모든 화면을 열고 자바스크립트 오류가 없는지, 핵심 동작이 되는지 본다.
실행: python tests/ui_smoke.py [주소]   (기본 http://localhost:5000)  · 스크린샷은 tests/shots/ 에 저장
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000"
SHOTS = os.path.join(os.path.dirname(__file__), "shots")
os.makedirs(SHOTS, exist_ok=True)


def run(width, height, tag):
    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": width, "height": height}, locale="ko-KR", timezone_id="Asia/Seoul")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
        page.goto(BASE + "/?today=2026-10-14")
        page.wait_for_selector("text=체험 학생으로 둘러보기")
        page.screenshot(path=f"{SHOTS}/{tag}-0-start.png", full_page=True)
        page.click("text=체험 학생으로 둘러보기")
        page.wait_for_selector(".kpis")
        page.wait_for_timeout(600)
        page.screenshot(path=f"{SHOTS}/{tag}-1-home.png", full_page=True)
        assert page.locator(".banner").first.is_visible(), "자동 재조정 알림이 보여야 한다"
        # 한 화면 한 질문: 계획 밖 공부 기록 (과목 → 시간 → 끝 화면)
        page.click("text=+ 기록하기")
        page.locator(".fl-opt").first.click()
        page.wait_for_selector("[data-act=timePick]")
        page.screenshot(path=f"{SHOTS}/{tag}-flow.png")
        page.click("[data-act=flowNext]")
        page.wait_for_selector(".fl-done")
        page.wait_for_timeout(700)
        page.screenshot(path=f"{SHOTS}/{tag}-flow-done.png")
        page.click("[data-act=flowClose]")
        page.wait_for_timeout(300)
        # 오늘 할 일 하나 완료
        page.locator(".todo-check").first.click()
        page.wait_for_timeout(200)
        assert page.locator(".todo-it.done").count() >= 1
        for tab in ["path", "grades", "plan", "report"]:
            page.click(f"#nav [data-tab={tab}]")
            page.wait_for_timeout(500)
            if tab == "path":
                page.click("text=조합 찾기")
                page.wait_for_selector(".combo", timeout=8000)
            if tab == "grades":
                page.locator(".subj-h").first.click()
                page.wait_for_selector(".whatif")
                s = page.locator("[data-in=wiScore]").first
                s.fill("95")
                page.wait_for_timeout(200)
            page.screenshot(path=f"{SHOTS}/{tag}-{tab}.png", full_page=True)
        # 하루 넘기기 → 자동 재조정
        page.click("#nav [data-tab=home]")
        page.click("text=하루 넘기기")
        page.wait_for_timeout(400)
        page.screenshot(path=f"{SHOTS}/{tag}-2-nextday.png", full_page=True)
        # 처음 시작 흐름 (학교 없이)
        page2 = ctx.new_page()
        page2.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page2.goto(BASE + "/?today=2026-10-14")
        page2.evaluate("localStorage.removeItem('pw.state.v1')")
        page2.reload()
        page2.click("text=30초 만에 내 계획 만들기")
        page2.click(".fl-opt >> text=AI·컴퓨터공학")
        page2.click("[data-act=flowSkip]")
        page2.click(".fl-opt >> text=2학년")
        page2.click("[data-act=flowSkip]")
        page2.click("[data-act=wizSub] >> text=미적분Ⅰ")
        page2.click("[data-act=wizSub] >> text=영어Ⅱ")
        page2.screenshot(path=f"{SHOTS}/{tag}-wiz.png")
        page2.click("[data-act=flowNext]")
        page2.fill("#wiz-date", "2026-12-07")
        page2.click("[data-act=flowNext]")
        page2.click(".fl-opt >> text=2시간")
        page2.click(".fl-opt >> text=5시간")
        page2.wait_for_selector("text=첫 계획이")
        page2.wait_for_timeout(700)
        page2.screenshot(path=f"{SHOTS}/{tag}-wiz-done.png")
        page2.click("[data-act=flowClose]")
        page2.wait_for_selector(".hero-head")
        b.close()
    return errors


if __name__ == "__main__":
    all_err = []
    for w, h, t in [(390, 844, "phone"), (1280, 860, "pc")]:
        e = run(w, h, t)
        print(t, "errors:", len(e))
        for x in e:
            print("  ", x)
        all_err += e
    sys.exit(1 if all_err else 0)
