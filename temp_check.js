const { default: makeWASocket, useMultiFileAuthState, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

async function test() {
    const pasta = path.join(__dirname, 'auth_test_pairing');
    if (fs.existsSync(pasta)) fs.rmSync(pasta, { recursive: true, force: true });
    fs.mkdirSync(pasta, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(pasta);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'debug' }),
        browser: Browsers.windows('Desktop'),
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        console.log('EVENT connection.update:', Object.keys(update));
        if (update.qr) console.log('QR length:', update.qr.length);
        if (update.connection) console.log('Connection status:', update.connection);
        if (update.lastDisconnect) console.log('LastDisconnect:', update.lastDisconnect?.error);
    });
}
test();
