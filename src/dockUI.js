// Planet Forge — Floating Glassmorphic UI Dock
// Handles dragging, proximity edge snapping (top, bottom, left, right),
// orientation switching (horizontal vs vertical), and full-screen controls.

export function setupFullscreen(btn) {
  if (!btn) return;

  const EXPAND_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>';
  const COMPRESS_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"/></svg>';

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
  }

  function updateIcon() {
    const fs = isFullscreen();
    btn.setAttribute('aria-pressed', String(fs));
    btn.title = fs ? 'Exit full screen (Esc)' : 'Enter full screen (F)';
    btn.innerHTML = fs ? COMPRESS_SVG : EXPAND_SVG;
  }

  btn.addEventListener('click', () => {
    try {
      if (isFullscreen()) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
      } else {
        const rootEl = document.documentElement;
        if (rootEl.requestFullscreen) rootEl.requestFullscreen();
        else if (rootEl.webkitRequestFullscreen) rootEl.webkitRequestFullscreen();
        else if (rootEl.mozRequestFullScreen) rootEl.mozRequestFullScreen();
        else if (rootEl.msRequestFullscreen) rootEl.msRequestFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen request failed:', err);
    }
  });

  document.addEventListener('fullscreenchange', updateIcon);
  document.addEventListener('webkitfullscreenchange', updateIcon);
  document.addEventListener('mozfullscreenchange', updateIcon);
  document.addEventListener('MSFullscreenChange', updateIcon);

  // Shortcut key 'f' / 'F' toggles fullscreen when not typing in an input
  window.addEventListener('keydown', e => {
    if (e.key === 'f' || e.key === 'F') {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      btn.click();
    }
  });

  updateIcon();
}

export function initDockUI() {
  const panel = document.querySelector('.panel');
  if (!panel) return;

  const app = document.querySelector('#app') || document.body;
  const grip = panel.querySelector('.panel-dock-bar') || panel;
  const orientBtn = document.querySelector('#dock-orient-btn');
  const fullscreenBtn = document.querySelector('#fullscreen-btn');

  // Snapping proximity threshold in pixels from edge
  const SNAP_THRESHOLD = 54;
  const SCREEN_PADDING = 12;

  let state = {
    mode: 'bottom', // 'bottom' | 'top' | 'left' | 'right' | 'floating'
    orientation: 'horizontal', // 'horizontal' | 'vertical'
    x: 0,
    y: 0
  };

  try {
    const raw = localStorage.getItem('pf_ui_dock');
    if (raw) {
      const saved = JSON.parse(raw);
      if (['bottom', 'top', 'left', 'right', 'floating'].includes(saved.mode)) state.mode = saved.mode;
      if (['horizontal', 'vertical'].includes(saved.orientation)) state.orientation = saved.orientation;
      if (Number.isFinite(saved.x)) state.x = saved.x;
      if (Number.isFinite(saved.y)) state.y = saved.y;
    }
  } catch {}

  function saveState() {
    try {
      localStorage.setItem('pf_ui_dock', JSON.stringify(state));
    } catch {}
  }

  function applyDockState() {
    panel.classList.remove(
      'panel--dock-bottom', 'panel--dock-top', 'panel--dock-left', 'panel--dock-right', 'panel--floating',
      'panel--horizontal', 'panel--vertical',
      'panel--snap-preview-bottom', 'panel--snap-preview-top', 'panel--snap-preview-left', 'panel--snap-preview-right'
    );
    app.removeAttribute('data-snap-preview');

    if (state.mode === 'floating') {
      panel.classList.add('panel--floating');
    } else {
      panel.classList.add(`panel--dock-${state.mode}`);
    }
    panel.classList.add(`panel--${state.orientation}`);
    app.setAttribute('data-dock-mode', state.mode);

    if (orientBtn) {
      orientBtn.setAttribute('aria-label', `Layout: ${state.orientation}. Click to toggle orientation.`);
      orientBtn.title = `Layout: ${state.orientation}. Click to toggle orientation.`;
    }

    if (state.mode === 'floating') {
      const w = panel.offsetWidth || 340;
      const h = panel.offsetHeight || 116;
      const maxX = Math.max(SCREEN_PADDING, window.innerWidth - w - SCREEN_PADDING);
      const maxY = Math.max(SCREEN_PADDING, window.innerHeight - h - SCREEN_PADDING);
      state.x = Math.max(SCREEN_PADDING, Math.min(maxX, state.x));
      state.y = Math.max(SCREEN_PADDING, Math.min(maxY, state.y));

      panel.style.left = `${state.x}px`;
      panel.style.top = `${state.y}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
    } else {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '';
      panel.style.bottom = '';
      panel.style.transform = '';
    }
    saveState();
  }

  let isDragging = false;
  let offsetX = 0, offsetY = 0;
  let currentSnap = null;

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Interactive targets do not trigger drag
    if (e.target.closest('input, select, button, a, [role=tab], .atlas-stream, .seedbox')) return;

    isDragging = true;
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    panel.setPointerCapture?.(e.pointerId);
    panel.classList.add('panel--dragging');
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!isDragging) return;

    let candX = e.clientX - offsetX;
    let candY = e.clientY - offsetY;

    const panelW = panel.offsetWidth;
    const panelH = panel.offsetHeight;
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    // Soft clamp within screen margins
    candX = Math.max(-panelW + 80, Math.min(winW - 80, candX));
    candY = Math.max(-panelH + 60, Math.min(winH - 60, candY));

    panel.style.left = `${candX}px`;
    panel.style.top = `${candY}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = 'none';

    // Measure proximity using both panel edges and pointer location
    const distLeft = Math.max(0, candX);
    const distTop = Math.max(0, candY);
    const distRight = Math.max(0, winW - (candX + panelW));
    const distBottom = Math.max(0, winH - (candY + panelH));

    const pointerDistLeft = Math.max(0, e.clientX);
    const pointerDistTop = Math.max(0, e.clientY);
    const pointerDistRight = Math.max(0, winW - e.clientX);
    const pointerDistBottom = Math.max(0, winH - e.clientY);

    // Candidates sorted by closest edge
    const candidates = [
      { edge: 'bottom', dist: Math.min(distBottom, pointerDistBottom) },
      { edge: 'top', dist: Math.min(distTop, pointerDistTop) },
      { edge: 'left', dist: Math.min(distLeft, pointerDistLeft) },
      { edge: 'right', dist: Math.min(distRight, pointerDistRight) },
    ];
    candidates.sort((a, b) => a.dist - b.dist);

    if (candidates[0].dist <= SNAP_THRESHOLD) {
      currentSnap = candidates[0].edge;
    } else {
      currentSnap = null;
    }

    panel.classList.toggle('panel--snap-preview-bottom', currentSnap === 'bottom');
    panel.classList.toggle('panel--snap-preview-top', currentSnap === 'top');
    panel.classList.toggle('panel--snap-preview-left', currentSnap === 'left');
    panel.classList.toggle('panel--snap-preview-right', currentSnap === 'right');
    if (currentSnap) app.setAttribute('data-snap-preview', currentSnap);
    else app.removeAttribute('data-snap-preview');
  }

  function onPointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    panel.releasePointerCapture?.(e.pointerId);
    panel.classList.remove('panel--dragging');

    if (currentSnap) {
      state.mode = currentSnap;
      if (currentSnap === 'bottom' || currentSnap === 'top') {
        state.orientation = 'horizontal';
      } else if (currentSnap === 'left' || currentSnap === 'right') {
        state.orientation = 'vertical';
      }
    } else {
      state.mode = 'floating';
      const rect = panel.getBoundingClientRect();
      state.x = rect.left;
      state.y = rect.top;
    }

    currentSnap = null;
    applyDockState();
  }

  grip.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  if (orientBtn) {
    orientBtn.addEventListener('click', e => {
      e.stopPropagation();
      state.orientation = state.orientation === 'horizontal' ? 'vertical' : 'horizontal';
      applyDockState();
    });
  }

  setupFullscreen(fullscreenBtn);

  window.addEventListener('resize', () => {
    if (state.mode === 'floating') {
      applyDockState();
    }
  });

  applyDockState();

  return {
    get state() { return { ...state }; },
    snapTo(mode) {
      if (['bottom', 'top', 'left', 'right', 'floating'].includes(mode)) {
        state.mode = mode;
        if (mode === 'bottom' || mode === 'top') state.orientation = 'horizontal';
        else if (mode === 'left' || mode === 'right') state.orientation = 'vertical';
        applyDockState();
      }
    },
    toggleOrientation() {
      state.orientation = state.orientation === 'horizontal' ? 'vertical' : 'horizontal';
      applyDockState();
    }
  };
}
