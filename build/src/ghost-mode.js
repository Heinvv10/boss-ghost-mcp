/**
 * @license
 * Copyright 2025 BOSS Ghost MCP
 * SPDX-License-Identifier: Apache-2.0
 */
const DEFAULT_GHOST_CONFIG = {
    enabled: true,
    stealthLevel: 'maximum',
    enableFingerprinting: true,
    enableHumanBehavior: true,
    enableBotDetectionEvasion: true,
};
/**
 * Apply Ghost Mode stealth features to a browser instance
 */
export async function applyGhostMode(browser, config = {}) {
    const fullConfig = { ...DEFAULT_GHOST_CONFIG, ...config };
    if (!fullConfig.enabled) {
        return;
    }
    // Get all pages
    const pages = await browser.pages();
    // Apply stealth to all existing pages
    for (const page of pages) {
        await applyStealthToPage(page, fullConfig);
    }
    // Apply stealth to new pages automatically
    browser.on('targetcreated', async (target) => {
        const page = await target.page();
        if (page) {
            await applyStealthToPage(page, fullConfig);
        }
    });
}
/**
 * Apply stealth features to a single page
 */
async function applyStealthToPage(page, config) {
    // Bot Detection Evasion
    if (config.enableBotDetectionEvasion) {
        await evadeBotDetection(page);
    }
    // Fingerprint Randomization
    if (config.enableFingerprinting) {
        await randomizeFingerprint(page);
    }
    // Human Behavior (applied at interaction time, not page load)
    // This is handled in tool implementations
}
/**
 * Evade bot detection mechanisms
 */
async function evadeBotDetection(page) {
    await page.evaluateOnNewDocument(() => {
        // 🟢 WORKING: Hide webdriver property
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
        // 🟢 WORKING: Override Chrome object
        window.chrome = {
            runtime: {},
            loadTimes: function () { },
            csi: function () { },
            app: {},
        };
        // 🟢 WORKING: Override permissions query
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => parameters.name === 'notifications'
            ? Promise.resolve({
                state: Notification.permission,
            })
            : originalQuery(parameters);
        // 🟢 WORKING: Add plugins
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                {
                    0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf' },
                    description: 'Portable Document Format',
                    filename: 'internal-pdf-viewer',
                    length: 1,
                    name: 'Chrome PDF Plugin',
                },
                {
                    0: { type: 'application/pdf', suffixes: 'pdf' },
                    description: 'Portable Document Format',
                    filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
                    length: 1,
                    name: 'Chrome PDF Viewer',
                },
                {
                    0: { type: 'application/x-nacl', suffixes: '' },
                    1: { type: 'application/x-pnacl', suffixes: '' },
                    description: 'Native Client Executable',
                    filename: 'internal-nacl-plugin',
                    length: 2,
                    name: 'Native Client',
                },
            ],
        });
        // 🟢 WORKING: Override language
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });
    });
}
/**
 * Randomize browser fingerprint
 */
async function randomizeFingerprint(page) {
    // Generate unique seed for this instance
    const seed = Math.random();
    await page.evaluateOnNewDocument((instanceSeed) => {
        // Store debug info in window for test access
        window.__GHOST_DEBUG__ = {
            seed: instanceSeed,
            applied: true,
            timestamp: Date.now(),
        };
        // Debug logging
        console.log('[GHOST MODE] Instance seed:', instanceSeed);
        // 🟢 WORKING: Canvas fingerprint randomization with unique seed
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        const originalToBlob = HTMLCanvasElement.prototype.toBlob;
        const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        // Seeded random number generator
        let randomSeed = instanceSeed;
        const seededRandom = () => {
            randomSeed = (randomSeed * 9301 + 49297) % 233280;
            return randomSeed / 233280;
        };
        // Add noise to canvas with seeded randomness - per-pixel variation
        const addCanvasNoise = (data) => {
            for (let i = 0; i < data.length; i += 4) {
                // Generate unique noise per pixel using seeded random
                // Use additive noise (-1 to +1 range) to ensure visible differences
                const noise = (seededRandom() - 0.5) * 2; // Range: -1 to +1
                data[i] = Math.min(255, Math.max(0, data[i] + noise));
                data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
                data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
                // Don't modify alpha channel (i+3)
            }
        };
        HTMLCanvasElement.prototype.toDataURL = function (...args) {
            const ctx = this.getContext('2d');
            if (ctx && this.width > 0 && this.height > 0) {
                console.log('[GHOST MODE] toDataURL called, canvas size:', this.width, 'x', this.height, 'seed:', instanceSeed);
                // Get original image data
                const originalImageData = originalGetImageData.call(ctx, 0, 0, this.width, this.height);
                // Create a copy to avoid modifying the canvas
                const noisyImageData = ctx.createImageData(originalImageData);
                noisyImageData.data.set(originalImageData.data);
                // Reset seed for actual noise application
                randomSeed = instanceSeed;
                // Add noise to the copy (seededRandom will be called per-pixel)
                addCanvasNoise(noisyImageData.data);
                // Temporarily replace canvas data
                ctx.putImageData(noisyImageData, 0, 0);
                // Get the data URL with noise
                const result = originalToDataURL.apply(this, args);
                // Restore original data
                ctx.putImageData(originalImageData, 0, 0);
                console.log('[GHOST MODE] toDataURL complete, result length:', result.length);
                return result;
            }
            return originalToDataURL.apply(this, args);
        };
        CanvasRenderingContext2D.prototype.getImageData = function (...args) {
            // Don't modify getImageData - let toDataURL handle the noise
            return originalGetImageData.apply(this, args);
        };
        // 🟢 WORKING: WebGL fingerprint randomization with instance seed
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (parameter) {
            // Randomize renderer and vendor using instance seed directly
            // Don't use seededRandom() because it's been consumed by canvas noise
            if (parameter === 37445) {
                // UNMASKED_VENDOR_WEBGL
                const vendors = [
                    'Intel Inc.',
                    'Google Inc.',
                    'NVIDIA Corporation',
                    'AMD',
                ];
                // Use instanceSeed * prime to get different distribution than timezone
                return vendors[Math.floor((instanceSeed * 7919) % 1 * vendors.length)];
            }
            if (parameter === 37446) {
                // UNMASKED_RENDERER_WEBGL
                const renderers = [
                    'Intel Iris OpenGL Engine',
                    'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)',
                    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
                    'AMD Radeon Pro 5500M OpenGL Engine',
                ];
                // Use instanceSeed * different prime for renderer
                return renderers[Math.floor((instanceSeed * 7927) % 1 * renderers.length)];
            }
            return getParameter.apply(this, [parameter]);
        };
        // 🟢 WORKING: Timezone randomization with instance seed
        const timezones = [
            'America/New_York',
            'America/Los_Angeles',
            'Europe/London',
            'Europe/Paris',
            'Asia/Tokyo',
            'Australia/Sydney',
        ];
        // Use instanceSeed directly for timezone selection to ensure different instances get different timezones
        // Don't use seededRandom() here because it's been consumed by canvas noise
        const randomTimezone = timezones[Math.floor(instanceSeed * timezones.length)];
        console.log('[GHOST MODE] Selected timezone:', randomTimezone, 'seed:', instanceSeed);
        // Override Intl.DateTimeFormat to use random timezone
        const OriginalDateTimeFormat = Intl.DateTimeFormat;
        // @ts-expect-error - Overriding global constructor
        Intl.DateTimeFormat = function (...args) {
            if (args.length === 0 ||
                !args[1] ||
                typeof args[1] !== 'object' ||
                !('timeZone' in args[1])) {
                const modifiedArgs = args.slice();
                if (!modifiedArgs[1]) {
                    modifiedArgs[1] = {};
                }
                modifiedArgs[1].timeZone = randomTimezone;
                return new OriginalDateTimeFormat(modifiedArgs[0], modifiedArgs[1]);
            }
            return new OriginalDateTimeFormat(args[0], args[1]);
        };
    }, seed);
}
/**
 * Generate human-like mouse movement using Bezier curves
 */
export function generateHumanMousePath(startX, startY, endX, endY, steps = 20) {
    const path = [];
    // Control points for Bezier curve (add randomness)
    const cp1x = startX + (endX - startX) * (0.25 + Math.random() * 0.2);
    const cp1y = startY + (endY - startY) * (0.25 + Math.random() * 0.2);
    const cp2x = startX + (endX - startX) * (0.75 + Math.random() * 0.2);
    const cp2y = startY + (endY - startY) * (0.75 + Math.random() * 0.2);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const oneMinusT = 1 - t;
        // Cubic Bezier curve formula
        const x = oneMinusT ** 3 * startX +
            3 * oneMinusT ** 2 * t * cp1x +
            3 * oneMinusT * t ** 2 * cp2x +
            t ** 3 * endX;
        const y = oneMinusT ** 3 * startY +
            3 * oneMinusT ** 2 * t * cp1y +
            3 * oneMinusT * t ** 2 * cp2y +
            t ** 3 * endY;
        path.push({ x: Math.round(x), y: Math.round(y) });
    }
    return path;
}
/**
 * Generate random typing delay (human-like)
 */
export function generateTypingDelay() {
    // Average typing speed: 50-150ms per character
    const baseDelay = 50 + Math.random() * 100;
    // Add occasional longer pauses (thinking)
    const thinkingChance = Math.random();
    if (thinkingChance < 0.1) {
        return baseDelay + 200 + Math.random() * 300;
    }
    return baseDelay;
}
/**
 * Generate random action pause (between interactions)
 */
export function generateActionPause() {
    // Random pause between 500ms and 2000ms
    return 500 + Math.random() * 1500;
}
/**
 * Simulate typing with occasional typos and corrections
 */
/**
 * Helper function to wait for a specified duration
 */
async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export async function typeHumanLike(page, selector, text) {
    await page.focus(selector);
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        // 5% chance of typo
        if (Math.random() < 0.05 && i < text.length - 1) {
            // Type wrong character
            const wrongChar = String.fromCharCode(char.charCodeAt(0) + (Math.random() < 0.5 ? 1 : -1));
            await page.keyboard.type(wrongChar, {
                delay: generateTypingDelay(),
            });
            // Pause (realize mistake)
            await wait(100 + Math.random() * 200);
            // Backspace
            await page.keyboard.press('Backspace', {
                delay: 50,
            });
        }
        // Type correct character
        await page.keyboard.type(char, {
            delay: generateTypingDelay(),
        });
    }
}
