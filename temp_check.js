const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');

async function test() {
    const pastaAuth = path.join(__dirname, 'auth_sniper_1');
    const { state } = await useMultiFileAuthState(pastaAuth);
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        syncFullHistory: false
    });

    sock.ev.on('connection.update', async ({ connection }) => {
        if (connection === 'open') {
            const all = await sock.groupFetchAllParticipating();
            const blackGroups = Object.values(all).filter(g => /black|vital[ií]cia/i.test(g.subject));

            for (const g of blackGroups) {
                for (const p of (g.participants || [])) {
                    if (JSON.stringify(p).includes('46751541117170')) {
                        console.log('ENCONTRADO:', g.subject, p);
                    }
                }
            }
            process.exit(0);
        }
    });
}
test().catch(e => { console.error(e); process.exit(1); });
