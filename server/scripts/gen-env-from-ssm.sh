#!/usr/bin/env bash
# Gera /opt/kyvvo/env/<servico>.env a partir dos parametros SSM em
# /kyvvo/<servico>/* (SecureString). Roda na EC2 (usa o instance profile
# kyvvo-ec2-backup-role, que tem ssm:GetParametersByPath + kms:Decrypt).
#
# Cutover pro SSM: os `environment:` inline do docker-compose.yml viram
# `env_file: ./env/<servico>.env`, e este script roda antes do
# `docker compose up -d` (nos deploys e na mao). Arquivos gerados sao
# mode 600 e ficam fora do git (.gitignore em /opt/kyvvo/env/).
#
# Ver docs/backup.md (infra) e o repo kyvvohq/kyvvo-infra.
set -uo pipefail

REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ENV_DIR="${ENV_DIR:-/opt/kyvvo/env}"
SSM_PREFIX="${SSM_PREFIX:-/kyvvo}"
SERVICES="${SERVICES:-postgres n8n landing studio people platform}"

mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"

falhou=0
for svc in $SERVICES; do
  out="$ENV_DIR/$svc.env"
  tmp="$(mktemp "${out}.XXXXXX")"
  chmod 600 "$tmp"

  if ! aws ssm get-parameters-by-path \
        --path "${SSM_PREFIX}/${svc}/" --recursive --with-decryption \
        --region "$REGION" --output json > "${tmp}.json" 2>/dev/null; then
    echo "ERRO: get-parameters-by-path falhou para '$svc'" >&2
    rm -f "$tmp" "${tmp}.json"; falhou=1; continue
  fi

  # env_file do compose = KEY=VALUE, uma linha. Recusa valor com \n (nao
  # suportado por env_file e sinal de parametro que nao devia estar aqui).
  if ! python3 - "$svc" "${tmp}.json" "$tmp" <<'PY'
import json, sys
svc, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
params = json.load(open(src)).get("Parameters", [])
bad = [p["Name"] for p in params if "\n" in p["Value"] or "\r" in p["Value"]]
if bad:
    sys.stderr.write(f"ERRO: {svc}: valor com quebra de linha em: {', '.join(bad)}\n")
    sys.exit(1)
with open(dst, "w", encoding="utf-8") as f:
    for p in sorted(params, key=lambda p: p["Name"]):
        f.write(f'{p["Name"].split("/")[-1]}={p["Value"]}\n')
print(len(params))
PY
  then
    rm -f "$tmp" "${tmp}.json"; falhou=1; continue
  fi
  rm -f "${tmp}.json"

  n="$(wc -l < "$tmp")"
  if [ "$n" -eq 0 ]; then
    echo "AVISO: nenhum parametro em ${SSM_PREFIX}/${svc}/ — mantendo $out atual" >&2
    rm -f "$tmp"; continue
  fi
  mv "$tmp" "$out"
  echo "$out ($n vars)"
done

exit "$falhou"
