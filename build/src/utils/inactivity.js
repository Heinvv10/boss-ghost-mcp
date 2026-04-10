/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { logger } from '../logger.js';
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const CHECK_INTERVAL_MS = 30_000; // 30 seconds
const sessionActivity = new Map();
let cleanupInterval = null;
/**
 * Update activity timestamp for a session.
 */
export function updateSessionActivity(sessionKey, sessionName) {
    sessionActivity.set(sessionKey, {
        lastActivity: Date.now(),
        sessionName,
    });
}
/**
 * Start the background cleanup timer (call once at startup).
 * Runs every 30 seconds, checks for sessions inactive longer than timeoutMs.
 * Calls onTimeout for each expired session.
 */
export function startInactivityMonitor(timeoutMs = DEFAULT_TIMEOUT_MS, onTimeout) {
    if (cleanupInterval) {
        logger('Inactivity monitor already running, skipping duplicate start.');
        return;
    }
    logger(`Starting inactivity monitor (timeout: ${timeoutMs}ms).`);
    cleanupInterval = setInterval(async () => {
        const now = Date.now();
        for (const [key, entry] of sessionActivity) {
            const idleMs = now - entry.lastActivity;
            if (idleMs > timeoutMs) {
                logger(`Session "${entry.sessionName}" (${key}) idle for ${idleMs}ms, triggering cleanup.`);
                sessionActivity.delete(key);
                if (onTimeout) {
                    try {
                        await onTimeout(key, entry.sessionName);
                    }
                    catch (error) {
                        logger(`Error during timeout callback for session "${entry.sessionName}": ${error}`);
                    }
                }
            }
        }
    }, CHECK_INTERVAL_MS);
}
/**
 * Stop the cleanup timer.
 */
export function stopInactivityMonitor() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        logger('Inactivity monitor stopped.');
    }
}
/**
 * Remove a session from tracking (already cleaned up).
 */
export function removeSession(sessionKey) {
    sessionActivity.delete(sessionKey);
}
/**
 * Get time since last activity for a session (ms).
 * Returns null if the session is not tracked.
 */
export function getIdleTime(sessionKey) {
    const entry = sessionActivity.get(sessionKey);
    if (!entry) {
        return null;
    }
    return Date.now() - entry.lastActivity;
}
/**
 * List sessions with their idle times.
 */
export function listSessionActivity() {
    const now = Date.now();
    const results = [];
    for (const [key, entry] of sessionActivity) {
        results.push({
            sessionKey: key,
            sessionName: entry.sessionName,
            idleMs: now - entry.lastActivity,
        });
    }
    return results;
}
