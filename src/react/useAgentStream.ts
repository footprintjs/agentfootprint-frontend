/**
 * useAgentStream — React hook for running an agentfootprint runner with
 * live-streamed state.
 *
 * Returns a `send()` function plus reactive state:
 *   - `streaming`     : partial content as tokens stream in (empty after turn)
 *   - `status`        : 'idle' | 'running' | 'done' | 'paused' | 'error'
 *   - `events`        : AgentStreamEvent[] accumulated for the current turn
 *   - `lastResult`    : final turn result (content + execution + durationMs)
 *   - `pauseQuestion` : present when the agent paused for human input
 *   - `resume`        : function to continue from a paused turn
 *   - `error`         : Error | null
 *
 * Designed for chat UIs — `send()` captures the current message, runs the
 * agent with streaming enabled, and updates `streaming` with each token.
 * When the turn finishes, `streaming` resets to `''` and `lastResult`
 * holds the final content + execution trace.
 *
 * @example
 * ```tsx
 * import { useAgentStream } from 'agentfootprint-frontend/react';
 *
 * function Chat({ agent }) {
 *   const { send, streaming, status, lastResult } = useAgentStream(agent);
 *
 *   return (
 *     <>
 *       {lastResult && <div>{lastResult.content}</div>}
 *       {streaming && <div>{streaming}|</div>}
 *       <input onKeyDown={(e) => e.key === 'Enter' && send(e.currentTarget.value)} />
 *       <div>Status: {status}</div>
 *     </>
 *   );
 * }
 * ```
 */
import { useCallback, useRef, useState } from 'react';
import type { AgentStreamEvent } from 'agentfootprint';

/** Minimum shape from agentfootprint — duck-typed so we don't force an install. */
export interface StreamableRunner {
  run(
    input: string,
    options?: {
      signal?: AbortSignal;
      onToken?: (token: string) => void;
      onEvent?: (event: AgentStreamEvent) => void;
    },
  ): Promise<unknown>;
  resume?(input: unknown): Promise<unknown>;
  getNarrative?(): string[];
  getNarrativeEntries?(): unknown[];
  getSnapshot?(options?: { redact?: boolean }): unknown;
  getSpec?(): unknown;
}

/** Outcome shape returned from `runner.run` — the fields we care about. */
export interface AgentTurnResult {
  readonly content: string;
  readonly messages?: unknown[];
  readonly iterations?: number;
  readonly paused?: boolean;
  readonly pauseData?: { question?: string; [k: string]: unknown };
  readonly maxIterationsReached?: boolean;
}

export type AgentStreamStatus = 'idle' | 'running' | 'done' | 'paused' | 'error';

/** Captured per-turn execution for introspection / exportTrace integration. */
export interface CapturedTurn {
  readonly content: string;
  readonly durationMs: number;
  readonly narrative?: string[];
  readonly narrativeEntries?: unknown[];
  readonly snapshot?: unknown;
  readonly spec?: unknown;
  readonly paused?: boolean;
  readonly pauseQuestion?: string;
  readonly maxIterationsReached?: boolean;
}

export interface UseAgentStreamOptions {
  /**
   * Called on every AgentStreamEvent in addition to updating internal state.
   * Use for analytics / custom logging — reading `events` from the hook's
   * return value is usually sufficient.
   */
  readonly onEvent?: (event: AgentStreamEvent) => void;
  /**
   * When `true` (default), redacted snapshots are captured. Set to `false`
   * only when the caller needs raw state and has no redaction policy set.
   */
  readonly redactSnapshot?: boolean;
}

export interface UseAgentStreamReturn {
  /** Send a user message. Idempotent while a turn is running (second call is a no-op). */
  readonly send: (message: string) => Promise<void>;
  /** Resume a paused turn with the human's input. */
  readonly resume: (input: unknown) => Promise<void>;
  /** Abort the in-flight turn. */
  readonly cancel: () => void;
  /** Reset all state — use when switching to a new conversation. */
  readonly reset: () => void;
  /** Partial content as tokens stream in. Empty between turns. */
  readonly streaming: string;
  readonly status: AgentStreamStatus;
  /** All events from the current turn. Cleared when a new turn starts. */
  readonly events: readonly AgentStreamEvent[];
  /** The final result of the last completed turn. Persists across idle time. */
  readonly lastResult: CapturedTurn | null;
  /** Human-prompt question when the agent is paused. */
  readonly pauseQuestion: string | null;
  /** Error from the last turn, if any. */
  readonly error: Error | null;
}

/**
 * Capture a turn's introspection into a `CapturedTurn`. Graceful — any
 * missing method on the runner is skipped.
 */
function captureTurn(
  runner: StreamableRunner,
  result: AgentTurnResult,
  durationMs: number,
  redact: boolean,
): CapturedTurn {
  let snapshot: unknown;
  try {
    snapshot = runner.getSnapshot?.({ redact });
  } catch {
    // Older runners whose getSnapshot doesn't accept { redact }
    try {
      snapshot = (runner.getSnapshot as undefined | (() => unknown))?.();
    } catch {
      snapshot = undefined;
    }
  }
  return {
    content: result.content,
    durationMs,
    narrative: runner.getNarrative?.(),
    narrativeEntries: runner.getNarrativeEntries?.(),
    snapshot,
    spec: runner.getSpec?.(),
    ...(result.paused && {
      paused: true,
      pauseQuestion: result.pauseData?.question,
    }),
    ...(result.maxIterationsReached && { maxIterationsReached: true }),
  };
}

export function useAgentStream(
  runner: StreamableRunner | null | undefined,
  options?: UseAgentStreamOptions,
): UseAgentStreamReturn {
  const [streaming, setStreaming] = useState('');
  const [status, setStatus] = useState<AgentStreamStatus>('idle');
  const [events, setEvents] = useState<readonly AgentStreamEvent[]>([]);
  const [lastResult, setLastResult] = useState<CapturedTurn | null>(null);
  const [pauseQuestion, setPauseQuestion] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // refs so callers don't need to memoize options; values used inside async
  // closures are always the latest without re-creating the callbacks.
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const optsRef = useRef(options);
  optsRef.current = options;

  const runTurn = useCallback(
    async (operation: () => Promise<unknown>) => {
      if (!runner) {
        setError(new Error('useAgentStream: runner is not ready.'));
        setStatus('error');
        return;
      }
      if (inFlightRef.current) return; // second call is a no-op while running

      inFlightRef.current = true;
      const startMs = Date.now();

      setStreaming('');
      setEvents([]);
      setError(null);
      setPauseQuestion(null);
      setStatus('running');

      try {
        const result = (await operation()) as AgentTurnResult;
        const durationMs = Date.now() - startMs;
        const captured = captureTurn(
          runner,
          result,
          durationMs,
          optsRef.current?.redactSnapshot !== false,
        );
        setLastResult(captured);
        if (result.paused) {
          setPauseQuestion(result.pauseData?.question ?? 'Awaiting input');
          setStatus('paused');
        } else {
          setStatus('done');
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      } finally {
        inFlightRef.current = false;
        abortRef.current = null;
        // Clear the streaming buffer — the final content lives in
        // lastResult.content, and leaving partial tokens behind would
        // confuse UIs that render both. Events persist until the next
        // send() (cleared at the top of runTurn).
        setStreaming('');
      }
    },
    [runner],
  );

  const send = useCallback(
    (message: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      return runTurn(() =>
        runner!.run(message, {
          signal: controller.signal,
          onEvent: (e) => {
            // Per-turn events accumulator + streaming token buffer.
            // Call the optional user handler after our state updates so
            // user code observes the same events we expose.
            if (e.type === 'token') {
              setStreaming((prev) => prev + e.content);
            }
            setEvents((prev) => [...prev, e]);
            optsRef.current?.onEvent?.(e);
          },
        }),
      );
    },
    [runner, runTurn],
  );

  const resume = useCallback(
    (input: unknown) => {
      if (!runner?.resume) {
        setError(new Error('useAgentStream: runner does not support resume().'));
        setStatus('error');
        return Promise.resolve();
      }
      return runTurn(() => runner.resume!(input));
    },
    [runner, runTurn],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    inFlightRef.current = false;
    abortRef.current = null;
    setStreaming('');
    setStatus('idle');
    setEvents([]);
    setLastResult(null);
    setPauseQuestion(null);
    setError(null);
  }, []);

  return {
    send,
    resume,
    cancel,
    reset,
    streaming,
    status,
    events,
    lastResult,
    pauseQuestion,
    error,
  };
}
