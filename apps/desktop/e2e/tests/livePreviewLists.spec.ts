import { expect, test } from "@playwright/test";

/**
 * Regression coverage for jsgrrchg/NeverWrite#102.
 *
 * Two visual properties must hold for an active empty list item:
 *
 *   1. Horizontal: the caret sits at the line's content-box left edge
 *      (flush with the rendered pseudo-bullet + gap). If the trailing
 *      source space leaks through, the caret drifts ~1ch past that.
 *
 *   2. Vertical / visibility: the caret has a non-zero rect. If the
 *      line's source content is fully collapsed to font-size: 0 hidden
 *      spans, the native caret's getClientRects() reports a 0x0 rect
 *      and the caret is invisible — the secondary artifact reported by
 *      @jsgrrchg when collapsing the trailing space without anchoring
 *      the caret to a real editable glyph.
 *
 * Both assertions together catch:
 *   - main today: caret is visible but ~9.6 px past content-box left.
 *   - "collapse the full prefix" attempt: caret is at the right x but
 *     has 0 height/width.
 */

type CaretMeasurement = {
    cursorLeft: number;
    cursorWidth: number;
    cursorHeight: number;
    contentBoxLeft: number;
};

async function measureCaret(
    page: import("@playwright/test").Page,
    lineSelector: string,
): Promise<CaretMeasurement> {
    return page.evaluate((selector) => {
        const line = document.querySelector(selector) as HTMLElement | null;
        if (!line) throw new Error(`line not found: ${selector}`);

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            throw new Error("no selection — editor is not focused");
        }
        const range = selection.getRangeAt(0).cloneRange();
        range.collapse(true);
        const rects = range.getClientRects();
        const caretRect = rects[0] ?? range.getBoundingClientRect();

        const lineRect = line.getBoundingClientRect();
        const paddingLeft = parseFloat(
            window.getComputedStyle(line).paddingLeft,
        );

        return {
            cursorLeft: caretRect.left,
            cursorWidth: caretRect.width,
            cursorHeight: caretRect.height,
            contentBoxLeft: lineRect.left + paddingLeft,
        };
    }, lineSelector);
}

const MIN_CARET_HEIGHT_PX = 10; // anything below this is effectively invisible

test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(
        () => typeof (window as unknown as { mountEditor?: unknown })
                .mountEditor === "function",
    );
});

test("active empty top-level list item: caret sits flush with the bullet (#102)", async ({
    page,
}) => {
    await page.evaluate(() => {
        window.mountEditor({ doc: "- ", selection: 2 });
    });

    await page.waitForSelector(".cm-lp-li-line");
    await page.locator(".cm-content").focus();

    const { cursorLeft, cursorHeight, contentBoxLeft } = await measureCaret(
        page,
        ".cm-lp-li-line",
    );

    expect(Math.abs(cursorLeft - contentBoxLeft)).toBeLessThan(2);
    expect(cursorHeight).toBeGreaterThanOrEqual(MIN_CARET_HEIGHT_PX);
});

test("active empty nested list item: caret sits flush with the bullet (#102)", async ({
    page,
}) => {
    await page.evaluate(() => {
        window.mountEditor({ doc: "- parent\n    - ", selection: 15 });
    });

    await page.waitForSelector(".cm-lp-li-line");
    await page.locator(".cm-content").focus();

    const lineCount = await page.locator(".cm-lp-li-line").count();
    expect(lineCount).toBeGreaterThanOrEqual(2);

    const { cursorLeft, cursorHeight, contentBoxLeft } = await measureCaret(
        page,
        ".cm-lp-li-line:nth-of-type(2)",
    );

    expect(Math.abs(cursorLeft - contentBoxLeft)).toBeLessThan(2);
    expect(cursorHeight).toBeGreaterThanOrEqual(MIN_CARET_HEIGHT_PX);
});

test("non-empty list item: caret sits flush with content (control)", async ({
    page,
}) => {
    await page.evaluate(() => {
        window.mountEditor({ doc: "- abc", selection: 5 });
    });

    await page.waitForSelector(".cm-lp-li-line");
    await page.locator(".cm-content").focus();

    const { cursorLeft, cursorHeight, contentBoxLeft } = await measureCaret(
        page,
        ".cm-lp-li-line",
    );

    // For a 3-character content "abc" the caret should be past the content-box
    // left edge. Tolerance is generous; we just want to confirm the
    // measurement infra works for the happy path.
    expect(cursorLeft).toBeGreaterThan(contentBoxLeft);
    expect(cursorHeight).toBeGreaterThanOrEqual(MIN_CARET_HEIGHT_PX);
});
