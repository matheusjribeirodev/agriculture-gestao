#!/usr/bin/env bash
# Roda fora do processo do bot (via systemd timer, ver README) — se o bot
# travar ou o processo inteiro morrer, esse script continua rodando e avisa.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEARTBEAT="$DIR/.heartbeat"
ESTADO="$DIR/.watchdog-estado"
LIMITE_SEGUNDOS=$((8 * 60))

NTFY_TOPIC=$(grep -E '^NTFY_TOPIC=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || true)
if [ -z "${NTFY_TOPIC:-}" ]; then
  echo "NTFY_TOPIC não configurado em .env — watchdog não pode alertar." >&2
  exit 1
fi

export PATH=/usr/local/lib/nodejs/bin:$PATH

alertar() {
  curl -s -H "Title: Bot Gestão Rural" -H "Priority: urgent" -H "Tags: warning" -d "$1" "https://ntfy.sh/$NTFY_TOPIC" > /dev/null
}

avisar_recuperado() {
  curl -s -H "Title: Bot Gestão Rural" -H "Tags: white_check_mark" -d "$1" "https://ntfy.sh/$NTFY_TOPIC" > /dev/null
}

status_pm2=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="bot-rural") | .pm2_env.status' || echo "")
[ -z "$status_pm2" ] && status_pm2="nao_encontrado"

heartbeat_ok=false
if [ -f "$HEARTBEAT" ]; then
  ultimo=$(date -d "$(cat "$HEARTBEAT")" +%s 2>/dev/null || echo 0)
  agora=$(date +%s)
  if [ $((agora - ultimo)) -lt "$LIMITE_SEGUNDOS" ]; then
    heartbeat_ok=true
  fi
fi

if [ "$status_pm2" = "online" ] && [ "$heartbeat_ok" = true ]; then
  if [ -f "$ESTADO" ]; then
    avisar_recuperado "O bot voltou a responder normalmente."
    rm -f "$ESTADO"
  fi
  exit 0
fi

# Só alerta na transição pra "caído" — evita mandar aviso repetido a cada
# execução do timer enquanto o problema persiste.
if [ ! -f "$ESTADO" ]; then
  motivo="status pm2: $status_pm2"
  if [ "$heartbeat_ok" = false ]; then
    motivo="$motivo, sem sinal de vida há mais de $((LIMITE_SEGUNDOS / 60)) min"
  fi
  alertar "O bot parece estar fora do ar ($motivo). Confira a VM."
  touch "$ESTADO"
fi
