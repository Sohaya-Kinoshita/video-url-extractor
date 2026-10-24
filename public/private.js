document.querySelectorAll('[data-logout]').forEach((button) => {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await window.videoUrlStorage.api('/api/auth', { method: 'DELETE' });
      sessionStorage.removeItem('video-url-extractor:temporary-extraction');
      location.assign('/login.html');
    } catch (error) { button.disabled = false; alert(error.message); }
  });
});
// Back/forward cache must recheck the session after logout in another tab.
window.addEventListener('pageshow', async (event) => {
  if (!event.persisted) return;
  try {
    const data = await window.videoUrlStorage.api('/api/auth');
    if (!data.authenticated) location.replace('/login.html');
  } catch { location.reload(); }
});
