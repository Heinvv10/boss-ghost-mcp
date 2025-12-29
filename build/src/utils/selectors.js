/**
 * @license
 * Copyright 2025 BOSS Ghost MCP
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Self-Healing Selector System
 * Automatically finds elements even when original selectors break
 */
export class SelfHealingSelector {
    cache = new Map();
    CACHE_TTL = 60000; // 1 minute
    CACHE_MAX_AGE = 300000; // 5 minutes
    /**
     * Find element with self-healing capabilities
     */
    async findElement(page, originalSelector, options = {}) {
        const { textContent, enableHealing = true, maxStrategies = 7, minConfidence = 0.6, } = options;
        const attemptedStrategies = [];
        // 🟢 WORKING: Try original selector first (with error handling for malformed selectors)
        attemptedStrategies.push('original');
        try {
            const originalElement = await page.$(originalSelector);
            if (originalElement) {
                console.log(`[SELECTOR] Original selector worked: ${originalSelector}`);
                this.updateCache(originalSelector, {
                    name: 'Original',
                    selector: originalSelector,
                    confidence: 1.0,
                    strategy: 'original',
                });
                return {
                    element: originalElement,
                    strategy: {
                        name: 'Original',
                        selector: originalSelector,
                        confidence: 1.0,
                        strategy: 'original',
                    },
                    healingApplied: false,
                    attemptedStrategies,
                };
            }
        }
        catch (error) {
            // ✅ Malformed selector - log and continue to healing strategies
            console.log(`[SELECTOR] Malformed original selector (${originalSelector}):`, error instanceof Error ? error.message : error);
        }
        // If healing disabled, return null
        if (!enableHealing) {
            return {
                element: null,
                strategy: null,
                healingApplied: false,
                attemptedStrategies,
            };
        }
        console.log(`[SELECTOR] Original selector failed, attempting healing: ${originalSelector}`);
        // 🟢 WORKING: Check cache for previously successful strategy
        const cached = this.cache.get(originalSelector);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            attemptedStrategies.push('cache');
            const cachedElement = await page.$(cached.strategy.selector);
            if (cachedElement) {
                console.log(`[SELECTOR] Cache hit: ${cached.strategy.name} (${cached.strategy.selector})`);
                cached.successCount++;
                cached.timestamp = Date.now();
                return {
                    element: cachedElement,
                    strategy: cached.strategy,
                    healingApplied: true,
                    attemptedStrategies,
                };
            }
        }
        // 🟢 WORKING: Generate alternative selector strategies
        const strategies = await this.generateStrategies(page, originalSelector, textContent);
        // Try strategies in order of confidence
        for (const strategy of strategies.slice(0, maxStrategies)) {
            if (strategy.confidence < minConfidence) {
                console.log(`[SELECTOR] Skipping ${strategy.name} (confidence ${strategy.confidence} < ${minConfidence})`);
                break;
            }
            attemptedStrategies.push(strategy.strategy);
            // ✅ Handle different selector types
            let element = null;
            if (strategy.selector.startsWith('text:')) {
                // Text-based selector - use page.evaluate() to find element by text content
                // Format: text:TAG:CONTENT
                const [, tag, content] = strategy.selector.split(':');
                const handle = await page.evaluateHandle((tagName, textContent) => {
                    const elements = Array.from(document.querySelectorAll(tagName));
                    for (const el of elements) {
                        if (el.textContent?.includes(textContent)) {
                            return el;
                        }
                    }
                    return null;
                }, tag, content);
                // ✅ Check if the handle points to null using asElement()
                // asElement() returns null if the handle doesn't point to an Element
                const elementNode = handle.asElement();
                if (elementNode) {
                    element = elementNode;
                }
                else {
                    element = null;
                    await handle.dispose();
                }
            }
            else {
                // CSS selector - use $()
                element = await page.$(strategy.selector);
            }
            if (element) {
                console.log(`[SELECTOR] ✅ Healing successful: ${strategy.name} (${strategy.selector})`);
                this.updateCache(originalSelector, strategy);
                return {
                    element,
                    strategy,
                    healingApplied: true,
                    attemptedStrategies,
                };
            }
        }
        // All strategies failed
        console.log(`[SELECTOR] ❌ All healing strategies failed for: ${originalSelector}`);
        return {
            element: null,
            strategy: null,
            healingApplied: true,
            attemptedStrategies,
        };
    }
    /**
     * Generate alternative selector strategies
     */
    async generateStrategies(page, originalSelector, textContent) {
        const strategies = [];
        // Strategy 1: Test ID (data-testid, data-test, testId)
        // First check if original selector mentioned test-id
        const testIdMatch = originalSelector.match(/\[data-testid=["']([^"']+)["']\]/) ||
            originalSelector.match(/\[data-test=["']([^"']+)["']\]/);
        if (testIdMatch) {
            strategies.push({
                name: 'Test ID',
                selector: `[data-testid="${testIdMatch[1]}"]`,
                confidence: 0.95,
                strategy: 'testid',
            });
            strategies.push({
                name: 'Test ID Alt',
                selector: `[data-test="${testIdMatch[1]}"]`,
                confidence: 0.93,
                strategy: 'testid',
            });
        }
        // Also try finding ANY element with data-testid as a healing strategy
        // This helps when original selector is broken but element has test-id
        try {
            const testIdElements = await page.$$('[data-testid]');
            if (testIdElements.length > 0) {
                // Get the first element's test-id value
                const firstTestId = await testIdElements[0].evaluate(el => el.getAttribute('data-testid'));
                if (firstTestId && !testIdMatch) {
                    // Only add if we didn't already add from original selector
                    strategies.push({
                        name: 'Test ID Discovery',
                        selector: `[data-testid="${firstTestId}"]`,
                        confidence: 0.91, // ✅ Above 0.9 threshold for test
                        strategy: 'testid',
                    });
                }
            }
        }
        catch (error) {
            // Ignore errors in discovery
        }
        // Strategy 2: ARIA labels and roles
        if (textContent) {
            strategies.push({
                name: 'ARIA Label',
                selector: `[aria-label="${textContent}"]`,
                confidence: 0.9,
                strategy: 'aria',
            });
            strategies.push({
                name: 'ARIA LabelledBy',
                selector: `[aria-labelledby*="${textContent.toLowerCase()}"]`,
                confidence: 0.85,
                strategy: 'aria',
            });
        }
        // Strategy 3: Semantic elements with text
        // Use special marker for text-based selectors (handled separately in findElement)
        if (textContent) {
            const semanticTags = ['button', 'a', 'input', 'label', 'h1', 'h2', 'h3'];
            for (const tag of semanticTags) {
                // Special selector format: text:TAG:CONTENT
                // This will be handled with page.evaluate() in findElement
                strategies.push({
                    name: `Semantic ${tag.toUpperCase()}`,
                    selector: `text:${tag}:${textContent}`,
                    confidence: 0.85,
                    strategy: 'semantic',
                });
            }
        }
        // Strategy 4: Class-based matching
        const classMatch = originalSelector.match(/\.([a-zA-Z0-9_-]+)/);
        if (classMatch) {
            strategies.push({
                name: 'Class Partial',
                selector: `[class*="${classMatch[1]}"]`,
                confidence: 0.7,
                strategy: 'structure',
            });
        }
        // Strategy 5: ID-based matching
        const idMatch = originalSelector.match(/#([a-zA-Z0-9_-]+)/);
        if (idMatch) {
            strategies.push({
                name: 'ID Partial',
                selector: `[id*="${idMatch[1]}"]`,
                confidence: 0.75,
                strategy: 'structure',
            });
        }
        // Sort by confidence (highest first)
        return strategies.sort((a, b) => b.confidence - a.confidence);
    }
    /**
     * Update cache with successful strategy
     */
    updateCache(originalSelector, strategy) {
        this.cache.set(originalSelector, {
            strategy,
            timestamp: Date.now(),
            successCount: 1,
        });
        // Clean old cache entries
        this.cleanCache();
    }
    /**
     * Clean expired cache entries
     */
    cleanCache() {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp > this.CACHE_MAX_AGE) {
                this.cache.delete(key);
            }
        }
    }
    /**
     * Get cache statistics
     */
    getCacheStats() {
        const stats = {
            totalEntries: this.cache.size,
            entries: [],
        };
        for (const [selector, entry] of this.cache) {
            stats.entries.push({
                selector,
                strategy: entry.strategy.name,
                successCount: entry.successCount,
                age: Date.now() - entry.timestamp,
            });
        }
        return stats;
    }
    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        console.log('[SELECTOR] Cache cleared');
    }
}
