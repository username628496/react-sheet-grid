import { describe, expect, it } from 'vitest';
import { VERSION } from '../../src/index';

describe('package', () => {
  it('exports a version', () => {
    expect(VERSION).toBe('0.0.0');
  });
});
