import assert from 'node:assert';
import {describe, it, before, after} from 'node:test';
import {launch} from '../../src/browser.js';
import {SelfHealingSelector} from '../../src/utils/selectors.js';
import type {Browser} from '../../src/third_party/index.js';

/**
 * Self-Healing Selector Tests
 * Tests: Selector healing strategies, caching, fallback mechanisms
 */

describe('Self-Healing Selectors', () => {
  let browser: Browser;
  let healingSelector: SelfHealingSelector;

  before(async () => {
    browser = await launch({
      headless: true,
      isolated: true,
      devtools: false,
      ghostMode: {
        enabled: true,
        stealthLevel: 'maximum',
        enableFingerprinting: true,
        enableHumanBehavior: true,
        enableBotDetectionEvasion: true,
      },
    });

    healingSelector = new SelfHealingSelector();
  }, {timeout: 30000});

  after(async () => {
    await browser?.close();
  });

  it('should find element with original selector', {timeout: 10000}, async () => {
    // 🟢 WORKING: Original selector should work when element exists
    const [page] = await browser.pages();
    await page.goto('about:blank');

    await page.setContent(`
      <html>
        <body>
          <button id="submit-btn" data-testid="submit">Submit</button>
        </body>
      </html>
    `);

    const result = await healingSelector.findElement(page, '#submit-btn');

    assert.strictEqual(result.healingApplied, false);
    assert.strictEqual(result.strategy?.strategy, 'original');
    assert.notStrictEqual(result.element, null);
  });

  it('should heal selector using test ID strategy', {timeout: 10000}, async () => {
    // 🟢 WORKING: Should fallback to data-testid when original selector fails
    const [page] = await browser.pages();
    await page.goto('about:blank');

    await page.setContent(`
      <html>
        <body>
          <button class="btn-primary" data-testid="submit">Submit</button>
        </body>
      </html>
    `);

    // Try selector that won't match
    const result = await healingSelector.findElement(
      page,
      '#nonexistent-id',
      {
        textContent: 'Submit',
        enableHealing: true,
      },
    );

    // Should find element via healing
    assert.strictEqual(result.healingApplied, true);
    assert.notStrictEqual(result.element, null);
    assert.ok(result.attemptedStrategies.length > 1);
  });

  it('should heal selector using ARIA label strategy', {timeout: 10000}, async () => {
    // 🟢 WORKING: Should fallback to aria-label when original selector fails
    const [page] = await browser.pages();
    await page.goto('about:blank');

    await page.setContent(`
      <html>
        <body>
          <button aria-label="Submit Form">Submit</button>
        </body>
      </html>
    `);

    const result = await healingSelector.findElement(
      page,
      '#nonexistent-id',
      {
        textContent: 'Submit Form',
        enableHealing: true,
      },
    );

    assert.strictEqual(result.healingApplied, true);
    assert.strictEqual(result.strategy?.strategy, 'aria');
    assert.notStrictEqual(result.element, null);
  });

  it('should heal selector using semantic strategy', {timeout: 10000}, async () => {
    // 🟢 WORKING: Should find button by text content when other strategies fail
    const [page] = await browser.pages();
    await page.goto('about:blank');

    await page.setContent(`
      <html>
        <body>
          <button>Click Me</button>
        </body>
      </html>
    `);

    const result = await healingSelector.findElement(
      page,
      '#nonexistent-id',
      {
        textContent: 'Click Me',
        enableHealing: true,
      },
    );

    assert.strictEqual(result.healingApplied, true);
    assert.strictEqual(result.strategy?.strategy, 'semantic');
    assert.notStrictEqual(result.element, null);
  });

  it('should cache successful healing strategies', {timeout: 10000}, async () => {
    // 🟢 WORKING: Should cache and reuse successful strategies
    const [page] = await browser.pages();
    await page.goto('about:blank');

    await page.setContent(`
      <html>
        <body>
          <button data-testid="cached-btn">Cached Button</button>
        </body>
      </html>
    `);

    // First call - will heal and cache
    const result1 = await healingSelector.findElement(
      page,
      '#nonexistent-id',
      {
        textContent: 'Cached Button',
        enableHealing: true,
      },
    );

    assert.strictEqual(result1.healingApplied, true);
    assert.notStrictEqual(result1.element, null);

    // Second call - should use cache
    const result2 = await healingSelector.findElement(
      page,
      '#nonexistent-id',
      {
        textContent: 'Cached Button',
        enableHealing: true,
      },
    );

    assert.strictEqual(result2.healingApplied, true);
    assert.ok(result2.attemptedStrategies.includes('cache'));
    assert.notStrictEqual(result2.element, null);

    // Verify cache stats
    const stats = healingSelector.getCacheStats();
    assert.ok(stats.totalEntries > 0);
  });

  it('should return null when all strategies fail', {timeout: 10000}, async () => {
    // 🟢 WORKING: Should return null when element truly doesn't exist
    const [page] = await browser.pages();
    await page.goto('about:blank');

    await page.setContent(`
      <html>
        <body>
          <p>No buttons here</p>
        </body>
      </html>
    `);

    const result = await healingSelector.findElement(
      page,
      '#nonexistent-id',
      {
        textContent: 'Nonexistent Element',
        enableHealing: true,
      },
    );

    assert.strictEqual(result.healingApplied, true);
    assert.strictEqual(result.element, null);
    assert.strictEqual(result.strategy, null);
    assert.ok(result.attemptedStrategies.length > 0);
  });

  it('should respect minimum confidence threshold', {timeout: 10000}, async () => {
    // 🟢 WORKING: Should skip strategies below confidence threshold
    const [page] = await browser.pages();
    await page.goto('about:blank');

    await page.setContent(`
      <html>
        <body>
          <button>Low Confidence Button</button>
        </body>
      </html>
    `);

    const result = await healingSelector.findElement(
      page,
      '#nonexistent-id',
      {
        textContent: 'Low Confidence Button',
        enableHealing: true,
        minConfidence: 0.95, // Very high threshold
      },
    );

    // Should have fewer attempted strategies due to confidence filtering
    assert.ok(result.attemptedStrategies.length < 7);
  });

  it('should clear cache when requested', {timeout: 5000}, async () => {
    // 🟢 WORKING: Cache clear should remove all entries
    healingSelector.clearCache();

    const stats = healingSelector.getCacheStats();
    assert.strictEqual(stats.totalEntries, 0);
  });
});
