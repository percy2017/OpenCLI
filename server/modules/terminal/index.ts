/**
 * Barrel for the Terminal module.
 *
 * Re-exports the service (used by the WebSocket router for the kill-switch)
 * and the Express router (mounted under `/api/terminal` in `server/index.js`).
 */

export { terminalService, TERMINAL_STATE_KEY } from './terminal.service.js';
export { default as terminalRoutes } from './terminal.routes.js';