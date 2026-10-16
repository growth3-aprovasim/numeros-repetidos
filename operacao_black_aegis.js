// =====================================================================
// 🛡️ MOTOR AEGIS: OPERAÇÃO BLACK VITALÍCIA & DESAFIO BASE FORTE
// Monitoramento unificado dos dois ecossistemas (56 grupos no total)
// 1. Limpeza inicial retroativa (Black primeiro, depois Base Forte)
// 2. Sentinela Catraca em Tempo Real 24/7 (Saturação configurável + Ban Permanente)
// 3. Gestão Centralizada de Administradores / ADMs (QR Code & Pairing Code via Web)
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
const qrcode = require('qrcode');

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
// ⚙️ CONFIGURAÇÕES & ARQUIVOS PERSISTENTES
// =====================================================================
const ARQUIVO_CONFIG = path.join(__dirname, 'config_aegis.json');
const ARQUIVO_WHITELIST = path.join(__dirname, 'whitelist_aegis.json');
const ARQUIVO_BLACKLIST = path.join(__dirname, 'blacklist_aegis.json');
const ARQUIVO_LOG = path.join(__dirname, 'log_operacao_aegis.json');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function carregarConfig() {
    try {
        if (!fs.existsSync(ARQUIVO_CONFIG)) {
            const padrao = {
                limiteGruposPorCampanha: 4,
                quantidadeAdms: 4,
                quantidadeEspioes: 4,
                quantidadeSnipers: 4,
                limiteBanPermanente: 10
            };
            fs.writeFileSync(ARQUIVO_CONFIG, JSON.stringify(padrao, null, 2), 'utf-8');
            return padrao;
        }
        const cfg = JSON.parse(fs.readFileSync(ARQUIVO_CONFIG, 'utf-8'));
        const qtdAdms = Number(cfg.quantidadeAdms || cfg.quantidadeEspioes || cfg.quantidadeSnipers) || 4;
        return {
            limiteGruposPorCampanha: Number(cfg.limiteGruposPorCampanha) || 4,
            quantidadeAdms: qtdAdms,
            quantidadeEspioes: qtdAdms,
            quantidadeSnipers: qtdAdms,
            limiteBanPermanente: Number(cfg.limiteBanPermanente) || 10
        };
    } catch (e) {
        return {
            limiteGruposPorCampanha: 4,
            quantidadeAdms: 4,
            quantidadeEspioes: 4,
            quantidadeSnipers: 4,
            limiteBanPermanente: 10
        };
    }
}

let configAtual = carregarConfig();

function salvarConfig(novaConfig) {
    const atual = carregarConfig();
    const qtdAdms = Number(novaConfig.quantidadeAdms !== undefined ? novaConfig.quantidadeAdms : (novaConfig.quantidadeEspioes !== undefined ? novaConfig.quantidadeEspioes : atual.quantidadeAdms));
    const merged = {
        limiteGruposPorCampanha: Number(novaConfig.limiteGruposPorCampanha !== undefined ? novaConfig.limiteGruposPorCampanha : atual.limiteGruposPorCampanha),
        quantidadeAdms: qtdAdms,
        quantidadeEspioes: qtdAdms,
        quantidadeSnipers: qtdAdms,
        limiteBanPermanente: Number(novaConfig.limiteBanPermanente !== undefined ? novaConfig.limiteBanPermanente : atual.limiteBanPermanente)
    };
    fs.writeFileSync(ARQUIVO_CONFIG, JSON.stringify(merged, null, 2), 'utf-8');
    configAtual = merged;
    adicionarEventoFeed('CONFIG', `⚙️ Configurações salvas: Limite Grupos = ${merged.limiteGruposPorCampanha} | Ban Permanente = >${merged.limiteBanPermanente} links | ADMs Ativos = ${merged.quantidadeAdms}`);
    return merged;
}

function identificarCampanha(subject) {
    if (!subject) return null;
    if (/black|vital[ií]cia/i.test(subject)) return 'BLACK_VITALICIA';
    if (/base\s*forte/i.test(subject)) return 'BASE_FORTE';
    return null;
}

function formatarExibicao(num) {
    if (!num) return '';
    const limpo = String(num).replace(/\D/g, '');
    if (limpo.startsWith('55') && limpo.length === 13) {
        return `+55 (${limpo.substring(2, 4)}) ${limpo.substring(4, 9)}-${limpo.substring(9)}`;
    }
    if (limpo.startsWith('55') && limpo.length === 12) {
        return `+55 (${limpo.substring(2, 4)}) ${limpo.substring(4, 8)}-${limpo.substring(8)}`;
    }
    if (limpo.length >= 11) return `+${limpo}`;
    return limpo;
}

// =====================================================================
// 🔍 FUNÇÕES DE IDENTIDADE E WHITELIST (EQUIPE IMUNE)
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
// ⛔ GESTÃO DE BLACKLIST (BANIDOS PERMANENTES)
// =====================================================================
function carregarBlacklist() {
    try {
        if (!fs.existsSync(ARQUIVO_BLACKLIST)) {
            fs.writeFileSync(ARQUIVO_BLACKLIST, JSON.stringify([], null, 2), 'utf-8');
            return [];
        }
        const raw = JSON.parse(fs.readFileSync(ARQUIVO_BLACKLIST, 'utf-8'));
        if (Array.isArray(raw)) {
            return raw.map(item => {
                if (typeof item === 'object' && item !== null) {
                    const numLimpo = extrairNumeroLimpo(item.numero);
                    return {
                        numero: numLimpo,
                        numeroFormatado: formatarExibicao(numLimpo),
                        motivo: item.motivo || 'Banimento Permanente',
                        dataBanimento: item.dataBanimento || new Date().toISOString(),
                        totalGrupos: item.totalGrupos || null
                    };
                } else {
                    const numLimpo = extrairNumeroLimpo(item);
                    return {
                        numero: numLimpo,
                        numeroFormatado: formatarExibicao(numLimpo),
                        motivo: 'Banimento Permanente',
                        dataBanimento: new Date().toISOString(),
                        totalGrupos: null
                    };
                }
            }).filter(x => Boolean(x.numero));
        }
    } catch (e) {
        console.error('[!] Erro ao carregar blacklist_aegis.json:', e.message);
    }
    return [];
}

let cacheBlacklist = carregarBlacklist();

function salvarBlacklist(lista) {
    const unicos = [];
    const vistos = new Set();
    for (const item of lista) {
        const num = extrairNumeroLimpo(item.numero);
        if (!num || vistos.has(num)) continue;
        vistos.add(num);
        unicos.push({
            numero: num,
            numeroFormatado: formatarExibicao(num),
            motivo: item.motivo || 'Banimento Permanente',
            dataBanimento: item.dataBanimento || new Date().toISOString(),
            totalGrupos: item.totalGrupos || null
        });
    }
    fs.writeFileSync(ARQUIVO_BLACKLIST, JSON.stringify(unicos, null, 2), 'utf-8');
    cacheBlacklist = unicos;
    return unicos;
}

function estaNaBlacklist(numOuJid) {
    if (!numOuJid) return false;
    const numLimpo = extrairNumeroLimpo(numOuJid);
    const idNorm = normalizarID(numLimpo);

    for (const b of cacheBlacklist) {
        const bNum = b.numero;
        if (!bNum) continue;
        if (bNum === numLimpo || (idNorm && normalizarID(bNum) === idNorm)) return true;
        if (numLimpo.length >= 10 && bNum.length >= 10 && (bNum.includes(numLimpo) || numLimpo.includes(bNum))) return true;
    }
    return false;
}

// =====================================================================
// 🚀 GERENCIADOR DE CONEXÃO DOS ADMS (CONTAS DO WHATSAPP)
// =====================================================================
const snipersAtivos = [];
const mapaAdminGrupos = new Map(); // idGrupo -> Set(indicesDosSnipers)
let sentinelaRealtimeAtivo = false;
const feedEventos = [];

// Estado em RAM das contas de ADMs (para QR Code & Pairing Code via site)
const estadoAdms = new Map();
const timersReconexao = new Map();

function agendarReconexao(indice, ms = 2500) {
    cancelarReconexao(indice);
    const t = setTimeout(() => {
        timersReconexao.delete(indice);
        conectarSniper(indice).catch(() => {});
    }, ms);
    timersReconexao.set(indice, t);
}

function cancelarReconexao(indice) {
    if (timersReconexao.has(indice)) {
        clearTimeout(timersReconexao.get(indice));
        timersReconexao.delete(indice);
    }
}

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

function obterStatusAdms() {
    configAtual = carregarConfig();
    const total = configAtual.quantidadeAdms || 4;
    const lista = [];

    for (let i = 1; i <= total; i++) {
        let estado = estadoAdms.get(i);
        const sAtivo = snipersAtivos.find(x => x.indice === i && x.conectado && x.sock?.ws?.isOpen);

        if (sAtivo) {
            const num = extrairNumeroLimpo(sAtivo.sock?.user?.id);
            if (!estado) {
                estado = {
                    indice: i,
                    conectado: true,
                    status: 'conectado',
                    numero: num,
                    qrCodeDataUrl: null,
                    pairingCode: null,
                    erroMsg: null,
                    atualizadoEm: Date.now()
                };
                estadoAdms.set(i, estado);
            } else {
                estado.conectado = true;
                estado.status = 'conectado';
                estado.numero = num;
            }
        } else if (!estado) {
            const pastaAuth = path.join(__dirname, `auth_sniper_${i}`);
            const temCreds = fs.existsSync(path.join(pastaAuth, 'creds.json'));
            estado = {
                indice: i,
                conectado: false,
                status: temCreds ? 'pronto_para_conectar' : 'desconectado',
                numero: null,
                qrCodeDataUrl: null,
                pairingCode: null,
                erroMsg: null,
                atualizadoEm: Date.now()
            };
            estadoAdms.set(i, estado);
        }

        lista.push({
            indice: i,
            conectado: estado.conectado,
            status: estado.status,
            numero: estado.numero,
            numeroFormatado: formatarExibicao(estado.numero),
            qrCodeDataUrl: estado.qrCodeDataUrl,
            pairingCode: estado.pairingCode,
            erroMsg: estado.erroMsg,
            atualizadoEm: estado.atualizadoEm
        });
    }

    return lista;
}

function obterEstadoAegis() {
    configAtual = carregarConfig();
    return {
        snipers: obterStatusAdms(),
        adms: obterStatusAdms(),
        config: configAtual,
        totalGruposBlack: gruposBlackOficiais.size,
        totalGruposBaseForte: gruposBaseForteOficiais.size,
        totalAdminsMapeados: adminsGlobais.size,
        totalWhitelist: cacheWhitelist.length,
        totalBlacklist: cacheBlacklist.length,
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

function obterNomeGrupo(idGrupo) {
    if (gruposBlackOficiais.has(idGrupo)) return gruposBlackOficiais.get(idGrupo).subject;
    if (gruposBaseForteOficiais.has(idGrupo)) return gruposBaseForteOficiais.get(idGrupo).subject;
    return idGrupo;
}

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
    // Fallback: qualquer ADM conectado e pronto com socket aberto
    return snipersAtivos.filter(s => s.conectado && s.sock?.ws?.isOpen);
}

// Conexão autônoma de ADM via pasta existente
async function conectarSniper(indice) {
    indice = Number(indice);
    cancelarReconexao(indice);

    const pastaAuth = path.join(__dirname, `auth_sniper_${indice}`);
    if (!fs.existsSync(pastaAuth)) return null;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
        if (!state.creds.registered) {
            estadoAdms.set(indice, {
                indice,
                conectado: false,
                status: 'desconectado',
                numero: null,
                qrCodeDataUrl: null,
                pairingCode: null,
                erroMsg: null,
                atualizadoEm: Date.now()
            });
            return null;
        }

        const { version } = await fetchLatestBaileysVersion();
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.ubuntu('Chrome'),
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            defaultQueryTimeoutMs: 60_000,
            connectTimeoutMs: 60_000,
            getMessage: async () => ({ conversation: '' })
        });

        sock.ev.on('creds.update', saveCreds);

        return new Promise((resolve) => {
            let resolvido = false;

            sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
                if (connection === 'open') {
                    cancelarReconexao(indice);
                    const num = extrairNumeroLimpo(sock.user?.id);
                    console.log(`[✅ ADM 0${indice}] Conectado e de olho nos grupos (+${num})`);
                    adicionarEventoFeed('ADM', `✅ Administrador 0${indice} operacional (+${formatarExibicao(num)})`);

                    let sniperObj = snipersAtivos.find(x => x.indice === indice);
                    if (!sniperObj) {
                        sniperObj = { indice, sock, conectado: true };
                        snipersAtivos.push(sniperObj);
                    } else {
                        sniperObj.sock = sock;
                        sniperObj.conectado = true;
                    }

                    estadoAdms.set(indice, {
                        indice,
                        conectado: true,
                        status: 'conectado',
                        numero: num,
                        qrCodeDataUrl: null,
                        pairingCode: null,
                        erroMsg: null,
                        atualizadoEm: Date.now()
                    });

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
                    const ehLogout = statusCode === DisconnectReason.loggedOut;
                    const erroMsg = lastDisconnect?.error?.message || '';

                    if (ehLogout) {
                        console.log(`[❌ ADM 0${indice}] Deslogado pelo WhatsApp.`);
                        estadoAdms.set(indice, {
                            indice,
                            conectado: false,
                            status: 'desconectado',
                            numero: null,
                            qrCodeDataUrl: null,
                            pairingCode: null,
                            erroMsg: null,
                            atualizadoEm: Date.now()
                        });
                        try { fs.rmSync(pastaAuth, { recursive: true, force: true }); } catch (e) { }
                        if (!resolvido) { resolvido = true; resolve(null); }
                    } else {
                        console.log(`[⚠️ ADM 0${indice}] Conexão fechada temporariamente (Status ${statusCode || 'Drop'} - ${erroMsg}). Reconectando em 3s...`);
                        agendarReconexao(indice, 3000);
                    }
                }
            });
        });
    } catch (e) {
        console.error(`[!] Falha ao conectar ADM 0${indice}:`, e.message);
        return null;
    }
}

// Conexão manual via site: QR Code OU Pairing Code
async function conectarAdmManual({ indice, tipoConexao, numeroTelefone }) {
    indice = Number(indice);
    if (!indice || indice < 1) throw new Error('Índice de administrador inválido.');

    cancelarReconexao(indice);

    const pastaAuth = path.join(__dirname, `auth_sniper_${indice}`);

    // Fecha socket existente no mesmo slot se houver e remove de snipersAtivos
    const idxExistente = snipersAtivos.findIndex(x => x.indice === indice);
    if (idxExistente !== -1) {
        const sExistente = snipersAtivos[idxExistente];
        try {
            sExistente.sock.ev.removeAllListeners();
            if (sExistente.sock.ws) sExistente.sock.ws.close();
        } catch (e) { }
        snipersAtivos.splice(idxExistente, 1);
    }

    // Como o usuário está solicitando uma NOVA conexão manual (QR ou Código) para este slot,
    // limpamos as credenciais antigas para garantir que o Baileys gere um código/QR totalmente novo.
    if (fs.existsSync(pastaAuth)) {
        try {
            fs.rmSync(pastaAuth, { recursive: true, force: true });
        } catch (e) {
            console.error(`[!] Erro ao limpar auth_sniper_${indice}:`, e.message);
        }
    }
    fs.mkdirSync(pastaAuth, { recursive: true });

    let estado = {
        indice,
        conectado: false,
        status: tipoConexao === 'codigo' ? 'solicitando_codigo' : 'gerando_qr',
        numero: null,
        qrCodeDataUrl: null,
        pairingCode: null,
        erroMsg: null,
        atualizadoEm: Date.now()
    };
    estadoAdms.set(indice, estado);

    const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        defaultQueryTimeoutMs: 60_000,
        connectTimeoutMs: 60_000,
        getMessage: async () => ({ conversation: '' })
    });

    sock.ev.on('creds.update', saveCreds);

    // Se for código de pareamento, solicita o código de 8 dígitos
    if (tipoConexao === 'codigo') {
        setTimeout(async () => {
            try {
                const numLimpo = extrairNumeroLimpo(numeroTelefone);
                if (!numLimpo) throw new Error('Número de telefone não informado.');
                console.log(`[🔢 ADM 0${indice}] Solicitando código de pareamento para ${numLimpo}...`);
                const rawCode = await sock.requestPairingCode(numLimpo);
                const formatado = rawCode ? (rawCode.length === 8 ? `${rawCode.substring(0, 4)}-${rawCode.substring(4)}` : rawCode) : 'ERRO';
                estado.pairingCode = formatado;
                estado.status = 'codigo_pronto';
                estado.atualizadoEm = Date.now();
                console.log(`[🔑 ADM 0${indice}] Código de Pareamento Gerado: ${formatado}`);
                adicionarEventoFeed('ADM', `🔑 ADM 0${indice}: Código gerado (${formatado}) para o número ${formatarExibicao(numLimpo)}`);
            } catch (err) {
                console.error(`[!] Falha no Pairing Code ADM 0${indice}:`, err.message);
                estado.erroMsg = 'Falha ao solicitar código: ' + (err.message || err);
                estado.status = 'erro';
                estado.atualizadoEm = Date.now();
            }
        }, 2000);
    }

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        // 1. QR CODE
        if (qr && tipoConexao === 'qr' && !sock.authState.creds.registered) {
            try {
                const dataUrl = await qrcode.toDataURL(qr, { scale: 7, margin: 2 });
                estado.qrCodeDataUrl = dataUrl;
                estado.status = 'qr_pronto';
                estado.atualizadoEm = Date.now();
                console.log(`[📷 ADM 0${indice}] QR Code gerado para leitura no Painel Web.`);
                adicionarEventoFeed('ADM', `📷 ADM 0${indice}: QR Code gerado. Aponte o WhatsApp para conectar.`);
            } catch (err) {
                estado.erroMsg = 'Falha ao gerar imagem do QR Code: ' + err.message;
                estado.status = 'erro';
            }
        }

        // 2. CONECTADO
        if (connection === 'open') {
            cancelarReconexao(indice);
            const meuNum = extrairNumeroLimpo(sock.user?.id);
            console.log(`[✅ ADM 0${indice}] Conectado com sucesso! (+${meuNum})`);
            adicionarEventoFeed('ADM', `✅ Administrador 0${indice} conectado com sucesso (+${formatarExibicao(meuNum)})`);

            estado.conectado = true;
            estado.status = 'conectado';
            estado.numero = meuNum;
            estado.qrCodeDataUrl = null;
            estado.pairingCode = null;
            estado.erroMsg = null;
            estado.atualizadoEm = Date.now();

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
        }

        // 3. FECHADO (RECONEXÃO AUTOMÁTICA PÓS-PAREAMENTO)
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const ehLogout = statusCode === DisconnectReason.loggedOut;
            const erroMsg = lastDisconnect?.error?.message || '';

            console.log(`[⚠️ ADM 0${indice}] Conexão fechada durante pareamento (Status ${statusCode || 'Drop'}: ${erroMsg})`);

            let sniperObj = snipersAtivos.find(x => x.indice === indice);
            if (sniperObj) sniperObj.conectado = false;

            if (ehLogout) {
                console.log(`[❌ ADM 0${indice}] Deslogado pelo WhatsApp.`);
                estado.conectado = false;
                estado.status = 'desconectado';
                estado.numero = null;
                estado.qrCodeDataUrl = null;
                estado.pairingCode = null;
                estado.atualizadoEm = Date.now();
                try { fs.rmSync(pastaAuth, { recursive: true, force: true }); } catch (e) { }
            } else {
                // Quando o WhatsApp do celular escaneia o QR ou digita o código, ele reinicia o socket (Status 515 restartRequired)
                // É OBRIGATÓRIO reconectar para concluir a autenticação com o celular!
                const temCreds = fs.existsSync(path.join(pastaAuth, 'creds.json'));
                console.log(`[🔄 ADM 0${indice}] Reconectando em 2s para concluir handshake com celular (Creds salvas: ${temCreds})...`);
                setTimeout(() => {
                    if (temCreds) {
                        conectarSniper(indice);
                    } else if (tipoConexao === 'qr') {
                        conectarAdmManual({ indice, tipoConexao: 'qr' }).catch(() => {});
                    }
                }, 2000);
            }
        }
    });

    return estado;
}

// Desconectar e limpar credenciais de um ADM
async function desconectarAdm(indice) {
    indice = Number(indice);
    cancelarReconexao(indice);

    const pastaAuth = path.join(__dirname, `auth_sniper_${indice}`);

    const idx = snipersAtivos.findIndex(x => x.indice === indice);
    if (idx !== -1) {
        const s = snipersAtivos[idx];
        try {
            s.sock.ev.removeAllListeners();
            if (s.sock.logout) await s.sock.logout();
            else if (s.sock.ws) s.sock.ws.close();
        } catch (e) { }
        snipersAtivos.splice(idx, 1);
    }

    if (fs.existsSync(pastaAuth)) {
        try {
            fs.rmSync(pastaAuth, { recursive: true, force: true });
        } catch (e) {
            console.error(`[!] Erro ao limpar auth_sniper_${indice}:`, e.message);
        }
    }

    const estado = {
        indice,
        conectado: false,
        status: 'desconectado',
        numero: null,
        qrCodeDataUrl: null,
        pairingCode: null,
        erroMsg: null,
        atualizadoEm: Date.now()
    };
    estadoAdms.set(indice, estado);

    adicionarEventoFeed('ADM', `🔌 Administrador 0${indice} desconectado e credenciais removidas.`);
    return { sucesso: true, mensagem: `Administrador 0${indice} desconectado com sucesso.` };
}

// =====================================================================
// 💀 BANIMENTO PERMANENTE MANUAL & DESBANIR
// =====================================================================
async function banirPermanente(numeroAlvo, motivo = 'Banimento Permanente Manual', totalGrupos = 0) {
    const numLimpo = extrairNumeroLimpo(numeroAlvo);
    if (!numLimpo) throw new Error('Número de telefone inválido.');

    if (estaNaWhitelist(numLimpo)) {
        throw new Error(`O número ${formatarExibicao(numLimpo)} está na Whitelist da Equipe e não pode ser banido.`);
    }

    const idNorm = normalizarID(numLimpo);

    let lista = carregarBlacklist();
    const jaExiste = lista.find(x => x.numero === numLimpo || (idNorm && normalizarID(x.numero) === idNorm));
    if (!jaExiste) {
        lista.unshift({
            numero: numLimpo,
            numeroFormatado: formatarExibicao(numLimpo),
            motivo: motivo,
            dataBanimento: new Date().toISOString(),
            totalGrupos: totalGrupos || null
        });
        salvarBlacklist(lista);
    }

    adicionarEventoFeed('BAN_PERMANENTE', `⛔ [BAN PERMANENTE] ${formatarExibicao(numLimpo)} banido! Motivo: ${motivo}`);

    // Expulsa de TODOS os grupos catalogados
    const todosGrupos = [
        ...Array.from(gruposBlackOficiais.values()),
        ...Array.from(gruposBaseForteOficiais.values())
    ];

    const jidsParaTentar = [
        `${numLimpo}@s.whatsapp.net`,
        `${numLimpo}@lid`
    ];

    let gruposAfetados = 0;
    for (const g of todosGrupos) {
        const estaPresente = (g.participants || []).some(p => {
            const pNum = extrairNumeroParticipante(p);
            return pNum && (pNum === numLimpo || (idNorm && normalizarID(pNum) === idNorm));
        });

        if (estaPresente) {
            gruposAfetados++;
            enfileirarKickRealtime({
                idGrupo: g.id,
                nomeGrupo: g.subject || g.id,
                tagCampanha: identificarCampanha(g.subject) || 'GRUPO',
                numReal: numLimpo,
                idNorm: idNorm,
                jidsParaTentar,
                mapaPresencaAlvo: presencaBlack,
                ehBanPermanente: true
            });
        }
    }

    return {
        sucesso: true,
        numero: numLimpo,
        numeroFormatado: formatarExibicao(numLimpo),
        gruposAfetados,
        mensagem: `Número ${formatarExibicao(numLimpo)} banido permanentemente e expulsão de ${gruposAfetados} grupos enfileirada!`
    };
}

function desbanir(numeroAlvo) {
    const numLimpo = extrairNumeroLimpo(numeroAlvo);
    const idNorm = normalizarID(numLimpo);

    let lista = carregarBlacklist();
    const antes = lista.length;
    lista = lista.filter(x => x.numero !== numLimpo && (!idNorm || normalizarID(x.numero) !== idNorm));

    if (lista.length === antes) {
        return { sucesso: false, erro: 'Número não encontrado na Blacklist.' };
    }

    salvarBlacklist(lista);
    adicionarEventoFeed('SISTEMA', `🔓 ${formatarExibicao(numLimpo)} foi removido da Blacklist.`);
    return { sucesso: true, mensagem: `Número ${formatarExibicao(numLimpo)} desbanido com sucesso.` };
}

// =====================================================================
// 🎯 FASE 1: VARREDURA E LIMPEZA INICIAL (BLACK + BASE FORTE)
// =====================================================================
async function executarLimpezaInicial() {
    configAtual = carregarConfig();
    const limiteMax = configAtual.limiteGruposPorCampanha;
    const limiteBan = configAtual.limiteBanPermanente;

    console.log('\n=================================================================');
    console.log('🛡️  FASE 1: MAPEANDO GRUPOS (BLACK VITALÍCIA & BASE FORTE)...');
    console.log(`📌  Regra Saturação: Máx. ${limiteMax} grupos por pessoa`);
    console.log(`⛔  Regra Ban Permanente: Acima de ${limiteBan} links = Ban total + Remoção de TODOS os grupos`);
    console.log('=================================================================');

    adminsGlobais.clear();
    gruposBlackOficiais.clear();
    gruposBaseForteOficiais.clear();
    mapaAdminGrupos.clear();
    presencaBlack.clear();
    presencaBaseForte.clear();

    for (const sniper of snipersAtivos) {
        try {
            const all = await sniper.sock.groupFetchAllParticipating();
            for (const id in all) {
                const g = all[id];
                const campanha = identificarCampanha(g.subject);
                if (!campanha) continue;

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

                const meuNum = extrairNumeroLimpo(sniper.sock.user?.id);
                const eu = g.participants?.find(p => {
                    const pNum = extrairNumeroParticipante(p);
                    return meuNum && pNum && (meuNum === pNum || normalizarID(meuNum) === normalizarID(pNum));
                });

                if (eu && (eu.admin === 'admin' || eu.admin === 'superadmin')) {
                    if (!mapaAdminGrupos.has(id)) mapaAdminGrupos.set(id, new Set());
                    mapaAdminGrupos.get(id).add(sniper.indice);
                }

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
            console.error(`[!] Erro na varredura do ADM 0${sniper.indice}:`, e.message);
        }
    }

    const blackFiltrados = Array.from(gruposBlackOficiais.values()).filter(g => g.participants.length > 0);
    const baseForteFiltrados = Array.from(gruposBaseForteOficiais.values());

    console.log(`\n✅ Black Vitalícia: ${blackFiltrados.length} grupos oficiais com leads.`);
    console.log(`✅ Desafio Base Forte: ${baseForteFiltrados.length} grupos oficiais.`);
    console.log(`👑 Total de Administradores protegidos: ${adminsGlobais.size}`);
    console.log(`📋 Total na Whitelist de Imunidade: ${cacheWhitelist.length}`);
    console.log(`⛔ Total na Blacklist Permanente: ${cacheBlacklist.length}`);

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
                        ehBlacklist: false,
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
                if (estaNaBlacklist(num) || estaNaBlacklist(idN)) {
                    reg.ehBlacklist = true;
                }

                reg.grupos.push(info);
            }
        }

        const filaRemocoes = [];
        for (const [idN, dados] of mapaAlvos.entries()) {
            if (dados.ehAdmin || dados.ehWhitelist) continue;

            const excedeuLimiteBan = dados.grupos.length > limiteBan;
            if (excedeuLimiteBan || dados.ehBlacklist) {
                const motivoBan = dados.ehBlacklist
                    ? 'Presente na Blacklist Permanente'
                    : `Detectado em ${dados.grupos.length} links (Limite permitido: ${limiteBan})`;

                console.log(`⛔ [BAN PERMANENTE] Lead ${dados.numero} (${dados.grupos.length} grupos). Motivo: ${motivoBan}. Será removido de TODOS os grupos!`);
                adicionarEventoFeed('BAN_PERMANENTE', `⛔ Lead ${dados.numero} banido permanentemente (${dados.grupos.length} grps). Expulsando de TODOS os grupos sem exceção!`);

                if (!estaNaBlacklist(dados.numero)) {
                    cacheBlacklist.unshift({
                        numero: dados.numero,
                        numeroFormatado: formatarExibicao(dados.numero),
                        motivo: motivoBan,
                        dataBanimento: new Date().toISOString(),
                        totalGrupos: dados.grupos.length
                    });
                    salvarBlacklist(cacheBlacklist);
                }

                filaRemocoes.push({
                    numero: dados.numero,
                    idNorm: idN,
                    jidOriginal: dados.jidOriginal,
                    totalGrupos: dados.grupos.length,
                    manter: null,
                    remover: dados.grupos,
                    ehBanPermanente: true
                });
                continue;
            }

            if (dados.grupos.length > limiteMax) {
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
                    remover,
                    ehBanPermanente: false
                });
            }
        }

        const totalKicks = filaRemocoes.reduce((acc, a) => acc + a.remover.length, 0);
        console.log(`📊 [${nomeCampanha}] Leads para agir: ${filaRemocoes.length} | Kicks necessários: ${totalKicks}`);

        if (filaRemocoes.length === 0) {
            console.log(`✨ [${nomeCampanha}] Nenhuma violação encontrada. Grupos 100% higienizados!`);
            return;
        }

        console.log(`[⚡] Executando remoções de ${nomeCampanha}...`);
        let rotador = 0;
        let sucessos = 0;

        for (let i = 0; i < filaRemocoes.length; i++) {
            const item = filaRemocoes[i];
            const destinoTxt = item.ehBanPermanente ? 'NENHUM (BAN PERMANENTE TOTAL)' : `Mantido: "${item.manter?.subject}"`;
            console.log(`[${i + 1}/${filaRemocoes.length}] ${item.numero} (${item.totalGrupos} grps) -> ${destinoTxt}`);

            for (const grp of item.remover) {
                rotador++;
                const snipersDisponiveis = obterSnipersDisponiveis(grp.id);
                if (snipersDisponiveis.length === 0) {
                    console.log(`   ⚠️ [FALHA] Nenhum ADM conectado disponível para remover de "${grp.subject}".`);
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
                        console.log(`   🔴 [KICK] Removido de "${grp.subject}" (ADM 0${operador.indice})`);
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

                const delay = Math.floor(Math.random() * 800) + 1500;
                await sleep(delay);
            }
        }
        console.log(`🏁 [${nomeCampanha}] Limpeza concluída: ${sucessos}/${totalKicks} kicks executados.`);
    }

    await auditarELimparCampanha('BLACK VITALÍCIA (FASE 1)', blackFiltrados, presencaBlack);
    await auditarELimparCampanha('DESAFIO BASE FORTE (FASE 2)', baseForteFiltrados, presencaBaseForte);
}

// =====================================================================
// 🛑 FILA SERIALIZADA DE KICKS REALTIME (ANTI-RATE-LIMIT & ANTI-BAN)
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
        const item = filaKicksRealtime[0];
        item.tentativas = (item.tentativas || 0) + 1;

        const snipersDisponiveis = obterSnipersDisponiveis(item.idGrupo);

        if (snipersDisponiveis.length === 0) {
            if (item.tentativas <= 5) {
                console.log(`[⏳ CATRACA] ADMs reconectando. Aguardando 2.5s para expulsar ${item.numReal} de "${item.nomeGrupo}" (Tentativa ${item.tentativas}/5)...`);
                await sleep(2500);
                continue;
            } else {
                console.log(`[!] Erro definitivo: Nenhum ADM conectado com permissão em "${item.nomeGrupo}" após 5 tentativas.`);
                filaKicksRealtime.shift();
                continue;
            }
        }

        let removido = false;
        let ultimoErro = null;

        for (let s = 0; s < snipersDisponiveis.length; s++) {
            rotadorRealtime++;
            const operador = snipersDisponiveis[rotadorRealtime % snipersDisponiveis.length];

            if (!operador.conectado || !operador.sock?.ws?.isOpen) continue;

            for (const jidAlvo of item.jidsParaTentar) {
                try {
                    await operador.sock.groupParticipantsUpdate(item.idGrupo, [jidAlvo], 'remove');
                    if (item.mapaPresencaAlvo) {
                        item.mapaPresencaAlvo.get(item.idNorm)?.delete(item.idGrupo);
                    }
                    const tagAcao = item.ehBanPermanente ? '⛔ [BAN PERMANENTE TOTAL]' : '⛔ [BARRADO PELA CATRACA]';
                    console.log(`${tagAcao} ${item.numReal} expulso de "${item.nomeGrupo}" (${item.tagCampanha}) pelo ADM 0${operador.indice}.`);
                    adicionarEventoFeed('EXPULSAO', `${tagAcao} ${formatarExibicao(item.numReal)} expulso de "${item.nomeGrupo}" (${item.tagCampanha})`);
                    removido = true;
                    break;
                } catch (err) {
                    ultimoErro = err?.message || err;
                }
            }
            if (removido) break;
        }

        if (removido) {
            filaKicksRealtime.shift();
        } else {
            const erroStr = String(ultimoErro).toLowerCase();
            const ehErroConexao = erroStr.includes('connection closed') ||
                                  erroStr.includes('websocket') ||
                                  erroStr.includes('timed out') ||
                                  erroStr.includes('closed');

            if (ehErroConexao && item.tentativas <= 5) {
                console.log(`[⏳ CATRACA] Conexão oscilou ao expulsar de "${item.nomeGrupo}". Aguardando 2s (${item.tentativas}/5)...`);
                await sleep(2000);
                continue;
            } else {
                console.log(`[!] Erro ao expulsar ${item.numReal} de "${item.nomeGrupo}": ${ultimoErro}`);
                filaKicksRealtime.shift();
            }
        }

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
            try {
                const meta = await sniper.sock.groupMetadata(idGrupo);
                nomeGrupo = meta?.subject || idGrupo;
                campanha = identificarCampanha(nomeGrupo);
                if (campanha === 'BLACK_VITALICIA') gruposBlackOficiais.set(idGrupo, meta);
                if (campanha === 'BASE_FORTE') gruposBaseForteOficiais.set(idGrupo, meta);
            } catch (e) { }
        }

        if (!campanha) return;

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

            const hashEntrada = `${idGrupo}-${idNorm}`;
            if (travasRedundancia.has(hashEntrada)) continue;
            travasRedundancia.add(hashEntrada);
            setTimeout(() => travasRedundancia.delete(hashEntrada), 30000);

            const jidsParaTentar = [];
            if (idNovatoBruto && idNovatoBruto.includes('@')) jidsParaTentar.push(idNovatoBruto);
            if (numReal) {
                if (idNovatoBruto.includes('@lid')) {
                    if (!jidsParaTentar.includes(`${numReal}@lid`)) jidsParaTentar.push(`${numReal}@lid`);
                    if (!jidsParaTentar.includes(`${numReal}@s.whatsapp.net`)) jidsParaTentar.push(`${numReal}@s.whatsapp.net`);
                } else {
                    if (!jidsParaTentar.includes(`${numReal}@s.whatsapp.net`)) jidsParaTentar.push(`${numReal}@s.whatsapp.net`);
                    if (!jidsParaTentar.includes(`${numReal}@lid`)) jidsParaTentar.push(`${numReal}@lid`);
                }
            }

            // 🛑 REGRA 1: CHECAGEM DE BANIMENTO PERMANENTE (BLACKLIST)
            if (estaNaBlacklist(numReal) || estaNaBlacklist(idNorm)) {
                console.log(`\n⛔ [CATRACA - BAN PERMANENTE] Lead banido ${numReal} tentou entrar em "${nomeGrupo}" (${tagCampanha})! EXPULSÃO IMEDIATA.`);
                adicionarEventoFeed('EXPULSAO', `⛔ [BAN PERMANENTE] ${formatarExibicao(numReal)} tentou entrar em "${nomeGrupo}" e foi expulso imediatamente!`);

                enfileirarKickRealtime({
                    idGrupo,
                    nomeGrupo,
                    tagCampanha,
                    numReal,
                    idNorm,
                    jidsParaTentar,
                    mapaPresencaAlvo,
                    ehBanPermanente: true
                });
                continue;
            }

            // 🛡️ REGRA 2: IMUNIDADES (WHITELIST & ADMINS)
            if (estaNaWhitelist(numReal, snipersAtivos) || estaNaWhitelist(idNorm, snipersAtivos)) {
                console.log(`🛡️ [CATRACA - WHITELIST] ${numReal} entrou em "${nomeGrupo}" (Imune por Whitelist).`);
                adicionarEventoFeed('WHITELIST', `🛡️ ${formatarExibicao(numReal)} liberado em "${nomeGrupo}" (Imune por Whitelist)`);
                continue;
            }

            if (adminsGlobais.has(numReal) || adminsGlobais.has(idNorm)) {
                console.log(`👑 [CATRACA - ADMIN] ${numReal} entrou em "${nomeGrupo}" (Imune por Cargo Admin).`);
                adicionarEventoFeed('ADMIN', `👑 ${formatarExibicao(numReal)} liberado em "${nomeGrupo}" (Imune por Cargo Admin)`);
                continue;
            }

            // 📊 ATUALIZAÇÃO DA PRESENÇA
            if (!mapaPresencaAlvo.has(idNorm)) mapaPresencaAlvo.set(idNorm, new Set());
            const gruposDoLead = mapaPresencaAlvo.get(idNorm);
            gruposDoLead.add(idGrupo);

            const totalEmBlack = presencaBlack.get(idNorm)?.size || 0;
            const totalEmBaseForte = presencaBaseForte.get(idNorm)?.size || 0;
            const totalLinksGeral = totalEmBlack + totalEmBaseForte;

            configAtual = carregarConfig();
            const limiteMax = configAtual.limiteGruposPorCampanha;
            const limiteBan = configAtual.limiteBanPermanente;

            console.log(`🚪 [CATRACA] Lead ${numReal} entrou em "${nomeGrupo}" (${tagCampanha}). Presença na campanha: ${gruposDoLead.size}/${limiteMax} permitidos. Total de links geral: ${totalLinksGeral}.`);
            adicionarEventoFeed('ENTRADA', `🚪 Lead ${formatarExibicao(numReal)} entrou em "${nomeGrupo}" [${gruposDoLead.size}/${limiteMax} grps | Total geral: ${totalLinksGeral}]`);

            // 💀 REGRA 3: BAN PERMANENTE SE ULTRAPASSAR O LIMITE DE LINKS (> limiteBan)
            if (totalLinksGeral > limiteBan || gruposDoLead.size > limiteBan) {
                console.log(`\n🚨💀 [CATRACA - BAN PERMANENTE ATIVADO] Lead ${numReal} atingiu ${totalLinksGeral} links (> limite ${limiteBan})!`);
                adicionarEventoFeed('BAN_PERMANENTE', `💀 [BAN PERMANENTE ATIVADO] ${formatarExibicao(numReal)} atingiu ${totalLinksGeral} links (> limite ${limiteBan}). Banido e expulso de TODOS os grupos!`);

                if (!estaNaBlacklist(numReal)) {
                    cacheBlacklist.unshift({
                        numero: numReal,
                        numeroFormatado: formatarExibicao(numReal),
                        motivo: `Atingiu ${totalLinksGeral} links/grupos em tempo real (Limite máximo: ${limiteBan})`,
                        dataBanimento: new Date().toISOString(),
                        totalGrupos: totalLinksGeral
                    });
                    salvarBlacklist(cacheBlacklist);
                }

                const todosGruposDoLead = new Set([
                    ...(presencaBlack.get(idNorm) || []),
                    ...(presencaBaseForte.get(idNorm) || [])
                ]);

                for (const gid of todosGruposDoLead) {
                    enfileirarKickRealtime({
                        idGrupo: gid,
                        nomeGrupo: obterNomeGrupo(gid),
                        tagCampanha,
                        numReal,
                        idNorm,
                        jidsParaTentar,
                        mapaPresencaAlvo,
                        ehBanPermanente: true
                    });
                }
                continue;
            }

            // ⚖️ REGRA 4: SATURAÇÃO NORMAL (> limiteMax)
            if (gruposDoLead.size > limiteMax) {
                console.log(`\n🚨 [ALERTA CATRACA - ${tagCampanha}] Lead ${numReal} violou a regra de saturação! (${gruposDoLead.size}/${limiteMax} permitidos)`);
                adicionarEventoFeed('ALERTA', `🚨 Saturação! Lead ${formatarExibicao(numReal)} atingiu ${gruposDoLead.size}/${limiteMax} grupos em ${tagCampanha}. Grupo: "${nomeGrupo}"`);

                enfileirarKickRealtime({
                    idGrupo,
                    nomeGrupo,
                    tagCampanha,
                    numReal,
                    idNorm,
                    jidsParaTentar,
                    mapaPresencaAlvo,
                    ehBanPermanente: false
                });
            }
        }
    });
}

// =====================================================================
// 🚀 INICIALIZADOR DO MOTOR UNIFICADO
// =====================================================================
async function iniciarOperacaoAegisCompleta() {
    configAtual = carregarConfig();
    const qtdAdms = configAtual.quantidadeAdms || 4;

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
    console.log(`📌  Configuração Atual: Máx. ${configAtual.limiteGruposPorCampanha} Grupos por pessoa | Ban Permanente: > ${configAtual.limiteBanPermanente} links`);
    console.log(`🤖  Frota de ADMs (Administradores dos Grupos): ${qtdAdms} contas configuradas`);
    console.log('=================================================================\n');

    console.log(`[+] Conectando frota de ${qtdAdms} Administradores...`);
    for (let i = 1; i <= qtdAdms; i++) {
        await conectarSniper(i);
    }

    if (snipersAtivos.length === 0) {
        console.warn('⚠️ [AVISO] Nenhum ADM com sessão salva pôde ser conectado no momento.');
        console.log('📌 O Painel Web está 100% ativo. Acesse o navegador para conectar seus ADMs via QR Code ou Código.');
        adicionarEventoFeed('SISTEMA', '⚠️ Nenhum ADM conectado. Conecte pelo Painel Web via QR Code ou Código de Pareamento.');
        return;
    }

    console.log(`\n✅ ${snipersAtivos.length} Administradores (ADMs) armados e de olho nos grupos.`);

    await executarLimpezaInicial();

    console.log('\n=================================================================');
    console.log('🟢 [SENTINELA ATIVO 24/7] VIGIANDO BLACK VITALÍCIA & BASE FORTE!');
    console.log(`   • Tolerância de Saturação: até ${configAtual.limiteGruposPorCampanha} grupos.`);
    console.log(`   • Ban Permanente Automático: acima de ${configAtual.limiteBanPermanente} links = Remoção total sem exceção.`);
    console.log('   • Whitelist da Equipe 100% protegida.');
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
    adicionarEventoFeed,
    carregarConfig,
    salvarConfig,
    carregarBlacklist,
    salvarBlacklist,
    estaNaBlacklist,
    banirPermanente,
    desbanir,
    obterStatusAdms,
    conectarAdmManual,
    desconectarAdm,
    // Aliases para compatibilidade total
    obterStatusEspioes: obterStatusAdms,
    conectarEspiaoManual: conectarAdmManual,
    desconectarEspiao: desconectarAdm
};
