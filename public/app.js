const page = document.body.dataset.page || '';

function escapeHtml(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function stars(rating) { return '★'.repeat(Number(rating)) + '☆'.repeat(5 - Number(rating)); }

async function fetchMe() {
  const res = await fetch('/api/me');
  if (!res.ok) return null;
  return (await res.json()).user;
}

function highlightNav() {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('#mainNavLinks .nav-link').forEach(link => {
    if (link.getAttribute('href') === '/' + current) link.classList.add('active');
  });
}

async function initAuthUi() {
  const user = await fetchMe();
  const logoutBtn = document.getElementById('logoutBtn');
  if (user && logoutBtn) {
    logoutBtn.classList.remove('d-none');
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login.html';
    });
  }
  const welcomeText = document.getElementById('welcomeText');
  if (welcomeText && user) welcomeText.textContent = `Welcome, ${user.username}`;
  const profileUsername = document.getElementById('profileUsername');
  if (profileUsername && user) profileUsername.textContent = user.username;
  return user;
}

function requirePageAuth(user) {
  if (['dashboard','watchlist','movie-detail','profile'].includes(page) && !user) window.location.href = '/login.html';
}

async function searchOmdb(query) {
  const res = await fetch(`/api/omdb/search?q=${encodeURIComponent(query)}`);
  return res.json();
}
async function getOmdbTitle(imdbId) {
  const res = await fetch(`/api/omdb/title/${encodeURIComponent(imdbId)}`);
  return res.json();
}

function renderSearchResults(results, container, mode) {
  if (!results || results.length === 0) {
    container.innerHTML = '<div class="alert alert-light border mb-0">No movies found.</div>';
    return;
  }
  container.innerHTML = results.map(movie => `
    <div class="card result-card p-3">
      <div class="d-flex gap-3 align-items-start">
        ${movie.Poster && movie.Poster !== 'N/A' ? `<img class="poster-thumb" src="${escapeHtml(movie.Poster)}" alt="${escapeHtml(movie.Title)} poster">` : `<div class="poster-thumb"></div>`}
        <div class="flex-grow-1">
          <div class="fw-bold">${escapeHtml(movie.Title)}</div>
          <div class="text-secondary small">${escapeHtml(movie.Year)} · ${escapeHtml(movie.Type || 'movie')}</div>
        </div>
        <div><button class="btn btn-outline-success btn-sm" data-omdb-select="${escapeHtml(movie.imdbID)}" data-omdb-mode="${mode}">${mode === 'watchlist' ? 'Add' : 'Use'}</button></div>
      </div>
    </div>`).join('');
}

async function loadStats() {
  const statsGrid = document.getElementById('statsGrid');
  const profileStats = document.getElementById('profileStats');
  if (!statsGrid && !profileStats) return;
  const res = await fetch('/api/stats');
  if (!res.ok) return;
  const stats = await res.json();
  const html = `
    <div class="col-sm-6 col-xl-3"><div class="metric-card p-3 h-100"><div class="text-secondary small">Movies logged</div><div class="metric-value">${stats.total_logged}</div></div></div>
    <div class="col-sm-6 col-xl-3"><div class="metric-card p-3 h-100"><div class="text-secondary small">Average rating</div><div class="metric-value">${stats.average_rating}</div></div></div>
    <div class="col-sm-6 col-xl-3"><div class="metric-card p-3 h-100"><div class="text-secondary small">Five-star reviews</div><div class="metric-value">${stats.five_star_count}</div></div></div>
    <div class="col-sm-6 col-xl-3"><div class="metric-card p-3 h-100"><div class="text-secondary small">Watchlist total</div><div class="metric-value">${stats.watchlist_total}</div></div></div>`;
  if (statsGrid) statsGrid.innerHTML = html;
  if (profileStats) profileStats.innerHTML = html;
}

async function loadMovies() {
  const movieList = document.getElementById('movieList');
  if (!movieList) return;
  const res = await fetch('/api/movies');
  if (!res.ok) { movieList.innerHTML = '<div class="alert alert-light border mb-0">Unable to load movies.</div>'; return; }
  const movies = await res.json();
  if (movies.length === 0) { movieList.innerHTML = '<div class="alert alert-light border mb-0">No movies logged yet.</div>'; return; }
  movieList.innerHTML = movies.slice(0, 8).map(movie => `
    <div class="card media-card p-3">
      <div class="d-flex gap-3 align-items-start">
        ${movie.poster_url ? `<img class="poster-thumb" src="${escapeHtml(movie.poster_url)}" alt="${escapeHtml(movie.title)} poster">` : `<div class="poster-thumb"></div>`}
        <div class="flex-grow-1">
          <div class="fw-bold">${escapeHtml(movie.title)}</div>
          <div class="text-secondary small">Watched ${escapeHtml(movie.date_watched)} · ${stars(movie.rating)}</div>
          <div class="small mt-2">${escapeHtml(movie.review || 'No review added.')}</div>
        </div>
        <div class="d-flex flex-column gap-2">
          <a class="btn btn-outline-secondary btn-sm" href="/movie.html?type=movie&id=${movie.id}">View</a>
          <button class="btn btn-outline-danger btn-sm" data-delete-id="${movie.id}">Delete</button>
        </div>
      </div>
    </div>`).join('');
  document.querySelectorAll('[data-delete-id]').forEach(button => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this movie?')) return;
      const res = await fetch(`/api/movies/${button.dataset.deleteId}`, { method: 'DELETE' });
      if (res.ok) { loadMovies(); loadStats(); }
    });
  });
}

async function loadWatchlist() {
  const watchlistList = document.getElementById('watchlistList');
  if (!watchlistList) return;
  const res = await fetch('/api/watchlist');
  if (!res.ok) { watchlistList.innerHTML = '<div class="alert alert-light border mb-0">Unable to load watchlist.</div>'; return; }
  const items = await res.json();
  if (items.length === 0) { watchlistList.innerHTML = '<div class="alert alert-light border mb-0">Your watchlist is empty.</div>'; return; }
  watchlistList.innerHTML = items.map(item => `
    <div class="card media-card p-3">
      <div class="d-flex gap-3 align-items-start">
        ${item.poster_url ? `<img class="poster-thumb" src="${escapeHtml(item.poster_url)}" alt="${escapeHtml(item.title)} poster">` : `<div class="poster-thumb"></div>`}
        <div class="flex-grow-1">
          <div class="fw-bold">${escapeHtml(item.title)}</div>
          <div class="text-secondary small">Added ${new Date(item.added_at).toLocaleDateString()}</div>
        </div>
        <div class="d-flex flex-column gap-2">
          <a class="btn btn-outline-secondary btn-sm" href="/movie.html?type=watchlist&id=${item.id}">View</a>
          <button class="btn btn-outline-danger btn-sm" data-watch-delete-id="${item.id}">Remove</button>
        </div>
      </div>
    </div>`).join('');
  document.querySelectorAll('[data-watch-delete-id]').forEach(button => {
    button.addEventListener('click', async () => {
      if (!confirm('Remove this movie from your watchlist?')) return;
      const res = await fetch(`/api/watchlist/${button.dataset.watchDeleteId}`, { method: 'DELETE' });
      if (res.ok) { loadWatchlist(); loadStats(); }
    });
  });
}

function initDashboardForm() {
  const form = document.getElementById('movieForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: document.getElementById('title').value.trim(),
      poster_url: document.getElementById('posterUrl').value.trim(),
      omdb_id: document.getElementById('omdbId').value.trim(),
      date_watched: document.getElementById('dateWatched').value,
      rating: document.getElementById('rating').value,
      review: document.getElementById('review').value.trim()
    };
    const res = await fetch('/api/movies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) { form.reset(); document.getElementById('posterUrl').value=''; document.getElementById('omdbId').value=''; loadMovies(); loadStats(); }
  });
}

function initMovieSearch() {
  const form = document.getElementById('movieSearchForm');
  const input = document.getElementById('movieSearchInput');
  const results = document.getElementById('movieSearchResults');
  if (!form || !input || !results) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    results.innerHTML = '<div class="alert alert-light border mb-0">Searching OMDb...</div>';
    const data = await searchOmdb(query);
    if (data.Response === 'False' || !data.Search) {
      results.innerHTML = `<div class="alert alert-light border mb-0">${escapeHtml(data.Error || 'No movies found.')}</div>`;
      return;
    }
    renderSearchResults(data.Search, results, 'movie');
  });
  results.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-omdb-select]');
    if (!button) return;
    const details = await getOmdbTitle(button.dataset.omdbSelect);
    document.getElementById('title').value = details.Title || '';
    document.getElementById('posterUrl').value = details.Poster && details.Poster !== 'N/A' ? details.Poster : '';
    document.getElementById('omdbId').value = details.imdbID || '';
    document.getElementById('movieForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function initWatchSearch() {
  const form = document.getElementById('watchSearchForm');
  const input = document.getElementById('watchSearchInput');
  const results = document.getElementById('watchSearchResults');
  if (!form || !input || !results) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    results.innerHTML = '<div class="alert alert-light border mb-0">Searching OMDb...</div>';
    const data = await searchOmdb(query);
    if (data.Response === 'False' || !data.Search) {
      results.innerHTML = `<div class="alert alert-light border mb-0">${escapeHtml(data.Error || 'No movies found.')}</div>`;
      return;
    }
    renderSearchResults(data.Search, results, 'watchlist');
  });
  results.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-omdb-select]');
    if (!button) return;
    const details = await getOmdbTitle(button.dataset.omdbSelect);
    const payload = { title: details.Title || '', poster_url: details.Poster && details.Poster !== 'N/A' ? details.Poster : '', omdb_id: details.imdbID || '' };
    const res = await fetch('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) loadWatchlist();
  });
}

async function loadMovieDetail() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type');
  const id = params.get('id');
  if (!type || !id) return;
  const endpoint = type === 'watchlist' ? `/api/watchlist/${id}` : `/api/movies/${id}`;
  const res = await fetch(endpoint);
  if (!res.ok) return;
  const item = await res.json();
  document.getElementById('detailPoster').src = item.poster_url || '';
  document.getElementById('detailTitle').textContent = item.title;
  document.getElementById('detailMeta').textContent = type === 'watchlist'
    ? `Added ${new Date(item.added_at).toLocaleDateString()}`
    : `Watched ${item.date_watched} · ${stars(item.rating)}`;
  document.getElementById('detailReview').textContent = type === 'watchlist' ? 'This movie is on your watchlist.' : (item.review || 'No review added.');
}

function initLogin() {
  const form = document.getElementById('loginForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: document.getElementById('username').value.trim(), password: document.getElementById('password').value }) });
    const data = await res.json();
    const msg = document.getElementById('message');
    if (!res.ok) { msg.textContent = data.error || 'Login failed.'; return; }
    window.location.href = '/dashboard.html';
  });
}

function initRegister() {
  const form = document.getElementById('registerForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: document.getElementById('username').value.trim(), password: document.getElementById('password').value }) });
    const data = await res.json();
    const msg = document.getElementById('message');
    if (!res.ok) { msg.textContent = data.error || 'Registration failed.'; return; }
    window.location.href = '/dashboard.html';
  });
}

(async function init() {
  highlightNav();
  initLogin();
  initRegister();
  const user = await initAuthUi();
  requirePageAuth(user);
  if (page === 'dashboard') { loadStats(); loadMovies(); initDashboardForm(); initMovieSearch(); }
  if (page === 'watchlist') { loadWatchlist(); initWatchSearch(); }
  if (page === 'movie-detail') loadMovieDetail();
  if (page === 'profile') loadStats();
})();
