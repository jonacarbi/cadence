import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { findBin } from './config.js';

const win = (...parts) => ['LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)'].map((v) => process.env[v]).filter(Boolean).map((root) => join(root, ...parts));

/** Well-known Chrome / Chromium / Edge locations per OS (all are Chromium, so Playwright can drive any of them). */
export function browserCandidates(platform = process.platform) {
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  if (platform === 'win32') return [...win('Google', 'Chrome', 'Application', 'chrome.exe'), ...win('Chromium', 'Application', 'chrome.exe'), ...win('Microsoft', 'Edge', 'Application', 'msedge.exe')];
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable'].map((n) => findBin(n)).filter(Boolean)
    .concat(['/opt/google/chrome/chrome', '/snap/bin/chromium', '/usr/bin/chromium']);
}

// Use Playwright's own Chromium when installed, else a Chrome/Chromium/Edge already on the machine (headless).
export function browserExecutable() {
  return [process.env.CADENCE_CHROMIUM_EXECUTABLE, chromium.executablePath(), ...browserCandidates()].filter(Boolean).find(existsSync);
}
export function launchBrowser() {
  const executablePath=browserExecutable();
  return chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
}
