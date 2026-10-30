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
    'no session found to decrypt', 'libsignal', '_chains', 'currentRatchet',
    'Timed Out', 'rate-overlimit', 'Connection Closed', 'Stream Errored (conflict)', 'conflict'
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

    return null;
}

function obterInfoCompletaCampanha(idGrupo, subject, participantsAmount = 0) {
    // 1. Consulta diretamente a base de grupos vinculados nas campanhas ativas do SendFlow
    const info = obterInfoGrupoCampanha(idGrupo, subject, participantsAmount);
    if (info) {
        return {
            idCampanha: info.releaseId,
            nomeCampanha: info.nomeCampanha,
            nomeGrupo: info.nomeGrupo || subject || idGrupo
        };
    }

    // 2. Se idGrupo já estava mapeado em memória mas sem subject na chamada atual, verifica se o grupo mapeado pertence ao SendFlow
    if (idGrupo && !subject && mapaGruposPorCampanha.size > 0) {
        for (const [idCamp, grps] of mapaGruposPorCampanha.entries()) {
            if (grps.has(idGrupo)) {
                const g = grps.get(idGrupo);
                const recheck = obterInfoGrupoCampanha(idGrupo, g?.subject, g?.participants?.length || participantsAmount);
                if (recheck) {
                    return {
                        idCampanha: recheck.releaseId,
                        nomeCampanha: recheck.nomeCampanha,
                        nomeGrupo: recheck.nomeGrupo || g?.subject || idGrupo
                    };
                } else {
                    // Grupo não está mais vinculado ao SendFlow; remove da memória ativa
                    grps.delete(idGrupo);
                }
            }
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

const mapaLidParaTelefone = new Map(); // lidLimpo -> telefoneLimpo
const mapaTelefoneParaLids = new Map(); // idNorm -> Set<lidJid>

function registrarMapeamentoLid(p) {
    if (!p || typeof p !== 'object') return;
    const candidatosLid = [p.lid, p.id, p.jid].filter(v => v && String(v).includes('@lid'));
    const candidatosTel = [
        p.phoneNumber,
        (p.jid && String(p.jid).includes('@s.whatsapp.net')) ? p.jid : null,
        (p.id && String(p.id).includes('@s.whatsapp.net')) ? p.id : null
    ].filter(Boolean);

    if (candidatosLid.length === 0 || candidatosTel.length === 0) return;

    const telLimpo = extrairNumeroLimpo(candidatosTel[0]);
    const idNorm = normalizarID(telLimpo);
    if (!telLimpo || !idNorm) return;

    for (const rawLid of candidatosLid) {
        const lidLimpo = extrairNumeroLimpo(rawLid);
        if (!lidLimpo) continue;
        mapaLidParaTelefone.set(lidLimpo, telLimpo);
        if (!mapaTelefoneParaLids.has(idNorm)) mapaTelefoneParaLids.set(idNorm, new Set());
        mapaTelefoneParaLids.get(idNorm).add(`${lidLimpo}@lid`);

        // Se algum grupo já havia sido registrado sob o LID puro antes da descoberta do telefone real, unifica imediatamente no idNorm!
        const lidNorm = normalizarID(lidLimpo);
        for (const mapaPresenca of mapaPresencaPorCampanha.values()) {
            for (const chaveAntiga of [lidLimpo, lidNorm]) {
                if (chaveAntiga && chaveAntiga !== idNorm && mapaPresenca.has(chaveAntiga)) {
                    const grpsAntigos = mapaPresenca.get(chaveAntiga);
                    if (!mapaPresenca.has(idNorm)) mapaPresenca.set(idNorm, new Set());
                    const grpsReais = mapaPresenca.get(idNorm);
                    for (const gid of grpsAntigos) grpsReais.add(gid);
                    mapaPresenca.delete(chaveAntiga);
                }
            }
        }
    }
}

function extrairNumeroParticipante(p) {
    if (!p) return "";
    if (typeof p === 'string') {
        const limpo = extrairNumeroLimpo(p);
        return mapaLidParaTelefone.get(limpo) || limpo;
    }
    registrarMapeamentoLid(p);
    if (p.phoneNumber) {
        const n = extrairNumeroLimpo(p.phoneNumber);
        if (n) return n;
    }
    if (p.jid && String(p.jid).includes('@s.whatsapp.net')) return extrairNumeroLimpo(p.jid);
    if (p.id && String(p.id).includes('@s.whatsapp.net')) return extrairNumeroLimpo(p.id);
    const bruto = extrairNumeroLimpo(p.id || p.jid || p.lid || "");
    if (bruto && mapaLidParaTelefone.has(bruto)) {
        return mapaLidParaTelefone.get(bruto);
    }
    return bruto;
}

function gerarVariantesJidTelefone(numReal) {
    const limpo = extrairNumeroLimpo(numReal);
    if (!limpo) return [];
    const variantes = new Set([`${limpo}@s.whatsapp.net`]);
    // Para números do Brasil (55 + DDD + 8 ou 9 dígitos), gera variante com e sem o 9º dígito
    if (limpo.startsWith('55') && limpo.length === 13 && limpo[4] === '9') {
        const sem9 = limpo.substring(0, 4) + limpo.substring(5);
        variantes.add(`${sem9}@s.whatsapp.net`);
    } else if (limpo.startsWith('55') && limpo.length === 12) {
        const com9 = limpo.substring(0, 4) + '9' + limpo.substring(4);
        variantes.add(`${com9}@s.whatsapp.net`);
    }
    return Array.from(variantes);
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
    let crocodiloSemCampanha = null;
    for (const c of cacheCrocodilos) {
        const cNum = extrairNumeroLimpo(c.numero);
        const matchNum = cNum === numLimpo || (idNorm && normalizarID(cNum) === idNorm) ||
            (numLimpo.length >= 10 && cNum.length >= 10 && (cNum.includes(numLimpo) || numLimpo.includes(cNum)));

        if (matchNum) {
            // Se idCampanha foi informado, prioriza registro da mesma campanha
            if (idCampanha) {
                if (c.idCampanha === idCampanha) return c;
                if (!c.idCampanha && !crocodiloSemCampanha) crocodiloSemCampanha = c;
            } else {
                return c;
            }
        }
    }

    return crocodiloSemCampanha;
}

function registrarCrocodilo({ numero, idCampanha, nomeCampanha, grupoMantido, gruposRemovidos }) {
    const numLimpo = extrairNumeroLimpo(numero);
    const idNorm = normalizarID(numLimpo);
    let lista = carregarCrocodilos();

    const idx = lista.findIndex(c => {
        const cNum = extrairNumeroLimpo(c.numero);
        const matchNum = cNum === numLimpo || (idNorm && normalizarID(cNum) === idNorm) ||
            (numLimpo.length >= 10 && cNum.length >= 10 && (cNum.includes(numLimpo) || numLimpo.includes(cNum)));
        if (!matchNum) return false;
        if (idCampanha && c.idCampanha) return c.idCampanha === idCampanha;
        return true;
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
            nome: grupoMantido.subject || grupoTentadoNome(grupoMantido),
            mantidoDesde: new Date().toISOString()
        },
        gruposRemovidos: listaRemovidos,
        totalGruposTentados: listaRemovidos.length + 1,
        dataIdentificacao: new Date().toISOString(),
        ultimaTentativaBloqueada: null
    };

    if (idx !== -1) {
        // Se já existia para esta campanha, preserva o grupo mantido original caso já definido
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

function grupoTentadoNome(g) {
    return g?.subject || g?.nome || g?.id || 'Grupo';
}

function registrarTentativaEntradaCrocodilo(crocodilo, grupoTentado) {
    if (!crocodilo || !grupoTentado) return;
    try {
        let lista = carregarCrocodilos();
        const numLimpo = extrairNumeroLimpo(crocodilo.numero);
        const idNorm = normalizarID(numLimpo);

        const item = lista.find(c => {
            const cNum = extrairNumeroLimpo(c.numero);
            const matchNum = cNum === numLimpo || (idNorm && normalizarID(cNum) === idNorm);
            if (!matchNum) return false;
            if (crocodilo.idCampanha && c.idCampanha) return c.idCampanha === crocodilo.idCampanha;
            return true;
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
const socketsAtivosPorIndice = new Map(); // indice -> socket Baileys ativo
const conexoesEmAndamento = new Map(); // indice -> Promise em voo
const contadoresConflito440 = new Map(); // indice -> { count, lastTs }

function agendarReconexao(indice, ms = 3000) {
    cancelarReconexao(indice);
    const delayStagger = Math.max(ms, 3000) + ((Math.max(1, indice) - 1) * 2500) + Math.floor(Math.random() * 2000);
    const t = setTimeout(() => {
        timersReconexao.delete(indice);
        conectarSniper(indice).catch(() => {});
    }, delayStagger);
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
const kicksEmAndamento = new Set(); // `${idGrupo}-${idNorm}`

function obterNomeGrupo(idGrupo) {
    for (const grps of mapaGruposPorCampanha.values()) {
        if (grps.has(idGrupo)) return grps.get(idGrupo).subject;
    }
    const info = obterInfoGrupoCampanha(idGrupo);
    if (info && info.nomeGrupo) return info.nomeGrupo;
    return idGrupo;
}

function sniperEstaOperacional(s) {
    return Boolean(s && s.conectado && s.sock && s.sock.user && s.sock.ws?.isOpen !== false);
}

const cooldownRateLimitSniper = new Map(); // indice -> timestamp (ms) até quando está em pausa
const cacheMetaEmVoo = new Map(); // idGrupo -> Promise<meta>
const cacheMetaRecente = new Map(); // idGrupo -> { meta, ts }

async function obterMetadataGrupoResiliente(idGrupo, sniperPreferencial = null) {
    const agora = Date.now();
    const recente = cacheMetaRecente.get(idGrupo);
    if (recente && (agora - recente.ts) < 15000) {
        return recente.meta;
    }
    if (cacheMetaEmVoo.has(idGrupo)) {
        return cacheMetaEmVoo.get(idGrupo);
    }

    const promessa = (async () => {
        const registrarMeta = (meta) => {
            if (meta && Array.isArray(meta.participants)) {
                for (const p of meta.participants) registrarMapeamentoLid(p);
                cacheMetaRecente.set(idGrupo, { meta, ts: Date.now() });
            }
            return meta;
        };

        const sniperPodeConsultar = (s) => {
            if (!sniperEstaOperacional(s)) return false;
            const ate = cooldownRateLimitSniper.get(s.indice);
            if (ate && Date.now() < ate) return false;
            return true;
        };

        if (sniperPreferencial && sniperPodeConsultar(sniperPreferencial)) {
            try {
                const meta = await sniperPreferencial.sock.groupMetadata(idGrupo);
                if (meta) return registrarMeta(meta);
            } catch (e) {
                if (/rate-overlimit|429/i.test(e?.message)) {
                    cooldownRateLimitSniper.set(sniperPreferencial.indice, Date.now() + 10 * 60 * 1000);
                }
            }
        }
        const candidatos = obterSnipersDisponiveis(idGrupo);
        for (const s of candidatos) {
            if (sniperPreferencial && s.indice === sniperPreferencial.indice) continue;
            if (!sniperPodeConsultar(s)) continue;
            try {
                const meta = await s.sock.groupMetadata(idGrupo);
                if (meta) return registrarMeta(meta);
            } catch (e) {
                if (/rate-overlimit|429/i.test(e?.message)) {
                    cooldownRateLimitSniper.set(s.indice, Date.now() + 10 * 60 * 1000);
                }
            }
        }
        return null;
    })();

    cacheMetaEmVoo.set(idGrupo, promessa);
    try {
        return await promessa;
    } finally {
        cacheMetaEmVoo.delete(idGrupo);
    }
}

// Obtém todos os JIDs reais possíveis do lead DENTRO do grupo alvo (incluindo o p.id / @lid real daquele grupo)
function obterJidsParaExpulsaoNoGrupo(idGrupo, numReal, idNorm, jidsExtras = []) {
    const jids = new Set();
    const lidsConhecidos = mapaTelefoneParaLids.get(idNorm) || new Set();

    // 1. Procura o participante exato dentro da estrutura em memória daquele grupo específico
    for (const grps of mapaGruposPorCampanha.values()) {
        if (!grps.has(idGrupo)) continue;
        const g = grps.get(idGrupo);
        for (const p of (g.participants || [])) {
            const pNum = extrairNumeroParticipante(p);
            const pNorm = normalizarID(pNum);
            const pId = p.id || '';
            const pLid = p.lid || '';
            if ((idNorm && pNorm === idNorm) || (numReal && pNum === numReal) || lidsConhecidos.has(pId) || lidsConhecidos.has(pLid)) {
                if (p.id && p.id.includes('@')) jids.add(p.id);
                if (p.jid && p.jid.includes('@')) jids.add(p.jid);
                if (p.lid && p.lid.includes('@')) jids.add(p.lid);
                if (p.phoneNumber && String(p.phoneNumber).includes('@')) jids.add(p.phoneNumber);
            }
        }
    }

    // 2. Adiciona JIDs extras fornecidos pelo evento em tempo real (priorizando JIDs reais)
    for (const j of (jidsExtras || [])) {
        if (j && String(j).includes('@')) {
            // Evita colocar telefone@lid falso na frente dos JIDs reais
            if (String(j).endsWith('@lid') && numReal && String(j).startsWith(numReal) && numReal.startsWith('55') && numReal.length >= 12) {
                continue;
            }
            jids.add(j);
        }
    }

    // 3. Adiciona todos os @lid reais já mapeados para este telefone em qualquer grupo
    for (const lidJid of lidsConhecidos) {
        jids.add(lidJid);
    }

    // 4. Adiciona variantes @s.whatsapp.net (com e sem 9º dígito para números BR)
    for (const varJid of gerarVariantesJidTelefone(numReal)) {
        jids.add(varJid);
    }

    // 5. Fallback final caso numReal seja um LID puro ainda não associado a telefone
    if (numReal) {
        jids.add(`${numReal}@lid`);
    }

    return Array.from(jids);
}

function removerParticipanteDaMemoriaDoGrupo(idGrupo, numReal, idNorm) {
    if (idNorm) {
        travasRedundancia.delete(`${idGrupo}-${idNorm}`);
    }
    const lidsConhecidos = mapaTelefoneParaLids.get(idNorm) || new Set();
    for (const [idCamp, grps] of mapaGruposPorCampanha.entries()) {
        if (grps.has(idGrupo)) {
            const g = grps.get(idGrupo);
            if (Array.isArray(g.participants)) {
                g.participants = g.participants.filter(p => {
                    const pNum = extrairNumeroParticipante(p);
                    const pNorm = normalizarID(pNum);
                    if ((idNorm && pNorm === idNorm) || (numReal && pNum === numReal)) return false;
                    if (lidsConhecidos.has(p.id) || lidsConhecidos.has(p.lid)) return false;
                    return true;
                });
            }
        }
        const presenca = mapaPresencaPorCampanha.get(idCamp);
        if (presenca && idNorm) {
            presenca.get(idNorm)?.delete(idGrupo);
        }
    }
}

// Executa a expulsão no WhatsApp VALIDANDO o status individual retornado pelo Baileys (200 = removido de fato)
async function executarRemocaoConfirmadaNoGrupo(operador, idGrupo, numReal, idNorm, jidsIniciais = []) {
    const jidsParaTentar = obterJidsParaExpulsaoNoGrupo(idGrupo, numReal, idNorm, jidsIniciais);
    let ultimoErro = 'JID não localizado no grupo';

    for (const jidAlvo of jidsParaTentar) {
        try {
            const res = await operador.sock.groupParticipantsUpdate(idGrupo, [jidAlvo], 'remove');
            const statusItem = (Array.isArray(res) && res.length > 0) ? String(res[0]?.status || '200') : '200';

            if (statusItem === '200') {
                removerParticipanteDaMemoriaDoGrupo(idGrupo, numReal, idNorm);
                return { sucesso: true, status: '200', jidUsado: jidAlvo };
            }

            if (statusItem === '403' || statusItem === '401') {
                return { sucesso: false, semPermissao: true, status: statusItem, erro: `ADM sem permissão no grupo (Status ${statusItem})` };
            }

            ultimoErro = `WhatsApp retornou status ${statusItem} para ${jidAlvo}`;
        } catch (err) {
            const msg = err?.message || String(err);
            ultimoErro = msg;
            if (/forbidden|not-authorized|403|401/i.test(msg)) {
                return { sucesso: false, semPermissao: true, erro: msg };
            }
            if (/connection closed|websocket|timed out|closed/i.test(msg)) {
                return { sucesso: false, erroConexao: true, erro: msg };
            }
        }
    }

    // Se todos os JIDs em cache retornaram 404/400, consulta o groupMetadata ao vivo no WhatsApp para descobrir o p.id exato atual ou confirmar se já saiu!
    try {
        const metaVivo = await operador.sock.groupMetadata(idGrupo);
        if (metaVivo && Array.isArray(metaVivo.participants)) {
            for (const p of metaVivo.participants) registrarMapeamentoLid(p);
            for (const grps of mapaGruposPorCampanha.values()) {
                if (grps.has(idGrupo)) grps.set(idGrupo, metaVivo);
            }

            const lidsConhecidos = mapaTelefoneParaLids.get(idNorm) || new Set();
            const pVivo = metaVivo.participants.find(p => {
                const pNum = extrairNumeroParticipante(p);
                const pNorm = normalizarID(pNum);
                return (idNorm && pNorm === idNorm) || (numReal && pNum === numReal) || lidsConhecidos.has(p.id) || lidsConhecidos.has(p.lid);
            });

            if (!pVivo) {
                // O lead já não está mais presente na lista oficial de participantes do grupo no WhatsApp!
                removerParticipanteDaMemoriaDoGrupo(idGrupo, numReal, idNorm);
                return { sucesso: true, status: '200', jaEstavaFora: true };
            }

            if (pVivo.id) {
                const resVivo = await operador.sock.groupParticipantsUpdate(idGrupo, [pVivo.id], 'remove');
                const stVivo = (Array.isArray(resVivo) && resVivo.length > 0) ? String(resVivo[0]?.status || '200') : '200';
                if (stVivo === '200') {
                    removerParticipanteDaMemoriaDoGrupo(idGrupo, numReal, idNorm);
                    return { sucesso: true, status: '200', jidUsado: pVivo.id };
                }
                if (stVivo === '403' || stVivo === '401') {
                    return { sucesso: false, semPermissao: true, status: stVivo, erro: `ADM sem permissão para remover ${pVivo.id} (Status ${stVivo})` };
                }
                ultimoErro = `Status ${stVivo} ao remover JID ao vivo ${pVivo.id}`;
            }
        }
    } catch (e) { }

    return { sucesso: false, erro: ultimoErro };
}

let rotadorSnipers = 0;

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

    const operacionais = snipersAtivos.filter(sniperEstaOperacional);
    if (operacionais.length === 0) return [];

    rotadorSnipers++;
    const indicesAdminNoGrupo = mapaAdminGrupos.get(idGrupo) || new Set();
    const ordenados = [];
    const jaAdicionados = new Set();

    const adicionarListaRotacionada = (lista) => {
        if (!lista || lista.length === 0) return;
        const offset = rotadorSnipers % lista.length;
        for (let i = 0; i < lista.length; i++) {
            const s = lista[(offset + i) % lista.length];
            if (!jaAdicionados.has(s.indice)) {
                jaAdicionados.add(s.indice);
                ordenados.push(s);
            }
        }
    };

    // 1. Prioridade Máxima: ADMs da campanha que são admins confirmados no grupo (rotacionados entre si)
    if (campaignId) {
        adicionarListaRotacionada(operacionais.filter(s => {
            const meta = obterMetaSniper(s.indice);
            return meta && meta.campaignId === campaignId && indicesAdminNoGrupo.has(s.indice);
        }));
    }

    // 2. Prioridade Alta: Qualquer outro ADM operacional que seja admin confirmado no grupo (Failover imediato se o ADM titular cair/for banido)
    adicionarListaRotacionada(operacionais.filter(s => indicesAdminNoGrupo.has(s.indice)));

    // 3. Prioridade Média: Demais ADMs vinculados à campanha
    if (campaignId) {
        adicionarListaRotacionada(operacionais.filter(s => {
            const meta = obterMetaSniper(s.indice);
            return meta && meta.campaignId === campaignId;
        }));
    }

    // 4. Fallback Total: Qualquer outro ADM operacional conectado
    adicionarListaRotacionada(operacionais);

    return ordenados;
}

// =====================================================================
// 📋 AUTO-MAPEAMENTO DE GRUPOS E ADMS VIA WHATSAPP (ESTRITAMENTE SENDFLOW)
// =====================================================================
const ultimoMapeamentoPorSniper = new Map(); // indice -> timestamp
const mapeamentoEmAndamento = new Set(); // Set<indice>
const INTERVALO_MINIMO_MAPEAMENTO_MS = 15 * 60 * 1000; // 15 minutos de cache mínimo por ADM

// Fila serializada anti-rate-limit para mapeamento de grupos
let filaMapeamento = [];
let processandoFilaMapeamento = false;
let ultimoMapeamentoGlobalTs = 0;
const INTERVALO_MINIMO_GLOBAL_MAPEAMENTO_MS = 20_000; // 20s de respiro global entre consultas de grupos no WhatsApp

async function enfileirarMapeamentoSniper(sniperObj, forcar = false) {
    if (!sniperObj || !sniperEstaOperacional(sniperObj)) return;
    const indice = sniperObj.indice;

    if (cooldownRateLimitSniper.has(indice) && Date.now() < cooldownRateLimitSniper.get(indice)) {
        return;
    }

    if (!forcar && ultimoMapeamentoPorSniper.has(indice)) {
        const decorrido = Date.now() - ultimoMapeamentoPorSniper.get(indice);
        if (decorrido < INTERVALO_MINIMO_MAPEAMENTO_MS) {
            return;
        }
    }

    if (!filaMapeamento.some(item => item.indice === indice)) {
        filaMapeamento.push({ sniperObj, indice, forcar });
    }

    if (!processandoFilaMapeamento) {
        processarFilaMapeamento().catch(() => {});
    }
}

async function processarFilaMapeamento() {
    if (processandoFilaMapeamento) return;
    processandoFilaMapeamento = true;
    try {
        while (filaMapeamento.length > 0) {
            const item = filaMapeamento.shift();
            if (item && item.sniperObj && sniperEstaOperacional(item.sniperObj)) {
                const tempoDesdeUltimo = Date.now() - ultimoMapeamentoGlobalTs;
                if (tempoDesdeUltimo < INTERVALO_MINIMO_GLOBAL_MAPEAMENTO_MS) {
                    await sleep(INTERVALO_MINIMO_GLOBAL_MAPEAMENTO_MS - tempoDesdeUltimo);
                }
                await executarMapeamentoDiretoDoSniper(item.sniperObj, item.forcar);
                ultimoMapeamentoGlobalTs = Date.now();
                if (filaMapeamento.length > 0) {
                    await sleep(15000); // 15s de respiro seguro entre diferentes ADMs
                }
            }
        }
    } finally {
        processandoFilaMapeamento = false;
    }
}

async function executarMapeamentoDiretoDoSniper(sniperObj, forcar = false) {
    if (!sniperObj || !sniperEstaOperacional(sniperObj)) return;
    const indice = sniperObj.indice;

    // Se está em cooldown de rate-limit do WhatsApp, não repete consultas para evitar bloqueio
    if (cooldownRateLimitSniper.has(indice)) {
        const ate = cooldownRateLimitSniper.get(indice);
        if (Date.now() < ate) {
            return;
        } else {
            cooldownRateLimitSniper.delete(indice);
        }
    }

    // Se não for forçado, respeita o cache mínimo de 15 minutos por ADM
    if (!forcar && ultimoMapeamentoPorSniper.has(indice)) {
        const decorrido = Date.now() - ultimoMapeamentoPorSniper.get(indice);
        if (decorrido < INTERVALO_MINIMO_MAPEAMENTO_MS) {
            return;
        }
    }

    if (mapeamentoEmAndamento.has(indice)) return;
    mapeamentoEmAndamento.add(indice);

    try {
        const metaSniper = obterMetaSniper(indice);
        const campaignName = metaSniper?.campaignName || 'Campanha SendFlow';

        console.log(`[🔍 ADM 0${indice}] Mapeando grupos vinculados ao SendFlow via WhatsApp...`);
        const allGroups = await sniperObj.sock.groupFetchAllParticipating();
        const groupIds = Object.keys(allGroups);

        ultimoMapeamentoPorSniper.set(indice, Date.now());
        cooldownRateLimitSniper.delete(indice);

        let gruposMapeados = 0;
        let gruposIgnorados = 0;
        const campanhasAfetadas = new Set();
        const meuNum = extrairNumeroLimpo(sniperObj.sock.user?.id);

        // PASSO 1: Registra todos os mapeamentos @lid <-> Telefone em todos os grupos antes de contabilizar presença
        const gruposValidos = [];
        for (const gid of groupIds) {
            const g = allGroups[gid];
            const infoCamp = obterInfoCompletaCampanha(gid, g.subject, g.participants?.length || 0);
            if (!infoCamp || !infoCamp.idCampanha) {
                gruposIgnorados++;
                continue;
            }
            for (const p of (g.participants || [])) {
                registrarMapeamentoLid(p);
            }
            gruposValidos.push({ gid, g, infoCamp });
        }

        // PASSO 2: Atualiza grupos e reconcilia presença com 100% dos LIDs já unificados aos telefones reais
        for (const { gid, g, infoCamp } of gruposValidos) {
            const idCamp = infoCamp.idCampanha;
            const nomeCamp = infoCamp.nomeCampanha;
            campanhasAfetadas.add(idCamp);

            if (!mapaInfoCampanhas.has(idCamp)) {
                mapaInfoCampanhas.set(idCamp, { id: idCamp, name: nomeCamp });
            }

            const mapaGrupos = obterGruposCampanha(idCamp);
            mapaGrupos.set(gid, g);
            gruposMapeados++;

            const mapaPresenca = obterPresencaCampanha(idCamp);
            // Limpa a presença antiga deste grupo específico antes de repopular com a fotografia atualizada do WhatsApp
            for (const setG of mapaPresenca.values()) {
                setG.delete(gid);
            }

            for (const p of (g.participants || [])) {
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

            // Registra as permissões de admin de TODOS os ADMs ativos neste grupo de uma só vez
            for (const s of snipersAtivos) {
                const sNum = extrairNumeroLimpo(s.sock?.user?.id);
                if (!sNum) continue;
                const sPart = g.participants?.find(p => {
                    const pNum = extrairNumeroParticipante(p);
                    return pNum && (sNum === pNum || normalizarID(sNum) === normalizarID(pNum));
                });
                if (sPart && (sPart.admin === 'admin' || sPart.admin === 'superadmin')) {
                    if (!mapaAdminGrupos.has(gid)) mapaAdminGrupos.set(gid, new Set());
                    mapaAdminGrupos.get(gid).add(s.indice);
                } else if (sPart) {
                    mapaAdminGrupos.get(gid)?.delete(s.indice);
                }
            }
        }

        console.log(`[✅ ADM 0${indice}] ${gruposMapeados} grupos do SendFlow sincronizados (${gruposIgnorados} grupos antigos/externos ignorados).`);
        adicionarEventoFeed('ADM', `✅ ADM 0${indice}: ${gruposMapeados} grupos do SendFlow em vigilância (${gruposIgnorados} grupos antigos ignorados)`);

        for (const idCamp of campanhasAfetadas) {
            await auditarSaturacaoECrocodilos(idCamp);
        }
    } catch (err) {
        const msg = err?.message || String(err);
        const ehRateLimit = /rate-overlimit|rate.*limit|429/i.test(msg) || err?.output?.statusCode === 429;
        if (ehRateLimit) {
            cooldownRateLimitSniper.set(indice, Date.now() + 10 * 60 * 1000); // 10 min de pausa de consultas
            console.warn(`[⏳ ADM 0${indice}] WhatsApp em pausa de consultas (rate-overlimit 429). Cooldown de 10 min ativado. O Sentinela em tempo real segue 100% ativo!`);
        } else {
            console.error(`[!] Erro ao mapear grupos do ADM 0${indice}:`, msg);
        }
    } finally {
        mapeamentoEmAndamento.delete(indice);
    }
}

async function mapearGruposDoSniper(sniperObj, forcar = false) {
    return enfileirarMapeamentoSniper(sniperObj, forcar);
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
// 🔒 AUDITORIA DE LEADS RESTRITOS, BLACKLIST & SATURAÇÃO
// Regra: Acima do limite de grupos (ex: > 4), é removido de todos os
// grupos excedentes, mantendo APENAS o 1º grupo acessado, e fica Restrito.
// =====================================================================
async function auditarSaturacaoECrocodilos(idCampanha) {
    if (!idCampanha) return;
    configAtual = carregarConfig();
    const limiteMax = configAtual.limiteGruposPorCampanha || 4;
    const limiteBan = configAtual.limiteBanPermanente || 10;
    const mapaPresenca = obterPresencaCampanha(idCampanha);
    const mapaGrupos = obterGruposCampanha(idCampanha);
    const nomeCampanha = mapaInfoCampanhas.get(idCampanha)?.name || idCampanha;

    // Remove da memória quaisquer grupos que não estejam mais vinculados ao SendFlow
    for (const gid of Array.from(mapaGrupos.keys())) {
        const g = mapaGrupos.get(gid);
        if (!obterInfoGrupoCampanha(gid, g?.subject)) {
            mapaGrupos.delete(gid);
            for (const setG of mapaPresenca.values()) {
                setG.delete(gid);
            }
        }
    }

    // Reconciliação em 2 passos (1: unifica todos os @lid <-> telefone; 2: garante que mapaPresenca reflita todos os grupos atuais)
    for (const g of mapaGrupos.values()) {
        for (const p of (g.participants || [])) {
            registrarMapeamentoLid(p);
        }
    }
    for (const [gid, g] of mapaGrupos.entries()) {
        for (const p of (g.participants || [])) {
            const pNum = extrairNumeroParticipante(p);
            if (!pNum) continue;
            const idN = normalizarID(pNum);
            if (!idN) continue;
            if (!mapaPresenca.has(idN)) mapaPresenca.set(idN, new Set());
            mapaPresenca.get(idN).add(gid);
        }
    }

    let restritosTratados = 0;

    for (const [idNorm, setGrupos] of Array.from(mapaPresenca.entries())) {
        if (!setGrupos || setGrupos.size === 0) continue;

        // Recupera o número real e JID do participante
        let numReal = null;
        let jidOriginal = null;
        const lidsConhecidos = mapaTelefoneParaLids.get(idNorm) || new Set();
        for (const gid of setGrupos) {
            const g = mapaGrupos.get(gid);
            const p = g?.participants?.find(part => {
                const n = extrairNumeroParticipante(part);
                return (n && normalizarID(n) === idNorm) || lidsConhecidos.has(part.id) || lidsConhecidos.has(part.lid);
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

        // REGRA 1: Ban Permanente (Blacklist ou > limiteBan) — vale mesmo que esteja em 1 único grupo!
        if (totalLinksGeral > limiteBan || setGrupos.size > limiteBan || estaNaBlacklist(numReal) || estaNaBlacklist(idNorm)) {
            console.log(`⛔ [AUDITORIA - BAN PERMANENTE] Lead ${numReal} detectado em ${setGrupos.size} grupo(s) de "${nomeCampanha}"! Removendo de TODOS.`);
            adicionarEventoFeed('BAN_PERMANENTE', `⛔ Lead ${formatarExibicao(numReal)} banido permanentemente! Expulsando de todos os grupos.`);

            if (!estaNaBlacklist(numReal)) {
                cacheBlacklist.unshift({
                    numero: numReal,
                    numeroFormatado: formatarExibicao(numReal),
                    motivo: `Encontrado em ${Math.max(setGrupos.size, totalLinksGeral)} grupos no escaneamento (Limite permitido: ${limiteBan})`,
                    dataBanimento: new Date().toISOString(),
                    totalGrupos: Math.max(setGrupos.size, totalLinksGeral)
                });
                salvarBlacklist(cacheBlacklist);
            }

            for (const gid of Array.from(setGrupos)) {
                enfileirarKickRealtime({
                    idGrupo: gid,
                    nomeGrupo: obterNomeGrupo(gid),
                    tagCampanha: nomeCampanha,
                    numReal,
                    idNorm,
                    jidsParaTentar: obterJidsParaExpulsaoNoGrupo(gid, numReal, idNorm, [jidOriginal]),
                    mapaPresencaAlvo: mapaPresenca,
                    ehBanPermanente: true
                });
            }
            continue;
        }

        // REGRA 2: Lead já consta na lista de Restritos (só pode permanecer no 1º grupo que acessou)
        const restritoExistente = obterCrocodilo(numReal, idCampanha);
        if (restritoExistente && restritoExistente.grupoMantido?.id && setGrupos.size <= limiteMax) {
            const idPermitido = restritoExistente.grupoMantido.id;
            const gruposIndevidos = Array.from(setGrupos).filter(gid => gid !== idPermitido);
            if (gruposIndevidos.length > 0) {
                for (const gid of gruposIndevidos) {
                    const nomeG = obterNomeGrupo(gid);
                    registrarTentativaEntradaCrocodilo(restritoExistente, { id: gid, subject: nomeG });
                    enfileirarKickRealtime({
                        idGrupo: gid,
                        nomeGrupo: nomeG,
                        tagCampanha: nomeCampanha,
                        numReal,
                        idNorm,
                        jidsParaTentar: obterJidsParaExpulsaoNoGrupo(gid, numReal, idNorm, [jidOriginal]),
                        mapaPresencaAlvo: mapaPresenca,
                        ehBanPermanente: false
                    });
                }
            }
            continue;
        }

        if (setGrupos.size <= limiteMax) continue;

        // REGRA 3: Lead ultrapassou o limite de grupos (> limiteMax, ex: > 4) -> Entra para Leads Restritos
        restritosTratados++;
        const listaGruposDoLead = Array.from(setGrupos).map(gid => {
            const g = mapaGrupos.get(gid);
            return {
                id: gid,
                subject: g?.subject || obterNomeGrupo(gid) || gid,
                creation: g?.creation || 0
            };
        });

        let primeiroGrupo = null;
        let gruposParaRemover = [];

        if (restritoExistente && restritoExistente.grupoMantido && setGrupos.has(restritoExistente.grupoMantido.id)) {
            primeiroGrupo = {
                id: restritoExistente.grupoMantido.id,
                subject: restritoExistente.grupoMantido.nome || obterNomeGrupo(restritoExistente.grupoMantido.id)
            };
            gruposParaRemover = listaGruposDoLead.filter(g => g.id !== primeiroGrupo.id);
        } else {
            listaGruposDoLead.sort((a, b) => {
                if (a.creation && b.creation && a.creation !== b.creation) {
                    return a.creation - b.creation;
                }
                return a.subject.localeCompare(b.subject, undefined, { numeric: true });
            });
            primeiroGrupo = listaGruposDoLead[0];
            gruposParaRemover = listaGruposDoLead.slice(1);
        }

        console.log(`\n🔒 [LEAD RESTRITO IDENTIFICADO] Lead ${numReal} está em ${setGrupos.size} grupos na campanha "${nomeCampanha}"!`);
        console.log(`   ✅ Mantido APENAS no 1º grupo acessado: "${primeiroGrupo.subject}"`);
        console.log(`   🔴 Removendo dos demais ${gruposParaRemover.length} grupos excedentes...`);

        adicionarEventoFeed('ALERTA', `🔒 Lead Restrito! ${formatarExibicao(numReal)} em ${setGrupos.size} grupos. Mantido apenas no 1º grupo ("${primeiroGrupo.subject}") e expulso dos demais!`);

        registrarCrocodilo({
            numero: numReal,
            idCampanha,
            nomeCampanha,
            grupoMantido: primeiroGrupo,
            gruposRemovidos: gruposParaRemover
        });

        for (const grp of gruposParaRemover) {
            enfileirarKickRealtime({
                idGrupo: grp.id,
                nomeGrupo: grp.subject,
                tagCampanha: nomeCampanha,
                numReal,
                idNorm,
                jidsParaTentar: obterJidsParaExpulsaoNoGrupo(grp.id, numReal, idNorm, [jidOriginal]),
                mapaPresencaAlvo: mapaPresenca,
                ehBanPermanente: false
            });
        }
    }

    if (restritosTratados > 0) {
        console.log(`✅ [AUDITORIA RESTRITOS] ${restritosTratados} Leads Restritos auditados e tratados na campanha "${nomeCampanha}".`);
    }
}

// Conexão autônoma de ADM via pasta existente
async function conectarSniper(indice) {
    indice = Number(indice);
    cancelarReconexao(indice);

    // Se já existe uma tentativa de conexão em andamento para este ADM, aguarda a mesma
    if (conexoesEmAndamento.has(indice)) {
        return conexoesEmAndamento.get(indice);
    }

    const pastaAuth = obterPastaAuth(indice);
    if (!fs.existsSync(pastaAuth)) return null;

    const promessaConexao = (async () => {
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

            // Fecha socket anterior do mesmo slot, se existir, para evitar listeners órfãos e conflitos
            const sockAntigo = socketsAtivosPorIndice.get(indice);
            if (sockAntigo) {
                try {
                    sockAntigo.ev.removeAllListeners();
                    if (sockAntigo.ws) sockAntigo.ws.close();
                } catch (e) { }
                socketsAtivosPorIndice.delete(indice);
            }

            const anterior = snipersAtivos.find(x => x.indice === indice);
            if (anterior && anterior.sock && anterior.sock !== sockAntigo) {
                try {
                    anterior.sock.ev.removeAllListeners();
                    if (anterior.sock.ws) anterior.sock.ws.close();
                } catch (e) { }
            }

            const { version } = await fetchLatestBaileysVersion();
            const sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: ['OperationAegis', 'Chrome', `122.0.${indice}.1`],
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                keepAliveIntervalMs: 30_000,
                defaultQueryTimeoutMs: 60_000,
                connectTimeoutMs: 60_000,
                getMessage: async () => ({ conversation: '' })
            });

            socketsAtivosPorIndice.set(indice, sock);
            sock.ev.on('creds.update', saveCreds);

            return new Promise((resolve) => {
                let resolvido = false;
                const finalizarPromise = (valor) => {
                    if (!resolvido) {
                        resolvido = true;
                        clearTimeout(timeoutBoot);
                        conexoesEmAndamento.delete(indice);
                        resolve(valor);
                    }
                };

                // Timeout de segurança para nunca travar a inicialização caso um ADM esteja banido ou sem resposta
                const timeoutBoot = setTimeout(() => {
                    finalizarPromise(null);
                }, 15000);

                sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
                    // Se este socket não é mais o socket ativo para este índice, encerra imediatamente e não agenda reconexão
                    if (socketsAtivosPorIndice.get(indice) !== sock) {
                        try {
                            sock.ev.removeAllListeners();
                            if (sock.ws) sock.ws.close();
                        } catch (e) { }
                        return;
                    }

                    if (connection === 'open') {
                        cancelarReconexao(indice);
                        contadoresConflito440.delete(indice);

                        const num = extrairNumeroLimpo(sock.user?.id);
                        console.log(`[✅ ADM 0${indice}] Conectado e de olho nos grupos SendFlow (+${num})`);
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
                        // Conexão em tempo real ativa; mapeamento massivo delegado à Patrulha Contínua para evitar queda simultânea
                        setTimeout(autoSalvarBackupSessoes, 2000);

                        finalizarPromise(sniperObj);
                    }
                    if (connection === 'close') {
                        const sniperObj = snipersAtivos.find(x => x.indice === indice);
                        if (sniperObj) sniperObj.conectado = false;

                        // Remove imediatamente este ADM do mapa de permissões de grupos para acionar failover imediato
                        for (const setAdms of mapaAdminGrupos.values()) {
                            setAdms.delete(indice);
                        }

                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        const erroMsg = lastDisconnect?.error?.message || '';
                        const ehBanido = statusCode === 403 ||
                                         statusCode === DisconnectReason.forbidden ||
                                         /banned|forbidden|account.*disabled/i.test(erroMsg);
                        const ehLogout = statusCode === DisconnectReason.loggedOut ||
                                         statusCode === 401 ||
                                         statusCode === 405 ||
                                         ehBanido;

                        const ehConflito440 = statusCode === 440 ||
                                              statusCode === DisconnectReason.connectionReplaced ||
                                              /conflict|connectionReplaced/i.test(erroMsg);

                        if (ehLogout) {
                            const motivoTxt = ehBanido ? 'BANIDO/BLOQUEADO pelo WhatsApp' : 'Deslogado pelo WhatsApp';
                            console.log(`[❌ ADM 0${indice}] ${motivoTxt} (Status ${statusCode || 'N/A'}: ${erroMsg}). Failover automático ativado nos demais ADMs!`);
                            adicionarEventoFeed('ALERTA', `⚠️ ADM 0${indice} foi ${motivoTxt}. Failover ativo: os demais ADMs assumiram a proteção sem interrupção!`);

                            estadoAdms.set(indice, {
                                indice,
                                conectado: false,
                                status: ehBanido ? 'banido' : 'desconectado',
                                numero: null,
                                qrCodeDataUrl: null,
                                pairingCode: null,
                                erroMsg: ehBanido ? 'Chip banido ou restrito pelo WhatsApp. Conecte outro número neste slot.' : 'Sessão desconectada pelo WhatsApp.',
                                atualizadoEm: Date.now()
                            });
                            try { fs.rmSync(pastaAuth, { recursive: true, force: true }); } catch (e) { }
                            finalizarPromise(null);

                            // Dispara re-verificação imediata com os ADMs sobreviventes para nenhuma regra deixar de ser aplicada
                            setTimeout(() => {
                                processarFilaKicksRealtime().catch(() => {});
                                executarPatrulhaContinua().catch(() => {});
                            }, 1500);
                        } else if (ehConflito440) {
                            // Status 440: Outra sessão ou instância conectou com as mesmas credenciais
                            const agora = Date.now();
                            const reg = contadoresConflito440.get(indice) || { count: 0, lastTs: agora };
                            if (agora - reg.lastTs < 120000) {
                                reg.count++;
                            } else {
                                reg.count = 1;
                            }
                            reg.lastTs = agora;
                            contadoresConflito440.set(indice, reg);

                            const delayReconexao = reg.count > 3 ? 45000 : 15000;
                            console.log(`[⚠️ ADM 0${indice}] Conflito de sessão (Status 440 - Stream Errored (conflict)). Outra instância conectou com este número. Aguardando ${delayReconexao / 1000}s para evitar colisão... (Tentativa ${reg.count})`);
                            agendarReconexao(indice, delayReconexao);
                            finalizarPromise(null);
                        } else {
                            console.log(`[⚠️ ADM 0${indice}] Conexão fechada temporariamente (Status ${statusCode || 'Drop'} - ${erroMsg}). Reconectando com espaçamento seguro...`);
                            agendarReconexao(indice, 3000);
                            finalizarPromise(null);
                            setTimeout(() => {
                                processarFilaKicksRealtime().catch(() => {});
                            }, 500);
                        }
                    }
                });
            });
        } catch (e) {
            console.error(`[!] Falha ao conectar ADM 0${indice}:`, e.message);
            conexoesEmAndamento.delete(indice);
            return null;
        }
    })();

    conexoesEmAndamento.set(indice, promessaConexao);
    return promessaConexao;
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
    for (const setAdms of mapaAdminGrupos.values()) {
        setAdms.delete(indice);
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

    const sockAntigo = socketsAtivosPorIndice.get(indice);
    if (sockAntigo) {
        try {
            sockAntigo.ev.removeAllListeners();
            if (sockAntigo.ws) sockAntigo.ws.close();
        } catch (e) { }
        socketsAtivosPorIndice.delete(indice);
    }

    const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['OperationAegis', 'Chrome', `122.0.${indice}.1`],
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        keepAliveIntervalMs: 30_000,
        defaultQueryTimeoutMs: 60_000,
        connectTimeoutMs: 60_000,
        getMessage: async () => ({ conversation: '' })
    });

    socketsAtivosPorIndice.set(indice, sock);
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
            // Conexão em tempo real ativa; mapeamento massivo delegado à Patrulha Contínua para evitar queda simultânea
            setTimeout(autoSalvarBackupSessoes, 2000);
        }

        // 3. FECHADO (RECONEXÃO AUTOMÁTICA PÓS-PAREAMENTO)
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const erroMsg = lastDisconnect?.error?.message || '';
            const ehBanido = statusCode === 403 ||
                             statusCode === DisconnectReason.forbidden ||
                             /banned|forbidden|account.*disabled/i.test(erroMsg);
            const ehLogout = statusCode === DisconnectReason.loggedOut || ehBanido;

            console.log(`[⚠️ ADM 0${indice}] Conexão fechada durante pareamento (Status ${statusCode || 'Drop'}: ${erroMsg})`);

            let sniperObj = snipersAtivos.find(x => x.indice === indice);
            if (sniperObj) sniperObj.conectado = false;

            for (const setAdms of mapaAdminGrupos.values()) {
                setAdms.delete(indice);
            }

            if (ehLogout) {
                console.log(`[❌ ADM 0${indice}] ${ehBanido ? 'Banido' : 'Deslogado'} pelo WhatsApp.`);
                estado.conectado = false;
                estado.status = ehBanido ? 'banido' : 'desconectado';
                estado.numero = null;
                estado.qrCodeDataUrl = null;
                estado.pairingCode = null;
                estado.erroMsg = ehBanido ? 'Chip banido ou restrito pelo WhatsApp.' : null;
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

    for (const setAdms of mapaAdminGrupos.values()) {
        setAdms.delete(indice);
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

    // Expulsa de TODOS os grupos catalogados de TODAS as campanhas SendFlow ativas
    const todosGruposMap = new Map();
    for (const [idCampanha, mapaGrupos] of mapaGruposPorCampanha.entries()) {
        for (const [gid, g] of mapaGrupos.entries()) {
            todosGruposMap.set(gid, { grupo: g, idCampanha });
        }
    }

    const lidsConhecidos = mapaTelefoneParaLids.get(idNorm) || new Set();

    let gruposAfetados = 0;
    for (const [gid, { grupo: g, idCampanha }] of todosGruposMap.entries()) {
        const infoCamp = obterInfoCompletaCampanha(gid, g.subject);
        if (!infoCamp) continue;

        const mapaPresencaAlvo = obterPresencaCampanha(idCampanha);
        const estaPresenteNaPresenca = mapaPresencaAlvo.get(idNorm)?.has(gid);
        const estaPresenteNosParticipantes = (g.participants || []).some(p => {
            const pNum = extrairNumeroParticipante(p);
            return (pNum && (pNum === numLimpo || (idNorm && normalizarID(pNum) === idNorm))) ||
                lidsConhecidos.has(p.id) || lidsConhecidos.has(p.lid);
        });

        if (estaPresenteNaPresenca || estaPresenteNosParticipantes) {
            gruposAfetados++;
            const idGrupoAlvo = g.id || gid;
            const jidsParaTentar = obterJidsParaExpulsaoNoGrupo(idGrupoAlvo, numLimpo, idNorm);
            enfileirarKickRealtime({
                idGrupo: idGrupoAlvo,
                nomeGrupo: g.subject || infoCamp.nomeGrupo || gid,
                tagCampanha: infoCamp.nomeCampanha || 'CAMPANHA',
                numReal: numLimpo,
                idNorm: idNorm,
                jidsParaTentar,
                mapaPresencaAlvo,
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
    lista = lista.filter(x => {
        const xNum = extrairNumeroLimpo(x.numero);
        if (xNum === numLimpo) return false;
        if (idNorm && normalizarID(xNum) === idNorm) return false;
        if (numLimpo.length >= 10 && xNum.length >= 10 && (xNum.includes(numLimpo) || numLimpo.includes(xNum))) return false;
        return true;
    });

    // Remove também da lista de Leads Restritos se estiver nela
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
// 🎯 FASE 1: VARREDURA E LIMPEZA INICIAL (APENAS CAMPANHAS ATIVAS DO SENDFLOW)
// =====================================================================
async function executarLimpezaInicial() {
    configAtual = carregarConfig();
    const limiteMax = configAtual.limiteGruposPorCampanha;
    const limiteBan = configAtual.limiteBanPermanente;

    const cacheSendflow = getCacheCampanhas();
    const totalCampAtivas = cacheSendflow.totalCampanhasAtivas || 0;

    console.log('\n=================================================================');
    console.log(`🛡️  FASE 1: MAPEANDO EXCLUSIVAMENTE GRUPOS VINCULADOS NO SENDFLOW (${totalCampAtivas} campanhas)...`);
    console.log(`📌  Regra Saturação (Lead Restrito): Máx. ${limiteMax} grupos por pessoa na mesma campanha`);
    console.log(`⛔  Regra Ban Permanente: Acima de ${limiteBan} links = Ban total + Remoção de TODOS os grupos`);
    console.log('=================================================================');

    adminsGlobais.clear();
    mapaAdminGrupos.clear();
    mapaGruposPorCampanha.clear();
    mapaPresencaPorCampanha.clear();

    const snipersOperacionais = snipersAtivos.filter(sniperEstaOperacional);
    // Mapeamento seguro: o 1º ADM operacional mapeia os grupos e já unifica participantes e permissões de todos os ADMs sem risco de rate-limit
    if (snipersOperacionais.length > 0) {
        await executarMapeamentoDiretoDoSniper(snipersOperacionais[0], true);
    }

    console.log(`\n👑 Total de Administradores globais protegidos: ${adminsGlobais.size}`);
    console.log(`📋 Total na Whitelist de Imunidade: ${cacheWhitelist.length}`);
    console.log(`⛔ Total na Blacklist Permanente: ${cacheBlacklist.length}`);

    async function auditarELimparCampanha(idCampanha, nomeCampanha, listaGrupos, mapaPresencaRAM) {
        console.log(`\n-------------------------------------------------------------`);
        console.log(`🔍 AUDITANDO: ${nomeCampanha} (${listaGrupos.length} grupos SendFlow)`);
        console.log(`-------------------------------------------------------------`);

        // 1ª Passada: garante todos os mapeamentos LID <-> Telefone antes de consolidar presenças
        for (const g of listaGrupos) {
            for (const p of (g.participants || [])) {
                registrarMapeamentoLid(p);
            }
        }

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

                const jidOriginal = p.id || p.jid || p.lid || '';

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

            // Verifica se já era um Lead Restrito tentando permanecer em grupo diferente do 1º grupo permitido
            const restritoExistente = obterCrocodilo(dados.numero, idCampanha);
            if (restritoExistente && restritoExistente.grupoMantido && dados.grupos.length <= limiteMax) {
                const idMantido = restritoExistente.grupoMantido.id;
                const extras = dados.grupos.filter(g => g.id !== idMantido);
                if (extras.length > 0) {
                    filaRemocoes.push({
                        numero: dados.numero,
                        idNorm: idN,
                        jidOriginal: dados.jidOriginal,
                        totalGrupos: dados.grupos.length,
                        manter: restritoExistente.grupoMantido,
                        remover: extras,
                        ehBanPermanente: false
                    });
                }
                continue;
            }

            if (dados.grupos.length > limiteMax) {
                dados.grupos.sort((a, b) => {
                    if (a.creation && b.creation && a.creation !== b.creation) return a.creation - b.creation;
                    return a.subject.localeCompare(b.subject, undefined, { numeric: true });
                });

                const manter = (restritoExistente && restritoExistente.grupoMantido && dados.grupos.find(g => g.id === restritoExistente.grupoMantido.id))
                    || dados.grupos[0];
                const remover = dados.grupos.filter(g => g.id !== manter.id);

                registrarCrocodilo({
                    numero: dados.numero,
                    idCampanha,
                    nomeCampanha,
                    grupoMantido: manter,
                    gruposRemovidos: remover
                });

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
            const destinoTxt = item.ehBanPermanente ? 'NENHUM (BAN PERMANENTE TOTAL)' : `Mantido: "${item.manter?.subject || item.manter?.nome}"`;
            console.log(`[${i + 1}/${filaRemocoes.length}] ${item.numero} (${item.totalGrupos} grps) -> ${destinoTxt}`);

            for (const grp of item.remover) {
                rotador++;
                const snipersDisponiveis = obterSnipersDisponiveis(grp.id);
                if (snipersDisponiveis.length === 0) {
                    console.log(`   ⚠️ [FALHA] Nenhum ADM conectado disponível para remover de "${grp.subject}".`);
                    continue;
                }

                let kickOk = false;
                let erroMsg = '';
                // Failover entre todos os ADMs disponíveis para este grupo com validação de status 200
                for (const operador of snipersDisponiveis) {
                    if (!sniperEstaOperacional(operador)) continue;

                    const resKick = await executarRemocaoConfirmadaNoGrupo(
                        operador,
                        grp.id,
                        item.numero,
                        item.idNorm,
                        [item.jidOriginal]
                    );

                    if (resKick.sucesso) {
                        if (!mapaAdminGrupos.has(grp.id)) mapaAdminGrupos.set(grp.id, new Set());
                        mapaAdminGrupos.get(grp.id).add(operador.indice);
                        sucessos++;
                        console.log(`   🔴 [KICK] Removido de "${grp.subject}" (ADM 0${operador.indice})`);
                        mapaPresencaRAM.get(item.idNorm)?.delete(grp.id);
                        kickOk = true;
                        break;
                    } else {
                        erroMsg = resKick.erro || 'Falha não especificada';
                        if (resKick.semPermissao) {
                            mapaAdminGrupos.get(grp.id)?.delete(operador.indice);
                        }
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

    // Audita todas as campanhas ativas mapeadas do SendFlow
    for (const [idCampanha, mapaGrupos] of mapaGruposPorCampanha.entries()) {
        const listaGrupos = Array.from(mapaGrupos.values()).filter(g => g.participants && g.participants.length > 0);
        if (listaGrupos.length === 0) continue;

        const infoExemplo = obterInfoCompletaCampanha(listaGrupos[0].id, listaGrupos[0].subject);
        if (!infoExemplo) continue;
        const nomeCampanha = infoExemplo.nomeCampanha || idCampanha;
        const presencaCampanha = obterPresencaCampanha(idCampanha);

        await auditarELimparCampanha(idCampanha, nomeCampanha, listaGrupos, presencaCampanha);
    }
}

// =====================================================================
// 🛑 FILA SERIALIZADA DE KICKS REALTIME (ANTI-RATE-LIMIT & FAILOVER TOTAL)
// =====================================================================
const filaKicksRealtime = [];
let processandoFilaRealtime = false;
let rotadorRealtime = 0;

function enfileirarKickRealtime(dados) {
    if (!dados || !dados.idGrupo || !dados.idNorm) return;
    const chaveKick = `${dados.idGrupo}-${dados.idNorm}`;
    if (kicksEmAndamento.has(chaveKick)) return;
    kicksEmAndamento.add(chaveKick);
    dados._chaveKick = chaveKick;
    filaKicksRealtime.push(dados);
    processarFilaKicksRealtime().catch(() => {});
}

async function processarFilaKicksRealtime() {
    if (processandoFilaRealtime) return;
    processandoFilaRealtime = true;

    try {
        while (filaKicksRealtime.length > 0) {
            const item = filaKicksRealtime[0];
            item.tentativas = (item.tentativas || 0) + 1;

            const snipersDisponiveis = obterSnipersDisponiveis(item.idGrupo);

            if (snipersDisponiveis.length === 0) {
                if (item.tentativas <= 6) {
                    console.log(`[⏳ CATRACA] Aguardando ADM operacional para expulsar ${item.numReal} de "${item.nomeGrupo}" (Tentativa ${item.tentativas}/6)...`);
                    await sleep(2500);
                    continue;
                } else {
                    console.log(`[!] Nenhum ADM operacional disponível para "${item.nomeGrupo}" após 6 tentativas. A patrulha contínua removerá na próxima varredura.`);
                    const removidoFila = filaKicksRealtime.shift();
                    if (removidoFila?._chaveKick) kicksEmAndamento.delete(removidoFila._chaveKick);
                    continue;
                }
            }

            let removido = false;
            let ultimoErro = null;

            // Tenta com todos os ADMs disponíveis (validando status === '200' e fallback por metadata ao vivo)
            for (const operador of snipersDisponiveis) {
                if (!sniperEstaOperacional(operador)) continue;

                const resKick = await executarRemocaoConfirmadaNoGrupo(
                    operador,
                    item.idGrupo,
                    item.numReal,
                    item.idNorm,
                    item.jidsParaTentar
                );

                if (resKick.sucesso) {
                    if (!mapaAdminGrupos.has(item.idGrupo)) mapaAdminGrupos.set(item.idGrupo, new Set());
                    mapaAdminGrupos.get(item.idGrupo).add(operador.indice);
                    if (item.mapaPresencaAlvo) {
                        item.mapaPresencaAlvo.get(item.idNorm)?.delete(item.idGrupo);
                    }
                    if (!resKick.jaEstavaFora) {
                        const tagAcao = item.ehBanPermanente ? '⛔ [BAN PERMANENTE TOTAL]' : '⛔ [BARRADO PELA CATRACA]';
                        console.log(`${tagAcao} ${item.numReal} expulso de "${item.nomeGrupo}" (${item.tagCampanha}) pelo ADM 0${operador.indice}.`);
                        adicionarEventoFeed('EXPULSAO', `${tagAcao} ${formatarExibicao(item.numReal)} expulso de "${item.nomeGrupo}" (${item.tagCampanha})`);
                    }
                    removido = true;
                    break;
                } else {
                    ultimoErro = resKick.erro || 'Falha não especificada';
                    if (resKick.semPermissao) {
                        mapaAdminGrupos.get(item.idGrupo)?.delete(operador.indice);
                    }
                }
            }

            if (removido) {
                const removidoFila = filaKicksRealtime.shift();
                if (removidoFila?._chaveKick) kicksEmAndamento.delete(removidoFila._chaveKick);
            } else {
                const erroStr = String(ultimoErro).toLowerCase();
                const ehErroConexao = erroStr.includes('connection closed') ||
                                      erroStr.includes('websocket') ||
                                      erroStr.includes('timed out') ||
                                      erroStr.includes('closed');

                if (ehErroConexao && item.tentativas <= 6) {
                    console.log(`[⏳ CATRACA] Conexão oscilou ao expulsar de "${item.nomeGrupo}". Tentando novamente em 2s (${item.tentativas}/6)...`);
                    await sleep(2000);
                    continue;
                } else if (item.tentativas <= 2) {
                    // Tenta mais uma vez após pequeno delay caso os metadados do grupo ainda estivessem sincronizando no WhatsApp
                    await sleep(1500);
                    continue;
                } else {
                    console.log(`[!] Erro ao expulsar ${item.numReal} de "${item.nomeGrupo}" após tentativas: ${ultimoErro}. A patrulha contínua fará nova varredura.`);
                    const removidoFila = filaKicksRealtime.shift();
                    if (removidoFila?._chaveKick) kicksEmAndamento.delete(removidoFila._chaveKick);
                }
            }

            await sleep(1200 + Math.floor(Math.random() * 600));
        }
    } finally {
        processandoFilaRealtime = false;
    }
}

// =====================================================================
// 🛑 FASE 2: CATRACA SENTINELA 24/7 (EXCLUSIVAMENTE GRUPOS DO SENDFLOW)
// =====================================================================
function vincularListenersRealtime(sniper) {
    if (!sniper || !sniper.sock) return;
    // IMPORTANTE: Vincula a flag na instância atual do socket (sniper.sock) e NÃO no wrapper sniperObj,
    // garantindo que qualquer reconexão de ADM re-vincule os eventos em tempo real no novo socket!
    if (sniper.sock.__aegisListenerVinculado) return;
    sniper.sock.__aegisListenerVinculado = true;

    // Captura eventos de contatos do WhatsApp para enriquecer continuamente o dicionário @lid <-> telefone
    sniper.sock.ev.on('contacts.upsert', (contatos) => {
        if (!Array.isArray(contatos)) return;
        for (const c of contatos) registrarMapeamentoLid(c);
    });
    sniper.sock.ev.on('contacts.update', (contatos) => {
        if (!Array.isArray(contatos)) return;
        for (const c of contatos) registrarMapeamentoLid(c);
    });

    sniper.sock.ev.on('group-participants.update', async (evento) => {
        if (!evento || !evento.id) return;

        // Se alguém foi removido/saiu, atualiza presença em RAM e lista de participantes do grupo
        if (evento.action === 'remove' || evento.action === 'leave') {
            const infoSaida = obterInfoCompletaCampanha(evento.id, null);
            if (infoSaida && infoSaida.idCampanha) {
                for (const part of (evento.participants || [])) {
                    if (typeof part === 'object' && part !== null) registrarMapeamentoLid(part);
                    const num = extrairNumeroParticipante(part);
                    const idN = normalizarID(num);
                    if (idN) {
                        removerParticipanteDaMemoriaDoGrupo(evento.id, num, idN);
                    }
                }
            }
            return;
        }

        if (evento.action !== 'add') return;

        const idGrupo = evento.id;
        let nomeGrupo = idGrupo;
        let infoCamp = obterInfoCompletaCampanha(idGrupo, null);

        if (!infoCamp) {
            try {
                const meta = await obterMetadataGrupoResiliente(idGrupo, sniper);
                if (meta) {
                    nomeGrupo = meta.subject || idGrupo;
                    infoCamp = obterInfoCompletaCampanha(idGrupo, nomeGrupo);
                    if (infoCamp && infoCamp.idCampanha) {
                        const mapaGrupos = obterGruposCampanha(infoCamp.idCampanha);
                        if (!mapaGrupos.has(idGrupo)) mapaGrupos.set(idGrupo, meta);
                    }
                }
            } catch (e) { }
        } else {
            nomeGrupo = infoCamp.nomeGrupo || idGrupo;
        }

        // Fallback: se ainda não encontrou campanha, busca nos grupos já mapeados em memória
        if (!infoCamp && idGrupo) {
            for (const [cId, grps] of mapaGruposPorCampanha.entries()) {
                if (grps.has(idGrupo)) {
                    const g = grps.get(idGrupo);
                    infoCamp = {
                        idCampanha: cId,
                        nomeCampanha: mapaInfoCampanhas.get(cId)?.name || cId,
                        nomeGrupo: g?.subject || nomeGrupo || idGrupo
                    };
                    break;
                }
            }
        }

        // Se ainda não identificou mas o ADM que recebeu pertence a uma campanha conhecida, herda a campanha
        if (!infoCamp) {
            const metaSniper = obterMetaSniper(sniper.indice);
            if (metaSniper && metaSniper.campaignId) {
                infoCamp = {
                    idCampanha: metaSniper.campaignId,
                    nomeCampanha: metaSniper.campaignName || 'Campanha SendFlow',
                    nomeGrupo: nomeGrupo
                };
            }
        }

        // Se o grupo não pertence a nenhuma campanha do SendFlow em andamento, ignora
        if (!infoCamp || !infoCamp.idCampanha) {
            return;
        }

        const idCampanha = infoCamp.idCampanha;
        const tagCampanha = infoCamp.nomeCampanha;
        const mapaPresencaAlvo = obterPresencaCampanha(idCampanha);
        const mapaGruposCampanha = obterGruposCampanha(idCampanha);

        for (const novato of (evento.participants || [])) {
            if (typeof novato === 'object' && novato !== null) {
                registrarMapeamentoLid(novato);
            }

            let idNovatoBruto = typeof novato === 'object' ? (novato.id || novato.jid || novato.phoneNumber || novato.lid || '') : String(novato);
            if (!idNovatoBruto) continue;

            // Se o evento de entrada veio apenas com @lid e ainda não temos o telefone real mapeado,
            // consulta imediatamente o metadata atualizado do grupo para descobrir o phoneNumber vinculado ao @lid!
            if (idNovatoBruto.includes('@lid')) {
                const lidLimpo = extrairNumeroLimpo(idNovatoBruto);
                if (lidLimpo && !mapaLidParaTelefone.has(lidLimpo)) {
                    try {
                        const metaFresca = await obterMetadataGrupoResiliente(idGrupo, sniper);
                        if (metaFresca && metaFresca.participants) {
                            mapaGruposCampanha.set(idGrupo, metaFresca);
                            const pEncontrado = metaFresca.participants.find(p => {
                                const pLid = extrairNumeroLimpo(p.lid || p.id);
                                return pLid === lidLimpo;
                            });
                            if (pEncontrado) {
                                const tel = extrairNumeroParticipante(pEncontrado);
                                if (tel && tel !== lidLimpo) {
                                    mapaLidParaTelefone.set(lidLimpo, tel);
                                }
                            }
                        }
                    } catch (e) { }
                }
            }

            let numReal = extrairNumeroParticipante(novato);
            if (!numReal) continue;
            const idNorm = normalizarID(numReal);
            if (!idNorm) continue;

            // Garante que o participante recém-entrado também conste no cache de participants deste grupo em RAM
            const grpEmRam = mapaGruposCampanha.get(idGrupo);
            if (grpEmRam && Array.isArray(grpEmRam.participants)) {
                const jaNoGrupoRam = grpEmRam.participants.some(p => normalizarID(extrairNumeroParticipante(p)) === idNorm);
                if (!jaNoGrupoRam) {
                    const objParticipante = typeof novato === 'object' && novato !== null
                        ? novato
                        : { id: idNovatoBruto };
                    grpEmRam.participants.push(objParticipante);
                }
            }

            const hashEntrada = `${idGrupo}-${idNorm}`;
            if (travasRedundancia.has(hashEntrada)) continue;
            travasRedundancia.add(hashEntrada);
            setTimeout(() => travasRedundancia.delete(hashEntrada), 3000);

            const jidsParaTentar = obterJidsParaExpulsaoNoGrupo(idGrupo, numReal, idNorm, [idNovatoBruto]);

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

            // 🔒 CHECAGEM DE LEAD RESTRITO PREEXISTENTE
            // Regra: se o lead já está na lista de Restritos, só tem permissão de estar no 1º grupo acessado.
            // Qualquer tentativa de entrar em outro grupo = EXPULSÃO IMEDIATA.
            const restritoExistente = obterCrocodilo(numReal, idCampanha);
            if (restritoExistente && restritoExistente.grupoMantido) {
                if (restritoExistente.grupoMantido.id !== idGrupo) {
                    console.log(`\n🔒 [CATRACA - LEAD RESTRITO BARRADO] ${numReal} está na lista de Restritos!`);
                    console.log(`   Tentou entrar em: "${nomeGrupo}" (${tagCampanha})`);
                    console.log(`   Permitido exclusivamente no 1º grupo que acessou: "${restritoExistente.grupoMantido.nome}". EXPULSANDO DO NOVO GRUPO...`);
                    adicionarEventoFeed('ALERTA', `🔒 Lead Restrito ${formatarExibicao(numReal)} barrado em "${nomeGrupo}"! Removido para permanecer apenas em seu 1º grupo ("${restritoExistente.grupoMantido.nome}").`);

                    registrarTentativaEntradaCrocodilo(restritoExistente, { id: idGrupo, subject: nomeGrupo });

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
                    console.log(`🔒 [CATRACA - LEAD RESTRITO NO 1º GRUPO PERMITIDO] ${numReal} entrou em "${nomeGrupo}", que é o seu 1º grupo permitido.`);
                    adicionarEventoFeed('ALERTA', `🔒 Lead Restrito ${formatarExibicao(numReal)} entrou em seu 1º grupo permitido ("${nomeGrupo}").`);
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
                        jidsParaTentar: obterJidsParaExpulsaoNoGrupo(gid, numReal, idNorm, [idNovatoBruto]),
                        mapaPresencaAlvo,
                        ehBanPermanente: true
                    });
                }
                continue;
            }

            // 🔒 REGRA 4: LEADS RESTRITOS (> limiteMax, ex: > 4 grupos)
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

                console.log(`\n🔒 [ALERTA CATRACA - LEAD RESTRITO] Lead ${numReal} atingiu ${gruposDoLead.size} grupos em ${tagCampanha} (> limite ${limiteMax})!`);
                console.log(`   ✅ Mantendo APENAS o 1º grupo acessado: "${primeiroGrupo.subject}"`);
                console.log(`   🔴 Expulsando de TODOS os outros ${gruposParaRemover.length} grupos excedentes...`);
                adicionarEventoFeed('ALERTA', `🔒 Lead Restrito! ${formatarExibicao(numReal)} atingiu ${gruposDoLead.size} grupos em ${tagCampanha}. Mantido apenas no 1º grupo ("${primeiroGrupo.subject}") e expulso dos demais!`);

                registrarCrocodilo({
                    numero: numReal,
                    idCampanha,
                    nomeCampanha: tagCampanha,
                    grupoMantido: primeiroGrupo,
                    gruposRemovidos: gruposParaRemover
                });

                // IMPORTANTE: NÃO limpamos gruposDoLead prematuramente antes da confirmação de kick!
                // Cada grupo só é removido de gruposDoLead quando executarRemocaoConfirmadaNoGrupo confirmar status 200.

                // Dispara expulsão de todos os grupos excedentes (incluindo o idGrupo e os outros)
                for (const grp of gruposParaRemover) {
                    enfileirarKickRealtime({
                        idGrupo: grp.id,
                        nomeGrupo: grp.subject,
                        tagCampanha,
                        numReal,
                        idNorm,
                        jidsParaTentar: obterJidsParaExpulsaoNoGrupo(grp.id, numReal, idNorm, [idNovatoBruto]),
                        mapaPresencaAlvo,
                        ehBanPermanente: false
                    });
                }
            }
        }
    });
}

// =====================================================================
// 🔄 PATRULHA CONTÍNUA 24/7 (WATCHDOG RESILIENTE ANTI-PARADA)
// =====================================================================
let intervaloPatrulhaContinua = null;
let patrulhaEmExecucao = false;

async function executarPatrulhaContinua() {
    if (patrulhaEmExecucao) return;
    patrulhaEmExecucao = true;

    try {
        // 1. Garante que qualquer ADM cadastrado que tenha sessão válida em disco (e não esteja banido nem gerando QR/Código) esteja conectado
        const snipersCadastrados = carregarSnipersCampanhas();
        for (const s of snipersCadastrados) {
            const idNum = Number(s.id || s.indice);
            if (!idNum) continue;

            const ativo = snipersAtivos.find(x => x.indice === idNum);
            if (ativo && sniperEstaOperacional(ativo)) {
                vincularListenersRealtime(ativo);
                continue;
            }

            const est = estadoAdms.get(idNum);
            const emPareamento = est && ['gerando_qr', 'qr_pronto', 'solicitando_codigo', 'codigo_pronto', 'banido'].includes(est.status);
            if (emPareamento || timersReconexao.has(idNum) || conexoesEmAndamento.has(idNum)) continue;

            const pastaAuth = obterPastaAuth(idNum);
            if (fs.existsSync(path.join(pastaAuth, 'creds.json'))) {
                conectarSniper(idNum).catch(() => {});
            }
        }

        // 2. Garante vigilância em tempo real e audita campanhas em RAM sem sobrecarregar o WhatsApp
        const operacionais = snipersAtivos.filter(sniperEstaOperacional);
        if (operacionais.length === 0) return;

        for (const sniper of operacionais) {
            vincularListenersRealtime(sniper);
        }

        // Audita saturação e leads restritos em memória (0 chamadas de rede, ultra rápido e seguro)
        for (const idCamp of mapaGruposPorCampanha.keys()) {
            await auditarSaturacaoECrocodilos(idCamp);
        }

        // Mapeia no máximo 1 ADM cujo cache tenha expirado (> 15 min) e não esteja em cooldown de rate-limit
        const proximoParaMapear = operacionais.find(s => {
            if (cooldownRateLimitSniper.has(s.indice) && Date.now() < cooldownRateLimitSniper.get(s.indice)) return false;
            const ult = ultimoMapeamentoPorSniper.get(s.indice) || 0;
            return (Date.now() - ult) > INTERVALO_MINIMO_MAPEAMENTO_MS;
        });
        if (proximoParaMapear) {
            enfileirarMapeamentoSniper(proximoParaMapear);
        }

        // Processa eventuais kicks pendentes na fila
        processarFilaKicksRealtime().catch(() => {});
    } catch (err) {
        console.error('[!] Erro na Patrulha Contínua:', err.message);
    } finally {
        patrulhaEmExecucao = false;
    }
}

function iniciarPatrulhaContinua() {
    if (intervaloPatrulhaContinua) clearInterval(intervaloPatrulhaContinua);
    // A cada 30 segundos, verifica integridade dos sockets, faz failover e audita todos os grupos SendFlow
    intervaloPatrulhaContinua = setInterval(() => {
        executarPatrulhaContinua().catch(() => {});
    }, 30 * 1000);
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
    console.log('🛡️  MOTOR UNIFICADO AEGIS: EXCLUSIVO PARA CAMPANHAS SENDFLOW & ADMS');
    console.log(`📌  Configuração Atual: Máx. ${configAtual.limiteGruposPorCampanha} Grupos por pessoa na mesma campanha | Ban Permanente: > ${configAtual.limiteBanPermanente} links`);
    console.log(`🤖  Frota de ADMs (Administradores dos Grupos): ${qtdAdms} contas configuradas`);
    console.log('=================================================================\n');

    // 1. Carregar campanhas e grupos locais do cache e iniciar agendamento com callback de re-auditoria
    carregarCampanhasLocais();
    iniciarAgendamento12Horas(() => {
        executarPatrulhaContinua().catch(() => {});
    });

    // Inicia o Watchdog de Patrulha Contínua desde o boot (mesmo que os ADMs sejam conectados depois pelo painel)
    iniciarPatrulhaContinua();

    const snipersCadastrados = carregarSnipersCampanhas();
    console.log(`[+] Conectando frota de ${snipersCadastrados.length} Administradores Snipers distribuídos por campanha...`);
    for (const s of snipersCadastrados) {
        conectarSniper(Number(s.id || s.indice)).catch(() => {});
        await sleep(1500); // 1.5s de espaçamento seguro entre a inicialização de cada ADM
    }

    if (snipersAtivos.filter(sniperEstaOperacional).length === 0) {
        console.warn('⚠️ [AVISO] Nenhum ADM com sessão salva pôde ser conectado no momento.');
        console.log('📌 O Painel Web e a Patrulha Contínua estão 100% ativos. Acesse o navegador para conectar seus ADMs via QR Code ou Código.');
        adicionarEventoFeed('SISTEMA', '⚠️ Nenhum ADM conectado. Conecte pelo Painel Web via QR Code ou Código de Pareamento.');
        return;
    }

    console.log(`\n✅ ${snipersAtivos.filter(sniperEstaOperacional).length} Administradores (ADMs) armados e de olho exclusivamente nos grupos SendFlow.`);

    await executarLimpezaInicial();

    console.log('\n=================================================================');
    console.log('🟢 [SENTINELA ATIVO 24/7] VIGIANDO EXCLUSIVAMENTE AS CAMPANHAS DO SENDFLOW!');
    console.log(`   • Tolerância de Saturação (Leads Restritos): até ${configAtual.limiteGruposPorCampanha} grupos por campanha.`);
    console.log(`   • Ban Permanente Automático: acima de ${configAtual.limiteBanPermanente} links = Remoção total sem exceção.`);
    console.log('   • Failover Automático Ativo: se um ADM cair ou for banido, os demais assumem sem parar.');
    console.log('   • Patrulha Contínua ativa a cada 30 segundos + Sincronização SendFlow a cada 12h.');
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
    executarPatrulhaContinua,
    autoSalvarBackupSessoes,
    normalizarID,
    extrairNumeroLimpo,
    extrairNumeroParticipante,
    registrarMapeamentoLid,
    executarRemocaoConfirmadaNoGrupo,
    obterJidsParaExpulsaoNoGrupo,
    DATA_DIR,
    // Aliases para compatibilidade total
    obterStatusEspioes: obterStatusAdms,
    conectarEspiaoManual: conectarAdmManual,
    desconectarEspiao: desconectarAdm
};
