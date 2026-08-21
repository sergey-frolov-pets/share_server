(function initPressTooltipsModule(global) {
  const HOLD_MS = 520;
  const SHOW_MS = 2600;

  let tooltipEl = null;
  let hideTimer = null;
  let holdTimer = null;
  let activeBtn = null;

  function isPressable(element) {
    if (!element || !element.closest) return null;
    const node = element.closest([
      'button',
      '[role="button"]',
      'input[type="submit"]',
      'input[type="button"]',
      '.tab',
      '.admin-assets-tab',
      '.admin-toggle-btn',
      '.queue-tool-btn',
      '.link-btn',
    ].join(', '));
    if (!node || node.disabled || node.classList.contains('hidden')) {
      return null;
    }
    return node;
  }

  function getTooltipText(button) {
    const text = button.getAttribute('data-tooltip')
      || button.getAttribute('aria-label')
      || button.getAttribute('title')
      || button.textContent.trim();
    return text.replace(/\s+/g, ' ').trim();
  }

  function ensureTooltipElement() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'press-tooltip';
      tooltipEl.className = 'press-tooltip hidden';
      tooltipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function hideTooltip() {
    clearTimeout(hideTimer);
    hideTimer = null;
    if (tooltipEl) {
      tooltipEl.classList.add('hidden');
    }
  }

  function showTooltip(button, text) {
    if (!text) return;
    const tooltip = ensureTooltipElement();
    tooltip.textContent = text;
    tooltip.classList.remove('hidden');

    const rect = button.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const topY = Math.max(8, rect.top - 8);
    tooltip.style.left = `${Math.min(window.innerWidth - 12, Math.max(12, centerX))}px`;
    tooltip.style.top = `${topY}px`;

    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideTooltip, SHOW_MS);
  }

  function clearHoldTimer() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    activeBtn = null;
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const button = isPressable(event.target);
    if (!button) return;

    const text = getTooltipText(button);
    if (!text) return;

    clearHoldTimer();
    activeBtn = button;
    holdTimer = setTimeout(() => {
      if (activeBtn !== button) return;
      showTooltip(button, text);
      if (typeof navigator.vibrate === 'function') {
        navigator.vibrate(12);
      }
    }, HOLD_MS);
  }

  function onPointerUp() {
    clearHoldTimer();
  }

  function initPressTooltips() {
    if (initPressTooltips.initialized) {
      return;
    }
    initPressTooltips.initialized = true;

    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('pointercancel', onPointerUp, { passive: true });
    document.addEventListener('pointerleave', onPointerUp, { passive: true });
    document.addEventListener('scroll', hideTooltip, { passive: true, capture: true });
    window.addEventListener('blur', hideTooltip);
  }

  global.PressTooltips = {
    init: initPressTooltips,
    hide: hideTooltip,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPressTooltips);
  } else {
    initPressTooltips();
  }
})(window);
