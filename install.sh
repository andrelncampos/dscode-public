#!/bin/bash

# Encerra o script imediatamente se algum comando falhar
set -e

# Descobre o diretório real onde o script está sendo executado
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_BIN="$SCRIPT_DIR/dscode"
INSTALL_DIR="/usr/local/bin"
COMMAND_NAME="dscode"

echo "=== Instalador do DScode para Linux ==="

# 1. Verifica se o binário do dscode existe na pasta
if [ ! -f "$TARGET_BIN" ]; then
    echo "[ERRO] O arquivo binário 'dscode' não foi encontrado em: $SCRIPT_DIR"
    exit 1
fi

# 2. Verifica se o usuário tem privilégios de root (sudo)
if [ "$EUID" -ne 0 ]; then
  echo "[AVISO] Este script precisa de permissão de superusuário para instalar o comando globalmente."
  echo "Por favor, execute com: sudo ./install.sh"
  exit 1
fi

# 3. Garante permissão de execução no binário original
echo "Configurando permissões de execução..."
chmod +x "$TARGET_BIN"

# 4. Cria o link simbólico universal em /usr/local/bin
echo "Criando link simbólico em $INSTALL_DIR/$COMMAND_NAME..."
ln -sf "$TARGET_BIN" "$INSTALL_DIR/$COMMAND_NAME"

echo "--------------------------------------------------"
echo "[SUCESSO] O comando '$COMMAND_NAME' foi instalado com sucesso!"
echo "Você já pode usá-lo digitando '$COMMAND_NAME' em qualquer terminal."
echo "--------------------------------------------------"
