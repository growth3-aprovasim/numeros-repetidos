// =====================================================================
// 🔍 AEGIS AUDITOR: BLACK VITALÍCIA (FASE 1) & BASE FORTE (FASE 2)
// Modo: SOMENTE LEITURA (DRY-RUN) - Nenhuma remoção é feita
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

const ARQUIVO_WHITELIST = path.join(__dirname, 'whitelist_aegis.json');

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

function carregarWhitelist() {
    try {
        if (!fs.existsSync(ARQUIVO_WHITELIST)) return [];
        const raw = JSON.parse(fs.readFileSync(ARQUIVO_WHITELIST, 'utf-8'));
        if (Array.isArray(raw)) {
            return raw.map(extrairNumeroLimpo).filter(Boolean);
        }
    } catch (e) {
        console.error('[!] Erro ao carregar whitelist_aegis.json:', e.message);
    }
    return [];
}

async function auditarCampanhas() {
    const whitelist = carregarWhitelist();
    console.log(`📋 Whitelist carregada: ${whitelist.length} números imunes.`);

    const { state } = await useMultiFileAuthState(path.join(__dirname, 'auth_sniper_1'));
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;

        if (connection === 'open') {
            console.log('✅ Sniper 1 conectado com sucesso!');
            console.log('🔍 Puxando todos os grupos e metadados...');

            const todosOsGrupos = await sock.groupFetchAllParticipating();
            const listaGrupos = Object.values(todosOsGrupos);

            // 1. Identificar Admins Globais e LIDs
            const adminsGlobais = new Set();
            const mapaLidParaTelefone = new Map();

            for (const g of listaGrupos) {
                for (const p of (g.participants || [])) {
                    const numLimpo = extrairNumeroLimpo(p.id || p.jid);
                    const idNorm = normalizarID(p.id || p.jid);

                    if (p.lid && p.jid) mapaLidParaTelefone.set(extrairNumeroLimpo(p.lid), extrairNumeroLimpo(p.jid));
                    if (p.lid && p.id && p.id.includes('@s.whatsapp.net')) mapaLidParaTelefone.set(extrairNumeroLimpo(p.lid), extrairNumeroLimpo(p.id));

                    if (p.admin === 'admin' || p.admin === 'superadmin') {
                        if (numLimpo) adminsGlobais.add(numLimpo);
                        if (idNorm) adminsGlobais.add(idNorm);
                    }
                }
            }

            console.log(`👑 Total de Administradores imunes identificados: ${adminsGlobais.size}`);

            // 2. Separar grupos por campanha
            const gruposBlack = listaGrupos.filter(g => /black|vital[ií]cia/i.test(g.subject));
            const gruposBaseForte = listaGrupos.filter(g => /base\s*forte/i.test(g.subject));

            console.log(`🎯 Grupos Black Vitalícia encontrados: ${gruposBlack.length}`);
            console.log(`🎯 Grupos Desafio Base Forte encontrados: ${gruposBaseForte.length}`);

            function processarCampanha(nomeCampanha, grupos) {
                const mapaMembros = new Map();

                for (const g of grupos) {
                    const infoGrupo = {
                        id: g.id,
                        subject: g.subject || g.id,
                        creation: g.creation || 0
                    };

                    for (const p of (g.participants || [])) {
                        let idBruto = p.id || p.jid;
                        let numLimpo = extrairNumeroLimpo(idBruto);
                        if (idBruto.includes('@lid') && mapaLidParaTelefone.has(numLimpo)) {
                            numLimpo = mapaLidParaTelefone.get(numLimpo);
                        }
                        if (!numLimpo) continue;

                        const idNorm = normalizarID(numLimpo);
                        const chave = idNorm || numLimpo;

                        if (!mapaMembros.has(chave)) {
                            mapaMembros.set(chave, {
                                numero: numLimpo,
                                idNorm: idNorm,
                                ehAdmin: false,
                                ehWhitelist: false,
                                grupos: []
                            });
                        }

                        const reg = mapaMembros.get(chave);

                        if (adminsGlobais.has(numLimpo) || adminsGlobais.has(idNorm) || p.admin === 'admin' || p.admin === 'superadmin') {
                            reg.ehAdmin = true;
                        }

                        if (whitelist.some(w => normalizarID(w) === idNorm || extrairNumeroLimpo(w) === numLimpo)) {
                            reg.ehWhitelist = true;
                        }

                        if (!reg.grupos.some(x => x.id === infoGrupo.id)) {
                            reg.grupos.push(infoGrupo);
                        }
                    }
                }

                const alvos = [];
                let totalKicks = 0;

                for (const [chave, dados] of mapaMembros.entries()) {
                    if (dados.grupos.length >= 5) {
                        if (dados.ehAdmin || dados.ehWhitelist) continue;

                        // Ordenação: menor número / mais antigo
                        const ordenados = [...dados.grupos].sort((a, b) => {
                            if (a.creation && b.creation && a.creation !== b.creation) {
                                return a.creation - b.creation;
                            }
                            return a.subject.localeCompare(b.subject, undefined, { numeric: true });
                        });

                        const grupoManter = ordenados[0];
                        const gruposRemover = ordenados.slice(1);

                        totalKicks += gruposRemover.length;
                        alvos.push({
                            numero: dados.numero,
                            totalGrupos: dados.grupos.length,
                            grupoManter: grupoManter.subject,
                            idGrupoManter: grupoManter.id,
                            gruposRemover: gruposRemover.map(g => ({ id: g.id, subject: g.subject }))
                        });
                    }
                }

                return {
                    nomeCampanha,
                    totalGruposCampanha: grupos.length,
                    totalAlvos: alvos.length,
                    totalKicks,
                    alvos
                };
            }

            const resBlack = processarCampanha('Black Vitalícia (FASE 1)', gruposBlack);
            const resBaseForte = processarCampanha('Desafio Base Forte (FASE 2)', gruposBaseForte);

            const relatorioFinal = {
                dataGeracao: new Date().toISOString(),
                fase1_black: resBlack,
                fase2_baseForte: resBaseForte
            };

            fs.writeFileSync(path.join(__dirname, 'resultado_campanhas.json'), JSON.stringify(relatorioFinal, null, 2));

            console.log('\n=================================================================');
            console.log(`📊 RESULTADO FASE 1: ${resBlack.nomeCampanha}`);
            console.log(`   • Total de Grupos no Escopo: ${resBlack.totalGruposCampanha}`);
            console.log(`   • Números que estão em 5 ou mais grupos: ${resBlack.totalAlvos}`);
            console.log(`   • Total de Kicks necessários (Leads removidos): ${resBlack.totalKicks}`);
            console.log('=================================================================');

            console.log('\n=================================================================');
            console.log(`📊 RESULTADO FASE 2: ${resBaseForte.nomeCampanha}`);
            console.log(`   • Total de Grupos no Escopo: ${resBaseForte.totalGruposCampanha}`);
            console.log(`   • Números que estão em 5 ou mais grupos: ${resBaseForte.totalAlvos}`);
            console.log(`   • Total de Kicks necessários (Leads removidos): ${resBaseForte.totalKicks}`);
            console.log('=================================================================\n');

            setTimeout(() => process.exit(0), 1000);
        }
    });
}

auditarCampanhas();
