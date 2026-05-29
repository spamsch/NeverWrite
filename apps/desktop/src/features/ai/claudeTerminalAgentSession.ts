import { invoke } from "@neverwrite/runtime";
import {
    selectEditorWorkspaceTabs,
    useEditorStore,
} from "../../app/store/editorStore";
import { isTerminalTab } from "../../app/store/editorTabs";
import { useVaultStore } from "../../app/store/vaultStore";
import { useTerminalRuntimeStore } from "../terminal/terminalRuntimeStore";
import { useChatStore } from "./store/chatStore";
import type { AIChatSession } from "./types";
import { CLAUDE_TERMINAL_RUNTIME_ID } from "./utils/runtimeMetadata";

// Claude Code launched in a terminal has no ACP backend session, so it never
// appears in the Agents sidebar on its own. We register a lightweight,
// non-persisted chat session entry for it, linked to the terminal via
// `terminalId`, and keep its title/preview in sync with Claude Code's own
// on-disk session transcript. The entry is removed when its terminal closes.

const SESSION_ID_PREFIX = "claude-terminal:";
const TRANSCRIPT_POLL_INTERVAL_MS = 4_000;

interface TranscriptInfo {
    cwd: string;
    // Claude session UUID when we pinned it at launch (--session-id); null means
    // fall back to the most recently modified transcript in the project dir.
    transcriptSessionId: string | null;
    lastMtimeMs: number | null;
}

interface ClaudeTranscriptResult {
    found: boolean;
    changed: boolean;
    mtimeMs: number | null;
    title: string | null;
    preview: string | null;
}

const transcriptInfoByTerminalId = new Map<string, TranscriptInfo>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pruneUnsubscribe: (() => void) | null = null;

function sessionIdForTerminal(terminalId: string) {
    return `${SESSION_ID_PREFIX}${terminalId}`;
}

export function isClaudeTerminalAgentSession(
    session: Pick<AIChatSession, "runtimeId">,
) {
    return session.runtimeId === CLAUDE_TERMINAL_RUNTIME_ID;
}

function installPruneSubscription() {
    if (pruneUnsubscribe) return;
    // Terminal lifecycle drives the agent entry: when a terminal runtime is gone
    // (tab closed), drop its agent session. Firing on every terminal store
    // change is cheap — prune only touches the handful of claude-terminal
    // sessions.
    pruneUnsubscribe = useTerminalRuntimeStore.subscribe(() => {
        pruneClaudeTerminalAgentSessions();
    });
}

// Remove agent entries whose backing terminal runtime no longer exists.
export function pruneClaudeTerminalAgentSessions() {
    const liveTerminalIds = new Set(
        Object.keys(useTerminalRuntimeStore.getState().runtimesById),
    );
    const chat = useChatStore.getState();
    for (const session of Object.values(chat.sessionsById)) {
        if (
            isClaudeTerminalAgentSession(session) &&
            session.terminalId &&
            !liveTerminalIds.has(session.terminalId)
        ) {
            transcriptInfoByTerminalId.delete(session.terminalId);
            void chat.deleteSession(session.sessionId);
        }
    }
    stopTranscriptPollingIfIdle();
}

function ensureTranscriptPolling() {
    if (pollTimer || transcriptInfoByTerminalId.size === 0) return;
    pollTimer = setInterval(() => {
        void refreshClaudeTerminalAgentTranscripts();
    }, TRANSCRIPT_POLL_INTERVAL_MS);
}

function stopTranscriptPollingIfIdle() {
    if (pollTimer && transcriptInfoByTerminalId.size === 0) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

// Poll Claude Code's transcript for each tracked terminal and refresh the agent
// entry's title (first prompt) and preview (latest answer). Reads are skipped at
// the backend when the file hasn't changed since the last read.
export async function refreshClaudeTerminalAgentTranscripts() {
    const chat = useChatStore.getState();
    for (const [terminalId, info] of [...transcriptInfoByTerminalId]) {
        const sessionId = sessionIdForTerminal(terminalId);
        if (!chat.sessionsById[sessionId]) {
            transcriptInfoByTerminalId.delete(terminalId);
            continue;
        }

        let result: ClaudeTranscriptResult;
        try {
            result = await invoke<ClaudeTranscriptResult>(
                "devtools_read_claude_transcript",
                {
                    input: {
                        sessionId: info.transcriptSessionId,
                        cwd: info.cwd,
                        sinceMtimeMs: info.lastMtimeMs,
                    },
                },
            );
        } catch {
            continue;
        }

        if (!result?.changed) continue;
        if (result.mtimeMs != null) info.lastMtimeMs = result.mtimeMs;
        if (!result.title && !result.preview) continue;

        useChatStore.setState((state) => {
            const session = state.sessionsById[sessionId];
            if (!session) return state;
            return {
                sessionsById: {
                    ...state.sessionsById,
                    [sessionId]: {
                        ...session,
                        persistedTitle: result.title ?? session.persistedTitle,
                        persistedPreview:
                            result.preview ?? session.persistedPreview,
                    },
                },
            };
        });
    }
    stopTranscriptPollingIfIdle();
}

// Register (or update) the Agents-sidebar entry for a Claude Code terminal.
// Idempotent: the session id is derived from the terminal id. Pass the cwd (and
// the pinned session id, if any) to enable transcript-driven title/preview.
export function registerClaudeTerminalAgentSession(args: {
    terminalId: string;
    title: string;
    transcriptSessionId?: string | null;
    cwd?: string | null;
}) {
    installPruneSubscription();

    const sessionId = sessionIdForTerminal(args.terminalId);
    const session: AIChatSession = {
        sessionId,
        historySessionId: sessionId,
        runtimeId: CLAUDE_TERMINAL_RUNTIME_ID,
        terminalId: args.terminalId,
        vaultPath: useVaultStore.getState().vaultPath ?? null,
        status: "idle",
        modelId: "",
        modeId: "",
        models: [],
        modes: [],
        configOptions: [],
        messages: [],
        attachments: [],
        // Default label until the transcript yields the first prompt. Use
        // persistedTitle (not customTitle) so a manual rename still wins and the
        // transcript-derived title can fill in over it.
        persistedTitle: args.title,
    };

    // activate:false so launching a terminal doesn't hijack the active chat;
    // allowUnknownSession so this brand-new entry is admitted to the list.
    const previousActiveSessionId = useChatStore.getState().activeSessionId;
    useChatStore.getState().upsertSession(session, false, {
        allowUnknownSession: true,
    });
    // upsertSession makes a session active when none was — but a terminal agent
    // is never a real chat target, so keep the prior active session.
    if (
        previousActiveSessionId !== sessionId &&
        useChatStore.getState().activeSessionId === sessionId
    ) {
        useChatStore.setState({ activeSessionId: previousActiveSessionId });
    }

    if (args.cwd) {
        transcriptInfoByTerminalId.set(args.terminalId, {
            cwd: args.cwd,
            transcriptSessionId: args.transcriptSessionId ?? null,
            lastMtimeMs: null,
        });
        ensureTranscriptPolling();
        void refreshClaudeTerminalAgentTranscripts();
    }
}

// Focus the terminal tab backing a Claude Code agent entry. Returns false if no
// matching terminal tab exists (e.g. it was closed between render and click).
export function focusClaudeTerminalAgentSession(
    session: Pick<AIChatSession, "terminalId">,
): boolean {
    if (!session.terminalId) return false;
    const tab = selectEditorWorkspaceTabs(useEditorStore.getState()).find(
        (candidate) =>
            isTerminalTab(candidate) &&
            candidate.terminalId === session.terminalId,
    );
    if (!tab) return false;
    useEditorStore.getState().switchTab(tab.id);
    return true;
}

export function resetClaudeTerminalAgentSessionsForTests() {
    transcriptInfoByTerminalId.clear();
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    pruneUnsubscribe?.();
    pruneUnsubscribe = null;
}
