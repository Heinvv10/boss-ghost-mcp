import assert from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { launch } from '../../src/browser.js';
/**
 * Fingerprint Randomization Tests
 * Tests: Canvas, WebGL, timezone randomization
 *
 * Expected behavior:
 * - BOSS Ghost MCP: Different fingerprints across instances
 * - Chrome DevTools MCP: Identical fingerprints (baseline)
 */
describe('Fingerprint Randomization', () => {
    let bossGhost1;
    let bossGhost2;
    let chrome1;
    let chrome2;
    before(async () => {
        // 🟢 WORKING: Launch two BOSS Ghost instances with Ghost Mode
        bossGhost1 = await launch({
            headless: true,
            isolated: true,
            devtools: false,
            ghostMode: {
                enabled: true,
                stealthLevel: 'maximum',
                enableFingerprinting: true,
                enableHumanBehavior: true,
                enableBotDetectionEvasion: true,
            },
        });
        bossGhost2 = await launch({
            headless: true,
            isolated: true,
            devtools: false,
            ghostMode: {
                enabled: true,
                stealthLevel: 'maximum',
                enableFingerprinting: true,
                enableHumanBehavior: true,
                enableBotDetectionEvasion: true,
            },
        });
        // 🟢 WORKING: Launch two standard Chrome instances without Ghost Mode
        chrome1 = await launch({
            headless: true,
            isolated: true,
            devtools: false,
            // No ghostMode - standard Chrome
        });
        chrome2 = await launch({
            headless: true,
            isolated: true,
            devtools: false,
            // No ghostMode - standard Chrome
        });
    }, { timeout: 60000 });
    after(async () => {
        await bossGhost1?.close();
        await bossGhost2?.close();
        await chrome1?.close();
        await chrome2?.close();
    });
    it('BOSS Ghost MCP: canvas fingerprints should differ between instances', { timeout: 15000 }, async () => {
        // 🟢 WORKING: Canvas fingerprints should be randomized
        const [page1] = await bossGhost1.pages();
        await page1.goto('about:blank');
        const result1 = await page1.evaluate(() => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx)
                return { dataURL: '', debugInfo: 'no context' };
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillText('Test', 2, 2);
            // Get debug info from window if available
            const debugInfo = window.__GHOST_DEBUG__ || 'no debug info';
            return {
                dataURL: canvas.toDataURL(),
                debugInfo: debugInfo,
                hasToDataURLOverride: HTMLCanvasElement.prototype.toDataURL.toString().includes('originalToDataURL') ||
                    HTMLCanvasElement.prototype.toDataURL.toString().includes('GHOST MODE'),
            };
        });
        const [page2] = await bossGhost2.pages();
        await page2.goto('about:blank');
        const result2 = await page2.evaluate(() => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx)
                return { dataURL: '', debugInfo: 'no context' };
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillText('Test', 2, 2);
            // Get debug info from window if available
            const debugInfo = window.__GHOST_DEBUG__ || 'no debug info';
            return {
                dataURL: canvas.toDataURL(),
                debugInfo: debugInfo,
                hasToDataURLOverride: HTMLCanvasElement.prototype.toDataURL.toString().includes('originalToDataURL') ||
                    HTMLCanvasElement.prototype.toDataURL.toString().includes('GHOST MODE'),
            };
        });
        // Log debug information
        console.log('[TEST DEBUG] Instance 1:', {
            hasOverride: result1.hasToDataURLOverride,
            debugInfo: result1.debugInfo,
            dataURLLength: result1.dataURL.length,
            dataURLStart: result1.dataURL.substring(0, 100),
        });
        console.log('[TEST DEBUG] Instance 2:', {
            hasOverride: result2.hasToDataURLOverride,
            debugInfo: result2.debugInfo,
            dataURLLength: result2.dataURL.length,
            dataURLStart: result2.dataURL.substring(0, 100),
        });
        // Canvas fingerprints should differ due to noise injection
        assert.notStrictEqual(result1.dataURL, result2.dataURL);
    });
    it('Chrome DevTools MCP: canvas fingerprints are IDENTICAL (baseline)', { timeout: 15000 }, async () => {
        // 🟢 WORKING: Baseline test - canvas should be identical
        const [page1] = await chrome1.pages();
        await page1.goto('about:blank');
        const canvas1 = await page1.evaluate(() => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx)
                return '';
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillText('Test', 2, 2);
            return canvas.toDataURL();
        });
        const [page2] = await chrome2.pages();
        await page2.goto('about:blank');
        const canvas2 = await page2.evaluate(() => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx)
                return '';
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillText('Test', 2, 2);
            return canvas.toDataURL();
        });
        // Standard Chrome should have identical canvas fingerprints
        assert.strictEqual(canvas1, canvas2);
    });
    it('BOSS Ghost MCP: WebGL fingerprints should differ between instances', { timeout: 15000 }, async () => {
        // 🟢 WORKING: WebGL fingerprints should be randomized
        const [page1] = await bossGhost1.pages();
        await page1.goto('about:blank');
        const webgl1 = await page1.evaluate(() => {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl');
            if (!gl)
                return { vendor: 'N/A', renderer: 'N/A' };
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo)
                return { vendor: 'N/A', renderer: 'N/A' };
            return {
                vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
                renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
            };
        });
        const [page2] = await bossGhost2.pages();
        await page2.goto('about:blank');
        const webgl2 = await page2.evaluate(() => {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl');
            if (!gl)
                return { vendor: 'N/A', renderer: 'N/A' };
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo)
                return { vendor: 'N/A', renderer: 'N/A' };
            return {
                vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
                renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
            };
        });
        // WebGL vendor and renderer should differ due to randomization
        // At least one of vendor or renderer should be different
        const isDifferent = webgl1.vendor !== webgl2.vendor ||
            webgl1.renderer !== webgl2.renderer;
        assert.strictEqual(isDifferent, true);
    });
    it('Chrome DevTools MCP: WebGL fingerprints are IDENTICAL (baseline)', { timeout: 15000 }, async () => {
        // 🟢 WORKING: Baseline test - WebGL should be identical
        const [page1] = await chrome1.pages();
        await page1.goto('about:blank');
        const webgl1 = await page1.evaluate(() => {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl');
            if (!gl)
                return { vendor: 'N/A', renderer: 'N/A' };
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo)
                return { vendor: 'N/A', renderer: 'N/A' };
            return {
                vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
                renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
            };
        });
        const [page2] = await chrome2.pages();
        await page2.goto('about:blank');
        const webgl2 = await page2.evaluate(() => {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl');
            if (!gl)
                return { vendor: 'N/A', renderer: 'N/A' };
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo)
                return { vendor: 'N/A', renderer: 'N/A' };
            return {
                vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
                renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
            };
        });
        // Standard Chrome should have identical WebGL fingerprints
        assert.deepStrictEqual(webgl1, webgl2);
    });
    it('BOSS Ghost MCP: timezone should be randomized', { timeout: 60000 }, async () => {
        // 🟢 WORKING: Timezone should be randomized across instances
        const timezones = new Set();
        // Launch 5 instances and collect timezones
        for (let i = 0; i < 5; i++) {
            const instance = await launch({
                headless: true,
                isolated: true,
                devtools: false,
                ghostMode: {
                    enabled: true,
                    stealthLevel: 'maximum',
                    enableFingerprinting: true,
                    enableHumanBehavior: true,
                    enableBotDetectionEvasion: true,
                },
            });
            const [page] = await instance.pages();
            await page.goto('about:blank');
            const timezone = await page.evaluate(() => {
                return Intl.DateTimeFormat().resolvedOptions().timeZone;
            });
            timezones.add(timezone);
            await instance.close();
        }
        // Should have at least 2 different timezones out of 5 instances
        assert.ok(timezones.size > 1);
    });
    it('Chrome DevTools MCP: timezone is ALWAYS SAME (baseline)', { timeout: 45000 }, async () => {
        // 🟢 WORKING: Baseline test - timezone should be consistent
        const timezones = new Set();
        // Launch 5 instances and collect timezones
        for (let i = 0; i < 3; i++) {
            const instance = await launch({
                headless: true,
                isolated: true,
                devtools: false,
                // No ghostMode - standard Chrome
            });
            const [page] = await instance.pages();
            await page.goto('about:blank');
            const timezone = await page.evaluate(() => {
                return Intl.DateTimeFormat().resolvedOptions().timeZone;
            });
            timezones.add(timezone);
            await instance.close();
        }
        // Standard Chrome should have same timezone across all instances
        assert.strictEqual(timezones.size, 1);
    });
});
