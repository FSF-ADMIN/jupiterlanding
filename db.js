// Jupiter data layer — JSON file storage.
//
// This is the single swap point for a real database: keep the exported
// function signatures and replace the internals with Postgres/Supabase/
// Mongo calls. Nothing else in the app touches storage.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = { users: [], visits: {} };

function load() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.users = db.users || [];
    db.visits = db.visits || {};
  } catch {
    db = { users: [], visits: {} };
  }
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

load();

exports.addUser = ({ name, email, company, teamSize, plan }) => {
  const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    Object.assign(existing, { name, company, teamSize, plan, updatedAt: Date.now() });
    save();
    return { user: existing, existing: true };
  }
  const user = {
    id: crypto.randomUUID(),
    name, email, company, teamSize, plan,
    createdAt: Date.now()
  };
  db.users.push(user);
  save();
  return { user, existing: false };
};

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
