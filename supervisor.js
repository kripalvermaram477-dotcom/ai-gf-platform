import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.join(__dirname, 'server.log');
const PID_FILE = path.join(__dirname, 'server.pid');

// Save supervisor PID
fs.writeFileSync(PID_FILE, String(process.pid));

console.log(`[SUPERVISOR] Starting Bulletproof AI GF Bot Manager Supervisor (PID: ${process.pid})...`);
console.log(`[SUPERVISOR] Logs will be written to: ${LOG_FILE}`);

let isShuttingDown = false;

function startServer() {
  if (isShuttingDown) return;

  console.log(`[SUPERVISOR] Launching node server.js...`);
  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (data) => {
    process.stdout.write(data);
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  child.on('error', (err) => {
    console.error(`[SUPERVISOR ERROR]: Failed to spawn server:`, err);
    logStream.write(`[SUPERVISOR ERROR] ${err.message}\n`);
  });

  child.on('exit', (code, signal) => {
    logStream.end();
    if (isShuttingDown) {
      console.log(`[SUPERVISOR] Server stopped cleanly.`);
      return;
    }

    console.warn(`[SUPERVISOR WARN] Server process exited (code: ${code}, signal: ${signal}).`);
    console.log(`[SUPERVISOR] Auto-recovering in 2 seconds so the website NEVER stays down...`);

    setTimeout(() => {
      startServer();
    }, 2000);
  });

  // Keep reference
  process.on('SIGINT', () => {
    isShuttingDown = true;
    child.kill('SIGINT');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    isShuttingDown = true;
    child.kill('SIGTERM');
    process.exit(0);
  });
}

startServer();
