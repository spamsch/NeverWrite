import { expect, test } from "@playwright/test";

/**
 * Regression coverage for jsgrrchg/NeverWrite#102.
 *
 * Vitest pins the decoration-model cause (the trailing source space is not
 * collapsed for active empty list items). This spec pins the visual effect:
 * the caret must render at the line's content-box left, i.e. flush with the
 * pseudo-bullet + gap. If the trailing space leaks through, the caret lands
 * one character width past that point — exactly the artifact described in
 * the issue.
 */

type CaretMeasurement = {
    cursorLeft: number;
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
            contentBoxLeft: lineRect.left + paddingLeft,
        };
    }, lineSelector);
}

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

    const { cursorLeft, contentBoxLeft } = await measureCaret(
        page,
        ".cm-lp-li-line",
    );

    // The bullet pseudo-element ends at contentBoxLeft - marker-gap, so a
    // correctly-anchored caret renders right at contentBoxLeft. The bug
    // pushes the caret roughly one character width past that.
    expect(Math.abs(cursorLeft - contentBoxLeft)).toBeLessThan(2);
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

    const { cursorLeft, contentBoxLeft } = await measureCaret(
        page,
        ".cm-lp-li-line:nth-of-type(2)",
    );

    expect(Math.abs(cursorLeft - contentBoxLeft)).toBeLessThan(2);
});

test("non-empty list item: caret sits flush with content (control)", async ({
    page,
}) => {
    await page.evaluate(() => {
        window.mountEditor({ doc: "- abc", selection: 5 });
    });

    await page.waitForSelector(".cm-lp-li-line");
    await page.locator(".cm-content").focus();

    const { cursorLeft, contentBoxLeft } = await measureCaret(
        page,
        ".cm-lp-li-line",
    );

    // For a 3-character content "abc" the caret should be ~3ch past the
    // content-box left edge. Tolerance is generous; we just want to confirm
    // the measurement infra works for the happy path.
    expect(cursorLeft).toBeGreaterThan(contentBoxLeft);
});
