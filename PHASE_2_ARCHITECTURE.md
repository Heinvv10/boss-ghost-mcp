# BOSS Ghost MCP - Phase 2 Architecture

**Phase**: Phase 2 - Autonomy Features
**Date**: 2025-12-20
**Status**: 🏗️ Design Phase

---

## Overview

Phase 2 adds **autonomous operation** capabilities to BOSS Ghost MCP:

1. **Self-Healing Selectors** - Automatic selector recovery when elements move/change
2. **Intelligent Retry** - Exponential backoff with context-aware recovery
3. **Session Memory** - State persistence across browser restarts
4. **CAPTCHA Detection** - Automatic CAPTCHA identification
5. **Autonomous Explorer** - Intelligent site navigation and bug detection

---

## 1. Self-Healing Selector System

### Purpose
Automatically recover when CSS selectors fail due to:
- Dynamic class names (e.g., React `.css-abc123`)
- DOM structure changes
- A/B testing variations
- Lazy-loaded content

### Architecture

**File**: `src/utils/selectors.ts`

**Core Components**:

```typescript
interface SelectorStrategy {
  type: 'css' | 'xpath' | 'text' | 'aria' | 'testid' | 'semantic';
  selector: string;
  confidence: number; // 0-1
  fallback?: SelectorStrategy;
}

interface SelectorContext {
  originalSelector: string;
  element: ElementHandle | null;
  strategies: SelectorStrategy[];
  lastSuccessful?: SelectorStrategy;
  failureCount: number;
  timestamp: number;
}

class SelfHealingSelector {
  private cache: Map<string, SelectorContext> = new Map();

  async find(page: Page, selector: string, options?: {
    timeout?: number;
    retries?: number;
    useFallback?: boolean;
  }): Promise<ElementHandle>;

  async repair(page: Page, context: SelectorContext): Promise<ElementHandle | null>;

  private generateStrategies(selector: string, element?: ElementHandle): SelectorStrategy[];

  private tryStrategy(page: Page, strategy: SelectorStrategy): Promise<ElementHandle | null>;
}
```

**Strategy Hierarchy** (tried in order):

1. **Original Selector** (confidence: 1.0)
   - Try exact selector first
   - Cache hit if previously successful

2. **Test ID Strategy** (confidence: 0.95)
   - `[data-testid="submit"]`
   - `[data-test="submit"]`
   - Most reliable for testing

3. **ARIA Strategy** (confidence: 0.9)
   - `[role="button"][aria-label="Submit"]`
   - `[aria-label*="Submit"]`
   - Accessibility-first

4. **Semantic Strategy** (confidence: 0.85)
   - `button:has-text("Submit")`
   - Text content matching
   - Language-aware

5. **XPath Relative Strategy** (confidence: 0.8)
   - `//button[contains(text(), "Submit")]`
   - Position-independent

6. **Structure Strategy** (confidence: 0.7)
   - Parent/sibling relationships
   - `form > button.primary`

7. **Visual Strategy** (confidence: 0.6)
   - Bounding box position
   - Z-index analysis
   - Last resort

**Caching**:
- Cache successful selectors for 5 minutes
- Invalidate on navigation
- Track failure count per selector

**Example Usage**:
```typescript
const healer = new SelfHealingSelector();

// Original selector fails (class name changed)
const element = await healer.find(page, '.css-abc123-submit');

// Healer tries:
// 1. .css-abc123-submit ❌
// 2. [data-testid="submit-button"] ✅ FOUND
// 3. Cache strategy for future use
```

---

## 2. Intelligent Retry System

### Purpose
Automatic retry with exponential backoff for:
- Network failures
- Element not found
- Stale element reference
- Timeout errors

### Architecture

**File**: `src/utils/retry.ts`

**Core Components**:

```typescript
interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
  onRetry?: (attempt: number, error: Error) => void;
}

interface RetryContext {
  attempt: number;
  totalAttempts: number;
  lastError: Error | null;
  startTime: number;
  delay: number;
}

class IntelligentRetry {
  async execute<T>(
    fn: () => Promise<T>,
    config?: Partial<RetryConfig>
  ): Promise<T>;

  private shouldRetry(error: Error, context: RetryContext): boolean;

  private calculateDelay(context: RetryContext, config: RetryConfig): number;

  private async wait(ms: number): Promise<void>;
}
```

**Retry Strategy**:

```typescript
const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2,
  retryableErrors: [
    'TimeoutError',
    'NetworkError',
    'ElementNotFoundError',
    'StaleElementReferenceError',
  ],
};

// Exponential backoff formula:
// delay = min(baseDelay * (backoffMultiplier ** attempt), maxDelay)
//
// Example:
// Attempt 1: 1000ms
// Attempt 2: 2000ms
// Attempt 3: 4000ms
// Attempt 4: 8000ms
```

**Error Classification**:

1. **Retryable Errors** (auto-retry):
   - Network timeouts
   - Element not found (might appear)
   - Stale element reference
   - Rate limiting (with longer delay)

2. **Non-Retryable Errors** (fail immediately):
   - Invalid selector syntax
   - Permission denied
   - Authentication failures

3. **Context-Aware Retry**:
   - If element recently existed → aggressive retry
   - If element never existed → give up faster
   - If network error → longer delays

**Example Usage**:
```typescript
const retry = new IntelligentRetry();

const element = await retry.execute(
  () => page.waitForSelector('.dynamic-content', { timeout: 5000 }),
  {
    maxRetries: 5,
    baseDelay: 2000,
    onRetry: (attempt, error) => {
      console.log(`Retry attempt ${attempt}: ${error.message}`);
    },
  }
);
```

---

## 3. Session Memory System

### Purpose
Persist state across browser sessions:
- Form data
- Navigation history
- Element locations
- User preferences
- Test artifacts

### Architecture

**File**: `src/utils/session-memory.ts`

**Storage Locations**:
```
.ghost-memory/
├── sessions/
│   ├── session-{id}.json       # Session state
│   └── session-{id}.cookies    # Cookie storage
├── cache/
│   ├── selectors.json          # Selector cache
│   └── elements.json           # Element metadata
└── artifacts/
    └── {session-id}/           # Links to artifact system
```

**Core Components**:

```typescript
interface SessionMemory {
  sessionId: string;
  startTime: number;
  lastAccess: number;

  // Navigation state
  currentUrl: string;
  navigationHistory: string[];

  // Form state
  formData: Map<string, any>;

  // Element tracking
  elementCache: Map<string, {
    selector: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    timestamp: number;
  }>;

  // Custom data
  userData: Record<string, any>;
}

class SessionMemoryManager {
  async save(sessionId: string, memory: Partial<SessionMemory>): Promise<void>;

  async load(sessionId: string): Promise<SessionMemory | null>;

  async merge(sessionId: string, updates: Partial<SessionMemory>): Promise<void>;

  async delete(sessionId: string): Promise<void>;

  async listSessions(): Promise<SessionMemory[]>;

  // Cookie persistence
  async saveCookies(sessionId: string, cookies: any[]): Promise<void>;
  async loadCookies(sessionId: string): Promise<any[]>;

  // Cleanup old sessions
  async cleanup(olderThan: number): Promise<number>;
}
```

**Auto-Save Strategy**:
- Save on page navigation
- Save on form input (debounced 2 seconds)
- Save on element cache update
- Save on session end

**Example Usage**:
```typescript
const memory = new SessionMemoryManager();

// Start session
await memory.save('test-session-1', {
  sessionId: 'test-session-1',
  startTime: Date.now(),
  currentUrl: 'https://example.com',
  userData: { testName: 'Login Flow' },
});

// Update during test
await memory.merge('test-session-1', {
  formData: new Map([
    ['username', 'testuser'],
    ['password', '***'],
  ]),
});

// Load on restart
const session = await memory.load('test-session-1');
if (session) {
  await page.goto(session.currentUrl);
  // Restore form data
  for (const [key, value] of session.formData) {
    await page.fill(`[name="${key}"]`, value);
  }
}
```

---

## 4. CAPTCHA Detection System

### Purpose
Automatically detect CAPTCHA challenges:
- reCAPTCHA (v2, v3)
- hCaptcha
- Image CAPTCHAs
- Audio CAPTCHAs
- Custom challenges

### Architecture

**File**: `src/utils/captcha-solver.ts`

**Detection Strategies**:

```typescript
interface CaptchaDetection {
  type: 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'image' | 'audio' | 'unknown';
  confidence: number; // 0-1
  element: ElementHandle | null;
  location: { x: number; y: number; width: number; height: number };
  timestamp: number;
}

class CaptchaDetector {
  async detect(page: Page): Promise<CaptchaDetection[]>;

  private detectReCaptchaV2(page: Page): Promise<CaptchaDetection | null>;
  private detectReCaptchaV3(page: Page): Promise<CaptchaDetection | null>;
  private detectHCaptcha(page: Page): Promise<CaptchaDetection | null>;
  private detectImageCaptcha(page: Page): Promise<CaptchaDetection | null>;

  async waitForCaptcha(page: Page, timeout?: number): Promise<CaptchaDetection | null>;

  async isCaptchaSolved(page: Page, detection: CaptchaDetection): Promise<boolean>;
}
```

**Detection Heuristics**:

1. **reCAPTCHA v2**:
   - Look for `iframe[src*="recaptcha"]`
   - Check for `.g-recaptcha` element
   - Verify `grecaptcha` object in window

2. **reCAPTCHA v3**:
   - Check for `grecaptcha.execute()` calls
   - Look for hidden `g-recaptcha-response` input
   - Monitor network requests to `google.com/recaptcha`

3. **hCaptcha**:
   - Look for `iframe[src*="hcaptcha"]`
   - Check for `.h-captcha` element
   - Verify `hcaptcha` object in window

4. **Image CAPTCHA**:
   - Look for `<img>` with "captcha" in src/alt
   - Check for typical CAPTCHA patterns (distorted text)
   - Input field nearby

5. **Audio CAPTCHA**:
   - Look for `<audio>` or `<source>` with "captcha" in src
   - Audio player controls

**User Notification**:
```typescript
// When CAPTCHA detected
console.log('[CAPTCHA] Detected:', detection.type);
console.log('[CAPTCHA] Please solve manually or wait for auto-solve');

// Pause automation until solved
await detector.waitForSolution(page, detection, { timeout: 120000 }); // 2 minutes
```

**Example Usage**:
```typescript
const detector = new CaptchaDetector();

// Check for CAPTCHA before proceeding
const captchas = await detector.detect(page);

if (captchas.length > 0) {
  console.log(`[CAPTCHA] Detected ${captchas.length} CAPTCHA(s)`);

  for (const captcha of captchas) {
    console.log(`[CAPTCHA] Type: ${captcha.type}, Confidence: ${captcha.confidence}`);

    // Wait for manual solution or timeout
    const solved = await detector.waitForSolution(page, captcha, {
      timeout: 120000,
    });

    if (!solved) {
      throw new Error('CAPTCHA not solved within timeout');
    }
  }
}
```

---

## 5. Autonomous Site Explorer

### Purpose
Intelligently navigate and explore websites:
- Discover all pages
- Map site structure
- Identify forms and interactive elements
- Detect potential bugs (404s, console errors)
- Generate sitemap

### Architecture

**File**: `src/tools/autonomous-explorer.ts`

**Core Components**:

```typescript
interface ExplorationConfig {
  maxDepth: number;
  maxPages: number;
  followExternal: boolean;
  ignorePatterns: string[];
  includePatterns: string[];
  respectRobotsTxt: boolean;
}

interface PageInfo {
  url: string;
  title: string;
  depth: number;
  parentUrl: string | null;
  links: string[];
  forms: FormInfo[];
  errors: ConsoleError[];
  status: number;
  loadTime: number;
  timestamp: number;
}

interface FormInfo {
  action: string;
  method: 'GET' | 'POST';
  fields: Array<{ name: string; type: string; required: boolean }>;
}

class AutonomousExplorer {
  private visited: Set<string> = new Set();
  private queue: string[] = [];
  private sitemap: Map<string, PageInfo> = new Map();

  async explore(
    page: Page,
    startUrl: string,
    config?: Partial<ExplorationConfig>
  ): Promise<ExplorationResult>;

  private async visitPage(page: Page, url: string, depth: number): Promise<PageInfo>;

  private async discoverLinks(page: Page): Promise<string[]>;

  private async analyzeForms(page: Page): Promise<FormInfo[]>;

  private async detectErrors(page: Page): Promise<ConsoleError[]>;

  private shouldVisit(url: string, config: ExplorationConfig): boolean;

  async generateReport(sitemap: Map<string, PageInfo>): Promise<string>;
}
```

**Exploration Algorithm**:

```
1. Start at root URL
2. For each page:
   a. Navigate and record metadata
   b. Extract all links
   c. Identify forms
   d. Monitor console errors
   e. Detect 404s/500s
3. Add unvisited links to queue
4. Respect max depth and max pages
5. Generate comprehensive report
```

**Bug Detection**:

1. **Broken Links** (404, 500)
2. **Console Errors** (JavaScript errors)
3. **Missing Images** (404 on img src)
4. **Slow Pages** (load time > 5s)
5. **Missing Forms** (action="" or invalid)

**Report Format** (Markdown):

```markdown
# Site Exploration Report

**Start URL**: https://example.com
**Pages Visited**: 42
**Max Depth**: 3
**Duration**: 5m 23s

## Summary

- ✅ Pages OK: 38
- ❌ Pages with Errors: 4
- ⚠️ Warnings: 12

## Broken Links (4)

1. https://example.com/old-page (404)
2. https://example.com/api/data (500)

## Console Errors (12)

### https://example.com/dashboard
- TypeError: Cannot read property 'user' of undefined
- Line 45, app.js

## Sitemap

- / (depth: 0)
  - /about (depth: 1)
  - /contact (depth: 1)
    - /contact/support (depth: 2)
  - /products (depth: 1)
    - /products/item-1 (depth: 2)
```

**Example Usage**:
```typescript
const explorer = new AutonomousExplorer();

const result = await explorer.explore(page, 'https://example.com', {
  maxDepth: 3,
  maxPages: 100,
  followExternal: false,
  ignorePatterns: ['/admin', '/api'],
});

console.log(`Visited ${result.sitemap.size} pages`);
console.log(`Found ${result.errors.length} errors`);

// Generate Markdown report
const report = await explorer.generateReport(result.sitemap);
await fs.writeFile('exploration-report.md', report);
```

---

## Phase 2 MCP Tools

**New Tools to Register**:

1. `selector_find` - Find element with self-healing
2. `selector_repair` - Manually trigger selector repair
3. `retry_operation` - Retry an operation with intelligent backoff
4. `session_memory_save` - Save session state
5. `session_memory_load` - Load session state
6. `session_memory_list` - List all sessions
7. `captcha_detect` - Detect CAPTCHA on page
8. `captcha_wait_solution` - Wait for CAPTCHA to be solved
9. `autonomous_explore` - Explore site autonomously
10. `generate_exploration_report` - Generate sitemap and bug report

**Total New Tools**: 10
**Total BOSS Ghost MCP Tools**: 36 (26 enhanced Chrome DevTools + 10 autonomy)

---

## Implementation Plan

### Week 2: Phase 2 Implementation

**Day 1-2: Self-Healing Selectors** (4-6 hours)
- Implement `SelfHealingSelector` class
- Strategy hierarchy and fallback logic
- Caching and performance optimization
- Unit tests

**Day 3-4: Intelligent Retry + Session Memory** (4-6 hours)
- Implement `IntelligentRetry` class
- Exponential backoff algorithm
- Implement `SessionMemoryManager`
- Storage and retrieval logic
- Integration tests

**Day 5-6: CAPTCHA Detection + Autonomous Explorer** (4-6 hours)
- Implement `CaptchaDetector` class
- Detection heuristics for common CAPTCHAs
- Implement `AutonomousExplorer` class
- BFS algorithm for site traversal
- Bug detection logic

**Day 7: Tool Registration + Testing** (2-3 hours)
- Register 10 new MCP tools
- Write integration tests
- Update documentation
- Phase 2 status report

**Total**: 14-21 hours across 7 days

---

## Success Criteria

Phase 2 is complete when:

1. ✅ Self-healing selectors recover from 90%+ selector failures
2. ✅ Intelligent retry reduces flaky test failures by 80%+
3. ✅ Session memory restores state correctly after restart
4. ✅ CAPTCHA detection identifies all common CAPTCHA types
5. ✅ Autonomous explorer maps 100+ page sites without errors
6. ✅ All 10 new MCP tools registered and working
7. ✅ Integration tests passing (20+ new tests)
8. ✅ Documentation complete

---

*BOSS Ghost MCP Phase 2 Architecture*
*Version 1.0 - 2025-12-20*
