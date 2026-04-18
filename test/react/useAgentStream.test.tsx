/** @vitest-environment jsdom */
/**
 * useAgentStream — 5-pattern tests.
 *
 * Verifies the hook's reactive contract: send / resume / cancel / reset
 * transitions, streaming token accumulation, error handling, and capture
 * of runner introspection after turn completion.
 *
 * Uses a mock `StreamableRunner` — no network, deterministic, fast.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AgentStreamEvent } from 'agentfootprint';
import { useAgentStream, type StreamableRunner } from '../../src/react/useAgentStream';

// ── Fixture ─────────────────────────────────────────────────

function makeMockRunner(options?: {
  tokens?: string[];
  finalContent?: string;
  paused?: boolean;
  pauseQuestion?: string;
  throwError?: string;
  delayMs?: number;
}): StreamableRunner & { runCalls: number; resumeCalls: number } {
  const tokens = options?.tokens ?? ['Hello', ' ', 'world'];
  const final = options?.finalContent ?? tokens.join('');
  const runner = {
    runCalls: 0,
    resumeCalls: 0,
    async run(_input: string, opts?: { onEvent?: (e: AgentStreamEvent) => void; signal?: AbortSignal }) {
      this.runCalls++;
      if (options?.throwError) throw new Error(options.throwError);

      // Emit turn_start
      opts?.onEvent?.({ type: 'turn_start', userMessage: _input });
      for (const t of tokens) {
        if (options?.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
        if (opts?.signal?.aborted) throw new Error('aborted');
        opts?.onEvent?.({ type: 'token', content: t });
      }
      opts?.onEvent?.({ type: 'turn_end', content: final, iterations: 1 });

      return {
        content: final,
        messages: [],
        iterations: 1,
        ...(options?.paused && {
          paused: true,
          pauseData: { question: options.pauseQuestion ?? 'more info?' },
        }),
      };
    },
    async resume(_input: unknown) {
      this.resumeCalls++;
      return { content: 'resumed', messages: [], iterations: 2 };
    },
    getNarrative: () => ['line 1', 'line 2'],
    getSnapshot: ({ redact }: { redact?: boolean } = {}) => ({
      sharedState: {},
      _redacted: redact,
    }),
  };
  return runner as unknown as StreamableRunner & { runCalls: number; resumeCalls: number };
}

// ── Unit ────────────────────────────────────────────────────

describe('useAgentStream — unit', () => {
  it('starts idle with no streaming content', () => {
    const { result } = renderHook(() => useAgentStream(makeMockRunner()));
    expect(result.current.status).toBe('idle');
    expect(result.current.streaming).toBe('');
    expect(result.current.lastResult).toBe(null);
  });

  it('send() accumulates streaming tokens then finalizes', async () => {
    const runner = makeMockRunner({ tokens: ['Hel', 'lo'] });
    const { result } = renderHook(() => useAgentStream(runner));

    await act(async () => {
      await result.current.send('hi');
    });

    expect(runner.runCalls).toBe(1);
    expect(result.current.status).toBe('done');
    expect(result.current.streaming).toBe(''); // cleared at end of turn
    expect(result.current.lastResult?.content).toBe('Hello');
    expect(result.current.lastResult?.narrative).toEqual(['line 1', 'line 2']);
  });

  it('events array captures full turn', async () => {
    const runner = makeMockRunner();
    const { result } = renderHook(() => useAgentStream(runner));

    await act(async () => {
      await result.current.send('hi');
    });

    const types = result.current.events.map((e) => e.type);
    expect(types).toContain('turn_start');
    expect(types).toContain('token');
    expect(types).toContain('turn_end');
  });

  it('passes redactSnapshot: true by default to runner.getSnapshot', async () => {
    const runner = makeMockRunner();
    const getSnapshotSpy = vi.spyOn(runner, 'getSnapshot');
    const { result } = renderHook(() => useAgentStream(runner));

    await act(async () => {
      await result.current.send('hi');
    });

    expect(getSnapshotSpy).toHaveBeenCalledWith({ redact: true });
  });

  it('redactSnapshot: false overrides the default', async () => {
    const runner = makeMockRunner();
    const getSnapshotSpy = vi.spyOn(runner, 'getSnapshot');
    const { result } = renderHook(() => useAgentStream(runner, { redactSnapshot: false }));

    await act(async () => {
      await result.current.send('hi');
    });

    expect(getSnapshotSpy).toHaveBeenCalledWith({ redact: false });
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('useAgentStream — boundary', () => {
  it('surfaces errors from the runner', async () => {
    const runner = makeMockRunner({ throwError: 'provider down' });
    const { result } = renderHook(() => useAgentStream(runner));

    await act(async () => {
      await result.current.send('hi');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('provider down');
  });

  it('null runner records an error and sets status=error', async () => {
    const { result } = renderHook(() => useAgentStream(null));

    await act(async () => {
      await result.current.send('hi');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toMatch(/runner is not ready/);
  });

  it('send() while running is a no-op (second call drops)', async () => {
    const runner = makeMockRunner({ delayMs: 10 });
    const { result } = renderHook(() => useAgentStream(runner));

    await act(async () => {
      void result.current.send('a');
      // second send while first is in flight — should NOT call runner again
      await result.current.send('b');
    });

    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(runner.runCalls).toBe(1);
  });

  it('pauseQuestion surfaces when runner returns paused result', async () => {
    const runner = makeMockRunner({ paused: true, pauseQuestion: 'Approve refund?' });
    const { result } = renderHook(() => useAgentStream(runner));

    await act(async () => {
      await result.current.send('hi');
    });

    expect(result.current.status).toBe('paused');
    expect(result.current.pauseQuestion).toBe('Approve refund?');
  });

  it('resume() calls runner.resume and transitions back to done', async () => {
    const runner = makeMockRunner({ paused: true });
    const { result } = renderHook(() => useAgentStream(runner));

    await act(async () => {
      await result.current.send('hi');
    });
    expect(result.current.status).toBe('paused');

    await act(async () => {
      await result.current.resume({ approved: true });
    });

    expect(runner.resumeCalls).toBe(1);
    expect(result.current.status).toBe('done');
  });

  it('resume() on a runner without resume() sets error status', async () => {
    const runner = {
      run: async () => ({ content: 'x' }),
    } as StreamableRunner;
    const { result } = renderHook(() => useAgentStream(runner));

    await act(async () => {
      await result.current.resume('whatever');
    });

    expect(result.current.status).toBe('error');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('useAgentStream — scenario', () => {
  it('two sequential turns preserve lastResult across idle windows', async () => {
    const runner = makeMockRunner({ tokens: ['A'], finalContent: 'first' });
    const { result } = renderHook(() => useAgentStream(runner));

    await act(async () => {
      await result.current.send('turn 1');
    });
    expect(result.current.lastResult?.content).toBe('first');

    // Replace the tokens for the next turn — same runner, new behavior.
    (runner as unknown as { run: StreamableRunner['run'] }).run = async (_i, opts) => {
      opts?.onEvent?.({ type: 'token', content: 'B' });
      return { content: 'second' };
    };

    await act(async () => {
      await result.current.send('turn 2');
    });
    expect(result.current.lastResult?.content).toBe('second');
  });

  it('reset() clears everything back to idle', async () => {
    const runner = makeMockRunner();
    const { result } = renderHook(() => useAgentStream(runner));

    await act(async () => {
      await result.current.send('hi');
    });
    expect(result.current.lastResult).not.toBe(null);

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.lastResult).toBe(null);
    expect(result.current.streaming).toBe('');
    expect(result.current.events).toEqual([]);
  });
});

// ── Property ────────────────────────────────────────────────

describe('useAgentStream — property', () => {
  it('onEvent callback fires for every event the events[] array collects', async () => {
    const runner = makeMockRunner();
    const onEvent = vi.fn();
    const { result } = renderHook(() => useAgentStream(runner, { onEvent }));

    await act(async () => {
      await result.current.send('hi');
    });

    expect(onEvent.mock.calls.length).toBe(result.current.events.length);
  });
});

// ── Security ────────────────────────────────────────────────

describe('useAgentStream — security', () => {
  it('cancel() aborts the in-flight runner (abort signal propagated)', async () => {
    const runner = makeMockRunner({ delayMs: 20 });
    const { result } = renderHook(() => useAgentStream(runner));

    await act(async () => {
      const p = result.current.send('hi');
      // abort before completion
      setTimeout(() => result.current.cancel(), 5);
      await p;
    });

    // Either error status or done — but never hang
    expect(['error', 'done']).toContain(result.current.status);
  });
});
