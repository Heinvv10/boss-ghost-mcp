#!/usr/bin/env node
// Verifies the session-leak fix: a browser-holding instance must close its
// Chrome and exit when its MCP client disconnects (stdin EOF).
// PASS = node exits AND the Chrome it launched is reaped after stdin closes.
// FAIL = node lingers with Chrome alive (the leak).
import {spawn, execFileSync} from 'node:child_process';
import path from 'node:path';

const SERVER = path.resolve('build/src/index.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Snapshot the set of chrome PIDs on the machine (no shell, no interpolation).
const chromePids = () => {
  const out = execFileSync('ps', ['-eo', 'pid,comm'], {
    encoding: 'utf8',
  });
  const set = new Set();
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (m && /chrome/i.test(m[2])) set.add(m[1]);
  }
  return set;
};
const alive = pid => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
};

const before = chromePids();
const child = spawn('node', [SERVER, '--headless'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
let exited = false;
let exitInfo = null;
child.on('exit', (code, sig) => {
  exited = true;
  exitInfo = {code, sig};
});
child.stderr.on('data', () => {});
child.stdout.on('data', () => {});
const send = obj => child.stdin.write(JSON.stringify(obj) + '\n');

async function main() {
  await sleep(1500);
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {name: 'leak-test', version: '1.0'},
    },
  });
  await sleep(800);
  send({jsonrpc: '2.0', method: 'notifications/initialized'});
  await sleep(500);
  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {name: 'new_page', arguments: {url: 'about:blank'}},
  });

  // wait for our Chrome to appear (new PIDs not present before)
  let ours = [];
  for (let i = 0; i < 50; i++) {
    await sleep(500);
    ours = [...chromePids()].filter(p => !before.has(p));
    if (ours.length > 0) break;
  }
  console.log(`[test] new chrome PIDs launched by server: ${ours.length}`);
  if (ours.length === 0) {
    console.log('INCONCLUSIVE: browser never launched — cannot test the leak');
    child.kill('SIGKILL');
    process.exit(2);
  }

  // THE TEST: close stdin = simulate the MCP client/session disconnecting.
  console.log('[test] closing stdin (simulating session end)...');
  child.stdin.end();

  for (let i = 0; i < 24; i++) {
    await sleep(500);
    if (exited) break;
  }
  await sleep(1000);
  const survivors = ours.filter(alive);

  if (exited && survivors.length === 0) {
    console.log(
      `PASS: node exited (${JSON.stringify(exitInfo)}) and its Chrome was reaped (0 survivors).`,
    );
    process.exit(0);
  }
  console.log(
    `FAIL (leak): nodeExited=${exited}, chromeSurvivors=${survivors.length} (${survivors.join(',')})`,
  );
  try {
    if (!exited) process.kill(child.pid, 'SIGKILL');
    for (const p of survivors) process.kill(Number(p), 'SIGKILL');
  } catch {}
  process.exit(1);
}
main();
