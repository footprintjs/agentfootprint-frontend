# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-18

### Added

- **`agentfootprint-frontend/react` subpath** with `useAgentStream()` hook for running agentfootprint runners in React. Accepts any `StreamableRunner` (duck-typed — works with `Agent`, `Conditional`, custom runners) and returns reactive state: `{ streaming, status, events, lastResult, pauseQuestion, error }` plus actions `{ send, resume, cancel, reset }`.
- **Pause / resume support** via the `resume()` action, automatically transitioning status to `'paused'` with `pauseQuestion` when a runner returns `paused: true`.
- **Captured turn introspection** — `lastResult.snapshot` / `narrative` / `narrativeEntries` / `spec` populated from the runner's own methods after each turn. Defaults to `redact: true` on `getSnapshot` when the runner supports the 4.14+ API; falls back gracefully.
- **Package structure** designed for per-framework expansion: subpath per framework (`/react`, future `/vue`, `/angular`, `/nextjs`), each independently tree-shakeable so consumers install one dependency and import only their stack.
- **15 tests across 5 patterns** (unit / boundary / scenario / property / security) using `@testing-library/react` + jsdom.

### Roadmap

- `/vue` composable
- `/angular` service + signals
- `/nextjs` SSE route handler + streaming Response helper
- `<AgentChat />` drop-in component (React) wrapping `useAgentStream` + input / message list
