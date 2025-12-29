/**
 * @license
 * Copyright 2025 BOSS Ghost MCP
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * CAPTCHA Detector
 *
 * Automatically detects various CAPTCHA types on web pages:
 * - Google reCAPTCHA v2 (checkbox)
 * - Google reCAPTCHA v3 (invisible)
 * - hCaptcha
 * - Cloudflare Turnstile
 * - Image-based CAPTCHAs
 * - Audio CAPTCHAs
 *
 * Detection strategies:
 * 1. DOM structure analysis (iframe, div patterns)
 * 2. Class/ID pattern matching
 * 3. Script tag analysis (grecaptcha, hcaptcha APIs)
 * 4. Visual element detection
 *
 * @example
 * ```typescript
 * const detector = new CaptchaDetector();
 * const captchas = await detector.detect(page);
 *
 * if (captchas.length > 0) {
 *   console.log(`Found ${captchas.length} CAPTCHA(s)`);
 *   for (const captcha of captchas) {
 *     console.log(`Type: ${captcha.type}, Confidence: ${captcha.confidence}`);
 *   }
 * }
 * ```
 */
export class CaptchaDetector {
    /**
     * Detect all CAPTCHAs on page
     *
     * @param page - Puppeteer page instance
     * @returns Array of detected CAPTCHAs
     */
    async detect(page) {
        const captchas = [];
        // Detect reCAPTCHA v2
        const recaptchaV2 = await this.detectReCaptchaV2(page);
        if (recaptchaV2) {
            captchas.push(recaptchaV2);
        }
        // Detect reCAPTCHA v3
        const recaptchaV3 = await this.detectReCaptchaV3(page);
        if (recaptchaV3) {
            captchas.push(recaptchaV3);
        }
        // Detect hCaptcha
        const hcaptcha = await this.detectHCaptcha(page);
        if (hcaptcha) {
            captchas.push(hcaptcha);
        }
        // Detect Cloudflare Turnstile
        const cloudflare = await this.detectCloudflareTurnstile(page);
        if (cloudflare) {
            captchas.push(cloudflare);
        }
        // Detect image CAPTCHAs
        const imageCaptchas = await this.detectImageCaptcha(page);
        captchas.push(...imageCaptchas);
        return captchas;
    }
    /**
     * Detect Google reCAPTCHA v2 (checkbox)
     */
    async detectReCaptchaV2(page) {
        const result = await page.evaluate(() => {
            // Check for reCAPTCHA v2 iframe
            const iframe = document.querySelector('iframe[src*="google.com/recaptcha/api2/anchor"]');
            if (iframe) {
                const rect = iframe.getBoundingClientRect();
                return {
                    found: true,
                    location: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                    },
                };
            }
            // Check for reCAPTCHA div container
            const container = document.querySelector('.g-recaptcha');
            if (container) {
                const rect = container.getBoundingClientRect();
                const sitekey = container.getAttribute('data-sitekey');
                return {
                    found: true,
                    location: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                    },
                    sitekey: sitekey || undefined,
                };
            }
            return { found: false };
        });
        if (result.found) {
            const element = await page.$('iframe[src*="google.com/recaptcha/api2/anchor"], .g-recaptcha');
            return {
                type: 'recaptcha_v2',
                confidence: 0.95,
                element,
                location: result.location ?? null,
                metadata: {
                    sitekey: result.sitekey,
                },
            };
        }
        return null;
    }
    /**
     * Detect Google reCAPTCHA v3 (invisible)
     */
    async detectReCaptchaV3(page) {
        const result = await page.evaluate(() => {
            // Check for grecaptcha API
            if (typeof window.grecaptcha !== 'undefined') {
                // Check for reCAPTCHA badge (v3 indicator)
                const badge = document.querySelector('.grecaptcha-badge');
                if (badge) {
                    const rect = badge.getBoundingClientRect();
                    return {
                        found: true,
                        location: {
                            x: rect.x,
                            y: rect.y,
                            width: rect.width,
                            height: rect.height,
                        },
                    };
                }
                return { found: true, location: null };
            }
            return { found: false };
        });
        if (result.found) {
            const element = await page.$('.grecaptcha-badge');
            return {
                type: 'recaptcha_v3',
                confidence: 0.90,
                element,
                location: result.location ?? null,
            };
        }
        return null;
    }
    /**
     * Detect hCaptcha
     */
    async detectHCaptcha(page) {
        const result = await page.evaluate(() => {
            // Check for hCaptcha iframe
            const iframe = document.querySelector('iframe[src*="hcaptcha.com/captcha"]');
            if (iframe) {
                const rect = iframe.getBoundingClientRect();
                return {
                    found: true,
                    location: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                    },
                };
            }
            // Check for hCaptcha div container
            const container = document.querySelector('.h-captcha');
            if (container) {
                const rect = container.getBoundingClientRect();
                const sitekey = container.getAttribute('data-sitekey');
                return {
                    found: true,
                    location: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                    },
                    sitekey: sitekey || undefined,
                };
            }
            return { found: false };
        });
        if (result.found) {
            const element = await page.$('iframe[src*="hcaptcha.com/captcha"], .h-captcha');
            return {
                type: 'hcaptcha',
                confidence: 0.95,
                element,
                location: result.location ?? null,
                metadata: {
                    sitekey: result.sitekey,
                },
            };
        }
        return null;
    }
    /**
     * Detect Cloudflare Turnstile
     */
    async detectCloudflareTurnstile(page) {
        const result = await page.evaluate(() => {
            // Check for Cloudflare challenge page
            const challengeTitle = document.querySelector('title');
            if (challengeTitle?.textContent?.includes('Just a moment') ||
                challengeTitle?.textContent?.includes('Attention Required')) {
                return { found: true, location: null };
            }
            // Check for Turnstile widget
            const turnstile = document.querySelector('[data-sitekey][data-callback]');
            if (turnstile) {
                const rect = turnstile.getBoundingClientRect();
                const sitekey = turnstile.getAttribute('data-sitekey');
                return {
                    found: true,
                    location: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                    },
                    sitekey: sitekey || undefined,
                };
            }
            return { found: false };
        });
        if (result.found) {
            const element = await page.$('[data-sitekey][data-callback]');
            return {
                type: 'cloudflare',
                confidence: 0.85,
                element,
                location: result.location ?? null,
                metadata: {
                    sitekey: result.sitekey,
                },
            };
        }
        return null;
    }
    /**
     * Detect image-based CAPTCHAs
     */
    async detectImageCaptcha(page) {
        const results = await page.evaluate(() => {
            const detections = [];
            // Common CAPTCHA keywords in text
            const keywords = [
                'captcha',
                'verification',
                'verify you are human',
                'prove you are not a robot',
                'security check',
            ];
            // Find elements with CAPTCHA-related text
            const allText = document.body.innerText.toLowerCase();
            const hasCaptchaKeyword = keywords.some(keyword => allText.includes(keyword));
            if (hasCaptchaKeyword) {
                // Look for images that might be CAPTCHA
                const images = document.querySelectorAll('img');
                images.forEach(img => {
                    const src = img.src.toLowerCase();
                    const alt = (img.alt || '').toLowerCase();
                    // ✅ Check src and alt for CAPTCHA-related keywords
                    if (src.includes('captcha') ||
                        src.includes('verification') || // ✅ Added: Check src for "verification"
                        alt.includes('captcha') ||
                        alt.includes('verification')) {
                        const rect = img.getBoundingClientRect();
                        detections.push({
                            location: {
                                x: rect.x,
                                y: rect.y,
                                width: rect.width,
                                height: rect.height,
                            },
                            confidence: 0.7,
                        });
                    }
                });
            }
            return detections;
        });
        return results.map(result => ({
            type: 'image',
            confidence: result.confidence,
            element: null, // Can't pass ElementHandle through evaluate
            location: result.location,
        }));
    }
    /**
     * Wait for CAPTCHA to appear on page
     *
     * @param page - Puppeteer page instance
     * @param timeout - Maximum wait time in milliseconds (default: 30000)
     * @returns First detected CAPTCHA or null if timeout
     */
    async waitForCaptcha(page, timeout = 30000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const captchas = await this.detect(page);
            if (captchas.length > 0) {
                console.log(`[CAPTCHA] Detected ${captchas[0].type} after ${Date.now() - startTime}ms`);
                return captchas[0];
            }
            // Wait 500ms before next check
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        return null;
    }
    /**
     * Wait for CAPTCHA to be solved
     *
     * Monitors page for CAPTCHA disappearance or form submission
     *
     * @param page - Puppeteer page instance
     * @param captcha - CAPTCHA detection result to monitor
     * @param timeout - Maximum wait time in milliseconds (default: 120000)
     * @returns True if CAPTCHA was solved, false if timeout
     */
    async waitForSolution(page, captcha, timeout = 120000) {
        const startTime = Date.now();
        console.log(`[CAPTCHA] Waiting for ${captcha.type} solution...`);
        while (Date.now() - startTime < timeout) {
            // Check if CAPTCHA element is gone
            const captchas = await this.detect(page);
            const stillPresent = captchas.some(c => c.type === captcha.type);
            if (!stillPresent) {
                console.log(`[CAPTCHA] ${captcha.type} solved after ${Date.now() - startTime}ms`);
                return true;
            }
            // Wait 1 second before next check
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log(`[CAPTCHA] Timeout waiting for ${captcha.type} solution`);
        return false;
    }
    /**
     * Get CAPTCHA statistics from page
     */
    async getStats(page) {
        const captchas = await this.detect(page);
        const byType = {
            recaptcha_v2: 0,
            recaptcha_v3: 0,
            hcaptcha: 0,
            cloudflare: 0,
            image: 0,
            audio: 0,
            unknown: 0,
        };
        captchas.forEach(captcha => {
            byType[captcha.type]++;
        });
        return {
            total: captchas.length,
            byType,
        };
    }
}
