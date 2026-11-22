const assert = require('assert');
const { parseRelativeTime, addReminder, listReminders, cancelReminder, getDueReminders } = require('../src/reminder');

console.log('Testing reminder parser & logic...');

// Test 1: parseRelativeTime
const in10m = parseRelativeTime('10m');
assert(in10m instanceof Date, '10m should return a Date');
const diffMin = Math.round((in10m.getTime() - Date.now()) / (60 * 1000));
assert.strictEqual(diffMin, 10, 'Diff should be 10 minutes');

const in2h = parseRelativeTime('2 jam');
assert(in2h instanceof Date, '2 jam should return a Date');
const diffHour = Math.round((in2h.getTime() - Date.now()) / (60 * 60 * 1000));
assert.strictEqual(diffHour, 2, 'Diff should be 2 hours');

// Test 2: add and list reminder
const testJid = 'test-owner@s.whatsapp.net';
const item = addReminder('Tes minum air', in10m, testJid);
assert(item.id, 'Item must have an id');
assert.strictEqual(item.text, 'Tes minum air');

const list = listReminders(testJid);
assert(list.some(r => r.id === item.id), 'Reminder must be in the list');

// Test 3: cancel reminder
const cancelled = cancelReminder(item.id, testJid);
assert.strictEqual(cancelled, true, 'Reminder should be successfully cancelled');
const listAfter = listReminders(testJid);
assert(!listAfter.some(r => r.id === item.id), 'Reminder must no longer be in the list');

console.log('✅ All reminder self-checks passed successfully!');
