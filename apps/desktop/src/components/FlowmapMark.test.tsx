// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { FlowmapMark } from './FlowmapMark.jsx';

afterEach(cleanup);

describe('FlowmapMark', () => {
  it('is decorative so the wordmark remains the heading name', () => {
    const { container } = render(<FlowmapMark />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 32 32');
  });
});
