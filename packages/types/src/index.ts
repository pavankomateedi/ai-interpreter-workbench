/**
 * `@workbench/types` — the shared domain vocabulary compiled into identical
 * shapes on both sides of the WebSocket boundary (see ADR-001). Provider-level
 * interfaces (ISttProvider etc.) deliberately live in the backend package; this
 * package holds only what crosses the wire or appears in the UI.
 */

export * from './audio.js';
export * from './language.js';
export * from './events.js';
export * from './session.js';
export * from './protocol.js';
