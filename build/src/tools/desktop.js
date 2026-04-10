/**
 * Desktop Computer-Use Tools
 *
 * Provides native desktop automation via screenshots + VLM grounding + xdotool.
 * Works with any application on the desktop, not just the browser.
 *
 * Requires: xdotool, ImageMagick (import/convert), VLM endpoint (VLM_API_URL + VLM_MODEL)
 */
import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { zod } from '../third_party/index.js';
import { ToolCategory } from './categories.js';
import { defineTool } from './ToolDefinition.js';
// ── Config ──────────────────────────────────────────────────────────────────
const VLM_API_URL = process.env.VLM_API_URL || '';
const VLM_MODEL = process.env.VLM_MODEL || '';
const MAX_IMAGE_WIDTH = 1280;
const MAX_IMAGE_HEIGHT = 960;
function vlmConfigured() {
    return !!(VLM_API_URL && VLM_MODEL);
}
function captureScreenshot(windowName) {
    const tmpPath = join('/tmp', `bg-desktop-${Date.now()}.png`);
    if (windowName) {
        try {
            const winId = execSync(`xdotool search --name "${windowName.replace(/"/g, '\\"')}" | head -1`, { encoding: 'utf8' }).trim();
            if (!winId)
                throw new Error(`Window "${windowName}" not found`);
            execSync(`import -window ${winId} "${tmpPath}"`, { timeout: 10000 });
        }
        catch {
            // Fallback to full desktop
            execSync(`import -window root "${tmpPath}"`, { timeout: 10000 });
        }
    }
    else {
        execSync(`import -window root "${tmpPath}"`, { timeout: 10000 });
    }
    return tmpPath;
}
function screenshotToBase64(imagePath) {
    const resizedPath = imagePath.replace('.png', '-resized.jpg');
    execSync(`convert "${imagePath}" -resize ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}\\> -quality 85 "${resizedPath}"`, { timeout: 10000 });
    const buffer = readFileSync(resizedPath);
    const base64 = buffer.toString('base64');
    const identify = execSync(`identify -format "%wx%h" "${resizedPath}"`, {
        encoding: 'utf8',
    }).trim();
    const [w, h] = identify.split('x').map(Number);
    try {
        unlinkSync(imagePath);
        unlinkSync(resizedPath);
    }
    catch {
        /* cleanup */
    }
    return {
        dataUrl: `data:image/jpeg;base64,${base64}`,
        width: w,
        height: h,
        base64,
    };
}
async function callVlm(imageDataUrl, prompt, maxTokens = 4096) {
    if (!vlmConfigured()) {
        throw new Error('Desktop VLM tools require VLM_API_URL and VLM_MODEL environment variables');
    }
    const response = await fetch(`${VLM_API_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
            model: VLM_MODEL,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: imageDataUrl } },
                        { type: 'text', text: prompt },
                    ],
                },
            ],
            max_tokens: maxTokens,
            temperature: 0.1,
        }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`VLM error ${response.status}: ${text.slice(0, 300)}`);
    }
    const data = (await response.json());
    const content = data.choices?.[0]?.message?.content ?? '';
    // Strip <think> tags (model-specific chain-of-thought)
    return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}
function parseJsonFromVlm(raw) {
    const match = raw.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (!match)
        throw new Error('VLM did not return valid JSON');
    return JSON.parse(match[0]);
}
// ── Tools ───────────────────────────────────────────────────────────────────
export const desktopScreenshot = defineTool({
    name: 'desktop_screenshot',
    description: `Take a screenshot of the desktop or a specific window. Returns the image and a description of what's visible. Works with any application, not just the browser.`,
    annotations: {
        title: 'Desktop Screenshot',
        category: ToolCategory.DESKTOP,
        readOnlyHint: true,
    },
    schema: {
        windowName: zod
            .string()
            .optional()
            .describe('Title of a specific window to capture. If omitted, captures the full desktop.'),
        describe: zod
            .boolean()
            .default(true)
            .describe('If true, sends the screenshot to the VLM for a description. Set to false to just get the raw image.'),
    },
    handler: async (request, response) => {
        const imgPath = captureScreenshot(request.params.windowName);
        const { dataUrl, width, height, base64 } = screenshotToBase64(imgPath);
        response.attachImage({ mimeType: 'image/jpeg', data: base64 });
        response.appendResponseLine(`Desktop screenshot captured (${width}x${height})`);
        if (request.params.describe && vlmConfigured()) {
            const description = await callVlm(dataUrl, `Describe what you see on this desktop screenshot concisely. Include: visible applications, what the user is working on, and key UI elements with their approximate locations.`, 1024);
            response.appendResponseLine('');
            response.appendResponseLine(description);
        }
    },
});
export const desktopAction = defineTool({
    name: 'desktop_action',
    description: `Use VLM vision to find a UI element on the desktop and perform an action (click, double-click, right-click). Describe what to click in natural language — the VLM will locate it and return coordinates. Works with any application.`,
    annotations: {
        title: 'Desktop Action',
        category: ToolCategory.DESKTOP,
        readOnlyHint: false,
    },
    schema: {
        instruction: zod
            .string()
            .describe('Natural language description of what to click, e.g. "the Save button", "Firefox icon in the dock", "File menu".'),
        action: zod
            .enum(['click', 'double_click', 'right_click'])
            .default('click')
            .describe('Type of click to perform. Default is "click".'),
        windowName: zod
            .string()
            .optional()
            .describe('Optional: capture only this window instead of the full desktop.'),
        dryRun: zod
            .boolean()
            .default(false)
            .describe('If true, only identifies the element and returns coordinates without actually clicking.'),
    },
    handler: async (request, response) => {
        const { instruction, action, windowName, dryRun } = request.params;
        // 1. Capture screenshot
        const imgPath = captureScreenshot(windowName);
        const { dataUrl, width, height, base64 } = screenshotToBase64(imgPath);
        // 2. Ask VLM to locate the element
        const vlmResult = await callVlm(dataUrl, `You are a desktop automation assistant. Look at this screenshot (${width}x${height} pixels) and find the UI element described below.

"${instruction}"

Return a JSON object with:
- element: description of the UI element you found
- coordinates: [x, y] — the exact pixel coordinates to click (center of the element)
- confidence: 0-1 how confident you are this is correct
- reasoning: brief explanation

Return ONLY the JSON object, no other text.`, 512);
        let parsed;
        try {
            parsed = parseJsonFromVlm(vlmResult);
        }
        catch {
            response.appendResponseLine(`VLM could not locate: "${instruction}"`);
            response.appendResponseLine(`Raw response: ${vlmResult}`);
            return;
        }
        const [x, y] = parsed.coordinates;
        response.attachImage({ mimeType: 'image/jpeg', data: base64 });
        response.appendResponseLine(`Found: "${parsed.element}" at (${x}, ${y}) — confidence: ${parsed.confidence}`);
        response.appendResponseLine(`Reasoning: ${parsed.reasoning}`);
        if (dryRun) {
            response.appendResponseLine(`[Dry run — no click performed]`);
            return;
        }
        if (parsed.confidence < 0.5) {
            response.appendResponseLine(`Confidence too low (${parsed.confidence}) — skipping click. Use dryRun:false to force.`);
            return;
        }
        // 3. Execute the action via xdotool
        try {
            switch (action) {
                case 'click':
                    execSync(`xdotool mousemove ${x} ${y} click 1`, { timeout: 5000 });
                    break;
                case 'double_click':
                    execSync(`xdotool mousemove ${x} ${y} click --repeat 2 --delay 100 1`, { timeout: 5000 });
                    break;
                case 'right_click':
                    execSync(`xdotool mousemove ${x} ${y} click 3`, { timeout: 5000 });
                    break;
            }
            response.appendResponseLine(`Performed ${action} at (${x}, ${y})`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            response.appendResponseLine(`Click failed: ${msg}`);
        }
    },
});
export const desktopType = defineTool({
    name: 'desktop_type',
    description: `Type text on the desktop using the keyboard. Optionally click a target element first (via VLM vision) before typing. Works with any focused application.`,
    annotations: {
        title: 'Desktop Type',
        category: ToolCategory.DESKTOP,
        readOnlyHint: false,
    },
    schema: {
        text: zod.string().describe('The text to type.'),
        clickTarget: zod
            .string()
            .optional()
            .describe('Optional: natural language description of where to click first before typing (e.g. "the search box", "the URL bar").'),
        pressEnter: zod
            .boolean()
            .default(false)
            .describe('If true, press Enter after typing.'),
    },
    handler: async (request, response) => {
        const { text, clickTarget, pressEnter } = request.params;
        // Click target first if specified
        if (clickTarget) {
            const imgPath = captureScreenshot();
            const { dataUrl } = screenshotToBase64(imgPath);
            const vlmResult = await callVlm(dataUrl, `Find the UI element: "${clickTarget}". Return JSON: {"coordinates": [x, y], "confidence": 0-1}. ONLY JSON.`, 256);
            try {
                const parsed = parseJsonFromVlm(vlmResult);
                const [x, y] = parsed.coordinates;
                execSync(`xdotool mousemove ${x} ${y} click 1`, { timeout: 5000 });
                // Brief delay for focus
                execSync('sleep 0.2');
                response.appendResponseLine(`Clicked "${clickTarget}" at (${x}, ${y})`);
            }
            catch {
                response.appendResponseLine(`Could not locate "${clickTarget}" — typing at current focus`);
            }
        }
        // Type the text
        execSync(`xdotool type --delay 20 -- "${text.replace(/"/g, '\\"')}"`, {
            timeout: 30000,
        });
        if (pressEnter) {
            execSync('xdotool key Return', { timeout: 5000 });
        }
        response.appendResponseLine(`Typed "${text.length > 50 ? text.slice(0, 50) + '...' : text}"${pressEnter ? ' + Enter' : ''}`);
    },
});
export const desktopKey = defineTool({
    name: 'desktop_key',
    description: `Press a keyboard shortcut or key combination on the desktop. Works with any focused application. Examples: "ctrl+s", "alt+F4", "Return", "ctrl+shift+t".`,
    annotations: {
        title: 'Desktop Key',
        category: ToolCategory.DESKTOP,
        readOnlyHint: false,
    },
    schema: {
        key: zod
            .string()
            .describe('Key or key combination to press. Use xdotool format: "ctrl+s", "alt+F4", "Return", "Tab", "ctrl+shift+t", "super".'),
    },
    handler: async (request, response) => {
        const { key } = request.params;
        try {
            execSync(`xdotool key -- ${key}`, { timeout: 5000 });
            response.appendResponseLine(`Pressed: ${key}`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`Key press failed: ${msg}`);
        }
    },
});
export const desktopFindElements = defineTool({
    name: 'desktop_find_elements',
    description: `Use VLM vision to identify all interactable UI elements on the desktop screenshot. Returns a list of elements with types, labels, and click coordinates. Useful for understanding what's on screen before taking action.`,
    annotations: {
        title: 'Desktop Find Elements',
        category: ToolCategory.DESKTOP,
        readOnlyHint: true,
    },
    schema: {
        windowName: zod
            .string()
            .optional()
            .describe('Optional: capture only this window.'),
        elementType: zod
            .string()
            .optional()
            .describe('Optional: filter by type, e.g. "button", "text_field", "menu_item", "tab".'),
    },
    handler: async (request, response) => {
        const { windowName, elementType } = request.params;
        const imgPath = captureScreenshot(windowName);
        const { dataUrl, width, height, base64 } = screenshotToBase64(imgPath);
        const typeFilter = elementType
            ? `Focus only on elements of type "${elementType}".`
            : '';
        const vlmResult = await callVlm(dataUrl, `Analyze this desktop screenshot (${width}x${height}) and identify the main interactable UI elements. ${typeFilter}

For each element return:
- type: button | text_field | link | menu_item | tab | checkbox | dropdown | icon | other
- label: the visible text or description
- center: [x, y] click coordinates

Return a JSON array. Be selective — only include clearly visible, distinct elements. Limit to 30 most important elements.
Return ONLY the JSON array.`, 2048);
        response.attachImage({ mimeType: 'image/jpeg', data: base64 });
        try {
            const elements = parseJsonFromVlm(vlmResult);
            response.appendResponseLine(`Found ${elements.length} UI elements (${width}x${height}):`);
            response.appendResponseLine('');
            for (const el of elements) {
                response.appendResponseLine(`  [${el.type}] "${el.label}" at (${el.center[0]}, ${el.center[1]})`);
            }
        }
        catch {
            response.appendResponseLine('Element detection result:');
            response.appendResponseLine(vlmResult);
        }
    },
});
export const desktopWindowList = defineTool({
    name: 'desktop_window_list',
    description: `List all open windows on the desktop with their titles and IDs. Useful for targeting specific windows with other desktop tools.`,
    annotations: {
        title: 'Desktop Window List',
        category: ToolCategory.DESKTOP,
        readOnlyHint: true,
    },
    schema: {},
    handler: async (_request, response) => {
        try {
            const output = execSync(`wmctrl -l 2>/dev/null || xdotool search --name "" getwindowname %@ 2>/dev/null | head -50`, { encoding: 'utf8', timeout: 5000 });
            response.appendResponseLine('Open windows:');
            response.appendResponseLine(output.trim());
        }
        catch {
            // Fallback: use xprop
            try {
                const output = execSync(`xdotool search --onlyvisible --name "" 2>/dev/null | while read wid; do echo "$wid: $(xdotool getwindowname $wid 2>/dev/null)"; done | head -30`, { encoding: 'utf8', timeout: 10000 });
                response.appendResponseLine('Open windows:');
                response.appendResponseLine(output.trim());
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                response.appendResponseLine(`Could not list windows: ${msg}`);
            }
        }
    },
});
