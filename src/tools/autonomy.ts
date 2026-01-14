/**
 * @license
 * Copyright 2025 BOSS Ghost MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';
import {AutonomousExplorer} from '../utils/explorer.js';
import {SessionMemoryManager} from '../utils/session-memory.js';
import {CaptchaDetector} from '../utils/captcha.js';
import {SelfHealingSelector} from '../utils/selectors.js';
import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

/**
 * Phase 2: Autonomous Site Explorer
 *
 * Automatically explores a website using breadth-first search (BFS):
 * - Discovers all pages and links
 * - Detects forms and inputs
 * - Identifies console errors and broken links
 * - Generates comprehensive sitemap and bug report
 */
export const autonomousExplore = defineTool({
  name: 'autonomous_explore',
  description: `Autonomously explore a website starting from a URL. Uses breadth-first search to discover pages, links, forms, and errors. Generates a comprehensive sitemap and bug report.`,
  annotations: {
    title: 'Autonomous Site Explorer',
    category: ToolCategory.INPUT,
    readOnlyHint: true,
  },
  schema: {
    startUrl: zod
      .string()
      .url()
      .describe('Starting URL to explore from'),
    maxDepth: zod
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(3)
      .describe('Maximum depth to explore (default: 3)'),
    maxPages: zod
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .default(50)
      .describe('Maximum number of pages to visit (default: 50)'),
    followExternal: zod
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to follow external links (default: false)'),
    captureScreenshots: zod
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to capture screenshots of pages (default: false)'),
    detectErrors: zod
      .boolean()
      .optional()
      .default(true)
      .describe('Whether to detect console errors (default: true)'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const explorer = new AutonomousExplorer();

    response.appendResponseLine(`[EXPLORER] Starting autonomous exploration from ${request.params.startUrl}`);
    response.appendResponseLine(`[EXPLORER] Config: maxDepth=${request.params.maxDepth}, maxPages=${request.params.maxPages}`);

    const result = await explorer.explore(page, request.params.startUrl, {
      maxDepth: request.params.maxDepth,
      maxPages: request.params.maxPages,
      followExternal: request.params.followExternal,
      captureScreenshots: request.params.captureScreenshots,
      detectErrors: request.params.detectErrors,
      ignorePatterns: [],
      respectRobotsTxt: true,
      timeout: 30000,
    });

    response.appendResponseLine(`\n[EXPLORER] Exploration complete!`);
    response.appendResponseLine(`[EXPLORER] Discovered ${result.stats.totalPages} pages`);
    response.appendResponseLine(`[EXPLORER] Found ${result.stats.totalLinks} links`);
    response.appendResponseLine(`[EXPLORER] Found ${result.stats.totalForms} forms`);
    response.appendResponseLine(`[EXPLORER] Detected ${result.stats.totalErrors} errors`);

    if (result.brokenLinks.length > 0) {
      response.appendResponseLine(`[EXPLORER] Found ${result.brokenLinks.length} broken links`);
    }

    // Generate detailed report
    const report = await explorer.generateReport(result.sitemap);
    response.appendResponseLine(`\n${report}`);

    response.includeSnapshot();
  },
});

/**
 * Phase 2: Session Memory - Save Page State
 *
 * Save the current browser page state including:
 * - Form data
 * - Scroll positions
 * - Current URL
 */
export const savePageState = defineTool({
  name: 'save_page_state',
  description: `Save the current page state including form data, scroll positions, and URL. Can be restored later to resume work.`,
  annotations: {
    title: 'Save Page State',
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    sessionId: zod
      .string()
      .describe('Unique identifier for this session'),
    includeFormData: zod
      .boolean()
      .optional()
      .default(true)
      .describe('Whether to save form data (default: true)'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const memory = new SessionMemoryManager();

    await memory.savePageState(
      request.params.sessionId,
      page,
      request.params.includeFormData,
    );

    response.appendResponseLine(`[SESSION] Saved page state for session '${request.params.sessionId}'`);
    response.appendResponseLine(`[SESSION] Current URL: ${page.url()}`);

    if (request.params.includeFormData) {
      response.appendResponseLine(`[SESSION] Form data saved`);
    }

    response.includeSnapshot();
  },
});

/**
 * Phase 2: Session Memory - Restore Page State
 *
 * Restore a previously saved page state
 */
export const restorePageState = defineTool({
  name: 'restore_page_state',
  description: `Restore a previously saved page state. Navigates to URL and restores form data and scroll position.`,
  annotations: {
    title: 'Restore Page State',
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    sessionId: zod
      .string()
      .describe('Unique identifier of the session to restore'),
    restoreFormData: zod
      .boolean()
      .optional()
      .default(true)
      .describe('Whether to restore form data (default: true)'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const memory = new SessionMemoryManager();

    const session = await memory.load(request.params.sessionId);

    if (!session) {
      throw new Error(`Session '${request.params.sessionId}' not found`);
    }

    await memory.restorePageState(
      request.params.sessionId,
      page,
      request.params.restoreFormData,
    );

    response.appendResponseLine(`[SESSION] Restored page state for session '${request.params.sessionId}'`);
    response.appendResponseLine(`[SESSION] Navigated to: ${session.currentUrl}`);

    if (request.params.restoreFormData && session.formData.length > 0) {
      response.appendResponseLine(`[SESSION] Restored ${session.formData.length} form fields`);
    }

    response.includeSnapshot();
  },
});

/**
 * Phase 2: CAPTCHA Auto-Detection
 *
 * Detect CAPTCHA challenges on the current page
 */
export const detectCaptchaChallenge = defineTool({
  name: 'detect_captcha',
  description: `Detect CAPTCHA challenges on the current page. Supports reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, and image CAPTCHAs.`,
  annotations: {
    title: 'Detect CAPTCHA Challenge',
    category: ToolCategory.INPUT,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const detector = new CaptchaDetector();
    const captchas = await detector.detect(page);

    if (captchas.length > 0) {
      response.appendResponseLine(`[CAPTCHA] Detected ${captchas.length} CAPTCHA(s):`);
      for (const captcha of captchas) {
        response.appendResponseLine(`  - Type: ${captcha.type}`);
        response.appendResponseLine(`    Confidence: ${(captcha.confidence * 100).toFixed(1)}%`);
        if (captcha.location) {
          response.appendResponseLine(`    Location: (${captcha.location.x}, ${captcha.location.y})`);
        }
        if (captcha.metadata?.sitekey) {
          response.appendResponseLine(`    Sitekey: ${captcha.metadata.sitekey}`);
        }
      }
    } else {
      response.appendResponseLine(`[CAPTCHA] No CAPTCHA detected on current page`);
    }

    response.includeSnapshot();
  },
});

/**
 * Phase 2: Wait for CAPTCHA to appear
 */
export const waitForCaptchaChallenge = defineTool({
  name: 'wait_for_captcha',
  description: `Wait for a CAPTCHA challenge to appear on the page. Useful when expecting a CAPTCHA to load dynamically.`,
  annotations: {
    title: 'Wait for CAPTCHA to Appear',
    category: ToolCategory.INPUT,
    readOnlyHint: true,
  },
  schema: {
    timeout: zod
      .number()
      .int()
      .min(1000)
      .max(60000)
      .optional()
      .default(10000)
      .describe('Maximum time to wait in milliseconds (default: 10000)'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const detector = new CaptchaDetector();

    const captcha = await detector.waitForCaptcha(page, request.params.timeout);

    if (captcha) {
      response.appendResponseLine(`[CAPTCHA] Detected ${captcha.type}:`);
      response.appendResponseLine(`  - Confidence: ${(captcha.confidence * 100).toFixed(1)}%`);
      if (captcha.location) {
        response.appendResponseLine(`  - Location: (${captcha.location.x}, ${captcha.location.y})`);
      }
    } else {
      response.appendResponseLine(`[CAPTCHA] No CAPTCHA appeared within ${request.params.timeout}ms`);
    }

    response.includeSnapshot();
  },
});

/**
 * Phase 2: Wait for CAPTCHA to be solved
 */
export const waitForCaptchaSolved = defineTool({
  name: 'wait_for_captcha_solved',
  description: `Wait for a CAPTCHA challenge to be solved. Monitors the page for CAPTCHA completion signals.`,
  annotations: {
    title: 'Wait for CAPTCHA Solution',
    category: ToolCategory.INPUT,
    readOnlyHint: true,
  },
  schema: {
    captchaType: zod
      .enum(['recaptcha_v2', 'recaptcha_v3', 'hcaptcha', 'turnstile', 'funcaptcha', 'image'])
      .describe('Type of CAPTCHA to wait for'),
    timeout: zod
      .number()
      .int()
      .min(1000)
      .max(300000)
      .optional()
      .default(60000)
      .describe('Maximum time to wait in milliseconds (default: 60000)'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const detector = new CaptchaDetector();

    response.appendResponseLine(`[CAPTCHA] Waiting for ${request.params.captchaType} solution...`);

    try {
      // Create a minimal CaptchaDetection object for waitForSolution
      const captchaDetection = {
        // Type assertion: request.params.captchaType is a string, but CaptchaDetection.type expects
        // a specific enum. We convert the string value to the expected type at this integration point.
        type: request.params.captchaType as any,
        confidence: 1.0,
        element: null,
        location: null,
      };

      const solved = await detector.waitForSolution(
        page,
        captchaDetection,
        request.params.timeout,
      );

      if (solved) {
        response.appendResponseLine(`[CAPTCHA] ${request.params.captchaType} solved successfully!`);
      } else {
        response.appendResponseLine(`[CAPTCHA] Timeout waiting for ${request.params.captchaType} solution`);
      }
    } catch (error) {
      const err = error as Error;
      response.appendResponseLine(`[CAPTCHA] Error waiting for solution: ${err.message}`);
    }

    response.includeSnapshot();
  },
});

/**
 * Phase 2: Self-Healing Smart Click
 *
 * Click elements using self-healing selectors with automatic fallback
 */
export const smartClickElement = defineTool({
  name: 'smart_click',
  description: `Click an element using self-healing selectors with automatic fallback strategies. More resilient than standard click - works even when page structure changes.`,
  annotations: {
    title: 'Smart Click (Self-Healing)',
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe('CSS selector, text content, or XPath expression to find the element'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const selfHealing = new SelfHealingSelector();

    response.appendResponseLine(`[SMART_CLICK] Attempting to click: ${request.params.selector}`);

    await context.waitForEventsAfterAction(async () => {
      const result = await selfHealing.findElement(page, request.params.selector);

      if (result.element) {
        await result.element.click();
        void result.element.dispose().catch(() => {
          // Ignore cleanup errors - element may already be disposed
        });

        if (result.strategy) {
          response.appendResponseLine(`[SMART_CLICK] Success using strategy: ${result.strategy.name}`);
          response.appendResponseLine(`[SMART_CLICK] Confidence: ${(result.strategy.confidence * 100).toFixed(1)}%`);
        }

        if (result.healingApplied) {
          response.appendResponseLine(`[SMART_CLICK] Self-healing applied`);
          response.appendResponseLine(`[SMART_CLICK] Strategies tried: ${result.attemptedStrategies.join(', ')}`);
        }
      } else {
        throw new Error(`Element not found: ${request.params.selector}`);
      }
    });

    response.includeSnapshot();
  },
});
