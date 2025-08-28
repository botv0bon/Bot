// Test loader for known AMM program ids using the same logic as listen_dex_short.js
require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
const fs = require('fs');
const path = require('path');
const progFile = path.join(process.cwd(), 'scripts', 'known_amm_program_ids.txt');
function loadFromFile() {
  if (!fs.existsSync(progFile)) return [];
  const txt = fs.readFileSync(progFile, 'utf8');
  const lines = txt.split(/\r?\n/).map(l=>l.trim());
  const progs = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#')) continue;
    const noInline = line.split('#')[0].trim();
    const cleaned = noInline.replace(/,.*/,'').trim().toLowerCase();
    if (!cleaned) continue;
    if (!/^[a-z0-9]{32,44}$/.test(cleaned)) continue;
    progs.push(cleaned);
  }
  return Array.from(new Set(progs));
}

function loadFromEnv() {
  const env = process.env.KNOWN_AMM_PROGRAM_IDS || '';
  return env.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
}

console.log('Loaded from file:', loadFromFile());
console.log('Loaded from env :', loadFromEnv());
console.log('File count:', loadFromFile().length);
console.log('Env count :', loadFromEnv().length);
