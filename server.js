// =====================================================================
// 🛡️ AEGIS C2 // SERVIDOR WEB & CONTROLADOR DO MOTOR ANTI-HACKER
// Servidor unificado para Easypanel / Docker / Nuvem
// Painel Web de Gestão de Whitelist + Motor Operação Aegis 24/7
// =====================================================================
const express = require('express');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const {
    iniciarOperacaoAegisCompleta,
    recarregarWhitelist,
    obterEstadoAegis,
    feedEventos
} = require('./operacao_black_aegis');

const app = express();
const PORT = process.env.PORT || 3000;

// Arquivos de dados persistentes
const ARQUIVO_WHITELIST = path.join(__dirname, 'whitelist_aegis.json');
const ARQUIVO_METADATA = path.join(__dirname, 'whitelist_metadata.json');

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

function salvarDados(lista, meta) {
    // 1. Salva whitelist em formato array puro (compatível 100% com Baileys e scripts legados)
    const listaUnica = Array.from(new Set(lista.map(extrairNumeroLimpo).filter(Boolean)));
    fs.writeFileSync(ARQUIVO_WHITELIST, JSON.stringify(listaUnica, null, 2), 'utf-8');

    // 2. Salva metadata detalhada (nomes, cargos, data)
    fs.writeFileSync(ARQUIVO_METADATA, JSON.stringify(meta, null, 2), 'utf-8');

    // 3. Atualiza cache em RAM do Aegis instantaneamente
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

// Cadastrar número único
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
            // Se já existia, atualiza apenas o nome
            meta[numFormatado] = {
                nome: nome?.trim() || meta[numFormatado]?.nome || 'Administrador',
                adicionadoEm: meta[numFormatado]?.adicionadoEm || new Date().toISOString()
            };
            salvarDados(lista, meta);
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

        salvarDados(lista, meta);

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

        // Divide por linhas, vírgulas, ponto e vírgula
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

        salvarDados(lista, meta);

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

// Remover administrador
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

        salvarDados(lista, meta);

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
// 📦 BACKUP E RESTAURAÇÃO DE SESSÕES (FÁCIL MIGRAÇÃO PARA EASYPANEL)
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

// Baixar Sessões dos 4 Snipers em ZIP
app.get('/api/backup/sessoes', (req, res) => {
    try {
        const zip = new AdmZip();
        let encontrou = false;

        for (let i = 1; i <= 4; i++) {
            const pasta = path.join(__dirname, `auth_sniper_${i}`);
            if (fs.existsSync(pasta)) {
                zip.addLocalFolder(pasta, `auth_sniper_${i}`);
                encontrou = true;
            }
        }

        if (fs.existsSync(ARQUIVO_WHITELIST)) {
            zip.addLocalFile(ARQUIVO_WHITELIST);
        }
        if (fs.existsSync(ARQUIVO_METADATA)) {
            zip.addLocalFile(ARQUIVO_METADATA);
        }

        if (!encontrou) {
            return res.status(404).json({ sucesso: false, erro: 'Nenhuma pasta de sessão auth_sniper_* encontrada.' });
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

        // Atualiza whitelist se veio no zip
        recarregarWhitelist();

        res.json({
            sucesso: true,
            mensagem: 'Sessões e configurações extraídas com sucesso no servidor! Reinicie o container para ativar os novos acessos.'
        });
    } catch (err) {
        res.status(500).json({ sucesso: false, erro: err.message });
    }
});

// =====================================================================
// 🚀 INICIALIZAÇÃO DO SERVIDOR WEB + MOTOR AEGIS
// =====================================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n=================================================================');
    console.log(`🌐 [AEGIS C2] PAINEL WEB ATIVO NA PORTA: http://0.0.0.0:${PORT}`);
    console.log('📌  Acesse no navegador para gerenciar a Whitelist e ver o feed da Catraca.');
    console.log('=================================================================\n');

    // Inicia o motor WhatsApp em segundo plano automaticamente (salvo se START_BOT=false)
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
