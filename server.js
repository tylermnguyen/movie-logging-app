const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const PORT = 3000;
const db = new sqlite3.Database('./movies.db');
const OMDB_API_KEY = 'c0cb6379';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: './' }),
    secret: 'replace-this-with-a-long-random-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
  })
);

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function isStrongPassword(password) {
  if (typeof password !== 'string') return false;
  if (password.length < 10) return false;
  return /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      date_watched TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      review TEXT,
      poster_url TEXT,
      omdb_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      poster_url TEXT,
      omdb_id TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
});

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if (!isStrongPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 10 characters and include uppercase, lowercase, number, and special character.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists.' });
        return res.status(500).json({ error: 'Database error.' });
      }
      req.session.user = { id: this.lastID, username };
      res.json({ message: 'Registration successful.', user: req.session.user });
    });
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (!user) return res.status(400).json({ error: 'Invalid username or password.' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ error: 'Invalid username or password.' });
    req.session.user = { id: user.id, username: user.username };
    res.json({ message: 'Login successful.', user: req.session.user });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out successfully.' }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ user: req.session.user });
});

app.get('/api/omdb/search', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing search query.' });
  try {
    const response = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&s=${encodeURIComponent(q)}&type=movie`);
    const data = await response.json();
    res.json(data);
  } catch {
    res.status(500).json({ error: 'OMDb search failed.' });
  }
});

app.get('/api/omdb/title/:imdbId', requireAuth, async (req, res) => {
  try {
    const response = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${encodeURIComponent(req.params.imdbId)}&plot=short`);
    const data = await response.json();
    res.json(data);
  } catch {
    res.status(500).json({ error: 'OMDb lookup failed.' });
  }
});

app.get('/api/stats', requireAuth, (req, res) => {
  db.get(
    `SELECT COUNT(*) AS total_logged, ROUND(AVG(rating), 1) AS average_rating,
     SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS five_star_count FROM movies WHERE user_id = ?`,
    [req.session.user.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error.' });
      db.get('SELECT COUNT(*) AS watchlist_total FROM watchlist WHERE user_id = ?', [req.session.user.id], (watchErr, watchRow) => {
        if (watchErr) return res.status(500).json({ error: 'Database error.' });
        res.json({
          total_logged: row.total_logged || 0,
          average_rating: row.average_rating || 0,
          five_star_count: row.five_star_count || 0,
          watchlist_total: watchRow.watchlist_total || 0
        });
      });
    }
  );
});

app.get('/api/movies', requireAuth, (req, res) => {
  db.all('SELECT * FROM movies WHERE user_id = ? ORDER BY date_watched DESC, id DESC', [req.session.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    res.json(rows);
  });
});

app.get('/api/movies/:id', requireAuth, (req, res) => {
  db.get('SELECT * FROM movies WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (!row) return res.status(404).json({ error: 'Movie not found.' });
    res.json(row);
  });
});

app.post('/api/movies', requireAuth, (req, res) => {
  const { title, date_watched, rating, review, poster_url, omdb_id } = req.body;
  if (!title || !date_watched || !rating) return res.status(400).json({ error: 'Missing required fields.' });
  db.run(
    `INSERT INTO movies (user_id, title, date_watched, rating, review, poster_url, omdb_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.session.user.id, title, date_watched, rating, review || '', poster_url || '', omdb_id || ''],
    function (err) {
      if (err) return res.status(500).json({ error: 'Database error.' });
      res.json({ id: this.lastID, message: 'Movie added successfully.' });
    }
  );
});

app.delete('/api/movies/:id', requireAuth, (req, res) => {
  db.run('DELETE FROM movies WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id], function (err) {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (this.changes === 0) return res.status(404).json({ error: 'Movie not found.' });
    res.json({ message: 'Movie deleted successfully.' });
  });
});

app.get('/api/watchlist', requireAuth, (req, res) => {
  db.all('SELECT * FROM watchlist WHERE user_id = ? ORDER BY added_at DESC, id DESC', [req.session.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    res.json(rows);
  });
});

app.get('/api/watchlist/:id', requireAuth, (req, res) => {
  db.get('SELECT * FROM watchlist WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (!row) return res.status(404).json({ error: 'Watchlist item not found.' });
    res.json(row);
  });
});

app.post('/api/watchlist', requireAuth, (req, res) => {
  const { title, poster_url, omdb_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Movie title is required.' });
  db.run(`INSERT INTO watchlist (user_id, title, poster_url, omdb_id) VALUES (?, ?, ?, ?)`,
    [req.session.user.id, title, poster_url || '', omdb_id || ''],
    function (err) {
      if (err) return res.status(500).json({ error: 'Database error.' });
      res.json({ id: this.lastID, message: 'Movie added to watchlist.' });
    }
  );
});

app.delete('/api/watchlist/:id', requireAuth, (req, res) => {
  db.run('DELETE FROM watchlist WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id], function (err) {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (this.changes === 0) return res.status(404).json({ error: 'Watchlist item not found.' });
    res.json({ message: 'Removed from watchlist.' });
  });
});

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard.html');
  res.redirect('/index.html');
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
