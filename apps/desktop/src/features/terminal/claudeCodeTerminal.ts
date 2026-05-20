import { invoke } from "../../app/runtime";
import {
    selectEditorWorkspaceTabs,
    useEditorStore,
} from "../../app/store/editorStore";
import { isTerminalTab } from "../../app/store/editorTabs";
import { useSettingsStore } from "../../app/store/settingsStore";
import { useVaultStore } from "../../app/store/vaultStore";
import type { FileTreeNoteDragDetail } from "../ai/dragEvents";
import { useTerminalRuntimeStore } from "./terminalRuntimeStore";

export async function checkClaudeCodeInstalled(): Promise<boolean> {
    try {
        const result = await invoke<{ found: boolean }>(
            "devtools_check_binary",
            { name: "claude" },
        );
        return result.found;
    } catch {
        return false;
    }
}

// Milliseconds to wait for the terminal PTY to reach "running" state.
const TERMINAL_READY_TIMEOUT_MS = 10_000;
// Milliseconds to wait for Claude Code's TUI to initialise before pre-filling.
const CLAUDE_TUI_SETTLE_MS = 2_000;

// Wrap a path in double quotes if it contains spaces so Claude Code's
// @mention parser doesn't split it at the first space.
function quoteForMention(path: string): string {
    return path.includes(" ") ? `"${path}"` : path;
}

function buildContextArgs(detail: FileTreeNoteDragDetail): string {
    // Notes and files only — folders aren't dereferenceable as file context.
    // detail.folder and detail.folders refer to the same entry; skip both to
    // avoid duplication (the cd already scopes the session to the folder).
    const paths: string[] = [
        ...detail.notes.map((n) => n.path),
        ...(detail.files ?? []).map((f) => f.filePath),
    ];
    return paths.map((p) => `@${quoteForMention(p)}`).join(" ");
}

// Determine the best directory to cd into for the given context.
// If exactly one folder is attached, cd into it; otherwise cd to vault root.
// Folder paths in the detail are vault-relative, so we join with vaultPath.
function resolveCdTarget(
    detail: FileTreeNoteDragDetail | undefined,
    vaultPath: string | null,
): string | null {
    // detail.folder is set only when exactly one folder is selected (see
    // FileTree.tsx handleAddChatTargetsToChat). detail.folders contains the
    // same entry — use the singular to avoid double-counting.
    if (detail?.folder && vaultPath) {
        return `${vaultPath}/${detail.folder.path}`;
    }
    return vaultPath;
}

function waitForTerminalRunning(terminalId: string): Promise<boolean> {
    return new Promise((resolve) => {
        let intervalId: ReturnType<typeof setInterval>;

        const timeoutId = setTimeout(() => {
            clearInterval(intervalId);
            resolve(false);
        }, TERMINAL_READY_TIMEOUT_MS);

        intervalId = setInterval(() => {
            const status =
                useTerminalRuntimeStore.getState().runtimesById[terminalId]
                    ?.snapshot.status;
            if (status === "running") {
                clearTimeout(timeoutId);
                clearInterval(intervalId);
                resolve(true);
            } else if (status === "error" || status === "exited") {
                clearTimeout(timeoutId);
                clearInterval(intervalId);
                resolve(false);
            }
        }, 100);
    });
}

export async function openClaudeCodeTerminalWithContext(
    detail?: FileTreeNoteDragDetail,
): Promise<void> {
    const vaultPath = useVaultStore.getState().vaultPath;
    const tabId = useEditorStore
        .getState()
        .openTerminal({ cwd: vaultPath ?? undefined });
    if (!tabId) return;

    const tab = selectEditorWorkspaceTabs(useEditorStore.getState()).find(
        (t) => t.id === tabId,
    );
    if (!tab || !isTerminalTab(tab)) return;

    const { terminalId } = tab;
    const ready = await waitForTerminalRunning(terminalId);
    if (!ready) return;

    const store = useTerminalRuntimeStore.getState();

    // cd into the target directory so the user can see where claude starts,
    // and so relative @mentions resolve correctly.
    const cdTarget = resolveCdTarget(detail, vaultPath);
    if (cdTarget) {
        await store.writeInput(
            terminalId,
            `cd "${cdTarget.replace(/"/g, '\\"')}"\n`,
        );
    }

    // Build the claude command from settings.
    const {
        claudeCodeSkipPermissions,
        claudeCodeModel,
        claudeCodeContinueSession,
        claudeCodeMaxTurns,
    } = useSettingsStore.getState();

    const flags: string[] = [];
    if (claudeCodeSkipPermissions) flags.push("--dangerously-skip-permissions");
    if (claudeCodeModel.trim()) flags.push("--model", claudeCodeModel.trim());
    if (claudeCodeContinueSession) flags.push("--continue");
    if (claudeCodeMaxTurns > 0) flags.push("--max-turns", String(claudeCodeMaxTurns));

    const claudeCommand =
        flags.length > 0 ? `claude ${flags.join(" ")}\n` : "claude\n";
    await store.writeInput(terminalId, claudeCommand);

    if (!detail) return;

    const contextArgs = buildContextArgs(detail);
    if (!contextArgs) return;

    // Wait for Claude Code's TUI to finish initialising, then pre-fill the
    // input buffer with the @mentions so the user can complete their prompt.
    await new Promise<void>((resolve) => setTimeout(resolve, CLAUDE_TUI_SETTLE_MS));
    await store.writeInput(terminalId, contextArgs);
}
