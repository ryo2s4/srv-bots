const db = require('./db');

const DEFAULT_USER = () => ({
  totalPages: 0,
  points: 0,
  streak: 0,
  lastReadDate: null,
  inventory: [],
  completedSessions: 0,
});

// ---------------- users ----------------

function getUser(userId) {
  const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  if (!row) return { userId, ...DEFAULT_USER() };
  return {
    userId,
    totalPages: row.total_pages,
    points: row.points,
    streak: row.streak,
    lastReadDate: row.last_read_date,
    inventory: JSON.parse(row.inventory || '[]'),
    completedSessions: row.completed_sessions,
  };
}

function saveUser(user) {
  db.prepare(`
    INSERT INTO users (user_id, total_pages, points, streak, last_read_date, inventory, completed_sessions)
    VALUES (@userId, @totalPages, @points, @streak, @lastReadDate, @inventory, @completedSessions)
    ON CONFLICT(user_id) DO UPDATE SET
      total_pages        = excluded.total_pages,
      points             = excluded.points,
      streak             = excluded.streak,
      last_read_date     = excluded.last_read_date,
      inventory          = excluded.inventory,
      completed_sessions = excluded.completed_sessions
  `).run({
    userId: user.userId,
    totalPages: user.totalPages,
    points: user.points,
    streak: user.streak,
    lastReadDate: user.lastReadDate,
    inventory: JSON.stringify(user.inventory || []),
    completedSessions: user.completedSessions,
  });
}

// ---------------- sessions ----------------

function getSession(guildId) {
  const row = db.prepare('SELECT data FROM sessions WHERE guild_id = ?').get(guildId);
  return row ? JSON.parse(row.data) : null;
}

function setSession(guildId, session) {
  if (!session) {
    db.prepare('DELETE FROM sessions WHERE guild_id = ?').run(guildId);
    return;
  }
  db.prepare(`
    INSERT INTO sessions (guild_id, data) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET data = excluded.data
  `).run(guildId, JSON.stringify(session));
}

function getAllSessions() {
  return db
    .prepare('SELECT guild_id, data FROM sessions')
    .all()
    .map((r) => ({ guildId: r.guild_id, session: JSON.parse(r.data) }));
}

// ---------------- quizzes ----------------

function getQuiz(guildId) {
  const row = db.prepare('SELECT data FROM quizzes WHERE guild_id = ?').get(guildId);
  return row ? JSON.parse(row.data) : null;
}

function setQuiz(guildId, quiz) {
  if (!quiz) {
    db.prepare('DELETE FROM quizzes WHERE guild_id = ?').run(guildId);
    return;
  }
  db.prepare(`
    INSERT INTO quizzes (guild_id, data) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET data = excluded.data
  `).run(guildId, JSON.stringify(quiz));
}

module.exports = { getUser, saveUser, getSession, setSession, getAllSessions, getQuiz, setQuiz };
