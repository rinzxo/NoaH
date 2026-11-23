const assert = require('assert');
const fs = require('fs');
const path = require('path');
const autonomyManager = require('../src/autonomyManager');

console.log('Testing Autonomy Manager logic...');

// Test 1: Empty state or formatting
const listInitial = autonomyManager.getAutonomyList();
assert(Array.isArray(listInitial), 'getAutonomyList must return an array');

// Mock socket for resolveDestination
const mockSock = {
    groupFetchAllParticipating: async () => ({
        '120363414687539494@g.us': {
            subject: 'RG3C+ Komisi C SMANDU ( KitaAtur )'
        }
    })
};

(async () => {
    // Test 2: setAutonomy
    const entry = await autonomyManager.setAutonomy('RG3C', 'Mewakili Pak Laksmana membahas video tutorial KitaAtur', mockSock);
    assert(entry, 'Entry must be created');
    assert.strictEqual(entry.jid, '120363414687539494@g.us');
    assert.strictEqual(entry.enabled, true);
    assert(entry.instruction.includes('KitaAtur'));

    // Test 3: getAutonomy & hasAutonomy
    assert.strictEqual(autonomyManager.hasAutonomy('120363414687539494@g.us'), true);
    const fetched = autonomyManager.getAutonomy('120363414687539494@g.us');
    assert.strictEqual(fetched.name, 'RG3C+ Komisi C SMANDU ( KitaAtur )');

    // Test 4: formatAutonomyList
    const formatted = autonomyManager.formatAutonomyList();
    assert(formatted.includes('RG3C+ Komisi C SMANDU'), 'Formatted list must include group name');
    assert(formatted.includes('KitaAtur'), 'Formatted list must include instruction');

    // Test 5: disableAutonomy
    const disabled = await autonomyManager.disableAutonomy('RG3C', mockSock);
    assert(disabled, 'Disabled entry must be returned');
    assert.strictEqual(disabled.enabled, false);
    assert.strictEqual(autonomyManager.hasAutonomy('120363414687539494@g.us'), false);

    // Test 6: re-enable group
    await autonomyManager.setAutonomy('RG3C', 'Mewakili Pak Laksmana membahas video tutorial KitaAtur', mockSock);
    assert.strictEqual(autonomyManager.hasAutonomy('120363414687539494@g.us'), true);

    // Test 7: setAutonomy for private contact phone number
    const contactEntry = await autonomyManager.setAutonomy('081298765432', 'Wakili saya negosiasi project KitaPay dengan klien ini', mockSock);
    assert(contactEntry, 'Contact entry must be created');
    assert.strictEqual(contactEntry.jid, '6281298765432@s.whatsapp.net');
    assert.strictEqual(contactEntry.isGroup, false);
    assert.strictEqual(autonomyManager.hasAutonomy('6281298765432@s.whatsapp.net'), true);
    // Test suffix normalization (:0@s.whatsapp.net)
    assert.strictEqual(autonomyManager.hasAutonomy('6281298765432:0@s.whatsapp.net'), true);

    console.log('✅ All autonomy manager self-checks passed successfully!');
})().catch(err => {
    console.error('❌ Autonomy test failed:', err);
    process.exit(1);
});
