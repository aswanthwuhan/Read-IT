import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve('src/styles.css'), 'utf8');
const readerStyles = readFileSync(resolve('src/reader/reader.css'), 'utf8');
const overlayStyles = readFileSync(resolve('src/reader/LayoutOverlay.module.css'), 'utf8');

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((left, right) => right - left) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function darkToken(name: string): string {
  const darkBlock = styles.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n\s*\}/)?.[1];
  const value = darkBlock?.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  if (!value) throw new Error(`missing dark --${name}`);
  return value;
}

describe('accessibility CSS invariants', () => {
  it('keeps the dark control border at least 3:1 on every reader surface', () => {
    const border = darkToken('border-control');
    for (const surface of ['surface', 'surface-raised', 'bg'] as const) {
      expect(contrast(border, darkToken(surface)), `${border} on --${surface}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('does not fade skipped reading text', () => {
    const rule = readerStyles.match(/\.is-skipped\s*\{([^}]*)\}/)?.[1];
    expect(rule).toContain('color: var(--muted)');
    expect(rule).not.toMatch(/opacity\s*:/);
  });

  it('never hides PDF zoom or fit controls on narrow phones', () => {
    expect(readerStyles).not.toMatch(/\.rd-pdf-zoom\s+\.btn:not\(\[aria-pressed\]\)\s*\{[^}]*display:\s*none/);
  });

  it('keeps 2px visual outlines and gives small-block alternatives 48px targets', () => {
    expect(overlayStyles).toMatch(/\.box\s*\{[^}]*border:\s*2px solid currentColor/);
    const smallButton = overlayStyles.match(/button\.smallBlock\s*\{([^}]*)\}/)?.[1];
    expect(smallButton).toMatch(/min-width:\s*48px/);
    expect(smallButton).toMatch(/min-height:\s*48px/);
  });
});
