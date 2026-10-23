// =====================================================================
// 🛡️ AEGIS C2 FRONTEND CLIENT LOGIC // V8.0 ULTRA
// Gestão de Whitelist, Espiões (QR & Código), Blacklist e Configurações
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
    // =================================================================
    // 🧠 ESTADO DA APLICAÇÃO
    // =================================================================
    let listaAdminsCache = [];
    let listaBlacklistCache = [];
    let listaCrocodilosCache = [];
    let listaEspioesCache = [];
    let listaCampanhasCache = [];
    let configCache = { limiteGruposPorCampanha: 4, quantidadeEspioes: 4, limiteBanPermanente: 10 };
    
    let numeroParaExcluir = null;
    let numeroParaDesbanir = null;
    let indiceEspiaoParaAcao = null;
    
    let feedPausado = false;
    let modalQrAtivo = false;
    let modalCodigoAtivo = false;
    let pollingInterval = null;
    let fastPollingTimer = null;

    // =================================================================
    // 🎯 ELEMENTOS DO DOM: MÉTRICAS & HEADER
    // =================================================================
    const serverStatusText = document.getElementById('server-status-text');
    const btnRefreshAll = document.getElementById('btn-refresh-all');

    const navBadgeCampanhas = document.getElementById('nav-badge-campanhas');
    const btnSyncSendflow = document.getElementById('btn-sync-sendflow');
    const syncIcon = document.getElementById('sync-icon');
    const syncText = document.getElementById('sync-text');
    const sendflowValUltimaSync = document.getElementById('sendflow-val-ultima-sync');
    const sendflowValProximaSync = document.getElementById('sendflow-val-proxima-sync');
    const sendflowValTotalCampanhas = document.getElementById('sendflow-val-total-campanhas');
    const sendflowValTotalGrupos = document.getElementById('sendflow-val-total-grupos');
    const syncStatusMsg = document.getElementById('sync-status-msg');
    const searchCampanhaInput = document.getElementById('search-campanha-input');
    const containerCampanhasLista = document.getElementById('container-campanhas-lista');

    const valTotalAdmins = document.getElementById('val-total-admins');
    const badgeTotalAdmins = document.getElementById('badge-total-admins');
    const navBadgeWhitelist = document.getElementById('nav-badge-whitelist');

    const valEspioesStatus = document.getElementById('val-espioes-status');
    const espioesIndicatorsRow = document.getElementById('espioes-indicators-row');
    const navBadgeEspioes = document.getElementById('nav-badge-espioes');

    const valMetricLimiteGrupos = document.getElementById('val-metric-limite-grupos');
    const valMetricDescBan = document.getElementById('val-metric-desc-ban');

    const valTotalBlacklist = document.getElementById('val-total-blacklist');
    const badgeTotalBlacklist = document.getElementById('badge-total-blacklist');
    const navBadgeBlacklist = document.getElementById('nav-badge-blacklist');

    const valUptime = document.getElementById('val-uptime');
    const valMemory = document.getElementById('val-memory');

    // =================================================================
    // 🔀 NAVEGAÇÃO ENTRE MÓDULOS (ABAS)
    // =================================================================
    const navTabBtns = document.querySelectorAll('.nav-tab-btn');
    const moduleViews = document.querySelectorAll('.module-view');

    navTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetView = btn.dataset.view;
            if (!targetView) return;

            navTabBtns.forEach(b => b.classList.remove('active'));
            moduleViews.forEach(v => v.classList.remove('active'));

            btn.classList.add('active');
            const viewElement = document.getElementById(`view-${targetView}`);
            if (viewElement) viewElement.classList.add('active');

            // Carrega dados sob demanda se necessário
            if (targetView === 'campanhas') carregarCampanhasSendflow();
            if (targetView === 'espioes') carregarEspioes();
            if (targetView === 'blacklist') {
                carregarBlacklist();
                carregarCrocodilos();
            }
            if (targetView === 'config') carregarConfiguracoes();
        });
    });

    // =================================================================
    // 🔔 SISTEMA DE NOTIFICAÇÕES (TOASTS)
    // =================================================================
    const toastContainer = document.getElementById('toast-container');

    function showToast(mensagem, tipo = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${tipo}`;
        
        let icone = '✅';
        if (tipo === 'error') icone = '❌';
        if (tipo === 'warning') icone = '⚠️';

        toast.innerHTML = `<span>${icone}</span><span>${escapeHtml(mensagem)}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 3800);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // =================================================================
    // 📱 FORMATAÇÃO E MÁSCARA DE TELEFONE BR
    // =================================================================
    function aplicarMascaraTelefone(inputElement) {
        if (!inputElement) return;
        inputElement.addEventListener('input', (e) => {
            let valor = e.target.value.replace(/\D/g, '');
            if (valor.length > 13) valor = valor.substring(0, 13);

            if (valor.startsWith('55')) {
                if (valor.length <= 4) {
                    e.target.value = `+${valor}`;
                } else if (valor.length <= 9) {
                    e.target.value = `+55 (${valor.substring(2, 4)}) ${valor.substring(4)}`;
                } else {
                    e.target.value = `+55 (${valor.substring(2, 4)}) ${valor.substring(4, 9)}-${valor.substring(9)}`;
                }
            } else {
                if (valor.length <= 2) {
                    e.target.value = valor.length ? `(${valor}` : '';
                } else if (valor.length <= 6) {
                    e.target.value = `(${valor.substring(0, 2)}) ${valor.substring(2)}`;
                } else if (valor.length <= 10) {
                    e.target.value = `(${valor.substring(0, 2)}) ${valor.substring(2, 6)}-${valor.substring(6)}`;
                } else {
                    e.target.value = `(${valor.substring(0, 2)}) ${valor.substring(2, 7)}-${valor.substring(7, 11)}`;
                }
            }
        });
    }

    // =================================================================
    // 👑 MÓDULO 1: WHITELIST (ADMINISTRADORES)
    // =================================================================
    const formAddAdmin = document.getElementById('form-add-admin');
    const inputTelefone = document.getElementById('input-telefone');
    const inputNome = document.getElementById('input-nome');
    const btnSubmitSingle = document.getElementById('btn-submit-single');

    const formBulkAdmin = document.getElementById('form-bulk-admin');
    const textareaBulk = document.getElementById('textarea-bulk');
    const inputBulkTag = document.getElementById('input-bulk-tag');
    const bulkDetectedCount = document.getElementById('bulk-detected-count');
    const btnSubmitBulk = document.getElementById('btn-submit-bulk');

    const inputSearchAdmins = document.getElementById('input-search-admins');
    const btnClearSearch = document.getElementById('btn-clear-search');
    const adminsListContainer = document.getElementById('admins-list-container');
    const btnCopyAll = document.getElementById('btn-copy-all');

    const modalDeleteAdmin = document.getElementById('modal-delete-admin');
    const modalDeleteMessage = document.getElementById('modal-delete-message');
    const modalBtnCancel = document.getElementById('modal-btn-cancel');
    const modalBtnConfirmDelete = document.getElementById('modal-btn-confirm-delete');

    aplicarMascaraTelefone(inputTelefone);

    // Navegação interna das abas do formulário Whitelist
    const cadastroTabBtns = document.querySelectorAll('#cadastro-tabs-nav .tab-btn');
    cadastroTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            cadastroTabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('#card-cadastro-whitelist .tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const content = document.getElementById(`tab-content-${target}`);
            if (content) content.classList.add('active');
        });
    });

    textareaBulk.addEventListener('input', (e) => {
        const texto = e.target.value;
        const linhas = texto.split(/[\r\n,;]+/);
        const validos = new Set();
        for (const l of linhas) {
            const limpo = l.replace(/\D/g, '');
            if (limpo.length >= 10) validos.add(limpo);
        }
        bulkDetectedCount.textContent = `${validos.size} número${validos.size === 1 ? '' : 's'} válido${validos.size === 1 ? '' : 's'} detectado${validos.size === 1 ? '' : 's'}`;
    });

    async function carregarWhitelist() {
        try {
            const res = await fetch('/api/whitelist');
            const data = await res.json();
            if (data.sucesso) {
                listaAdminsCache = data.administradores || [];
                renderizarListaAdmins(listaAdminsCache);
                atualizarContadoresWhitelist(listaAdminsCache.length);
            }
        } catch (err) {
            console.error('[!] Erro ao carregar Whitelist:', err);
        }
    }

    function atualizarContadoresWhitelist(total) {
        valTotalAdmins.textContent = total;
        badgeTotalAdmins.textContent = total;
        navBadgeWhitelist.textContent = total;
    }

    function renderizarListaAdmins(lista) {
        if (!lista || lista.length === 0) {
            adminsListContainer.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">🛡️</span>
                    <p class="empty-title">Nenhum administrador encontrado</p>
                    <p class="empty-subtitle">Cadastre os números autorizados usando o formulário ao lado.</p>
                </div>
            `;
            return;
        }

        adminsListContainer.innerHTML = '';
        lista.forEach(item => {
            const card = document.createElement('div');
            card.className = 'admin-item';
            card.id = `admin-card-${item.numero}`;

            const dataFormatada = item.adicionadoEm
                ? new Date(item.adicionadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : 'Data não registrada';

            card.innerHTML = `
                <div class="admin-item-info">
                    <div class="admin-number-row">
                        <span class="admin-number">${escapeHtml(item.numeroFormatado)}</span>
                        <span class="badge-role">${escapeHtml(item.nome)}</span>
                    </div>
                    <span class="admin-date">Cadastrado em: ${escapeHtml(dataFormatada)}</span>
                </div>
                <div class="admin-item-actions">
                    <button class="btn-action-icon btn-action-copy" data-numero="${escapeHtml(item.numero)}" title="Copiar número puro">
                        📋
                    </button>
                    <button class="btn-action-icon btn-action-delete" data-numero="${escapeHtml(item.numero)}" data-formatado="${escapeHtml(item.numeroFormatado)}" title="Remover da Whitelist">
                        🗑️
                    </button>
                </div>
            `;
            adminsListContainer.appendChild(card);
        });

        // Eventos de cópia e exclusão
        document.querySelectorAll('.btn-action-copy').forEach(b => {
            b.addEventListener('click', (e) => {
                const num = e.currentTarget.dataset.numero;
                navigator.clipboard.writeText(num).then(() => {
                    showToast(`Número ${num} copiado!`);
                });
            });
        });

        document.querySelectorAll('.btn-action-delete').forEach(b => {
            b.addEventListener('click', (e) => {
                numeroParaExcluir = e.currentTarget.dataset.numero;
                const numFormatado = e.currentTarget.dataset.formatado;
                modalDeleteMessage.textContent = `Tem certeza que deseja remover ${numFormatado} da Whitelist de Administradores?`;
                modalDeleteAdmin.style.display = 'flex';
            });
        });
    }

    // Busca rápida de administradores
    inputSearchAdmins.addEventListener('input', (e) => {
        const termo = e.target.value.toLowerCase().trim();
        btnClearSearch.style.display = termo ? 'block' : 'none';

        if (!termo) {
            renderizarListaAdmins(listaAdminsCache);
            return;
        }

        const termoLimpo = termo.replace(/\D/g, '');
        const filtrados = listaAdminsCache.filter(item => {
            const num = String(item.numero || '');
            const nome = String(item.nome || '').toLowerCase();
            return (termoLimpo && num.includes(termoLimpo)) || nome.includes(termo);
        });

        renderizarListaAdmins(filtrados);
    });

    btnClearSearch.addEventListener('click', () => {
        inputSearchAdmins.value = '';
        btnClearSearch.style.display = 'none';
        renderizarListaAdmins(listaAdminsCache);
    });

    // Cadastro individual
    formAddAdmin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const telefone = inputTelefone.value.trim();
        const nome = inputNome.value.trim();
        if (!telefone) return;

        btnSubmitSingle.disabled = true;
        btnSubmitSingle.innerHTML = '<span class="spinner"></span> Salvando...';

        try {
            const res = await fetch('/api/whitelist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numero: telefone, nome })
            });
            const data = await res.json();

            if (data.sucesso) {
                showToast(data.mensagem);
                inputTelefone.value = '';
                inputNome.value = '';
                await carregarWhitelist();
            } else {
                showToast(data.erro || 'Erro ao salvar administrador.', 'error');
            }
        } catch (err) {
            showToast('Falha na comunicação com o servidor.', 'error');
        } finally {
            btnSubmitSingle.disabled = false;
            btnSubmitSingle.innerHTML = '<span class="btn-icon">🛡️</span><span class="btn-text">Salvar na Whitelist</span>';
        }
    });

    // Cadastro em massa
    formBulkAdmin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const texto = textareaBulk.value.trim();
        const nomePadrao = inputBulkTag.value.trim();
        if (!texto) return;

        btnSubmitBulk.disabled = true;
        btnSubmitBulk.innerHTML = '<span class="spinner"></span> Processando lote...';

        try {
            const res = await fetch('/api/whitelist/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ texto, nomePadrao })
            });
            const data = await res.json();

            if (data.sucesso) {
                showToast(data.mensagem);
                textareaBulk.value = '';
                inputBulkTag.value = '';
                bulkDetectedCount.textContent = '0 números detectados';
                await carregarWhitelist();
            } else {
                showToast(data.erro || 'Erro ao importar lote.', 'error');
            }
        } catch (err) {
            showToast('Falha ao enviar lista em lote.', 'error');
        } finally {
            btnSubmitBulk.disabled = false;
            btnSubmitBulk.innerHTML = '<span class="btn-icon">⚡</span><span class="btn-text">Importar Todos os Números</span>';
        }
    });

    // Confirmação de exclusão Whitelist
    modalBtnCancel.addEventListener('click', () => {
        modalDeleteAdmin.style.display = 'none';
        numeroParaExcluir = null;
    });

    modalBtnConfirmDelete.addEventListener('click', async () => {
        if (!numeroParaExcluir) return;
        modalBtnConfirmDelete.disabled = true;
        modalBtnConfirmDelete.textContent = 'Removendo...';

        try {
            const res = await fetch(`/api/whitelist/${numeroParaExcluir}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.sucesso) {
                showToast(data.mensagem);
                modalDeleteAdmin.style.display = 'none';
                numeroParaExcluir = null;
                await carregarWhitelist();
            } else {
                showToast(data.erro || 'Erro ao excluir.', 'error');
            }
        } catch (err) {
            showToast('Erro de comunicação.', 'error');
        } finally {
            modalBtnConfirmDelete.disabled = false;
            modalBtnConfirmDelete.textContent = 'Sim, Remover';
        }
    });

    // Copiar todos os números da Whitelist
    btnCopyAll.addEventListener('click', () => {
        if (!listaAdminsCache || listaAdminsCache.length === 0) {
            showToast('Nenhum número para copiar.', 'warning');
            return;
        }
        const todos = listaAdminsCache.map(a => a.numero).join('\n');
        navigator.clipboard.writeText(todos).then(() => {
            showToast(`${listaAdminsCache.length} números copiados para a área de transferência!`);
        });
    });

    // =================================================================
    // 🕵️ MÓDULO 2: ESPIÕES DO WHATSAPP (QR CODE & CÓDIGO)
    // =================================================================
    const espioesCampanhasContainer = document.getElementById('espioes-campanhas-container');
    const inputSearchAdmsCampanhas = document.getElementById('input-search-adms-campanhas');
    const admsSummaryText = document.getElementById('adms-summary-text');
    const btnForceConnectAll = document.getElementById('btn-force-connect-all');

    // Modais de Conexão
    const modalQr = document.getElementById('modal-qr');
    const modalQrTitle = document.getElementById('modal-qr-title');
    const modalQrStatusPill = document.getElementById('modal-qr-status-pill');
    const modalQrImgWrap = document.getElementById('modal-qr-img-wrap');
    const modalQrClose = document.getElementById('modal-qr-close');
    const modalQrBtnCancel = document.getElementById('modal-qr-btn-cancel');

    const modalCode = document.getElementById('modal-code');
    const modalCodeTitle = document.getElementById('modal-code-title');
    const modalCodeClose = document.getElementById('modal-code-close');
    const modalCodeBtnCancel = document.getElementById('modal-code-btn-cancel');
    const modalCodeBtnGenerate = document.getElementById('modal-code-btn-generate');
    const inputCodePhone = document.getElementById('input-code-phone');
    const codeStepInput = document.getElementById('code-step-input');
    const codeStepDisplay = document.getElementById('code-step-display');
    const pairingCodeText = document.getElementById('pairing-code-text');
    const btnCopyPairingCode = document.getElementById('btn-copy-pairing-code');
    const modalCodeDisplayClose = document.getElementById('modal-code-display-close');

    // Modal de Confirmação de Desconexão
    const modalConfirmDisconnect = document.getElementById('modal-confirm-disconnect');
    const modalDisconnectMessage = document.getElementById('modal-disconnect-message');
    const modalDisconnectCancel = document.getElementById('modal-disconnect-cancel');
    const modalDisconnectConfirm = document.getElementById('modal-disconnect-confirm');

    // Modal de Confirmação de Remoção de Sniper da Campanha
    const modalDeleteSniper = document.getElementById('modal-delete-sniper');
    const modalDeleteSniperMessage = document.getElementById('modal-delete-sniper-message');
    const modalBtnCancelDeleteSniper = document.getElementById('modal-btn-cancel-delete-sniper');
    const modalBtnConfirmDeleteSniper = document.getElementById('modal-btn-confirm-delete-sniper');

    let cacheDadosAdmsPorCampanha = null;
    let idSniperParaRemover = null;

    aplicarMascaraTelefone(inputCodePhone);

    // Filtro em tempo real de campanhas na aba de ADMs
    if (inputSearchAdmsCampanhas) {
        inputSearchAdmsCampanhas.addEventListener('input', (e) => {
            const termo = e.target.value.trim().toLowerCase();
            if (cacheDadosAdmsPorCampanha) {
                renderizarCampanhasComAdms(cacheDadosAdmsPorCampanha.campanhas, cacheDadosAdmsPorCampanha.globais, termo);
            }
        });
    }

    btnForceConnectAll.addEventListener('click', async () => {
        btnForceConnectAll.disabled = true;
        btnForceConnectAll.innerHTML = '<span class="spinner"></span> Conectando...';
        try {
            const res = await fetch('/api/snipers/conectar', { method: 'POST' });
            const data = await res.json();
            if (data.sucesso) {
                showToast(data.mensagem || 'Comando de conexão enviado a todas as contas de ADM!');
                setTimeout(() => carregarEspioes(), 2000);
            }
        } catch (e) {
            showToast('Erro ao disparar conexões.', 'error');
        } finally {
            btnForceConnectAll.disabled = false;
            btnForceConnectAll.innerHTML = '🔄 Reconectar Todos os ADMs';
        }
    });

    async function carregarEspioes() {
        try {
            const res = await fetch('/api/adms/por-campanha');
            const data = await res.json();
            if (data.sucesso) {
                cacheDadosAdmsPorCampanha = data;
                listaEspioesCache = data.snipers || [];

                atualizarMetricasEspioes(data.totalConectadosGeral, data.totalSnipersGeral, listaEspioesCache);
                if (admsSummaryText) {
                    admsSummaryText.textContent = `${data.totalCampanhas} Campanhas ativas | ${data.totalSnipersGeral} ADMs Snipers configurados (${data.totalConectadosGeral} online).`;
                }

                const termo = inputSearchAdmsCampanhas ? inputSearchAdmsCampanhas.value.trim().toLowerCase() : '';
                renderizarCampanhasComAdms(data.campanhas, data.globais, termo);

                // Se modal QR ou Código estiver aberto, atualiza estado do ADM ativo
                if (modalQrAtivo && indiceEspiaoParaAcao) {
                    const espAtivo = listaEspioesCache.find(x => x.indice === indiceEspiaoParaAcao || x.id === indiceEspiaoParaAcao);
                    if (espAtivo) atualizarEstadoModalQr(espAtivo);
                }
                if (modalCodigoAtivo && indiceEspiaoParaAcao) {
                    const espAtivo = listaEspioesCache.find(x => x.indice === indiceEspiaoParaAcao || x.id === indiceEspiaoParaAcao);
                    if (espAtivo) atualizarEstadoModalCodigo(espAtivo);
                }
            } else {
                if (espioesCampanhasContainer) {
                    espioesCampanhasContainer.innerHTML = `
                        <div class="empty-state">
                            <span class="empty-icon">⚠️</span>
                            <p class="empty-title">Erro ao carregar lista de ADMs por campanha</p>
                            <p class="empty-subtitle">${escapeHtml(data.erro || 'Falha na resposta do servidor.')}</p>
                        </div>
                    `;
                }
            }
        } catch (err) {
            console.error('[!] Erro ao carregar ADMs:', err);
            if (espioesCampanhasContainer) {
                espioesCampanhasContainer.innerHTML = `
                    <div class="empty-state">
                        <span class="empty-icon">⚠️</span>
                        <p class="empty-title">Servidor não respondeu</p>
                        <p class="empty-subtitle">Verifique se o backend está em execução na porta 3000.</p>
                    </div>
                `;
            }
        }
    }

    function atualizarMetricasEspioes(conectados, total, lista) {
        if (valEspioesStatus) valEspioesStatus.textContent = `${conectados} / ${total}`;
        if (navBadgeEspioes) navBadgeEspioes.textContent = `${conectados}/${total}`;

        if (espioesIndicatorsRow) {
            espioesIndicatorsRow.innerHTML = '';
            lista.forEach(e => {
                const dot = document.createElement('span');
                dot.className = `sniper-dot ${e.conectado ? 'active' : ''}`;
                const idx = e.id || e.indice;
                dot.textContent = idx < 10 ? `0${idx}` : `${idx}`;
                dot.title = `ADM 0${idx} (${e.campaignName || 'Global'}): ${e.conectado ? 'Conectado' : 'Desconectado'}`;
                espioesIndicatorsRow.appendChild(dot);
            });
        }
    }

    function criarCardSniperHtml(esp, campaignName) {
        const idSniper = esp.id || esp.indice;
        const ehConectado = esp.conectado;
        const statusClass = ehConectado ? 'connected' : (esp.status === 'qr_pronto' || esp.status === 'codigo_pronto' ? 'waiting' : 'disconnected');

        let statusPillTexto = '⚪ DESCONECTADO';
        if (ehConectado) statusPillTexto = '🟢 CONECTADO';
        else if (esp.status === 'qr_pronto') statusPillTexto = '🟡 QR PRONTO';
        else if (esp.status === 'codigo_pronto') statusPillTexto = '🟡 CÓDIGO GERADO';
        else if (esp.status === 'solicitando_codigo' || esp.status === 'gerando_qr') statusPillTexto = '⏳ AGUARDANDO...';

        const phoneDisplayHtml = ehConectado
            ? `
                <div class="espiao-phone-display">
                    <span class="espiao-phone-icon">📱</span>
                    <span class="espiao-phone-text">${escapeHtml(esp.numeroFormatado || '+' + esp.numero)}</span>
                </div>
            `
            : `
                <div class="espiao-phone-display" style="opacity: 0.6;">
                    <span class="espiao-phone-icon">⚪</span>
                    <span class="espiao-phone-text">Nenhum chip conectado</span>
                </div>
            `;

        const actionsHtml = ehConectado
            ? `
                <button class="btn-espiao-disconnect" data-indice="${idSniper}" title="Desconectar este chip">
                    🔌 Desconectar Chip
                </button>
            `
            : `
                <div class="espiao-action-btn-group">
                    <button class="btn-espiao-connect btn-open-qr" data-indice="${idSniper}" data-campanha="${escapeHtml(campaignName)}">
                        <span>📷</span> Ler QR Code
                    </button>
                    <button class="btn-espiao-connect btn-open-code" data-indice="${idSniper}" data-campanha="${escapeHtml(campaignName)}">
                        <span>🔢</span> Via Código
                    </button>
                </div>
            `;

        return `
            <div class="espiao-card ${statusClass}" id="espiao-card-${idSniper}">
                <div class="espiao-card-header">
                    <span class="espiao-tag-title">
                        <span>🛡️</span> ADM #${idSniper < 10 ? '0' + idSniper : idSniper}
                    </span>
                    <span class="status-pill-espiao ${statusClass}">${statusPillTexto}</span>
                </div>
                <div class="espiao-card-body">
                    ${phoneDisplayHtml}
                    ${actionsHtml}
                    <button class="btn-espiao-delete" data-id="${idSniper}" data-campanha="${escapeHtml(campaignName)}" title="Remover permanentemente este ADM desta campanha">
                        <span>🗑️</span> Remover ADM
                    </button>
                </div>
            </div>
        `;
    }

    function renderizarCampanhasComAdms(campanhas, globais, termoFiltro = '') {
        if (!espioesCampanhasContainer) return;

        let listaFiltrada = campanhas || [];
        if (termoFiltro) {
            listaFiltrada = listaFiltrada.filter(c =>
                c.name.toLowerCase().includes(termoFiltro) ||
                c.id.toLowerCase().includes(termoFiltro)
            );
        }

        if (listaFiltrada.length === 0 && (!globais || globais.length === 0)) {
            espioesCampanhasContainer.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">🔍</span>
                    <p class="empty-title">Nenhuma campanha encontrada</p>
                    <p class="empty-subtitle">${termoFiltro ? 'Nenhum resultado corresponde ao termo digitado.' : 'Sincronize as campanhas na aba SendFlow.'}</p>
                </div>
            `;
            return;
        }

        let html = '';

        // Renderiza cada campanha ativa do SendFlow
        listaFiltrada.forEach(camp => {
            const snipers = camp.snipers || [];
            const onlineCount = camp.conectados || 0;
            const totalCount = snipers.length;
            const badgeClass = onlineCount > 0 ? 'badge-emerald' : 'badge-amber';

            let cardsHtml = '';
            if (snipers.length === 0) {
                cardsHtml = `
                    <div class="empty-campanha-adms">
                        ℹ️ Nenhum ADM Sniper cadastrado para a campanha <strong>${escapeHtml(camp.name)}</strong> ainda. Clique no botão abaixo para adicionar.
                    </div>
                `;
            } else {
                cardsHtml = snipers.map(s => criarCardSniperHtml(s, camp.name)).join('');
            }

            html += `
                <div class="campanha-adms-block" id="campanha-block-${camp.id}">
                    <div class="campanha-adms-header">
                        <div class="campanha-adms-title-group">
                            <h3 class="campanha-adms-title">
                                <span>🚀</span> ${escapeHtml(camp.name)}
                            </h3>
                            <div class="campanha-adms-badges">
                                <span class="badge-tag-campanha badge-cyan">ID: ${camp.id}</span>
                                <span class="badge-tag-campanha">${camp.totalGrupos} Grupos</span>
                                <span class="badge-tag-campanha ${badgeClass}">
                                    ${onlineCount}/${totalCount} ADMs Conectados
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="campanha-adms-grid">
                        ${cardsHtml}
                    </div>

                    <div class="campanha-adms-footer">
                        <button class="btn-add-adm-campanha" data-campaign-id="${camp.id}" data-campaign-name="${escapeHtml(camp.name)}">
                            <span class="btn-icon">➕</span>
                            <span class="btn-text">Adicionar ADM Sniper nesta Campanha</span>
                        </button>
                    </div>
                </div>
            `;
        });

        // Seção para ADMs globais / sem campanha associada (se houver)
        if (globais && globais.length > 0 && (!termoFiltro || 'globais'.includes(termoFiltro))) {
            const onlineCount = globais.filter(g => g.conectado).length;
            const cardsHtml = globais.map(s => criarCardSniperHtml(s, 'Global / Sem Campanha')).join('');

            html += `
                <div class="campanha-adms-block" style="border-color: rgba(245, 158, 11, 0.35);">
                    <div class="campanha-adms-header">
                        <div class="campanha-adms-title-group">
                            <h3 class="campanha-adms-title">
                                <span>🌐</span> ADMs Globais / Sem Campanha Vinculada
                            </h3>
                            <div class="campanha-adms-badges">
                                <span class="badge-tag-campanha badge-amber">${onlineCount}/${globais.length} Conectados</span>
                            </div>
                        </div>
                    </div>
                    <div class="campanha-adms-grid">
                        ${cardsHtml}
                    </div>
                </div>
            `;
        }

        espioesCampanhasContainer.innerHTML = html;

        // VINCULAR EVENTOS
        // 1. Botão Adicionar ADM Sniper nesta Campanha
        espioesCampanhasContainer.querySelectorAll('.btn-add-adm-campanha').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetBtn = e.currentTarget;
                const campaignId = targetBtn.dataset.campaignId;
                const campaignName = targetBtn.dataset.campaignName;

                targetBtn.disabled = true;
                targetBtn.innerHTML = '<span class="spinner"></span> Adicionando...';

                try {
                    const res = await fetch(`/api/adms/campanha/${campaignId}/novo`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ campaignName })
                    });
                    const data = await res.json();
                    if (data.sucesso) {
                        showToast(data.mensagem || `Novo ADM Sniper criado para "${campaignName}"!`);
                        await carregarEspioes();
                    } else {
                        showToast(data.erro || 'Erro ao adicionar ADM.', 'error');
                    }
                } catch (err) {
                    showToast('Erro de comunicação.', 'error');
                } finally {
                    targetBtn.disabled = false;
                    targetBtn.innerHTML = '<span class="btn-icon">➕</span><span class="btn-text">Adicionar ADM Sniper nesta Campanha</span>';
                }
            });
        });

        // 2. Botão Ler QR Code
        espioesCampanhasContainer.querySelectorAll('.btn-open-qr').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = Number(e.currentTarget.dataset.indice);
                const campName = e.currentTarget.dataset.campanha || '';
                abrirModalQr(idx, campName);
            });
        });

        // 3. Botão Via Código
        espioesCampanhasContainer.querySelectorAll('.btn-open-code').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = Number(e.currentTarget.dataset.indice);
                const campName = e.currentTarget.dataset.campanha || '';
                abrirModalCodigo(idx, campName);
            });
        });

        // 4. Botão Desconectar
        espioesCampanhasContainer.querySelectorAll('.btn-espiao-disconnect').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = Number(e.currentTarget.dataset.indice);
                abrirModalConfirmDisconnect(idx);
            });
        });

        // 5. Botão Remover ADM Permanentemente da Campanha
        espioesCampanhasContainer.querySelectorAll('.btn-espiao-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = Number(e.currentTarget.dataset.id);
                const campName = e.currentTarget.dataset.campanha || 'Campanha';
                abrirModalConfirmDeleteSniper(id, campName);
            });
        });
    }

    // Modal de Confirmação de Remoção de Sniper
    function abrirModalConfirmDeleteSniper(id, campName) {
        idSniperParaRemover = id;
        if (modalDeleteSniperMessage) {
            modalDeleteSniperMessage.innerHTML = `Tem certeza que deseja remover o <strong>ADM Sniper #0${id}</strong> da campanha <strong>"${escapeHtml(campName)}"</strong>?<br><br>As credenciais salvas serão excluídas e o chip desconectado. Os ADMs das outras campanhas continuarão funcionando sem alterações.`;
        }
        if (modalDeleteSniper) modalDeleteSniper.style.display = 'flex';
    }

    if (modalBtnCancelDeleteSniper) {
        modalBtnCancelDeleteSniper.addEventListener('click', () => {
            if (modalDeleteSniper) modalDeleteSniper.style.display = 'none';
            idSniperParaRemover = null;
        });
    }

    if (modalBtnConfirmDeleteSniper) {
        modalBtnConfirmDeleteSniper.addEventListener('click', async () => {
            if (!idSniperParaRemover) return;
            modalBtnConfirmDeleteSniper.disabled = true;
            modalBtnConfirmDeleteSniper.textContent = 'Removendo...';

            try {
                const res = await fetch(`/api/adms/${idSniperParaRemover}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.sucesso) {
                    showToast(data.mensagem || 'ADM Sniper removido com sucesso!');
                    if (modalDeleteSniper) modalDeleteSniper.style.display = 'none';
                    idSniperParaRemover = null;
                    await carregarEspioes();
                } else {
                    showToast(data.erro || 'Erro ao remover ADM.', 'error');
                }
            } catch (err) {
                showToast('Erro de comunicação.', 'error');
            } finally {
                modalBtnConfirmDeleteSniper.disabled = false;
                modalBtnConfirmDeleteSniper.textContent = 'Sim, Remover ADM';
            }
        });
    }

    // Modal QR Code Flow
    async function abrirModalQr(indice, campName = '') {
        indiceEspiaoParaAcao = indice;
        modalQrAtivo = true;
        modalQrTitle.textContent = campName ? `Conectar ADM #0${indice} [${campName}] via QR Code` : `Conectar ADM #0${indice} via QR Code`;
        modalQrStatusPill.textContent = 'Gerando QR Code...';
        modalQrStatusPill.className = 'status-pill-espiao waiting';
        modalQrImgWrap.innerHTML = `
            <span class="spinner spinner-lg"></span>
            <span class="qr-loading-text">Iniciando sessão do WhatsApp e gerando QR Code...</span>
        `;
        modalQr.style.display = 'flex';

        // Dispara geração no backend
        try {
            await fetch(`/api/adms/${indice}/conectar-qr`, { method: 'POST' });
        } catch (e) {
            console.error('[!] Erro ao disparar QR:', e);
        }

        // Ativa polling rápido
        iniciarFastPolling();
    }

    function atualizarEstadoModalQr(esp) {
        if (!modalQrAtivo || esp.indice !== indiceEspiaoParaAcao) return;

        if (esp.conectado) {
            modalQrStatusPill.textContent = '🟢 CONECTADO!';
            modalQrStatusPill.className = 'status-pill-espiao connected';
            modalQrImgWrap.innerHTML = `
                <div style="text-align: center; color: #10b981; padding: 20px;">
                    <div style="font-size: 3rem; margin-bottom: 8px;">✅</div>
                    <strong style="font-size: 1.1rem; color: #042f2e;">ADM Conectado com Sucesso!</strong>
                    <p style="font-size: 0.85rem; color: #064e3b; margin-top: 4px;">Número: ${esp.numeroFormatado || esp.numero}</p>
                </div>
            `;
            showToast(`ADM 0${esp.indice} conectado com sucesso!`);
            setTimeout(() => fecharModalQr(), 2200);
            return;
        }

        if (esp.qrCodeDataUrl) {
            modalQrStatusPill.textContent = 'Aguardando Escaneamento';
            modalQrStatusPill.className = 'status-pill-espiao waiting';
            const imgExistente = modalQrImgWrap.querySelector('img.qr-image');
            if (imgExistente) {
                if (imgExistente.src !== esp.qrCodeDataUrl) {
                    imgExistente.src = esp.qrCodeDataUrl;
                }
            } else {
                modalQrImgWrap.innerHTML = `<img src="${esp.qrCodeDataUrl}" alt="QR Code WhatsApp" class="qr-image" />`;
            }
        } else if (esp.erroMsg) {
            modalQrStatusPill.textContent = 'Erro ao gerar';
            modalQrStatusPill.className = 'status-pill-espiao disconnected';
            modalQrImgWrap.innerHTML = `<p style="color: #ef4444; font-size: 0.85rem; text-align: center; padding: 14px;">${escapeHtml(esp.erroMsg)}</p>`;
        }
    }

    function fecharModalQr() {
        modalQr.style.display = 'none';
        modalQrAtivo = false;
        indiceEspiaoParaAcao = null;
        pararFastPolling();
        carregarEspioes();
    }

    modalQrClose.addEventListener('click', fecharModalQr);
    modalQrBtnCancel.addEventListener('click', fecharModalQr);

    // Modal Código de Pareamento Flow
    function abrirModalCodigo(indice, campName = '') {
        indiceEspiaoParaAcao = indice;
        modalCodigoAtivo = true;
        modalCodeTitle.textContent = campName ? `Conectar ADM #0${indice} [${campName}] via Código` : `Conectar ADM #0${indice} via Código`;
        inputCodePhone.value = '';
        codeStepInput.style.display = 'block';
        codeStepDisplay.style.display = 'none';
        modalCode.style.display = 'flex';
    }

    modalCodeBtnGenerate.addEventListener('click', async () => {
        const tel = inputCodePhone.value.trim();
        if (!tel) {
            showToast('Digite o número do WhatsApp com DDD.', 'warning');
            return;
        }

        modalCodeBtnGenerate.disabled = true;
        modalCodeBtnGenerate.innerHTML = '<span class="spinner"></span> Solicitando código...';

        try {
            const res = await fetch(`/api/adms/${indiceEspiaoParaAcao}/conectar-codigo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telefone: tel })
            });
            const data = await res.json();

            if (data.sucesso) {
                codeStepInput.style.display = 'none';
                codeStepDisplay.style.display = 'block';
                pairingCodeText.textContent = 'SOLICITANDO...';
                iniciarFastPolling();
            } else {
                showToast(data.erro || 'Falha ao solicitar código.', 'error');
            }
        } catch (e) {
            showToast('Erro de comunicação.', 'error');
        } finally {
            modalCodeBtnGenerate.disabled = false;
            modalCodeBtnGenerate.innerHTML = '<span class="btn-icon">🔑</span> Gerar Código de Pareamento';
        }
    });

    function atualizarEstadoModalCodigo(esp) {
        if (!modalCodigoAtivo || esp.indice !== indiceEspiaoParaAcao) return;

        // 1. Se gerou o código de 8 dígitos, exibe com destaque na tela
        if (esp.pairingCode) {
            pairingCodeText.textContent = esp.pairingCode;
            pairingCodeText.style.color = '#06b6d4';
        }

        // 2. Só fecha e dá mensagem de sucesso após o celular de fato parear
        if (esp.conectado && esp.status === 'conectado') {
            pairingCodeText.textContent = 'CONECTADO!';
            pairingCodeText.style.color = '#10b981';
            showToast(`ADM 0${esp.indice} conectado com sucesso!`);
            setTimeout(() => fecharModalCodigo(), 2500);
            return;
        }

        if (esp.erroMsg) {
            pairingCodeText.textContent = 'ERRO';
            pairingCodeText.style.color = '#ef4444';
            showToast(esp.erroMsg, 'error');
        }
    }

    btnCopyPairingCode.addEventListener('click', () => {
        const code = pairingCodeText.textContent.replace(/[^A-Za-z0-9]/g, '');
        if (!code || code === 'SOLICITANDO' || code === 'ERRO') return;
        navigator.clipboard.writeText(code).then(() => {
            showToast(`Código ${code} copiado!`);
        });
    });

    function fecharModalCodigo() {
        modalCode.style.display = 'none';
        modalCodigoAtivo = false;
        indiceEspiaoParaAcao = null;
        pararFastPolling();
        carregarEspioes();
    }

    modalCodeClose.addEventListener('click', fecharModalCodigo);
    modalCodeBtnCancel.addEventListener('click', fecharModalCodigo);
    modalCodeDisplayClose.addEventListener('click', fecharModalCodigo);

    // Modal de Confirmação de Desconexão
    function abrirModalConfirmDisconnect(indice) {
        indiceEspiaoParaAcao = indice;
        modalDisconnectMessage.textContent = `Tem certeza que deseja desconectar o ADM #0${indice}? A pasta de sessão será limpa e ele deixará de monitorar os grupos até ser reconectado.`;
        modalConfirmDisconnect.style.display = 'flex';
    }

    modalDisconnectCancel.addEventListener('click', () => {
        modalConfirmDisconnect.style.display = 'none';
        indiceEspiaoParaAcao = null;
    });

    modalDisconnectConfirm.addEventListener('click', async () => {
        if (!indiceEspiaoParaAcao) return;
        modalDisconnectConfirm.disabled = true;
        modalDisconnectConfirm.textContent = 'Desconectando...';

        try {
            const res = await fetch(`/api/adms/${indiceEspiaoParaAcao}/desconectar`, { method: 'POST' });
            const data = await res.json();
            if (data.sucesso) {
                showToast(data.mensagem);
                modalConfirmDisconnect.style.display = 'none';
                indiceEspiaoParaAcao = null;
                await carregarEspioes();
            } else {
                showToast(data.erro || 'Falha ao desconectar.', 'error');
            }
        } catch (e) {
            showToast('Erro de comunicação.', 'error');
        } finally {
            modalDisconnectConfirm.disabled = false;
            modalDisconnectConfirm.textContent = 'Sim, Desconectar';
        }
    });

    function iniciarFastPolling() {
        pararFastPolling();
        fastPollingTimer = setInterval(() => {
            carregarEspioes();
        }, 1500);
    }

    function pararFastPolling() {
        if (fastPollingTimer) {
            clearInterval(fastPollingTimer);
            fastPollingTimer = null;
        }
    }

    // =================================================================
    // ⛔ MÓDULO 3: BLACKLIST (BANIDOS PERMANENTES)
    // =================================================================
    const blacklistItemsContainer = document.getElementById('blacklist-items-container');
    const inputSearchBlacklist = document.getElementById('input-search-blacklist');
    const btnClearSearchBlacklist = document.getElementById('btn-clear-search-blacklist');
    const btnOpenModalManualBan = document.getElementById('btn-open-modal-manual-ban');

    // Modais Blacklist
    const modalManualBan = document.getElementById('modal-manual-ban');
    const modalBanClose = document.getElementById('modal-ban-close');
    const modalBanCancel = document.getElementById('modal-ban-cancel');
    const modalBanConfirm = document.getElementById('modal-ban-confirm');
    const inputBanPhone = document.getElementById('input-ban-phone');
    const inputBanReason = document.getElementById('input-ban-reason');

    const modalUnbanConfirm = document.getElementById('modal-unban-confirm');
    const modalUnbanMessage = document.getElementById('modal-unban-message');
    const modalUnbanCancel = document.getElementById('modal-unban-cancel');
    const modalUnbanConfirmBtn = document.getElementById('modal-unban-confirm-btn');

    aplicarMascaraTelefone(inputBanPhone);

    async function carregarBlacklist() {
        try {
            const res = await fetch('/api/blacklist');
            const data = await res.json();
            if (data.sucesso) {
                listaBlacklistCache = data.banidos || [];
                renderizarListaBlacklist(listaBlacklistCache);
                atualizarContadoresBlacklist(listaBlacklistCache.length);
            }
        } catch (e) {
            console.error('[!] Erro ao carregar Blacklist:', e);
        }
    }

    function atualizarContadoresBlacklist(total) {
        valTotalBlacklist.textContent = total;
        badgeTotalBlacklist.textContent = total;
        navBadgeBlacklist.textContent = total;
    }

    function renderizarListaBlacklist(lista) {
        if (!lista || lista.length === 0) {
            blacklistItemsContainer.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">✨</span>
                    <p class="empty-title">Nenhum número na Blacklist permanente</p>
                    <p class="empty-subtitle">Leads que ultrapassarem o limite de links configurado aparecerão aqui automaticamente.</p>
                </div>
            `;
            return;
        }

        blacklistItemsContainer.innerHTML = '';
        lista.forEach(item => {
            const row = document.createElement('div');
            row.className = 'blacklist-item';
            row.id = `blacklist-row-${item.numero}`;

            const dataFormatada = item.dataBanimento
                ? new Date(item.dataBanimento).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : 'Data não registrada';

            row.innerHTML = `
                <div class="blacklist-item-info">
                    <div class="blacklist-num-row">
                        <span class="blacklist-num">${escapeHtml(item.numeroFormatado || '+' + item.numero)}</span>
                        <span class="badge-role" style="background: rgba(244, 63, 94, 0.15); color: #fda4af; border-color: rgba(244, 63, 94, 0.3);">BAN PERMANENTE</span>
                    </div>
                    <span class="blacklist-reason">${escapeHtml(item.motivo || 'Excedeu limite de links')}</span>
                    <span class="blacklist-date">Banido em: ${escapeHtml(dataFormatada)}</span>
                </div>
                <div class="admin-item-actions">
                    <button class="btn btn-sm btn-outline btn-unban" data-numero="${escapeHtml(item.numero)}" data-formatado="${escapeHtml(item.numeroFormatado)}" title="Desbanir número">
                        🔓 Desbanir
                    </button>
                </div>
            `;
            blacklistItemsContainer.appendChild(row);
        });

        document.querySelectorAll('.btn-unban').forEach(b => {
            b.addEventListener('click', (e) => {
                numeroParaDesbanir = e.currentTarget.dataset.numero;
                const formatado = e.currentTarget.dataset.formatado || numeroParaDesbanir;
                modalUnbanMessage.textContent = `Tem certeza que deseja desbanir ${formatado}? O número deixará de ser expulso imediatamente caso tente entrar nos grupos.`;
                modalUnbanConfirm.style.display = 'flex';
            });
        });
    }

    inputSearchBlacklist.addEventListener('input', (e) => {
        const termo = e.target.value.toLowerCase().trim();
        btnClearSearchBlacklist.style.display = termo ? 'block' : 'none';

        if (!termo) {
            renderizarListaBlacklist(listaBlacklistCache);
            return;
        }

        const termoLimpo = termo.replace(/\D/g, '');
        const filtrados = listaBlacklistCache.filter(item => {
            const num = String(item.numero || '');
            const motivo = String(item.motivo || '').toLowerCase();
            return (termoLimpo && num.includes(termoLimpo)) || motivo.includes(termo);
        });

        renderizarListaBlacklist(filtrados);
    });

    btnClearSearchBlacklist.addEventListener('click', () => {
        inputSearchBlacklist.value = '';
        btnClearSearchBlacklist.style.display = 'none';
        renderizarListaBlacklist(listaBlacklistCache);
    });

    // Ban Manual Flow
    btnOpenModalManualBan.addEventListener('click', () => {
        inputBanPhone.value = '';
        inputBanReason.value = '';
        modalManualBan.style.display = 'flex';
    });

    function fecharModalManualBan() {
        modalManualBan.style.display = 'none';
    }

    modalBanClose.addEventListener('click', fecharModalManualBan);
    modalBanCancel.addEventListener('click', fecharModalManualBan);

    modalBanConfirm.addEventListener('click', async () => {
        const tel = inputBanPhone.value.trim();
        const motivo = inputBanReason.value.trim();
        if (!tel) {
            showToast('Digite o número com DDD.', 'warning');
            return;
        }

        modalBanConfirm.disabled = true;
        modalBanConfirm.textContent = 'Banindo e expulsando...';

        try {
            const res = await fetch('/api/blacklist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numero: tel, motivo })
            });
            const data = await res.json();

            if (data.sucesso) {
                showToast(data.mensagem);
                fecharModalManualBan();
                await carregarBlacklist();
            } else {
                showToast(data.erro || 'Falha ao banir.', 'error');
            }
        } catch (e) {
            showToast('Erro de comunicação.', 'error');
        } finally {
            modalBanConfirm.disabled = false;
            modalBanConfirm.textContent = 'Sim, Banir Permanentemente';
        }
    });

    // Desbanir Flow
    modalUnbanCancel.addEventListener('click', () => {
        modalUnbanConfirm.style.display = 'none';
        numeroParaDesbanir = null;
    });

    modalUnbanConfirmBtn.addEventListener('click', async () => {
        if (!numeroParaDesbanir) return;
        modalUnbanConfirmBtn.disabled = true;
        modalUnbanConfirmBtn.textContent = 'Desbanindo...';

        try {
            const res = await fetch(`/api/blacklist/${encodeURIComponent(numeroParaDesbanir)}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.sucesso) {
                showToast(data.mensagem || `Número ${numeroParaDesbanir} desbanido com sucesso!`);
                modalUnbanConfirm.style.display = 'none';
                numeroParaDesbanir = null;
                await Promise.all([
                    carregarBlacklist(),
                    carregarCrocodilos()
                ]);
            } else {
                // Tenta fallback POST caso o proxy ou navegador bloqueie DELETE
                const fallbackRes = await fetch(`/api/blacklist/${encodeURIComponent(numeroParaDesbanir)}/desbanir`, { method: 'POST' });
                const fallbackData = await fallbackRes.json();
                if (fallbackData.sucesso) {
                    showToast(fallbackData.mensagem || `Número ${numeroParaDesbanir} desbanido com sucesso!`);
                    modalUnbanConfirm.style.display = 'none';
                    numeroParaDesbanir = null;
                    await Promise.all([
                        carregarBlacklist(),
                        carregarCrocodilos()
                    ]);
                } else {
                    showToast(fallbackData.erro || data.erro || 'Falha ao desbanir.', 'error');
                }
            }
        } catch (e) {
            console.error('[!] Erro ao desbanir:', e);
            showToast('Erro de comunicação ao desbanir.', 'error');
        } finally {
            modalUnbanConfirmBtn.disabled = false;
            modalUnbanConfirmBtn.textContent = 'Sim, Desbanir';
        }
    });

    // =================================================================
    // 🐊 SUBMÓDULO: CROCODILOS KELVEN (LEADS COM > 4 GRUPOS)
    // Mantém apenas o 1º grupo acessado e remove dos demais
    // =================================================================
    const crocodilosItemsContainer = document.getElementById('crocodilos-items-container');
    const inputSearchCrocodilos = document.getElementById('input-search-crocodilos');
    const btnClearSearchCrocodilos = document.getElementById('btn-clear-search-crocodilos');
    const badgeTotalCrocodilos = document.getElementById('badge-total-crocodilos');

    async function carregarCrocodilos() {
        if (!crocodilosItemsContainer) return;
        try {
            const res = await fetch('/api/crocodilos');
            const data = await res.json();
            if (data.sucesso) {
                listaCrocodilosCache = data.crocodilos || [];
                renderizarListaCrocodilos(listaCrocodilosCache);
                if (badgeTotalCrocodilos) {
                    badgeTotalCrocodilos.textContent = listaCrocodilosCache.length;
                }
            }
        } catch (e) {
            console.error('[!] Erro ao carregar Crocodilos Kelven:', e);
        }
    }

    function renderizarListaCrocodilos(lista) {
        if (!crocodilosItemsContainer) return;

        if (!lista || lista.length === 0) {
            crocodilosItemsContainer.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">🐊</span>
                    <p class="empty-title">Nenhum Crocodilo Kelven detectado</p>
                    <p class="empty-subtitle">Leads que ultrapassarem o limite de 4 grupos na mesma campanha serão mantidos apenas no 1º grupo e listados aqui.</p>
                </div>
            `;
            return;
        }

        crocodilosItemsContainer.innerHTML = '';
        lista.forEach(item => {
            const row = document.createElement('div');
            row.className = 'blacklist-item';
            row.id = `crocodilo-row-${item.numero}`;

            const dataFormatada = item.dataDeteccao
                ? new Date(item.dataDeteccao).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : 'Data não registrada';

            const campInfo = item.nomeCampanha || item.idCampanha || 'Campanha Ativa';
            const gruposRemovidosCount = Array.isArray(item.gruposRemovidos) ? item.gruposRemovidos.length : 0;
            const primeiroGrupoInfo = item.nomePrimeiroGrupo || item.primeiroGrupoId || 'Grupo Primário #1';

            row.innerHTML = `
                <div class="blacklist-item-info">
                    <div class="blacklist-num-row">
                        <span class="blacklist-num">${escapeHtml(item.numeroFormatado || '+' + item.numero)}</span>
                        <span class="badge-role" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.35);">🐊 CROCODILO KELVEN</span>
                        <span class="badge-tag-campanha" style="margin-left: 6px;">${escapeHtml(campInfo)}</span>
                    </div>
                    <span class="blacklist-reason" style="color: #38bdf8;">
                        🏠 <strong>1º Grupo Mantido:</strong> ${escapeHtml(primeiroGrupoInfo)}
                    </span>
                    <span class="blacklist-reason" style="color: #f87171; font-size: 0.8rem;">
                        🚫 <strong>${gruposRemovidosCount} grupo(s) excedente(s) removido(s)</strong> automaticamente.
                    </span>
                    <span class="blacklist-date">Detectado em: ${escapeHtml(dataFormatada)}</span>
                </div>
                <div class="admin-item-actions">
                    <button class="btn btn-sm btn-outline btn-remover-crocodilo" data-numero="${escapeHtml(item.numero)}" title="Liberar este lead da lista de Crocodilos">
                        ✨ Liberar Lead
                    </button>
                </div>
            `;
            crocodilosItemsContainer.appendChild(row);
        });

        // Eventos dos botões de liberar
        crocodilosItemsContainer.querySelectorAll('.btn-remover-crocodilo').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const num = e.currentTarget.dataset.numero;
                if (!num) return;
                const confirmar = confirm(`Deseja liberar o lead ${num} da lista de Crocodilos Kelven?`);
                if (!confirmar) return;

                try {
                    const res = await fetch(`/api/crocodilos/${encodeURIComponent(num)}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (data.sucesso) {
                        showToast(data.mensagem || `Lead ${num} liberado com sucesso!`);
                        await carregarCrocodilos();
                    } else {
                        showToast(data.erro || 'Erro ao liberar lead.', 'error');
                    }
                } catch (err) {
                    showToast('Erro de comunicação.', 'error');
                }
            });
        });
    }

    if (inputSearchCrocodilos) {
        inputSearchCrocodilos.addEventListener('input', (e) => {
            const termo = e.target.value.toLowerCase().trim();
            if (btnClearSearchCrocodilos) {
                btnClearSearchCrocodilos.style.display = termo ? 'block' : 'none';
            }

            if (!termo) {
                renderizarListaCrocodilos(listaCrocodilosCache);
                return;
            }

            const termoLimpo = termo.replace(/\D/g, '');
            const filtrados = listaCrocodilosCache.filter(item => {
                const num = String(item.numero || '');
                const camp = String(item.nomeCampanha || item.idCampanha || '').toLowerCase();
                const grupo = String(item.nomePrimeiroGrupo || '').toLowerCase();
                return (termoLimpo && num.includes(termoLimpo)) || camp.includes(termo) || grupo.includes(termo);
            });

            renderizarListaCrocodilos(filtrados);
        });
    }

    if (btnClearSearchCrocodilos) {
        btnClearSearchCrocodilos.addEventListener('click', () => {
            if (inputSearchCrocodilos) inputSearchCrocodilos.value = '';
            btnClearSearchCrocodilos.style.display = 'none';
            renderizarListaCrocodilos(listaCrocodilosCache);
        });
    }

    // =================================================================
    // ⚙️ MÓDULO 4: CONFIGURAÇÕES & LIMITES DO SISTEMA
    // =================================================================
    const formSystemConfig = document.getElementById('form-system-config');
    const cfgLimiteGrupos = document.getElementById('cfg-limite-grupos');
    const cfgLimiteBan = document.getElementById('cfg-limite-ban');
    const cfgQtdEspioes = document.getElementById('cfg-qtd-espioes');
    const btnSaveConfig = document.getElementById('btn-save-config');

    async function carregarConfiguracoes() {
        try {
            const res = await fetch('/api/config');
            const data = await res.json();
            if (data.sucesso && data.config) {
                configCache = data.config;
                cfgLimiteGrupos.value = configCache.limiteGruposPorCampanha || 4;
                cfgLimiteBan.value = configCache.limiteBanPermanente || 10;
                cfgQtdEspioes.value = configCache.quantidadeEspioes || 4;

                valMetricLimiteGrupos.textContent = `MÁX. ${configCache.limiteGruposPorCampanha}`;
                valMetricDescBan.textContent = `Gatilho: > ${configCache.limiteBanPermanente} links = Ban Total`;
            }
        } catch (e) {
            console.error('[!] Erro ao ler configurações:', e);
        }
    }

    formSystemConfig.addEventListener('submit', async (e) => {
        e.preventDefault();
        const limiteGrupos = parseInt(cfgLimiteGrupos.value);
        const limiteBan = parseInt(cfgLimiteBan.value);
        const qtdEspioes = parseInt(cfgQtdEspioes.value);

        if (isNaN(limiteGrupos) || isNaN(limiteBan) || isNaN(qtdEspioes)) {
            showToast('Preencha valores numéricos válidos.', 'warning');
            return;
        }

        btnSaveConfig.disabled = true;
        btnSaveConfig.innerHTML = '<span class="spinner"></span> Salvando alterações...';

        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    limiteGruposPorCampanha: limiteGrupos,
                    limiteBanPermanente: limiteBan,
                    quantidadeEspioes: qtdEspioes
                })
            });
            const data = await res.json();

            if (data.sucesso) {
                showToast('✅ Configurações salvas e aplicadas em tempo real!');
                await carregarConfiguracoes();
                await carregarEspioes();
            } else {
                showToast(data.erro || 'Falha ao salvar configurações.', 'error');
            }
        } catch (err) {
            showToast('Erro de comunicação com o servidor.', 'error');
        } finally {
            btnSaveConfig.disabled = false;
            btnSaveConfig.innerHTML = '<span class="btn-icon">💾</span><span class="btn-text">Salvar Alterações de Configuração</span>';
        }
    });

    // =================================================================
    // 🚨 RADAR DA CATRACA EM TEMPO REAL (TERMINAL DE FEED)
    // =================================================================
    const terminalFeedList = document.getElementById('terminal-feed-list');
    const btnToggleFeedAuto = document.getElementById('btn-toggle-feed-auto');

    btnToggleFeedAuto.addEventListener('click', () => {
        feedPausado = !feedPausado;
        if (feedPausado) {
            btnToggleFeedAuto.textContent = '⏸️ Pausado';
            btnToggleFeedAuto.style.borderColor = 'rgba(245, 158, 11, 0.4)';
            btnToggleFeedAuto.style.color = '#f59e0b';
        } else {
            btnToggleFeedAuto.textContent = '🟢 Ativo';
            btnToggleFeedAuto.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            btnToggleFeedAuto.style.color = '#10b981';
            carregarFeedEventos();
        }
    });

    async function carregarFeedEventos() {
        if (feedPausado) return;
        try {
            const res = await fetch('/api/logs');
            const data = await res.json();
            if (data.sucesso && Array.isArray(data.eventos)) {
                renderizarFeed(data.eventos);
            }
        } catch (e) { }
    }

    function renderizarFeed(eventos) {
        if (!eventos || eventos.length === 0) {
            terminalFeedList.innerHTML = '<div class="feed-empty-state">Aguardando novos eventos de entrada nos grupos...</div>';
            return;
        }

        terminalFeedList.innerHTML = '';
        eventos.forEach(ev => {
            const item = document.createElement('div');
            let corClasse = 'feed-item-info';
            let iconeTag = 'ℹ️';

            if (ev.tipo === 'EXPULSAO') {
                corClasse = 'feed-item-kick';
                iconeTag = '⛔';
            } else if (ev.tipo === 'BAN_PERMANENTE') {
                corClasse = 'feed-item-kick';
                iconeTag = '💀';
            } else if (ev.tipo === 'ALERTA') {
                corClasse = 'feed-item-alert';
                iconeTag = '🚨';
            } else if (ev.tipo === 'WHITELIST' || ev.tipo === 'ADMIN') {
                corClasse = 'feed-item-immune';
                iconeTag = '🛡️';
            } else if (ev.tipo === 'SNIPER' || ev.tipo === 'ESPIAO') {
                corClasse = 'feed-item-sniper';
                iconeTag = '🎯';
            } else if (ev.tipo === 'ENTRADA') {
                corClasse = 'feed-item-entry';
                iconeTag = '🚪';
            }

            item.className = `feed-item ${corClasse}`;
            item.innerHTML = `
                <span class="feed-time">[${escapeHtml(ev.hora || '--:--:--')}]</span>
                <span class="feed-tag">${iconeTag}</span>
                <span class="feed-msg">${escapeHtml(ev.texto)}</span>
            `;
            terminalFeedList.appendChild(item);
        });
    }

    // =================================================================
    // 🎯 MÓDULO SENDFLOW: CAMPANHAS ATIVAS & GESTÃO DE ADMS
    // =================================================================
    async function carregarCampanhasSendflow() {
        try {
            const res = await fetch('/api/sendflow/campanhas');
            const data = await res.json();
            if (data.sucesso) {
                listaCampanhasCache = data.campanhas || [];
                atualizarHeaderSendflow(data);
                renderizarCampanhas(searchCampanhaInput ? searchCampanhaInput.value : '');
            }
        } catch (err) {
            console.error('[!] Erro ao carregar campanhas Sendflow:', err);
        }
    }

    function atualizarHeaderSendflow(data) {
        if (navBadgeCampanhas) {
            navBadgeCampanhas.textContent = data.totalCampanhasAtivas || 0;
        }
        if (sendflowValTotalCampanhas) {
            sendflowValTotalCampanhas.textContent = `${data.totalCampanhasAtivas || 0} ativas`;
        }
        if (sendflowValTotalGrupos) {
            sendflowValTotalGrupos.textContent = `${data.totalGrupos || 0} grupos`;
        }
        if (sendflowValUltimaSync) {
            if (data.ultimaAtualizacao) {
                const dt = new Date(data.ultimaAtualizacao);
                sendflowValUltimaSync.textContent = dt.toLocaleString('pt-BR');
            } else {
                sendflowValUltimaSync.textContent = 'Não sincronizado';
            }
        }
        if (sendflowValProximaSync) {
            if (data.proximaAtualizacaoPrevista) {
                const dtP = new Date(data.proximaAtualizacaoPrevista);
                sendflowValProximaSync.textContent = `Em ${dtP.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
            } else {
                sendflowValProximaSync.textContent = 'A cada 12 horas';
            }
        }

        if (syncStatusMsg && data.status) {
            if (data.status.status === 'rate_limited') {
                syncStatusMsg.style.display = 'flex';
                syncStatusMsg.className = 'sync-status-alert alert-warning';
                syncStatusMsg.innerHTML = `<span>⏳</span><span>${escapeHtml(data.status.mensagem || 'SendFlow com limite temporário de requisições. Cache local seguro ativo.')}</span>`;
            } else if (data.status.status === 'erro') {
                syncStatusMsg.style.display = 'flex';
                syncStatusMsg.className = 'sync-status-alert alert-error';
                syncStatusMsg.innerHTML = `<span>⚠️</span><span>${escapeHtml(data.status.mensagem || 'Falha ao sincronizar com SendFlow.')}</span>`;
            } else {
                syncStatusMsg.style.display = 'none';
            }
        }
    }

    function renderizarCampanhas(filtro = '') {
        if (!containerCampanhasLista) return;

        const termo = (filtro || '').trim().toLowerCase();
        const filtradas = listaCampanhasCache.filter(c => {
            if (!termo) return true;
            return (c.name && c.name.toLowerCase().includes(termo)) ||
                   (c.id && c.id.toLowerCase().includes(termo));
        });

        if (filtradas.length === 0) {
            containerCampanhasLista.innerHTML = `
                <div class="campanhas-empty-state">
                    <span>🔍</span>
                    <span>Nenhuma campanha ativa encontrada ${termo ? `para o termo "${escapeHtml(termo)}"` : ''}.</span>
                </div>
            `;
            return;
        }

        containerCampanhasLista.innerHTML = '';

        filtradas.forEach(camp => {
            const card = document.createElement('div');
            card.className = 'campanha-card brabo-card';
            card.dataset.releaseId = camp.id;

            const admsList = Array.isArray(camp.adms) ? camp.adms : [];
            const gruposList = Array.isArray(camp.grupos) ? camp.grupos : [];

            let admsHtml = '';
            if (admsList.length > 0) {
                admsHtml = admsList.map(adm => `
                    <div class="adm-card-item">
                        <div class="adm-card-avatar">👑</div>
                        <div class="adm-card-info">
                            <span class="adm-card-nome">${escapeHtml(adm.nome || 'Administrador')}</span>
                            <span class="adm-card-num">${escapeHtml(adm.numeroFormatado || adm.numero)}</span>
                            <span class="adm-card-tag-imune">🛡️ IMUNE NESTA CAMPANHA</span>
                        </div>
                        <button type="button" class="btn-remove-adm-card" data-release-id="${camp.id}" data-numero="${adm.numero}" title="Remover ADM desta campanha">
                            🗑️
                        </button>
                    </div>
                `).join('');
            } else {
                admsHtml = `
                    <div class="adms-empty-box">
                        <span class="empty-icon-sm">👤</span>
                        <div class="empty-text-wrap">
                            <span class="empty-title-sm">Nenhum ADM exclusivo cadastrado ainda</span>
                            <span class="empty-sub-sm">Cadastre os números abaixo para ficarem de olho exclusivamente nesta campanha.</span>
                        </div>
                    </div>
                `;
            }

            let gruposChipsHtml = '';
            if (gruposList.length > 0) {
                gruposChipsHtml = gruposList.map(g => {
                    const idExib = g.gid ? g.gid.split('@')[0] : (g.id || 'sem-id');
                    return `
                        <div class="grupo-chip-card">
                            <div class="grupo-chip-header">
                                <span class="grupo-chip-title" title="${escapeHtml(g.name || 'Grupo sem nome')}">📁 ${escapeHtml(g.name || 'Grupo sem nome')}</span>
                                <button type="button" class="btn-remove-group" data-release-id="${camp.id}" data-gid="${escapeHtml(g.gid || g.id)}" title="Remover grupo do monitoramento">✕</button>
                            </div>
                            <div class="grupo-chip-meta">
                                <span class="meta-gid">ID: ${escapeHtml(idExib)}</span>
                                <span class="meta-leads">👥 ${g.participantsAmount || 0} leads</span>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                gruposChipsHtml = `
                    <div class="grupos-empty-hint">
                        <span>ℹ️ Nenhum grupo cadastrado ou retornado ainda. Use os botões acima para buscar no SendFlow ou cadastrar manualmente.</span>
                    </div>
                `;
            }

            card.innerHTML = `
                <!-- TOPO DO CARD DA CAMPANHA -->
                <div class="campanha-header-brabo">
                    <div class="campanha-title-col">
                        <div class="campanha-tag-bar">
                            <span class="badge-tag badge-active-sendflow">
                                <span class="pulsing-dot" style="width: 7px; height: 7px;"></span> ATIVA NO SENDFLOW
                            </span>
                            <span class="campanha-id-pill" title="Clique para copiar ID">
                                🔑 ${escapeHtml(camp.id)}
                            </span>
                        </div>
                        <h3 class="campanha-title-main">
                            🎯 ${escapeHtml(camp.name)}
                        </h3>
                    </div>
                    <div class="campanha-counters-col">
                        <div class="counter-badge counter-adms">
                            <span class="counter-num">${admsList.length}</span>
                            <span class="counter-lbl">ADMs</span>
                        </div>
                        <div class="counter-badge counter-grupos">
                            <span class="counter-num">${gruposList.length || camp.totalGrupos || 0}</span>
                            <span class="counter-lbl">Grupos</span>
                        </div>
                    </div>
                </div>

                <!-- SEÇÃO 1: GESTÃO DE ADMINISTRADORES (FOCO PRINCIPAL) -->
                <div class="campanha-adms-section">
                    <div class="section-title-row">
                        <div class="title-with-badge">
                            <span class="section-icon">👑</span>
                            <h4 class="section-title">ADMINISTRADORES DEDICADOS A ESTA CAMPANHA</h4>
                            <span class="count-pill">${admsList.length}</span>
                        </div>
                        <button type="button" class="btn-import-clean btn-import-adms" data-release-id="${camp.id}" title="Importar administradores já cadastrados no SendFlow para esta campanha">
                            📥 Importar do SendFlow
                        </button>
                    </div>
                    <p class="section-description">
                        Estes números possuem <strong>imunidade absoluta</strong> aos filtros da catraca nesta campanha e atuam na moderação dos grupos.
                    </p>

                    <!-- GRID DE ADMS CADASTRADOS -->
                    <div class="adms-grid-container" id="adms-grid-${camp.id}">
                        ${admsHtml}
                    </div>

                    <!-- FORMULÁRIO DE CADASTRO RÁPIDO DE ADM -->
                    <form class="add-adm-inline-form" data-release-id="${camp.id}">
                        <div class="form-row-fields">
                            <input 
                                type="text" 
                                class="form-input adm-nome-input" 
                                placeholder="Nome / Identificação do ADM (ex: Suporte BV)" 
                                required
                            >
                            <input 
                                type="tel" 
                                class="form-input adm-tel-input" 
                                placeholder="WhatsApp com DDD (ex: 11999998888)" 
                                required
                            >
                            <button type="submit" class="btn btn-primary btn-add-adm">
                                <span>➕</span> Salvar ADM
                            </button>
                        </div>
                    </form>
                </div>

                <!-- SEÇÃO 2: GRUPOS MONITORADOS DA CAMPANHA -->
                <div class="campanha-grupos-section">
                    <div class="section-title-row">
                        <div class="title-with-badge">
                            <span class="section-icon">📁</span>
                            <h4 class="section-title">GRUPOS MONITORADOS NO RADAR</h4>
                            <span class="count-pill">${gruposList.length || camp.totalGrupos || 0}</span>
                        </div>
                        <div class="grupos-action-btns">
                            <button type="button" class="btn-action-outline btn-sync-single-group" data-release-id="${camp.id}" title="Consultar grupos desta campanha na API do SendFlow com segurança">
                                🔄 Buscar no SendFlow
                            </button>
                            <button type="button" class="btn-action-outline btn-toggle-add-group" data-release-id="${camp.id}" title="Adicionar grupo manualmente por ID ou nome">
                                ➕ Grupo Manual
                            </button>
                        </div>
                    </div>

                    <!-- FORMULÁRIO OCULTO PARA ADICIONAR GRUPO MANUALMENTE -->
                    <form class="form-add-manual-group" id="form-group-manual-${camp.id}" data-release-id="${camp.id}" style="display: none;">
                        <input 
                            type="text" 
                            class="form-input group-name-input" 
                            placeholder="Nome do grupo (ex: Desconto Black #12)" 
                            required
                        >
                        <input 
                            type="text" 
                            class="form-input group-gid-input" 
                            placeholder="ID do grupo (ex: 120363xxx@g.us) ou Link"
                        >
                        <button type="submit" class="btn btn-secondary btn-sm-action">
                            Vincular Grupo
                        </button>
                    </form>

                    <!-- ACCORDION / LISTA DE GRUPOS -->
                    <div class="grupos-chips-grid">
                        ${gruposChipsHtml}
                    </div>
                </div>
            `;

            containerCampanhasLista.appendChild(card);
        });

        vincularEventosCardsCampanhas();
    }

    function vincularEventosCardsCampanhas() {
        // 1. Cadastrar ADM na campanha
        document.querySelectorAll('.add-adm-inline-form').forEach(form => {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const releaseId = form.dataset.releaseId;
                const nomeInput = form.querySelector('.adm-nome-input');
                const telInput = form.querySelector('.adm-tel-input');
                const submitBtn = form.querySelector('button[type="submit"]');
                const nome = nomeInput.value.trim();
                const numero = telInput.value.trim();

                if (!numero) {
                    showToast('Digite o número de WhatsApp do ADM.', 'warning');
                    return;
                }

                try {
                    submitBtn.disabled = true;
                    showToast('Cadastrando ADM na campanha...');
                    const res = await fetch(`/api/sendflow/campanhas/${releaseId}/adms`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nome, numero })
                    });
                    const data = await res.json();
                    if (data.sucesso) {
                        showToast(data.mensagem || 'ADM adicionado com sucesso!');
                        nomeInput.value = '';
                        telInput.value = '';
                        await carregarCampanhasSendflow();
                    } else {
                        showToast(data.erro || 'Erro ao adicionar ADM.', 'error');
                    }
                } catch (err) {
                    showToast('Falha na comunicação com o servidor.', 'error');
                } finally {
                    submitBtn.disabled = false;
                }
            };
        });

        // 2. Remover ADM da campanha
        document.querySelectorAll('.btn-remove-adm-card').forEach(btn => {
            btn.onclick = async () => {
                const releaseId = btn.dataset.releaseId;
                const numero = btn.dataset.numero;
                if (!confirm(`Deseja remover este ADM desta campanha?`)) return;

                try {
                    showToast('Removendo ADM...');
                    const res = await fetch(`/api/sendflow/campanhas/${releaseId}/adms/${encodeURIComponent(numero)}`, {
                        method: 'DELETE'
                    });
                    const data = await res.json();
                    if (data.sucesso) {
                        showToast(data.mensagem || 'ADM removido com sucesso!');
                        await carregarCampanhasSendflow();
                    } else {
                        showToast(data.erro || 'Falha ao remover ADM.', 'error');
                    }
                } catch (err) {
                    showToast('Erro ao remover ADM da campanha.', 'error');
                }
            };
        });

        // 3. Importar administradores do SendFlow para a campanha
        document.querySelectorAll('.btn-import-adms').forEach(btn => {
            btn.onclick = async () => {
                const releaseId = btn.dataset.releaseId;
                try {
                    btn.disabled = true;
                    showToast('Importando administradores do SendFlow...');
                    const res = await fetch(`/api/sendflow/campanhas/${releaseId}/importar-adms`, {
                        method: 'POST'
                    });
                    const data = await res.json();
                    if (data.sucesso) {
                        showToast(data.mensagem || 'Admins importados com sucesso!');
                        await carregarCampanhasSendflow();
                    } else {
                        showToast(data.erro || 'Nenhum admin importado.', 'warning');
                    }
                } catch (err) {
                    showToast('Erro ao importar admins do SendFlow.', 'error');
                } finally {
                    btn.disabled = false;
                }
            };
        });

        // 4. Buscar Grupos exclusivamente para ESTA campanha no SendFlow (seguro, sem rate limit)
        document.querySelectorAll('.btn-sync-single-group').forEach(btn => {
            btn.onclick = async () => {
                const releaseId = btn.dataset.releaseId;
                const textoOriginal = btn.innerHTML;
                try {
                    btn.disabled = true;
                    btn.innerHTML = '⏳ Buscando...';
                    showToast('Consultando grupos desta campanha no SendFlow...');
                    const res = await fetch(`/api/sendflow/campanhas/${releaseId}/sincronizar-grupos`, {
                        method: 'POST'
                    });
                    const data = await res.json();
                    if (data.sucesso) {
                        showToast(data.mensagem || 'Grupos atualizados com sucesso!');
                        await carregarCampanhasSendflow();
                    } else if (data.rateLimited) {
                        showToast(data.mensagem || 'SendFlow com limite momentâneo. Aguarde um minuto.', 'warning');
                    } else {
                        showToast(data.mensagem || data.erro || 'Falha ao obter grupos.', 'error');
                    }
                } catch (err) {
                    showToast('Erro ao sincronizar grupos desta campanha.', 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = textoOriginal;
                }
            };
        });

        // 5. Alternar formulário para adicionar grupo manual
        document.querySelectorAll('.btn-toggle-add-group').forEach(btn => {
            btn.onclick = () => {
                const releaseId = btn.dataset.releaseId;
                const form = document.getElementById(`form-group-manual-${releaseId}`);
                if (!form) return;
                const estaVisivel = form.style.display !== 'none';
                form.style.display = estaVisivel ? 'none' : 'flex';
                if (!estaVisivel) {
                    const inp = form.querySelector('.group-name-input');
                    if (inp) inp.focus();
                }
            };
        });

        // 6. Cadastrar grupo manual na campanha
        document.querySelectorAll('.form-add-manual-group').forEach(form => {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const releaseId = form.dataset.releaseId;
                const nameInput = form.querySelector('.group-name-input');
                const gidInput = form.querySelector('.group-gid-input');
                const name = nameInput.value.trim();
                const gid = gidInput.value.trim();

                try {
                    showToast('Cadastrando grupo na campanha...');
                    const res = await fetch(`/api/sendflow/campanhas/${releaseId}/grupos`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, gid })
                    });
                    const data = await res.json();
                    if (data.sucesso) {
                        showToast(data.mensagem || 'Grupo cadastrado com sucesso!');
                        nameInput.value = '';
                        gidInput.value = '';
                        form.style.display = 'none';
                        await carregarCampanhasSendflow();
                    } else {
                        showToast(data.erro || 'Erro ao cadastrar grupo.', 'error');
                    }
                } catch (err) {
                    showToast('Falha na comunicação com o servidor.', 'error');
                }
            };
        });

        // 7. Remover grupo da campanha
        document.querySelectorAll('.btn-remove-group').forEach(btn => {
            btn.onclick = async () => {
                const releaseId = btn.dataset.releaseId;
                const gid = btn.dataset.gid;
                if (!confirm('Deseja remover este grupo do monitoramento desta campanha?')) return;

                try {
                    showToast('Removendo grupo...');
                    const res = await fetch(`/api/sendflow/campanhas/${releaseId}/grupos/${encodeURIComponent(gid)}`, {
                        method: 'DELETE'
                    });
                    const data = await res.json();
                    if (data.sucesso) {
                        showToast(data.mensagem || 'Grupo removido com sucesso!');
                        await carregarCampanhasSendflow();
                    } else {
                        showToast(data.erro || 'Falha ao remover grupo.', 'error');
                    }
                } catch (err) {
                    showToast('Erro ao remover grupo.', 'error');
                }
            };
        });
    }

    if (btnSyncSendflow) {
        btnSyncSendflow.addEventListener('click', async () => {
            if (btnSyncSendflow.disabled) return;
            btnSyncSendflow.disabled = true;
            if (syncIcon) syncIcon.classList.add('rotating');
            if (syncText) syncText.textContent = 'Sincronizando SendFlow...';
            showToast('Consultando API do SendFlow para atualizar campanhas e grupos...', 'warning');

            try {
                const res = await fetch('/api/sendflow/sincronizar', { method: 'POST' });
                const data = await res.json();
                if (data.sucesso) {
                    showToast(data.mensagem || 'Campanhas e grupos sincronizados com sucesso!');
                } else if (data.rateLimited) {
                    showToast(data.mensagem || 'SendFlow com limite momentâneo. Cache seguro mantido.', 'warning');
                } else {
                    showToast(data.mensagem || data.erro || 'Erro na sincronização.', 'error');
                }
                await carregarCampanhasSendflow();
            } catch (err) {
                showToast('Erro ao comunicar com a API do SendFlow.', 'error');
            } finally {
                btnSyncSendflow.disabled = false;
                if (syncIcon) syncIcon.classList.remove('rotating');
                if (syncText) syncText.textContent = 'Sincronizar SendFlow Agora';
            }
        });
    }

    if (searchCampanhaInput) {
        searchCampanhaInput.addEventListener('input', (e) => {
            renderizarCampanhas(e.target.value);
        });
    }

    // Alternador de layout dos cards de campanhas (Lado a lado, 2 colunas, 3 colunas, 1 coluna)
    const layoutToggles = document.querySelectorAll('#campanhas-layout-toggles .btn-layout-toggle');
    if (layoutToggles.length > 0 && containerCampanhasLista) {
        layoutToggles.forEach(btn => {
            btn.addEventListener('click', () => {
                layoutToggles.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const cols = btn.dataset.cols;
                containerCampanhasLista.classList.remove('grid-cols-1', 'grid-cols-2', 'grid-cols-3');
                if (cols === '1') containerCampanhasLista.classList.add('grid-cols-1');
                else if (cols === '2') containerCampanhasLista.classList.add('grid-cols-2');
                else if (cols === '3') containerCampanhasLista.classList.add('grid-cols-3');
                localStorage.setItem('aegis_campanhas_layout', cols);
            });
        });

        const layoutSalvo = localStorage.getItem('aegis_campanhas_layout') || 'auto';
        const btnSalvo = document.querySelector(`#campanhas-layout-toggles .btn-layout-toggle[data-cols="${layoutSalvo}"]`);
        if (btnSalvo) btnSalvo.click();
    }

    // =================================================================
    // 📊 STATUS GERAL DO SERVIDOR E TELEMETRIA
    // =================================================================
    async function carregarStatusGeral() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            if (data.sucesso) {
                if (data.servidor) {
                    valUptime.textContent = data.servidor.uptimeFormatado || '0s';
                    valMemory.textContent = `RAM: ${data.servidor.memoriaMB || 0} MB`;
                    serverStatusText.textContent = data.servidor.online ? 'SISTEMA ATIVO' : 'OFFLINE';
                }
                if (data.aegis) {
                    if (data.aegis.config) {
                        configCache = data.aegis.config;
                        valMetricLimiteGrupos.textContent = `MÁX. ${configCache.limiteGruposPorCampanha}`;
                        valMetricDescBan.textContent = `Gatilho: > ${configCache.limiteBanPermanente} links = Ban Total`;
                    }
                    if (data.aegis.totalWhitelist !== undefined) {
                        atualizarContadoresWhitelist(data.aegis.totalWhitelist);
                    }
                    if (data.aegis.totalBlacklist !== undefined) {
                        atualizarContadoresBlacklist(data.aegis.totalBlacklist);
                    }
                    if (Array.isArray(data.aegis.snipers)) {
                        listaEspioesCache = data.aegis.snipers;
                        const conectados = listaEspioesCache.filter(x => x.conectado).length;
                        atualizarMetricasEspioes(conectados, listaEspioesCache.length, listaEspioesCache);
                    }
                    if (data.aegis.sendflow) {
                        atualizarHeaderSendflow(data.aegis.sendflow);
                    }
                }
            }
        } catch (e) {
            serverStatusText.textContent = 'SEM RESPOSTA';
        }
    }

    // Upload / Restauração de Sessões ZIP
    const inputUploadSessoes = document.getElementById('input-upload-sessoes');
    if (inputUploadSessoes) {
        inputUploadSessoes.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            showToast(`Enviando arquivo "${file.name}" para restauração...`, 'warning');

            try {
                const res = await fetch('/api/restore/sessoes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/zip' },
                    body: file
                });
                const data = await res.json();
                if (data.sucesso) {
                    showToast(data.mensagem);
                    setTimeout(() => {
                        carregarStatusGeral();
                        carregarCampanhasSendflow();
                        carregarEspioes();
                        carregarWhitelist();
                        carregarBlacklist();
                    }, 2500);
                } else {
                    showToast(data.erro || 'Falha ao restaurar sessões.', 'error');
                }
            } catch (err) {
                showToast('Erro no envio do arquivo ZIP.', 'error');
            } finally {
                inputUploadSessoes.value = '';
            }
        });
    }

    btnRefreshAll.addEventListener('click', async () => {
        showToast('Atualizando dados do sistema...');
        btnRefreshAll.classList.add('rotating');
        await Promise.all([
            carregarStatusGeral(),
            carregarCampanhasSendflow(),
            carregarWhitelist(),
            carregarEspioes(),
            carregarBlacklist(),
            carregarCrocodilos(),
            carregarConfiguracoes(),
            carregarFeedEventos()
        ]);
        setTimeout(() => btnRefreshAll.classList.remove('rotating'), 600);
    });

    // =================================================================
    // 🚀 BOOTSTRAP INICIAL & POLLING PERIÓDICO
    // =================================================================
    carregarStatusGeral();
    carregarCampanhasSendflow();
    carregarWhitelist();
    carregarEspioes();
    carregarBlacklist();
    carregarCrocodilos();
    carregarConfiguracoes();
    carregarFeedEventos();

    // Polling contínuo
    pollingInterval = setInterval(() => {
        carregarStatusGeral();
        carregarFeedEventos();
    }, 3500);
});
