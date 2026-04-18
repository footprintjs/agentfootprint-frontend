# agentfootprint-frontend

Frontend framework bindings for [agentfootprint](https://www.npmjs.com/package/agentfootprint). One package, one install — subpath per framework:

| Subpath | Status | Use |
|---|---|---|
| `agentfootprint-frontend/react` | ✅ shipped (0.1.0) | `useAgentStream()` hook |
| `agentfootprint-frontend/vue` | planned | `useAgentStream()` composable |
| `agentfootprint-frontend/angular` | planned | `AgentStreamService` signals |
| `agentfootprint-frontend/nextjs` | planned | SSE route handler, streaming Response helper |

Peer deps are **optional per subpath**: install React and you only pull in React. No bundle bloat from frameworks you don't use.

## Install

```sh
npm install agentfootprint-frontend agentfootprint react
```

## React — `useAgentStream()`

```tsx
import { useAgentStream } from 'agentfootprint-frontend/react';
import { Agent, anthropic } from 'agentfootprint';
import { useMemo } from 'react';

const agent = Agent.create({ provider: anthropic('claude-sonnet-4') })
  .system('You are a helpful assistant.')
  .streaming(true)
  .build();

export function Chat() {
  const { send, streaming, lastResult, status, error } = useAgentStream(agent);

  return (
    <div>
      {lastResult && <div className="assistant">{lastResult.content}</div>}
      {streaming && <div className="assistant">{streaming}<span className="cursor">|</span></div>}
      {status === 'error' && <div className="error">{error?.message}</div>}
      <input
        onKeyDown={(e) => e.key === 'Enter' && send(e.currentTarget.value)}
        disabled={status === 'running'}
      />
    </div>
  );
}
```

### Returned state

| Field | Type | When it changes |
|---|---|---|
| `streaming` | `string` | Accumulates each token; resets to `''` at turn end |
| `status` | `'idle' \| 'running' \| 'done' \| 'paused' \| 'error'` | Transitions at turn boundaries |
| `events` | `readonly AgentStreamEvent[]` | All events for the current turn; cleared at next `send()` |
| `lastResult` | `CapturedTurn \| null` | Final content + execution snapshot; persists across idle time |
| `pauseQuestion` | `string \| null` | Set when the agent pauses for human input |
| `error` | `Error \| null` | Captured from `runner.run()` throws |

### Actions

| Fn | Does |
|---|---|
| `send(message)` | Start a new turn. No-op if one is already in flight. |
| `resume(input)` | Continue a paused turn with human input. |
| `cancel()` | Abort the in-flight turn via `AbortSignal`. |
| `reset()` | Full state reset — use when switching conversations. |

### Integration with `exportTrace`

`lastResult` already contains the captured narrative + snapshot + spec. To ship to a viewer / support tool:

```tsx
const { lastResult } = useAgentStream(agent);

const onCopyTrace = () => {
  if (!lastResult) return;
  const trace = {
    schemaVersion: 1 as const,
    exportedAt: new Date().toISOString(),
    redacted: true,
    snapshot: lastResult.snapshot,
    narrativeEntries: lastResult.narrativeEntries,
    narrative: lastResult.narrative,
    spec: lastResult.spec,
  };
  navigator.clipboard.writeText(JSON.stringify(trace));
};
```

Paste into [`<TraceViewer />`](https://www.npmjs.com/package/footprint-explainable-ui) from `footprint-explainable-ui` to render the full Behind-the-Scenes view.

## Pause / resume pattern

```tsx
const { send, resume, pauseQuestion, status } = useAgentStream(agent);

{status === 'paused' && (
  <div>
    <div>Agent is asking: {pauseQuestion}</div>
    <button onClick={() => resume({ approved: true })}>Approve</button>
    <button onClick={() => resume({ approved: false })}>Deny</button>
  </div>
)}
```

## Typing — `StreamableRunner`

The hook accepts any object exposing the subset of `AgentRunner` / `ConditionalRunner` / custom runner it uses:

```ts
interface StreamableRunner {
  run(input: string, options?: { signal?; onEvent?; onToken? }): Promise<unknown>;
  resume?(input: unknown): Promise<unknown>;
  getNarrative?(): string[];
  getNarrativeEntries?(): unknown[];
  getSnapshot?(options?: { redact?: boolean }): unknown;
  getSpec?(): unknown;
}
```

Duck-typed on purpose — a hand-rolled runner works the same as `Agent.create(...).build()`.

## License

MIT
