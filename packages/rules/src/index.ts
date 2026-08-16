/**
 * @flowmap/rules — deterministic, explainable rule evaluation.
 *
 * Same workspace state + same clock + same settings ⇒ byte-identical results,
 * always. There is no AI, no scoring model, and no learned weighting anywhere
 * in this package: every signal can show what happened, which threshold it
 * crossed, why that matters, and what to do — all as data.
 *
 * Contract: docs/spec/04-rules-radar.md
 */

export * from './types.js';
export * from './identity.js';
export * from './engine.js';
export * from './catalogue.js';
export * from './change-load.js';
export * from './radar.js';
export * from './secrets.js';
export * from './settings.js';

export { daysBetween, addDays } from './helpers.js';
