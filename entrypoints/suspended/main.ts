const params = new URLSearchParams(window.location.search);
const targetUrl = params.get('url') || params.get('uri');
const title = params.get('title');
const favicon = params.get('favicon') || params.get('icon');

if (title) {
  document.title = title;
  const titleEl = document.getElementById('tab-title');
  if (titleEl) titleEl.textContent = title;
}

if (favicon) {
  const favEl = document.getElementById('tab-favicon') as HTMLLinkElement | null;
  const iconEl = document.getElementById('tab-icon') as HTMLImageElement | null;
  if (favEl) favEl.href = favicon;
  if (iconEl) iconEl.src = favicon;
}

if (targetUrl) {
  try {
    const host = new URL(targetUrl).hostname;
    const urlEl = document.getElementById('tab-url');
    if (urlEl) urlEl.textContent = `${host} · ${targetUrl}`;
  } catch {
    const urlEl = document.getElementById('tab-url');
    if (urlEl) urlEl.textContent = targetUrl;
  }
}

let redirecting = false;
function loadNow() {
  if (redirecting || !targetUrl) return;
  redirecting = true;
  const btn = document.getElementById('load-btn');
  if (btn) btn.textContent = 'Loading…';
  window.location.replace(targetUrl);
}

// User click on page/button immediately wakes up the tab
document.addEventListener('click', loadNow);

// Grace period: do NOT auto-wake during initial window creation layout events
setTimeout(() => {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadNow();
  });
  window.addEventListener('focus', loadNow);
}, 2000);
