// =====================================================================
// 🛡️ MOTOR AEGIS: OPERAÇÃO BLACK VITALÍCIA & DESAFIO BASE FORTE
// Monitoramento unificado dos dois ecossistemas (56 grupos no total)
// 1. Limpeza inicial retroativa (Black primeiro, depois Base Forte)
// 2. Sentinela Catraca em Tempo Real 24/7 (Saturação configurável + Ban Permanente)
// 3. Gestão Centralizada de Administradores / ADMs (QR Code & Pairing Code via Web)
// =====================================================================
require('dotenv').config();
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

const {
    carregarCampanhasLocais,
    sincronizarCampanhasSendflow,
    iniciarAgendamento12Horas,
    obterInfoGrupoCampanha,
    ehAdmDaCampanha,
    obterDadosCompletosCampanhas,
    getCacheCampanhas
} = require('./sendflow_service');

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
// ⚙️ CONFIGURAÇÕES & ARQUIVOS PERSISTENTES (EASYPANEL & DOCKER READY)
// =====================================================================
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync(path.join(__dirname, 'data')) ? path.join(__dirname, 'data') : __dirname);
if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { }
}

// Migração suave de arquivos existentes para DATA_DIR (se DATA_DIR for /app/data ou customizado)
if (DATA_DIR !== __dirname) {
    try {
        const arqsParaMigrar = [
            'config_aegis.json', 'whitelist_aegis.json', 'whitelist_metadata.json',
            'blacklist_aegis.json', 'crocodilos_kelven.json', 'snipers_campanhas.json',
            'campanhas_adms.json', 'sendflow_campanhas_ativas.json', 'aegis_sessoes_snipers.zip'
        ];
        for (const arq of arqsParaMigrar) {
            const origem = path.join(__dirname, arq);
            const destino = path.join(DATA_DIR, arq);
            if (fs.existsSync(origem) && !fs.existsSync(destino)) {
                fs.copyFileSync(origem, destino);
            }
        }
        for (const item of fs.readdirSync(__dirname)) {
            if (item.startsWith('auth_sniper_') && fs.statSync(path.join(__dirname, item)).isDirectory()) {
                const destinoPasta = path.join(DATA_DIR, item);
                if (!fs.existsSync(destinoPasta)) {
                    fs.cpSync(path.join(__dirname, item), destinoPasta, { recursive: true });
                }
            }
        }
    } catch (e) { }
}

const ARQUIVO_CONFIG = path.join(DATA_DIR, 'config_aegis.json');
const ARQUIVO_WHITELIST = path.join(DATA_DIR, 'whitelist_aegis.json');
const ARQUIVO_BLACKLIST = path.join(DATA_DIR, 'blacklist_aegis.json');
const ARQUIVO_CROCODILOS = path.join(DATA_DIR, 'crocodilos_kelven.json');
const ARQUIVO_LOG = path.join(DATA_DIR, 'log_operacao_aegis.json');
const ARQUIVO_SNIPERS_CAMPANHAS = path.join(DATA_DIR, 'snipers_campanhas.json');

function obterPastaAuth(indice) {
    const pastaCustom = path.join(DATA_DIR, `auth_sniper_${indice}`);
    if (fs.existsSync(pastaCustom)) return pastaCustom;
    const pastaLocal = path.join(__dirname, `auth_sniper_${indice}`);
    if (fs.existsSync(pastaLocal)) return pastaLocal;
    return pastaCustom;
}

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

// Mapeamento dinâmico de grupos e presença para TODAS as campanhas ativas do SendFlow:
const mapaGruposPorCampanha = new Map(); // idCampanha -> Map(idGrupo -> g)
const mapaPresencaPorCampanha = new Map(); // idCampanha -> Map(idNorm -> Set(idGrupo))
const mapaInfoCampanhas = new Map(); // idCampanha -> { id, name }

function obterPresencaCampanha(idCampanha) {
    if (!mapaPresencaPorCampanha.has(idCampanha)) {
        mapaPresencaPorCampanha.set(idCampanha, new Map());
    }
    return mapaPresencaPorCampanha.get(idCampanha);
}

function obterGruposCampanha(idCampanha) {
    if (!mapaGruposPorCampanha.has(idCampanha)) {
        mapaGruposPorCampanha.set(idCampanha, new Map());
    }
    return mapaGruposPorCampanha.get(idCampanha);
}

function identificarCampanha(idOuSubject, subjectOpcional) {
    let idGrupo = null;
    let subject = null;

    if (subjectOpcional !== undefined) {
        idGrupo = idOuSubject;
        subject = subjectOpcional;
    } else {
        if (String(idOuSubject || '').includes('@g.us')) {
            idGrupo = idOuSubject;
        } else {
            subject = idOuSubject;
        }
    }

    const info = obterInfoGrupoCampanha(idGrupo, subject);
    if (info) {
        return info.releaseId;
    }

    if (subject) {
        if (/inss|pi-nov|pi\s*nov/i.test(subject)) return 'Mczvs7LRn3fLHyZzb3tu';
        if (/black|vital[ií]cia/i.test(subject)) return '1mVRQCG59lTdqDxWZn3n';
        if (/base\s*forte/i.test(subject)) return 'FeirPHs7jY1cgayuSles';
        if (/tj-sp|tjsp|tribunal/i.test(subject)) return 'V0F5VLj4HlSVjQCnHeUN';
    }
    return null;
}

function obterInfoCompletaCampanha(idGrupo, subject) {
    // 1. Verifica se já está mapeado em alguma campanha ativa na memória
    if (idGrupo && mapaGruposPorCampanha.size > 0) {
        for (const [idCamp, grps] of mapaGruposPorCampanha.entries()) {
            if (grps.has(idGrupo)) {
                const g = grps.get(idGrupo);
                const infoExemplo = mapaInfoCampanhas.get(idCamp);
                return {
                    idCampanha: idCamp,
                    nomeCampanha: infoExemplo?.name || idCamp,
                    nomeGrupo: g?.subject || subject || idGrupo
                };
            }
        }
    }

    const info = obterInfoGrupoCampanha(idGrupo, subject);
    if (info) {
        return {
            idCampanha: info.releaseId,
            nomeCampanha: info.nomeCampanha,
            nomeGrupo: info.nomeGrupo || subject || idGrupo
        };
    }

    if (subject) {
        const subLower = subject.toLowerCase();
        if (/inss|pi-nov|pi\s*nov/i.test(subLower)) {
            return {
                idCampanha: 'Mczvs7LRn3fLHyZzb3tu',
                nomeCampanha: 'Projeto INSS [PI-NOV-26]',
                nomeGrupo: subject
            };
        }
        if (/black|vital[ií]cia/i.test(subLower)) {
            return {
                idCampanha: '1mVRQCG59lTdqDxWZn3n',
                nomeCampanha: 'Black Vitalícia [BV-26]',
                nomeGrupo: subject
            };
        }
        if (/base\s*forte/i.test(subLower)) {
            return {
                idCampanha: 'FeirPHs7jY1cgayuSles',
                nomeCampanha: 'Base Forte 2026',
                nomeGrupo: subject
            };
        }
        if (/tj-sp|tjsp|tribunal/i.test(subLower)) {
            return {
                idCampanha: 'V0F5VLj4HlSVjQCnHeUN',
                nomeCampanha: 'Projeto TJ-SP Pós-Edital [PES-PPE-26]',
                nomeGrupo: subject
            };
        }
    }
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
// 🐊 GESTÃO DA LISTA "CROCODILO KELVEN" (LEADS COM > 4 GRUPOS)
// Regra: "se eu estiver acima de 4 grupos, deve ser removido de todos os grupos,
// ficando apenas o PRIMEIRO GRUPO QUE ELE ACESSOU, e entra na lista dos Crocodilo Kelven"
// =====================================================================
function carregarCrocodilos() {
    try {
        if (fs.existsSync(ARQUIVO_CROCODILOS)) {
            const raw = JSON.parse(fs.readFileSync(ARQUIVO_CROCODILOS, 'utf-8'));
            if (Array.isArray(raw)) return raw;
        }
    } catch (e) {
        console.error('[!] Erro ao carregar crocodilos_kelven.json:', e.message);
    }
    return [];
}

let cacheCrocodilos = carregarCrocodilos();

function salvarCrocodilos(lista) {
    try {
        fs.writeFileSync(ARQUIVO_CROCODILOS, JSON.stringify(lista, null, 2), 'utf-8');
        cacheCrocodilos = lista;
    } catch (e) {
        console.error('[!] Erro ao salvar crocodilos_kelven.json:', e.message);
    }
    return lista;
}

function obterCrocodilo(numOuJid, idCampanha = null) {
    if (!numOuJid) return null;
    const numLimpo = extrairNumeroLimpo(numOuJid);
    const idNorm = normalizarID(numLimpo);

    if (!cacheCrocodilos || cacheCrocodilos.length === 0) {
        cacheCrocodilos = carregarCrocodilos();
    }

    // 1. Procura com match exato ou normalizado
    let crocodiloEncontrado = null;
    for (const c of cacheCrocodilos) {
        const cNum = extrairNumeroLimpo(c.numero);
        const matchNum = cNum === numLimpo || (idNorm && normalizarID(cNum) === idNorm) ||
            (numLimpo.length >= 10 && cNum.length >= 10 && (cNum.includes(numLimpo) || numLimpo.includes(cNum)));

        if (matchNum) {
            // Se tiver match com a mesma campanha, retorna imediatamente
            if (idCampanha && c.idCampanha && c.idCampanha === idCampanha) {
                return c;
            }
            if (!crocodiloEncontrado) {
                crocodiloEncontrado = c;
            }
        }
    }

    // Retorna o crocodilo encontrado mesmo que de outra campanha (pois ele só tem permissão de estar em 1 grupo)
    return crocodiloEncontrado;
}

function registrarCrocodilo({ numero, idCampanha, nomeCampanha, grupoMantido, gruposRemovidos }) {
    const numLimpo = extrairNumeroLimpo(numero);
    const idNorm = normalizarID(numLimpo);
    let lista = carregarCrocodilos();

    const idx = lista.findIndex(c => {
        const cNum = extrairNumeroLimpo(c.numero);
        return cNum === numLimpo || (idNorm && normalizarID(cNum) === idNorm) ||
            (numLimpo.length >= 10 && cNum.length >= 10 && (cNum.includes(numLimpo) || numLimpo.includes(cNum)));
    });

    const listaRemovidos = (gruposRemovidos || []).map(g => ({
        id: g.id,
        nome: g.subject || g.nome || g.id,
        removidoEm: new Date().toISOString()
    }));

    const registro = {
        numero: numLimpo,
        numeroFormatado: formatarExibicao(numLimpo),
        idCampanha: idCampanha || null,
        nomeCampanha: nomeCampanha || 'Campanha',
        grupoMantido: {
            id: grupoMantido.id,
            nome: grupoMantido.subject || grupoMantido.nome || grupoMantido.id,
            mantidoDesde: new Date().toISOString()
        },
        gruposRemovidos: listaRemovidos,
        totalGruposTentados: listaRemovidos.length + 1,
        dataIdentificacao: new Date().toISOString(),
        ultimaTentativaBloqueada: null
    };

    if (idx !== -1) {
        // Se já existia, preserva o grupo mantido original caso já definido
        if (lista[idx].grupoMantido && lista[idx].grupoMantido.id) {
            registro.grupoMantido = lista[idx].grupoMantido;
        }
        lista[idx] = registro;
    } else {
        lista.unshift(registro);
    }

    salvarCrocodilos(lista);
    return registro;
}

function registrarTentativaEntradaCrocodilo(crocodilo, grupoTentado) {
    if (!crocodilo || !grupoTentado) return;
    try {
        let lista = carregarCrocodilos();
        const numLimpo = extrairNumeroLimpo(crocodilo.numero);
        const idNorm = normalizarID(numLimpo);

        const item = lista.find(c => {
            const cNum = extrairNumeroLimpo(c.numero);
            return cNum === numLimpo || (idNorm && normalizarID(cNum) === idNorm);
        });

        if (item) {
            item.ultimaTentativaBloqueada = new Date().toISOString();
            item.totalGruposTentados = (item.totalGruposTentados || 1) + 1;
            if (!Array.isArray(item.gruposRemovidos)) item.gruposRemovidos = [];

            const jaExiste = item.gruposRemovidos.some(g => g.id === grupoTentado.id);
            if (!jaExiste) {
                item.gruposRemovidos.push({
                    id: grupoTentado.id,
                    nome: grupoTentado.subject || grupoTentado.nome || grupoTentado.id,
                    removidoEm: new Date().toISOString()
                });
            }
            salvarCrocodilos(lista);
        }
    } catch (e) { }
}

function removerCrocodilo(numeroAlvo) {
    const numLimpo = extrairNumeroLimpo(numeroAlvo);
    const idNorm = normalizarID(numLimpo);
    let lista = carregarCrocodilos();
    const antes = lista.length;
    lista = lista.filter(c => {
        const cNum = extrairNumeroLimpo(c.numero);
        if (cNum === numLimpo) return false;
        if (idNorm && normalizarID(cNum) === idNorm) return false;
        if (numLimpo.length >= 10 && cNum.length >= 10 && (cNum.includes(numLimpo) || numLimpo.includes(cNum))) return false;
        return true;
    });
    if (lista.length !== antes) {
        salvarCrocodilos(lista);
        return true;
    }
    return false;
}

// =====================================================================
// 🚀 GERENCIADOR DE CONEXÃO DOS ADMS (CONTAS DO WHATSAPP)
// =====================================================================
const snipersAtivos = [];
const mapaAdminGrupos = new Map(); // idGrupo -> Set(indicesDosSnipers)
let sentinelaRealtimeAtivo = true;
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

// =====================================================================
// 🎯 GESTÃO DE ADMS SNIPERS POR CAMPANHA DO SENDFLOW
// =====================================================================
function carregarSnipersCampanhas() {
    try {
        if (fs.existsSync(ARQUIVO_SNIPERS_CAMPANHAS)) {
            const raw = JSON.parse(fs.readFileSync(ARQUIVO_SNIPERS_CAMPANHAS, 'utf-8'));
            if (Array.isArray(raw) && raw.length > 0) {
                return raw;
            }
        }
    } catch (e) {
        console.error('[!] Erro ao carregar snipers_campanhas.json:', e.message);
    }

    // Inicialização padrão inteligente baseada nas campanhas ativas do SendFlow
    configAtual = carregarConfig();
    const qtd = configAtual.quantidadeAdms || 4;
    const campanhasAtivas = (getCacheCampanhas()?.campanhas || []);
    const c1 = campanhasAtivas[0] || { id: '1mVRQCG59lTdqDxWZn3n', name: 'Black Vitalícia [BV-26]' };
    const c2 = campanhasAtivas[1] || { id: 'FeirPHs7jY1cgayuSles', name: 'Base Forte 2026' };

    const snipersIniciais = [];
    for (let i = 1; i <= qtd; i++) {
        const camp = (i <= Math.ceil(qtd / 2)) ? c1 : c2;
        snipersIniciais.push({
            id: i,
            indice: i,
            pasta: `auth_sniper_${i}`,
            campaignId: camp.id,
            campaignName: camp.name,
            criadoEm: new Date().toISOString()
        });
    }

    salvarSnipersCampanhas(snipersIniciais);
    return snipersIniciais;
}

function salvarSnipersCampanhas(lista) {
    try {
        fs.writeFileSync(ARQUIVO_SNIPERS_CAMPANHAS, JSON.stringify(lista, null, 2), 'utf-8');
    } catch (e) {
        console.error('[!] Erro ao salvar snipers_campanhas.json:', e.message);
    }
}

function obterMetaSniper(id) {
    const lista = carregarSnipersCampanhas();
    const idNum = Number(id);
    return lista.find(s => Number(s.id) === idNum || Number(s.indice) === idNum) || null;
}

function adicionarSniperCampanha({ campaignId, campaignName }) {
    if (!campaignId) throw new Error('ID da campanha é obrigatório.');

    if (!campaignName) {
        const camp = (getCacheCampanhas()?.campanhas || []).find(c => c.id === campaignId);
        campaignName = camp?.name || campaignId;
    }

    const lista = carregarSnipersCampanhas();
    const maxId = lista.reduce((max, s) => Math.max(max, Number(s.id || s.indice || 0)), 0);
    const novoId = maxId + 1;

    const novoSniper = {
        id: novoId,
        indice: novoId,
        pasta: `auth_sniper_${novoId}`,
        campaignId,
        campaignName,
        criadoEm: new Date().toISOString()
    };

    lista.push(novoSniper);
    salvarSnipersCampanhas(lista);

    configAtual.quantidadeAdms = lista.length;
    salvarConfig({ quantidadeAdms: lista.length });

    const estado = {
        indice: novoId,
        id: novoId,
        campaignId,
        campaignName,
        conectado: false,
        status: 'desconectado',
        numero: null,
        qrCodeDataUrl: null,
        pairingCode: null,
        erroMsg: null,
        atualizadoEm: Date.now()
    };
    estadoAdms.set(novoId, estado);

    adicionarEventoFeed('ADM', `➕ Novo ADM Sniper 0${novoId} criado para a campanha "${campaignName}".`);

    return {
        sucesso: true,
        mensagem: `ADM Sniper 0${novoId} adicionado à campanha "${campaignName}" com sucesso!`,
        sniper: novoSniper
    };
}

async function removerSniperCampanha(id) {
    id = Number(id);
    if (!id || id < 1) throw new Error('ID do ADM inválido.');

    cancelarReconexao(id);

    // 1. Desconecta o socket se ativo
    const idxAtivo = snipersAtivos.findIndex(x => x.indice === id);
    if (idxAtivo !== -1) {
        const s = snipersAtivos[idxAtivo];
        try {
            s.sock.ev.removeAllListeners();
            if (s.sock.logout) await s.sock.logout();
            else if (s.sock.ws) s.sock.ws.close();
        } catch (e) { }
        snipersAtivos.splice(idxAtivo, 1);
    }

    // 2. Remove com segurança a pasta de credenciais deste sniper
    const pastaAuth = obterPastaAuth(id);
    if (fs.existsSync(pastaAuth)) {
        try {
            fs.rmSync(pastaAuth, { recursive: true, force: true });
        } catch (e) {
            console.error(`[!] Erro ao remover pasta auth_sniper_${id}:`, e.message);
        }
    }

    // 3. Limpa estado em RAM
    estadoAdms.delete(id);

    // 4. Remove do arquivo de snipers
    let lista = carregarSnipersCampanhas();
    const itemRemovido = lista.find(s => Number(s.id) === id || Number(s.indice) === id);
    lista = lista.filter(s => Number(s.id) !== id && Number(s.indice) !== id);
    salvarSnipersCampanhas(lista);

    configAtual.quantidadeAdms = lista.length;
    salvarConfig({ quantidadeAdms: lista.length });

    const nomeCampanha = itemRemovido?.campaignName || 'Campanha';
    adicionarEventoFeed('ADM', `🗑️ ADM Sniper 0${id} removido da campanha "${nomeCampanha}" e credenciais apagadas.`);

    return {
        sucesso: true,
        mensagem: `ADM Sniper 0${id} removido da campanha com sucesso!`
    };
}

function obterStatusAdmsPorCampanha() {
    configAtual = carregarConfig();
    const campanhasAtivas = (getCacheCampanhas()?.campanhas || []);
    const snipersCadastrados = carregarSnipersCampanhas();

    const snipersComStatus = snipersCadastrados.map(sniper => {
        const id = Number(sniper.id || sniper.indice);
        let estado = estadoAdms.get(id);
        const sAtivo = snipersAtivos.find(x => x.indice === id && x.conectado && x.sock?.ws?.isOpen);

        if (sAtivo) {
            const num = extrairNumeroLimpo(sAtivo.sock?.user?.id);
            if (!estado) {
                estado = {
                    indice: id,
                    id: id,
                    campaignId: sniper.campaignId,
                    campaignName: sniper.campaignName,
                    conectado: true,
                    status: 'conectado',
                    numero: num,
                    qrCodeDataUrl: null,
                    pairingCode: null,
                    erroMsg: null,
                    atualizadoEm: Date.now()
                };
                estadoAdms.set(id, estado);
            } else {
                estado.conectado = true;
                estado.status = 'conectado';
                estado.numero = num;
                estado.campaignId = sniper.campaignId;
                estado.campaignName = sniper.campaignName;
            }
        } else if (!estado) {
            const pastaAuth = path.join(__dirname, `auth_sniper_${id}`);
            const temCreds = fs.existsSync(path.join(pastaAuth, 'creds.json'));
            estado = {
                indice: id,
                id: id,
                campaignId: sniper.campaignId,
                campaignName: sniper.campaignName,
                conectado: false,
                status: temCreds ? 'pronto_para_conectar' : 'desconectado',
                numero: null,
                qrCodeDataUrl: null,
                pairingCode: null,
                erroMsg: null,
                atualizadoEm: Date.now()
            };
            estadoAdms.set(id, estado);
        }

        return {
            id,
            indice: id,
            campaignId: sniper.campaignId,
            campaignName: sniper.campaignName,
            conectado: !!estado.conectado,
            status: estado.status,
            numero: estado.numero,
            numeroFormatado: formatarExibicao(estado.numero),
            qrCodeDataUrl: estado.qrCodeDataUrl,
            pairingCode: estado.pairingCode,
            erroMsg: estado.erroMsg,
            atualizadoEm: estado.atualizadoEm,
            criadoEm: sniper.criadoEm
        };
    });

    // Mapeamento das campanhas ativas
    const mapaCampanhas = new Map();
    campanhasAtivas.forEach(c => {
        mapaCampanhas.set(c.id, {
            id: c.id,
            name: c.name,
            type: c.type,
            totalGrupos: c.grupos ? c.grupos.length : (c.totalGrupos || 0),
            snipers: []
        });
    });

    const snipersSemCampanha = [];

    snipersComStatus.forEach(s => {
        if (s.campaignId && mapaCampanhas.has(s.campaignId)) {
            mapaCampanhas.get(s.campaignId).snipers.push(s);
        } else {
            snipersSemCampanha.push(s);
        }
    });

    const campanhasAgrupadas = Array.from(mapaCampanhas.values()).map(camp => ({
        ...camp,
        totalSnipers: camp.snipers.length,
        conectados: camp.snipers.filter(s => s.conectado).length
    }));

    const totalConectadosGeral = snipersComStatus.filter(s => s.conectado).length;

    return {
        sucesso: true,
        totalCampanhas: campanhasAgrupadas.length,
        totalSnipersGeral: snipersComStatus.length,
        totalConectadosGeral,
        campanhas: campanhasAgrupadas,
        globais: snipersSemCampanha,
        snipers: snipersComStatus
    };
}

function obterStatusAdms() {
    const dados = obterStatusAdmsPorCampanha();
    return dados.snipers;
}

function obterEstadoAegis() {
    configAtual = carregarConfig();
    const dadosSendflow = obterDadosCompletosCampanhas();
    return {
        snipers: obterStatusAdms(),
        adms: obterStatusAdms(),
        config: configAtual,
        sendflow: dadosSendflow,
        totalCampanhasAtivas: dadosSendflow.totalCampanhasAtivas,
        totalGruposMonitorados: dadosSendflow.totalGrupos,
        totalGruposBlack: (mapaGruposPorCampanha.get('1mVRQCG59lTdqDxWZn3n') || gruposBlackOficiais).size,
        totalGruposBaseForte: (mapaGruposPorCampanha.get('FeirPHs7jY1cgayuSles') || gruposBaseForteOficiais).size,
        totalAdminsMapeados: adminsGlobais.size,
        totalWhitelist: cacheWhitelist.length,
        totalBlacklist: cacheBlacklist.length,
        filaKicksTamanho: filaKicksRealtime.length,
        sentinelaAtivo: sentinelaRealtimeAtivo,
        feedEventos: feedEventos.slice(0, 50)
    };
}

function calcularTotalGruposGeral(idNorm) {
    const todos = new Set();
    for (const mapaPresenca of mapaPresencaPorCampanha.values()) {
        const grps = mapaPresenca.get(idNorm);
        if (grps) {
            for (const gid of grps) todos.add(gid);
        }
    }
    return todos.size;
}

function obterTodosGruposDoLead(idNorm) {
    const todos = new Set();
    for (const mapaPresenca of mapaPresencaPorCampanha.values()) {
        const grps = mapaPresenca.get(idNorm);
        if (grps) {
            for (const gid of grps) todos.add(gid);
        }
    }
    return todos;
}

// Aliases para compatibilidade retroativa
const gruposBlackOficiais = obterGruposCampanha('1mVRQCG59lTdqDxWZn3n');
const gruposBaseForteOficiais = obterGruposCampanha('FeirPHs7jY1cgayuSles');
const presencaBlack = obterPresencaCampanha('1mVRQCG59lTdqDxWZn3n');
const presencaBaseForte = obterPresencaCampanha('FeirPHs7jY1cgayuSles');

const adminsGlobais = new Set();
const travasRedundancia = new Set();
const mapaLidParaTelefone = new Map(); // lid -> telefone real

function obterNomeGrupo(idGrupo) {
    for (const grps of mapaGruposPorCampanha.values()) {
        if (grps.has(idGrupo)) return grps.get(idGrupo).subject;
    }
    const info = obterInfoGrupoCampanha(idGrupo);
    if (info && info.nomeGrupo) return info.nomeGrupo;
    return idGrupo;
}

function obterSnipersDisponiveis(idGrupo) {
    let campaignId = null;
    const infoCampanha = obterInfoGrupoCampanha(idGrupo);
    if (infoCampanha && infoCampanha.releaseId) {
        campaignId = infoCampanha.releaseId;
    }
    if (!campaignId) {
        for (const [cId, grps] of mapaGruposPorCampanha.entries()) {
            if (grps.has(idGrupo)) {
                campaignId = cId;
                break;
            }
        }
    }

    // 1. Prioridade Máxima: ADMs Snipers vinculados EXCLUSIVAMENTE a esta campanha
    if (campaignId) {
        const snipersDaCampanha = snipersAtivos.filter(s => {
            const meta = obterMetaSniper(s.indice);
            return meta && meta.campaignId === campaignId && s.conectado && s.sock?.ws?.isOpen;
        });

        if (snipersDaCampanha.length > 0) {
            // Se algum desses snipers já for admin confirmado no grupo, prioriza ele
            const indicesAdminNoGrupo = mapaAdminGrupos.get(idGrupo);
            if (indicesAdminNoGrupo && indicesAdminNoGrupo.size > 0) {
                const confirmados = snipersDaCampanha.filter(s => indicesAdminNoGrupo.has(s.indice));
                if (confirmados.length > 0) return confirmados;
            }
            return snipersDaCampanha;
        }
    }

    // 2. Prioridade Média: Qualquer ADM sniper conectado que seja admin confirmado deste grupo
    const indices = mapaAdminGrupos.get(idGrupo);
    if (indices && indices.size > 0) {
        const adminsConectados = snipersAtivos.filter(s =>
            indices.has(s.indice) &&
            s.conectado &&
            s.sock?.ws?.isOpen
        );
        if (adminsConectados.length > 0) return adminsConectados;
    }

    // 3. Fallback Seguro: Qualquer ADM sniper conectado e pronto com socket aberto
    return snipersAtivos.filter(s => s.conectado && s.sock?.ws?.isOpen);
}

// =====================================================================
// 📋 AUTO-MAPEAMENTO DE GRUPOS E ADMS VIA WHATSAPP (INSTANTÂNEO & SEGURO)
// =====================================================================
async function mapearGruposDoSniper(sniperObj) {
    if (!sniperObj || !sniperObj.sock) return;
    try {
        const indice = sniperObj.indice;
        const metaSniper = obterMetaSniper(indice);
        const campaignId = metaSniper?.campaignId || null;
        const campaignName = metaSniper?.campaignName || 'Campanha Desconhecida';

        console.log(`[🔍 ADM 0${indice}] Mapeando grupos diretamente via WhatsApp...`);
        const allGroups = await sniperObj.sock.groupFetchAllParticipating();
        const groupIds = Object.keys(allGroups);
        console.log(`[📋 ADM 0${indice}] Encontrados ${groupIds.length} grupos no chip.`);

        let gruposMapeados = 0;
        const meuNum = extrairNumeroLimpo(sniperObj.sock.user?.id);

        for (const gid of groupIds) {
            const g = allGroups[gid];
            let idCamp = campaignId;
            let nomeCamp = campaignName;

            const infoCamp = obterInfoCompletaCampanha(gid, g.subject);
            if (infoCamp && infoCamp.idCampanha) {
                idCamp = infoCamp.idCampanha;
                nomeCamp = infoCamp.nomeCampanha;
            } else if (!idCamp) {
                idCamp = 'GLOBAL';
                nomeCamp = 'Geral';
            }

            if (idCamp && !mapaInfoCampanhas.has(idCamp)) {
                mapaInfoCampanhas.set(idCamp, { id: idCamp, name: nomeCamp });
            }

            const mapaGrupos = obterGruposCampanha(idCamp);
            mapaGrupos.set(gid, g);
            gruposMapeados++;

            const mapaPresenca = obterPresencaCampanha(idCamp);
            for (const p of (g.participants || [])) {
                if (p.lid && p.jid) mapaLidParaTelefone.set(extrairNumeroLimpo(p.lid), extrairNumeroLimpo(p.jid));
                if (p.lid && p.id && p.id.includes('@s.whatsapp.net')) mapaLidParaTelefone.set(extrairNumeroLimpo(p.lid), extrairNumeroLimpo(p.id));
                if (p.id && p.jid && p.id.includes('@lid')) mapaLidParaTelefone.set(extrairNumeroLimpo(p.id), extrairNumeroLimpo(p.jid));

                const pNum = extrairNumeroParticipante(p);
                if (pNum) {
                    const idN = normalizarID(pNum);
                    if (p.admin === 'admin' || p.admin === 'superadmin') {
                        adminsGlobais.add(pNum);
                        adminsGlobais.add(idN);
                    }
                    if (!mapaPresenca.has(idN)) mapaPresenca.set(idN, new Set());
                    mapaPresenca.get(idN).add(gid);
                }
            }

            const eu = g.participants?.find(p => {
                const pNum = extrairNumeroParticipante(p);
                return meuNum && pNum && (meuNum === pNum || normalizarID(meuNum) === normalizarID(pNum));
            });

            if (eu && (eu.admin === 'admin' || eu.admin === 'superadmin')) {
                if (!mapaAdminGrupos.has(gid)) mapaAdminGrupos.set(gid, new Set());
                mapaAdminGrupos.get(gid).add(indice);
            }
        }

        console.log(`[✅ ADM 0${indice}] ${gruposMapeados} grupos sincronizados e catalogados com sucesso! Campanha: ${campaignName}`);
        adicionarEventoFeed('ADM', `✅ ADM 0${indice}: ${gruposMapeados} grupos sincronizados (${campaignName})`);

        // Dispara auditoria imediata de Crocodilos Kelven e saturação para a campanha deste sniper
        const campAlvoAuditoria = campaignId || (infoCamp ? infoCamp.idCampanha : null);
        if (campAlvoAuditoria) {
            await auditarSaturacaoECrocodilos(campAlvoAuditoria);
        }
    } catch (err) {
        console.error(`[!] Erro ao mapear grupos do ADM 0${sniperObj.indice}:`, err.message);
    }
}

// =====================================================================
// 💾 AUTO-SALVAMENTO PERIÓDICO DO PACOTE DE SESSÕES (ANTI-PERDA DE DEPLOY)
// =====================================================================
function autoSalvarBackupSessoes() {
    try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip();
        let encontrou = false;

        const scanDirs = [DATA_DIR, __dirname];
        const pastasSalvas = new Set();

        for (const dir of scanDirs) {
            if (!fs.existsSync(dir)) continue;
            for (const item of fs.readdirSync(dir)) {
                if (item.startsWith('auth_sniper_') && !pastasSalvas.has(item)) {
                    const fullP = path.join(dir, item);
                    if (fs.statSync(fullP).isDirectory() && fs.existsSync(path.join(fullP, 'creds.json'))) {
                        zip.addLocalFolder(fullP, item);
                        pastasSalvas.add(item);
                        encontrou = true;
                    }
                }
            }
        }

        const arqs = [ARQUIVO_CONFIG, ARQUIVO_WHITELIST, ARQUIVO_BLACKLIST, ARQUIVO_CROCODILOS, ARQUIVO_SNIPERS_CAMPANHAS];
        for (const a of arqs) {
            if (fs.existsSync(a)) {
                zip.addLocalFile(a);
            }
        }

        if (encontrou) {
            zip.writeZip(path.join(DATA_DIR, 'aegis_sessoes_snipers.zip'));
            if (DATA_DIR !== __dirname) {
                zip.writeZip(path.join(__dirname, 'aegis_sessoes_snipers.zip'));
            }
        }
    } catch (e) { }
}

// =====================================================================
// 🐊 AUDITORIA DE CROCODILOS KELVEN & SATURAÇÃO
// "se eu estiver acima de 4 grupos, deve ser removido de todos os grupos,
// ficando apenas o PRIMEIRO GRUPO QUE ELE ACESSOU, quando esse lead atingir
// esse limite, ele entra na lista dos 'Crocodilo Kelven'."
// =====================================================================
async function auditarSaturacaoECrocodilos(idCampanha) {
    if (!idCampanha) return;
    configAtual = carregarConfig();
    const limiteMax = configAtual.limiteGruposPorCampanha || 4;
    const limiteBan = configAtual.limiteBanPermanente || 10;
    const mapaPresenca = obterPresencaCampanha(idCampanha);
    const mapaGrupos = obterGruposCampanha(idCampanha);
    const nomeCampanha = mapaInfoCampanhas.get(idCampanha)?.name || idCampanha;

    let crocodilosTratados = 0;

    for (const [idNorm, setGrupos] of mapaPresenca.entries()) {
        if (!setGrupos || setGrupos.size <= limiteMax) continue;

        // Recupera o número real e JID do participante
        let numReal = null;
        let jidOriginal = null;
        for (const gid of setGrupos) {
            const g = mapaGrupos.get(gid);
            const p = g?.participants?.find(part => {
                const n = extrairNumeroParticipante(part);
                return n && normalizarID(n) === idNorm;
            });
            if (p) {
                numReal = extrairNumeroParticipante(p);
                jidOriginal = p.id || p.jid || '';
                break;
            }
        }
        if (!numReal) continue;

        // Imunidades
        if (ehAdmDaCampanha(idCampanha, numReal) || ehAdmDaCampanha(idCampanha, idNorm)) continue;
        if (estaNaWhitelist(numReal, snipersAtivos) || estaNaWhitelist(idNorm, snipersAtivos)) continue;
        if (adminsGlobais.has(numReal) || adminsGlobais.has(idNorm)) continue;

        const totalLinksGeral = calcularTotalGruposGeral(idNorm);

        // REGRA 1: Ban Permanente (> limiteBan)
        if (totalLinksGeral > limiteBan || setGrupos.size > limiteBan || estaNaBlacklist(numReal) || estaNaBlacklist(idNorm)) {
            console.log(`⛔ [AUDITORIA - BAN PERMANENTE] Lead ${numReal} detectado em ${setGrupos.size} grupos (> limite ban ${limiteBan})! Removendo de TODOS.`);
            adicionarEventoFeed('BAN_PERMANENTE', `⛔ Lead ${formatarExibicao(numReal)} atingiu ${setGrupos.size} grupos (> limite ${limiteBan}). Banido permanentemente!`);

            if (!estaNaBlacklist(numReal)) {
                cacheBlacklist.unshift({
                    numero: numReal,
                    numeroFormatado: formatarExibicao(numReal),
                    motivo: `Encontrado em ${setGrupos.size} grupos no escaneamento (Limite permitido: ${limiteBan})`,
                    dataBanimento: new Date().toISOString(),
                    totalGrupos: setGrupos.size
                });
                salvarBlacklist(cacheBlacklist);
            }

            const jidsParaTentar = [];
            if (jidOriginal && jidOriginal.includes('@')) jidsParaTentar.push(jidOriginal);
            jidsParaTentar.push(`${numReal}@s.whatsapp.net`, `${numReal}@lid`);

            for (const gid of setGrupos) {
                enfileirarKickRealtime({
                    idGrupo: gid,
                    nomeGrupo: obterNomeGrupo(gid),
                    tagCampanha: nomeCampanha,
                    numReal,
                    idNorm,
                    jidsParaTentar,
                    mapaPresencaAlvo: mapaPresenca,
                    ehBanPermanente: true
                });
            }
            continue;
        }

        // REGRA 2: Crocodilo Kelven (> limiteMax, ex: > 4)
        // Regra do Usuário: "ficando apenas o PRIMEIRO GRUPO QUE ELE ACESSOU"
        crocodilosTratados++;
        const listaGruposDoLead = Array.from(setGrupos).map(gid => {
            const g = mapaGrupos.get(gid);
            return {
                id: gid,
                subject: g?.subject || obterNomeGrupo(gid) || gid,
                creation: g?.creation || 0
            };
        });

        // Se já existe um registro de Crocodilo Kelven para este lead, preserva o grupo mantido original dele
        const crocodiloExistente = obterCrocodilo(numReal, idCampanha);
        let primeiroGrupo = null;
        let gruposParaRemover = [];

        if (crocodiloExistente && crocodiloExistente.grupoMantido && setGrupos.has(crocodiloExistente.grupoMantido.id)) {
            primeiroGrupo = {
                id: crocodiloExistente.grupoMantido.id,
                subject: crocodiloExistente.grupoMantido.nome || obterNomeGrupo(crocodiloExistente.grupoMantido.id)
            };
            gruposParaRemover = listaGruposDoLead.filter(g => g.id !== primeiroGrupo.id);
        } else {
            // Ordena: data de criação mais antiga ou numeração natural no título (ex: Grupo 01 antes de 02)
            listaGruposDoLead.sort((a, b) => {
                if (a.creation && b.creation && a.creation !== b.creation) {
                    return a.creation - b.creation;
                }
                return a.subject.localeCompare(b.subject, undefined, { numeric: true });
            });
            primeiroGrupo = listaGruposDoLead[0];
            gruposParaRemover = listaGruposDoLead.slice(1);
        }

        console.log(`\n🐊 [CROCODILO KELVEN IDENTIFICADO] Lead ${numReal} está em ${setGrupos.size} grupos na campanha "${nomeCampanha}"!`);
        console.log(`   ✅ Mantido APENAS no 1º grupo acessado: "${primeiroGrupo.subject}"`);
        console.log(`   🔴 Removendo dos demais ${gruposParaRemover.length} grupos excedentes...`);

        adicionarEventoFeed('ALERTA', `🐊 Crocodilo Kelven! Lead ${formatarExibicao(numReal)} em ${setGrupos.size} grupos. Mantido apenas no 1º grupo ("${primeiroGrupo.subject}") e expulso dos demais!`);

        registrarCrocodilo({
            numero: numReal,
            idCampanha,
            nomeCampanha,
            grupoMantido: primeiroGrupo,
            gruposRemovidos: gruposParaRemover
        });

        // Atualiza a presença em RAM para manter apenas o 1º grupo
        setGrupos.clear();
        setGrupos.add(primeiroGrupo.id);

        const jidsParaTentar = [];
        if (jidOriginal && jidOriginal.includes('@')) jidsParaTentar.push(jidOriginal);
        jidsParaTentar.push(`${numReal}@s.whatsapp.net`, `${numReal}@lid`);

        for (const grp of gruposParaRemover) {
            enfileirarKickRealtime({
                idGrupo: grp.id,
                nomeGrupo: grp.subject,
                tagCampanha: nomeCampanha,
                numReal,
                idNorm,
                jidsParaTentar,
                mapaPresencaAlvo: mapaPresenca,
                ehBanPermanente: false
            });
        }
    }

    if (crocodilosTratados > 0) {
        console.log(`✅ [AUDITORIA CROCODILOS] ${crocodilosTratados} Crocodilos Kelven auditados e tratados na campanha "${nomeCampanha}".`);
    }
}

// Conexão autônoma de ADM via pasta existente
async function conectarSniper(indice) {
    indice = Number(indice);
    cancelarReconexao(indice);

    const pastaAuth = obterPastaAuth(indice);
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

                    sentinelaRealtimeAtivo = true;
                    vincularListenersRealtime(sniperObj);
                    mapearGruposDoSniper(sniperObj).catch(() => {});
                    setTimeout(autoSalvarBackupSessoes, 2000);

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

    const pastaAuth = obterPastaAuth(indice);

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

    const meta = obterMetaSniper(indice);
    let estado = {
        indice,
        id: indice,
        campaignId: meta?.campaignId || null,
        campaignName: meta?.campaignName || null,
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

            sentinelaRealtimeAtivo = true;
            vincularListenersRealtime(sniperObj);
            mapearGruposDoSniper(sniperObj).catch(() => {});
            setTimeout(autoSalvarBackupSessoes, 2000);
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

    const pastaAuth = obterPastaAuth(indice);

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
    lista = lista.filter(x => {
        const xNum = extrairNumeroLimpo(x.numero);
        if (xNum === numLimpo) return false;
        if (idNorm && normalizarID(xNum) === idNorm) return false;
        if (numLimpo.length >= 10 && xNum.length >= 10 && (xNum.includes(numLimpo) || numLimpo.includes(xNum))) return false;
        return true;
    });

    // Remove também da lista de Crocodilos Kelven se estiver nela
    removerCrocodilo(numLimpo);

    // Limpa travas de redundância para que possa reentrar sem esperar 30s
    for (const hash of travasRedundancia) {
        if (hash.includes(numLimpo) || (idNorm && hash.includes(idNorm))) {
            travasRedundancia.delete(hash);
        }
    }

    salvarBlacklist(lista);
    adicionarEventoFeed('SISTEMA', `🔓 ${formatarExibicao(numLimpo)} foi desbanido e liberado com sucesso.`);
    setTimeout(autoSalvarBackupSessoes, 2000);
    return { sucesso: true, mensagem: `Número ${formatarExibicao(numLimpo)} desbanido e liberado com sucesso.` };
}

// =====================================================================
// 🎯 FASE 1: VARREDURA E LIMPEZA INICIAL (TODAS AS CAMPANHAS ATIVAS DO SENDFLOW)
// =====================================================================
async function executarLimpezaInicial() {
    configAtual = carregarConfig();
    const limiteMax = configAtual.limiteGruposPorCampanha;
    const limiteBan = configAtual.limiteBanPermanente;

    const cacheSendflow = getCacheCampanhas();
    const totalCampAtivas = cacheSendflow.totalCampanhasAtivas || 2;

    console.log('\n=================================================================');
    console.log(`🛡️  FASE 1: MAPEANDO GRUPOS DE TODAS AS CAMPANHAS ATIVAS DO SENDFLOW (${totalCampAtivas} campanhas)...`);
    console.log(`📌  Regra Saturação: Máx. ${limiteMax} grupos por pessoa na mesma campanha`);
    console.log(`⛔  Regra Ban Permanente: Acima de ${limiteBan} links = Ban total + Remoção de TODOS os grupos`);
    console.log('=================================================================');

    adminsGlobais.clear();
    mapaAdminGrupos.clear();
    mapaGruposPorCampanha.clear();
    mapaPresencaPorCampanha.clear();

    for (const sniper of snipersAtivos) {
        try {
            const all = await sniper.sock.groupFetchAllParticipating();
            for (const id in all) {
                const g = all[id];
                const infoCamp = obterInfoCompletaCampanha(id, g.subject);
                if (!infoCamp) continue;

                const { idCampanha, nomeCampanha } = infoCamp;
                const mapaGruposDestaCampanha = obterGruposCampanha(idCampanha);

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

                if (!mapaGruposDestaCampanha.has(id) || (mapaGruposDestaCampanha.get(id).participants?.length || 0) < (g.participants?.length || 0)) {
                    mapaGruposDestaCampanha.set(id, g);
                }
            }
        } catch (e) {
            console.error(`[!] Erro na varredura do ADM 0${sniper.indice}:`, e.message);
        }
    }

    console.log(`\n👑 Total de Administradores globais protegidos: ${adminsGlobais.size}`);
    console.log(`📋 Total na Whitelist de Imunidade: ${cacheWhitelist.length}`);
    console.log(`⛔ Total na Blacklist Permanente: ${cacheBlacklist.length}`);

    async function auditarELimparCampanha(idCampanha, nomeCampanha, listaGrupos, mapaPresencaRAM) {
        console.log(`\n-------------------------------------------------------------`);
        console.log(`🔍 AUDITANDO: ${nomeCampanha} (${listaGrupos.length} grupos)`);
        console.log(`-------------------------------------------------------------`);

        const mapaAlvos = new Map();

        for (const g of listaGrupos) {
            const info = { id: g.id, subject: g.subject, creation: g.creation || 0 };
            const jaVisto = new Set();

            for (const p of (g.participants || [])) {
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
                if (ehAdmDaCampanha(idCampanha, num) || ehAdmDaCampanha(idCampanha, idN)) {
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

            const totalGeral = calcularTotalGruposGeral(idN);
            const excedeuLimiteBan = dados.grupos.length > limiteBan || totalGeral > limiteBan;

            if (excedeuLimiteBan || dados.ehBlacklist) {
                const motivoBan = dados.ehBlacklist
                    ? 'Presente na Blacklist Permanente'
                    : `Detectado em ${Math.max(dados.grupos.length, totalGeral)} links (Limite permitido: ${limiteBan})`;

                console.log(`⛔ [BAN PERMANENTE] Lead ${dados.numero} (${dados.grupos.length} grupos em ${nomeCampanha} | Total: ${totalGeral}). Motivo: ${motivoBan}. Será removido de TODOS os grupos!`);
                adicionarEventoFeed('BAN_PERMANENTE', `⛔ Lead ${dados.numero} banido permanentemente (${dados.grupos.length} grps). Expulsando de TODOS os grupos sem exceção!`);

                if (!estaNaBlacklist(dados.numero)) {
                    cacheBlacklist.unshift({
                        numero: dados.numero,
                        numeroFormatado: formatarExibicao(dados.numero),
                        motivo: motivoBan,
                        dataBanimento: new Date().toISOString(),
                        totalGrupos: Math.max(dados.grupos.length, totalGeral)
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

    // Audita todas as campanhas ativas mapeadas
    for (const [idCampanha, mapaGrupos] of mapaGruposPorCampanha.entries()) {
        const listaGrupos = Array.from(mapaGrupos.values()).filter(g => g.participants && g.participants.length > 0);
        if (listaGrupos.length === 0) continue;

        const infoExemplo = obterInfoCompletaCampanha(listaGrupos[0].id, listaGrupos[0].subject);
        const nomeCampanha = infoExemplo ? infoExemplo.nomeCampanha : idCampanha;
        const presencaCampanha = obterPresencaCampanha(idCampanha);

        await auditarELimparCampanha(idCampanha, nomeCampanha, listaGrupos, presencaCampanha);
    }
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
// 🛑 FASE 2: CATRACA SENTINELA 24/7 (TODAS AS CAMPANHAS ATIVAS DO SENDFLOW)
// =====================================================================
function vincularListenersRealtime(sniper) {
    if (!sniper || !sniper.sock) return;
    if (sniper.listenerVinculado) return;
    sniper.listenerVinculado = true;

    sniper.sock.ev.on('group-participants.update', async (evento) => {
        if (evento.action !== 'add') return;

        const idGrupo = evento.id;
        let nomeGrupo = idGrupo;
        let infoCamp = obterInfoCompletaCampanha(idGrupo, null);

        if (!infoCamp) {
            try {
                const meta = await sniper.sock.groupMetadata(idGrupo);
                nomeGrupo = meta?.subject || idGrupo;
                infoCamp = obterInfoCompletaCampanha(idGrupo, nomeGrupo);
                if (infoCamp) {
                    const mapaGrupos = obterGruposCampanha(infoCamp.idCampanha);
                    if (!mapaGrupos.has(idGrupo)) mapaGrupos.set(idGrupo, meta);
                }
            } catch (e) { }
        } else {
            nomeGrupo = infoCamp.nomeGrupo || idGrupo;
        }

        // Se ainda não identificou pelo cache, herda a campanha do próprio sniper que recebeu o evento
        const metaSniper = obterMetaSniper(sniper.indice);
        if (!infoCamp && metaSniper && metaSniper.campaignId) {
            infoCamp = {
                idCampanha: metaSniper.campaignId,
                nomeCampanha: metaSniper.campaignName || 'Campanha do Sniper',
                nomeGrupo: nomeGrupo
            };
            const mapaGrupos = obterGruposCampanha(infoCamp.idCampanha);
            if (!mapaGrupos.has(idGrupo)) {
                mapaGrupos.set(idGrupo, { id: idGrupo, subject: nomeGrupo });
            }
        }

        // Se ainda assim for nulo, monitora em monitoramento geral
        if (!infoCamp) {
            infoCamp = {
                idCampanha: 'GLOBAL',
                nomeCampanha: 'Campanha Geral',
                nomeGrupo: nomeGrupo
            };
        }

        const idCampanha = infoCamp.idCampanha;
        const tagCampanha = infoCamp.nomeCampanha;
        const mapaPresencaAlvo = obterPresencaCampanha(idCampanha);

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

            // 🛡️ REGRA 2: IMUNIDADES (WHITELIST, ADMS DA CAMPANHA & ADMINS DO WHATSAPP)
            if (ehAdmDaCampanha(idCampanha, numReal) || ehAdmDaCampanha(idCampanha, idNorm)) {
                console.log(`👑 [CATRACA - ADM DA CAMPANHA] ${numReal} entrou em "${nomeGrupo}" (${tagCampanha}) [Imune por ser ADM desta Campanha].`);
                adicionarEventoFeed('ADMIN', `👑 ${formatarExibicao(numReal)} liberado em "${nomeGrupo}" (${tagCampanha}) [ADM da Campanha]`);
                continue;
            }

            if (estaNaWhitelist(numReal, snipersAtivos) || estaNaWhitelist(idNorm, snipersAtivos)) {
                console.log(`🛡️ [CATRACA - WHITELIST] ${numReal} entrou em "${nomeGrupo}" (Imune por Whitelist Geral).`);
                adicionarEventoFeed('WHITELIST', `🛡️ ${formatarExibicao(numReal)} liberado em "${nomeGrupo}" (Imune por Whitelist)`);
                continue;
            }

            if (adminsGlobais.has(numReal) || adminsGlobais.has(idNorm)) {
                console.log(`👑 [CATRACA - ADMIN] ${numReal} entrou em "${nomeGrupo}" (Imune por Cargo Admin).`);
                adicionarEventoFeed('ADMIN', `👑 ${formatarExibicao(numReal)} liberado em "${nomeGrupo}" (Imune por Cargo Admin)`);
                continue;
            }

            // 🐊 CHECAGEM CROCODILO KELVEN PREEXISTENTE
            // Regra: se o lead já é um Crocodilo Kelven, só tem permissão de estar no 1º grupo acessado.
            // Qualquer tentativa de entrar em outro grupo = EXPULSÃO IMEDIATA.
            const crocodiloExistente = obterCrocodilo(numReal, idCampanha);
            if (crocodiloExistente && crocodiloExistente.grupoMantido) {
                if (crocodiloExistente.grupoMantido.id !== idGrupo) {
                    console.log(`\n🐊 [CATRACA - CROCODILO BARRADO] ${numReal} é um Crocodilo Kelven!`);
                    console.log(`   Tentou entrar em: "${nomeGrupo}" (${tagCampanha})`);
                    console.log(`   Permitido exclusivamente no 1º grupo que acessou: "${crocodiloExistente.grupoMantido.nome}". EXPULSANDO DO NOVO GRUPO...`);
                    adicionarEventoFeed('ALERTA', `🐊 Crocodilo ${formatarExibicao(numReal)} barrado em "${nomeGrupo}"! Removido para permanecer apenas em seu 1º grupo ("${crocodiloExistente.grupoMantido.nome}").`);

                    // Atualiza histórico de tentativas barradas deste Crocodilo
                    registrarTentativaEntradaCrocodilo(crocodiloExistente, { id: idGrupo, subject: nomeGrupo });

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
                    continue;
                } else {
                    console.log(`🐊 [CATRACA - CROCODILO NO 1º GRUPO PERMITIDO] ${numReal} entrou em "${nomeGrupo}", que é o seu 1º grupo permitido.`);
                    adicionarEventoFeed('ALERTA', `🐊 Crocodilo ${formatarExibicao(numReal)} entrou em seu 1º grupo permitido ("${nomeGrupo}").`);
                    continue;
                }
            }

            // 📊 ATUALIZAÇÃO DA PRESENÇA NA CAMPANHA E GERAL
            if (!mapaPresencaAlvo.has(idNorm)) mapaPresencaAlvo.set(idNorm, new Set());
            const gruposDoLead = mapaPresencaAlvo.get(idNorm);
            gruposDoLead.add(idGrupo);

            const totalLinksGeral = calcularTotalGruposGeral(idNorm);

            configAtual = carregarConfig();
            const limiteMax = configAtual.limiteGruposPorCampanha;
            const limiteBan = configAtual.limiteBanPermanente;

            console.log(`🚪 [CATRACA] Lead ${numReal} entrou em "${nomeGrupo}" (${tagCampanha}). Presença na campanha: ${gruposDoLead.size}/${limiteMax} permitidos. Total de links geral: ${totalLinksGeral}.`);
            adicionarEventoFeed('ENTRADA', `🚪 Lead ${formatarExibicao(numReal)} entrou em "${nomeGrupo}" [${gruposDoLead.size}/${limiteMax} na campanha | Total geral: ${totalLinksGeral}]`);

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

                const todosGruposDoLead = obterTodosGruposDoLead(idNorm);
                todosGruposDoLead.add(idGrupo);

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

            // 🐊 REGRA 4: CROCODILOS KELVEN (> limiteMax, ex: > 4 grupos)
            // Regra do Usuário: "se eu estiver acima de 4 grupos, deve ser removido de todos os grupos,
            // ficando apenas o PRIMEIRO GRUPO QUE ELE ACESSOU, quando esse lead atingir esse limite,
            // ele entra na lista dos 'Crocodilo Kelven', e toda vez que tentar entrar em mais um grupo ele será removido."
            if (gruposDoLead.size > limiteMax) {
                const mapaGrupos = obterGruposCampanha(idCampanha);
                const listaGruposDoLead = Array.from(gruposDoLead).map(gid => {
                    const g = mapaGrupos.get(gid);
                    return {
                        id: gid,
                        subject: g?.subject || obterNomeGrupo(gid) || gid,
                        creation: g?.creation || 0
                    };
                });

                // Ordenação inteligente para garantir que o 1º grupo que ele acessou seja mantido:
                // 1) O grupo recém-entrado agora (idGrupo) vai para o final porque foi o último grupo onde ele entrou!
                // 2) Se houver datas de criação válidas e diferentes, pega a mais antiga
                // 3) Desempate por ordenação alfanumérica natural do nome (ex: Grupo 01 antes de Grupo 02)
                listaGruposDoLead.sort((a, b) => {
                    if (a.id === idGrupo && b.id !== idGrupo) return 1;
                    if (b.id === idGrupo && a.id !== idGrupo) return -1;
                    if (a.creation && b.creation && a.creation !== b.creation) {
                        return a.creation - b.creation;
                    }
                    return a.subject.localeCompare(b.subject, undefined, { numeric: true });
                });

                const primeiroGrupo = listaGruposDoLead[0];
                const gruposParaRemover = listaGruposDoLead.slice(1);

                console.log(`\n🐊 [ALERTA CATRACA - CROCODILO KELVEN] Lead ${numReal} atingiu ${gruposDoLead.size} grupos em ${tagCampanha} (> limite ${limiteMax})!`);
                console.log(`   ✅ Mantendo APENAS o 1º grupo acessado: "${primeiroGrupo.subject}"`);
                console.log(`   🔴 Expulsando de TODOS os outros ${gruposParaRemover.length} grupos excedentes...`);
                adicionarEventoFeed('ALERTA', `🐊 Crocodilo Kelven! Lead ${formatarExibicao(numReal)} atingiu ${gruposDoLead.size} grupos em ${tagCampanha}. Mantido apenas no 1º grupo ("${primeiroGrupo.subject}") e expulso dos demais!`);

                registrarCrocodilo({
                    numero: numReal,
                    idCampanha,
                    nomeCampanha: tagCampanha,
                    grupoMantido: primeiroGrupo,
                    gruposRemovidos: gruposParaRemover
                });

                // Mantém na presença em RAM apenas o 1º grupo
                gruposDoLead.clear();
                gruposDoLead.add(primeiroGrupo.id);

                // Dispara expulsão de todos os grupos excedentes (incluindo o idGrupo e os outros)
                for (const grp of gruposParaRemover) {
                    enfileirarKickRealtime({
                        idGrupo: grp.id,
                        nomeGrupo: grp.subject,
                        tagCampanha,
                        numReal,
                        idNorm,
                        jidsParaTentar,
                        mapaPresencaAlvo,
                        ehBanPermanente: false
                    });
                }
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
    console.log('🛡️  MOTOR UNIFICADO AEGIS: TODAS AS CAMPANHAS ATIVAS DO SENDFLOW');
    console.log(`📌  Configuração Atual: Máx. ${configAtual.limiteGruposPorCampanha} Grupos por pessoa na mesma campanha | Ban Permanente: > ${configAtual.limiteBanPermanente} links`);
    console.log(`🤖  Frota de ADMs (Administradores dos Grupos): ${qtdAdms} contas configuradas`);
    console.log('=================================================================\n');

    // 1. Carregar campanhas e grupos locais do cache (protegendo a chave de API do SendFlow contra rate-limit no boot)
    carregarCampanhasLocais();
    iniciarAgendamento12Horas();

    const snipersCadastrados = carregarSnipersCampanhas();
    console.log(`[+] Conectando frota de ${snipersCadastrados.length} Administradores Snipers distribuídos por campanha...`);
    for (const s of snipersCadastrados) {
        const idNum = Number(s.id || s.indice);
        await conectarSniper(idNum);
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
    console.log('🟢 [SENTINELA ATIVO 24/7] VIGIANDO TODAS AS CAMPANHAS ATIVAS DO SENDFLOW!');
    console.log(`   • Tolerância de Saturação: até ${configAtual.limiteGruposPorCampanha} grupos por campanha.`);
    console.log(`   • Ban Permanente Automático: acima de ${configAtual.limiteBanPermanente} links = Remoção total sem exceção.`);
    console.log('   • Verificação periódica automática de grupos: a cada 12 horas.');
    console.log('   • ADMs por campanha e Whitelist 100% protegidos.');
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
    obterStatusAdmsPorCampanha,
    adicionarSniperCampanha,
    removerSniperCampanha,
    carregarSnipersCampanhas,
    conectarSniper,
    conectarAdmManual,
    desconectarAdm,
    carregarCrocodilos,
    salvarCrocodilos,
    obterCrocodilo,
    registrarCrocodilo,
    removerCrocodilo,
    auditarSaturacaoECrocodilos,
    autoSalvarBackupSessoes,
    DATA_DIR,
    // Aliases para compatibilidade total
    obterStatusEspioes: obterStatusAdms,
    conectarEspiaoManual: conectarAdmManual,
    desconectarEspiao: desconectarAdm
};
