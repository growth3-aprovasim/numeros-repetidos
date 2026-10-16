# =====================================================================
# 🐳 DOCKERFILE // MOTOR AEGIS C2 (EASYPANEL READY)
# =====================================================================
FROM node:20-slim

# Instala ferramentas essenciais para compilação nativa e fuso horário
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    tzdata \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Configura o fuso horário oficial para Horário de Brasília
ENV TZ=America/Sao_Paulo
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /app

# Copia manifests primeiro para aproveitar cache do Docker
COPY package*.json ./

# Instala todas as dependências de produção
RUN npm install --omit=dev

# Copia todo o código da aplicação
COPY . .

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3000

# Porta do Painel Web para o Easypanel
EXPOSE 3000

# Inicia o servidor C2 integrado (Painel Web + Sentinela Aegis 24/7)
CMD ["npm", "start"]