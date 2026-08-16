/**
 * @flowmap/visual-model — layout-neutral view models.
 *
 * Pure: no DOM, no React, no measurement. The canvas renders what these return,
 * which is what makes the board testable at 500 commitments without a browser.
 */

export * from './layout.js';
export * from './zoom.js';
export * from './readiness.js';
export * from './placement.js';
