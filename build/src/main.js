/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import './polyfill.js';
import process from 'node:process';
import { closeAllBrowsers, ensureBrowserConnected, ensureBrowserLaunched, } from './browser.js';
import { parseArguments } from './cli.js';
import { loadIssueDescriptions } from './issue-descriptions.js';
import { logger, saveLogsToFile } from './logger.js';
import { McpContext } from './McpContext.js';
import { McpResponse } from './McpResponse.js';
import { Mutex } from './Mutex.js';
import { McpServer, StdioServerTransport, SetLevelRequestSchema, } from './third_party/index.js';
import { ToolCategory } from './tools/categories.js';
import { tools } from './tools/tools.js';
// If moved update release-please config
// x-release-please-start-version
const VERSION = '0.12.1';
// x-release-please-end
export const args = parseArguments(VERSION);
const logFile = args.logFile ? saveLogsToFile(args.logFile) : undefined;
process.on('unhandledRejection', (reason, promise) => {
    logger('Unhandled promise rejection', promise, reason);
});
logger(`Starting BOSS Ghost MCP Server v${VERSION}`);
const server = new McpServer({
    name: 'boss_ghost_mcp',
    title: 'BOSS Ghost MCP - Stealth Enhanced Browser Automation',
    version: VERSION,
}, { capabilities: { logging: {} } });
server.server.setRequestHandler(SetLevelRequestSchema, () => {
    return {};
});
let context;
const MAX_CONNECT_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
async function connectBrowser(devtools, extraArgs) {
    return args.browserUrl || args.wsEndpoint || args.autoConnect
        ? await ensureBrowserConnected({
            browserURL: args.browserUrl,
            wsEndpoint: args.wsEndpoint,
            wsHeaders: args.wsHeaders,
            channel: args.autoConnect ? args.channel : undefined,
            userDataDir: args.userDataDir,
            devtools,
        })
        : await ensureBrowserLaunched({
            headless: args.headless,
            executablePath: args.executablePath,
            channel: args.channel,
            isolated: args.isolated ?? false,
            userDataDir: args.userDataDir,
            logFile,
            viewport: args.viewport,
            args: extraArgs,
            acceptInsecureCerts: args.acceptInsecureCerts,
            devtools,
            ghostMode: {
                enabled: true,
                stealthLevel: 'maximum',
                enableFingerprinting: true,
                enableHumanBehavior: true,
                enableBotDetectionEvasion: true,
            },
        });
}
async function getContext() {
    const extraArgs = (args.chromeArg ?? []).map(String);
    if (args.proxyServer) {
        extraArgs.push(`--proxy-server=${args.proxyServer}`);
    }
    const devtools = args.experimentalDevtools ?? false;
    let lastError;
    for (let attempt = 0; attempt <= MAX_CONNECT_RETRIES; attempt++) {
        try {
            const browser = await connectBrowser(devtools, extraArgs);
            if (context?.browser !== browser) {
                context = await McpContext.from(browser, logger, {
                    experimentalDevToolsDebugging: devtools,
                    experimentalIncludeAllPages: args.experimentalIncludeAllPages,
                });
            }
            return context;
        }
        catch (err) {
            lastError = err;
            logger('Browser connection attempt %d/%d failed: %s', attempt + 1, MAX_CONNECT_RETRIES + 1, err);
            if (attempt < MAX_CONNECT_RETRIES) {
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            }
        }
    }
    throw lastError;
}
const logDisclaimers = () => {
    console.error(`chrome-devtools-mcp exposes content of the browser instance to the MCP clients allowing them to inspect,
debug, and modify any data in the browser or DevTools.
Avoid sharing sensitive or personal information that you do not want to share with MCP clients.`);
};
const toolMutex = new Mutex();
function registerTool(tool) {
    if (tool.annotations.category === ToolCategory.EMULATION &&
        args.categoryEmulation === false) {
        return;
    }
    if (tool.annotations.category === ToolCategory.PERFORMANCE &&
        args.categoryPerformance === false) {
        return;
    }
    if (tool.annotations.category === ToolCategory.NETWORK &&
        args.categoryNetwork === false) {
        return;
    }
    server.registerTool(tool.name, {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: tool.annotations,
    }, async (params) => {
        const guard = await toolMutex.acquire();
        try {
            logger(`${tool.name} request: ${JSON.stringify(params, null, '  ')}`);
            const context = await getContext();
            logger(`${tool.name} context: resolved`);
            await context.detectOpenDevToolsWindows();
            const response = new McpResponse();
            await tool.handler({
                params,
            }, response, context);
            const content = await response.handle(tool.name, context);
            return {
                content,
            };
        }
        catch (err) {
            logger(`${tool.name} error:`, err, err?.stack);
            let errorText = err && 'message' in err ? err.message : String(err);
            if ('cause' in err && err.cause) {
                errorText += `\nCause: ${err.cause.message}`;
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: errorText,
                    },
                ],
                isError: true,
            };
        }
        finally {
            guard.dispose();
        }
    });
}
for (const tool of tools) {
    registerTool(tool);
}
await loadIssueDescriptions();
const transport = new StdioServerTransport();
await server.connect(transport);
logger('Chrome DevTools MCP Server connected');
logDisclaimers();
// --- Graceful shutdown -------------------------------------------------------
// A stdio MCP server must release its browser and exit when its client
// disconnects. Otherwise the live CDP connection keeps the event loop alive and
// orphans a headless Chrome — with every page it accumulated — after the
// session ends, leaking gigabytes across a day of sessions. Trigger on parent
// disconnect (stdin EOF) and termination signals.
let shuttingDown = false;
async function gracefulShutdown(reason) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    logger('Shutting down (%s): closing browsers', reason);
    // Backstop: force-exit if a browser close hangs so we never linger.
    const force = setTimeout(() => process.exit(0), 5000);
    force.unref();
    try {
        await closeAllBrowsers();
    }
    catch (err) {
        logger('Error closing browsers during shutdown: %s', err);
    }
    process.exit(0);
}
process.stdin.on('end', () => void gracefulShutdown('stdin end'));
process.stdin.on('close', () => void gracefulShutdown('stdin close'));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => void gracefulShutdown(signal));
}
