// =====================================================================
// 🛡️ AEGIS C2 FRONTEND CLIENT LOGIC
// Gestão em Tempo Real da Whitelist e Telemetria da Catraca
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
    // ESTADO DA APLICAÇÃO
    let listaAdminsCache = [];
    let numeroParaExcluir = null;
    let feedPausado = false;
    let pollingInterval = null;

    // ELEMENTOS DO DOM
    const valTotalAdmins = document.getElementById('val-total-admins');
    const badgeTotalAdmins = document.getElementById('badge-total-admins');
    const valSnipersStatus = document.getElementById('val-snipers-status');
    const valUptime = document.getElementById('val-uptime');
    const valMemory = document.getElementById('val-memory');
    const serverStatusText = document.getElementById('server-status-text');

    const sniperDots = {
        1: document.getElementById('dot-sniper-1'),
        2: document.getElementById('dot-sniper-2'),
        3: document.getElementById('dot-sniper-3'),
        4: document.getElementById('dot-sniper-4'),
    };

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
    const btnRefreshAll = document.getElementById('btn-refresh-all');

    const terminalFeedList = document.getElementById('terminal-feed-list');
    const btnToggleFeedAuto = document.getElementById('btn-toggle-feed-auto');

    const modalDeleteAdmin = document.getElementById('modal-delete-admin');
    const modalDeleteMessage = document.getElementById('modal-delete-message');
    const modalBtnCancel = document.getElementById('modal-btn-cancel');
    const modalBtnConfirmDelete = document.getElementById('modal-btn-confirm-delete');

    const toastContainer = document.getElementById('toast-container');

    // =================================================================
    // 🔔 SISTEMA DE TOASTS
    // =================================================================
    function showToast(mensagem, tipo = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${tipo}`;
        
        let icone = '✅';
        if (tipo === 'error') icone = '❌';
        if (tipo === 'warning') icone = '⚠️';

        toast.innerHTML = `<span>${icone}</span><span>${mensagem}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 3800);
    }

    // =================================================================
    // 🔀 NAVEGAÇÃO POR ABAS
    // =================================================================
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const content = document.getElementById(`tab-content-${target}`);
            if (content) content.classList.add('active');
        });
    });

    // =================================================================
    // 📱 FORMATAÇÃO E MÁSCARA INTELIGENTE DE TELEFONE
    // =================================================================
    inputTelefone.addEventListener('input', (e) => {
        let valor = e.target.value.replace(/\D/g, '');
        
        // Se usuário digitou mais de 13 dígitos, corta
        if (valor.length > 13) valor = valor.substring(0, 13);

        // Se começa com 55 e tem mais de 4 dígitos: formata internacional BR
        if (valor.startsWith('55')) {
            if (valor.length <= 4) {
                e.target.value = `+${valor}`;
            } else if (valor.length <= 9) {
                e.target.value = `+55 (${valor.substring(2, 4)}) ${valor.substring(4)}`;
            } else {
                e.target.value = `+55 (${valor.substring(2, 4)}) ${valor.substring(4, 9)}-${valor.substring(9)}`;
            }
        } else {
            // Formato nacional (11) 99999-9999
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

    // =================================================================
    // ⚡ CONTADOR EM TEMPO REAL PARA LISTA EM MASSA
    // =================================================================
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

    // =================================================================
    // 👑 REQUISIÇÕES: CARREGAR WHITELIST
    // =================================================================
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
            console.error('Falha ao carregar Whitelist:', err);
            adminsListContainer.innerHTML = `
                <div class="empty-state">
                    <span>❌ Erro ao conectar com o servidor. Verifique se o serviço está online.</span>
                </div>
            `;
        }
    }

    function atualizarContadoresWhitelist(total) {
        valTotalAdmins.textContent = total;
        badgeTotalAdmins.textContent = total;
    }

    // =================================================================
    // 🎨 RENDERIZAÇÃO DA LISTA DE ADMINISTRADORES
    // =================================================================
    function renderizarListaAdmins(lista) {
        const busca = inputSearchAdmins.value.trim().toLowerCase();
        let filtrados = lista;

        if (busca) {
            filtrados = lista.filter(item => {
                const num = item.numero.toLowerCase();
                const numFormat = (item.numeroFormatado || '').toLowerCase();
                const nome = (item.nome || '').toLowerCase();
                return num.includes(busca) || numFormat.includes(busca) || nome.includes(busca);
            });
        }

        if (filtrados.length === 0) {
            adminsListContainer.innerHTML = `
                <div class="empty-state">
                    <span>${busca ? 'Nenhum administrador encontrado para esta busca.' : 'Nenhum administrador cadastrado na Whitelist ainda.'}</span>
                </div>
            `;
            return;
        }

        let html = '';
        filtrados.forEach(item => {
            const dataStr = item.adicionadoEm 
                ? new Date(item.adicionadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                : '';

            html += `
                <div class="admin-row" id="admin-row-${item.numero}">
                    <div class="admin-info-wrap">
                        <div class="admin-avatar">👑</div>
                        <div class="admin-text-details">
                            <div class="admin-number-line">
                                <span class="admin-phone-formatted">${item.numeroFormatado}</span>
                            </div>
                            <span class="admin-label-tag">
                                ${escapeHtml(item.nome || 'Administrador')}
                                ${dataStr ? ` &bull; Adicionado em ${dataStr}` : ''}
                            </span>
                        </div>
                    </div>
                    <div class="admin-actions">
                        <a href="https://wa.me/${item.numero}" target="_blank" rel="noopener" class="btn-icon-action" title="Abrir conversa no WhatsApp">
                            💬
                        </a>
                        <button class="btn-icon-action delete btn-delete-admin" data-numero="${item.numero}" data-nome="${escapeHtml(item.nome || item.numeroFormatado)}" title="Remover da Whitelist">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        });

        adminsListContainer.innerHTML = html;

        // Atrela eventos de exclusão
        document.querySelectorAll('.btn-delete-admin').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const num = btn.dataset.numero;
                const nome = btn.dataset.nome;
                abrirModalExclusao(num, nome);
            });
        });
    }

    // =================================================================
    // 🔍 BUSCA E FILTRAGEM
    // =================================================================
    inputSearchAdmins.addEventListener('input', () => {
        const val = inputSearchAdmins.value;
        btnClearSearch.style.display = val ? 'block' : 'none';
        renderizarListaAdmins(listaAdminsCache);
    });

    btnClearSearch.addEventListener('click', () => {
        inputSearchAdmins.value = '';
        btnClearSearch.style.display = 'none';
        renderizarListaAdmins(listaAdminsCache);
        inputSearchAdmins.focus();
    });

    // =================================================================
    // ➕ SUBMIT: CADASTRO INDIVIDUAL
    // =================================================================
    formAddAdmin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const numero = inputTelefone.value.trim();
        const nome = inputNome.value.trim();

        if (!numero) {
            showToast('Digite um número de telefone.', 'warning');
            return;
        }

        btnSubmitSingle.disabled = true;
        btnSubmitSingle.classList.add('loading');

        try {
            const res = await fetch('/api/whitelist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numero, nome })
            });

            const data = await res.json();

            if (data.sucesso) {
                showToast(data.mensagem || 'Administrador salvo na Whitelist!', 'success');
                inputTelefone.value = '';
                inputNome.value = '';
                await carregarWhitelist();
            } else {
                showToast(data.erro || 'Falha ao adicionar.', 'error');
            }
        } catch (err) {
            showToast('Erro de conexão ao salvar administrador.', 'error');
        } finally {
            btnSubmitSingle.disabled = false;
            btnSubmitSingle.classList.remove('loading');
        }
    });

    // =================================================================
    // ⚡ SUBMIT: CADASTRO EM MASSA
    // =================================================================
    formBulkAdmin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const texto = textareaBulk.value.trim();
        const nomePadrao = inputBulkTag.value.trim();

        if (!texto) {
            showToast('Cole uma lista de números.', 'warning');
            return;
        }

        btnSubmitBulk.disabled = true;
        btnSubmitBulk.classList.add('loading');

        try {
            const res = await fetch('/api/whitelist/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ texto, nomePadrao })
            });

            const data = await res.json();

            if (data.sucesso) {
                showToast(data.mensagem || 'Números importados com sucesso!', 'success');
                textareaBulk.value = '';
                inputBulkTag.value = '';
                bulkDetectedCount.textContent = '0 números detectados';
                await carregarWhitelist();
            } else {
                showToast(data.erro || 'Falha na importação em massa.', 'error');
            }
        } catch (err) {
            showToast('Erro de conexão ao importar lote.', 'error');
        } finally {
            btnSubmitBulk.disabled = false;
            btnSubmitBulk.classList.remove('loading');
        }
    });

    // =================================================================
    // 🗑️ MODAL DE CONFIRMAÇÃO DE EXCLUSÃO
    // =================================================================
    function abrirModalExclusao(numero, nome) {
        numeroParaExcluir = numero;
        modalDeleteMessage.innerHTML = `Tem certeza que deseja remover <strong>${nome}</strong> (+${numero}) da Whitelist?<br><small style="color:#94a3b8; display:block; margin-top:6px;">Este número perderá a imunidade na Catraca.</small>`;
        modalDeleteAdmin.style.display = 'flex';
    }

    function fecharModalExclusao() {
        modalDeleteAdmin.style.display = 'none';
        numeroParaExcluir = null;
    }

    modalBtnCancel.addEventListener('click', fecharModalExclusao);

    modalBtnConfirmDelete.addEventListener('click', async () => {
        if (!numeroParaExcluir) return;

        modalBtnConfirmDelete.disabled = true;

        try {
            const res = await fetch(`/api/whitelist/${numeroParaExcluir}`, {
                method: 'DELETE'
            });
            const data = await res.json();

            if (data.sucesso) {
                showToast(data.mensagem || 'Administrador removido com sucesso!', 'success');
                fecharModalExclusao();
                await carregarWhitelist();
            } else {
                showToast(data.erro || 'Erro ao remover.', 'error');
            }
        } catch (err) {
            showToast('Erro de rede ao remover administrador.', 'error');
        } finally {
            modalBtnConfirmDelete.disabled = false;
        }
    });

    // =================================================================
    // 📋 COPIAR TODOS OS NÚMEROS
    // =================================================================
    btnCopyAll.addEventListener('click', () => {
        if (listaAdminsCache.length === 0) {
            showToast('A Whitelist está vazia.', 'warning');
            return;
        }

        const texto = listaAdminsCache.map(i => i.numero).join('\n');
        navigator.clipboard.writeText(texto).then(() => {
            showToast(`${listaAdminsCache.length} números copiados para a área de transferência!`, 'success');
        }).catch(() => {
            showToast('Falha ao copiar automaticamente.', 'error');
        });
    });

    // =================================================================
    // 📊 TELEMETRIA: STATUS DO SERVIDOR E SNIPERS
    // =================================================================
    async function atualizarStatusServidor() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();

            if (data.sucesso) {
                // Servidor
                valUptime.textContent = data.servidor?.uptimeFormatado || '0s';
                valMemory.textContent = `RAM: ${data.servidor?.memoriaMB || '--'} MB`;
                serverStatusText.textContent = data.aegis?.sentinelaAtivo ? 'CATRACA ATIVA 24/7' : 'INICIALIZANDO';

                // Snipers
                if (data.aegis?.snipers) {
                    let conectados = 0;
                    data.aegis.snipers.forEach(s => {
                        const dot = sniperDots[s.indice];
                        if (dot) {
                            if (s.conectado && s.isOpen) {
                                dot.classList.add('active');
                                dot.title = `Sniper 0${s.indice}: Conectado (${s.numero || 'Online'})`;
                                conectados++;
                            } else {
                                dot.classList.remove('active');
                                dot.title = `Sniper 0${s.indice}: Desconectado`;
                            }
                        }
                    });
                    valSnipersStatus.textContent = `${conectados} / 4`;
                }
            }
        } catch (e) {
            serverStatusText.textContent = 'OFFLINE';
        }
    }

    // =================================================================
    // 🚨 FEED DA CATRACA EM TEMPO REAL
    // =================================================================
    async function atualizarFeedCatraca() {
        if (feedPausado) return;

        try {
            const res = await fetch('/api/logs');
            const data = await res.json();

            if (data.sucesso && Array.isArray(data.eventos) && data.eventos.length > 0) {
                let html = '';
                data.eventos.forEach(ev => {
                    html += `
                        <div class="feed-line ${ev.tipo}">
                            <span class="feed-time">${ev.hora}</span>
                            <span class="feed-text">${escapeHtml(ev.texto)}</span>
                        </div>
                    `;
                });
                terminalFeedList.innerHTML = html;
            }
        } catch (e) { }
    }

    btnToggleFeedAuto.addEventListener('click', () => {
        feedPausado = !feedPausado;
        if (feedPausado) {
            btnToggleFeedAuto.textContent = '⏸️ Pausado';
            btnToggleFeedAuto.style.color = '#f59e0b';
        } else {
            btnToggleFeedAuto.textContent = '🟢 Ativo';
            btnToggleFeedAuto.style.color = '#10b981';
            atualizarFeedCatraca();
        }
    });

    btnRefreshAll.addEventListener('click', () => {
        carregarWhitelist();
        atualizarStatusServidor();
        atualizarFeedCatraca();
        showToast('Dados atualizados!', 'success');
    });

    // =================================================================
    // 📦 UPLOAD DE SESSÕES & RECONEXÃO DOS SNIPERS
    // =================================================================
    const inputUploadSessoes = document.getElementById('input-upload-sessoes');
    if (inputUploadSessoes) {
        inputUploadSessoes.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            showToast('Enviando e descompactando sessões no servidor...', 'warning');

            try {
                const buffer = await file.arrayBuffer();
                const res = await fetch('/api/restore/sessoes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/zip' },
                    body: buffer
                });
                const data = await res.json();
                if (data.sucesso) {
                    showToast(data.mensagem || 'Sessões restauradas com sucesso!', 'success');
                    setTimeout(() => {
                        atualizarStatusServidor();
                        carregarWhitelist();
                    }, 2000);
                } else {
                    showToast(data.erro || 'Falha ao restaurar sessões.', 'error');
                }
            } catch (err) {
                showToast('Erro ao enviar arquivo ZIP de sessões.', 'error');
            } finally {
                inputUploadSessoes.value = '';
            }
        });
    }

    const btnReconectarSnipers = document.getElementById('btn-reconectar-snipers');
    if (btnReconectarSnipers) {
        btnReconectarSnipers.addEventListener('click', async () => {
            showToast('Disparando conexão dos 4 Snipers...', 'warning');
            try {
                const res = await fetch('/api/snipers/conectar', { method: 'POST' });
                const data = await res.json();
                showToast(data.mensagem || 'Comando enviado!', 'success');
                setTimeout(atualizarStatusServidor, 2000);
            } catch (e) {
                showToast('Erro ao disparar conexão dos Snipers.', 'error');
            }
        });
    }

    // =================================================================
    // 🧹 UTILITÁRIOS
    // =================================================================
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // =================================================================
    // 🚀 INICIALIZAÇÃO
    // =================================================================
    carregarWhitelist();
    atualizarStatusServidor();
    atualizarFeedCatraca();

    // Loop de polling a cada 3.5 segundos
    pollingInterval = setInterval(() => {
        atualizarStatusServidor();
        atualizarFeedCatraca();
    }, 3500);
});
