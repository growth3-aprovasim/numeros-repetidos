# 🚀 GUIA DE IMPLANTAÇÃO NO EASYPANEL // AEGIS C2

Este guia explica exatamente como colocar o motor Aegis e o Painel Web de Administradores para rodar 24/7 no **Easypanel** em um servidor na nuvem (VPS), liberando seu computador.

---

## 🌟 O QUE FOI PREPARADO PARA VOCÊ

1. **Painel Web C2 Integrado (`http://seu-servidor:3000`)**:
   - Interface visual moderna em Dark Glassmorphism, rápida e fácil de usar.
   - **Cadastro Individual:** digite o DDD + Número (formatação automática) e nome/cargo opcional.
   - **Importação em Massa:** cole dezenas de números de uma só vez (separados por vírgula ou linhas).
   - **Busca Rápida:** encontre qualquer administrador digitando parte do número ou nome.
   - **Cópia em 1 Clique:** botão para copiar todos os números da Whitelist de uma vez só.
   - **Radar da Catraca em Tempo Real:** feed com as entradas, checagens e expulsões em tempo real.
   - **Telemetria dos Snipers:** veja quais dos 4 snipers estão armados e online.

2. **Sincronização Instantânea com o WhatsApp**:
   - Toda alteração feita no site atualiza a memória do bot **imediatamente**.
   - Os administradores cadastrados ficam 100% imunes à Catraca nos 56 grupos (Black Vitalícia e Base Forte).

3. **Arquivos Prontos para Docker e Easypanel**:
   - [Dockerfile](file:///c:/Users/Usuario/Desktop/Teste%20Projeto%20Espi%C3%A3o/OperationAegis%20[Black%2026]/Dockerfile): Imagem oficial Node 20 com ferramentas de build e fuso horário oficial de Brasília (`America/Sao_Paulo`).
   - [.dockerignore](file:///c:/Users/Usuario/Desktop/Teste%20Projeto%20Espi%C3%A3o/OperationAegis%20[Black%2026]/.dockerignore): Remove arquivos desnecessários para um build rápido e limpo.
   - [server.js](file:///c:/Users/Usuario/Desktop/Teste%20Projeto%20Espi%C3%A3o/OperationAegis%20[Black%2026]/server.js): Inicializador unificado que sobe o Painel Web e o Sentinela Aegis juntos.
   - [exportar_sessoes.js](file:///c:/Users/Usuario/Desktop/Teste%20Projeto%20Espi%C3%A3o/OperationAegis%20[Black%2026]/exportar_sessoes.js): Script para empacotar seus logins existentes do WhatsApp em um arquivo `.zip`.

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

### 💾 Volumes Persistentes (Armazenamento / Storage)
> [!IMPORTANT]
> Esta etapa garante que, se o container reiniciar ou atualizar, os logins dos seus 4 Snipers e a Whitelist nunca se percam.

Na aba **Storage** do seu App no Easypanel, adicione os seguintes volumes persistentes:

| Nome do Volume | Caminho no Container (Mount Path) |
| :--- | :--- |
| `sniper1_auth` | `/app/auth_sniper_1` |
| `sniper2_auth` | `/app/auth_sniper_2` |
| `sniper3_auth` | `/app/auth_sniper_3` |
| `sniper4_auth` | `/app/auth_sniper_4` |
| `aegis_data` | `/app/whitelist_aegis.json` |

*(Se preferir, você também pode simplesmente montar um volume na pasta `/app` inteira ou usar a ferramenta de restauração pelo próprio site!)*

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
