import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MarkdownNoteHeader,
    type MarkdownNoteHeaderProps,
} from "./MarkdownNoteHeader";
import { useVaultStore } from "../../app/store/vaultStore";

function renderWith(overrides: Partial<MarkdownNoteHeaderProps> = {}) {
    const props: MarkdownNoteHeaderProps = {
        editableTitle: "Example note",
        lineWrapping: true,
        onTitleChange: () => {},
        titleInputRef: { current: null },
        locationParent: "Notes",
        frontmatterRaw: null,
        onFrontmatterChange: vi.fn(),
        propertiesExpanded: false,
        onToggleProperties: vi.fn(),
        onSearchClick: vi.fn(),
        ...overrides,
    };
    render(<MarkdownNoteHeader {...props} />);
    return props;
}

function renderHeader(lineWrapping: boolean) {
    render(
        <MarkdownNoteHeader
            editableTitle="Example note"
            lineWrapping={lineWrapping}
            onTitleChange={() => {}}
            titleInputRef={{ current: null }}
            locationParent="Notes"
            frontmatterRaw={null}
            onFrontmatterChange={() => {}}
            propertiesExpanded={false}
            onToggleProperties={vi.fn()}
            onSearchClick={vi.fn()}
        />,
    );

    return {
        outer: document.querySelector(
            '[data-editor-note-header="true"]',
        ) as HTMLElement | null,
        inner: document.querySelector(
            '[data-editor-note-header-inner="true"]',
        ) as HTMLElement | null,
    };
}

describe("MarkdownNoteHeader", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("keeps the centered reading layout when line wrapping is enabled", () => {
        const { outer, inner } = renderHeader(true);
        expect(outer).not.toBeNull();
        expect(inner).not.toBeNull();
        expect(outer).toHaveAttribute("data-line-wrapping", "true");
        expect(outer).toHaveStyle({
            width: "100%",
            padding: "40px var(--editor-horizontal-inset) 0",
        });
        expect(inner).toHaveStyle({
            width: "min(100%, var(--editor-content-width))",
            maxWidth: "var(--editor-content-width)",
            margin: "0 auto",
            minWidth: "0",
        });
        expect(screen.getByDisplayValue("Example note")).toBeInTheDocument();
    });

    it("switches to a left-aligned layout when line wrapping is disabled", () => {
        const { outer, inner } = renderHeader(false);
        expect(outer).not.toBeNull();
        expect(inner).not.toBeNull();
        expect(outer).toHaveAttribute("data-line-wrapping", "false");
        expect(outer).toHaveStyle({
            width: "100%",
            padding: "40px var(--editor-horizontal-inset) 0",
        });
        expect(inner).toHaveStyle({
            width: "100%",
            maxWidth: "none",
            margin: "0px",
            minWidth: "0",
        });
    });

    it("allows the secondary toolbar actions to wrap instead of collapsing the header width", () => {
        renderHeader(true);

        const propertiesButton = screen.getByRole("button", {
            name: "Properties",
        });
        const toolbar = propertiesButton.parentElement;

        expect(toolbar).not.toBeNull();
        expect(toolbar).toHaveStyle({
            display: "flex",
            flexWrap: "wrap",
            minWidth: "0",
        });
    });

    it("recalculates the title height when the available width changes", async () => {
        let resizeCallback: ResizeObserverCallback | null = null;
        const originalResizeObserver = globalThis.ResizeObserver;
        const originalFonts = document.fonts;
        const originalScrollHeight = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "scrollHeight",
        );
        let currentScrollHeight = 78;

        class MockResizeObserver {
            constructor(callback: ResizeObserverCallback) {
                resizeCallback = callback;
            }

            observe() {}
            unobserve() {}
            disconnect() {}
        }

        try {
            Object.defineProperty(globalThis, "ResizeObserver", {
                configurable: true,
                writable: true,
                value: MockResizeObserver,
            });
            Object.defineProperty(document, "fonts", {
                configurable: true,
                value: {
                    ready: Promise.resolve(),
                },
            });
            Object.defineProperty(
                HTMLTextAreaElement.prototype,
                "scrollHeight",
                {
                    configurable: true,
                    get: () => currentScrollHeight,
                },
            );

            renderHeader(true);

            const titleInput = screen.getByDisplayValue(
                "Example note",
            ) as HTMLTextAreaElement;

            await waitFor(() => {
                expect(titleInput.style.height).toBe("78px");
            });

            currentScrollHeight = 42;

            await act(async () => {
                resizeCallback?.(
                    [
                        {
                            contentRect: {
                                width: 640,
                                height: 0,
                                x: 0,
                                y: 0,
                                top: 0,
                                right: 640,
                                bottom: 0,
                                left: 0,
                                toJSON: () => ({}),
                            },
                        } as ResizeObserverEntry,
                    ],
                    {} as ResizeObserver,
                );
                await new Promise((resolve) => setTimeout(resolve, 0));
            });

            expect(titleInput.style.height).toBe("42px");
        } finally {
            Object.defineProperty(globalThis, "ResizeObserver", {
                configurable: true,
                writable: true,
                value: originalResizeObserver,
            });
            Object.defineProperty(document, "fonts", {
                configurable: true,
                value: originalFonts,
            });
            if (originalScrollHeight) {
                Object.defineProperty(
                    HTMLTextAreaElement.prototype,
                    "scrollHeight",
                    originalScrollHeight,
                );
            } else {
                delete (
                    HTMLTextAreaElement.prototype as unknown as Record<
                        string,
                        unknown
                    >
                ).scrollHeight;
            }
        }
    });
});

const fm = (body: string) => `---\n${body}\n---\n`;

describe("MarkdownNoteHeader — OKF status", () => {
    // Earlier tests in this file leave `document.fonts` defined-but-undefined,
    // which makes EditableNoteTitle's `document.fonts.ready` throw. Ensure a
    // usable stub so these renders don't crash on that unrelated effect.
    beforeEach(() => {
        Object.defineProperty(document, "fonts", {
            configurable: true,
            value: { ready: Promise.resolve() },
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders a status badge for each canonical status", () => {
        const cases: Array<[string, string]> = [
            ["draft", "Draft"],
            ["in_review", "In review"],
            ["published", "Published"],
            ["deprecated", "Deprecated"],
            ["archived", "Archived"],
        ];
        for (const [raw, label] of cases) {
            const { unmount } = render(
                <MarkdownNoteHeader
                    editableTitle="Example note"
                    lineWrapping
                    onTitleChange={() => {}}
                    titleInputRef={{ current: null }}
                    locationParent="Notes"
                    frontmatterRaw={fm(`status: ${raw}`)}
                    onFrontmatterChange={vi.fn()}
                    propertiesExpanded={false}
                    onToggleProperties={vi.fn()}
                    onSearchClick={vi.fn()}
                />,
            );
            expect(
                screen.getByRole("button", { name: label }),
            ).toBeInTheDocument();
            unmount();
        }
    });

    it("shows a subtle 'Set status' affordance and no banner when status is absent", () => {
        renderWith({ frontmatterRaw: null });
        expect(
            screen.getByRole("button", { name: "Set status" }),
        ).toBeInTheDocument();
        expect(document.querySelector("[data-status-banner]")).toBeNull();
        expect(
            screen.queryByRole("button", { name: "Draft" }),
        ).not.toBeInTheDocument();
    });

    it("renders a type badge showing the raw type value", () => {
        renderWith({ frontmatterRaw: fm("type: runbook") });
        expect(screen.getByText("runbook")).toBeInTheDocument();
    });

    it.each([
        ["draft", "Draft — this document has not been published."],
        ["in_review", "In review — content may change before publication."],
        ["deprecated", "Deprecated — this document is outdated."],
        ["archived", "Archived — kept for reference only."],
    ])("renders the trust banner for %s", (raw, copy) => {
        renderWith({ frontmatterRaw: fm(`status: ${raw}`) });
        const banner = document.querySelector("[data-status-banner]");
        expect(banner).not.toBeNull();
        expect(banner).toHaveTextContent(copy);
    });

    it("renders no banner for published", () => {
        renderWith({ frontmatterRaw: fm("status: published") });
        expect(document.querySelector("[data-status-banner]")).toBeNull();
    });

    it("shows an unknown status verbatim with no banner", () => {
        renderWith({ frontmatterRaw: fm("status: needs work") });
        expect(
            screen.getByRole("button", { name: "needs work" }),
        ).toBeInTheDocument();
        expect(document.querySelector("[data-status-banner]")).toBeNull();
    });

    it("updates the status via the dropdown while preserving other keys and order", async () => {
        const props = renderWith({
            frontmatterRaw: fm("title: Hello\nstatus: draft\ntype: note"),
        });

        fireEvent.click(screen.getByRole("button", { name: "Draft" }));
        fireEvent.click(screen.getByRole("button", { name: "Published" }));

        await waitFor(() =>
            expect(props.onFrontmatterChange).toHaveBeenCalled(),
        );
        const next = (props.onFrontmatterChange as ReturnType<typeof vi.fn>).mock
            .calls[0][0] as string;
        expect(next).toContain("title: Hello");
        expect(next).toContain("status: published");
        expect(next).toContain("type: note");
        // Order preserved: title before status before type.
        expect(next.indexOf("title")).toBeLessThan(next.indexOf("status"));
        expect(next.indexOf("status")).toBeLessThan(next.indexOf("type"));
    });

    it("removes the status key when 'No status' is chosen", async () => {
        const props = renderWith({
            frontmatterRaw: fm("title: Hello\nstatus: draft"),
        });

        fireEvent.click(screen.getByRole("button", { name: "Draft" }));
        fireEvent.click(screen.getByRole("button", { name: "No status" }));

        await waitFor(() =>
            expect(props.onFrontmatterChange).toHaveBeenCalled(),
        );
        const next = (props.onFrontmatterChange as ReturnType<typeof vi.fn>).mock
            .calls[0][0] as string;
        expect(next).toContain("title: Hello");
        expect(next).not.toContain("status:");
    });

    it("adds a status when none exists via 'Set status'", async () => {
        const props = renderWith({ frontmatterRaw: fm("title: Hello") });

        fireEvent.click(screen.getByRole("button", { name: "Set status" }));
        fireEvent.click(screen.getByRole("button", { name: "In review" }));

        await waitFor(() =>
            expect(props.onFrontmatterChange).toHaveBeenCalled(),
        );
        const next = (props.onFrontmatterChange as ReturnType<typeof vi.fn>).mock
            .calls[0][0] as string;
        expect(next).toContain("title: Hello");
        expect(next).toContain("status: in_review");
    });
});

describe("MarkdownNoteHeader — OKF conformance hint", () => {
    beforeEach(() => {
        Object.defineProperty(document, "fonts", {
            configurable: true,
            value: { ready: Promise.resolve() },
        });
    });

    afterEach(() => {
        useVaultStore.setState({ okfVersion: null });
        vi.restoreAllMocks();
    });

    it("shows the hint when the vault is OKF and the note has no type", () => {
        useVaultStore.setState({ okfVersion: "0.1.0" });
        renderWith({ frontmatterRaw: fm("title: Hello") });
        expect(
            screen.getByRole("button", { name: "No OKF type" }),
        ).toBeInTheDocument();
    });

    it("hides the hint when the note already has a type", () => {
        useVaultStore.setState({ okfVersion: "0.1.0" });
        renderWith({ frontmatterRaw: fm("type: runbook") });
        expect(
            screen.queryByRole("button", { name: "No OKF type" }),
        ).not.toBeInTheDocument();
    });

    it("hides the hint when the vault is not an OKF vault", () => {
        useVaultStore.setState({ okfVersion: null });
        renderWith({ frontmatterRaw: fm("title: Hello") });
        expect(
            screen.queryByRole("button", { name: "No OKF type" }),
        ).not.toBeInTheDocument();
    });

    it("opens the Properties panel when the hint is clicked", () => {
        useVaultStore.setState({ okfVersion: "0.1.0" });
        const props = renderWith({
            frontmatterRaw: fm("title: Hello"),
            propertiesExpanded: false,
        });
        fireEvent.click(screen.getByRole("button", { name: "No OKF type" }));
        expect(props.onToggleProperties).toHaveBeenCalledTimes(1);
    });
});
