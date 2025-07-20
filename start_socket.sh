#!/bin/bash

# Script para inicializar o Socket Controller do OmniZap

AUTH_DIR="./app/connection/auth_info_baileys"

# Função para limpar a sessão anterior
function clear_session() {
  if [ -d "$AUTH_DIR" ]; then
    echo "Limpando sessão anterior..."
    rm -rf "$AUTH_DIR"
    echo "Sessão anterior removida."
  fi
}

# Função para exibir o menu de escolha do método de início
function choose_start_method() {
  echo "Escolha o método de conexão com o WhatsApp:"

  local options=()
  if [ -d "$AUTH_DIR" ]; then
    options+=("Reconectar com a sessão salva")
  fi
  options+=("Iniciar nova sessão com QR Code")
  options+=("Iniciar nova sessão com Código de Pareamento")

  select opt in "${options[@]}"; do
    case $opt in
      "Reconectar com a sessão salva")
        echo "Tentando reconectar com a sessão salva."
        # Não define variáveis, o socketController usará a sessão existente
        break
        ;;
      "Iniciar nova sessão com QR Code")
        clear_session
        export PAIRING_CODE=false
        echo "Método escolhido: QR Code (Nova Sessão)"
        break
        ;;
      "Iniciar nova sessão com Código de Pareamento")
        clear_session
        export PAIRING_CODE=true
        read -p "Digite o número de telefone (com código do país, ex: 55119...): " phone_number
        export PHONE_NUMBER=$phone_number
        echo "Método escolhido: Código de Pareamento (Nova Sessão)"
        break
        ;;
      *) echo "Opção inválida $REPLY";;
    esac
  done
}

# Exibe o menu para o usuário
choose_start_method

# Inicializar o OmniZap System
# As variáveis de ambiente PAIRING_CODE e PHONE_NUMBER serão usadas pelo script node.
echo "Iniciando o OmniZap System..."
node app/connection/socketController.js