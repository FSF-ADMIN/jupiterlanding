// Jupiter data layer — JSON file storage.
//
// This is the single swap point for a real database: keep the exported
// function signatures and replace the internals with Postgres/Supabase/
// Mongo calls. Nothing else in the app touches storage.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = { users: [], visits: {}, demoRequests: [] };

function load() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.users = db.users || [];
    db.visits = db.visits || {};
    db.demoRequests = db.demoRequests || [];
  } catch {
    db = { users: [], visits: {}, demoRequests: [] };
  }
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

load();

exports.addUser = ({ name, email, company, teamSize, plan, source }) => {
  const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    Object.assign(existing, {
      name: name || existing.name,
      company: company || existing.company,
      teamSize: teamSize || existing.teamSize,
      plan: plan || existing.plan,
      updatedAt: Date.now()
    });
    save();
    return { user: existing, existing: true };
  }
  const user = {
    id: crypto.randomUUID(),
    name, email, company: company || '', teamSize: teamSize || '', plan: plan || '',
    source: source || 'form',
    createdAt: Date.now()
  };
  db.users.push(user);
  save();
  return { user, existing: false };
};

exports.getUserById = (id) => db.users.find(u => u.id === id) || null;

exports.addDemoRequest = ({ userId, name, email }) => {
  const recent = db.demoRequests.find(d => d.email === email && Date.now() - d.createdAt < 864e5);
  if (recent) return { request: recent, existing: true };
  const request = { id: crypto.randomUUID(), userId, name, email, createdAt: Date.now() };
  db.demoRequests.push(request);
  save();
  return { request, existing: false };
};

exports.getDemoRequests = () => db.demoRequests;

exports.getUsers = () => db.users;

exports.deleteUser = (id) => {
  const before = db.users.length;
  db.users = db.users.filter(u => u.id !== id);
  save();
  return db.users.length < before;
};

exports.trackVisit = (page) => {
  db.visits[page] = (db.visits[page] || 0) + 1;
  save();
};

exports.getVisits = () => db.visits;
