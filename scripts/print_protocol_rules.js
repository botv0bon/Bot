#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const rulesPath = path.join(process.cwd(), 'scripts', 'amm_protocol_rules.json');
if (!fs.existsSync(rulesPath)) { console.error('rules file missing:', rulesPath); process.exit(2); }
const r = JSON.parse(fs.readFileSync(rulesPath,'utf8'));
console.log('Protocol rules version:', r.version, 'generatedAt:', r.generatedAt);
for (const p of (r.protocols || [])) {
  console.log('\n- name:', p.name, '\n  pubkey:', p.pubkey, '\n  type:', p.type, '\n  confidence:', p.detection && p.detection.confidence, '\n  logsKeywords:', (p.detection && p.detection.logsKeywords || []).join(', '), '\n  notes:', p.notes);
}
