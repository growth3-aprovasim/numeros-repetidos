// =====================================================================
// 🔍 REAVALIAÇÃO DA AUDITORIA - 4 SNIPERS CONSOLIDADOS + WHITELIST COMPLETA
// =====================================================================
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');

const ARQUIVO_WHITELIST = path.join(__dirname, 'whitelist_aegis.json');
const ARQUIVO_RESULTADO = path.join(__dirname, 'resultado_campanhas.json');

const whitelistRaw = JSON.parse(fs.readFileSync(ARQUIVO_WHITELIST, 'utf-8'));
const whitelistLimpa = whitelistRaw.map(x => String(x).replace(/\D/g, '')).filter(Boolean);

function extrairNumero(p) {
    if (p.jid && p.jid.includes('@s.whatsapp.net')) return p.jid.split('@')[0];
    if (p.id && p.id.includes('@s.whatsapp.net')) return p.id.split('@')[0];
    if (p.phoneNumber) return String(p.phoneNumber).replace(/\D/g, '');
    return null;
}

function normalizarID(num) {
    if (!num) return '';
    num = String(num).replace(/\D/g, '');
    if (num.startsWith('55') && (num.length === 12 || num.length === 13)) num = num.substring(2);
    if (num.length === 11 && num[2] === '9') num = num.substring(0, 2) + num.substring(3);
    return num;
}

function estaNaWhitelist(num) {
    if (!num) return false;
    const nLimpo = String(num).replace(/\D/g, '');
    const nNorm = normalizarID(num);

    return whitelistLimpa.some(w => {
        const wNorm = normalizarID(w);
        if (w === nLimpo) return true;
        if (wNorm && nNorm && wNorm === nNorm) return true;
        if (nLimpo.length >= 10 && w.length >= 10 && (w.includes(nLimpo) || nLimpo.includes(w))) return true;
        return false;
    });
}

async function auditarComWhitelistCompleta() {
    console.log('\n=================================================================');
    console.log('🛡️  REAVALIAÇÃO COM WHITELIST COMPLETA (4 SNIPERS CONSOLIDADOS)');
    console.log(`📋 Entradas na Whitelist carregadas: ${whitelistLimpa.length}`);
    console.log('=================================================================\n');

    const allGroups = new Map();
    const admins = new Set();

    for (let i = 1; i <= 4; i++) {
        try {
            const auth = await useMultiFileAuthState(path.join(__dirname, `auth_sniper_${i}`));
            if (!auth.state.creds.registered) continue;

            const sock = makeWASocket({ auth: auth.state, logger: pino({ level: 'silent' }) });
            await new Promise((resolve) => {
                sock.ev.on('connection.update', async ({ connection }) => {
                    if (connection === 'open') {
                        const all = await sock.groupFetchAllParticipating();
                        const black = Object.values(all).filter(g => /black|vital[ií]cia/i.test(g.subject));
                        console.log(`[🎯 Sniper 0${i}] Conectado - Grupos Black mapeados: ${black.length}`);

                        for (const g of black) {
                            for (const p of g.participants) {
                                if (p.admin === 'admin' || p.admin === 'superadmin') {
                                    const n = extrairNumero(p);
                                    if (n) {
                                        admins.add(n);
                                        admins.add(normalizarID(n));
                                    }
                                }
                            }
                            if (!allGroups.has(g.id) || allGroups.get(g.id).participants.length < g.participants.length) {
                                allGroups.set(g.id, g);
                            }
                        }
                        resolve();
                    }
                });
            });
        } catch (e) {
            console.error(`[!] Erro no Sniper 0${i}:`, e.message);
        }
    }

    // Filtra apenas os 28 grupos oficiais da campanha Black Vitalícia com leads (>20 membros)
    const gruposOficiais = Array.from(allGroups.values()).filter(g => g.participants.length > 20);
    console.log(`\n✅ Total de Grupos Oficiais Ativos da Black: ${gruposOficiais.length}`);
    console.log(`👑 Total de Administradores identificados: ${admins.size}`);

    const mapaLeads = new Map();

    for (const g of gruposOficiais) {
        const infoGrupo = {
            id: g.id,
            subject: g.subject || g.id,
            creation: g.creation || 0
        };

        const jaVistoNoGrupo = new Set();

        for (const p of g.participants) {
            const num = extrairNumero(p);
            if (!num) continue;
            const idN = normalizarID(num);

            if (jaVistoNoGrupo.has(idN)) continue;
            jaVistoNoGrupo.add(idN);

            if (!mapaLeads.has(idN)) {
                mapaLeads.set(idN, {
                    numero: num,
                    idNorm: idN,
                    ehAdmin: false,
                    ehWhitelist: false,
                    grupos: []
                });
            }

            const reg = mapaLeads.get(idN);

            // Checagem de Administrador
            if (admins.has(num) || admins.has(idN) || p.admin === 'admin' || p.admin === 'superadmin') {
                reg.ehAdmin = true;
            }

            // Checagem de Whitelist Completa
            if (estaNaWhitelist(num) || estaNaWhitelist(idN)) {
                reg.ehWhitelist = true;
            }

            reg.grupos.push(infoGrupo);
        }
    }

    const alvosParaRemover = [];
    let totalKicks = 0;
    let totalEm5Mais = 0;
    let totalProtegidosWhitelist = 0;
    let totalProtegidosAdmin = 0;

    for (const [idN, dados] of mapaLeads.entries()) {
        if (dados.grupos.length >= 5) {
            totalEm5Mais++;

            if (dados.ehWhitelist) {
                totalProtegidosWhitelist++;
                continue;
            }
            if (dados.ehAdmin) {
                totalProtegidosAdmin++;
                continue;
            }

            // Ordena pelo 1º grupo de entrada (mais antigo por timestamp de criação e numeração)
            dados.grupos.sort((a, b) => {
                if (a.creation && b.creation && a.creation !== b.creation) {
                    return a.creation - b.creation;
                }
                return a.subject.localeCompare(b.subject, undefined, { numeric: true });
            });

            const manter = dados.grupos[0];
            const remover = dados.grupos.slice(1);

            totalKicks += remover.length;

            alvosParaRemover.push({
                numero: dados.numero,
                totalGrupos: dados.grupos.length,
                grupoManter: manter.subject,
                idGrupoManter: manter.id,
                gruposRemover: remover.map(g => ({ id: g.id, subject: g.subject }))
            });
        }
    }

    // Estatísticas de distribuição
    const distribuicao = {};
    alvosParaRemover.forEach(a => {
        distribuicao[`${a.totalGrupos} grupos`] = (distribuicao[`${a.totalGrupos} grupos`] || 0) + 1;
    });

    console.log('\n=================================================================');
    console.log('📊 RESULTADOS ATUALIZADOS APÓS APLICAÇÃO DA SUA WHITELIST:');
    console.log(`   • Total bruto de números em 5+ grupos: ${totalEm5Mais}`);
    console.log(`   • Protegidos pela sua Whitelist: ${totalProtegidosWhitelist} números`);
    console.log(`   • Protegidos por cargo de Admin: ${totalProtegidosAdmin} números`);
    console.log(`   • TOTAL LÍQUIDO DE LEADS PARA REMOVER: ${alvosParaRemover.length}`);
    console.log(`   • TOTAL DE KICKS (REMOÇÕES DE EXCEDENTES): ${totalKicks}`);
    console.log('=================================================================');

    console.log('\n📈 DISTRIBUIÇÃO DOS LEADS REPETIDOS:');
    console.table(distribuicao);

    console.log('\n🔥 TOP 10 LEADS COM MAIOR NÚMERO DE GRUPOS:');
    const top10 = alvosParaRemover.sort((a, b) => b.totalGrupos - a.totalGrupos).slice(0, 10);
    console.table(top10.map(x => ({
        numero: x.numero,
        totalGrupos: x.totalGrupos,
        grupoManter: x.grupoManter,
        kicks: x.gruposRemover.length
    })));

    // Salvar o resultado consolidado
    fs.writeFileSync(ARQUIVO_RESULTADO, JSON.stringify({
        dataGeracao: new Date().toISOString(),
        fase1_black: {
            nomeCampanha: 'Black Vitalícia (28 Grupos Oficiais Consolidados)',
            totalGruposCampanha: gruposOficiais.length,
            totalAlvos: alvosParaRemover.length,
            totalKicks: totalKicks,
            alvos: alvosParaRemover
        }
    }, null, 2));

    console.log(`\n💾 Relatório atualizado gravado em "${ARQUIVO_RESULTADO}".`);
    setTimeout(() => process.exit(0), 1000);
}

auditarComWhitelistCompleta();
