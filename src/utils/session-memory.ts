/**
 * @license
 * Copyright 2025 BOSS Ghost MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {logger} from '../logger.js';
import type {Page} from '../third_party/index.js';

/**
 * Element cache entry
 */
export interface ElementCacheEntry {
  selector: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  timestamp: number;
}

/**
 * Form data entry
 */
export interface FormDataEntry {
  selector: string;
  value: any;
  type: string; // input, textarea, select, etc.
}

/**
 * Session memory structure
 */
export interface SessionMemory {
  sessionId: string;
  startTime: number;
  lastUpdate: number;
  currentUrl: string;
  navigationHistory: string[];
  formData: FormDataEntry[];
  elementCache: Map<string, ElementCacheEntry>;
  userData: Record<string, any>;
  cookies?: any[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  htmlContent?: string; // ✅ Store HTML content for full restoration
}

/**
 * Memory limits for session data to prevent unbounded growth
 * These limits ensure long-running sessions don't exhaust memory
 */
export const SESSION_MEMORY_LIMITS = {
  /** Maximum element cache entries per session */
  MAX_ELEMENT_CACHE_SIZE: 500,
  /** Maximum navigation history entries */
  MAX_NAVIGATION_HISTORY: 100,
  /** Maximum form data entries */
  MAX_FORM_DATA_ENTRIES: 200,
  /** Maximum HTML content size in bytes (5MB) */
  MAX_HTML_CONTENT_SIZE: 5 * 1024 * 1024,
} as const;

/**
 * Session Memory Manager
 *
 * Persists browser session state to disk for:
 * - Session resumption after crashes
 * - Form data recovery
 * - Navigation history tracking
 * - Element caching
 * - Cookie and storage persistence
 *
 * Storage location: ~/.boss-ghost-mcp/sessions/
 *
 * @example
 * ```typescript
 * const memory = new SessionMemoryManager();
 *
 * // Save session state
 * await memory.save('session-123', {
 *   currentUrl: 'https://example.com',
 *   formData: [{ selector: '#email', value: 'user@example.com', type: 'input' }]
 * });
 *
 * // Load session state
 * const session = await memory.load('session-123');
 * if (session) {
 *   console.log('Resumed session:', session.currentUrl);
 * }
 * ```
 */
export class SessionMemoryManager {
  private storageDir: string;

  constructor(storageDir?: string) {
    // Default storage directory: ~/.boss-ghost-mcp/sessions/
    this.storageDir =
      storageDir ||
      path.join(
        process.env.HOME || process.env.USERPROFILE || '.',
        '.boss-ghost-mcp',
        'sessions',
      );
  }

  /**
   * Initialize storage directory
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, {recursive: true});
    } catch (error) {
      logger('[SESSION] Failed to create storage directory: ' + String(error));
      throw error;
    }
  }

  /**
   * Save session memory to disk
   *
   * @param sessionId - Unique session identifier
   * @param memory - Partial session memory to save (merged with existing)
   */
  async save(
    sessionId: string,
    memory: Partial<SessionMemory>,
  ): Promise<void> {
    await this.init();

    // Load existing session or create new
    let existing = await this.load(sessionId);
    if (!existing) {
      existing = {
        sessionId,
        startTime: Date.now(),
        lastUpdate: Date.now(),
        currentUrl: '',
        navigationHistory: [],
        formData: [],
        elementCache: new Map(),
        userData: {},
      };
    }

    // Merge with new data
    const updated: SessionMemory = {
      ...existing,
      ...memory,
      sessionId, // Ensure sessionId is preserved
      // ✅ FIX: Only update lastUpdate if not explicitly provided in memory
      lastUpdate: memory.lastUpdate !== undefined ? memory.lastUpdate : Date.now(),
    };

    // ✅ Apply memory limits to prevent unbounded growth in long-running sessions
    this.applyMemoryLimits(updated);

    // Convert Map to object for JSON serialization
    const serializable = {
      ...updated,
      elementCache: Array.from(updated.elementCache.entries()),
    };

    const filePath = this.getSessionPath(sessionId);
    await fs.writeFile(filePath, JSON.stringify(serializable, null, 2), 'utf-8');
    logger('[SESSION] Saved session ' + sessionId + ' to ' + filePath);
  }

  /**
   * Load session memory from disk
   *
   * @param sessionId - Session identifier
   * @returns Session memory or null if not found
   */
  async load(sessionId: string): Promise<SessionMemory | null> {
    const filePath = this.getSessionPath(sessionId);

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);

      // Reconstruct Map from array
      parsed.elementCache = new Map(parsed.elementCache || []);

      return parsed as SessionMemory;
    } catch (error) {
      // Type-safe error handling for NodeJS file system errors
      if (
        error instanceof Error &&
        'code' in error &&
        (error as any).code === 'ENOENT'
      ) {
        return null; // Session not found
      }
      logger('[SESSION] Failed to load session ' + sessionId + ': ' + String(error));
      throw error;
    }
  }

  /**
   * Delete session from disk
   *
   * @param sessionId - Session identifier
   */
  async delete(sessionId: string): Promise<void> {
    const filePath = this.getSessionPath(sessionId);

    try {
      await fs.unlink(filePath);
      logger('[SESSION] Deleted session ' + sessionId);
    } catch (error) {
      // Type-safe error handling for NodeJS file system errors
      if (
        !(
          error instanceof Error &&
          'code' in error &&
          (error as any).code === 'ENOENT'
        )
      ) {
        logger('[SESSION] Failed to delete session ' + sessionId + ': ' + String(error));
        throw error;
      }
      // ENOENT is silently ignored (session already doesn't exist)
    }
  }

  /**
   * List all saved sessions
   *
   * @returns Array of session IDs
   */
  async list(): Promise<string[]> {
    await this.init();

    try {
      const files = await fs.readdir(this.storageDir);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
    } catch (error) {
      logger('[SESSION] Failed to list sessions: ' + String(error));
      return [];
    }
  }

  /**
   * Save cookies from page
   *
   * @param sessionId - Session identifier
   * @param page - Puppeteer page instance
   */
  async saveCookies(sessionId: string, page: Page): Promise<void> {
    const cookies = await page.cookies();
    await this.save(sessionId, {cookies});
    logger('[SESSION] Saved ' + cookies.length + ' cookies for ' + sessionId);
  }

  /**
   * Load and set cookies to page
   *
   * @param sessionId - Session identifier
   * @param page - Puppeteer page instance
   */
  async loadCookies(sessionId: string, page: Page): Promise<void> {
    const session = await this.load(sessionId);
    if (session?.cookies) {
      await page.setCookie(...session.cookies);
      logger('[SESSION] Loaded ' + session.cookies.length + ' cookies for ' + sessionId);
    }
  }

  /**
   * Save localStorage from page
   *
   * @param sessionId - Session identifier
   * @param page - Puppeteer page instance
   */
  async saveLocalStorage(sessionId: string, page: Page): Promise<void> {
    const localStorage = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) {
          items[key] = window.localStorage.getItem(key) || '';
        }
      }
      return items;
    });

    await this.save(sessionId, {localStorage});
    logger('[SESSION] Saved ' + Object.keys(localStorage).length + ' localStorage items for ' + sessionId);
  }

  /**
   * Load and set localStorage to page
   *
   * @param sessionId - Session identifier
   * @param page - Puppeteer page instance
   */
  async loadLocalStorage(sessionId: string, page: Page): Promise<void> {
    const session = await this.load(sessionId);
    if (session?.localStorage) {
      await page.evaluate((items: Record<string, string>) => {
        for (const [key, value] of Object.entries(items)) {
          window.localStorage.setItem(key, value);
        }
      }, session.localStorage);

      logger('[SESSION] Loaded ' + Object.keys(session.localStorage).length + ' localStorage items for ' + sessionId);
    }
  }

  /**
   * Save complete page state
   *
   * @param sessionId - Session identifier
   * @param page - Puppeteer page instance
   * @param includeFormData - Whether to capture form data
   */
  async savePageState(
    sessionId: string,
    page: Page,
    includeFormData: boolean = true,
  ): Promise<void> {
    const currentUrl = page.url();
    let formData: FormDataEntry[] = [];
    let htmlContent: string | undefined;

    // ✅ Capture HTML content for full restoration
    htmlContent = await page.content();

    if (includeFormData) {
      formData = await page.evaluate(() => {
        const forms: FormDataEntry[] = [];
        const inputs = document.querySelectorAll('input, textarea, select');

        inputs.forEach(input => {
          const element = input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          const selector = element.id
            ? `#${element.id}`
            : element.name
              ? `[name="${element.name}"]`
              : element.tagName.toLowerCase();

          forms.push({
            selector,
            value: (element as HTMLInputElement).value,
            type: element.tagName.toLowerCase(),
          });
        });

        return forms;
      });
    }

    await this.save(sessionId, {currentUrl, formData, htmlContent});
    await this.saveCookies(sessionId, page);
    await this.saveLocalStorage(sessionId, page);

    logger('[SESSION] Saved complete page state for ' + sessionId);
  }

  /**
   * Restore page state
   *
   * @param sessionId - Session identifier
   * @param page - Puppeteer page instance
   * @param restoreFormData - Whether to restore form data
   */
  async restorePageState(
    sessionId: string,
    page: Page,
    restoreFormData: boolean = true,
  ): Promise<void> {
    const session = await this.load(sessionId);
    if (!session) {
      logger('[SESSION] No saved state found for ' + sessionId);
      return;
    }

    // Restore cookies first
    await this.loadCookies(sessionId, page);

    // ✅ FIX: Honor restoreFormData flag when restoring HTML content
    if (session.htmlContent && !restoreFormData) {
      // When restoreFormData is false, strip form values from HTML before restoring
      // Navigate to URL first to set the origin
      if (session.currentUrl) {
        await page.goto(session.currentUrl, {waitUntil: 'domcontentloaded'});
      }

      // Strip form values using page.evaluate to modify DOM
      const htmlWithoutFormData = await page.evaluate((html: string) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Clear all input/textarea/select values
        const inputs = doc.querySelectorAll('input, textarea, select');
        inputs.forEach((input) => {
          if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
            input.value = '';
            input.removeAttribute('value');
          } else if (input instanceof HTMLSelectElement) {
            input.selectedIndex = -1;
          }
        });

        return doc.documentElement.outerHTML;
      }, session.htmlContent);

      await page.setContent(htmlWithoutFormData, {waitUntil: 'domcontentloaded'});
    } else if (session.htmlContent) {
      // Normal restoration with form data
      // Navigate to URL first to set the origin
      if (session.currentUrl) {
        await page.goto(session.currentUrl, {waitUntil: 'domcontentloaded'});
      }
      // Then set the saved HTML content
      await page.setContent(session.htmlContent, {waitUntil: 'domcontentloaded'});
    } else {
      // Fallback: Just navigate to saved URL
      if (session.currentUrl) {
        await page.goto(session.currentUrl, {waitUntil: 'domcontentloaded'});
      }
    }

    // Restore localStorage
    await this.loadLocalStorage(sessionId, page);

    // Restore form data
    if (restoreFormData && session.formData.length > 0) {
      // ✅ Wait for page to be ready before restoring form data
      await page.waitForSelector('body', {timeout: 5000}).catch(() => {
        logger('[SESSION] Page body not ready for form restoration');
      });

      // ✅ Restore form data with better error handling
      const restoredCount = await page.evaluate((formDataEntries: FormDataEntry[]) => {
        let count = 0;
        formDataEntries.forEach(entry => {
          const element = document.querySelector(entry.selector) as
            | HTMLInputElement
            | HTMLTextAreaElement
            | HTMLSelectElement
            | null;
          if (element) {
            element.value = entry.value;
            count++;
          }
        });
        return count;
      }, session.formData);

      logger('[SESSION] Restored ' + restoredCount + '/' + session.formData.length + ' form fields for ' + sessionId);
    }

    logger('[SESSION] Restored complete page state for ' + sessionId);
  }

  /**
   * Cleanup old sessions
   *
   * @param olderThan - Delete sessions older than this many milliseconds
   * @returns Number of sessions deleted
   */
  async cleanup(olderThan: number): Promise<number> {
    const sessions = await this.list();
    let deleted = 0;

    for (const sessionId of sessions) {
      const session = await this.load(sessionId);
      if (session && Date.now() - session.lastUpdate > olderThan) {
        await this.delete(sessionId);
        deleted++;
      }
    }

    logger('[SESSION] Cleaned up ' + deleted + ' old sessions');
    return deleted;
  }

  /**
   * Get session file path
   */
  private getSessionPath(sessionId: string): string {
    return path.join(this.storageDir, `${sessionId}.json`);
  }

  /**
   * Get storage directory path
   */
  getStorageDir(): string {
    return this.storageDir;
  }

  /**
   * Apply memory limits to session data
   * Prevents unbounded growth in long-running sessions by trimming
   * collections to their maximum allowed sizes (oldest entries removed first)
   *
   * @param session - Session memory to enforce limits on (modified in place)
   */
  private applyMemoryLimits(session: SessionMemory): void {
    // Limit element cache (remove oldest entries based on timestamp)
    if (session.elementCache.size > SESSION_MEMORY_LIMITS.MAX_ELEMENT_CACHE_SIZE) {
      const entries = Array.from(session.elementCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);

      const toRemove = entries.length - SESSION_MEMORY_LIMITS.MAX_ELEMENT_CACHE_SIZE;
      for (let i = 0; i < toRemove; i++) {
        session.elementCache.delete(entries[i][0]);
      }

      logger(
        `[SESSION] Trimmed element cache from ${entries.length} to ${session.elementCache.size} entries`
      );
    }

    // Limit navigation history (keep most recent)
    if (session.navigationHistory.length > SESSION_MEMORY_LIMITS.MAX_NAVIGATION_HISTORY) {
      const removed = session.navigationHistory.length - SESSION_MEMORY_LIMITS.MAX_NAVIGATION_HISTORY;
      session.navigationHistory = session.navigationHistory.slice(-SESSION_MEMORY_LIMITS.MAX_NAVIGATION_HISTORY);
      logger(`[SESSION] Trimmed navigation history by ${removed} entries`);
    }

    // Limit form data entries (keep most recent)
    if (session.formData.length > SESSION_MEMORY_LIMITS.MAX_FORM_DATA_ENTRIES) {
      const removed = session.formData.length - SESSION_MEMORY_LIMITS.MAX_FORM_DATA_ENTRIES;
      session.formData = session.formData.slice(-SESSION_MEMORY_LIMITS.MAX_FORM_DATA_ENTRIES);
      logger(`[SESSION] Trimmed form data by ${removed} entries`);
    }

    // Limit HTML content size
    if (
      session.htmlContent &&
      session.htmlContent.length > SESSION_MEMORY_LIMITS.MAX_HTML_CONTENT_SIZE
    ) {
      logger(
        `[SESSION] HTML content (${session.htmlContent.length} bytes) exceeds limit ` +
        `(${SESSION_MEMORY_LIMITS.MAX_HTML_CONTENT_SIZE} bytes), truncating`
      );
      session.htmlContent = session.htmlContent.substring(
        0,
        SESSION_MEMORY_LIMITS.MAX_HTML_CONTENT_SIZE
      );
    }
  }
}
