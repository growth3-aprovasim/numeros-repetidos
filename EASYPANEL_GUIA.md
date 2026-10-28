# 🚀 GUIA DE IMPLANTAÇÃO NO EASYPANEL // AEGIS C2

Este guia explica exatamente como colocar o motor Aegis e o Painel Web de Administradores para rodar 24/7 no **Easypanel** em um servidor na nuvem (VPS), liberando seu computador.

---

## 🌟 O QUE FOI PREPARADO PARA VOCÊ

1. **Painel Web C2 Integrado (`http://seu-servidor:3000`)**:
   - Interface visual moderna em Dark Glassmorphism, rápida e fácil de usar.
   - **Central de Conexão dos Espiões (NOVO):** conecte quantos espiões desejar diretamente pelo site via **QR Code** ou **Código de Pareamento** por número de telefone. Escolha e altere a quantidade de espiões ativos a qualquer momento!
   - **Regras e Limites Customizáveis (NOVO):** escolha o limite de grupos permitidos e o gatilho para **Ban Permanente** (padrão > 10 links).
   - **Blacklist Permanente com Remoção Total (NOVO):** se alguém exceder o limite de links, é banida permanentemente, removida de **TODOS OS GRUPOS SEM EXCEÇÃO** e expulsa imediatamente se tentar voltar. Possui lista com busca, desbanimento e ban manual.
   - **Gestão de Whitelist:** cadastro individual e importação em lote com busca rápida e cópia em 1 clique.
   - **Radar da Catraca em Tempo Real:** feed com entradas de leads, liberações por imunidade, checagens de saturação e expulsões imediatas.
   - **Telemetria Completa:** status e números conectados de todos os espiões, memória RAM e uptime.

2. **Sincronização Instantânea com o WhatsApp**:
   - Toda alteração feita no site atualiza a memória do bot **imediatamente**.
   - Os administradores cadastrados ficam 100% imunes à Catraca nos 56 grupos (Black Vitalícia e Base Forte).

3. **Arquivos Prontos para Docker e Easypanel**:
   - [Dockerfile](file:///c:/Users/Usuario/Desktop/Teste%20Projeto%20Espi%C3%A3o/OperationAegis%20[Black%2026]/Dockerfile): Imagem oficial Node 20 com ferramentas de build e fuso horário oficial de Brasília (`America/Sao_Paulo`).
   - [.dockerignore](file:///c:/Users/Usuario/Desktop/Teste%20Projeto%20Espi%C3%A3o/OperationAegis%20[Black%2026]/.dockerignore): Remove arquivos desnecessários para um build rápido e limpo.
   - [server.js](file:///c:/Users/Usuario/Desktop/Teste%20Projeto%20Espi%C3%A3o/OperationAegis%20[Black%2026]/server.js): Inicializador unificado que sobe o Painel Web e o Sentinela Aegis juntos.
   - [exportar_sessoes.js](file:///c:/Users/Usuario/Desktop/Teste%20Projeto%20Espi%C3%A3o/OperationAegis%20[Black%2026]/exportar_sessoes.js): Script para empacotar todos os logins existentes e arquivos de configuração em um arquivo `.zip`.

---

## 📦 PASSO 1: EXPORTAR SUAS SESSÕES ATUAIS DO WHATSAPP

Para que o servidor na nuvem já inicie **conectado** com os seus 4 Snipers (sem precisar ler QR Code novamente no celular):

1. No seu terminal no computador, execute:
   ```bash
   node exportar_sessoes.js
   ```
2. Isso vai gerar na raiz do projeto o arquivo:
   `aegis_sessoes_snipers.zip`
3. Guarde esse arquivo para usar no Passo 3.

---

## ☁️ PASSO 2: CRIAR O SERVIÇO NO EASYPANEL

1. Abra o seu painel do **Easypanel**.
2. Clique no seu Projeto (ou crie um novo projeto, ex: `Aegis-C2`).
3. Clique em **+ Service** e selecione **App**.
4. Dê um nome para a aplicação (ex: `aegis-sentinel`).

### ⚙️ Configuração da Fonte (Source)
Se você utiliza Git (GitHub ou GitLab):
- Em **Source**, selecione **GitHub**.
- Conecte seu repositório onde está este projeto.
- Em **Branch**, selecione `main` (ou a branch onde você subiu os arquivos).

### 🐳 Configuração de Build
- Em **Build Method**, selecione **Dockerfile**.
- O Easypanel detectará automaticamente o `Dockerfile` que já está pronto na raiz do projeto.

### 🌐 Configuração de Porta e Domínio (Network)
- Em **Port**, defina: `3000`.
- Em **Domains**, clique em **Add Domain** e adicione o endereço que deseja usar:
  - Exemplo: `aegis.seudominio.com` (ou use o domínio gerado automaticamente pelo Easypanel).
  - O Easypanel gera o certificado SSL (HTTPS) gratuitamente de forma automática!

### 💾 Volume Persistente Único (Armazenamento / Storage)
> [!IMPORTANT]
> **ESSENCIAL PARA NUNCA PERDER SEUS LOGINS NEM CONFIGURAÇÕES EM NENHUM DEPLOY:**
> O sistema agora conta com o diretório unificado `/app/data`. Basta adicionar **1 ÚNICO VOLUME** no Easypanel!

Na aba **Storage** do seu App no Easypanel, adicione:

| Nome do Volume | Caminho no Container (Mount Path) |
| :--- | :--- |
| `aegis_data` | `/app/data` |

**O que fica salvo permanentemente no `/app/data`:**
- ✅ **Todos os logins de todos os ADMs Snipers** de todas as campanhas (`auth_sniper_*`).
- ✅ **Backup automático contínuo (`aegis_sessoes_snipers.zip`)**: criado e mantido pelo próprio sistema a cada conexão. Se o container reiniciar, ele restaura tudo sozinho.
- ✅ **Blacklist Permanente** e **Leads Restritos** (`blacklist_aegis.json`, `crocodilos_kelven.json`).
- ✅ **Whitelist de Administradores** (`whitelist_aegis.json`).
- ✅ **Configurações e Limites** (`config_aegis.json`).
- ✅ **Mapeamento de ADMs por Campanha** (`snipers_campanhas.json`).

> 💡 **Nota:** Se você não configurar o volume persistente no Easypanel, o container do Docker é descartável e perde as alterações ao atualizar a imagem. Criando o volume `/app/data`, nada mais se perde! Além disso, você pode baixar o backup ZIP com 1 clique direto pelo botão no painel.

---

## 🚀 PASSO 3: DEPLOY E MIGRAÇÃO DAS SESSÕES

1. Clique no botão **Deploy** no Easypanel e aguarde a finalização do build (cerca de 1 a 2 minutos).
2. Assim que o status ficar verde (**Running**), acesse o domínio configurado (ex: `https://aegis.seudominio.com`).
3. Você verá o **Painel Aegis C2**:
   - Os cards de métricas (Administradores, Snipers, Uptime).
   - O formulário para cadastrar novos números.
   - A lista completa com os 46 administradores já sincronizados.
   - O feed em tempo real da Catraca.
4. Para migrar seus logins do WhatsApp:
   - Se você não colocou as pastas manualmente via FTP/SSH, basta usar a área de **Migração & Backup de Sessões** no painel ou colocar o `aegis_sessoes_snipers.zip` no servidor.
   - Os 4 Snipers conectarão automaticamente no servidor.

---

## 💡 DICAS DE OPERAÇÃO

- **Adicionar Administrador urgente:** acesse o site pelo celular ou computador, digite o número do WhatsApp e clique em "Salvar". Ele já fica imune no mesmo instante.
- **Checar se a Catraca está operando:** olhe para o topo do painel. A pílula verde indicará `CATRACA ATIVA 24/7` e os 4 círculos dos Snipers (`01`, `02`, `03`, `04`) acenderão em verde conforme os aparelhos estiverem conectados.
- **Se precisar reiniciar o motor:** basta dar um restart no serviço pelo Easypanel. O container volta em menos de 3 segundos sem perder nada.
