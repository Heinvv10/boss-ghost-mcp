#!/usr/bin/env npx tsx
/**
 * Desktop Computer-Use PoC — Vision Grounding via Qwen3-VL
 *
 * Takes a screenshot of the current desktop (or a specific window),
 * sends it to the Qwen3-VL model on the Velocity GPU, and returns
 * identified UI elements with click coordinates.
 *
 * Usage:
 *   npx tsx scripts/poc-desktop-vision.ts                    # Full desktop
 *   npx tsx scripts/poc-desktop-vision.ts --window "Firefox"  # Specific window
 *   npx tsx scripts/poc-desktop-vision.ts --action "click the Save button"
 *   npx tsx scripts/poc-desktop-vision.ts --list-elements     # List all interactable elements
 */

import { execSync } from 'child_process';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

// ── Config ──────────────────────────────────────────────────────────────────

const VLM_API_URL = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_MODEL = process.env.VLM_MODEL || 'QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ';
const MAX_IMAGE_WIDTH = 1280;
const MAX_IMAGE_HEIGHT = 960;

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const windowName = args.find((_, i, a) => a[i - 1] === '--window') || '';
const actionPrompt = args.find((_, i, a) => a[i - 1] === '--action') || '';
const listElements = args.includes('--list-elements');

// ── Screenshot ──────────────────────────────────────────────────────────────

function takeScreenshot(windowTitle?: string): string {
  const tmpPath = join('/tmp', `desktop-vision-${Date.now()}.png`);

  if (windowTitle) {
    // Find window ID by title
    try {
      const winId = execSync(
        `xdotool search --name "${windowTitle}" | head -1`,
        { encoding: 'utf8' },
      ).trim();
      if (!winId) throw new Error(`Window "${windowTitle}" not found`);
      execSync(`import -window ${winId} "${tmpPath}"`, { timeout: 10000 });
      console.log(`Screenshot: captured window "${windowTitle}" (id: ${winId})`);
    } catch (err) {
      console.error(`Failed to capture window "${windowTitle}", falling back to full desktop`);
      execSync(`import -window root "${tmpPath}"`, { timeout: 10000 });
    }
  } else {
    execSync(`import -window root "${tmpPath}"`, { timeout: 10000 });
    console.log('Screenshot: captured full desktop');
  }

  return tmpPath;
}

function resizeAndEncode(imagePath: string): string {
  // Resize to fit within max dimensions while preserving aspect ratio
  const resizedPath = imagePath.replace('.png', '-resized.jpg');
  execSync(
    `convert "${imagePath}" -resize ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}\\> -quality 85 "${resizedPath}"`,
    { timeout: 10000 },
  );

  const buffer = readFileSync(resizedPath);
  const base64 = buffer.toString('base64');

  // Get dimensions for coordinate mapping
  const identify = execSync(`identify -format "%wx%h" "${resizedPath}"`, {
    encoding: 'utf8',
  }).trim();
  const [w, h] = identify.split('x').map(Number);
  console.log(`Image: ${w}x${h}, ${(buffer.length / 1024).toFixed(0)} KB`);

  // Cleanup
  try {
    unlinkSync(imagePath);
    unlinkSync(resizedPath);
  } catch { /* ignore */ }

  return `data:image/jpeg;base64,${base64}`;
}

// ── VLM Calls ───────────────────────────────────────────────────────────────

interface VlmResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

async function callVlm(imageDataUrl: string, prompt: string): Promise<string> {
  const startTime = Date.now();

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
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`VLM error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as VlmResponse;
  const content = data.choices?.[0]?.message?.content ?? '';
  const elapsed = Date.now() - startTime;
  console.log(`VLM response: ${elapsed}ms, ${content.length} chars`);

  // Strip <think> tags if present
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

// ── Prompts ─────────────────────────────────────────────────────────────────

const LIST_ELEMENTS_PROMPT = `You are a UI element detector. Analyze this desktop screenshot and identify ALL interactable UI elements.

For each element, provide:
- type: button | text_field | link | menu_item | tab | checkbox | dropdown | icon | other
- label: the visible text or icon description
- bbox: [x1, y1, x2, y2] as pixel coordinates (top-left and bottom-right corners)
- center: [x, y] the center point to click

Return ONLY a JSON array. Example:
[
  {"type": "button", "label": "Save", "bbox": [100, 200, 180, 230], "center": [140, 215]},
  {"type": "text_field", "label": "Search", "bbox": [300, 50, 600, 80], "center": [450, 65]}
]

Be precise with coordinates. Include toolbar buttons, menu items, tabs, input fields, and any clickable elements.
Return ONLY the JSON array, no other text.`;

const ACTION_PROMPT = (action: string) => `You are a desktop automation assistant. Look at this screenshot and determine where to click to perform this action:

"${action}"

Return a JSON object with:
- element: description of the UI element to interact with
- action: "click" | "double_click" | "right_click" | "type"
- coordinates: [x, y] — the exact pixel coordinates to click
- confidence: 0-1 how confident you are this is correct
- reasoning: brief explanation of why this element

Return ONLY the JSON object, no other text.`;

const DESCRIBE_PROMPT = `Describe what you see on this desktop screenshot. Include:
1. What application(s) are visible
2. What the user appears to be working on
3. Key UI elements and their approximate locations (top-left, center, bottom-right, etc.)
4. Any notable content visible on screen

Be concise but thorough.`;

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Desktop Vision PoC ===');
  console.log(`Model: ${VLM_MODEL}`);
  console.log(`Endpoint: ${VLM_API_URL}`);
  console.log('');

  // 1. Take screenshot
  const screenshotPath = takeScreenshot(windowName || undefined);
  const imageDataUrl = resizeAndEncode(screenshotPath);

  // 2. Choose prompt based on mode
  let prompt: string;
  let mode: string;

  if (listElements) {
    prompt = LIST_ELEMENTS_PROMPT;
    mode = 'list-elements';
  } else if (actionPrompt) {
    prompt = ACTION_PROMPT(actionPrompt);
    mode = 'action';
  } else {
    prompt = DESCRIBE_PROMPT;
    mode = 'describe';
  }

  console.log(`Mode: ${mode}`);
  console.log('');

  // 3. Call VLM
  const result = await callVlm(imageDataUrl, prompt);

  // 4. Output
  console.log('─'.repeat(60));

  if (mode === 'list-elements' || mode === 'action') {
    try {
      // Try to parse as JSON for structured output
      const jsonMatch = result.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(JSON.stringify(parsed, null, 2));

        // Summary
        if (Array.isArray(parsed)) {
          console.log(`\nFound ${parsed.length} UI elements`);
          const types = parsed.reduce((acc: Record<string, number>, el: { type: string }) => {
            acc[el.type] = (acc[el.type] || 0) + 1;
            return acc;
          }, {});
          console.log('Types:', Object.entries(types).map(([t, c]) => `${t}: ${c}`).join(', '));
        }
      } else {
        console.log(result);
      }
    } catch {
      console.log(result);
    }
  } else {
    console.log(result);
  }

  console.log('─'.repeat(60));
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
