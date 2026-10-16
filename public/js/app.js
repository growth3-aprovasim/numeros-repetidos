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
    let listaEspioesCache = [];
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
            if (targetView === 'espioes') carregarEspioes();
            if (targetView === 'blacklist') carregarBlacklist();
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
    const espioesCardsContainer = document.getElementById('espioes-cards-container');
    const inputQtdEspioesQuick = document.getElementById('input-quantidade-espioes-quick');
    const btnQtyMinus = document.getElementById('btn-qty-minus');
    const btnQtyPlus = document.getElementById('btn-qty-plus');
    const btnSaveQtyQuick = document.getElementById('btn-save-qty-quick');
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

    aplicarMascaraTelefone(inputCodePhone);

    btnQtyMinus.addEventListener('click', () => {
        let v = parseInt(inputQtdEspioesQuick.value) || 4;
        if (v > 1) inputQtdEspioesQuick.value = v - 1;
    });

    btnQtyPlus.addEventListener('click', () => {
        let v = parseInt(inputQtdEspioesQuick.value) || 4;
        if (v < 20) inputQtdEspioesQuick.value = v + 1;
    });

    btnSaveQtyQuick.addEventListener('click', async () => {
        const novaQtd = parseInt(inputQtdEspioesQuick.value) || 4;
        btnSaveQtyQuick.disabled = true;
        btnSaveQtyQuick.textContent = 'Salvando...';
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quantidadeEspioes: novaQtd })
            });
            const data = await res.json();
            if (data.sucesso) {
                showToast(`Quantidade de ADMs definida para ${novaQtd}!`);
                await carregarEspioes();
                await carregarConfiguracoes();
            } else {
                showToast(data.erro || 'Erro ao alterar quantidade.', 'error');
            }
        } catch (e) {
            showToast('Erro de comunicação.', 'error');
        } finally {
            btnSaveQtyQuick.disabled = false;
            btnSaveQtyQuick.textContent = '💾 Aplicar';
        }
    });

    btnForceConnectAll.addEventListener('click', async () => {
        btnForceConnectAll.disabled = true;
        btnForceConnectAll.innerHTML = '<span class="spinner"></span> Conectando...';
        try {
            const res = await fetch('/api/snipers/conectar', { method: 'POST' });
            const data = await res.json();
            if (data.sucesso) {
                showToast('Comando de conexão enviado a todas as contas de ADM!');
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
            const res = await fetch('/api/adms');
            const data = await res.json();
            if (data.sucesso) {
                listaEspioesCache = data.adms || data.espioes || [];
                renderizarCardsEspioes(listaEspioesCache);
                atualizarMetricasEspioes(data.conectados, data.total, listaEspioesCache);

                // Se modal QR ou Código estiver aberto, atualiza estado do ADM ativo
                if (modalQrAtivo && indiceEspiaoParaAcao) {
                    const espAtivo = listaEspioesCache.find(x => x.indice === indiceEspiaoParaAcao);
                    if (espAtivo) atualizarEstadoModalQr(espAtivo);
                }
                if (modalCodigoAtivo && indiceEspiaoParaAcao) {
                    const espAtivo = listaEspioesCache.find(x => x.indice === indiceEspiaoParaAcao);
                    if (espAtivo) atualizarEstadoModalCodigo(espAtivo);
                }
            } else {
                espioesCardsContainer.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <span class="empty-icon">⚠️</span>
                        <p class="empty-title">Erro ao carregar lista de ADMs</p>
                        <p class="empty-subtitle">${escapeHtml(data.erro || 'Falha na resposta do servidor.')}</p>
                    </div>
                `;
            }
        } catch (err) {
            console.error('[!] Erro ao carregar ADMs:', err);
            espioesCardsContainer.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <span class="empty-icon">⚠️</span>
                    <p class="empty-title">Servidor não respondeu</p>
                    <p class="empty-subtitle">Verifique se o backend está em execução na porta 3000.</p>
                </div>
            `;
        }
    }

    function atualizarMetricasEspioes(conectados, total, lista) {
        valEspioesStatus.textContent = `${conectados} / ${total}`;
        navBadgeEspioes.textContent = `${conectados}/${total}`;
        inputQtdEspioesQuick.value = total;

        // Renderiza dots de telemetria
        espioesIndicatorsRow.innerHTML = '';
        lista.forEach(e => {
            const dot = document.createElement('span');
            dot.className = `sniper-dot ${e.conectado ? 'active' : ''}`;
            dot.textContent = e.indice < 10 ? `0${e.indice}` : `${e.indice}`;
            dot.title = `ADM 0${e.indice}: ${e.conectado ? 'Conectado' : 'Desconectado'}`;
            espioesIndicatorsRow.appendChild(dot);
        });
    }

    function renderizarCardsEspioes(espioes) {
        if (!espioes || espioes.length === 0) {
            espioesCardsContainer.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <span class="empty-icon">🛡️</span>
                    <p class="empty-title">Nenhuma conta de ADM configurada</p>
                    <p class="empty-subtitle">Ajuste a quantidade acima para adicionar instâncias de ADMs.</p>
                </div>
            `;
            return;
        }

        espioesCardsContainer.innerHTML = '';
        espioes.forEach(esp => {
            const card = document.createElement('div');
            const ehConectado = esp.conectado;
            const statusClass = ehConectado ? 'connected' : (esp.status === 'qr_pronto' || esp.status === 'codigo_pronto' ? 'waiting' : 'disconnected');
            card.className = `espiao-card ${statusClass}`;
            card.id = `espiao-card-${esp.indice}`;

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
                    <button class="btn-espiao-disconnect" data-indice="${esp.indice}" title="Desconectar esta conta de ADM">
                        🔌 Desconectar ADM
                    </button>
                `
                : `
                    <div class="espiao-action-btn-group">
                        <button class="btn-espiao-connect btn-open-qr" data-indice="${esp.indice}">
                            <span>📷</span> Ler QR Code
                        </button>
                        <button class="btn-espiao-connect btn-open-code" data-indice="${esp.indice}">
                            <span>🔢</span> Via Código
                        </button>
                    </div>
                `;

            card.innerHTML = `
                <div class="espiao-card-header">
                    <span class="espiao-tag-title">
                        <span>🛡️</span> ADM #${esp.indice < 10 ? '0' + esp.indice : esp.indice}
                    </span>
                    <span class="status-pill-espiao ${statusClass}">${statusPillTexto}</span>
                </div>
                <div class="espiao-card-body">
                    ${phoneDisplayHtml}
                    ${actionsHtml}
                </div>
            `;
            espioesCardsContainer.appendChild(card);
        });

        // Eventos dos cards de espiões
        document.querySelectorAll('.btn-open-qr').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = Number(e.currentTarget.dataset.indice);
                abrirModalQr(idx);
            });
        });

        document.querySelectorAll('.btn-open-code').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = Number(e.currentTarget.dataset.indice);
                abrirModalCodigo(idx);
            });
        });

        document.querySelectorAll('.btn-espiao-disconnect').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = Number(e.currentTarget.dataset.indice);
                abrirModalConfirmDisconnect(idx);
            });
        });
    }

    // Modal QR Code Flow
    async function abrirModalQr(indice) {
        indiceEspiaoParaAcao = indice;
        modalQrAtivo = true;
        modalQrTitle.textContent = `Conectar ADM #0${indice} via QR Code`;
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
            modalQrImgWrap.innerHTML = `<img src="${esp.qrCodeDataUrl}" alt="QR Code WhatsApp" class="qr-image" />`;
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
    function abrirModalCodigo(indice) {
        indiceEspiaoParaAcao = indice;
        modalCodigoAtivo = true;
        modalCodeTitle.textContent = `Conectar ADM #0${indice} via Código`;
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
            const res = await fetch(`/api/blacklist/${numeroParaDesbanir}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.sucesso) {
                showToast(data.mensagem);
                modalUnbanConfirm.style.display = 'none';
                numeroParaDesbanir = null;
                await carregarBlacklist();
            } else {
                showToast(data.erro || 'Falha ao desbanir.', 'error');
            }
        } catch (e) {
            showToast('Erro de comunicação.', 'error');
        } finally {
            modalUnbanConfirmBtn.disabled = false;
            modalUnbanConfirmBtn.textContent = 'Sim, Desbanir';
        }
    });

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
            carregarWhitelist(),
            carregarEspioes(),
            carregarBlacklist(),
            carregarConfiguracoes(),
            carregarFeedEventos()
        ]);
        setTimeout(() => btnRefreshAll.classList.remove('rotating'), 600);
    });

    // =================================================================
    // 🚀 BOOTSTRAP INICIAL & POLLING PERIÓDICO
    // =================================================================
    carregarStatusGeral();
    carregarWhitelist();
    carregarEspioes();
    carregarBlacklist();
    carregarConfiguracoes();
    carregarFeedEventos();

    // Polling contínuo
    pollingInterval = setInterval(() => {
        carregarStatusGeral();
        carregarFeedEventos();
    }, 3500);
});
