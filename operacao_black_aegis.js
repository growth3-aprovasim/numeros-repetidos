// =====================================================================
// 🛡️ MOTOR AEGIS: OPERAÇÃO BLACK VITALÍCIA & DESAFIO BASE FORTE
// Monitoramento unificado dos dois ecossistemas (56 grupos no total)
// 1. Limpeza inicial retroativa (Black primeiro, depois Base Forte)
// 2. Sentinela Catraca em Tempo Real 24/7 (Permitido até 4 grupos por campanha, 5+ = expulsão)
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

process.on('uncaughtException', err => { if (!silenciador([err])) console.error('\n[💀 ERRO NÃO TRATADO]', err?.message || err); });
process.on('unhandledRejection', err => { if (!silenciador([err])) console.error('\n[💀 REJEIÇÃO NÃO TRATADA]', err?.message || err); });

// =====================================================================
// ⚙️ CONFIGURAÇÕES & ARQUIVOS
// =====================================================================
const ARQUIVO_WHITELIST = path.join(__dirname, 'whitelist_aegis.json');
const ARQUIVO_LOG = path.join(__dirname, 'log_operacao_aegis.json');
const QTD_SNIPERS = 4;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function identificarCampanha(subject) {
    if (!subject) return null;
    if (/black|vital[ií]cia/i.test(subject)) return 'BLACK_VITALICIA';
    if (/base\s*forte/i.test(subject)) return 'BASE_FORTE';
    return null;
}

// =====================================================================
// 🔍 FUNÇÕES DE IDENTIDADE E WHITELIST
// =====================================================================
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

function extrairNumeroParticipante(p) {
    if (p.jid && p.jid.includes('@s.whatsapp.net')) return extrairNumeroLimpo(p.jid);
    if (p.id && p.id.includes('@s.whatsapp.net')) return extrairNumeroLimpo(p.id);
    if (p.phoneNumber) return extrairNumeroLimpo(p.phoneNumber);
    return extrairNumeroLimpo(p.id || p.jid || "");
}

function carregarWhitelist() {
    try {
        if (!fs.existsSync(ARQUIVO_WHITELIST)) return [];
        const raw = JSON.parse(fs.readFileSync(ARQUIVO_WHITELIST, 'utf-8'));
        if (Array.isArray(raw)) return raw.map(extrairNumeroLimpo).filter(Boolean);
    } catch (e) { }
    return [];
}

let cacheWhitelist = carregarWhitelist();
setInterval(() => { cacheWhitelist = carregarWhitelist(); }, 15000);

function estaNaWhitelist(numOuJid, frotaSnipers = []) {
    if (!numOuJid) return false;
    const numLimpo = extrairNumeroLimpo(numOuJid);
    const idNorm = normalizarID(numLimpo);

    for (const w of cacheWhitelist) {
        if (w === numLimpo || (idNorm && normalizarID(w) === idNorm)) return true;
        if (numLimpo.length >= 10 && w.length >= 10 && (w.includes(numLimpo) || numLimpo.includes(w))) return true;
    }

    for (const s of frotaSnipers) {
        if (!s || !s.sock?.user) continue;
        const meuNum = extrairNumeroLimpo(s.sock.user.id);
        if (meuNum && (meuNum === numLimpo || normalizarID(meuNum) === idNorm)) return true;
    }

    return false;
}

// =====================================================================
// 🚀 GERENCIADOR DE CONEXÃO MULTI-SNIPER
// =====================================================================
const snipersAtivos = [];
const mapaAdminGrupos = new Map(); // idGrupo -> Set(indicesDosSnipers)
let sentinelaRealtimeAtivo = false;
const feedEventos = [];

function adicionarEventoFeed(tipo, texto) {
    feedEventos.unshift({
        id: Date.now() + Math.random().toString(36).substring(2, 7),
        hora: new Date().toLocaleTimeString('pt-BR'),
        data: new Date().toLocaleDateString('pt-BR'),
        tipo,
        texto
    });
    if (feedEventos.length > 100) feedEventos.pop();
}

function recarregarWhitelist() {
    cacheWhitelist = carregarWhitelist();
    return cacheWhitelist.length;
}

function obterEstadoAegis() {
    return {
        snipers: [1, 2, 3, 4].map(idx => {
            const s = snipersAtivos.find(x => x.indice === idx);
            return {
                indice: idx,
                conectado: !!(s && s.conectado && s.sock?.ws?.isOpen),
                numero: s?.sock?.user?.id ? extrairNumeroLimpo(s.sock.user.id) : null
            };
        }),
        totalGruposBlack: gruposBlackOficiais.size,
        totalGruposBaseForte: gruposBaseForteOficiais.size,
        totalAdminsMapeados: adminsGlobais.size,
        totalWhitelist: cacheWhitelist.length,
        filaKicksTamanho: filaKicksRealtime.length,
        sentinelaAtivo: sentinelaRealtimeAtivo,
        feedEventos: feedEventos.slice(0, 50)
    };
}

// Grupos catalogados por campanha:
const gruposBlackOficiais = new Map();     // idGrupo -> { id, subject, creation }
const gruposBaseForteOficiais = new Map(); // idGrupo -> { id, subject, creation }

// Presença em RAM por campanha:
const presencaBlack = new Map();     // idNorm -> Set(idGrupo)
const presencaBaseForte = new Map(); // idNorm -> Set(idGrupo)

const adminsGlobais = new Set();
const travasRedundancia = new Set();
const mapaLidParaTelefone = new Map(); // lid -> telefone real

function obterSnipersDisponiveis(idGrupo) {
    const indices = mapaAdminGrupos.get(idGrupo);
    if (indices && indices.size > 0) {
        const adminsConectados = snipersAtivos.filter(s =>
            indices.has(s.indice) &&
            s.conectado &&
            s.sock?.ws?.isOpen
        );
        if (adminsConectados.length > 0) return adminsConectados;
    }
    // Fallback: qualquer sniper conectado e pronto com socket aberto
    return snipersAtivos.filter(s => s.conectado && s.sock?.ws?.isOpen);
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
            let resolvido = false;

            sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
                if (connection === 'open') {
                    console.log(`[✅ SNIPER 0${indice}] Conectado e armamento pronto.`);
                    adicionarEventoFeed('SNIPER', `✅ Sniper 0${indice} armado e operacional.`);

                    let sniperObj = snipersAtivos.find(x => x.indice === indice);
                    if (!sniperObj) {
                        sniperObj = { indice, sock, conectado: true };
                        snipersAtivos.push(sniperObj);
                    } else {
                        sniperObj.sock = sock;
                        sniperObj.conectado = true;
                    }

                    if (sentinelaRealtimeAtivo) {
                        vincularListenersRealtime(sniperObj);
                    }

                    if (!resolvido) {
                        resolvido = true;
                        resolve(sniperObj);
                    }
                }
                if (connection === 'close') {
                    const sniperObj = snipersAtivos.find(x => x.indice === indice);
                    if (sniperObj) sniperObj.conectado = false;

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log(`[❌ SNIPER 0${indice}] Deslogado.`);
                        if (!resolvido) {
                            resolvido = true;
                            resolve(null);
                        }
                    } else {
                        console.log(`[⚠️ SNIPER 0${indice}] Conexão fechada temporariamente (Status ${statusCode || 'Drop'}). Reconectando em 3s...`);
                        setTimeout(() => reconectarSniper(indice), 3000);
                    }
                }
            });
        });
    } catch (e) {
        console.error(`[!] Falha no Sniper 0${indice}:`, e.message);
        return null;
    }
}

async function reconectarSniper(indice) {
    await conectarSniper(indice);
}

// =====================================================================
// 🎯 FASE 1: VARREDURA E LIMPEZA INICIAL (BLACK + BASE FORTE)
// =====================================================================
async function executarLimpezaInicial() {
    console.log('\n=================================================================');
    console.log('🛡️  FASE 1: MAPEANDO GRUPOS (BLACK VITALÍCIA & BASE FORTE)...');
    console.log('=================================================================');

    adminsGlobais.clear();
    gruposBlackOficiais.clear();
    gruposBaseForteOficiais.clear();
    mapaAdminGrupos.clear();
    presencaBlack.clear();
    presencaBaseForte.clear();

    // 1. Mapear grupos e autoridades em todos os Snipers
    for (const sniper of snipersAtivos) {
        try {
            const all = await sniper.sock.groupFetchAllParticipating();
            for (const id in all) {
                const g = all[id];
                const campanha = identificarCampanha(g.subject);
                if (!campanha) continue;

                // Catalogar admins e mapear LIDs
                for (const p of (g.participants || [])) {
                    if (p.lid && p.jid) mapaLidParaTelefone.set(extrairNumeroLimpo(p.lid), extrairNumeroLimpo(p.jid));
                    if (p.lid && p.id && p.id.includes('@s.whatsapp.net')) mapaLidParaTelefone.set(extrairNumeroLimpo(p.lid), extrairNumeroLimpo(p.id));
                    if (p.id && p.jid && p.id.includes('@lid')) mapaLidParaTelefone.set(extrairNumeroLimpo(p.id), extrairNumeroLimpo(p.jid));

                    if (p.admin === 'admin' || p.admin === 'superadmin') {
                        const n = extrairNumeroParticipante(p);
                        if (n) {
                            adminsGlobais.add(n);
                            adminsGlobais.add(normalizarID(n));
                        }
                    }
                }

                // Identificar autoridade do Sniper
                const meuNum = extrairNumeroLimpo(sniper.sock.user?.id);
                const eu = g.participants?.find(p => {
                    const pNum = extrairNumeroParticipante(p);
                    return meuNum && pNum && (meuNum === pNum || normalizarID(meuNum) === normalizarID(pNum));
                });

                if (eu && (eu.admin === 'admin' || eu.admin === 'superadmin')) {
                    if (!mapaAdminGrupos.has(id)) mapaAdminGrupos.set(id, new Set());
                    mapaAdminGrupos.get(id).add(sniper.indice);
                }

                // Salva grupo na campanha correspondente
                if (campanha === 'BLACK_VITALICIA') {
                    if (!gruposBlackOficiais.has(id) || gruposBlackOficiais.get(id).participants.length < g.participants.length) {
                        gruposBlackOficiais.set(id, g);
                    }
                } else if (campanha === 'BASE_FORTE') {
                    if (!gruposBaseForteOficiais.has(id) || gruposBaseForteOficiais.get(id).participants.length < g.participants.length) {
                        gruposBaseForteOficiais.set(id, g);
                    }
                }
            }
        } catch (e) {
            console.error(`[!] Erro na varredura do Sniper 0${sniper.indice}:`, e.message);
        }
    }

    const blackFiltrados = Array.from(gruposBlackOficiais.values()).filter(g => g.participants.length > 0);
    const baseForteFiltrados = Array.from(gruposBaseForteOficiais.values());

    console.log(`\n✅ Black Vitalícia: ${blackFiltrados.length} grupos oficiais com leads.`);
    console.log(`✅ Desafio Base Forte: ${baseForteFiltrados.length} grupos oficiais.`);
    console.log(`👑 Total de Administradores protegidos: ${adminsGlobais.size}`);
    console.log(`📋 Total na Whitelist de Imunidade: ${cacheWhitelist.length}`);

    // Helper para auditar e limpar uma campanha específica
    async function auditarELimparCampanha(nomeCampanha, listaGrupos, mapaPresencaRAM) {
        console.log(`\n-------------------------------------------------------------`);
        console.log(`🔍 AUDITANDO: ${nomeCampanha} (${listaGrupos.length} grupos)`);
        console.log(`-------------------------------------------------------------`);

        const mapaAlvos = new Map();

        for (const g of listaGrupos) {
            const info = { id: g.id, subject: g.subject, creation: g.creation || 0 };
            const jaVisto = new Set();

            for (const p of g.participants) {
                let num = extrairNumeroParticipante(p);
                if (mapaLidParaTelefone.has(num)) num = mapaLidParaTelefone.get(num);
                if (!num) continue;
                const idN = normalizarID(num);

                if (jaVisto.has(idN)) continue;
                jaVisto.add(idN);

                if (!mapaPresencaRAM.has(idN)) mapaPresencaRAM.set(idN, new Set());
                mapaPresencaRAM.get(idN).add(g.id);

                const jidOriginal = p.id || p.jid || '';

                if (!mapaAlvos.has(idN)) {
                    mapaAlvos.set(idN, {
                        numero: num,
                        idNorm: idN,
                        jidOriginal: jidOriginal,
                        ehAdmin: false,
                        ehWhitelist: false,
                        grupos: []
                    });
                }

                const reg = mapaAlvos.get(idN);
                if (adminsGlobais.has(num) || adminsGlobais.has(idN) || p.admin === 'admin' || p.admin === 'superadmin') {
                    reg.ehAdmin = true;
                }
                if (estaNaWhitelist(num, snipersAtivos) || estaNaWhitelist(idN, snipersAtivos)) {
                    reg.ehWhitelist = true;
                }

                reg.grupos.push(info);
            }
        }

        const filaRemocoes = [];
        for (const [idN, dados] of mapaAlvos.entries()) {
            if (dados.grupos.length >= 5) {
                if (dados.ehAdmin) {
                    console.log(`👑 [IMUNE - ADMIN] ${dados.numero} está em ${dados.grupos.length} grupos, mas foi preservado por ser Administrador.`);
                    continue;
                }
                if (dados.ehWhitelist) {
                    console.log(`🛡️ [IMUNE - WHITELIST] ${dados.numero} está em ${dados.grupos.length} grupos, mas foi preservado por estar na Whitelist.`);
                    continue;
                }

                dados.grupos.sort((a, b) => {
                    if (a.creation && b.creation && a.creation !== b.creation) return a.creation - b.creation;
                    return a.subject.localeCompare(b.subject, undefined, { numeric: true });
                });

                const manter = dados.grupos[0];
                const remover = dados.grupos.slice(1);

                filaRemocoes.push({
                    numero: dados.numero,
                    idNorm: idN,
                    jidOriginal: dados.jidOriginal,
                    totalGrupos: dados.grupos.length,
                    manter,
                    remover
                });
            }
        }

        const totalKicks = filaRemocoes.reduce((acc, a) => acc + a.remover.length, 0);
        console.log(`📊 [${nomeCampanha}] Leads em 5+ grupos: ${filaRemocoes.length} | Kicks necessários: ${totalKicks}`);

        if (filaRemocoes.length === 0) {
            console.log(`✨ [${nomeCampanha}] Nenhuma duplicata encontrada. Grupo 100% higienizado!`);
            return;
        }

        console.log(`[⚡] Executando remoções de ${nomeCampanha}...`);
        let rotador = 0;
        let sucessos = 0;

        for (let i = 0; i < filaRemocoes.length; i++) {
            const item = filaRemocoes[i];
            console.log(`[${i + 1}/${filaRemocoes.length}] ${item.numero} (${item.totalGrupos} grps) -> Mantido: "${item.manter.subject}"`);

            for (const grp of item.remover) {
                rotador++;
                const snipersDisponiveis = obterSnipersDisponiveis(grp.id);
                if (snipersDisponiveis.length === 0) {
                    console.log(`   ⚠️ [FALHA] Nenhum sniper conectado disponível para remover de "${grp.subject}".`);
                    continue;
                }
                const operador = snipersDisponiveis[rotador % snipersDisponiveis.length];

                const jidsParaTentar = [];
                if (item.jidOriginal && item.jidOriginal.includes('@')) jidsParaTentar.push(item.jidOriginal);
                if (item.numero) {
                    if (item.jidOriginal && item.jidOriginal.includes('@lid')) {
                        if (!jidsParaTentar.includes(`${item.numero}@lid`)) jidsParaTentar.push(`${item.numero}@lid`);
                        if (!jidsParaTentar.includes(`${item.numero}@s.whatsapp.net`)) jidsParaTentar.push(`${item.numero}@s.whatsapp.net`);
                    } else {
                        if (!jidsParaTentar.includes(`${item.numero}@s.whatsapp.net`)) jidsParaTentar.push(`${item.numero}@s.whatsapp.net`);
                        if (!jidsParaTentar.includes(`${item.numero}@lid`)) jidsParaTentar.push(`${item.numero}@lid`);
                    }
                }

                let kickOk = false;
                let erroMsg = '';
                for (const jidAlvo of jidsParaTentar) {
                    try {
                        await operador.sock.groupParticipantsUpdate(grp.id, [jidAlvo], 'remove');
                        sucessos++;
                        console.log(`   🔴 [KICK] Removido de "${grp.subject}" (Sniper 0${operador.indice})`);
                        mapaPresencaRAM.get(item.idNorm)?.delete(grp.id);
                        kickOk = true;
                        break;
                    } catch (err) {
                        erroMsg = err?.message || err;
                    }
                }

                if (!kickOk) {
                    console.log(`   ⚠️ [FALHA] Falha ao remover de "${grp.subject}": ${erroMsg}`);
                }

                // Delay seguro anti-ban de 1.5s a 2.3s
                const delay = Math.floor(Math.random() * 800) + 1500;
                await sleep(delay);
            }
        }
        console.log(`🏁 [${nomeCampanha}] Limpeza concluída: ${sucessos}/${totalKicks} kicks executados.`);
    }

    // 1. Limpa a Black Vitalícia primeiro (como solicitado)
    await auditarELimparCampanha('BLACK VITALÍCIA (FASE 1)', blackFiltrados, presencaBlack);

    // 2. Limpa o Desafio Base Forte em seguida
    await auditarELimparCampanha('DESAFIO BASE FORTE (FASE 2)', baseForteFiltrados, presencaBaseForte);
}

// =====================================================================
// 🛑 FILA SERIALIZADA DE KICKS REALTIME (ANTI-RATE-LIMIT & SUPORTE A LID)
// =====================================================================
const filaKicksRealtime = [];
let processandoFilaRealtime = false;
let rotadorRealtime = 0;

function enfileirarKickRealtime(dados) {
    filaKicksRealtime.push(dados);
    processarFilaKicksRealtime();
}

async function processarFilaKicksRealtime() {
    if (processandoFilaRealtime) return;
    processandoFilaRealtime = true;

    while (filaKicksRealtime.length > 0) {
        const item = filaKicksRealtime[0]; // Mantém na fila até confirmação ou exaustão de retentativas
        item.tentativas = (item.tentativas || 0) + 1;

        const snipersDisponiveis = obterSnipersDisponiveis(item.idGrupo);

        if (snipersDisponiveis.length === 0) {
            if (item.tentativas <= 5) {
                console.log(`[⏳ CATRACA] Snipers reconectando. Aguardando 2.5s para expulsar ${item.numReal} de "${item.nomeGrupo}" (Tentativa ${item.tentativas}/5)...`);
                await sleep(2500);
                continue; // Tenta o mesmo item novamente
            } else {
                console.log(`[!] Erro definitivo: Nenhum Sniper conectado com permissão em "${item.nomeGrupo}" após 5 tentativas.`);
                filaKicksRealtime.shift();
                continue;
            }
        }

        let removido = false;
        let ultimoErro = null;

        for (let s = 0; s < snipersDisponiveis.length; s++) {
            rotadorRealtime++;
            const operador = snipersDisponiveis[rotadorRealtime % snipersDisponiveis.length];

            // Pula operador se socket oscilou
            if (!operador.conectado || !operador.sock?.ws?.isOpen) continue;

            for (const jidAlvo of item.jidsParaTentar) {
                try {
                    await operador.sock.groupParticipantsUpdate(item.idGrupo, [jidAlvo], 'remove');
                    item.mapaPresencaAlvo.get(item.idNorm)?.delete(item.idGrupo);
                    console.log(`⛔ [BARRADO PELA CATRACA] ${item.numReal} expulso de "${item.nomeGrupo}" (${item.tagCampanha}) pelo Sniper 0${operador.indice}.`);
                    adicionarEventoFeed('EXPULSAO', `⛔ ${item.numReal} expulso de "${item.nomeGrupo}" (${item.tagCampanha}) pelo Sniper 0${operador.indice}`);
                    removido = true;
                    break;
                } catch (err) {
                    ultimoErro = err?.message || err;
                }
            }
            if (removido) break;
        }

        if (removido) {
            filaKicksRealtime.shift(); // Concluído com sucesso
        } else {
            const erroStr = String(ultimoErro).toLowerCase();
            const ehErroConexao = erroStr.includes('connection closed') ||
                                  erroStr.includes('websocket') ||
                                  erroStr.includes('timed out') ||
                                  erroStr.includes('closed');

            if (ehErroConexao && item.tentativas <= 5) {
                console.log(`[⏳ CATRACA] Conexão oscilou ao expulsar de "${item.nomeGrupo}". Aguardando 2s para tentar novamente (${item.tentativas}/5)...`);
                await sleep(2000);
                continue; // Repete o mesmo item após aguardar reconexão
            } else {
                console.log(`[!] Erro ao expulsar ${item.numReal} de "${item.nomeGrupo}": ${ultimoErro}`);
                filaKicksRealtime.shift(); // Desiste após esgotar tentativas ou erro permanente
            }
        }

        // Delay tático anti-ban e anti-rate-limit entre kicks
        await sleep(1500 + Math.floor(Math.random() * 800));
    }

    processandoFilaRealtime = false;
}

// =====================================================================
// 🛑 FASE 2: CATRACA SENTINELA 24/7 (BLACK + BASE FORTE)
// =====================================================================
function vincularListenersRealtime(sniper) {
    sniper.sock.ev.on('group-participants.update', async (evento) => {
        if (evento.action !== 'add') return;

        const idGrupo = evento.id;
        let nomeGrupo = idGrupo;
        let campanha = null;

        if (gruposBlackOficiais.has(idGrupo)) {
            campanha = 'BLACK_VITALICIA';
            nomeGrupo = gruposBlackOficiais.get(idGrupo).subject;
        } else if (gruposBaseForteOficiais.has(idGrupo)) {
            campanha = 'BASE_FORTE';
            nomeGrupo = gruposBaseForteOficiais.get(idGrupo).subject;
        } else {
            // Tenta detectar pelo nome em grupos recém-criados
            try {
                const meta = await sniper.sock.groupMetadata(idGrupo);
                nomeGrupo = meta?.subject || idGrupo;
                campanha = identificarCampanha(nomeGrupo);
                if (campanha === 'BLACK_VITALICIA') gruposBlackOficiais.set(idGrupo, meta);
                if (campanha === 'BASE_FORTE') gruposBaseForteOficiais.set(idGrupo, meta);
            } catch (e) { }
        }

        if (!campanha) return; // Ignora outros grupos que não sejam Black ou Base Forte

        const mapaPresencaAlvo = campanha === 'BLACK_VITALICIA' ? presencaBlack : presencaBaseForte;
        const tagCampanha = campanha === 'BLACK_VITALICIA' ? 'BLACK VITALÍCIA' : 'BASE FORTE';

        for (const novato of evento.participants) {
            let idNovatoBruto = typeof novato === 'object' ? (novato.id || novato.jid || '') : String(novato);
            if (!idNovatoBruto) continue;

            let numReal = extrairNumeroLimpo(idNovatoBruto);
            if (idNovatoBruto.includes('@lid') && mapaLidParaTelefone.has(numReal)) {
                numReal = mapaLidParaTelefone.get(numReal);
            }
            const idNorm = normalizarID(numReal);
            if (!numReal || !idNorm) continue;

            // Anti-duplicação se múltiplos snipers ouvirem o mesmo evento
            const hashEntrada = `${idGrupo}-${idNorm}`;
            if (travasRedundancia.has(hashEntrada)) continue;
            travasRedundancia.add(hashEntrada);
            setTimeout(() => travasRedundancia.delete(hashEntrada), 30000);

            // 1. Whitelist Imunidade
            if (estaNaWhitelist(numReal, snipersAtivos) || estaNaWhitelist(idNorm, snipersAtivos)) {
                console.log(`🛡️ [CATRACA - WHITELIST] ${numReal} entrou em "${nomeGrupo}" (Imune por estar na Whitelist).`);
                adicionarEventoFeed('WHITELIST', `🛡️ ${numReal} liberado em "${nomeGrupo}" (Imune por Whitelist)`);
                continue;
            }

            // 2. Administrador Imunidade
            if (adminsGlobais.has(numReal) || adminsGlobais.has(idNorm)) {
                console.log(`👑 [CATRACA - ADMIN] ${numReal} entrou em "${nomeGrupo}" (Imune por ter cargo de Administrador).`);
                adicionarEventoFeed('ADMIN', `👑 ${numReal} liberado em "${nomeGrupo}" (Imune por Cargo Admin)`);
                continue;
            }

            // 3. Atualizar presença na campanha
            if (!mapaPresencaAlvo.has(idNorm)) mapaPresencaAlvo.set(idNorm, new Set());
            const gruposDoLead = mapaPresencaAlvo.get(idNorm);
            gruposDoLead.add(idGrupo);

            console.log(`🚪 [CATRACA] Lead ${numReal} entrou em "${nomeGrupo}" (${tagCampanha}). Presença total: ${gruposDoLead.size}/4 grupos permitidos.`);
            adicionarEventoFeed('ENTRADA', `🚪 Lead ${numReal} entrou em "${nomeGrupo}" (${tagCampanha}) [${gruposDoLead.size}/4 grupos]`);

            // 4. REGRA DE CATRACA: Se estiver em 5 OU MAIS GRUPOS na mesma campanha (máximo tolerado: 4)
            if (gruposDoLead.size >= 5) {
                console.log(`\n🚨 [ALERTA CATRACA - ${tagCampanha}] Lead ${numReal} violou a regra de saturação!`);
                console.log(`   Presente agora em ${gruposDoLead.size} grupos de ${tagCampanha}. Tentou entrar em: "${nomeGrupo}"`);
                adicionarEventoFeed('ALERTA', `🚨 Saturação! Lead ${numReal} atingiu ${gruposDoLead.size}/4 grupos em ${tagCampanha}. Grupo: "${nomeGrupo}"`);

                // Candidatos de JID (respeita @lid original e @s.whatsapp.net)
                const jidsParaTentar = [];
                if (idNovatoBruto && idNovatoBruto.includes('@')) {
                    jidsParaTentar.push(idNovatoBruto);
                }
                if (numReal) {
                    if (idNovatoBruto.includes('@lid')) {
                        if (!jidsParaTentar.includes(`${numReal}@lid`)) jidsParaTentar.push(`${numReal}@lid`);
                        if (!jidsParaTentar.includes(`${numReal}@s.whatsapp.net`)) jidsParaTentar.push(`${numReal}@s.whatsapp.net`);
                    } else {
                        if (!jidsParaTentar.includes(`${numReal}@s.whatsapp.net`)) jidsParaTentar.push(`${numReal}@s.whatsapp.net`);
                        if (!jidsParaTentar.includes(`${numReal}@lid`)) jidsParaTentar.push(`${numReal}@lid`);
                    }
                }

                enfileirarKickRealtime({
                    idGrupo,
                    nomeGrupo,
                    tagCampanha,
                    numReal,
                    idNorm,
                    jidsParaTentar,
                    mapaPresencaAlvo
                });
            }
        }
    });
}

// =====================================================================
// 🚀 INICIALIZADOR DO MOTOR UNIFICADO
// =====================================================================
async function iniciarOperacaoAegisCompleta() {
    console.clear();
    console.log(`
 █████╗ ███████╗ ██████╗ ██╗███████╗    ██████╗ ██╗      █████╗  ██████╗██╗  ██╗
██╔══██╗██╔════╝██╔════╝ ██║██╔════╝    ██╔══██╗██║     ██╔══██╗██╔════╝██║ ██╔╝
███████║█████╗  ██║  ███╗██║███████╗    ██████╦╝██║     ███████║██║     █████╔╝ 
██╔══██║██╔══╝  ██║   ██║██║╚════██║    ██╔══██╗██║     ██╔══██║██║     ██╔═██╗ 
██║  ██║███████╗╚██████╔╝██║███████║    ██████╦╝███████╗██║  ██║╚██████╗██║  ██╗
╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝╚══════╝    ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
    `);
    console.log('🛡️  MOTOR UNIFICADO AEGIS: BLACK VITALÍCIA & DESAFIO BASE FORTE');
    console.log('📌  Alvos: 28 Grupos Black + 28 Grupos Base Forte (56 grupos vigiados)');
    console.log('⚖️  Regra: Limite de tolerância de até 4 Grupos por campanha (5+ grupos = expulsão)');
    console.log('=================================================================\n');

    console.log(`[+] Conectando frota de ${QTD_SNIPERS} Snipers...`);
    for (let i = 1; i <= QTD_SNIPERS; i++) {
        await conectarSniper(i);
    }

    if (snipersAtivos.length === 0) {
        console.error('❌ Nenhum Sniper pôde ser conectado.');
        process.exit(1);
    }

    console.log(`\n✅ ${snipersAtivos.length} Snipers armados e operacionais.`);

    // 1. Executa Limpeza Inicial (Black primeiro, depois Base Forte)
    await executarLimpezaInicial();

    // 2. Transita para o Sentinela Catraca 24/7 nos dois ecossistemas
    console.log('\n=================================================================');
    console.log('🟢 [SENTINELA ATIVO 24/7] VIGIANDO BLACK VITALÍCIA & BASE FORTE!');
    console.log('   • 56 grupos vigiados simultaneamente em tempo real.');
    console.log('   • Qualquer pessoa que atingir 5 ou mais grupos de uma campanha será expulsa na hora.');
    console.log('   • Whitelist e Administradores 100% imunes.');
    console.log('   • Pressione Ctrl+C para encerrar quando desejar.');
    console.log('=================================================================\n');

    sentinelaRealtimeAtivo = true;
    for (const sniper of snipersAtivos) {
        vincularListenersRealtime(sniper);
    }
}

if (require.main === module) {
    iniciarOperacaoAegisCompleta();
}

module.exports = {
    iniciarOperacaoAegisCompleta,
    recarregarWhitelist,
    obterEstadoAegis,
    feedEventos,
    adicionarEventoFeed
};
