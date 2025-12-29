/**
 * @license
 * Copyright 2025 BOSS Ghost MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import { IntelligentRetry, retryOperation } from '../../src/utils/retry.js';
describe('Intelligent Retry System', () => {
    describe('Basic Retry Logic', () => {
        it('should succeed on first attempt without retry', async () => {
            const retry = new IntelligentRetry({ maxRetries: 3 });
            const fn = vi.fn().mockResolvedValue('success');
            const result = await retry.execute(fn);
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });
        it('should retry on failure and eventually succeed', async () => {
            const retry = new IntelligentRetry({
                maxRetries: 3,
                baseDelay: 100,
            });
            const fn = vi
                .fn()
                .mockRejectedValueOnce(new Error('TimeoutError'))
                .mockRejectedValueOnce(new Error('TimeoutError'))
                .mockResolvedValue('success');
            const result = await retry.execute(fn);
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(3);
        });
        it('should throw error after all retries exhausted', async () => {
            const retry = new IntelligentRetry({
                maxRetries: 2,
                baseDelay: 10,
            });
            const fn = vi.fn().mockRejectedValue(new Error('TimeoutError'));
            await expect(retry.execute(fn)).rejects.toThrow('TimeoutError');
            expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
        });
    });
    describe('Exponential Backoff', () => {
        it('should apply exponential backoff between retries', async () => {
            const retry = new IntelligentRetry({
                maxRetries: 3,
                baseDelay: 100,
                backoffMultiplier: 2,
            });
            const delays = [];
            const fn = vi.fn().mockImplementation(async () => {
                throw new Error('TimeoutError');
            });
            const startTime = Date.now();
            try {
                await retry.execute(fn);
            }
            catch (error) {
                // Expected to fail
            }
            const totalTime = Date.now() - startTime;
            // Expected delays: 100ms, 200ms, 400ms = 700ms total
            expect(totalTime).toBeGreaterThan(600);
            expect(totalTime).toBeLessThan(1000);
        });
        it('should respect maxDelay cap', async () => {
            const retry = new IntelligentRetry({
                maxRetries: 5,
                baseDelay: 1000,
                maxDelay: 2000,
                backoffMultiplier: 2,
            });
            const fn = vi.fn().mockRejectedValue(new Error('TimeoutError'));
            const startTime = Date.now();
            try {
                await retry.execute(fn);
            }
            catch (error) {
                // Expected to fail
            }
            const totalTime = Date.now() - startTime;
            // With capping: 1000, 2000, 2000, 2000, 2000 = 9000ms max
            // Without capping would be: 1000, 2000, 4000, 8000, 16000 = 31000ms
            expect(totalTime).toBeLessThan(12000);
        });
    });
    describe('Error Classification', () => {
        it('should retry on retryable errors', async () => {
            const retry = new IntelligentRetry({
                maxRetries: 2,
                baseDelay: 10,
                retryableErrors: ['TimeoutError', 'NetworkError'],
            });
            const fn = vi
                .fn()
                .mockRejectedValueOnce(new Error('TimeoutError'))
                .mockResolvedValue('success');
            const result = await retry.execute(fn);
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(2);
        });
        it('should not retry on non-retryable errors', async () => {
            const retry = new IntelligentRetry({
                maxRetries: 3,
                baseDelay: 10,
                retryableErrors: ['TimeoutError'],
            });
            const fn = vi.fn().mockRejectedValue(new Error('ValidationError'));
            await expect(retry.execute(fn)).rejects.toThrow('ValidationError');
            expect(fn).toHaveBeenCalledTimes(1); // Should not retry
        });
        it('should match error by name', async () => {
            const retry = new IntelligentRetry({
                maxRetries: 2,
                baseDelay: 10,
                retryableErrors: ['TimeoutError'],
            });
            const error = new Error('Connection failed');
            error.name = 'TimeoutError';
            const fn = vi
                .fn()
                .mockRejectedValueOnce(error)
                .mockResolvedValue('success');
            const result = await retry.execute(fn);
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(2);
        });
    });
    describe('Timeout Support', () => {
        it('should timeout individual attempts', async () => {
            const retry = new IntelligentRetry({
                maxRetries: 1,
                baseDelay: 10,
                timeout: 100,
            });
            const fn = vi.fn().mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 200));
                return 'success';
            });
            await expect(retry.execute(fn)).rejects.toThrow('TimeoutError');
        });
        it('should succeed if function completes within timeout', async () => {
            const retry = new IntelligentRetry({
                maxRetries: 1,
                baseDelay: 10,
                timeout: 200,
            });
            const fn = vi.fn().mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
                return 'success';
            });
            const result = await retry.execute(fn);
            expect(result).toBe('success');
        });
    });
    describe('Callbacks and Custom Logic', () => {
        it('should call onRetry callback', async () => {
            const onRetry = vi.fn();
            const retry = new IntelligentRetry({
                maxRetries: 2,
                baseDelay: 10,
                onRetry,
            });
            const fn = vi
                .fn()
                .mockRejectedValueOnce(new Error('TimeoutError'))
                .mockResolvedValue('success');
            await retry.execute(fn);
            expect(onRetry).toHaveBeenCalledTimes(1);
            expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
                attempt: 0,
                maxRetries: 2,
                error: expect.any(Error),
                delay: expect.any(Number),
                totalElapsed: expect.any(Number),
            }));
        });
        it('should respect custom shouldRetry logic', async () => {
            const shouldRetry = vi.fn().mockReturnValue(false);
            const retry = new IntelligentRetry({
                maxRetries: 3,
                baseDelay: 10,
                shouldRetry,
            });
            const fn = vi.fn().mockRejectedValue(new Error('TimeoutError'));
            await expect(retry.execute(fn)).rejects.toThrow('TimeoutError');
            expect(fn).toHaveBeenCalledTimes(1);
            expect(shouldRetry).toHaveBeenCalledTimes(1);
        });
    });
    describe('executeWithResult', () => {
        it('should return detailed result on success', async () => {
            const retry = new IntelligentRetry({ maxRetries: 2 });
            const fn = vi.fn().mockResolvedValue('success');
            const result = await retry.executeWithResult(fn);
            expect(result.success).toBe(true);
            expect(result.value).toBe('success');
            expect(result.attempts).toBe(1);
            expect(result.totalElapsed).toBeGreaterThan(0);
        });
        it('should return detailed result on failure', async () => {
            const retry = new IntelligentRetry({
                maxRetries: 1,
                baseDelay: 10,
            });
            const fn = vi.fn().mockRejectedValue(new Error('TimeoutError'));
            const result = await retry.executeWithResult(fn);
            expect(result.success).toBe(false);
            expect(result.error).toBeInstanceOf(Error);
            expect(result.attempts).toBe(2); // Initial + 1 retry
        });
    });
    describe('Configuration Management', () => {
        it('should use default configuration', async () => {
            const retry = new IntelligentRetry();
            const config = retry.getConfig();
            expect(config.maxRetries).toBe(3);
            expect(config.baseDelay).toBe(1000);
            expect(config.backoffMultiplier).toBe(2);
            expect(config.maxDelay).toBe(30000);
        });
        it('should allow config override per execution', async () => {
            const retry = new IntelligentRetry({ maxRetries: 1 });
            const fn = vi
                .fn()
                .mockRejectedValueOnce(new Error('TimeoutError'))
                .mockRejectedValueOnce(new Error('TimeoutError'))
                .mockResolvedValue('success');
            const result = await retry.execute(fn, { maxRetries: 3, baseDelay: 10 });
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(3);
        });
        it('should update configuration', () => {
            const retry = new IntelligentRetry({ maxRetries: 1 });
            retry.updateConfig({ maxRetries: 5, baseDelay: 500 });
            const config = retry.getConfig();
            expect(config.maxRetries).toBe(5);
            expect(config.baseDelay).toBe(500);
        });
    });
    describe('Convenience Functions', () => {
        it('should work with retryOperation helper', async () => {
            const fn = vi
                .fn()
                .mockRejectedValueOnce(new Error('TimeoutError'))
                .mockResolvedValue('success');
            const result = await retryOperation(fn, {
                maxRetries: 2,
                baseDelay: 10,
            });
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(2);
        });
    });
    describe('Edge Cases', () => {
        it('should handle zero retries', async () => {
            const retry = new IntelligentRetry({ maxRetries: 0 });
            const fn = vi.fn().mockRejectedValue(new Error('Failed'));
            await expect(retry.execute(fn)).rejects.toThrow('Failed');
            expect(fn).toHaveBeenCalledTimes(1);
        });
        it('should handle very large retry counts', async () => {
            const retry = new IntelligentRetry({
                maxRetries: 100,
                baseDelay: 1,
                maxDelay: 10,
            });
            const fn = vi.fn().mockRejectedValue(new Error('TimeoutError'));
            await expect(retry.execute(fn)).rejects.toThrow();
            expect(fn).toHaveBeenCalledTimes(101); // Initial + 100 retries
        }, 15000); // Longer timeout for this test
        it('should handle synchronous errors', async () => {
            const retry = new IntelligentRetry({
                maxRetries: 2,
                baseDelay: 10,
            });
            const fn = vi.fn(() => {
                throw new Error('TimeoutError');
            });
            await expect(retry.execute(fn)).rejects.toThrow('TimeoutError');
            expect(fn).toHaveBeenCalledTimes(3);
        });
    });
});
