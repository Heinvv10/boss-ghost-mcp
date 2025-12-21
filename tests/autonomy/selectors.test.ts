/**
 * @license
 * Copyright 2025 BOSS Ghost MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import puppeteer, {Browser, Page} from 'puppeteer';
import {SelfHealingSelector} from '../../src/utils/selectors.js';

describe('Self-Healing Selector System', () => {
  let browser: Browser;
  let page: Page;
  let selector: SelfHealingSelector;

  beforeAll(async () => {
    browser = await puppeteer.launch({headless: true});
    page = await browser.newPage();
    selector = new SelfHealingSelector();
  });

  afterAll(async () => {
    await browser.close();
  });

  describe('Basic Selector Finding', () => {
    it('should find element with original selector', async () => {
      await page.setContent(`
        <html>
          <body>
            <button id="submit-btn" class="btn-primary">Submit</button>
          </body>
        </html>
      `);

      const result = await selector.findElement(page, '#submit-btn');

      expect(result.element).not.toBeNull();
      expect(result.healingApplied).toBe(false);
      expect(result.strategy?.strategy).toBe('original');
    });

    it('should return null when element not found and healing disabled', async () => {
      await page.setContent(`
        <html>
          <body>
            <div>No button here</div>
          </body>
        </html>
      `);

      const result = await selector.findElement(page, '#submit-btn', {
        enableHealing: false,
      });

      expect(result.element).toBeNull();
      expect(result.healingApplied).toBe(false);
    });
  });

  describe('Healing Strategies', () => {
    it('should heal broken selector using test-id strategy', async () => {
      await page.setContent(`
        <html>
          <body>
            <button data-testid="submit-button" class="changed-class">Submit</button>
          </body>
        </html>
      `);

      // Original selector (class-based) will fail
      const result = await selector.findElement(page, '.btn-primary');

      expect(result.element).not.toBeNull();
      expect(result.healingApplied).toBe(true);
      expect(result.strategy?.strategy).toBe('testid');
      expect(result.strategy?.confidence).toBeGreaterThan(0.9);
    });

    it('should heal broken selector using ARIA strategy', async () => {
      await page.setContent(`
        <html>
          <body>
            <button aria-label="Submit Form" class="changed-class">Submit</button>
          </body>
        </html>
      `);

      const result = await selector.findElement(
        page,
        '.btn-primary',
        {textContent: 'Submit Form'},
      );

      expect(result.element).not.toBeNull();
      expect(result.healingApplied).toBe(true);
      expect(result.strategy?.strategy).toBe('aria');
    });

    it('should heal broken selector using semantic strategy', async () => {
      await page.setContent(`
        <html>
          <body>
            <button textContent="Click Me">Click Me</button>
          </body>
        </html>
      `);

      const result = await selector.findElement(
        page,
        '.missing-class',
        {textContent: 'Click Me'},
      );

      expect(result.element).not.toBeNull();
      expect(result.healingApplied).toBe(true);
      expect(result.strategy?.strategy).toBe('semantic');
    });

    it('should heal broken selector using class partial match', async () => {
      await page.setContent(`
        <html>
          <body>
            <button class="btn btn-primary-new">Submit</button>
          </body>
        </html>
      `);

      const result = await selector.findElement(page, '.btn-primary');

      expect(result.element).not.toBeNull();
      expect(result.healingApplied).toBe(true);
      expect(result.strategy?.strategy).toBe('structure');
    });
  });

  describe('Caching', () => {
    it('should cache successful strategy', async () => {
      await page.setContent(`
        <html>
          <body>
            <button data-testid="cached-btn" class="btn">Click</button>
          </body>
        </html>
      `);

      // First call - should use healing
      const result1 = await selector.findElement(page, '.missing-btn');
      expect(result1.healingApplied).toBe(true);

      // Second call - should use cached strategy
      const result2 = await selector.findElement(page, '.missing-btn');
      expect(result2.healingApplied).toBe(true);
      expect(result2.attemptedStrategies).toContain('cache');
    });

    it('should provide cache statistics', () => {
      const stats = selector.getCacheStats();
      expect(stats).toHaveProperty('totalEntries');
      expect(stats).toHaveProperty('entries');
      expect(stats.totalEntries).toBeGreaterThan(0);
    });

    it('should clear cache on demand', () => {
      selector.clearCache();
      const stats = selector.getCacheStats();
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('Strategy Confidence', () => {
    it('should respect minimum confidence threshold', async () => {
      await page.setContent(`
        <html>
          <body>
            <div class="low-confidence-element">Text</div>
          </body>
        </html>
      `);

      const result = await selector.findElement(page, '#missing-id', {
        minConfidence: 0.95, // Very high threshold
      });

      // Should not find element if all strategies below threshold
      expect(result.element).toBeNull();
    });
  });

  describe('Multiple Strategy Attempts', () => {
    it('should try multiple strategies in confidence order', async () => {
      await page.setContent(`
        <html>
          <body>
            <button id="final-btn">Submit</button>
          </body>
        </html>
      `);

      const result = await selector.findElement(page, '.missing-class');

      expect(result.attemptedStrategies.length).toBeGreaterThan(1);
      // Should have tried multiple strategies before finding via ID
    });

    it('should limit strategies to maxStrategies option', async () => {
      await page.setContent(`
        <html>
          <body>
            <button>Click</button>
          </body>
        </html>
      `);

      const result = await selector.findElement(page, '.missing', {
        maxStrategies: 2,
      });

      expect(result.attemptedStrategies.length).toBeLessThanOrEqual(3); // original + 2 healing
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty page', async () => {
      await page.setContent(`<html><body></body></html>`);

      const result = await selector.findElement(page, '#anything');

      expect(result.element).toBeNull();
    });

    it('should handle malformed selectors gracefully', async () => {
      await page.setContent(`
        <html>
          <body>
            <div>Content</div>
          </body>
        </html>
      `);

      const result = await selector.findElement(page, '###invalid###');

      expect(result.element).toBeNull();
    });

    it('should handle special characters in selectors', async () => {
      await page.setContent(`
        <html>
          <body>
            <button data-testid="btn:special-123">Click</button>
          </body>
        </html>
      `);

      const result = await selector.findElement(page, '[data-testid="btn:special-123"]');

      expect(result.element).not.toBeNull();
    });
  });

  describe('Performance', () => {
    it('should complete healing within reasonable time', async () => {
      await page.setContent(`
        <html>
          <body>
            ${Array.from({length: 100}, (_, i) => `<div id="div-${i}">Content ${i}</div>`).join('\n')}
            <button data-testid="target-btn">Target</button>
          </body>
        </html>
      `);

      const startTime = Date.now();
      const result = await selector.findElement(page, '.missing-class');
      const elapsed = Date.now() - startTime;

      expect(result.element).not.toBeNull();
      expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});
