import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateHumanMousePath, generateTypingDelay, generateActionPause, } from '../../src/ghost-mode.js';
/**
 * Human Behavior Simulation Tests
 * Tests: Mouse movement paths, typing delays, action pauses
 *
 * Expected behavior:
 * - BOSS Ghost MCP: Natural, varied behavior patterns
 * - Chrome DevTools MCP: Instant, linear behavior (baseline)
 */
describe('Human Behavior Simulation', () => {
    it('BOSS Ghost MCP: mouse paths should use Bezier curves (non-linear)', () => {
        // 🟢 WORKING: Generate mouse path between two points
        const path = generateHumanMousePath(0, 0, 100, 100, 20);
        // Should have exactly 21 points (0 to 20 inclusive)
        assert.strictEqual(path.length, 21);
        // First point should be start position
        assert.deepStrictEqual(path[0], { x: 0, y: 0 });
        // Last point should be end position
        assert.deepStrictEqual(path[path.length - 1], { x: 100, y: 100 });
        // Path should not be perfectly linear (Bezier curve should deviate)
        // In a linear path, each step would be exactly (5, 5)
        // Bezier curves will have varying step sizes
        let hasVariation = false;
        const expectedDx = 100 / 20; // 5
        const expectedDy = 100 / 20; // 5
        for (let i = 1; i < path.length; i++) {
            const dx = path[i].x - path[i - 1].x;
            const dy = path[i].y - path[i - 1].y;
            // If step size deviates from linear, path is non-linear
            if (Math.abs(dx - expectedDx) > 1 || Math.abs(dy - expectedDy) > 1) {
                hasVariation = true;
                break;
            }
        }
        assert.strictEqual(hasVariation, true);
    });
    it('BOSS Ghost MCP: typing delays should vary (50-150ms base range)', () => {
        // 🟢 WORKING: Generate multiple typing delays
        const delays = [];
        for (let i = 0; i < 100; i++) {
            delays.push(generateTypingDelay());
        }
        // All delays should be >= 50ms (minimum base delay)
        const allAboveMin = delays.every(d => d >= 50);
        assert.strictEqual(allAboveMin, true);
        // Most delays should be in base range (50-150ms)
        // Some should be longer (thinking pauses)
        const baseRangeDelays = delays.filter(d => d >= 50 && d <= 150);
        const thinkingPauses = delays.filter(d => d > 150);
        // Expect around 90% in base range, 10% thinking pauses
        assert.ok(baseRangeDelays.length > 70);
        assert.ok(thinkingPauses.length > 0);
        // Delays should vary (not all identical)
        const uniqueDelays = new Set(delays);
        assert.ok(uniqueDelays.size > 10);
    });
    it('BOSS Ghost MCP: action pauses should be random (500-2000ms)', () => {
        // 🟢 WORKING: Generate multiple action pauses
        const pauses = [];
        for (let i = 0; i < 100; i++) {
            pauses.push(generateActionPause());
        }
        // All pauses should be in valid range
        const allInRange = pauses.every(p => p >= 500 && p <= 2000);
        assert.strictEqual(allInRange, true);
        // Pauses should vary (not all identical)
        const uniquePauses = new Set(pauses);
        assert.ok(uniquePauses.size > 20);
        // Distribution should be reasonable (not all at extremes)
        const average = pauses.reduce((a, b) => a + b, 0) / pauses.length;
        assert.ok(average > 1000); // Should be around 1250ms
        assert.ok(average < 1500);
    });
    it('BOSS Ghost MCP: mouse paths with different parameters vary', () => {
        // 🟢 WORKING: Generate multiple paths between same points
        const paths = [];
        for (let i = 0; i < 5; i++) {
            paths.push(generateHumanMousePath(0, 0, 200, 200, 20));
        }
        // All paths should have same start and end
        for (const path of paths) {
            assert.deepStrictEqual(path[0], { x: 0, y: 0 });
            assert.deepStrictEqual(path[path.length - 1], { x: 200, y: 200 });
        }
        // Paths should differ in their trajectories (different control points)
        // Compare paths pairwise
        let hasDifference = false;
        for (let i = 0; i < paths.length - 1; i++) {
            for (let j = i + 1; j < paths.length; j++) {
                // Check middle point (index 10)
                const midPoint1 = paths[i][10];
                const midPoint2 = paths[j][10];
                if (midPoint1.x !== midPoint2.x || midPoint1.y !== midPoint2.y) {
                    hasDifference = true;
                    break;
                }
            }
            if (hasDifference)
                break;
        }
        assert.strictEqual(hasDifference, true);
    });
    it('BOSS Ghost MCP: mouse path respects start/end positions', () => {
        // 🟢 WORKING: Test various start/end coordinates
        const testCases = [
            { start: { x: 10, y: 20 }, end: { x: 500, y: 600 } },
            { start: { x: 100, y: 100 }, end: { x: 50, y: 50 } }, // Backwards
            { start: { x: 0, y: 500 }, end: { x: 800, y: 100 } }, // Diagonal
        ];
        for (const testCase of testCases) {
            const path = generateHumanMousePath(testCase.start.x, testCase.start.y, testCase.end.x, testCase.end.y, 15);
            // First point should match start
            assert.deepStrictEqual(path[0], testCase.start);
            // Last point should match end
            assert.deepStrictEqual(path[path.length - 1], testCase.end);
        }
    });
    it('BOSS Ghost MCP: thinking pauses occur occasionally', () => {
        // 🟢 WORKING: Verify thinking pauses happen ~10% of the time
        const delays = [];
        for (let i = 0; i < 1000; i++) {
            delays.push(generateTypingDelay());
        }
        // Thinking pauses are > 250ms (base 150ms + 200-500ms thinking delay)
        const thinkingPauses = delays.filter(d => d > 250);
        // Should be approximately 10% (100 out of 1000)
        // Allow range of 5-15% due to randomness
        const percentage = (thinkingPauses.length / delays.length) * 100;
        assert.ok(percentage > 5);
        assert.ok(percentage < 15);
    });
});
