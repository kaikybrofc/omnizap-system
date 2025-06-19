#!/bin/bash

# OmniZap - Script de Inicialização
# Sistema Profissional de Automação WhatsApp

echo "🚀 Iniciando OmniZap - Sistema de Automação WhatsApp"
echo "=================================================="

# Verifica se o Node.js está instalado
if ! command -v node &> /dev/null; then
    echo "❌ Node.js não encontrado. Por favor, instale o Node.js >= 16.0.0"
    exit 1
fi

# Verifica a versão do Node.js
NODE_VERSION=$(node -v | cut -d'v' -f2)
REQUIRED_VERSION="16.0.0"

if ! node -e "process.exit(require('semver').gte('$NODE_VERSION', '$REQUIRED_VERSION') ? 0 : 1)" 2>/dev/null; then
    echo "❌ Versão do Node.js inadequada. Requerido: >= $REQUIRED_VERSION, Atual: $NODE_VERSION"
    exit 1
fi

# Verifica se as dependências estão instaladas
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
fi

# Cria o diretório para QR Code se não existir
if [ ! -d "qr-code" ]; then
    echo "📁 Criando diretório para QR Code..."
    mkdir -p qr-code
fi

# Verifica se o arquivo .env existe
if [ ! -f ".env" ]; then
    echo "⚠️  Arquivo .env não encontrado. Usando configurações padrão..."
fi

echo "✅ Verificações concluídas. Iniciando OmniZap..."
echo "=================================================="

# Inicia o sistema
node index.js
