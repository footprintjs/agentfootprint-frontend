/**
 * agentfootprint-frontend/react — React hooks + components for running
 * agentfootprint runners inside a React app.
 *
 * Entry point:
 *   import { useAgentStream } from 'agentfootprint-frontend/react';
 *
 * The same package ships `/vue`, `/angular`, `/nextjs` subpaths (each
 * independently tree-shakeable) so consumers install one dependency and
 * import only what their stack needs.
 */

export { useAgentStream } from './useAgentStream';
export type {
  StreamableRunner,
  AgentTurnResult,
  AgentStreamStatus,
  CapturedTurn,
  UseAgentStreamOptions,
  UseAgentStreamReturn,
} from './useAgentStream';
