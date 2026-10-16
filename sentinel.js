// =====================================================================
// 🛡️ MOTOR AEGIS 8.2: ARQUITETURA MULTI-AGENTES TOTALMENTE SEQUENCIAL
// =====================================================================
const {
    default: makeWASocket,
    useMultiFileAuthState,
    isJidGroup,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');
const { EventEmitter } = require('events');
const pino = require('pino');
const readline = require('readline');
const fs = require('fs');

// ⏱️ RELÓGIO MESTRE ABSOLUTO (com margem de segurança de 15s para desvios de NTP)
const TEMPO_BOOT = Math.floor(Date.now() / 1000) - 15;

// 🤫 SILENCIADOR NÍVEL MILITAR (Filtra ruídos transitórios do protocolo Signal/Baileys)
const consoleLogOriginal = console.log;
const consoleInfoOriginal = console.info;
const consoleWarnOriginal = console.warn;
const consoleErrorOriginal = console.error;

const termosSilenciados = [
    'Closing session',
    'Closing open session',
    'SessionEntry',
    'prekey bundle',
    'ephemeralKeyPair',
    'registrationId',
    'Bad MAC',
    'Failed to decrypt message',
    'Session error',
    'overwriting prekey',
    'no session found to decrypt',
    'libsignal'
];

const filtroSilenciador = (args) => {
    if (!args || args.length === 0) return false;
    const str = args.map(a => {
        if (typeof a === 'string') return a;
        if (a && a.message) return a.message;
        if (a && a.stack) return a.stack;
        return '';
    }).join(' ');
    return termosSilenciados.some(termo => str.includes(termo));
};

console.log = function (...args) { if (!filtroSilenciador(args)) consoleLogOriginal.apply(console, args); };
console.info = function (...args) { if (!filtroSilenciador(args)) consoleInfoOriginal.apply(console, args); };
console.warn = function (...args) { if (!filtroSilenciador(args)) consoleWarnOriginal.apply(console, args); };
console.error = function (...args) { if (!filtroSilenciador(args)) consoleErrorOriginal.apply(console, args); };

process.on('uncaughtException', err => {
    if (!filtroSilenciador([err])) console.error('\n[💀 ERRO FATAL]', err);
});
process.on('unhandledRejection', err => {
    if (!filtroSilenciador([err])) console.error('\n[💀 REJEIÇÃO]', err);
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// =================================================================
// ⚙️ PAINEL DE CONTROLE DA OPERAÇÃO
// =================================================================
const WHITELIST_REMETENTES = [
    // Adicione os números autorizados aqui (ex: '5516999999999')
];

// Configure livremente quantos Snipers e Espiões desejar:
const QTD_SNIPERS = 4;
const QTD_ESPIOES = 9;

// ID do grupo de alertas (use o comando !idgrupo dentro do grupo para obter):
const GRUPO_DE_ALERTAS = "120363413670200654@g.us";

const ARQUIVO_BLACKLIST = './blacklist_aegis.json';
const ARQUIVO_STATS = './estatisticas_aegis.json';

// 📡 BARRAMENTO TÁTICO: COMUNICAÇÃO TOTAL ENTRE ESPIÕES E SNIPERS
const barramentoTatico = new EventEmitter();
barramentoTatico.setMaxListeners(200);

const mensagensProcessadas = new Set();
const travasDeRedundancia = new Set();
const cacheGrupos = new Map(); // chatId -> { dados, tempo }
const pendingMetadata = new Map();
const mapaLidParaTelefone = new Map(); // lid -> telefone real

function registrarMapeamentoLid(lid, jidOuTelefone) {
    if (!lid || !jidOuTelefone) return;
    const lidLimpo = extrairNumeroLimpo(lid);
    const telLimpo = extrairNumeroLimpo(jidOuTelefone);
    if (lidLimpo && telLimpo && lidLimpo !== telLimpo && telLimpo.length >= 10 && telLimpo.length <= 14) {
        mapaLidParaTelefone.set(lidLimpo, telLimpo);
        mapaLidParaTelefone.set(normalizarJid(lid), `${telLimpo}@s.whatsapp.net`);
    }
}

// 🧠 BANCOS DE DADOS EM MEMÓRIA RAM
let cacheBlacklist = [];
let cacheEstatisticas = { total_mensagens_apagadas: 0, total_banimentos: 0, hackers_bloqueados: [], grupos_protegidos: [] };

// Frota ativa de instâncias conectadas
const frotaSnipers = [];
const frotaEspioes = [];

// =================================================================
// 🛡️ OTIMIZADOR DE DISCO (DEBOUNCE ANTI-EMFILE)
// =================================================================
function criarCredsOtimizado(authOriginal) {
    let timer = null;
    return {
        state: authOriginal.state,
        saveCreds: () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(async () => {
                try {
                    await authOriginal.saveCreds();
                } catch (e) {
                    console.error("[ERRO CREDS]", e);
                }
            }, 500);
        }
    };
}

// =================================================================
// 📊 SISTEMA DE TELEMETRIA E BANCO DE DADOS
// =================================================================
function carregarBancosDeDadosParaRAM() {
    try {
        if (!fs.existsSync(ARQUIVO_BLACKLIST)) fs.writeFileSync(ARQUIVO_BLACKLIST, JSON.stringify([]));
        cacheBlacklist = JSON.parse(fs.readFileSync(ARQUIVO_BLACKLIST, 'utf-8'));
        if (!Array.isArray(cacheBlacklist)) cacheBlacklist = [];
    } catch (e) {
        cacheBlacklist = [];
    }

    try {
        if (!fs.existsSync(ARQUIVO_STATS)) fs.writeFileSync(ARQUIVO_STATS, JSON.stringify(cacheEstatisticas, null, 2));
        cacheEstatisticas = JSON.parse(fs.readFileSync(ARQUIVO_STATS, 'utf-8'));
    } catch (e) {
        cacheEstatisticas = { total_mensagens_apagadas: 0, total_banimentos: 0, hackers_bloqueados: [], grupos_protegidos: [] };
    }
}

function registrarEstatistica(acao, numeroInvasor = null, nomeGrupo = null) {
    if (acao === 'MENSAGEM') cacheEstatisticas.total_mensagens_apagadas += 1;
    if (acao === 'BANIMENTO' && numeroInvasor && nomeGrupo) {
        cacheEstatisticas.total_banimentos += 1;
        if (!cacheEstatisticas.hackers_bloqueados.includes(numeroInvasor)) {
            cacheEstatisticas.hackers_bloqueados.push(numeroInvasor);
        }
        if (!cacheEstatisticas.grupos_protegidos.includes(nomeGrupo)) {
            cacheEstatisticas.grupos_protegidos.push(nomeGrupo);
        }
    }
    fs.promises.writeFile(ARQUIVO_STATS, JSON.stringify(cacheEstatisticas, null, 2)).catch(() => { });
}

// =================================================================
// 🔍 NORMALIZAÇÃO E RESOLUÇÃO DE IDENTIDADES
// =================================================================
function normalizarJid(jid) {
    if (!jid) return "";
    try {
        return jidNormalizedUser(String(jid));
    } catch (e) {
        return String(jid).split(':')[0].split('@')[0] + '@s.whatsapp.net';
    }
}

function extrairNumeroLimpo(jid) {
    if (!jid) return "";
    return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
}

function normalizarID(jid) {
    if (!jid) return "";
    let num = extrairNumeroLimpo(jid);
    if (num.startsWith('55') && (num.length === 12 || num.length === 13)) {
        num = num.substring(2);
    }
    if (num.length === 11 && num[2] === '9') {
        num = num.substring(0, 2) + num.substring(3);
    }
    return num;
}

function compararIdentidades(jidA, jidB) {
    if (!jidA || !jidB) return false;
    const normA = normalizarJid(jidA);
    const normB = normalizarJid(jidB);
    if (normA === normB) return true;

    const numLimpoA = extrairNumeroLimpo(jidA);
    const numLimpoB = extrairNumeroLimpo(jidB);
    if (numLimpoA && numLimpoB && numLimpoA === numLimpoB) return true;

    const idA = normalizarID(jidA);
    const idB = normalizarID(jidB);
    return Boolean(idA && idB && idA === idB);
}

function resolverIdentidadeInvasor(senderId, metadata, rawKey = null) {
    let jidTelefone = "";
    let numeroReal = "";

    // 1. Extração direta de atributos Phone Number na mensagem original (Baileys rawKey)
    if (rawKey) {
        const candidatos = [
            rawKey.participantPn,
            rawKey.senderPn,
            rawKey.participant_pn,
            rawKey.sender_pn
        ];
        for (const cand of candidatos) {
            if (cand) {
                const limpo = extrairNumeroLimpo(cand);
                if (limpo && limpo.length >= 10 && limpo.length <= 14 && limpo !== extrairNumeroLimpo(senderId)) {
                    numeroReal = limpo;
                    jidTelefone = `${limpo}@s.whatsapp.net`;
                    registrarMapeamentoLid(senderId, jidTelefone);
                    break;
                }
            }
        }
    }

    // 2. Extração via metadados do grupo (no Baileys, p.jid guarda o número de telefone real!)
    if (!numeroReal && metadata && Array.isArray(metadata.participants)) {
        const p = metadata.participants.find(part => {
            if (part.lid && compararIdentidades(part.lid, senderId)) return true;
            if (part.id && compararIdentidades(part.id, senderId)) return true;
            return false;
        });

        if (p) {
            const candidatos = [p.jid, p.id, p.phoneNumber, p.phone_number];
            for (const cand of candidatos) {
                if (!cand) continue;
                const limpo = extrairNumeroLimpo(cand);
                if (limpo && limpo.length >= 10 && limpo.length <= 14 && limpo !== extrairNumeroLimpo(senderId)) {
                    numeroReal = limpo;
                    jidTelefone = `${limpo}@s.whatsapp.net`;
                    registrarMapeamentoLid(senderId, jidTelefone);
                    break;
                }
            }
        }
    }

    // 3. Consulta ao mapa global de cache LID -> Telefone
    if (!numeroReal) {
        const lidLimpo = extrairNumeroLimpo(senderId);
        if (mapaLidParaTelefone.has(lidLimpo)) {
            numeroReal = mapaLidParaTelefone.get(lidLimpo);
            jidTelefone = `${numeroReal}@s.whatsapp.net`;
        }
    }

    // 4. Se o próprio senderId já for um número de telefone comum (@s.whatsapp.net)
    if (!numeroReal) {
        if (senderId.includes('@s.whatsapp.net')) {
            numeroReal = extrairNumeroLimpo(senderId);
            jidTelefone = senderId;
        } else {
            numeroReal = extrairNumeroLimpo(senderId) || senderId;
            jidTelefone = senderId;
        }
    }

    return {
        numero: numeroReal,
        jid: jidTelefone
    };
}

function estaNaBlacklist(jid) {
    if (!jid || cacheBlacklist.length === 0) return false;
    const jidStr = String(jid);
    const idNorm = normalizarID(jidStr);
    const numPuro = jidStr.split('@')[0].split(':')[0].replace(/\D/g, '');

    return cacheBlacklist.some(b => {
        if (!b) return false;
        const bStr = String(b);
        const bPuro = bStr.split('@')[0].split(':')[0].replace(/\D/g, '');
        const bNorm = normalizarID(bStr);

        if (bStr === jidStr) return true;
        if (numPuro && bPuro && numPuro === bPuro) return true;
        if (idNorm && bNorm && idNorm === bNorm) return true;

        // Substring segura: apenas se ambos os números tiverem pelo menos 10 dígitos (DDD + número)
        if (numPuro && bPuro && numPuro.length >= 10 && bPuro.length >= 10) {
            if (bStr.includes(numPuro) || jidStr.includes(bPuro)) return true;
        }

        return false;
    });
}

function adicionarNaBlacklist(jid) {
    if (!jid) return;
    const jidStr = String(jid);
    const idNorm = normalizarID(jidStr);
    const numPuro = jidStr.split('@')[0].split(':')[0].replace(/\D/g, '');
    let atualizou = false;

    if (!cacheBlacklist.includes(jidStr)) { cacheBlacklist.push(jidStr); atualizou = true; }
    if (numPuro && !cacheBlacklist.includes(numPuro)) { cacheBlacklist.push(numPuro); atualizou = true; }
    if (idNorm && !cacheBlacklist.includes(idNorm)) { cacheBlacklist.push(idNorm); atualizou = true; }

    if (atualizou) {
        fs.promises.writeFile(ARQUIVO_BLACKLIST, JSON.stringify(cacheBlacklist, null, 2)).catch(() => { });
    }
}

function estaNaWhitelist(jid, identidade = null) {
    if (!jid) return false;

    const alvos = new Set();
    alvos.add(String(jid));
    if (identidade?.jid) alvos.add(String(identidade.jid));
    if (identidade?.numero) {
        alvos.add(String(identidade.numero));
        alvos.add(`${identidade.numero}@s.whatsapp.net`);
    }

    for (const alvo of alvos) {
        const idNorm = normalizarID(alvo);
        const numLimpo = extrairNumeroLimpo(alvo);

        for (const seguro of WHITELIST_REMETENTES) {
            if (!seguro) continue;
            if (normalizarID(seguro) === idNorm || (numLimpo && extrairNumeroLimpo(seguro) === numLimpo)) {
                return true;
            }
        }

        // Bots da frota de Snipers e Espiões são sempre imunes
        for (const sniper of frotaSnipers) {
            if (sniper?.user?.id && compararIdentidades(sniper.user.id, alvo)) return true;
        }
        for (const espiao of frotaEspioes) {
            if (espiao?.user?.id && compararIdentidades(espiao.user.id, alvo)) return true;
        }
    }

    return false;
}

// =================================================================
// 🛡️ MOTOR SEGURO DE METADADOS DE GRUPOS (CACHE COM TTL)
// =================================================================
async function obterMetadataSegura(chatId, forcarAtualizacao = false) {
    const agora = Date.now();
    const cache = cacheGrupos.get(chatId);

    if (!forcarAtualizacao && cache && (agora - cache.tempo < 60000)) {
        return cache.dados;
    }

    if (pendingMetadata.has(chatId)) {
        return await pendingMetadata.get(chatId);
    }

    const promessa = (async () => {
        // Tenta consultar através dos Snipers conectados
        for (const sniper of frotaSnipers) {
            if (!sniper || !sniper.user) continue;
            try {
                const metadata = await sniper.groupMetadata(chatId);
                if (metadata && Array.isArray(metadata.participants)) {
                    for (const p of metadata.participants) {
                        if (p.lid && p.jid) registrarMapeamentoLid(p.lid, p.jid);
                        if (p.lid && p.id && p.id.includes('@s.whatsapp.net')) registrarMapeamentoLid(p.lid, p.id);
                        if (p.id && p.jid && p.id.includes('@lid')) registrarMapeamentoLid(p.id, p.jid);
                    }
                    cacheGrupos.set(chatId, { dados: metadata, tempo: Date.now() });
                    return metadata;
                }
            } catch (e) { }
        }

        // Fallback: se nenhum sniper conseguir, tenta consultar pelos espiões
        for (const espiao of frotaEspioes) {
            if (!espiao || !espiao.user) continue;
            try {
                const metadata = await espiao.groupMetadata(chatId);
                if (metadata && Array.isArray(metadata.participants)) {
                    for (const p of metadata.participants) {
                        if (p.lid && p.jid) registrarMapeamentoLid(p.lid, p.jid);
                        if (p.lid && p.id && p.id.includes('@s.whatsapp.net')) registrarMapeamentoLid(p.lid, p.id);
                        if (p.id && p.jid && p.id.includes('@lid')) registrarMapeamentoLid(p.id, p.jid);
                    }
                    cacheGrupos.set(chatId, { dados: metadata, tempo: Date.now() });
                    return metadata;
                }
            } catch (e) { }
        }

        return cache ? cache.dados : null;
    })();

    pendingMetadata.set(chatId, promessa);
    try {
        return await promessa;
    } finally {
        pendingMetadata.delete(chatId);
    }
}

function verificarSeEhAdmin(metadata, senderJid, identidade = null) {
    if (!metadata || !Array.isArray(metadata.participants)) return false;

    const alvos = new Set();
    if (senderJid) alvos.add(String(senderJid));
    if (identidade?.jid) alvos.add(String(identidade.jid));
    if (identidade?.numero) {
        alvos.add(String(identidade.numero));
        alvos.add(`${identidade.numero}@s.whatsapp.net`);
    }

    const participante = metadata.participants.find(p => {
        for (const alvo of alvos) {
            if (compararIdentidades(p.id, alvo)) return true;
            if (p.lid && compararIdentidades(p.lid, alvo)) return true;
            if (p.jid && compararIdentidades(p.jid, alvo)) return true;
            if (p.phoneNumber && compararIdentidades(p.phoneNumber, alvo)) return true;
        }
        return false;
    });

    if (participante && (participante.admin === 'admin' || participante.admin === 'superadmin')) {
        return true;
    }

    return false;
}

function obterSniperAdminDoGrupo(chatId, metadata = null) {
    for (const sniper of frotaSnipers) {
        if (!sniper || !sniper.user) continue;
        const meuJid = normalizarJid(sniper.user.id);

        if (metadata && Array.isArray(metadata.participants)) {
            const euNoGrupo = metadata.participants.find(p => compararIdentidades(p.id, meuJid));
            if (euNoGrupo && (euNoGrupo.admin === 'admin' || euNoGrupo.admin === 'superadmin')) {
                return sniper;
            }
        }
    }
    // Retorna o primeiro sniper conectado como fallback
    return frotaSnipers.find(s => s && s.user) || null;
}

// =================================================================
// 🚀 GERENCIADOR UNIFICADO DE CONEXÃO MULTI-AGENTES (100% RESILIENTE)
// Resolve de forma definitiva o travamento pós-pairing de qualquer agente
// =================================================================
async function conectarAgente({ tipo, indice, pastaAuth }) {
    return new Promise(async (resolve) => {
        const tag = `[${tipo} 0${indice}]`;
        console.log(`\n[*] ${tag} Verificando credenciais...`);

        const auth = criarCredsOtimizado(await useMultiFileAuthState(pastaAuth));
        let numeroTelefone = "";

        if (!auth.state.creds.registered) {
            numeroTelefone = await question(`\n[?] NOVO LOGIN. Digite o NÚMERO DO ${tipo} 0${indice} (Com 55!): `);
            numeroTelefone = numeroTelefone.replace(/\D/g, '');
        } else {
            console.log(`[*] ${tag} Chaves salvas encontradas. Conectando aos servidores...`);
        }

        let codigoSolicitado = false;
        let bootConcluido = false;

        function concluirConexao(sock) {
            if (!bootConcluido) {
                bootConcluido = true;
                resolve(sock);
            }
        }

        async function inicializarSocket() {
            try {
                const { version } = await fetchLatestBaileysVersion();

                const sock = makeWASocket({
                    version,
                    auth: auth.state,
                    printQRInTerminal: false,
                    logger: pino({ level: 'silent' }),
                    browser: Browsers.ubuntu('Chrome'),
                    markOnlineOnConnect: true,
                    generateHighQualityLinkPreview: true,
                    syncFullHistory: false,
                    getMessage: async (key) => ({ conversation: '' })
                });

                // Armazena na frota global
                if (tipo === 'SNIPER') frotaSnipers[indice - 1] = sock;
                if (tipo === 'ESPIÃO') frotaEspioes[indice - 1] = sock;

                sock.ev.on('creds.update', auth.saveCreds);

                // Registra os listeners do agente
                if (tipo === 'SNIPER') registrarEventosSniper(sock, indice);
                if (tipo === 'ESPIÃO') registrarEventosEspiao(sock, indice);

                sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
                    if (lid && jid) registrarMapeamentoLid(lid, jid);
                });

                sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;

                    // Solicitação do Pairing Code
                    if (qr && !sock.authState.creds.registered && !codigoSolicitado) {
                        codigoSolicitado = true;
                        console.log(`\n[*] Aguardando servidores do WhatsApp para ${tag} (3s)...`);
                        setTimeout(async () => {
                            try {
                                const code = await sock.requestPairingCode(numeroTelefone);
                                console.log(`\n[🔑] CÓDIGO DO ${tipo} 0${indice}: ${code}`);
                                console.log(`[📱] Insira este código no WhatsApp do seu aparelho para conectar.`);
                            } catch (err) {
                                console.log(`\n[❌ ERRO PAIRING] Falha ao solicitar código para ${tag}:`, err?.message || err);
                                codigoSolicitado = false;
                            }
                        }, 3000);
                    }

                    if (connection === 'close') {
                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        const ehLogout = statusCode === DisconnectReason.loggedOut;

                        if (!ehLogout) {
                            console.log(`\n[!] Reconectando ${tag}...`);
                            setTimeout(() => inicializarSocket(), 1500);
                        } else {
                            console.log(`\n[❌] ${tag} foi deslogado. Apague a pasta "${pastaAuth}" e reinicie.`);
                            concluirConexao(null);
                        }
                    }

                    if (connection === 'open') {
                        console.log(`[✅ ${tipo} 0${indice}] Conectado e Operacional!`);
                        // Delay de 1.5s para estabilizar o handshake do WhatsApp antes de liberar o próximo agente
                        setTimeout(() => {
                            concluirConexao(sock);
                        }, 1500);
                    }
                });
            } catch (err) {
                console.error(`[❌ ERRO AO CRIAR SOCKET ${tag}]`, err?.message || err);
                setTimeout(() => inicializarSocket(), 2000);
            }
        }

        inicializarSocket();
    });
}

// =================================================================
// 🎯 LISTENERS DO SNIPER (C2 E CATRACA DE FERRO)
// =================================================================
function registrarEventosSniper(sockSniper, indice) {
    // 🕵️ COMANDOS C2 PARA SNIPER (!idgrupo, !ping)
    sockSniper.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || !msg.key) continue;

            const msgTime = Number(msg.messageTimestamp || 0);
            if (msgTime > 0 && msgTime < TEMPO_BOOT) continue;

            let texto = msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                "";

            texto = texto.trim().toLowerCase();
            if (texto !== '!idgrupo' && texto !== '!ping') continue;

            const senderId = normalizarJid(msg.key.participant || msg.key.remoteJid);
            const isMe = msg.key.fromMe;

            if (isMe || estaNaWhitelist(senderId)) {
                const hashCmd = `${msg.key.id}-cmd`;
                if (travasDeRedundancia.has(hashCmd)) continue;
                travasDeRedundancia.add(hashCmd);
                setTimeout(() => travasDeRedundancia.delete(hashCmd), 30000);

                const chatId = msg.key.remoteJid;

                if (texto === '!ping') {
                    await sockSniper.sendMessage(chatId, { text: `🏓 *Pong!* Sniper 0${indice} operacional e com artilharia pronta.` });
                } else if (texto === '!idgrupo') {
                    await sockSniper.sendMessage(chatId, { text: `📍 *ID DESTE GRUPO:*\n\n\`${chatId}\`` });
                    console.log(`\n[📡 COMANDO C2] ID do Grupo solicitado: ${chatId}`);
                }
            }
        }
    });

    // 🛑 CATRACA DE FERRO (Expulsão imediata se membro da Blacklist entrar)
    sockSniper.ev.on('group-participants.update', processarCatracaDeFerro);
}

// 🛑 PROCESSADOR UNIVERSAL DA CATRACA DE FERRO
async function processarCatracaDeFerro(evento) {
    if (evento.action !== 'add') return;

    for (let novato of evento.participants) {
        if (typeof novato === 'object' && novato !== null) novato = novato.id || novato.jid || "";
        if (!novato) continue;
        novato = String(novato);

        const hashEntrada = `${evento.id}-${novato}`;
        if (travasDeRedundancia.has(hashEntrada)) continue;

        const ehInimigo = estaNaBlacklist(novato);

        if (ehInimigo) {
            travasDeRedundancia.add(hashEntrada);
            setTimeout(() => travasDeRedundancia.delete(hashEntrada), 30000);

            const numPuro = novato.split('@')[0].split(':')[0].replace(/\D/g, '');
            console.log(`\n[🚪 CATRACA DE FERRO] Invasor da Blacklist na porta: ${numPuro || novato}`);

            let nomeGrupo = evento.id;
            try {
                const metadata = await obterMetadataSegura(evento.id);
                if (metadata) nomeGrupo = metadata.subject || evento.id;
            } catch (e) { }

            setTimeout(async () => {
                for (const sniper of frotaSnipers) {
                    if (!sniper || !sniper.user) continue;
                    try {
                        await sniper.groupParticipantsUpdate(evento.id, [novato], "remove");
                        console.log(`[✅ CATRACA] Invasor barrado pelo Sniper 0${frotaSnipers.indexOf(sniper) + 1}.`);
                        registrarEstatistica('BANIMENTO', numPuro || novato, nomeGrupo);
                        break;
                    } catch (err) { }
                }
            }, 1200);
        }
    }
}

// =================================================================
// 🛡️ RECONHECEDOR TÁTICO DE CONTEÚDO (ANTI-FALSO-POSITIVO ABSOLUTO)
// =================================================================
function desempacotarMensagem(message) {
    let m = message;
    for (let i = 0; i < 5; i++) {
        if (!m || typeof m !== 'object') break;
        if (m.ephemeralMessage?.message) { m = m.ephemeralMessage.message; continue; }
        if (m.viewOnceMessage?.message) { m = m.viewOnceMessage.message; continue; }
        if (m.viewOnceMessageV2?.message) { m = m.viewOnceMessageV2.message; continue; }
        if (m.viewOnceMessageV2Extension?.message) { m = m.viewOnceMessageV2Extension.message; continue; }
        if (m.documentWithCaptionMessage?.message) { m = m.documentWithCaptionMessage.message; continue; }
        break;
    }
    return m;
}

function ehInteracaoPermitidaOuSistema(msg) {
    if (!msg || !msg.message) return true;

    // 1. Aba de Respostas / Comentários em Avisos (Threads do WhatsApp)
    if (msg.commentMetadata) return true;
    if (msg.messageContextInfo?.commentMetadata) return true;
    if (msg.message?.commentMessage || msg.message?.encCommentMessage) return true;

    const rawMsg = msg.message;
    const innerMsg = desempacotarMensagem(rawMsg) || rawMsg;

    if (innerMsg.commentMessage || innerMsg.encCommentMessage) return true;

    // 2. Reações com Emojis (👍, ❤️, 😂, etc.)
    if (rawMsg.reactionMessage || rawMsg.encReactionMessage) return true;
    if (innerMsg.reactionMessage || innerMsg.encReactionMessage) return true;

    // 3. Votos em Enquetes existentes (Membro interagindo com enquete de ADM)
    if (rawMsg.pollUpdateMessage || innerMsg.pollUpdateMessage) return true;

    // 4. Stubs e Mensagens de Controle/Protocolo Interno do WhatsApp
    const tiposIgnorados = new Set([
        'protocolMessage',
        'senderKeyDistributionMessage',
        'messageContextInfo',
        'keepInChatMessage',
        'pinInChatMessage',
        'chatEventMessage',
        'callLogRecordMessage',
        'newsletterAdminInviteMessage',
        'requestPaymentMessage',
        'declinePaymentRequestMessage'
    ]);

    const chavesRaw = Object.keys(rawMsg);
    if (chavesRaw.length > 0 && chavesRaw.every(k => tiposIgnorados.has(k))) return true;

    const chavesInner = Object.keys(innerMsg);
    if (chavesInner.length > 0 && chavesInner.every(k => tiposIgnorados.has(k))) return true;

    // 5. ContextInfo indicando comentário/thread de aviso
    const contextInfo = innerMsg.extendedTextMessage?.contextInfo ||
                        innerMsg.imageMessage?.contextInfo ||
                        innerMsg.videoMessage?.contextInfo ||
                        innerMsg.audioMessage?.contextInfo ||
                        innerMsg.documentMessage?.contextInfo;
    if (contextInfo?.commentParentKey || contextInfo?.isComment) return true;

    return false;
}

function ehMensagemDiretaDeConteudo(msg) {
    if (!msg || !msg.message) return false;
    const innerMsg = desempacotarMensagem(msg.message) || msg.message;

    const tiposConteudoReal = [
        'conversation',
        'extendedTextMessage',
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'documentMessage',
        'stickerMessage',
        'contactMessage',
        'contactsArrayMessage',
        'locationMessage',
        'liveLocationMessage',
        'pollCreationMessage',
        'pollCreationMessageV2',
        'pollCreationMessageV3',
        'listMessage',
        'listResponseMessage',
        'buttonsMessage',
        'buttonsResponseMessage',
        'templateMessage',
        'templateButtonReplyMessage',
        'interactiveMessage',
        'interactiveResponseMessage',
        'ptvMessage',
        'orderMessage'
    ];

    return tiposConteudoReal.some(tipo => Boolean(innerMsg[tipo]));
}

// =================================================================
// 🕵️ LISTENERS DO ESPIÃO (100% PASSIVO E SILENCIOSO)
// =================================================================
function registrarEventosEspiao(sockEspiao, indice) {
    // Espião também vigia a porta para avisar os Snipers
    sockEspiao.ev.on('group-participants.update', processarCatracaDeFerro);

    sockEspiao.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || !msg.key || msg.key.fromMe) continue;

            const msgTime = Number(msg.messageTimestamp || 0);
            if (msgTime > 0 && msgTime < TEMPO_BOOT) continue;

            const chatId = msg.key.remoteJid;
            if (!isJidGroup(chatId)) continue;

            // 1. Filtro rigoroso: Permite Reações, Aba de Respostas (comentários) e Votos em Enquete
            if (ehInteracaoPermitidaOuSistema(msg)) continue;

            // 2. Garante que é uma mensagem direta real de conteúdo no feed principal
            if (!ehMensagemDiretaDeConteudo(msg)) continue;

            const senderBruto = msg.key.participant || msg.participant || msg.key.remoteJid;
            if (!senderBruto || senderBruto === chatId) continue;

            const senderId = normalizarJid(senderBruto);
            const messageId = msg.key.id;

            // Despacha a ocorrência completa ao Barramento Tático dos Snipers
            barramentoTatico.emit('ocorrencia_espiao', {
                espiaoIndice: indice,
                chatId,
                messageId,
                senderId,
                rawKey: msg.key,
                timestamp: msgTime
            });
        }
    });
}

// =================================================================
// 🎯 CENTRAL DE INTELIGÊNCIA E DISPARO DOS SNIPERS
// =================================================================
barramentoTatico.on('ocorrencia_espiao', async (alerta) => {
    const { chatId, messageId, senderId, rawKey } = alerta;

    // 1. Anti-duplicação: previne processamento duplicado se houver múltiplos espiões no mesmo grupo
    const hashMensagem = `${chatId}-${messageId}`;
    if (mensagensProcessadas.has(hashMensagem)) return;
    mensagensProcessadas.add(hashMensagem);
    setTimeout(() => mensagensProcessadas.delete(hashMensagem), 30000);

    // 2. Obtenção Segura dos Metadados do Grupo
    let metadata = await obterMetadataSegura(chatId);
    if (!metadata) {
        await sleep(600);
        metadata = await obterMetadataSegura(chatId, true);
    }

    // 🛡️ PROTEÇÃO ABSOLUTA CONTRA FALSOS POSITIVOS:
    if (!metadata || !Array.isArray(metadata.participants)) {
        console.log(`\n[⚠️ AUDITORIA] Não foi possível verificar participantes de ${chatId}. Ação abortada para evitar falso positivo.`);
        return;
    }

    // 3. Resolução completa e antecipada de identidade (LID -> Telefone Real)
    const identidade = resolverIdentidadeInvasor(senderId, metadata, rawKey);

    // 4. Checagem de Imunidade / Whitelist e bots próprios (com LID e Telefone Real)
    if (estaNaWhitelist(senderId, identidade)) {
        return; // Imune. Não faz nada.
    }

    // 5. Checagem: o remetente é Administrador do grupo? (validado por LID e Telefone Real)
    const remetenteEhAdmin = verificarSeEhAdmin(metadata, senderId, identidade);
    if (remetenteEhAdmin) {
        // É ADM DO GRUPO: NÃO FAZ NADA!
        return;
    }

    // 🚨 ==========================================================
    // INVASOR CONFIRMADO (NÃO É ADMIN) - DISPARO DE CONTRAMEDIDAS
    // ==========================================================
    const nomeGrupo = metadata.subject || chatId;
    const numInvasor = identidade.numero || senderId;
    console.log(`\n[💀 ALERTA MÁXIMO] Invasor detectado no grupo "${nomeGrupo}": ${numInvasor}`);

    // Escolhe o sniper mais apto (preferencialmente admin no grupo)
    const sniperOperador = obterSniperAdminDoGrupo(chatId, metadata);
    if (!sniperOperador) {
        console.log(`[❌ ERRO] Nenhum Sniper conectado para responder à ameaça.`);
        return;
    }

    // AÇÃO 1: APAGAR A MENSAGEM NA MESMA HORA (DELETE FOR EVERYONE)
    let msgApagada = false;
    try {
        await sniperOperador.sendMessage(chatId, {
            delete: {
                remoteJid: chatId,
                fromMe: false,
                id: messageId,
                participant: rawKey.participant || senderId
            }
        });
        msgApagada = true;
        registrarEstatistica('MENSAGEM');
        console.log(`[💥 MENSAGEM APAGADA] Mensagem do invasor eliminada em ${nomeGrupo}`);
    } catch (err) {
        console.log(`[!] Falha ao apagar mensagem (Sniper precisa ser admin do grupo):`, err?.message || err);
    }

    // AÇÃO 2: REMOVER O ID DO GRUPO ATUAL
    let removidoOrigem = false;
    try {
        await sniperOperador.groupParticipantsUpdate(chatId, [senderId], "remove");
        removidoOrigem = true;
        console.log(`[⛔ REMOVIDO] Invasor expulso de ${nomeGrupo}`);
    } catch (err) {
        console.log(`[!] Falha ao expulsar do grupo de origem:`, err?.message || err);
    }

    // AÇÃO 3: COLOCAR O NÚMERO NA BLACKLIST (Tanto o LID quanto o número de telefone real)
    adicionarNaBlacklist(senderId);
    if (identidade.jid && identidade.jid !== senderId) {
        adicionarNaBlacklist(identidade.jid);
    }
    if (identidade.numero) {
        adicionarNaBlacklist(identidade.numero);
    }

    // AÇÃO 4: "ORDEM 66" - REMOVER O ID DE TODOS OS OUTROS GRUPOS ONDE O SNIPER É ADMIN
    let banimentos = 0;
    const gruposVerificados = new Set([chatId]);
    const idAlvoNorm = normalizarID(senderId);
    const numInvasorPuro = extrairNumeroLimpo(numInvasor);

    for (const sniper of frotaSnipers) {
        if (!sniper || !sniper.user) continue;
        try {
            const todosOsGrupos = await sniper.groupFetchAllParticipating();
            for (const idGrupo in todosOsGrupos) {
                if (gruposVerificados.has(idGrupo)) continue;

                const grupoAlvo = todosOsGrupos[idGrupo];
                if (!grupoAlvo || !Array.isArray(grupoAlvo.participants)) continue;

                const alvoEscondido = grupoAlvo.participants.find(p => {
                    const pId = p.id ? String(p.id) : "";
                    const pLid = p.lid ? String(p.lid) : "";
                    const pJid = p.jid ? String(p.jid) : "";

                    return pId === senderId ||
                           pLid === senderId ||
                           (idAlvoNorm && normalizarID(pId) === idAlvoNorm) ||
                           (numInvasorPuro && numInvasorPuro.length >= 10 && pId.includes(numInvasorPuro)) ||
                           (numInvasorPuro && numInvasorPuro.length >= 10 && pJid.includes(numInvasorPuro)) ||
                           estaNaBlacklist(pId) ||
                           (pLid && estaNaBlacklist(pLid));
                });

                if (alvoEscondido) {
                    try {
                        await sniper.groupParticipantsUpdate(idGrupo, [alvoEscondido.id], "remove");
                        banimentos++;
                        gruposVerificados.add(idGrupo);
                        const nomeGrupoAfetado = grupoAlvo.subject || idGrupo;
                        registrarEstatistica('BANIMENTO', numInvasor, nomeGrupoAfetado);
                        console.log(`[🌍 ORDEM 66] Invasor eliminado também de "${nomeGrupoAfetado}"`);
                    } catch (e) { }
                } else {
                    gruposVerificados.add(idGrupo);
                }
            }
        } catch (e) { }
    }

    const gruposExpurgados = (removidoOrigem ? 1 : 0) + banimentos;

    if (removidoOrigem) {
        registrarEstatistica('BANIMENTO', numInvasor, nomeGrupo);
    }

    // AÇÃO 5: ENVIAR UM ALERTA NO GRUPO DE ALERTAS (Se configurado corretamente)
    const grupoAlertaValido = GRUPO_DE_ALERTAS &&
        GRUPO_DE_ALERTAS.includes('@g.us') &&
        GRUPO_DE_ALERTAS.replace(/\D/g, '').length >= 10;

    if (grupoAlertaValido) {
        const textoAlerta =
            `*🚨 INTERCEPTAÇÃO ANTI-HACKER BRABO*\n\n` +
            `*📍 Grupo Atacado:* ${nomeGrupo}\n` +
            `*👤 Invasor:* ${numInvasor}\n` +
            `*🗑️ Mensagem:* ${msgApagada ? 'Apagada Instantaneamente' : 'Falha na Exclusão'}\n` +
            `*⚙️ Status:* Neutralizado & Expurgado de ${gruposExpurgados} grupo(s).\n` +
            `*🛡️ Blacklist:* Número indexado e bloqueado.\n\n` +
            `_Operação Aegis - Sistema Ativo de Defesa_`;

        for (const sniper of frotaSnipers) {
            if (!sniper || !sniper.user) continue;
            try {
                await sniper.sendMessage(GRUPO_DE_ALERTAS, { text: textoAlerta });
                console.log(`[📡 ALERTA C2] Notificação de interceptação enviada com sucesso.`);
                break;
            } catch (err) { }
        }
    }
});

// =================================================================
// FUNÇÃO DE ATRASO
// =================================================================
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// =================================================================
// IGNIÇÃO SEQUENCIAL TOTAL (MULTIDÃO DE SNIPERS E ESPIÕES SEM TRAVAS)
// =================================================================
async function iniciarOperacaoAegis() {
    console.clear();

    const corBranca = '\x1b[1;37m';
    const corLaranja = '\x1b[38;5;208m';
    const corVerde = '\x1b[1;32m';
    const corVermelha = '\x1b[1;31m';
    const corCinza = '\x1b[90m';
    const reset = '\x1b[0m';

    console.log(corBranca + `
     █████╗ ███╗   ██╗████████╗██╗       ██╗  ██╗ █████╗  ██████╗ ██╗  ██╗███████╗██████╗ 
    ██╔══██╗████╗  ██║╚══██╔══╝██║       ██║  ██║██╔══██╗██╔════╝ ██║ ██╔╝██╔════╝██╔══██╗
    ███████║██╔██╗ ██║   ██║   ██║ █████╗███████║███████║██║      █████╔╝ █████╗  ██████╔╝
    ██╔══██║██║╚██╗██║   ██║   ██║ ╚════╝██╔══██║██╔══██║██║      ██╔═██╗ ██╔══╝  ██╔══██╗
    ██║  ██║██║ ╚████║   ██║   ██║       ██║  ██║██║  ██║╚██████╗ ██║  ██╗███████╗██║  ██║
    ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝       ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝` +
        corLaranja + `
                    ██████╗ ██████╗  █████╗ ██████╗  ██████╗ 
                    ██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔═══██╗
                    ██████╦╝██████╔╝███████║██████╦╝██║   ██║
                    ██╔══██╗██╔══██╗██╔══██║██╔══██╗██║   ██║
                    ██████╦╝██║  ██║██║  ██║██████╦╝╚██████╔╝
                    ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝ 
    ` + reset);

    console.log(corLaranja + `[ ⚠ ] CARREGANDO MOTOR DE DEFESA (AEGIS v8.2 SEQUENCIAL MULTI-AGENTES)` + reset + `\n`);

    await sleep(300);
    console.log(corBranca + `[BOOT] Inicializando Kernel Tático... ` + corLaranja + `[OK]` + reset);

    carregarBancosDeDadosParaRAM();
    console.log(corBranca + `[BOOT] Injetando Bancos de Dados na Memória RAM (Zero Disk I/O)... ` + corLaranja + `[OK]` + reset);

    await sleep(200);
    console.log(corBranca + `[BOOT] Configurando Barramento Tático de Eventos... ` + corLaranja + `[OK]` + reset);
    console.log(corBranca + `[BOOT] Injetando Debounce anti-EMFILE e Proteção Anti-Falso-Positivo... ` + corLaranja + `[OK]` + reset);

    // 1. INICIALIZAÇÃO SEQUENCIAL DOS SNIPERS
    console.log(corBranca + `\n[BOOT] Conectando Frota de Snipers (${QTD_SNIPERS} configurado(s))...` + reset);
    for (let i = 1; i <= QTD_SNIPERS; i++) {
        await conectarAgente({
            tipo: 'SNIPER',
            indice: i,
            pastaAuth: `auth_sniper_${i}`
        });
    }

    // 2. INICIALIZAÇÃO SEQUENCIAL DOS ESPIÕES
    console.log(corBranca + `\n[BOOT] Conectando Frota de Espiões (${QTD_ESPIOES} configurado(s))...` + reset);
    for (let i = 1; i <= QTD_ESPIOES; i++) {
        await conectarAgente({
            tipo: 'ESPIÃO',
            indice: i,
            pastaAuth: `auth_spotter_${i}`
        });
    }

    console.log(corBranca + `\n[BOOT] Aguardando calibração do rádio (3 segundos)...` + reset);
    await sleep(3000);

    // 🚀 ENVIO NÃO-BLOQUEANTE DO C2 NO GRUPO DE ALERTAS
    const grupoAlertaValido = GRUPO_DE_ALERTAS &&
        GRUPO_DE_ALERTAS.includes('@g.us') &&
        GRUPO_DE_ALERTAS.replace(/\D/g, '').length >= 10;

    if (grupoAlertaValido) {
        const msgBoot = `*🟢 SISTEMA ANTI-HACKER BRABO ONLINE*\n\n` +
            `_Defesas ativadas. ${QTD_ESPIOES} Espiões infiltrados e ${QTD_SNIPERS} Snipers em posição de tiro._ 🛡️\n\n` +
	    `_⚫ [Black Vitalicia e Base Forte] ⚫_`;

        (async () => {
            for (const sniper of frotaSnipers) {
                if (!sniper || !sniper.user) continue;
                try {
                    await Promise.race([
                        sniper.sendMessage(GRUPO_DE_ALERTAS, { text: msgBoot }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 6000))
                    ]);
                    console.log(`\n` + corVerde + `[ 📡 C2 ONLINE ] Mensagem de inicialização enviada ao painel de alertas.` + reset);
                    break;
                } catch (err) { }
            }
        })();
    } else {
        console.log(corCinza + `[ ℹ ] GRUPO_DE_ALERTAS ainda não configurado ou incompleto. Use o comando !idgrupo dentro do grupo desejado para configurá-lo.` + reset);
    }

    console.log(corCinza + `\n=================================================================` + reset);
    console.log(corVerde + `[ 🟢 STATUS ] REDE DE SEGURANÇA MÁXIMA ONLINE.` + reset);
    console.log(corLaranja + `[ 🎯 TÁTICA ] ${QTD_ESPIOES} Espião(ões) em silêncio. ${QTD_SNIPERS} Sniper(s) armado(s).` + reset);
    console.log(corVermelha + `[ 💀 AMEAÇA ] Zero tolerância. O primeiro erro será o último.` + reset);
    console.log(corCinza + `=================================================================\n` + reset);
}

iniciarOperacaoAegis();