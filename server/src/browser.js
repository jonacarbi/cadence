import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

// Reuse installed Chrome in headless mode when the matching Playwright browser isn't present.
export function browserExecutable() {
  return [process.env.CADENCE_CHROMIUM_EXECUTABLE, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
}
export function launchBrowser() {
  const executablePath=browserExecutable();
  return chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
}
