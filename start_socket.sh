#!/bin/bash

# Script para inicializar o Socket Controller do OmniZap

# Função para exibir o menu de escolha do método de início
function choose_start_method() {
  echo "Escolha o método de início para a conexão com o WhatsApp:"
  echo "1) QR Code"
  echo "2) Código de Pareamento"
  read -p "Digite o número da sua escolha: " choice

  case $choice in
    1)
      export PAIRING_CODE=false
      echo "Método escolhido: QR Code"
      ;;
    2)
      export PAIRING_CODE=true
      read -p "Digite o número de telefone (apenas números, com código do país): " phone_number
      export PHONE_NUMBER=$phone_number
      echo "Método escolhido: Código de Pareamento"
      ;;
    *)
      echo "Escolha inválida. Tente novamente."
      choose_start_method
      ;;
  esac
}

# Verificar se é a primeira conexão
if [ ! -d "./app/connection/auth_info_baileys" ]; then
  echo "Primeira conexão detectada."
  choose_start_method
else
  echo "Conexão existente detectada. Usando configurações salvas."
fi

# Inicializar o Socket Controller
node ./app/connection/socketController.js
