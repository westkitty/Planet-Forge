import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium'
].filter(Boolean);
const chromePath = chromeCandidates.find(p => fs.existsSync(p));
if (!chromePath) {
  console.error('Chrome binary not found; set CHROME_PATH');
  process.exit(1);
}

const baseUrl = process.argv[2] || process.env.BASE_URL || 'http://localhost:4173/Planet-Forge/';
let serverProcess = null;

// Check if server is running; if not, spin up vite preview
try {
  await fetch(baseUrl, { method: 'HEAD', signal: AbortSignal.timeout(1000) });
} catch {
  console.log('Local server not responding; starting vite preview on 4173...');
  serverProcess = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
    stdio: 'ignore',
    shell: true
  });
  // Wait up to 10s for server to start
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch(baseUrl, { method: 'HEAD', signal: AbortSignal.timeout(500) });
      if (res.ok) break;
    } catch {}
  }
}

const url = baseUrl;
const browser = await chromium.launch({
  executablePath: chromePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.error('Browser error:', msg.text());
  });

  console.log('Navigating to', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__pfStarted, null, { timeout: 30000 });

  console.log('1. Verifying Glassmorphic styling on .panel...');
  const style = await page.evaluate(() => {
    const p = document.querySelector('.panel');
    const comp = window.getComputedStyle(p);
    return {
      backdropFilter: comp.backdropFilter || comp.webkitBackdropFilter,
      background: comp.background,
      borderRadius: comp.borderRadius,
      boxShadow: comp.boxShadow,
      borderTopColor: comp.borderTopColor
    };
  });
  console.log('Style check:', style);
  if (!style.borderRadius || style.borderRadius === '0px') throw new Error('Missing border radius');
  if (!style.boxShadow || style.boxShadow === 'none') throw new Error('Missing box shadow');

  console.log('2. Verifying initial dock state (bottom, horizontal)...');
  const initState = await page.evaluate(() => {
    const p = document.querySelector('.panel');
    return {
      hasDockBottom: p.classList.contains('panel--dock-bottom'),
      hasHorizontal: p.classList.contains('panel--horizontal'),
      dockState: window.__planetForgeDock.state
    };
  });
  console.log('Initial state:', initState);
  if (!initState.hasDockBottom || !initState.hasHorizontal) {
    throw new Error('Initial dock should be bottom and horizontal');
  }

  console.log('3. Testing full-screen button...');
  const fsBtn = await page.locator('#fullscreen-btn');
  if (!(await fsBtn.isVisible())) throw new Error('#fullscreen-btn is not visible');
  const fsTitle = await fsBtn.getAttribute('title');
  console.log('Fullscreen button title:', fsTitle);

  console.log('4. Testing Drag to open screen (Floating mode)...');
  const grip = page.locator('.panel-grip');
  const gripBox = await grip.boundingBox();
  if (!gripBox) throw new Error('Could not find .panel-grip bounding box');

  // Drag from grip to center (x: 400, y: 300)
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(400, 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const floatingState = await page.evaluate(() => {
    const p = document.querySelector('.panel');
    return {
      isFloating: p.classList.contains('panel--floating'),
      mode: window.__planetForgeDock.state.mode,
      rect: p.getBoundingClientRect()
    };
  });
  console.log('Floating state:', floatingState);
  if (!floatingState.isFloating || floatingState.mode !== 'floating') {
    throw new Error('Panel did not transition to floating mode');
  }

  console.log('5. Testing Snap to LEFT edge (should switch to Vertical orientation)...');
  // Drag to left edge (x: 10, y: 300)
  const floatGripBox = await grip.boundingBox();
  await page.mouse.move(floatGripBox.x + floatGripBox.width / 2, floatGripBox.y + floatGripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(20, 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const leftState = await page.evaluate(() => {
    const p = document.querySelector('.panel');
    return {
      hasDockLeft: p.classList.contains('panel--dock-left'),
      hasVertical: p.classList.contains('panel--vertical'),
      mode: window.__planetForgeDock.state.mode,
      orientation: window.__planetForgeDock.state.orientation,
      width: p.offsetWidth,
      height: p.offsetHeight
    };
  });
  console.log('Left snap state:', leftState);
  if (!leftState.hasDockLeft || !leftState.hasVertical || leftState.orientation !== 'vertical') {
    throw new Error('Panel failed to snap left or adjust to vertical orientation');
  }

  console.log('6. Testing Snap to TOP edge (should switch to Horizontal orientation)...');
  const leftGripBox = await grip.boundingBox();
  await page.mouse.move(leftGripBox.x + leftGripBox.width / 2, leftGripBox.y + leftGripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(600, 10, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const topState = await page.evaluate(() => {
    const p = document.querySelector('.panel');
    return {
      hasDockTop: p.classList.contains('panel--dock-top'),
      hasHorizontal: p.classList.contains('panel--horizontal'),
      mode: window.__planetForgeDock.state.mode,
      orientation: window.__planetForgeDock.state.orientation
    };
  });
  console.log('Top snap state:', topState);
  if (!topState.hasDockTop || !topState.hasHorizontal || topState.orientation !== 'horizontal') {
    throw new Error('Panel failed to snap top or adjust to horizontal orientation');
  }

  console.log('7. Testing Snap to RIGHT edge (should switch to Vertical orientation)...');
  const topGripBox = await grip.boundingBox();
  await page.mouse.move(topGripBox.x + topGripBox.width / 2, topGripBox.y + topGripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(1260, 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const rightState = await page.evaluate(() => {
    const p = document.querySelector('.panel');
    return {
      hasDockRight: p.classList.contains('panel--dock-right'),
      hasVertical: p.classList.contains('panel--vertical'),
      mode: window.__planetForgeDock.state.mode,
      orientation: window.__planetForgeDock.state.orientation
    };
  });
  console.log('Right snap state:', rightState);
  if (!rightState.hasDockRight || !rightState.hasVertical || rightState.orientation !== 'vertical') {
    throw new Error('Panel failed to snap right or adjust to vertical orientation');
  }

  console.log('8. Testing Snap to BOTTOM edge (should switch to Horizontal orientation)...');
  const rightGripBox = await grip.boundingBox();
  await page.mouse.move(rightGripBox.x + rightGripBox.width / 2, rightGripBox.y + rightGripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(600, 780, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const bottomState = await page.evaluate(() => {
    const p = document.querySelector('.panel');
    return {
      hasDockBottom: p.classList.contains('panel--dock-bottom'),
      hasHorizontal: p.classList.contains('panel--horizontal'),
      mode: window.__planetForgeDock.state.mode,
      orientation: window.__planetForgeDock.state.orientation
    };
  });
  console.log('Bottom snap state:', bottomState);
  if (!bottomState.hasDockBottom || !bottomState.hasHorizontal || bottomState.orientation !== 'horizontal') {
    throw new Error('Panel failed to snap bottom or adjust to horizontal orientation');
  }

  console.log('9. Testing Orientation Toggle Button...');
  await page.click('#dock-orient-btn');
  await page.waitForTimeout(200);
  const toggledState1 = await page.evaluate(() => window.__planetForgeDock.state.orientation);
  console.log('After toggle 1:', toggledState1);
  if (toggledState1 !== 'vertical') throw new Error('Orientation did not toggle to vertical');

  await page.click('#dock-orient-btn');
  await page.waitForTimeout(200);
  const toggledState2 = await page.evaluate(() => window.__planetForgeDock.state.orientation);
  console.log('After toggle 2:', toggledState2);
  if (toggledState2 !== 'horizontal') throw new Error('Orientation did not toggle back to horizontal');

  console.log('ALL DOCK & FULLSCREEN TESTS PASSED SUCCESSFULLY!');
} finally {
  await browser.close();
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
  }
}
