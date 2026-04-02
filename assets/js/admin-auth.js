const supabaseClient = window.supabaseClient;

if (!supabaseClient) {
  console.error('Supabase client is not available for admin auth.');
}

async function getSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function getAccess() {
  const { data, error } = await supabaseClient.rpc('get_my_access');
  if (error) throw error;
  return data || [];
}

async function signIn(email, password) {
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
}

function renderAccessLines(accessRows) {
  return accessRows
    .filter(row => row.group_slug)
    .map(row => `<li><strong>${row.group_name}</strong> — ${row.role}</li>`)
    .join('');
}

async function refreshUi() {
  const loginWrap = document.getElementById('adminLoginWrap');
  const userWrap = document.getElementById('adminUserWrap');
  const statusEl = document.getElementById('adminStatus');
  const linksEl = document.getElementById('adminLinks');
  const accessEl = document.getElementById('adminAccess');

  const session = await getSession();
  if (!session?.user) {
    loginWrap?.classList.remove('hidden');
    userWrap?.classList.add('hidden');
    if (statusEl) statusEl.textContent = 'Not signed in';
    if (linksEl) linksEl.innerHTML = '';
    if (accessEl) accessEl.innerHTML = '';
    return;
  }

  const accessRows = await getAccess();
  const first = accessRows[0] || {};
  const groupLinks = accessRows
    .filter(row => row.group_slug)
    .map(row => `<a class="admin-link" href="./admin.html?group=${encodeURIComponent(row.group_slug)}">${row.group_name}</a>`)
    .join('');

  loginWrap?.classList.add('hidden');
  userWrap?.classList.remove('hidden');

  if (statusEl) {
    statusEl.textContent = `${first.display_name || session.user.email} ${first.is_admin ? '(Admin)' : ''}`.trim();
  }
  if (linksEl) linksEl.innerHTML = groupLinks;
  if (accessEl) accessEl.innerHTML = renderAccessLines(accessRows);
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('adminEmail')?.value?.trim();
  const password = document.getElementById('adminPassword')?.value || '';
  const errorEl = document.getElementById('adminError');

  try {
    if (errorEl) errorEl.textContent = '';
    await signIn(email, password);
    await refreshUi();
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Login failed';
  }
}

async function handleLogout() {
  await signOut();
  await refreshUi();
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!supabaseClient) {
    const errorEl = document.getElementById('adminError');
    if (errorEl) errorEl.textContent = 'Admin auth is unavailable until Supabase loads.';
    return;
  }
  document.getElementById('adminLoginForm')?.addEventListener('submit', handleLoginSubmit);
  document.getElementById('adminLogoutBtn')?.addEventListener('click', handleLogout);

  supabaseClient.auth.onAuthStateChange(async () => {
    await refreshUi();
  });

  await refreshUi();
});
