// =====================================================================
// 🛡️ AEGIS C2 // SERVIDOR WEB & CONTROLADOR DO MOTOR ANTI-HACKER
// Servidor unificado para Easypanel / Docker / Nuvem
// Painel Web: Whitelist + Gestão de Espiões (QR & Código) + Blacklist + Limites
// =====================================================================
const express = require('express');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const {
    iniciarOperacaoAegisCompleta,
    recarregarWhitelist,
    obterEstadoAegis,
    feedEventos,
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
    obterStatusEspioes,
    conectarEspiaoManual,
    desconectarEspiao
} = require('./operacao_black_aegis');

const app = express();
const PORT = process.env.PORT || 3000;

// Arquivos de dados persistentes
const ARQUIVO_WHITELIST = path.join(__dirname, 'whitelist_aegis.json');
const ARQUIVO_METADATA = path.join(__dirname, 'whitelist_metadata.json');
const ARQUIVO_BLACKLIST = path.join(__dirname, 'blacklist_aegis.json');
const ARQUIVO_CONFIG = path.join(__dirname, 'config_aegis.json');

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================================
// 🔍 FUNÇÕES AUXILIARES DE TRATAMENTO DE NÚMEROS E WHITELIST
// =====================================================================
function extrairNumeroLimpo(raw) {
    if (!raw) return '';
    return String(raw).split('@')[0].split(':')[0].replace(/\D/g, '');
}

function normalizarTelefoneBR(raw) {
    let num = extrairNumeroLimpo(raw);
    if (!num) return '';

    // Se usuário digitou número brasileiro sem o DDI 55 (10 ou 11 dígitos)
    if (num.length === 10 || num.length === 11) {
        num = '55' + num;
    }

    return num;
}

function formatarExibicao(num) {
    if (!num) return '';
    const limpo = String(num).replace(/\D/g, '');
    
    // Formato BR com DDI 55: +55 (16) 99999-9999
    if (limpo.startsWith('55') && limpo.length === 13) {
        return `+55 (${limpo.substring(2, 4)}) ${limpo.substring(4, 9)}-${limpo.substring(9)}`;
    }
    if (limpo.startsWith('55') && limpo.length === 12) {
        return `+55 (${limpo.substring(2, 4)}) ${limpo.substring(4, 8)}-${limpo.substring(8)}`;
    }
    // Outros formatos internacionais
    if (limpo.length >= 11) {
        return `+${limpo}`;
    }
    return limpo;
}

function carregarListaWhitelist() {
    try {
        if (!fs.existsSync(ARQUIVO_WHITELIST)) return [];
        const raw = JSON.parse(fs.readFileSync(ARQUIVO_WHITELIST, 'utf-8'));
        if (Array.isArray(raw)) return raw.map(extrairNumeroLimpo).filter(Boolean);
    } catch (e) {
        console.error('[!] Erro ao ler whitelist_aegis.json:', e.message);
    }
    return [];
}

function carregarMetadata() {
    try {
        if (!fs.existsSync(ARQUIVO_METADATA)) return {};
        return JSON.parse(fs.readFileSync(ARQUIVO_METADATA, 'utf-8'));
    } catch (e) {
        return {};
    }
}

function salvarDadosWhitelist(lista, meta) {
    const listaUnica = Array.from(new Set(lista.map(extrairNumeroLimpo).filter(Boolean)));
    fs.writeFileSync(ARQUIVO_WHITELIST, JSON.stringify(listaUnica, null, 2), 'utf-8');
    fs.writeFileSync(ARQUIVO_METADATA, JSON.stringify(meta, null, 2), 'utf-8');

    try {
        recarregarWhitelist();
    } catch (e) { }

    return listaUnica;
}

// =====================================================================
// 🩺 ROTA DE SAÚDE (HEALTHCHECK DO EASYPANEL)
// =====================================================================
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

// =====================================================================
// ⚙️ ROTAS DE CONFIGURAÇÃO & LIMITES
// =====================================================================
app.get('/api/config', (req, res) => {
    try {
        const config = carregarConfig();
        res.json({
            sucesso: true,
            config
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

app.post('/api/config', (req, res) => {
    try {
        const { limiteGruposPorCampanha, quantidadeEspioes, limiteBanPermanente } = req.body;
        const configAtualizada = salvarConfig({
            limiteGruposPorCampanha,
            quantidadeEspioes,
            limiteBanPermanente
        });
        res.json({
            sucesso: true,
            mensagem: 'Configurações atualizadas com sucesso!',
            config: configAtualizada
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

// =====================================================================
// 🤖 ROTAS DE GESTÃO DE ADMINISTRADORES / ADMS (QR CODE, CÓDIGO E STATUS)
// =====================================================================
const listarAdmsHandler = (req, res) => {
    try {
        const adms = obterStatusAdms();
        res.json({
            sucesso: true,
            total: adms.length,
            conectados: adms.filter(e => e.conectado).length,
            adms,
            espioes: adms
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
};

const conectarQrHandler = async (req, res) => {
    try {
        const indice = Number(req.params.indice);
        if (!indice || indice < 1) {
            return res.status(400).json({ sucesso: false, erro: 'Índice de administrador inválido.' });
        }

        conectarAdmManual({ indice, tipoConexao: 'qr' }).catch(err => {
            console.error(`[!] Erro no ADM 0${indice} (QR):`, err.message);
        });

        res.json({
            sucesso: true,
            mensagem: `Iniciando geração do QR Code para o Administrador 0${indice}...`
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
};

const conectarCodigoHandler = async (req, res) => {
    try {
        const indice = Number(req.params.indice);
        const { telefone } = req.body;

        if (!indice || indice < 1) {
            return res.status(400).json({ sucesso: false, erro: 'Índice de administrador inválido.' });
        }

        const numFormatado = normalizarTelefoneBR(telefone);
        if (!numFormatado || numFormatado.length < 10) {
            return res.status(400).json({ sucesso: false, erro: 'Digite um número de WhatsApp válido com DDD.' });
        }

        conectarAdmManual({ indice, tipoConexao: 'codigo', numeroTelefone: numFormatado }).catch(err => {
            console.error(`[!] Erro no ADM 0${indice} (Código):`, err.message);
        });

        res.json({
            sucesso: true,
            mensagem: `Solicitando código de pareamento para o número ${formatarExibicao(numFormatado)}...`
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
};

const desconectarAdmHandler = async (req, res) => {
    try {
        const indice = Number(req.params.indice);
        if (!indice || indice < 1) {
            return res.status(400).json({ sucesso: false, erro: 'Índice de administrador inválido.' });
        }

        const resultado = await desconectarAdm(indice);
        res.json(resultado);
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
};

// Mapeamento duplo para suportar tanto /api/adms quanto /api/espioes
app.get('/api/adms', listarAdmsHandler);
app.get('/api/espioes', listarAdmsHandler);

app.post('/api/adms/:indice/conectar-qr', conectarQrHandler);
app.post('/api/espioes/:indice/conectar-qr', conectarQrHandler);

app.post('/api/adms/:indice/conectar-codigo', conectarCodigoHandler);
app.post('/api/espioes/:indice/conectar-codigo', conectarCodigoHandler);

app.post('/api/adms/:indice/desconectar', desconectarAdmHandler);
app.post('/api/espioes/:indice/desconectar', desconectarAdmHandler);

// =====================================================================
// ⛔ ROTAS DE GESTÃO DE BLACKLIST (BANIDOS PERMANENTES)
// =====================================================================
app.get('/api/blacklist', (req, res) => {
    try {
        const banidos = carregarBlacklist();
        res.json({
            sucesso: true,
            total: banidos.length,
            banidos
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

app.post('/api/blacklist', async (req, res) => {
    try {
        const { numero, motivo } = req.body;
        if (!numero) {
            return res.status(400).json({ sucesso: false, erro: 'Número de telefone é obrigatório.' });
        }

        const numFormatado = normalizarTelefoneBR(numero);
        if (numFormatado.length < 10) {
            return res.status(400).json({ sucesso: false, erro: 'Número inválido. Digite DDD + Telefone.' });
        }

        const resultado = await banirPermanente(numFormatado, motivo || 'Banimento Permanente Manual');
        res.json(resultado);
    } catch (err) {
        res.status(400).json({ sucesso: false, erro: err.message });
    }
});

app.delete('/api/blacklist/:numero', (req, res) => {
    try {
        const resultado = desbanir(req.params.numero);
        if (!resultado.sucesso) {
            return res.status(404).json(resultado);
        }
        res.json(resultado);
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

// =====================================================================
// 📡 ROTAS DE API: WHITELIST & ADMINS
// =====================================================================

// Listar todos os administradores cadastrados
app.get('/api/whitelist', (req, res) => {
    try {
        const lista = carregarListaWhitelist();
        const meta = carregarMetadata();

        const dados = lista.map(numero => ({
            numero,
            numeroFormatado: formatarExibicao(numero),
            nome: meta[numero]?.nome || 'Administrador',
            adicionadoEm: meta[numero]?.adicionadoEm || null
        }));

        res.json({
            sucesso: true,
            total: dados.length,
            administradores: dados
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

// Cadastrar número único na Whitelist
app.post('/api/whitelist', (req, res) => {
    try {
        const { numero, nome } = req.body;
        if (!numero) {
            return res.status(400).json({ sucesso: false, erro: 'Número de telefone é obrigatório.' });
        }

        const numFormatado = normalizarTelefoneBR(numero);
        if (numFormatado.length < 10) {
            return res.status(400).json({ sucesso: false, erro: 'Número inválido. Digite DDD + Telefone.' });
        }

        const lista = carregarListaWhitelist();
        const meta = carregarMetadata();

        if (lista.includes(numFormatado)) {
            meta[numFormatado] = {
                nome: nome?.trim() || meta[numFormatado]?.nome || 'Administrador',
                adicionadoEm: meta[numFormatado]?.adicionadoEm || new Date().toISOString()
            };
            salvarDadosWhitelist(lista, meta);
            return res.json({
                sucesso: true,
                mensagem: `O número ${formatarExibicao(numFormatado)} já estava na Whitelist. Informações atualizadas!`,
                atualizado: true,
                total: lista.length
            });
        }

        lista.unshift(numFormatado);
        meta[numFormatado] = {
            nome: nome?.trim() || 'Administrador',
            adicionadoEm: new Date().toISOString()
        };

        salvarDadosWhitelist(lista, meta);

        res.json({
            sucesso: true,
            mensagem: `Administrador ${formatarExibicao(numFormatado)} adicionado com sucesso!`,
            item: {
                numero: numFormatado,
                numeroFormatado: formatarExibicao(numFormatado),
                nome: meta[numFormatado].nome,
                adicionadoEm: meta[numFormatado].adicionadoEm
            },
            total: lista.length
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

// Cadastrar números em lote (colar lista)
app.post('/api/whitelist/bulk', (req, res) => {
    try {
        const { texto, nomePadrao } = req.body;
        if (!texto || typeof texto !== 'string') {
            return res.status(400).json({ sucesso: false, erro: 'Cole uma lista de números válida.' });
        }

        const linhas = texto.split(/[\r\n,;]+/);
        const lista = carregarListaWhitelist();
        const meta = carregarMetadata();

        let adicionados = 0;
        let jaExistiam = 0;
        let invalidos = 0;

        for (const linha of linhas) {
            const limpo = normalizarTelefoneBR(linha);
            if (!limpo || limpo.length < 10) {
                if (linha.trim()) invalidos++;
                continue;
            }

            if (lista.includes(limpo)) {
                jaExistiam++;
                continue;
            }

            lista.push(limpo);
            meta[limpo] = {
                nome: nomePadrao?.trim() || 'Administrador (Lote)',
                adicionadoEm: new Date().toISOString()
            };
            adicionados++;
        }

        salvarDadosWhitelist(lista, meta);

        res.json({
            sucesso: true,
            mensagem: `${adicionados} novos administradores adicionados à Whitelist!`,
            adicionados,
            jaExistiam,
            invalidos,
            total: lista.length
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

// Remover administrador da Whitelist
app.delete('/api/whitelist/:numero', (req, res) => {
    try {
        const numAlvo = extrairNumeroLimpo(req.params.numero);
        if (!numAlvo) {
            return res.status(400).json({ sucesso: false, erro: 'Número inválido.' });
        }

        let lista = carregarListaWhitelist();
        const meta = carregarMetadata();

        const index = lista.indexOf(numAlvo);
        if (index === -1) {
            return res.status(404).json({ sucesso: false, erro: 'Número não encontrado na Whitelist.' });
        }

        lista.splice(index, 1);
        delete meta[numAlvo];

        salvarDadosWhitelist(lista, meta);

        res.json({
            sucesso: true,
            mensagem: `Administrador ${formatarExibicao(numAlvo)} removido da Whitelist.`,
            total: lista.length
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

// =====================================================================
// 📊 ROTAS DE TELEMETRIA: STATUS DO SERVIDOR & EVENTOS DA CATRACA
// =====================================================================
app.get('/api/status', (req, res) => {
    try {
        const estadoAegis = obterEstadoAegis();
        const mem = process.memoryUsage();

        res.json({
            sucesso: true,
            servidor: {
                online: true,
                uptimeSegundos: Math.floor(process.uptime()),
                uptimeFormatado: formatarUptime(process.uptime()),
                memoriaMB: Math.round(mem.rss / 1024 / 1024),
                nodeVersion: process.version,
                fusoHorario: Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            aegis: estadoAegis
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

app.get('/api/logs', (req, res) => {
    try {
        res.json({
            sucesso: true,
            eventos: feedEventos || []
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

function formatarUptime(segundos) {
    const s = Math.floor(segundos);
    const d = Math.floor(s / (3600 * 24));
    const h = Math.floor((s % (3600 * 24)) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
}

// =====================================================================
// 📦 BACKUP E RESTAURAÇÃO DE SESSÕES & DADOS
// =====================================================================

// Baixar Whitelist em JSON
app.get('/api/backup/whitelist', (req, res) => {
    try {
        if (!fs.existsSync(ARQUIVO_WHITELIST)) {
            return res.status(404).send('Arquivo não encontrado');
        }
        res.download(ARQUIVO_WHITELIST, 'whitelist_aegis.json');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Baixar Blacklist em JSON
app.get('/api/backup/blacklist', (req, res) => {
    try {
        if (!fs.existsSync(ARQUIVO_BLACKLIST)) {
            return res.status(404).send('Arquivo não encontrado');
        }
        res.download(ARQUIVO_BLACKLIST, 'blacklist_aegis.json');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Baixar Sessões de Todos os Espiões em ZIP
app.get('/api/backup/sessoes', (req, res) => {
    try {
        const zip = new AdmZip();
        let encontrou = false;

        // Escaneia pastas auth_sniper_* e auth_spotter_*
        const arquivos = fs.readdirSync(__dirname);
        for (const item of arquivos) {
            if ((item.startsWith('auth_sniper_') || item.startsWith('auth_spotter_')) && fs.statSync(path.join(__dirname, item)).isDirectory()) {
                zip.addLocalFolder(path.join(__dirname, item), item);
                encontrou = true;
            }
        }

        if (fs.existsSync(ARQUIVO_WHITELIST)) zip.addLocalFile(ARQUIVO_WHITELIST);
        if (fs.existsSync(ARQUIVO_METADATA)) zip.addLocalFile(ARQUIVO_METADATA);
        if (fs.existsSync(ARQUIVO_BLACKLIST)) zip.addLocalFile(ARQUIVO_BLACKLIST);
        if (fs.existsSync(ARQUIVO_CONFIG)) zip.addLocalFile(ARQUIVO_CONFIG);

        if (!encontrou) {
            return res.status(404).json({ sucesso: false, erro: 'Nenhuma pasta de sessão auth_* encontrada.' });
        }

        const buffer = zip.toBuffer();
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename="aegis_sessoes_snipers.zip"');
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

// Restaurar Sessões via Upload ZIP
app.post('/api/restore/sessoes', express.raw({ type: 'application/zip', limit: '100mb' }), (req, res) => {
    try {
        if (!req.body || req.body.length === 0) {
            return res.status(400).json({ sucesso: false, erro: 'Nenhum dado recebido no upload.' });
        }

        const zip = new AdmZip(req.body);
        zip.extractAllTo(__dirname, true);

        recarregarWhitelist();
        carregarBlacklist();
        carregarConfig();

        setTimeout(() => {
            console.log('[🚀] Conectando Espiões após restauração das credenciais...');
            iniciarOperacaoAegisCompleta().catch(e => console.error('[!] Falha ao iniciar após restore:', e));
        }, 1200);

        res.json({
            sucesso: true,
            mensagem: 'Sessões restauradas com sucesso! Conectando Espiões no servidor...'
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

// Forçar conexão de todos os espiões manualmente pelo painel
app.post('/api/snipers/conectar', (req, res) => {
    try {
        console.log('[🚀] Disparo manual de conexão dos Espiões solicitado pelo Painel Web...');
        iniciarOperacaoAegisCompleta().catch(e => console.error('[!] Erro ao conectar Espiões:', e));
        res.json({ sucesso: true, mensagem: 'Comando de conexão enviado aos Espiões.' });
    } catch (e) {
        res.status(500).json({ sucesso: false, erro: e.message });
    }
});

// =====================================================================
// 🚀 INICIALIZAÇÃO DO SERVIDOR WEB + MOTOR AEGIS
// =====================================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n=================================================================');
    console.log(`🌐 [AEGIS C2] PAINEL WEB ATIVO NA PORTA: http://0.0.0.0:${PORT}`);
    console.log('📌  Acesse no navegador para gerenciar Whitelist, Espiões, Blacklist e Limites.');
    console.log('=================================================================\n');

    if (process.env.START_BOT !== 'false') {
        setTimeout(() => {
            console.log('[🚀] Disparando Motor Aegis 24/7 (Black Vitalícia + Base Forte)...');
            iniciarOperacaoAegisCompleta().catch(err => {
                console.error('[!] Erro no motor Aegis:', err?.message || err);
            });
        }, 1500);
    } else {
        console.log('[ℹ️] START_BOT=false detectado. Motor WhatsApp em pausa.');
    }
});
