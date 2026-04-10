/**
 * Boss Ghost MCP — Site authentication tool.
 *
 * Reads credentials from ~/.boss-ghost/config.json (never from the MCP client)
 * and auto-fills login forms. The MCP client never sees or handles credentials.
 */
import { defineTool } from './ToolDefinition.js';
import { ToolCategory } from './categories.js';
import { zod } from '../third_party/index.js';
import { getConfig, saveConfig } from '../config/config.js';
import { logger } from '../logger.js';
/**
 * Match a site key from config.auth against a URL.
 * Supports exact hostname match and wildcard patterns.
 */
function findAuthConfig(url) {
    const auth = getConfig().auth;
    if (!auth)
        return null;
    let hostname;
    try {
        hostname = new URL(url).hostname.toLowerCase();
    }
    catch {
        return null;
    }
    // Exact match first
    if (auth[hostname]) {
        return { site: hostname, config: auth[hostname] };
    }
    // Try with protocol variations
    for (const [key, config] of Object.entries(auth)) {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey === hostname) {
            return { site: key, config };
        }
        // Wildcard: *.example.com
        if (normalizedKey.startsWith('*.')) {
            const suffix = normalizedKey.slice(2);
            if (hostname.endsWith(`.${suffix}`) || hostname === suffix) {
                return { site: key, config };
            }
        }
    }
    return null;
}
export const browserLogin = defineTool({
    name: 'browser_login',
    description: 'Authenticate with a website using credentials stored in ~/.boss-ghost/config.json. ' +
        'Credentials are read locally from the config file — they are never passed through the MCP client. ' +
        'Use this when a page requires login.',
    annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: false,
    },
    schema: {
        site: zod
            .string()
            .optional()
            .describe('Hostname to authenticate with (e.g. "app.isaflow.co.za"). If omitted, uses the current page URL.'),
    },
    handler: async (request, response, context) => {
        const page = context.getSelectedPage();
        const currentUrl = page.url();
        // Determine which site to auth for
        const targetSite = request.params.site;
        const lookupUrl = targetSite
            ? targetSite.includes('://') ? targetSite : `https://${targetSite}`
            : currentUrl;
        const match = findAuthConfig(lookupUrl);
        if (!match) {
            response.appendResponseLine(`No auth config found for "${targetSite ?? currentUrl}". ` +
                `Add credentials to ~/.boss-ghost/config.json under the "auth" key.`);
            response.appendResponseLine('');
            response.appendResponseLine('Example:');
            response.appendResponseLine('```json');
            response.appendResponseLine('{');
            response.appendResponseLine('  "auth": {');
            response.appendResponseLine('    "app.example.com": {');
            response.appendResponseLine('      "method": "form",');
            response.appendResponseLine('      "fields": { "email": "you@example.com", "password": "..." },');
            response.appendResponseLine('      "submitSelector": "button[type=submit]"');
            response.appendResponseLine('    }');
            response.appendResponseLine('  }');
            response.appendResponseLine('}');
            response.appendResponseLine('```');
            return;
        }
        const { site, config } = match;
        logger('browser_login: authenticating with %s (method: %s)', site, config.method);
        if (config.method === 'basic') {
            // HTTP basic auth — set credentials on the page
            if (!config.username || !config.password) {
                response.appendResponseLine(`Basic auth config for "${site}" is missing username or password.`);
                return;
            }
            await page.authenticate({
                username: config.username,
                password: config.password,
            });
            response.appendResponseLine(`HTTP Basic auth credentials set for ${site}.`);
            // Reload to apply
            await page.reload();
            response.appendResponseLine('Page reloaded with auth credentials.');
            response.includeSnapshot();
            return;
        }
        // Form-based auth
        if (!config.fields || Object.keys(config.fields).length === 0) {
            response.appendResponseLine(`Form auth config for "${site}" has no fields defined.`);
            return;
        }
        // Navigate to login URL if specified and not already there
        if (config.loginUrl) {
            const loginTarget = config.loginUrl.startsWith('http')
                ? config.loginUrl
                : `https://${site}${config.loginUrl}`;
            if (!currentUrl.includes(site) || !currentUrl.includes(config.loginUrl.replace(/^\//, ''))) {
                logger('browser_login: navigating to %s', loginTarget);
                await page.goto(loginTarget, { waitUntil: 'networkidle2', timeout: 15000 });
                // Wait for form to render
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        // Fill each field by trying multiple selector strategies
        for (const [fieldKey, fieldValue] of Object.entries(config.fields)) {
            const selectors = [
                `input[name="${fieldKey}"]`,
                `input[id="${fieldKey}"]`,
                `input[type="${fieldKey}"]`,
                `input[placeholder*="${fieldKey}" i]`,
                `input[aria-label*="${fieldKey}" i]`,
                `textarea[name="${fieldKey}"]`,
                `textarea[id="${fieldKey}"]`,
            ];
            let filled = false;
            for (const selector of selectors) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        await element.click({ clickCount: 3 }); // Select all existing text
                        await element.type(fieldValue, { delay: 30 });
                        logger('browser_login: filled field "%s" via selector "%s"', fieldKey, selector);
                        filled = true;
                        break;
                    }
                }
                catch {
                    continue;
                }
            }
            if (!filled) {
                // Last resort: try label text
                try {
                    const inputSelector = await page.evaluate((key) => {
                        const labels = Array.from(document.querySelectorAll('label'));
                        for (const label of labels) {
                            if (label.textContent?.toLowerCase().includes(key.toLowerCase())) {
                                const forId = label.getAttribute('for');
                                if (forId)
                                    return `#${forId}`;
                                const input = label.querySelector('input, textarea');
                                if (input) {
                                    const id = input.getAttribute('id');
                                    if (id)
                                        return `#${id}`;
                                    const name = input.getAttribute('name');
                                    if (name)
                                        return `[name="${name}"]`;
                                }
                            }
                        }
                        return null;
                    }, fieldKey);
                    if (inputSelector) {
                        const element = await page.$(inputSelector);
                        if (element) {
                            await element.click({ clickCount: 3 });
                            await element.type(fieldValue, { delay: 30 });
                            logger('browser_login: filled field "%s" via label match', fieldKey);
                            filled = true;
                        }
                    }
                }
                catch {
                    // ignore
                }
            }
            if (!filled) {
                response.appendResponseLine(`Warning: could not find input for field "${fieldKey}"`);
            }
        }
        // Click submit
        const submitSelector = config.submitSelector ?? 'button[type="submit"]';
        const submitFallbacks = [
            submitSelector,
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Sign In")',
            'button:has-text("Log In")',
            'button:has-text("Login")',
        ];
        let submitted = false;
        for (const selector of submitFallbacks) {
            try {
                // Use page.locator for :has-text pseudo selectors
                if (selector.includes(':has-text')) {
                    const textMatch = selector.match(/:has-text\("(.+?)"\)/);
                    if (textMatch) {
                        const buttons = await page.$$('button');
                        for (const btn of buttons) {
                            const text = await btn.evaluate(el => el.textContent?.trim());
                            if (text?.toLowerCase().includes(textMatch[1].toLowerCase())) {
                                await btn.click();
                                submitted = true;
                                break;
                            }
                        }
                    }
                }
                else {
                    const btn = await page.$(selector);
                    if (btn) {
                        await btn.click();
                        submitted = true;
                    }
                }
                if (submitted)
                    break;
            }
            catch {
                continue;
            }
        }
        if (!submitted) {
            response.appendResponseLine('Warning: could not find submit button. Try pressing Enter.');
            await page.keyboard.press('Enter');
        }
        // Wait for navigation
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
        }
        catch {
            // Page may not navigate (SPA login)
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        const newUrl = page.url();
        response.appendResponseLine(`Login submitted for ${site}.`);
        response.appendResponseLine(`Current page: ${newUrl}`);
        response.includeSnapshot();
    },
});
export const saveCredentials = defineTool({
    name: 'save_credentials',
    description: 'Capture filled login form fields from the current page and save them to ~/.boss-ghost/config.json. ' +
        'Use this after manually filling a login form to remember the credentials for future browser_login calls. ' +
        'Reads input values directly from the page DOM — credentials are stored locally and never sent through MCP.',
    annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: false,
    },
    schema: {
        site: zod
            .string()
            .optional()
            .describe('Hostname to save under. Defaults to current page hostname.'),
        submitSelector: zod
            .string()
            .optional()
            .describe('CSS selector for the submit button. Defaults to button[type="submit"].'),
    },
    handler: async (request, response, context) => {
        const page = context.getSelectedPage();
        const currentUrl = page.url();
        let hostname;
        try {
            hostname = request.params.site ?? new URL(currentUrl).hostname;
        }
        catch {
            response.appendResponseLine('Could not determine hostname from current page.');
            return;
        }
        // Extract all filled form fields from the page
        const fields = await page.evaluate(() => {
            const result = {};
            const inputs = Array.from(document.querySelectorAll('input, textarea'));
            for (const input of inputs) {
                const el = input;
                const value = el.value;
                if (!value || value.trim().length === 0)
                    continue;
                // Skip hidden, submit, button, file, checkbox, radio inputs
                const type = (el.type || '').toLowerCase();
                if (['hidden', 'submit', 'button', 'file', 'image', 'reset'].includes(type))
                    continue;
                // Determine the best key for this field
                const key = el.name ||
                    el.id ||
                    el.getAttribute('aria-label') ||
                    el.placeholder ||
                    type;
                if (key) {
                    result[key] = value;
                }
            }
            return result;
        });
        if (Object.keys(fields).length === 0) {
            response.appendResponseLine('No filled form fields found on the current page.');
            return;
        }
        // Save to config
        const config = getConfig();
        if (!config.auth) {
            config.auth = {};
        }
        const existing = config.auth[hostname];
        config.auth[hostname] = {
            method: 'form',
            fields,
            submitSelector: request.params.submitSelector ?? existing?.submitSelector ?? 'button[type="submit"]',
            loginUrl: existing?.loginUrl,
        };
        saveConfig(config);
        // Report what was saved (field names only, not values)
        const fieldNames = Object.keys(fields);
        response.appendResponseLine(`Credentials saved for **${hostname}** (${fieldNames.length} fields: ${fieldNames.join(', ')}).`);
        response.appendResponseLine(`Stored in ~/.boss-ghost/config.json.`);
        response.appendResponseLine(`Use \`browser_login\` to auto-fill next time.`);
    },
});
export const listAuthSites = defineTool({
    name: 'list_auth_sites',
    description: 'List all sites with authentication configured in ~/.boss-ghost/config.json.',
    annotations: {
        category: ToolCategory.NAVIGATION,
        readOnlyHint: true,
    },
    schema: {},
    handler: async (_request, response) => {
        const auth = getConfig().auth;
        if (!auth || Object.keys(auth).length === 0) {
            response.appendResponseLine('No auth sites configured in ~/.boss-ghost/config.json.');
            return;
        }
        response.appendResponseLine('## Configured Auth Sites');
        for (const [site, config] of Object.entries(auth)) {
            const fields = config.fields ? Object.keys(config.fields).join(', ') : 'none';
            response.appendResponseLine(`- **${site}** [${config.method}] fields: ${fields}${config.loginUrl ? ` login: ${config.loginUrl}` : ''}`);
        }
    },
});
