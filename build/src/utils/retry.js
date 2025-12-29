/**
 * @license
 * Copyright 2025 BOSS Ghost MCP
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Default retry configuration
 */
const DEFAULT_CONFIG = {
    maxRetries: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    backoffMultiplier: 2,
    retryableErrors: [
        'TimeoutError',
        'NetworkError',
        'ElementNotFoundError',
        'ProtocolError',
        'TargetClosedError',
    ],
};
/**
 * Intelligent Retry System with Exponential Backoff
 *
 * Features:
 * - Exponential backoff algorithm: delay = min(baseDelay * (backoffMultiplier^attempt), maxDelay)
 * - Configurable retry criteria
 * - Error classification (retryable vs non-retryable)
 * - Timeout support per attempt
 * - Progress callbacks
 * - Custom retry logic
 *
 * @example
 * ```typescript
 * const retry = new IntelligentRetry({
 *   maxRetries: 3,
 *   baseDelay: 1000,
 *   backoffMultiplier: 2,
 * });
 *
 * const result = await retry.execute(async () => {
 *   return await page.click('button.submit');
 * });
 * ```
 */
export class IntelligentRetry {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Execute a function with intelligent retry logic
     *
     * @param fn - Async function to execute
     * @param config - Optional config override for this execution
     * @returns Promise resolving to the function result
     * @throws Last error if all retries fail
     *
     * @example
     * ```typescript
     * const result = await retry.execute(async () => {
     *   const element = await page.$('button.submit');
     *   if (!element) throw new Error('ElementNotFoundError');
     *   return element;
     * });
     * ```
     */
    async execute(fn, config) {
        const fullConfig = { ...this.config, ...config };
        const startTime = Date.now();
        let lastError;
        for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
            try {
                // Apply timeout if configured
                if (fullConfig.timeout) {
                    return await this.executeWithTimeout(fn, fullConfig.timeout);
                }
                else {
                    return await fn();
                }
            }
            catch (error) {
                lastError = error;
                const totalElapsed = Date.now() - startTime;
                // Check if we should retry
                if (attempt >= fullConfig.maxRetries) {
                    console.log(`[RETRY] All ${fullConfig.maxRetries + 1} attempts failed. Giving up.`);
                    throw lastError;
                }
                // Check if error is retryable
                if (!this.isRetryable(lastError, fullConfig)) {
                    console.log(`[RETRY] Error is not retryable: ${lastError.name}. Giving up.`);
                    throw lastError;
                }
                // Calculate delay for next retry
                const delay = this.calculateDelay(attempt, fullConfig);
                const context = {
                    attempt,
                    maxRetries: fullConfig.maxRetries,
                    error: lastError,
                    delay,
                    totalElapsed,
                };
                // Custom retry logic
                if (fullConfig.shouldRetry && !fullConfig.shouldRetry(lastError, context)) {
                    console.log('[RETRY] Custom retry logic returned false. Giving up.');
                    throw lastError;
                }
                // Call retry callback
                if (fullConfig.onRetry) {
                    fullConfig.onRetry(context);
                }
                console.log(`[RETRY] Attempt ${attempt + 1}/${fullConfig.maxRetries + 1} failed: ${lastError.message}. Retrying in ${delay}ms...`);
                // Wait before retry
                await this.sleep(delay);
            }
        }
        // This should never be reached, but TypeScript needs it
        throw lastError || new Error('Unknown error in retry logic');
    }
    /**
     * Execute with retry and return detailed result
     *
     * @param fn - Async function to execute
     * @param config - Optional config override
     * @returns Detailed retry result including attempts and timing
     */
    async executeWithResult(fn, config) {
        const fullConfig = { ...this.config, ...config };
        const startTime = Date.now();
        let attempts = 0;
        let lastError;
        for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
            attempts++;
            try {
                // Apply timeout if configured
                if (fullConfig.timeout) {
                    const value = await this.executeWithTimeout(fn, fullConfig.timeout);
                    // ✅ Ensure minimum 1ms to handle instant synchronous operations
                    const totalElapsed = Math.max(Date.now() - startTime, 1);
                    return {
                        success: true,
                        value,
                        attempts,
                        totalElapsed,
                    };
                }
                else {
                    const value = await fn();
                    // ✅ Ensure minimum 1ms to handle instant synchronous operations
                    const totalElapsed = Math.max(Date.now() - startTime, 1);
                    return {
                        success: true,
                        value,
                        attempts,
                        totalElapsed,
                    };
                }
            }
            catch (error) {
                lastError = error;
                const totalElapsed = Date.now() - startTime;
                // Check if we should retry
                if (attempt >= fullConfig.maxRetries) {
                    return {
                        success: false,
                        error: lastError,
                        attempts,
                        totalElapsed,
                    };
                }
                // Check if error is retryable
                if (!this.isRetryable(lastError, fullConfig)) {
                    return {
                        success: false,
                        error: lastError,
                        attempts,
                        totalElapsed,
                    };
                }
                // Calculate delay for next retry
                const delay = this.calculateDelay(attempt, fullConfig);
                const context = {
                    attempt,
                    maxRetries: fullConfig.maxRetries,
                    error: lastError,
                    delay,
                    totalElapsed,
                };
                // Custom retry logic
                if (fullConfig.shouldRetry && !fullConfig.shouldRetry(lastError, context)) {
                    return {
                        success: false,
                        error: lastError,
                        attempts,
                        totalElapsed,
                    };
                }
                // Call retry callback
                if (fullConfig.onRetry) {
                    fullConfig.onRetry(context);
                }
                // Wait before retry
                await this.sleep(delay);
            }
        }
        // This should never be reached, but TypeScript needs it
        return {
            success: false,
            error: lastError || new Error('Unknown error in retry logic'),
            attempts,
            totalElapsed: Date.now() - startTime,
        };
    }
    /**
     * Calculate exponential backoff delay
     *
     * Formula: delay = min(baseDelay * (backoffMultiplier^attempt), maxDelay)
     *
     * Examples (baseDelay=1000, backoffMultiplier=2, maxDelay=30000):
     * - Attempt 0: 1000ms (1s)
     * - Attempt 1: 2000ms (2s)
     * - Attempt 2: 4000ms (4s)
     * - Attempt 3: 8000ms (8s)
     * - Attempt 4: 16000ms (16s)
     * - Attempt 5: 30000ms (30s, capped at maxDelay)
     *
     * @param attempt - Current attempt number (0-based)
     * @param config - Retry configuration
     * @returns Delay in milliseconds
     */
    calculateDelay(attempt, config) {
        const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt);
        return Math.min(exponentialDelay, config.maxDelay);
    }
    /**
     * Check if an error is retryable based on configuration
     *
     * @param error - The error to check
     * @param config - Retry configuration
     * @returns True if error should trigger retry
     */
    isRetryable(error, config) {
        // Check if error name matches any retryable error
        return config.retryableErrors.some(retryableError => error.name === retryableError ||
            error.message.includes(retryableError) ||
            error.constructor.name === retryableError);
    }
    /**
     * Execute function with timeout
     *
     * @param fn - Function to execute
     * @param timeout - Timeout in milliseconds
     * @returns Promise resolving to function result
     * @throws TimeoutError if timeout exceeded
     */
    async executeWithTimeout(fn, timeout) {
        return Promise.race([
            fn(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('TimeoutError: Operation timed out')), timeout)),
        ]);
    }
    /**
     * Sleep for specified milliseconds
     *
     * @param ms - Milliseconds to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Update retry configuration
     *
     * @param config - Partial config to merge with current config
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
}
/**
 * Convenience function for one-off retry operations
 *
 * @param fn - Function to execute with retry
 * @param config - Retry configuration
 * @returns Promise resolving to function result
 *
 * @example
 * ```typescript
 * const result = await retryOperation(
 *   async () => await page.click('button'),
 *   { maxRetries: 3, baseDelay: 1000 }
 * );
 * ```
 */
export async function retryOperation(fn, config = {}) {
    const retry = new IntelligentRetry(config);
    return retry.execute(fn);
}
/**
 * Decorator for adding retry logic to class methods
 *
 * @param config - Retry configuration
 * @returns Method decorator
 *
 * @example
 * ```typescript
 * class MyClass {
 *   @Retryable({ maxRetries: 3, baseDelay: 1000 })
 *   async myMethod() {
 *     // Method implementation
 *   }
 * }
 * ```
 */
export function Retryable(config = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = async function (...args) {
            const retry = new IntelligentRetry(config);
            return retry.execute(() => originalMethod.apply(this, args));
        };
        return descriptor;
    };
}
