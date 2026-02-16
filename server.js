require('dotenv').config();
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');

app.use(express.json());
app.use(express.static(__dirname));

// Initialize Supabase client when env vars are present
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
let supabase = null;
if (useSupabase) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('Supabase integration enabled');
} else {
  console.log('Supabase not configured — using local JSON storage');
}

async function readJson(file, fallback = []) {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt || '[]');
  } catch (err) {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

// --- HELPERS ---
let supabaseAvailable = useSupabase;

function disableSupabase(reason) {
  supabaseAvailable = false;
  console.warn('Disabling Supabase integration —', reason);
}

async function dbCreateUser(user) {
  if (!supabaseAvailable) return null;
  try {
    const { data, error } = await supabase.from('users').insert([user]).select();
    if (error) throw error;
    return data[0];
  } catch (err) {
    if (/Could not find the table|relation \"public\\.users\" does not exist|row-level security policy/i.test(err.message || '')) {
      // treat missing table or RLS policy errors as Supabase unavailable and fall back
      disableSupabase(err.message);
      return null;
    }
    throw err;
  }
}

async function dbFindUserByUsername(username) {
  if (!supabaseAvailable) return null;
  try {
    const { data, error } = await supabase.from('users').select('*').eq('username', username).limit(1);
    if (error) throw error;
    return data[0] || null;
  } catch (err) {
    if (/Could not find the table|relation \"public\.users\" does not exist|row-level security policy/i.test(err.message || '')) {
      // treat missing table or RLS policy errors as Supabase unavailable and fall back
      disableSupabase(err.message);
      return null;
    }
    throw err;
  }
}

async function dbCreateReport(report) {
  if (!supabaseAvailable) return null;
  try {
    const { data, error } = await supabase.from('reports').insert([report]).select();
    if (error) throw error;
    return data[0];
  } catch (err) {
    if (/Could not find the table|relation \"public\\.reports\" does not exist|row-level security policy/i.test(err.message || '')) {
      // treat missing table or RLS policy errors as Supabase unavailable and fall back
      disableSupabase(err.message);
      return null;
    }
    throw err;
  }
}

async function dbGetReports() {
  if (!supabaseAvailable) return null;
  try {
    const { data, error } = await supabase.from('reports').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  } catch (err) {
    if (/Could not find the table|relation \"public\.reports\" does not exist|row-level security policy/i.test(err.message || '')) {
      // treat missing table or RLS policy errors as Supabase unavailable and fall back
      disableSupabase(err.message);
      return null;
    }
    throw err;
  }
}

// Signup
app.post('/api/signup', async (req, res) => {
  const { fullName, username, email, accountType, password } = req.body;
  if (!fullName || !username || !email || !accountType || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    if (supabaseAvailable) {
      const existing = await dbFindUserByUsername(username);
      if (existing) return res.status(409).json({ error: 'Username already exists' });

      const inserted = await dbCreateUser({ full_name: fullName, username, email, account_type: accountType, password });
      if (inserted) return res.json({ success: true, user: { id: inserted.id, username: inserted.username, accountType: inserted.account_type } });
      // if insert returned null it means supabase became unavailable — continue to fallback
    }

    // fallback: JSON file
    const users = await readJson(USERS_FILE);
    if (users.find(u => u.username === username)) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    const newUser = { id: Date.now(), fullName, username, email, accountType, password };
    users.push(newUser);
    await writeJson(USERS_FILE, users);
    res.json({ success: true, user: { id: newUser.id, username: newUser.username, accountType: newUser.accountType } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password, accountType } = req.body;
  if (!username || !password || !accountType) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (supabaseAvailable) {
      const user = await dbFindUserByUsername(username);
      if (user && user.password === password && user.account_type === accountType) return res.json({ success: true, user: { id: user.id, username: user.username, accountType: user.account_type } });
      // if user is null (supabase became unavailable) we'll fall back below
      if (user && (user.password !== password || user.account_type !== accountType)) return res.status(401).json({ error: 'Invalid credentials' });
    }

    const users = await readJson(USERS_FILE);
    const user = users.find(u => u.username === username && u.password === password && u.accountType === accountType);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ success: true, user: { id: user.id, username: user.username, accountType: user.accountType } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Submit a report
app.post('/api/reports', async (req, res) => {
  const { name, grade, type, description, date } = req.body;
  if (!type || !description || !date) return res.status(400).json({ error: 'Missing required report fields' });

  try {
    if (supabaseAvailable) {
      const inserted = await dbCreateReport({ name: name || 'Anonymous', grade: grade || '', type, description, incident_date: date });
      if (inserted) return res.json({ success: true, report: inserted });
      // inserted null -> supabase disabled during operation -> fallback
    }

    const reports = await readJson(REPORTS_FILE);
    const newReport = { id: Date.now(), name: name || 'Anonymous', grade: grade || '', type, description, date };
    reports.unshift(newReport);
    await writeJson(REPORTS_FILE, reports);
    res.json({ success: true, report: newReport });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Get reports
app.get('/api/reports', async (req, res) => {
  try {
    if (supabaseAvailable) {
      const rows = await dbGetReports();
      if (rows) {
        // map incident_date -> date for frontend compatibility
        const mapped = rows.map(r => ({ id: r.id, name: r.name, grade: r.grade, type: r.type, description: r.description, date: r.incident_date || r.date, created_at: r.created_at }));
        return res.json(mapped);
      }
      // rows null -> supabase disabled -> fallback
    }

    const reports = await readJson(REPORTS_FILE);
    res.json(reports);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Get all users (demo - admin-only UI can call this)
app.get('/api/users', async (req, res) => {
  try {
    if (supabaseAvailable) {
      try {
        const { data, error } = await supabase.from('users').select('id, full_name, username, email, account_type, created_at').order('created_at', { ascending: false });
        if (error) throw error;
        return res.json(data);
      } catch (err) {
        // disable Supabase integration on any error and fall back to JSON storage
        supabaseAvailable = false;
        console.warn('Supabase error while querying users — falling back to JSON storage:', err.message || err);
      }
    }

    const users = await readJson(USERS_FILE);
    // map field names to match Supabase selector used above
    const mapped = users.map(u => ({ id: u.id, full_name: u.fullName || u.full_name || '', username: u.username, email: u.email, account_type: u.accountType || u.account_type || '', created_at: u.created_at || null }));
    res.json(mapped);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

function startServer(port, retries = 5) {
  const server = app.listen(port)
    .on('listening', () => {
      console.log(`SWDSMS backend running at http://localhost:${port}`);
      if (port !== (process.env.PORT || 3000)) console.log(`(bound to fallback port ${port})`);
    })
    .on('error', (err) => {
      if (err.code === 'EADDRINUSE' && retries > 0) {
        console.warn(`Port ${port} in use — trying port ${port + 1} (retries left: ${retries - 1})`);
        setTimeout(() => startServer(port + 1, retries - 1), 200);
        return;
      }
      console.error('Server failed to start:', err);
      process.exit(1);
    });
  return server;
}

startServer(Number(process.env.PORT || PORT));
