// =====================================================================
// 🚀 SENDFLOW SERVICE // INTEGRAÇÃO API & GESTÃO DE CAMPANHAS ATIVAS
// Sincronização automática a cada 12 horas, cache em disco e gestão de ADMs por campanha
// =====================================================================
require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const ARQUIVO_CAMPANHAS = path.join(__dirname, 'sendflow_campanhas_ativas.json');
const ARQUIVO_CAMPANHAS_ADMS = path.join(__dirname, 'campanhas_adms.json');

const SENDFLOW_API_KEY = process.env.SENDFLOW_API_KEY || '';
const BASE_URL = process.env.SENDFLOW_BASE_URL || 'https://sendflow.pro/sendapi';
const INTERVALO_12_HORAS_MS = 12 * 60 * 60 * 1000;

// Estado em memória
let cacheCampanhas = {
    ultimaAtualizacao: null,
    proximaAtualizacaoPrevista: null,
    totalCampanhasAtivas: 0,
    totalGrupos: 0,
    campanhas: []
};

let cacheAdmsCampanhas = {}; // releaseId -> [ { numero, nome, adicionadoEm } ]

let statusSincronizacao = {
    emAndamento: false,
    ultimaTentativa: null,
    status: 'idle', // 'idle' | 'sincronizando' | 'sucesso' | 'rate_limited' | 'erro'
    mensagem: 'Aguardando inicialização',
    retryAfterMs: null
};

let timerAgendamento = null;
let callbackNotificacao = null;

function extrairNumeroLimpo(raw) {
    if (!raw) return '';
    return String(raw).split('@')[0].split(':')[0].replace(/\D/g, '');
}

function normalizarTelefoneBR(raw) {
    let num = extrairNumeroLimpo(raw);
    if (!num) return '';
    if (num.length === 10 || num.length === 11) {
        num = '55' + num;
    }
    return num;
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

function normalizarID(num) {
    if (!num) return '';
    num = String(num).replace(/\D/g, '');
    if (num.startsWith('55') && (num.length === 12 || num.length === 13)) {
        num = num.substring(2);
    }
    if (num.length === 11 && num[2] === '9') {
        num = num.substring(0, 2) + num.substring(3);
    }
    return num;
}

function obterApiKey() {
    return process.env.SENDFLOW_API_KEY || DEFAULT_API_KEY;
}

// Requisição HTTP genérica para o SendFlow
function requestSendflow(caminho) {
    return new Promise((resolve) => {
        const apiKey = obterApiKey();
        const urlStr = BASE_URL + caminho;
        const u = new URL(urlStr);

        const options = {
            hostname: u.hostname,
            port: 443,
            path: u.pathname + u.search,
            method: 'GET',
            timeout: 20000,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'AegisC2-Sentinel/8.0'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = null;
                }
                resolve({
                    statusCode: res.statusCode,
                    data: parsed,
                    raw: data
                });
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ statusCode: 408, erro: 'Timeout na requisição SendFlow' });
        });

        req.on('error', (err) => {
            resolve({ statusCode: 500, erro: err.message });
        });

        req.end();
    });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// =====================================================================
// 💾 CARREGAMENTO E SALVAMENTO DE ARQUIVOS LOCAIS
// =====================================================================
function carregarAdmsCampanhas() {
    try {
        if (fs.existsSync(ARQUIVO_CAMPANHAS_ADMS)) {
            const raw = JSON.parse(fs.readFileSync(ARQUIVO_CAMPANHAS_ADMS, 'utf-8'));
            if (typeof raw === 'object' && raw !== null) {
                cacheAdmsCampanhas = raw;
                return cacheAdmsCampanhas;
            }
        }
    } catch (e) {
        console.error('[!] Erro ao carregar campanhas_adms.json:', e.message);
    }
    cacheAdmsCampanhas = {};
    return cacheAdmsCampanhas;
}

function salvarAdmsCampanhas() {
    try {
        fs.writeFileSync(ARQUIVO_CAMPANHAS_ADMS, JSON.stringify(cacheAdmsCampanhas, null, 2), 'utf-8');
    } catch (e) {
        console.error('[!] Erro ao salvar campanhas_adms.json:', e.message);
    }
}

function carregarCampanhasLocais() {
    carregarAdmsCampanhas();
    try {
        if (fs.existsSync(ARQUIVO_CAMPANHAS)) {
            const raw = JSON.parse(fs.readFileSync(ARQUIVO_CAMPANHAS, 'utf-8'));
            if (raw && Array.isArray(raw.campanhas)) {
                cacheCampanhas = {
                    ultimaAtualizacao: raw.ultimaAtualizacao || new Date().toISOString(),
                    proximaAtualizacaoPrevista: raw.proximaAtualizacaoPrevista || new Date(Date.now() + INTERVALO_12_HORAS_MS).toISOString(),
                    totalCampanhasAtivas: raw.campanhas.length,
                    totalGrupos: raw.campanhas.reduce((acc, c) => acc + (c.grupos ? c.grupos.length : (c.totalGrupos || 0)), 0),
                    campanhas: raw.campanhas
                };
                console.log(`[💾 SendFlow Cache] ${cacheCampanhas.totalCampanhasAtivas} campanhas ativas carregadas do disco (${cacheCampanhas.totalGrupos} grupos).`);
                return cacheCampanhas;
            }
        }
    } catch (e) {
        console.error('[!] Erro ao ler sendflow_campanhas_ativas.json:', e.message);
    }

    // Inicialização padrão com as campanhas oficiais conhecidas caso arquivo ainda não exista
    cacheCampanhas = {
        ultimaAtualizacao: null,
        proximaAtualizacaoPrevista: new Date(Date.now() + INTERVALO_12_HORAS_MS).toISOString(),
        totalCampanhasAtivas: 2,
        totalGrupos: 55,
        campanhas: [
            {
                id: '1mVRQCG59lTdqDxWZn3n',
                name: 'Black Vitalícia [BV-26]',
                type: 'WhatsRelease',
                archived: false,
                totalGrupos: 28,
                grupos: []
            },
            {
                id: 'FeirPHs7jY1cgayuSles',
                name: 'Base Forte 2026',
                type: 'WhatsRelease',
                archived: false,
                totalGrupos: 27,
                grupos: []
            }
        ]
    };
    return cacheCampanhas;
}

function salvarCampanhasLocais() {
    try {
        fs.writeFileSync(ARQUIVO_CAMPANHAS, JSON.stringify(cacheCampanhas, null, 2), 'utf-8');
    } catch (e) {
        console.error('[!] Erro ao salvar sendflow_campanhas_ativas.json:', e.message);
    }
}

// =====================================================================
// 🔄 SINCRONIZAÇÃO COMPLETA COM O SENDFLOW (API)
// =====================================================================
async function sincronizarCampanhasSendflow(forcar = false) {
    if (statusSincronizacao.emAndamento) {
        return {
            sucesso: false,
            mensagem: 'Sincronização já está em andamento.',
            status: statusSincronizacao
        };
    }

    statusSincronizacao.emAndamento = true;
    statusSincronizacao.status = 'sincronizando';
    statusSincronizacao.mensagem = 'Consultando campanhas ativas na API SendFlow...';
    statusSincronizacao.ultimaTentativa = new Date().toISOString();

    console.log('\n=================================================================');
    console.log('🔄 [SENDFLOW] INICIANDO VERIFICAÇÃO DE GRUPOS DE CAMPANHAS ATIVAS...');
    console.log('=================================================================');

    try {
        const resReleases = await requestSendflow('/releases');

        if (resReleases.statusCode === 403 || resReleases.statusCode === 429) {
            const retryMs = resReleases.data?.retryAfterMs || 60000;
            statusSincronizacao.status = 'rate_limited';
            statusSincronizacao.retryAfterMs = retryMs;
            const esperaMin = Math.ceil(retryMs / 60000);
            statusSincronizacao.mensagem = `Limite de requisições do SendFlow atingido. Mantendo cache local. Nova tentativa em ${esperaMin}m.`;
            console.warn(`[⚠️ SENDFLOW RATE-LIMIT] API retornou 403/429. Aguardando janela de recarga (${esperaMin} min). Usando cache atual com segurança.`);
            statusSincronizacao.emAndamento = false;
            return {
                sucesso: false,
                rateLimited: true,
                mensagem: statusSincronizacao.mensagem,
                campanhas: cacheCampanhas.campanhas
            };
        }

        if (resReleases.statusCode !== 200 || !Array.isArray(resReleases.data)) {
            const errStr = resReleases.erro || `Status ${resReleases.statusCode}`;
            statusSincronizacao.status = 'erro';
            statusSincronizacao.mensagem = `Falha na API do SendFlow: ${errStr}`;
            console.error(`[!] Falha ao listar campanhas do SendFlow: ${errStr}`);
            statusSincronizacao.emAndamento = false;
            return {
                sucesso: false,
                mensagem: statusSincronizacao.mensagem,
                campanhas: cacheCampanhas.campanhas
            };
        }

        const todasReleases = resReleases.data;
        // Campanhas ATIVAS (não arquivadas)
        const ativas = todasReleases.filter(r => !r.archived);

        console.log(`[🎯 SENDFLOW] ${todasReleases.length} campanhas no total | ${ativas.length} campanhas ATIVAS encontradas.`);

        const novasCampanhas = [];
        let totalGruposMapeados = 0;

        for (let i = 0; i < ativas.length; i++) {
            const rel = ativas[i];
            console.log(`   [${i + 1}/${ativas.length}] Buscando grupos da campanha "${rel.name}" (${rel.id})...`);

            // Delay de segurança entre requisições de grupos para evitar rate limit
            await sleep(1500);

            let gruposCampanha = [];
            let resGrupos = await requestSendflow(`/releases/${rel.id}/groups`);

            // Se bater em rate-limit durante o processo, aguarda e tenta 1 vez
            if ((resGrupos.statusCode === 403 || resGrupos.statusCode === 429) && resGrupos.data?.retryAfterMs) {
                const waitTime = Math.min(resGrupos.data.retryAfterMs + 1000, 65000);
                console.log(`   ⏳ Rate limit momentâneo no grupo. Aguardando ${Math.ceil(waitTime / 1000)}s...`);
                await sleep(waitTime);
                resGrupos = await requestSendflow(`/releases/${rel.id}/groups`);
            }

            if (resGrupos.statusCode === 200 && Array.isArray(resGrupos.data)) {
                gruposCampanha = resGrupos.data.map(g => ({
                    id: g.id || g._id,
                    name: g.name || '',
                    gid: g.gid || g.jid || '',
                    jid: g.jid || g.gid || '',
                    inviteCode: g.inviteCode || '',
                    full: Boolean(g.full),
                    participantsAmount: Number(g.participantsAmount) || 0,
                    count: Number(g.count) || 0,
                    admins: Array.isArray(g.admins) ? g.admins.map(a => ({
                        name: a.name || 'Admin',
                        number: extrairNumeroLimpo(a.number)
                    })) : []
                }));
            } else {
                // Tenta reaproveitar grupos do cache anterior dessa campanha se falhar a requisição
                const antiga = cacheCampanhas.campanhas.find(c => c.id === rel.id);
                if (antiga && antiga.grupos && antiga.grupos.length > 0) {
                    console.log(`   ℹ️ Mantendo ${antiga.grupos.length} grupos do cache anterior para "${rel.name}".`);
                    gruposCampanha = antiga.grupos;
                } else {
                    console.warn(`   ⚠️ Não foi possível obter grupos para "${rel.name}" (Status: ${resGrupos.statusCode}).`);
                }
            }

            totalGruposMapeados += gruposCampanha.length;

            novasCampanhas.push({
                id: rel.id,
                name: rel.name,
                type: rel.type || 'WhatsRelease',
                archived: false,
                totalGrupos: gruposCampanha.length,
                grupos: gruposCampanha
            });
        }

        const agora = new Date();
        const proxima = new Date(agora.getTime() + INTERVALO_12_HORAS_MS);

        cacheCampanhas = {
            ultimaAtualizacao: agora.toISOString(),
            proximaAtualizacaoPrevista: proxima.toISOString(),
            totalCampanhasAtivas: novasCampanhas.length,
            totalGrupos: totalGruposMapeados,
            campanhas: novasCampanhas
        };

        salvarCampanhasLocais();

        statusSincronizacao.status = 'sucesso';
        statusSincronizacao.mensagem = `Sincronização concluída com sucesso! ${novasCampanhas.length} campanhas ativas e ${totalGruposMapeados} grupos monitorados.`;
        statusSincronizacao.retryAfterMs = null;
        statusSincronizacao.emAndamento = false;

        console.log(`\n✅ [SENDFLOW SINCRONIZADO] ${novasCampanhas.length} campanhas ativas | ${totalGruposMapeados} grupos cadastrados.`);
        console.log(`⏰ Próxima sincronização automática agendada para: ${proxima.toLocaleString('pt-BR')}`);

        if (typeof callbackNotificacao === 'function') {
            try {
                callbackNotificacao(cacheCampanhas);
            } catch (e) { }
        }

        return {
            sucesso: true,
            mensagem: statusSincronizacao.mensagem,
            campanhas: cacheCampanhas.campanhas
        };
    } catch (err) {
        statusSincronizacao.status = 'erro';
        statusSincronizacao.mensagem = `Erro interno ao sincronizar SendFlow: ${err.message}`;
        statusSincronizacao.emAndamento = false;
        console.error('[!] Erro interno ao sincronizar SendFlow:', err);
        return {
            sucesso: false,
            mensagem: statusSincronizacao.mensagem,
            campanhas: cacheCampanhas.campanhas
        };
    }
}

// Inicia agendamento recorrente de 12 horas
function iniciarAgendamento12Horas(onAtualizacao) {
    if (onAtualizacao) callbackNotificacao = onAtualizacao;

    if (timerAgendamento) clearInterval(timerAgendamento);

    timerAgendamento = setInterval(() => {
        console.log('\n⏰ [SENDFLOW CRON 12H] Disparando verificação periódica de grupos das campanhas ativas...');
        sincronizarCampanhasSendflow().catch(err => {
            console.error('[!] Erro no cron Sendflow:', err.message);
        });
    }, INTERVALO_12_HORAS_MS);

    console.log(`⏰ [AGENDADOR 12H] Verificação periódica de grupos do SendFlow armada (a cada 12 horas).`);
}

// =====================================================================
// 👑 GESTÃO DE ADMS POR CAMPANHA
// =====================================================================
function obterAdmsCampanha(releaseId) {
    if (!cacheAdmsCampanhas[releaseId]) {
        cacheAdmsCampanhas[releaseId] = [];
    }
    return cacheAdmsCampanhas[releaseId];
}

function adicionarAdmCampanha(releaseId, { numero, nome }) {
    if (!releaseId) throw new Error('ID da campanha é obrigatório.');
    const numLimpo = normalizarTelefoneBR(numero);
    if (!numLimpo || numLimpo.length < 10) {
        throw new Error('Número de WhatsApp inválido com DDD.');
    }

    if (!cacheAdmsCampanhas[releaseId]) {
        cacheAdmsCampanhas[releaseId] = [];
    }

    const lista = cacheAdmsCampanhas[releaseId];
    const indexExistente = lista.findIndex(x => x.numero === numLimpo || normalizarID(x.numero) === normalizarID(numLimpo));

    if (indexExistente !== -1) {
        lista[indexExistente].nome = (nome || lista[indexExistente].nome || 'ADM da Campanha').trim();
        salvarAdmsCampanhas();
        return {
            sucesso: true,
            mensagem: `ADM ${formatarExibicao(numLimpo)} já estava cadastrado nesta campanha. Nome atualizado!`,
            adm: lista[indexExistente],
            total: lista.length
        };
    }

    const novoAdm = {
        numero: numLimpo,
        numeroFormatado: formatarExibicao(numLimpo),
        nome: (nome || 'ADM da Campanha').trim(),
        adicionadoEm: new Date().toISOString()
    };

    lista.push(novoAdm);
    salvarAdmsCampanhas();

    return {
        sucesso: true,
        mensagem: `ADM ${formatarExibicao(numLimpo)} adicionado com sucesso à campanha!`,
        adm: novoAdm,
        total: lista.length
    };
}

function removerAdmCampanha(releaseId, numeroAlvo) {
    if (!releaseId) throw new Error('ID da campanha é obrigatório.');
    const numLimpo = extrairNumeroLimpo(numeroAlvo);
    const idNorm = normalizarID(numLimpo);

    if (!cacheAdmsCampanhas[releaseId]) return { sucesso: false, erro: 'Campanha sem ADMs cadastrados.' };

    const lista = cacheAdmsCampanhas[releaseId];
    const antes = lista.length;
    cacheAdmsCampanhas[releaseId] = lista.filter(x => x.numero !== numLimpo && normalizarID(x.numero) !== idNorm);

    if (cacheAdmsCampanhas[releaseId].length === antes) {
        return { sucesso: false, erro: 'ADM não encontrado nesta campanha.' };
    }

    salvarAdmsCampanhas();
    return {
        sucesso: true,
        mensagem: `ADM ${formatarExibicao(numLimpo)} removido da campanha com sucesso!`,
        total: cacheAdmsCampanhas[releaseId].length
    };
}

// Importa os administradores retornados pelo SendFlow para a lista de ADMs da campanha
function importarAdminsDoSendflow(releaseId) {
    const campanha = cacheCampanhas.campanhas.find(c => c.id === releaseId);
    if (!campanha || !Array.isArray(campanha.grupos)) {
        throw new Error('Campanha não encontrada no cache do SendFlow.');
    }

    let adicionados = 0;
    const jaExistentes = new Set((cacheAdmsCampanhas[releaseId] || []).map(x => x.numero));

    if (!cacheAdmsCampanhas[releaseId]) cacheAdmsCampanhas[releaseId] = [];

    for (const g of campanha.grupos) {
        for (const adm of (g.admins || [])) {
            const numLimpo = normalizarTelefoneBR(adm.number);
            if (!numLimpo || numLimpo.length < 10) continue;
            if (jaExistentes.has(numLimpo)) continue;

            jaExistentes.add(numLimpo);
            cacheAdmsCampanhas[releaseId].push({
                numero: numLimpo,
                numeroFormatado: formatarExibicao(numLimpo),
                nome: adm.name || 'Admin SendFlow',
                adicionadoEm: new Date().toISOString(),
                origem: 'SendFlow'
            });
            adicionados++;
        }
    }

    salvarAdmsCampanhas();
    return {
        sucesso: true,
        adicionados,
        total: cacheAdmsCampanhas[releaseId].length,
        mensagem: `${adicionados} administradores importados do SendFlow para a campanha!`
    };
}

// =====================================================================
// 🔍 CONSULTAS DE IDENTIFICAÇÃO E IMUNIDADE POR CAMPANHA
// =====================================================================

// Descobre a qual campanha um grupo pertence (por JID/GID ou por nome do grupo)
function obterInfoGrupoCampanha(idGrupo, subject) {
    if (!idGrupo && !subject) return null;

    const idLimpo = String(idGrupo || '').trim();
    const nomeLimpo = String(subject || '').trim();

    // 1. Busca exata por gid/jid no cache de campanhas
    for (const camp of cacheCampanhas.campanhas) {
        if (!Array.isArray(camp.grupos)) continue;
        for (const g of camp.grupos) {
            if (g.gid && idLimpo && (g.gid === idLimpo || g.gid.includes(idLimpo) || idLimpo.includes(g.gid))) {
                return {
                    releaseId: camp.id,
                    nomeCampanha: camp.name,
                    idGrupo: g.gid || idLimpo,
                    nomeGrupo: g.name || nomeLimpo || camp.name,
                    campanhaObj: camp
                };
            }
            if (g.jid && idLimpo && (g.jid === idLimpo || g.jid.includes(idLimpo) || idLimpo.includes(g.jid))) {
                return {
                    releaseId: camp.id,
                    nomeCampanha: camp.name,
                    idGrupo: g.jid || idLimpo,
                    nomeGrupo: g.name || nomeLimpo || camp.name,
                    campanhaObj: camp
                };
            }
        }
    }

    // 2. Fallback inteligente por correspondência de nome do grupo com os grupos cadastrados
    if (nomeLimpo) {
        for (const camp of cacheCampanhas.campanhas) {
            if (!Array.isArray(camp.grupos)) continue;
            for (const g of camp.grupos) {
                if (g.name && (g.name.toLowerCase() === nomeLimpo.toLowerCase() ||
                    (nomeLimpo.length >= 6 && g.name.toLowerCase().includes(nomeLimpo.toLowerCase())))) {
                    return {
                        releaseId: camp.id,
                        nomeCampanha: camp.name,
                        idGrupo: idLimpo || g.gid,
                        nomeGrupo: g.name,
                        campanhaObj: camp
                    };
                }
            }
        }

        // 3. Fallback especial para nomes de campanhas conhecidas
        for (const camp of cacheCampanhas.campanhas) {
            const campNameLower = camp.name.toLowerCase();
            if (campNameLower.includes('black') || campNameLower.includes('vitalícia') || campNameLower.includes('vitalicia')) {
                if (/black|vital[ií]cia/i.test(nomeLimpo)) {
                    return {
                        releaseId: camp.id,
                        nomeCampanha: camp.name,
                        idGrupo: idLimpo,
                        nomeGrupo: nomeLimpo,
                        campanhaObj: camp
                    };
                }
            }
            if (campNameLower.includes('base forte')) {
                if (/base\s*forte/i.test(nomeLimpo)) {
                    return {
                        releaseId: camp.id,
                        nomeCampanha: camp.name,
                        idGrupo: idLimpo,
                        nomeGrupo: nomeLimpo,
                        campanhaObj: camp
                    };
                }
            }
        }
    }

    return null;
}

// Verifica se o número é ADM específico daquela campanha
function ehAdmDaCampanha(releaseId, numOuJid) {
    if (!releaseId || !numOuJid) return false;
    const numLimpo = extrairNumeroLimpo(numOuJid);
    const idNorm = normalizarID(numLimpo);

    const lista = cacheAdmsCampanhas[releaseId];
    if (!Array.isArray(lista) || lista.length === 0) return false;

    for (const adm of lista) {
        const aNum = adm.numero;
        if (!aNum) continue;
        if (aNum === numLimpo || (idNorm && normalizarID(aNum) === idNorm)) return true;
        if (numLimpo.length >= 10 && aNum.length >= 10 && (aNum.includes(numLimpo) || numLimpo.includes(aNum))) return true;
    }

    return false;
}

// Retorna todas as campanhas ativas enriquecidas com seus ADMs para o painel web
function obterDadosCompletosCampanhas() {
    return {
        status: statusSincronizacao,
        ultimaAtualizacao: cacheCampanhas.ultimaAtualizacao,
        proximaAtualizacaoPrevista: cacheCampanhas.proximaAtualizacaoPrevista,
        totalCampanhasAtivas: cacheCampanhas.campanhas.length,
        totalGrupos: cacheCampanhas.campanhas.reduce((acc, c) => acc + (c.grupos ? c.grupos.length : 0), 0),
        campanhas: cacheCampanhas.campanhas.map(c => {
            const adms = cacheAdmsCampanhas[c.id] || [];
            return {
                id: c.id,
                name: c.name,
                type: c.type,
                archived: c.archived,
                totalGrupos: c.grupos ? c.grupos.length : (c.totalGrupos || 0),
                totalAdms: adms.length,
                adms: adms,
                grupos: c.grupos || []
            };
        })
    };
}

// Auto-carregamento imediato na inicialização do serviço
carregarCampanhasLocais();

module.exports = {
    carregarCampanhasLocais,
    salvarCampanhasLocais,
    sincronizarCampanhasSendflow,
    iniciarAgendamento12Horas,
    obterAdmsCampanha,
    adicionarAdmCampanha,
    removerAdmCampanha,
    importarAdminsDoSendflow,
    obterInfoGrupoCampanha,
    ehAdmDaCampanha,
    obterDadosCompletosCampanhas,
    getCacheCampanhas: () => cacheCampanhas,
    getStatusSincronizacao: () => statusSincronizacao,
    extrairNumeroLimpo,
    normalizarTelefoneBR,
    formatarExibicao,
    normalizarID
};
