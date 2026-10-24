const loginForm = document.querySelector('#login-form');
const loginStatus = document.querySelector('#login-status');
const loginButton = document.querySelector('#login-button');
const requested = new URLSearchParams(location.search).get('next') || '/';
let next = '/';
try {
  const target = new URL(requested, location.origin);
  if (target.origin === location.origin && !/^\/login(?:\.html)?\/?$/.test(target.pathname)) next = target.pathname + target.search;
} catch { /* Use the extraction page for malformed destinations. */ }

window.videoUrlStorage.api('/api/auth').then((data) => {
  if (data.authenticated) location.replace(next);
  else if (!data.configured) {
    loginStatus.textContent = '専用ストレージの接続設定中です。設定完了後にログインしてください。';
    loginButton.disabled = true;
  }
}).catch((error) => { loginStatus.textContent = error.message; });

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  loginStatus.classList.remove('error');
  loginStatus.textContent = 'ログインしています…';
  try {
    await window.videoUrlStorage.api('/api/auth', { method: 'POST', body: { password: document.querySelector('#password').value } });
    document.querySelector('#password').value = '';
    location.replace(next);
  } catch (error) {
    loginStatus.textContent = error.message;
    loginStatus.classList.add('error');
  } finally { loginButton.disabled = false; }
});
