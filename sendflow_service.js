// =====================================================================
// 🚀 SENDFLOW SERVICE // INTEGRAÇÃO API & GESTÃO DE CAMPANHAS ATIVAS
// Sincronização automática a cada 12 horas, cache em disco e gestão de ADMs por campanha
// =====================================================================
require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || (fs.existsSync(path.join(__dirname, 'data')) ? path.join(__dirname, 'data') : __dirname);
const ARQUIVO_CAMPANHAS = path.join(DATA_DIR, 'sendflow_campanhas_ativas.json');
const ARQUIVO_CAMPANHAS_ADMS = path.join(DATA_DIR, 'campanhas_adms.json');
const ARQUIVO_SNIPERS_CAMPANHAS = path.join(DATA_DIR, 'snipers_campanhas.json');

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
    return (process.env.SENDFLOW_API_KEY || '').trim();
}

// Requisição HTTP genérica para o SendFlow
function requestSendflow(caminho) {
    return new Promise((resolve) => {
        const apiKey = obterApiKey();
        if (!apiKey) {
            console.error('[⚠️ SENDFLOW] Chave SENDFLOW_API_KEY não foi encontrada nas variáveis de ambiente (.env ou Easypanel).');
            resolve({
                statusCode: 401,
                data: { message: 'SENDFLOW_API_KEY não configurada' },
                raw: '{"message":"SENDFLOW_API_KEY não configurada"}'
            });
            return;
        }
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

// =====================================================================
// 🧹 NORMALIZAÇÃO E DEDUPLICAÇÃO INTELIGENTE DE GRUPOS
// =====================================================================
function normalizarNomeParaComparacao(nome) {
    if (!nome) return '';
    let s = String(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.replace(/\[.*?\]/g, ''); // remove [BV-26], [TAGS]
    s = s.replace(/#\s*0*(\d+)/g, (m, p) => '#' + p); // normaliza #01 -> #1
    s = s.replace(/[^\w\s#]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    return s;
}

function nomesDeGrupoSaoIguais(a, b) {
    if (!a || !b) return false;
    const nA = normalizarNomeParaComparacao(a);
    const nB = normalizarNomeParaComparacao(b);
    return Boolean(nA && nB && nA === nB);
}

function deduplicarGruposDaCampanha(grupos) {
    if (!Array.isArray(grupos) || grupos.length <= 1) return grupos || [];
    const lista = [];

    for (const g of grupos) {
        const idValido = String(g.id || g._id || '').trim();
        const gidPuro = extrairGidPuro(g.gid || g.jid || g.id);
        const inviteValido = g.inviteCode && String(g.inviteCode).trim().length > 3 ? String(g.inviteCode).trim() : null;

        const existente = lista.find(item => {
            const itemId = String(item.id || item._id || '').trim();
            // 1. Mesmo ID único do SendFlow
            if (idValido && itemId && idValido === itemId) return true;
            // 2. Mesmo GID ou JID do WhatsApp (numérico com pelo menos 10 dígitos)
            const itemGidPuro = extrairGidPuro(item.gid || item.jid || item.id);
            if (gidPuro && itemGidPuro && gidPuro.length >= 10 && gidPuro === itemGidPuro) return true;
            // 3. Mesmo link/código de convite único do WhatsApp
            if (inviteValido && item.inviteCode && String(item.inviteCode).trim() === inviteValido) return true;
            return false;
        });

        if (existente) {
            // Unifica dados preservando gid de WhatsApp e metadados de API
            if (!existente.gid && g.gid) existente.gid = g.gid;
            if (!existente.jid && g.jid) existente.jid = g.jid;
            if (!existente.inviteCode && g.inviteCode) existente.inviteCode = g.inviteCode;
            if (g.origem === 'SendFlow') existente.origem = 'SendFlow';
            if ((g.participantsAmount || 0) > (existente.participantsAmount || 0)) {
                existente.participantsAmount = g.participantsAmount;
            }
        } else {
            lista.push({ ...g });
        }
    }
    return lista;
}

function carregarCampanhasLocais() {
    carregarAdmsCampanhas();
    try {
        if (fs.existsSync(ARQUIVO_CAMPANHAS)) {
            const raw = JSON.parse(fs.readFileSync(ARQUIVO_CAMPANHAS, 'utf-8'));
            if (raw && Array.isArray(raw.campanhas)) {
                let teveDeduplicacao = false;
                const campanhasLimpass = raw.campanhas.map(c => {
                    const antes = Array.isArray(c.grupos) ? c.grupos.length : 0;
                    const gruposLimpos = deduplicarGruposDaCampanha(c.grupos);
                    if (gruposLimpos.length !== antes) teveDeduplicacao = true;
                    return {
                        ...c,
                        grupos: gruposLimpos,
                        totalGrupos: gruposLimpos.length
                    };
                });
                cacheCampanhas = {
                    ultimaAtualizacao: raw.ultimaAtualizacao || new Date().toISOString(),
                    proximaAtualizacaoPrevista: raw.proximaAtualizacaoPrevista || new Date(Date.now() + INTERVALO_12_HORAS_MS).toISOString(),
                    totalCampanhasAtivas: campanhasLimpass.length,
                    totalGrupos: campanhasLimpass.reduce((acc, c) => acc + (c.grupos ? c.grupos.length : (c.totalGrupos || 0)), 0),
                    campanhas: campanhasLimpass
                };
                if (teveDeduplicacao) {
                    salvarCampanhasLocais();
                    console.log(`[🧹 SendFlow Cache] Grupos duplicados foram higienizados e unificados automaticamente.`);
                }
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

        // Preserva os grupos já cadastrados em cada campanha e sincroniza grupos da API do SendFlow com segurança
        const novasCampanhas = [];
        let bateuRateLimitGrupos = false;

        for (const rel of ativas) {
            const antiga = cacheCampanhas.campanhas.find(c => c.id === rel.id);
            const gruposPreservados = (antiga && Array.isArray(antiga.grupos)) ? antiga.grupos : [];
            const gruposIgnorados = (antiga && Array.isArray(antiga.gruposIgnorados)) ? antiga.gruposIgnorados : [];
            const gruposManuais = gruposPreservados.filter(g => g.origem === 'Manual');

            let gruposFinais = gruposPreservados;
            // Sincroniza os grupos oficiais de todas as campanhas ativas do SendFlow
            if (!bateuRateLimitGrupos && (forcar || gruposPreservados.length === 0)) {
                await sleep(1200);
                const resGrupos = await requestSendflow(`/releases/${rel.id}/groups`);
                if (resGrupos.statusCode === 200 && Array.isArray(resGrupos.data)) {
                    const ignoradosSet = new Set(gruposIgnorados);
                    const gruposApi = resGrupos.data
                        .map(g => ({
                            id: g.id || g._id,
                            name: g.name || '',
                            gid: g.gid || g.jid || '',
                            jid: g.jid || g.gid || '',
                            inviteCode: g.inviteCode || '',
                            full: Boolean(g.full),
                            participantsAmount: Number(g.participantsAmount) || 0,
                            count: Number(g.count) || 0,
                            origem: 'SendFlow',
                            admins: Array.isArray(g.admins) ? g.admins.map(a => ({
                                name: a.name || 'Admin',
                                number: extrairNumeroLimpo(a.number)
                            })) : []
                        }))
                        .filter(g => !ignoradosSet.has(g.id) && !ignoradosSet.has(g.gid) && !ignoradosSet.has(g.name));

                    // Mescla grupos da API com eventuais grupos adicionados manualmente na aba SendFlow
                    const idsApi = new Set(gruposApi.map(x => x.id || extrairGidPuro(x.gid || x.jid)).filter(Boolean));
                    const manuaisExtras = gruposManuais.filter(m => !idsApi.has(m.id) && !idsApi.has(extrairGidPuro(m.gid || m.jid)));
                    gruposFinais = deduplicarGruposDaCampanha([...gruposApi, ...manuaisExtras]);
                } else if (resGrupos.statusCode === 403 || resGrupos.statusCode === 429) {
                    bateuRateLimitGrupos = true;
                    console.warn(`[⚠️ SENDFLOW] Rate-limit ao buscar grupos de "${rel.name}". Preservando grupos em cache.`);
                }
            }

            const gruposUnicos = deduplicarGruposDaCampanha(gruposFinais);
            novasCampanhas.push({
                id: rel.id,
                name: rel.name,
                groupNamePrefix: rel.groupNamePrefix || antiga?.groupNamePrefix || '',
                groupNameSuffix: rel.groupNameSuffix || antiga?.groupNameSuffix || '',
                type: rel.type || 'WhatsRelease',
                archived: false,
                totalGrupos: gruposUnicos.length,
                grupos: gruposUnicos,
                gruposIgnorados
            });
        }

        const totalGruposMapeados = novasCampanhas.reduce((acc, c) => acc + (c.grupos ? c.grupos.length : 0), 0);
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
        statusSincronizacao.mensagem = `Sincronização concluída! ${novasCampanhas.length} campanhas ativas mapeadas com segurança.`;
        statusSincronizacao.retryAfterMs = null;
        statusSincronizacao.emAndamento = false;

        console.log(`\n✅ [SENDFLOW SINCRONIZADO] ${novasCampanhas.length} campanhas ativas mapeadas sem risco de rate limit.`);
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
        statusSincronizacao.mensagem = `Erro ao sincronizar SendFlow: ${err.message}`;
        statusSincronizacao.emAndamento = false;
        console.error('[!] Erro ao sincronizar SendFlow:', err);
        return {
            sucesso: false,
            mensagem: statusSincronizacao.mensagem,
            campanhas: cacheCampanhas.campanhas
        };
    }
}

// Sincroniza grupos EXCLUSIVAMENTE de uma única campanha (sob demanda, seguro)
async function sincronizarGruposCampanha(releaseId) {
    if (!releaseId) throw new Error('ID da campanha é obrigatório.');
    const camp = cacheCampanhas.campanhas.find(c => c.id === releaseId);
    if (!camp) throw new Error('Campanha não encontrada no cache.');

    console.log(`[🎯 SENDFLOW] Buscando grupos exclusivamente para a campanha "${camp.name}" (${camp.id})...`);
    const resGrupos = await requestSendflow(`/releases/${releaseId}/groups`);

    if (resGrupos.statusCode === 403 || resGrupos.statusCode === 429) {
        const retryMs = resGrupos.data?.retryAfterMs || 60000;
        const msg = `SendFlow retornou limite de taxa (Status ${resGrupos.statusCode}). Aguarde ${Math.ceil(retryMs / 1000)}s antes de tentar novamente.`;
        console.warn(`[⚠️ SENDFLOW RATE-LIMIT] ${msg}`);
        return {
            sucesso: false,
            rateLimited: true,
            mensagem: msg,
            grupos: camp.grupos || []
        };
    }

    if (resGrupos.statusCode === 200 && Array.isArray(resGrupos.data)) {
        const gruposManuais = (camp.grupos || []).filter(g => g.origem === 'Manual');
        const gruposApi = resGrupos.data.map(g => ({
            id: g.id || g._id,
            name: g.name || '',
            gid: g.gid || g.jid || '',
            jid: g.jid || g.gid || '',
            inviteCode: g.inviteCode || '',
            full: Boolean(g.full),
            participantsAmount: Number(g.participantsAmount) || 0,
            count: Number(g.count) || 0,
            origem: 'SendFlow',
            admins: Array.isArray(g.admins) ? g.admins.map(a => ({
                name: a.name || 'Admin',
                number: extrairNumeroLimpo(a.number)
            })) : []
        }));

        const idsApi = new Set(gruposApi.map(x => x.id || extrairGidPuro(x.gid || x.jid)).filter(Boolean));
        const manuaisExtras = gruposManuais.filter(m => !idsApi.has(m.id) && !idsApi.has(extrairGidPuro(m.gid || m.jid)));

        camp.grupos = deduplicarGruposDaCampanha([...gruposApi, ...manuaisExtras]);
        camp.totalGrupos = camp.grupos.length;
        cacheCampanhas.totalGrupos = cacheCampanhas.campanhas.reduce((acc, c) => acc + (c.grupos?.length || 0), 0);
        salvarCampanhasLocais();

        if (typeof callbackNotificacao === 'function') {
            try { callbackNotificacao(cacheCampanhas); } catch (e) { }
        }

        return {
            sucesso: true,
            mensagem: `${camp.grupos.length} grupos obtidos com sucesso para "${camp.name}"!`,
            grupos: camp.grupos,
            total: camp.grupos.length
        };
    }

    return {
        sucesso: false,
        mensagem: `Não foi possível obter grupos para "${camp.name}" (Status: ${resGrupos.statusCode}).`,
        grupos: camp.grupos || []
    };
}

// Adiciona um grupo manualmente a uma campanha (mesmo sem a API do Sendflow)
function adicionarGrupoManualCampanha(releaseId, { gid, name, participantsAmount }) {
    if (!releaseId) throw new Error('ID da campanha é obrigatório.');
    const camp = cacheCampanhas.campanhas.find(c => c.id === releaseId);
    if (!camp) throw new Error('Campanha não encontrada no cache.');

    if (!Array.isArray(camp.grupos)) camp.grupos = [];
    if (Array.isArray(camp.gruposIgnorados)) {
        camp.gruposIgnorados = camp.gruposIgnorados.filter(x => x !== gid && x !== name);
    }

    let gidLimpo = String(gid || '').trim();
    if (gidLimpo && !gidLimpo.includes('@g.us') && !gidLimpo.includes('http') && /^\d+$/.test(gidLimpo)) {
        gidLimpo = `${gidLimpo}@g.us`;
    }

    const indexExistente = camp.grupos.findIndex(g => (gidLimpo && g.gid === gidLimpo) || (name && (g.name === name || nomesDeGrupoSaoIguais(g.name, name))));
    if (indexExistente !== -1) {
        if (name) camp.grupos[indexExistente].name = name;
        if (gidLimpo) {
            camp.grupos[indexExistente].gid = gidLimpo;
            camp.grupos[indexExistente].jid = gidLimpo;
        }
        salvarCampanhasLocais();
        if (typeof callbackNotificacao === 'function') {
            try { callbackNotificacao(cacheCampanhas); } catch (e) { }
        }
        return {
            sucesso: true,
            mensagem: 'Grupo já estava cadastrado nesta campanha. Dados atualizados!',
            grupo: camp.grupos[indexExistente],
            total: camp.grupos.length
        };
    }

    const novoGrupo = {
        id: `manual_${Date.now()}`,
        name: (name || 'Grupo Manual').trim(),
        gid: gidLimpo,
        jid: gidLimpo,
        inviteCode: '',
        full: false,
        participantsAmount: Number(participantsAmount) || 0,
        origem: 'Manual'
    };

    camp.grupos.push(novoGrupo);
    camp.totalGrupos = camp.grupos.length;
    cacheCampanhas.totalGrupos = cacheCampanhas.campanhas.reduce((acc, c) => acc + (c.grupos?.length || 0), 0);
    salvarCampanhasLocais();

    if (typeof callbackNotificacao === 'function') {
        try { callbackNotificacao(cacheCampanhas); } catch (e) { }
    }

    return {
        sucesso: true,
        mensagem: `Grupo "${novoGrupo.name}" adicionado à campanha com sucesso!`,
        grupo: novoGrupo,
        total: camp.grupos.length
    };
}

// Remove um grupo de uma campanha
function removerGrupoCampanha(releaseId, idOuGid) {
    if (!releaseId) throw new Error('ID da campanha é obrigatório.');
    const camp = cacheCampanhas.campanhas.find(c => c.id === releaseId);
    if (!camp || !Array.isArray(camp.grupos)) throw new Error('Campanha não encontrada.');

    const removidos = camp.grupos.filter(g => g.id === idOuGid || g.gid === idOuGid || g.jid === idOuGid);
    if (removidos.length === 0) {
        return { sucesso: false, erro: 'Grupo não encontrado nesta campanha.' };
    }

    if (!Array.isArray(camp.gruposIgnorados)) camp.gruposIgnorados = [];
    for (const r of removidos) {
        if (r.id && !camp.gruposIgnorados.includes(r.id)) camp.gruposIgnorados.push(r.id);
        if (r.gid && !camp.gruposIgnorados.includes(r.gid)) camp.gruposIgnorados.push(r.gid);
        if (r.name && !camp.gruposIgnorados.includes(r.name)) camp.gruposIgnorados.push(r.name);
    }

    camp.grupos = camp.grupos.filter(g => g.id !== idOuGid && g.gid !== idOuGid && g.jid !== idOuGid);
    camp.totalGrupos = camp.grupos.length;
    cacheCampanhas.totalGrupos = cacheCampanhas.campanhas.reduce((acc, c) => acc + (c.grupos?.length || 0), 0);
    salvarCampanhasLocais();

    if (typeof callbackNotificacao === 'function') {
        try { callbackNotificacao(cacheCampanhas); } catch (e) { }
    }

    return {
        sucesso: true,
        mensagem: 'Grupo removido da campanha com sucesso!',
        total: camp.grupos.length
    };
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

    // Se a campanha ainda não tiver a lista de grupos sincronizada da API do SendFlow, dispara a busca automaticamente
    const camp = cacheCampanhas.campanhas.find(c => c.id === releaseId);
    if (camp && (!Array.isArray(camp.grupos) || camp.grupos.length === 0)) {
        sincronizarGruposCampanha(releaseId).catch(() => {});
    } else if (typeof callbackNotificacao === 'function') {
        try { callbackNotificacao(cacheCampanhas); } catch (e) { }
    }

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

function extrairGidPuro(raw) {
    if (!raw) return '';
    return String(raw).split('@')[0].replace(/\D/g, '').trim();
}

// Verifica se uma campanha do SendFlow está ativa para monitoramento
function campanhaEstaVinculadaComAdm(camp) {
    if (!camp || camp.archived) return false;
    return true;
}

// Descobre a qual campanha um grupo pertence EXCLUSIVAMENTE pelas campanhas e grupos vinculados na aba Campanhas SendFlow & ADMs
function obterInfoGrupoCampanha(idGrupo, subject, participantsAmount = 0) {
    if (!idGrupo && !subject) return null;

    const idLimpo = String(idGrupo || '').trim();
    const gidPuroAlvo = extrairGidPuro(idLimpo);
    const nomeLimpo = String(subject || '').trim();

    // 1. Busca exata por gid/jid nos grupos vinculados às campanhas ativas monitoradas
    if (idLimpo || gidPuroAlvo) {
        for (const camp of cacheCampanhas.campanhas) {
            if (!campanhaEstaVinculadaComAdm(camp) || !Array.isArray(camp.grupos)) continue;
            if (Array.isArray(camp.gruposIgnorados) && (camp.gruposIgnorados.includes(idLimpo) || (nomeLimpo && camp.gruposIgnorados.includes(nomeLimpo)))) {
                continue;
            }
            for (const g of camp.grupos) {
                const gGid = String(g.gid || '').trim();
                const gJid = String(g.jid || '').trim();
                const gId = String(g.id || '').trim();
                const gGidPuro = extrairGidPuro(gGid || gJid || gId);

                if ((gGid && idLimpo && gGid === idLimpo) ||
                    (gJid && idLimpo && gJid === idLimpo) ||
                    (gId && idLimpo && gId === idLimpo) ||
                    (gidPuroAlvo && gGidPuro && gidPuroAlvo.length >= 10 && gidPuroAlvo === gGidPuro)) {
                    if (participantsAmount > 0 && g.participantsAmount !== participantsAmount) {
                        g.participantsAmount = participantsAmount;
                    }
                    return {
                        releaseId: camp.id,
                        nomeCampanha: camp.name,
                        idGrupo: gGid || gJid || idLimpo,
                        nomeGrupo: g.name || nomeLimpo || camp.name,
                        campanhaObj: camp
                    };
                }
            }
        }
    }

    // 2. Busca por nome EXATO ou NORMALIZADO entre os grupos explicitamente cadastrados em camp.grupos
    if (nomeLimpo) {
        const nomeAlvoLower = nomeLimpo.toLowerCase();
        for (const camp of cacheCampanhas.campanhas) {
            if (!campanhaEstaVinculadaComAdm(camp) || !Array.isArray(camp.grupos)) continue;
            if (Array.isArray(camp.gruposIgnorados) && (camp.gruposIgnorados.includes(idLimpo) || camp.gruposIgnorados.includes(nomeLimpo))) {
                continue;
            }
            for (const g of camp.grupos) {
                if (!g.name) continue;
                const gNomeLower = String(g.name).trim().toLowerCase();
                const matchNome = (gNomeLower && gNomeLower === nomeAlvoLower) || nomesDeGrupoSaoIguais(g.name, nomeLimpo);
                if (matchNome) {
                    const gGidPuro = extrairGidPuro(g.gid || g.jid);
                    if (gGidPuro && gidPuroAlvo && gGidPuro !== gidPuroAlvo) {
                        continue;
                    }
                    if ((!g.gid || !g.gid.includes('@g.us')) && idLimpo && idLimpo.includes('@g.us')) {
                        g.gid = idLimpo;
                        g.jid = idLimpo;
                        if (participantsAmount > 0) g.participantsAmount = participantsAmount;
                        salvarCampanhasLocais();
                    }
                    return {
                        releaseId: camp.id,
                        nomeCampanha: camp.name,
                        idGrupo: idLimpo || g.gid || g.jid,
                        nomeGrupo: g.name,
                        campanhaObj: camp
                    };
                }
            }
        }
    }

    // REGRA ABSOLUTA DO USUÁRIO:
    // O sistema DEVE olhar apenas para os grupos cadastrados na aba do SendFlow (camp.grupos).
    // Qualquer grupo antigo, passado ou não presente em camp.grupos é estritamente ignorado (retorna null).
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
    sincronizarGruposCampanha,
    adicionarGrupoManualCampanha,
    removerGrupoCampanha,
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
