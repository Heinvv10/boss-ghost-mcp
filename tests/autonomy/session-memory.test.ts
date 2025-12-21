/**
 * @license
 * Copyright 2025 BOSS Ghost MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, beforeEach, afterEach, beforeAll, afterAll} from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import puppeteer, {Browser, Page} from 'puppeteer';
import {SessionMemoryManager} from '../../src/utils/session-memory.js';

describe('Session Memory Persistence', () => {
  let browser: Browser;
  let page: Page;
  let memory: SessionMemoryManager;
  let testDir: string;

  beforeAll(async () => {
    browser = await puppeteer.launch({headless: true});
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `boss-ghost-test-${Date.now()}`);
    memory = new SessionMemoryManager(testDir);
    await memory.init();
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testDir, {recursive: true, force: true});
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Basic Save/Load', () => {
    it('should save and load session memory', async () => {
      const sessionData = {
        currentUrl: 'https://example.com',
        navigationHistory: ['https://example.com', 'https://example.com/page1'],
        formData: [],
        userData: {key: 'value'},
      };

      await memory.save('test-session', sessionData);
      const loaded = await memory.load('test-session');

      expect(loaded).not.toBeNull();
      expect(loaded?.currentUrl).toBe('https://example.com');
      expect(loaded?.navigationHistory).toEqual(sessionData.navigationHistory);
      expect(loaded?.userData).toEqual(sessionData.userData);
    });

    it('should return null for non-existent session', async () => {
      const loaded = await memory.load('non-existent-session');
      expect(loaded).toBeNull();
    });

    it('should create new session if not exists', async () => {
      await memory.save('new-session', {currentUrl: 'https://test.com'});
      const loaded = await memory.load('new-session');

      expect(loaded).not.toBeNull();
      expect(loaded?.sessionId).toBe('new-session');
      expect(loaded?.currentUrl).toBe('https://test.com');
    });

    it('should merge with existing session data', async () => {
      await memory.save('merge-session', {
        currentUrl: 'https://example.com',
        userData: {key1: 'value1'},
      });

      await memory.save('merge-session', {
        userData: {key2: 'value2'},
      });

      const loaded = await memory.load('merge-session');

      expect(loaded?.currentUrl).toBe('https://example.com');
      expect(loaded?.userData).toEqual({key2: 'value2'}); // Replaced, not merged
    });
  });

  describe('Session Metadata', () => {
    it('should set startTime on new session', async () => {
      const beforeTime = Date.now();
      await memory.save('time-session', {currentUrl: 'https://test.com'});
      const afterTime = Date.now();

      const loaded = await memory.load('time-session');

      expect(loaded?.startTime).toBeGreaterThanOrEqual(beforeTime);
      expect(loaded?.startTime).toBeLessThanOrEqual(afterTime);
    });

    it('should update lastUpdate on save', async () => {
      await memory.save('update-session', {currentUrl: 'https://test1.com'});
      const first = await memory.load('update-session');

      await new Promise(resolve => setTimeout(resolve, 10));

      await memory.save('update-session', {currentUrl: 'https://test2.com'});
      const second = await memory.load('update-session');

      expect(second?.lastUpdate).toBeGreaterThan(first!.lastUpdate);
    });
  });

  describe('Cookie Persistence', () => {
    it('should save and load cookies', async () => {
      await page.goto('https://example.com');
      await page.setCookie({
        name: 'test-cookie',
        value: 'cookie-value',
        domain: 'example.com',
      });

      await memory.saveCookies('cookie-session', page);

      const newPage = await browser.newPage();
      await memory.loadCookies('cookie-session', newPage);

      const cookies = await newPage.cookies('https://example.com');
      await newPage.close();

      expect(cookies).toContainEqual(
        expect.objectContaining({
          name: 'test-cookie',
          value: 'cookie-value',
        }),
      );
    });
  });

  describe('LocalStorage Persistence', () => {
    it('should save and load localStorage', async () => {
      await page.goto('https://example.com');
      await page.evaluate(() => {
        window.localStorage.setItem('key1', 'value1');
        window.localStorage.setItem('key2', 'value2');
      });

      await memory.saveLocalStorage('storage-session', page);

      const newPage = await browser.newPage();
      await newPage.goto('https://example.com');
      await memory.loadLocalStorage('storage-session', newPage);

      const storage = await newPage.evaluate(() => {
        return {
          key1: window.localStorage.getItem('key1'),
          key2: window.localStorage.getItem('key2'),
        };
      });
      await newPage.close();

      expect(storage.key1).toBe('value1');
      expect(storage.key2).toBe('value2');
    });
  });

  describe('Complete Page State', () => {
    it('should save and restore complete page state', async () => {
      await page.goto('https://example.com');
      await page.setContent(`
        <html>
          <body>
            <form>
              <input name="username" value="testuser">
              <input name="email" value="test@example.com">
            </form>
          </body>
        </html>
      `);

      await page.evaluate(() => {
        window.localStorage.setItem('token', 'abc123');
      });

      await memory.savePageState('complete-session', page, true);

      const newPage = await browser.newPage();
      await memory.restorePageState('complete-session', newPage, true);

      const restoredData = await newPage.evaluate(() => {
        const inputs = document.querySelectorAll('input');
        return {
          url: window.location.href,
          username: (inputs[0] as HTMLInputElement)?.value,
          email: (inputs[1] as HTMLInputElement)?.value,
          token: window.localStorage.getItem('token'),
        };
      });
      await newPage.close();

      expect(restoredData.url).toBe('https://example.com/');
      expect(restoredData.username).toBe('testuser');
      expect(restoredData.email).toBe('test@example.com');
      expect(restoredData.token).toBe('abc123');
    });

    it('should skip form data when restoreFormData is false', async () => {
      await page.goto('https://example.com');
      await page.setContent(`
        <html>
          <body>
            <input name="username" value="testuser">
          </body>
        </html>
      `);

      await memory.savePageState('no-form-session', page, true);

      const newPage = await browser.newPage();
      await memory.restorePageState('no-form-session', newPage, false);

      const username = await newPage.evaluate(() => {
        const input = document.querySelector('input[name="username"]');
        return (input as HTMLInputElement)?.value;
      });
      await newPage.close();

      expect(username).toBe(''); // Should not restore form data
    });
  });

  describe('Session Management', () => {
    it('should list all sessions', async () => {
      await memory.save('session-1', {currentUrl: 'https://test1.com'});
      await memory.save('session-2', {currentUrl: 'https://test2.com'});
      await memory.save('session-3', {currentUrl: 'https://test3.com'});

      const sessions = await memory.list();

      expect(sessions).toHaveLength(3);
      expect(sessions).toContain('session-1');
      expect(sessions).toContain('session-2');
      expect(sessions).toContain('session-3');
    });

    it('should delete session', async () => {
      await memory.save('delete-me', {currentUrl: 'https://test.com'});

      let loaded = await memory.load('delete-me');
      expect(loaded).not.toBeNull();

      await memory.delete('delete-me');

      loaded = await memory.load('delete-me');
      expect(loaded).toBeNull();
    });

    it('should handle delete of non-existent session', async () => {
      await expect(memory.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('Cleanup', () => {
    it('should cleanup old sessions', async () => {
      // Create old session
      await memory.save('old-session', {currentUrl: 'https://old.com'});

      // Manually set lastUpdate to 2 hours ago
      const session = await memory.load('old-session');
      session!.lastUpdate = Date.now() - 2 * 60 * 60 * 1000;
      await memory.save('old-session', session!);

      // Create recent session
      await memory.save('recent-session', {currentUrl: 'https://recent.com'});

      // Cleanup sessions older than 1 hour
      const deleted = await memory.cleanup(60 * 60 * 1000);

      expect(deleted).toBe(1);

      const sessions = await memory.list();
      expect(sessions).toContain('recent-session');
      expect(sessions).not.toContain('old-session');
    });

    it('should not cleanup recent sessions', async () => {
      await memory.save('recent-1', {currentUrl: 'https://test1.com'});
      await memory.save('recent-2', {currentUrl: 'https://test2.com'});

      const deleted = await memory.cleanup(60 * 60 * 1000);

      expect(deleted).toBe(0);

      const sessions = await memory.list();
      expect(sessions).toHaveLength(2);
    });
  });

  describe('ElementCache', () => {
    it('should persist element cache', async () => {
      const elementCache = new Map();
      elementCache.set('button-1', {
        selector: '#submit-btn',
        boundingBox: {x: 10, y: 20, width: 100, height: 40},
        timestamp: Date.now(),
      });

      await memory.save('cache-session', {elementCache});

      const loaded = await memory.load('cache-session');

      expect(loaded?.elementCache).toBeInstanceOf(Map);
      expect(loaded?.elementCache.get('button-1')).toEqual(
        expect.objectContaining({
          selector: '#submit-btn',
          boundingBox: {x: 10, y: 20, width: 100, height: 40},
        }),
      );
    });
  });

  describe('Storage Directory', () => {
    it('should return storage directory path', () => {
      const dir = memory.getStorageDir();
      expect(dir).toBe(testDir);
    });

    it('should create storage directory if not exists', async () => {
      const newTestDir = path.join(os.tmpdir(), `boss-ghost-new-${Date.now()}`);
      const newMemory = new SessionMemoryManager(newTestDir);

      await newMemory.init();

      const stats = await fs.stat(newTestDir);
      expect(stats.isDirectory()).toBe(true);

      await fs.rm(newTestDir, {recursive: true, force: true});
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty session data', async () => {
      await memory.save('empty-session', {});
      const loaded = await memory.load('empty-session');

      expect(loaded).not.toBeNull();
      expect(loaded?.sessionId).toBe('empty-session');
    });

    it('should handle special characters in session ID', async () => {
      const sessionId = 'session:special-123_test';
      await memory.save(sessionId, {currentUrl: 'https://test.com'});
      const loaded = await memory.load(sessionId);

      expect(loaded).not.toBeNull();
      expect(loaded?.sessionId).toBe(sessionId);
    });

    it('should handle very large session data', async () => {
      const largeData = {
        navigationHistory: Array.from({length: 1000}, (_, i) => `https://example.com/page${i}`),
        userData: Object.fromEntries(
          Array.from({length: 100}, (_, i) => [`key${i}`, `value${i}`]),
        ),
      };

      await memory.save('large-session', largeData);
      const loaded = await memory.load('large-session');

      expect(loaded?.navigationHistory).toHaveLength(1000);
      expect(Object.keys(loaded!.userData)).toHaveLength(100);
    });
  });
});
