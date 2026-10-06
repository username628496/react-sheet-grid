import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json?raw';
import { VERSION } from '../../src/index';

describe('package', () => {
  it('exports a version that matches package.json', () => {
    const pkg = JSON.parse(packageJson) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
