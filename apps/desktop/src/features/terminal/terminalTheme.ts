export interface TerminalTheme {
    background: string;
    panelBackground: string;
    border: string;
    text: string;
    mutedText: string;
    accent: string;
    cursor: string;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    // ANSI 16-color palette
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
    // Selection and scrollbar
    selectionBackground: string;
    scrollbarSliderBackground: string;
    scrollbarSliderHoverBackground: string;
    scrollbarSliderActiveBackground: string;
}

const FALLBACK_FONT_STACK =
    '"SFMono-Regular", "Cascadia Code", "JetBrains Mono", Menlo, Monaco, Consolas, monospace';

export function getTerminalTheme(
    element: HTMLElement | null,
    opts?: { fontFamily?: string; fontSize?: number },
): TerminalTheme {
    const computed = window.getComputedStyle(
        element ?? document.documentElement,
    );
    const v = (name: string) => computed.getPropertyValue(name).trim();

    return {
        background: v("--bg-primary"),
        panelBackground: v("--bg-secondary"),
        border: v("--border"),
        text: v("--text-primary"),
        mutedText: v("--text-secondary"),
        accent: v("--accent"),
        cursor: v("--accent"),
        fontFamily: opts?.fontFamily?.trim() || FALLBACK_FONT_STACK,
        fontSize: opts?.fontSize ?? 13,
        lineHeight: 1.4,
        // ANSI palette derived from Catppuccin icon tokens (defined for both
        // light and dark themes) — gives consistent, intentional colours.
        black: v("--bg-secondary"),
        red: v("--catppuccin-icon-red"),
        green: v("--catppuccin-icon-green"),
        yellow: v("--catppuccin-icon-yellow"),
        blue: v("--catppuccin-icon-blue"),
        magenta: v("--catppuccin-icon-mauve"),
        cyan: v("--catppuccin-icon-teal"),
        white: v("--text-primary"),
        brightBlack: v("--text-secondary"),
        brightRed: v("--catppuccin-icon-maroon"),
        brightGreen: v("--catppuccin-icon-green"),
        brightYellow: v("--catppuccin-icon-peach"),
        brightBlue: v("--catppuccin-icon-lavender"),
        brightMagenta: v("--catppuccin-icon-pink"),
        brightCyan: v("--catppuccin-icon-sky"),
        brightWhite: v("--text-heading"),
        selectionBackground: v("--highlight-bg"),
        scrollbarSliderBackground: v("--scrollbar-thumb-active"),
        scrollbarSliderHoverBackground: v("--scrollbar-thumb-hover"),
        scrollbarSliderActiveBackground: v("--scrollbar-thumb-active"),
    };
}
