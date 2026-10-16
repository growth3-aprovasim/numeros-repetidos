// =====================================================================
// 🔍 AEGIS AUDITOR: VARREDURA DE MEMBROS EM MÚLTIPLOS GRUPOS (DRY-RUN)
// Modo de Leitura: NÃO remove ninguém, apenas audita e gera o relatório.
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

// Normalizações de identidade
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

async function auditar() {
    console.log('\n=================================================================');
    console.log('🛡️  INICIANDO AUDITORIA DE GRUPOS - OPERAÇÃO AEGIS [BLACK 26]');
    console.log('    Regra: Participantes em 3 ou mais grupos serão reduzidos a 1');
    console.log('    Modo: 100% SEGURO / SOMENTE LEITURA (DRY-RUN)');
    console.log('=================================================================\n');

    const whitelist = carregarWhitelist();
    console.log(`📋 Números na Whitelist carregados: ${whitelist.length}`);

    // Conectar usando auth_sniper_1 (já pareado)
    const { state } = await useMultiFileAuthState(path.join(__dirname, 'auth_sniper_1'));
    if (!state.creds.registered) {
        console.error('❌ Sniper 1 não está registrado. Impossível realizar varredura.');
        process.exit(1);
    }

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
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                // não reconecta aqui, pois é um script one-off
            }
        }

        if (connection === 'open') {
            console.log('✅ Conectado ao WhatsApp com sucesso via Sniper 1!');
            console.log('🔄 Mapeando todos os grupos participantes...');

            try {
                const todosOsGrupos = await sock.groupFetchAllParticipating();
                const listaGrupos = Object.values(todosOsGrupos);

                console.log(`📊 Total de grupos encontrados: ${listaGrupos.length}\n`);

                // 1. Identificar todos os Admins de todos os grupos (Imunidade Global de ADM)
                const mapaAdminsGlobais = new Set();
                const mapaLidParaTelefone = new Map();

                for (const g of listaGrupos) {
                    for (const p of (g.participants || [])) {
                        const numLimpo = extrairNumeroLimpo(p.id || p.jid);
                        const idNorm = normalizarID(p.id || p.jid);
                        
                        // Mapear LIDs
                        if (p.lid && p.jid) {
                            mapaLidParaTelefone.set(extrairNumeroLimpo(p.lid), extrairNumeroLimpo(p.jid));
                        }
                        if (p.lid && p.id && p.id.includes('@s.whatsapp.net')) {
                            mapaLidParaTelefone.set(extrairNumeroLimpo(p.lid), extrairNumeroLimpo(p.id));
                        }

                        if (p.admin === 'admin' || p.admin === 'superadmin') {
                            if (numLimpo) mapaAdminsGlobais.add(numLimpo);
                            if (idNorm) mapaAdminsGlobais.add(idNorm);
                        }
                    }
                }

                console.log(`👑 Total de Administradores identificados (Imunes): ${mapaAdminsGlobais.size}`);

                // 2. Mapear presença de cada participante nos grupos
                // chave: numeroLimpo ou idNorm -> { numero, jid, lid, grupos: [ { id, subject, creation } ] }
                const mapaPresenca = new Map();

                for (const g of listaGrupos) {
                    const grupoInfo = {
                        id: g.id,
                        subject: g.subject || g.id,
                        creation: g.creation || 0
                    };

                    for (const p of (g.participants || [])) {
                        let idBruto = p.id || p.jid;
                        let numLimpo = extrairNumeroLimpo(idBruto);

                        // Se for LID, tentar resolver para número real
                        if (idBruto.includes('@lid') && mapaLidParaTelefone.has(numLimpo)) {
                            numLimpo = mapaLidParaTelefone.get(numLimpo);
                        }

                        if (!numLimpo) continue;
                        const idNorm = normalizarID(numLimpo);

                        // Chave de agrupamento: id normalizado para agrupar 9º dígito / DDI
                        const chave = idNorm || numLimpo;

                        if (!mapaPresenca.has(chave)) {
                            mapaPresenca.set(chave, {
                                numero: numLimpo,
                                idNorm: idNorm,
                                jidOriginal: idBruto,
                                ehAdmin: false,
                                ehWhitelist: false,
                                grupos: []
                            });
                        }

                        const registro = mapaPresenca.get(chave);

                        // Checa se é Admin
                        if (mapaAdminsGlobais.has(numLimpo) || mapaAdminsGlobais.has(idNorm) || p.admin === 'admin' || p.admin === 'superadmin') {
                            registro.ehAdmin = true;
                        }

                        // Checa Whitelist
                        if (whitelist.some(w => normalizarID(w) === idNorm || extrairNumeroLimpo(w) === numLimpo)) {
                            registro.ehWhitelist = true;
                        }

                        // Adiciona grupo sem duplicar
                        if (!registro.grupos.some(grp => grp.id === grupoInfo.id)) {
                            registro.grupos.push(grupoInfo);
                        }
                    }
                }

                // 3. Filtrar quem está em 5 ou mais grupos
                const alvosParaTratar = [];
                let totalLeadsEm5MaisGrupos = 0;
                let totalRemocoes = 0;

                for (const [chave, dados] of mapaPresenca.entries()) {
                    if (dados.grupos.length >= 5) {
                        totalLeadsEm5MaisGrupos++;

                        if (dados.ehAdmin) {
                            // Imune: Administrador
                            continue;
                        }
                        if (dados.ehWhitelist) {
                            // Imune: Whitelist
                            continue;
                        }

                        // Ordenar grupos pelo mais antigo (creation timestamp ascendente, fallback para nome)
                        const gruposOrdenados = [...dados.grupos].sort((a, b) => {
                            if (a.creation && b.creation && a.creation !== b.creation) {
                                return a.creation - b.creation;
                            }
                            return a.subject.localeCompare(b.subject, undefined, { numeric: true });
                        });

                        const grupoManter = gruposOrdenados[0];
                        const gruposRemover = gruposOrdenados.slice(1);

                        totalRemocoes += gruposRemover.length;

                        alvosParaTratar.push({
                            numero: dados.numero,
                            totalGrupos: dados.grupos.length,
                            grupoManter: grupoManter.subject,
                            gruposRemover: gruposRemover.map(g => g.subject)
                        });
                    }
                }

                // 4. Exibir o Relatório Formatado
                console.log('\n=================================================================');
                console.log('📋 RELATÓRIO DE AUDITORIA PRÉVIA (DRY-RUN)');
                console.log('=================================================================');

                if (alvosParaTratar.length === 0) {
                    console.log('✨ Nenhum número não-autorizado foi encontrado em 5 ou mais grupos!');
                } else {
                    console.log(`🚨 Foram encontrados ${alvosParaTratar.length} número(s) para remoção (em 5 ou mais grupos):\n`);

                    alvosParaTratar.forEach((alvo, idx) => {
                        console.log(`[#${idx + 1}] Número: ${alvo.numero}`);
                        console.log(`     Presente em: ${alvo.totalGrupos} grupos`);
                        console.log(`     🟢 MANTER EM: "${alvo.grupoManter}" (Grupo mais antigo/primeiro)`);
                        console.log(`     🔴 REMOVER DE (${alvo.gruposRemover.length} grupos):`);
                        alvo.gruposRemover.forEach(nome => console.log(`        - ${nome}`));
                        console.log('-----------------------------------------------------------------');
                    });
                }

                console.log('\n=================================================================');
                console.log('📊 RESUMO FINAL DA OPERAÇÃO:');
                console.log(`   • Total de números detectados em 5+ grupos: ${totalLeadsEm5MaisGrupos}`);
                console.log(`   • Números imunes protegidos (Admins / Whitelist): ${totalLeadsEm5MaisGrupos - alvosParaTratar.length}`);
                console.log(`   • Números que serão afetados: ${alvosParaTratar.length}`);
                console.log(`   • TOTAL DE REMOÇÕES DE LEADS (KICKS): ${totalRemocoes}`);
                console.log('=================================================================\n');

                // Salvar resultado em arquivo JSON para consulta
                fs.writeFileSync(
                    path.join(__dirname, 'resultado_auditoria.json'),
                    JSON.stringify({ dataAuditoria: new Date().toISOString(), alvosParaTratar, totalRemocoes }, null, 2)
                );
                console.log('💾 Relatório salvo em "resultado_auditoria.json".');

                setTimeout(() => process.exit(0), 1000);
            } catch (err) {
                console.error('❌ Erro durante a varredura:', err);
                process.exit(1);
            }
        }
    });
}

auditar();
