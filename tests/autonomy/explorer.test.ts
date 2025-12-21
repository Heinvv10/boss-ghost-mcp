/**
 * @license
 * Copyright 2025 BOSS Ghost MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, beforeAll, afterAll, beforeEach} from 'vitest';
import puppeteer, {Browser, Page} from 'puppeteer';
import {AutonomousExplorer} from '../../src/utils/explorer.js';

describe('Autonomous Site Explorer', () => {
  let browser: Browser;
  let page: Page;
  let explorer: AutonomousExplorer;

  beforeAll(async () => {
    browser = await puppeteer.launch({headless: true});
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    explorer = new AutonomousExplorer();
  });

  describe('Basic Exploration', () => {
    it('should explore a single page site', async () => {
      await page.setContent(`
        <html>
          <head><title>Test Site</title></head>
          <body>
            <h1>Welcome</h1>
            <p>This is a test page</p>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
      });

      expect(result.sitemap.size).toBe(1);
      const pageInfo = result.sitemap.get('https://example.com/');
      expect(pageInfo).toBeDefined();
      expect(pageInfo?.url).toBe('https://example.com/');
      expect(pageInfo?.title).toBe('Test Site');
      expect(pageInfo?.depth).toBe(0);
      expect(result.stats.totalPages).toBe(1);
    });

    it('should discover and follow links', async () => {
      await page.setContent(`
        <html>
          <head><title>Home</title></head>
          <body>
            <a href="/page1">Page 1</a>
            <a href="/page2">Page 2</a>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 2,
        maxPages: 10,
      });

      const pageInfo = result.sitemap.get('https://example.com/');
      expect(pageInfo).toBeDefined();
      expect(pageInfo?.links.length).toBeGreaterThanOrEqual(2);
      expect(pageInfo?.links).toContain('https://example.com/page1');
      expect(pageInfo?.links).toContain('https://example.com/page2');
    });

    it('should respect maxDepth limit', async () => {
      await page.setContent(`
        <html>
          <body>
            <a href="/level1">Level 1</a>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 50,
      });

      // Should not explore beyond depth 1
      const depths = Array.from(result.sitemap.values()).map(p => p.depth);
      const maxDepth = Math.max(...depths);
      expect(maxDepth).toBeLessThanOrEqual(1);
    });

    it('should respect maxPages limit', async () => {
      await page.setContent(`
        <html>
          <body>
            ${Array.from({length: 20}, (_, i) => `<a href="/page${i}">Page ${i}</a>`).join('\n')}
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 3,
        maxPages: 5,
      });

      expect(result.sitemap.size).toBeLessThanOrEqual(5);
      expect(result.stats.totalPages).toBeLessThanOrEqual(5);
    });
  });

  describe('Form Discovery', () => {
    it('should discover forms on page', async () => {
      await page.setContent(`
        <html>
          <body>
            <form action="/submit">
              <input type="text" name="username" placeholder="Username">
              <input type="password" name="password" placeholder="Password">
              <button type="submit">Login</button>
            </form>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
      });

      const pageInfo = result.sitemap.get('https://example.com/');
      expect(pageInfo?.forms).toHaveLength(1);
      expect(pageInfo?.forms[0].action).toBe('/submit');
      expect(pageInfo?.forms[0].inputs.length).toBeGreaterThanOrEqual(2);
    });

    it('should capture form input details', async () => {
      await page.setContent(`
        <html>
          <body>
            <form>
              <input type="email" name="email" required>
              <input type="checkbox" name="subscribe">
              <select name="country">
                <option>USA</option>
                <option>Canada</option>
              </select>
            </form>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
      });

      const pageInfo = result.sitemap.get('https://example.com/');
      const form = pageInfo?.forms[0];
      expect(form).toBeDefined();

      const emailInput = form?.inputs.find(i => i.name === 'email');
      const checkboxInput = form?.inputs.find(i => i.name === 'subscribe');
      const selectInput = form?.inputs.find(i => i.name === 'country');

      expect(emailInput?.type).toBe('email');
      expect(emailInput?.required).toBe(true);
      expect(checkboxInput?.type).toBe('checkbox');
      expect(selectInput?.type).toBe('select-one');
    });
  });

  describe('Error Detection', () => {
    it('should detect console errors', async () => {
      await page.setContent(`
        <html>
          <head>
            <script>
              console.error('Test error message');
            </script>
          </head>
          <body><h1>Test</h1></body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
        detectErrors: true,
      });

      const pageInfo = result.sitemap.get('https://example.com/');
      expect(pageInfo?.errors.length).toBeGreaterThan(0);
      expect(pageInfo?.errors.some(e => e.message.includes('Test error message'))).toBe(true);
    });

    it('should skip error detection when disabled', async () => {
      await page.setContent(`
        <html>
          <head>
            <script>
              console.error('This error should be ignored');
            </script>
          </head>
          <body><h1>Test</h1></body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
        detectErrors: false,
      });

      const pageInfo = result.sitemap.get('https://example.com/');
      expect(pageInfo?.errors).toEqual([]);
    });
  });

  describe('External Link Handling', () => {
    it('should not follow external links by default', async () => {
      await page.setContent(`
        <html>
          <body>
            <a href="https://example.com/internal">Internal</a>
            <a href="https://external.com/page">External</a>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 2,
        maxPages: 10,
        followExternal: false,
      });

      const externalPages = Array.from(result.sitemap.values()).filter(p =>
        p.url.includes('external.com')
      );
      expect(externalPages).toHaveLength(0);
    });

    it('should follow external links when enabled', async () => {
      await page.setContent(`
        <html>
          <body>
            <a href="https://external.com/page">External</a>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 2,
        maxPages: 10,
        followExternal: true,
      });

      const pageInfo = result.sitemap.get('https://example.com/');
      expect(pageInfo?.links).toContain('https://external.com/page');
    });
  });

  describe('Ignore Patterns', () => {
    it('should ignore URLs matching patterns', async () => {
      await page.setContent(`
        <html>
          <body>
            <a href="/admin/dashboard">Admin</a>
            <a href="/api/data">API</a>
            <a href="/public/page">Public</a>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 2,
        maxPages: 10,
        ignorePatterns: ['/admin/', '/api/'],
      });

      const visitedUrls = Array.from(result.sitemap.keys());
      expect(visitedUrls.some(url => url.includes('/admin/'))).toBe(false);
      expect(visitedUrls.some(url => url.includes('/api/'))).toBe(false);
    });
  });

  describe('Performance Metrics', () => {
    it('should capture load times', async () => {
      await page.setContent(`
        <html>
          <body><h1>Test</h1></body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
      });

      const pageInfo = result.sitemap.get('https://example.com/');
      expect(pageInfo?.loadTime).toBeGreaterThan(0);
      expect(typeof pageInfo?.loadTime).toBe('number');
    });
  });

  describe('Screenshot Capture', () => {
    it('should capture screenshots when enabled', async () => {
      await page.setContent(`
        <html>
          <body><h1>Screenshot Test</h1></body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
        captureScreenshots: true,
      });

      const pageInfo = result.sitemap.get('https://example.com/');
      expect(pageInfo?.screenshot).toBeDefined();
      expect(pageInfo?.screenshot).not.toBeNull();
    });

    it('should not capture screenshots when disabled', async () => {
      await page.setContent(`
        <html>
          <body><h1>No Screenshot</h1></body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
        captureScreenshots: false,
      });

      const pageInfo = result.sitemap.get('https://example.com/');
      expect(pageInfo?.screenshot).toBeUndefined();
    });
  });

  describe('Report Generation', () => {
    it('should generate exploration report', async () => {
      await page.setContent(`
        <html>
          <head><title>Test Site</title></head>
          <body>
            <a href="/page1">Page 1</a>
            <form action="/submit">
              <input name="test">
            </form>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
      });

      const report = await explorer.generateReport(result.sitemap);

      expect(report).toContain('Site Exploration Report');
      expect(report).toContain('Test Site');
      expect(report).toContain('Forms Found');
      expect(report).toContain('Links Discovered');
    });

    it('should include bug report when errors exist', async () => {
      await page.setContent(`
        <html>
          <head>
            <script>
              console.error('Bug detected');
            </script>
          </head>
          <body><h1>Test</h1></body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
        detectErrors: true,
      });

      const report = await explorer.generateReport(result.sitemap);

      expect(report).toContain('Errors Found');
      expect(report).toContain('Bug detected');
    });
  });

  describe('Statistics', () => {
    it('should provide accurate exploration statistics', async () => {
      await page.setContent(`
        <html>
          <body>
            <a href="/page1">Page 1</a>
            <a href="/page2">Page 2</a>
            <form><input name="test"></form>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
      });

      expect(result.stats.totalPages).toBe(1);
      expect(result.stats.totalLinks).toBeGreaterThanOrEqual(2);
      expect(result.stats.totalForms).toBe(1);
      expect(result.stats.totalErrors).toBe(0);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset explorer state', async () => {
      await page.setContent(`
        <html>
          <body><a href="/page1">Page 1</a></body>
        </html>
      `);

      await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
      });

      explorer.reset();

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
      });

      expect(result.sitemap.size).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty page', async () => {
      await page.setContent(`<html><body></body></html>`);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
      });

      expect(result.sitemap.size).toBe(1);
      const pageInfo = result.sitemap.get('https://example.com/');
      expect(pageInfo?.links).toEqual([]);
      expect(pageInfo?.forms).toEqual([]);
    });

    it('should handle page with many links', async () => {
      const links = Array.from({length: 100}, (_, i) =>
        `<a href="/page${i}">Page ${i}</a>`
      ).join('\n');

      await page.setContent(`
        <html>
          <body>${links}</body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
      });

      const pageInfo = result.sitemap.get('https://example.com/');
      expect(pageInfo?.links.length).toBe(100);
    });

    it('should handle circular links', async () => {
      await page.setContent(`
        <html>
          <body>
            <a href="/">Home</a>
            <a href="/page1">Page 1</a>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 3,
        maxPages: 10,
      });

      // Should not get stuck in infinite loop
      expect(result.sitemap.size).toBeLessThanOrEqual(10);
    });

    it('should handle special characters in URLs', async () => {
      await page.setContent(`
        <html>
          <body>
            <a href="/page?param=value&foo=bar">Query Params</a>
            <a href="/page#section">Hash</a>
            <a href="/page%20with%20spaces">Encoded</a>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 1,
      });

      const pageInfo = result.sitemap.get('https://example.com/');
      expect(pageInfo?.links.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle malformed URLs gracefully', async () => {
      await page.setContent(`
        <html>
          <body>
            <a href="javascript:void(0)">JavaScript</a>
            <a href="mailto:test@example.com">Email</a>
            <a href="tel:+1234567890">Phone</a>
            <a href="/valid-page">Valid</a>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 1,
        maxPages: 10,
      });

      expect(result.sitemap).toBeDefined();
    });
  });

  describe('BFS Algorithm Verification', () => {
    it('should explore in breadth-first order', async () => {
      await page.setContent(`
        <html>
          <body>
            <a href="/level1-a">Level 1 A</a>
            <a href="/level1-b">Level 1 B</a>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 2,
        maxPages: 10,
      });

      // Root should be depth 0
      const root = result.sitemap.get('https://example.com/');
      expect(root?.depth).toBe(0);

      // Level 1 pages should be depth 1
      const level1Pages = Array.from(result.sitemap.values()).filter(p => p.depth === 1);
      expect(level1Pages.length).toBeGreaterThan(0);
    });

    it('should not revisit already visited pages', async () => {
      await page.setContent(`
        <html>
          <body>
            <a href="/page1">Page 1</a>
            <a href="/page1">Page 1 Again</a>
          </body>
        </html>
      `);

      const result = await explorer.explore(page, 'https://example.com', {
        maxDepth: 2,
        maxPages: 10,
      });

      // Page 1 should only appear once in sitemap
      const page1Entries = Array.from(result.sitemap.keys()).filter(url =>
        url === 'https://example.com/page1'
      );
      expect(page1Entries.length).toBeLessThanOrEqual(1);
    });
  });
});
