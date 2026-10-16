// =====================================================================
// 🚀 EXECUTOR DE LIMPEZA TÁTICA - FASE 1: BLACK VITALÍCIA (ROTEAMENTO INTELIGENTE)
// Dispara as remoções selecionando o Sniper que é ADMIN no grupo específico
// =====================================================================
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const ARQUIVO_CAMPANHAS = path.join(__dirname, 'resultado_campanhas.json');
const ARQUIVO_WHITELIST = path.join(__dirname, 'whitelist_aegis.json');
const ARQUIVO_LOG = path.join(__dirname, 'log_execucao_black.json');
// =====================================================================
// 🤫 SILENCIADOR DE RUÍDOS DE PROTOCOLO SIGNAL/BAILEYS
// =====================================================================
const util = require('util');
const consoleLogOriginal = console.log;
const consoleInfoOriginal = console.info;
const consoleWarnOriginal = console.warn;
const consoleErrorOriginal = console.error;

const termosSilenciados = [
    'Closing session', 'Closing open session', 'SessionEntry',
    'prekey bundle', 'ephemeralKeyPair', 'registrationId', 'Bad MAC',
    'Failed to decrypt message', 'Session error', 'overwriting prekey',
    'no session found to decrypt', 'libsignal', '_chains', 'currentRatchet'
];

const silenciador = (args) => {
    if (!args || args.length === 0) return false;
    try {
        const str = util.format(...args);
        return termosSilenciados.some(t => str.includes(t));
    } catch {
        return false;
    }
};

console.log = function (...args) { if (!silenciador(args)) consoleLogOriginal.apply(console, args); };
console.info = function (...args) { if (!silenciador(args)) consoleInfoOriginal.apply(console, args); };
console.warn = function (...args) { if (!silenciador(args)) consoleWarnOriginal.apply(console, args); };
console.error = function (...args) { if (!silenciador(args)) consoleErrorOriginal.apply(console, args); };

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function extrairNumeroLimpo(jid) {
    if (!jid) return "";
    return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
}

function normalizarID(num) {
    if (!num) return "";
    num = String(num).replace(/\D/g, '');
    if (num.startsWith('55') && (num.length === 12 || num.length === 13)) {
        num = num.substring(2);
    }
    if (num.length === 11 && num[2] === '9') {
        num = num.substring(0, 2) + num.substring(3);
    }
    return num;
}

function carregarWhitelist() {
    try {
        if (!fs.existsSync(ARQUIVO_WHITELIST)) return [];
        const raw = JSON.parse(fs.readFileSync(ARQUIVO_WHITELIST, 'utf-8'));
        if (Array.isArray(raw)) return raw.map(x => String(x).replace(/\D/g, '')).filter(Boolean);
    } catch (e) { }
    return [];
}

async function conectarSniper(indice) {
    const pastaAuth = path.join(__dirname, `auth_sniper_${indice}`);
    if (!fs.existsSync(pastaAuth)) return null;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
        if (!state.creds.registered) return null;

        const { version } = await fetchLatestBaileysVersion();
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false
        });

        sock.ev.on('creds.update', saveCreds);

        return new Promise((resolve) => {
            sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
                if (connection === 'open') {
                    console.log(`[🎯 SNIPER 0${indice}] Conectado e pronto para a operação!`);
                    resolve({ indice, sock });
                }
                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut) resolve(null);
                }
            });
        });
    } catch (e) {
        console.error(`[!] Erro ao conectar Sniper 0${indice}:`, e.message);
        return null;
    }
}

async function executarLimpezaBlack() {
    console.log('\n=================================================================');
    console.log('🚀 INICIANDO PROTOCOLO DE EXPULSÃO - FASE 1: BLACK VITALÍCIA');
    console.log('=================================================================\n');

    if (!fs.existsSync(ARQUIVO_CAMPANHAS)) {
        console.error('❌ Arquivo resultado_campanhas.json não encontrado. Execute a auditoria primeiro.');
        process.exit(1);
    }

    const { fase1_black } = JSON.parse(fs.readFileSync(ARQUIVO_CAMPANHAS, 'utf-8'));
    const whitelist = carregarWhitelist();
    console.log(`📋 Whitelist ativa com ${whitelist.length} números imunes.`);
    console.log(`🎯 Total de Leads para tratar: ${fase1_black.totalAlvos}`);
    console.log(`💣 Total de Kicks programados: ${fase1_black.totalKicks}`);

    // Conectar frota de Snipers
    console.log('\n[+] Armamentando frota de Snipers...');
    const snipersConectados = [];
    for (let i = 1; i <= 4; i++) {
        const s = await conectarSniper(i);
        if (s) snipersConectados.push(s);
    }

    if (snipersConectados.length === 0) {
        console.error('❌ Nenhum Sniper conseguiu conectar. Operação abortada.');
        process.exit(1);
    }
    console.log(`✅ ${snipersConectados.length} Sniper(s) ativos.`);

    // Mapear em quais grupos cada Sniper é ADMIN
    console.log('\n[🔍] Mapeando autoridade de ADMIN de cada Sniper nos grupos...');
    const mapaAdminGrupos = new Map(); // idGrupo -> [ sniperObj, ... ]

    for (const { indice, sock } of snipersConectados) {
        try {
            const all = await sock.groupFetchAllParticipating();
            for (const idGrupo in all) {
                const g = all[idGrupo];
                const eu = g.participants?.find(p => {
                    const meuNum = sock.user?.id ? extrairNumeroLimpo(sock.user.id) : "";
                    const pNum = extrairNumeroLimpo(p.id || p.jid);
                    return meuNum && pNum && (meuNum === pNum || normalizarID(meuNum) === normalizarID(pNum));
                });

                if (eu && (eu.admin === 'admin' || eu.admin === 'superadmin')) {
                    if (!mapaAdminGrupos.has(idGrupo)) mapaAdminGrupos.set(idGrupo, []);
                    mapaAdminGrupos.get(idGrupo).push({ indice, sock });
                }
            }
        } catch (e) {
            console.error(`[!] Erro ao mapear autoridade do Sniper 0${indice}:`, e.message);
        }
    }

    console.log(`📍 Grupos cobertos com pelo menos 1 Sniper Admin: ${mapaAdminGrupos.size}`);

    let kicksExecutados = 0;
    let kicksFalhados = 0;
    const historicoKicks = [];
    let contadorGeral = 0;

    console.log('\n[⚡] Disparando remoções com delay tático de segurança (1.5s a 2.5s)...\n');

    for (let aIdx = 0; aIdx < fase1_black.alvos.length; aIdx++) {
        const alvo = fase1_black.alvos[aIdx];
        const numLimpo = extrairNumeroLimpo(alvo.numero);
        const idNorm = normalizarID(alvo.numero);

        // Checagem de segurança final contra Whitelist
        if (whitelist.some(w => normalizarID(w) === idNorm || extrairNumeroLimpo(w) === numLimpo)) {
            console.log(`[🛡️ PROTEGIDO] ${alvo.numero} está na Whitelist. Pulando.`);
            continue;
        }

        console.log(`\n-------------------------------------------------------------`);
        console.log(`[👤 LEAD #${aIdx + 1}/${fase1_black.alvos.length}] ${alvo.numero}`);
        console.log(`   🟢 MANTIDO EM: "${alvo.grupoManter}"`);

        for (const grupo of alvo.gruposRemover) {
            contadorGeral++;
            const snipersDisponiveis = mapaAdminGrupos.get(grupo.id) || snipersConectados;
            const operador = snipersDisponiveis[contadorGeral % snipersDisponiveis.length];

            const jidsParaTentar = [`${numLimpo}@s.whatsapp.net`];
            if (numLimpo.length >= 14 || !numLimpo.startsWith('55')) {
                jidsParaTentar.unshift(`${numLimpo}@lid`);
            }

            let sucesso = false;
            let msgErro = null;
            let sniperUsado = operador.indice;

            for (const jidAlvo of jidsParaTentar) {
                try {
                    await operador.sock.groupParticipantsUpdate(grupo.id, [jidAlvo], 'remove');
                    sucesso = true;
                    kicksExecutados++;
                    console.log(`   🔴 [KICK SUCESSO] Removido de "${grupo.subject}" (Sniper 0${operador.indice})`);
                    break;
                } catch (err) {
                    msgErro = err?.message || String(err);
                }
            }

            if (!sucesso) {
                console.log(`   ⚠️ [FALHA] Não foi possível remover de "${grupo.subject}": ${msgErro}`);
                kicksFalhados++;
            }

            historicoKicks.push({
                data: new Date().toISOString(),
                numero: alvo.numero,
                grupoId: grupo.id,
                grupoSubject: grupo.subject,
                sniperUtilizado: operador.indice,
                sucesso,
                erro: msgErro
            });

            // Delay anti-ban entre kicks
            const delay = Math.floor(Math.random() * 800) + 1500;
            await sleep(delay);
        }
    }

    console.log('\n=================================================================');
    console.log('🏁 OPERAÇÃO CONCLUÍDA - RESUMO DA FASE 1:');
    console.log(`   • Kicks com Sucesso: ${kicksExecutados}`);
    console.log(`   • Falhas: ${kicksFalhados}`);
    console.log(`   • Total Processado: ${kicksExecutados + kicksFalhados}`);
    console.log('=================================================================\n');

    fs.writeFileSync(ARQUIVO_LOG, JSON.stringify({
        dataTermino: new Date().toISOString(),
        kicksExecutados,
        kicksFalhados,
        historicoKicks
    }, null, 2));

    console.log(`💾 Log completo gravado em "${ARQUIVO_LOG}".`);
    setTimeout(() => process.exit(0), 1500);
}

if (require.main === module) {
    executarLimpezaBlack();
}

module.exports = { executarLimpezaBlack };
