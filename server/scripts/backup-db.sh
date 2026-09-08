#!/usr/bin/env bash
# Backup dos bancos Postgres de produção (Kyvvo).
# Roda na EC2 via cron — ver .github/workflows/deploy-backup.yml para o
# deploy do script e instalação do agendamento, e docs/backup.md /
# docs/restore.md para detalhes operacionais.
#
# Dumpa cada banco em POSTGRES_DBS (default: `railway` = Studio/admin, e
# `kyvvo_people` = Kyvvo People), como SQL puro gzipado, um arquivo por
# banco: <db>_<timestamp>.sql.gz em BACKUP_DIR. Se BACKUP_S3_BUCKET estiver
# definido, envia cada arquivo pro bucket (aws-cli) logo após criá-lo.
#
# Assume Postgres no serviço "postgres" do docker-compose.yml de /opt/kyvvo.
# Ajuste POSTGRES_SERVICE/POSTGRES_USER/POSTGRES_DBS/BACKUP_DIR via env
# (ou no /opt/kyvvo/.env, carregado abaixo).
#
# Usa `docker exec` no container (não `docker compose exec`): o cron roda como
# `ubuntu` e o `docker compose` precisaria ler os env_file mode 600 (dono root)
# do compose — o que quebrava o backup desde o cutover pro SSM (2026-09-02).
set -uo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/kyvvo}"

if [ -f "$COMPOSE_DIR/.env" ]; then
  # shellcheck disable=SC1090
  set -a; source "$COMPOSE_DIR/.env"; set +a
fi

POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
# Resolve o nome do container pela label do compose (não lê o compose.yml).
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-$(docker ps --filter label=com.docker.compose.service=${POSTGRES_SERVICE} --format={{.Names}} | head -n1)}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DBS="${POSTGRES_DBS:-railway kyvvo_people}"
BACKUP_DIR="${BACKUP_DIR:-/opt/kyvvo/backups}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-kyvvo-db}"

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cd "$COMPOSE_DIR"

falhou=0

for DB in $POSTGRES_DBS; do
  FILENAME="${DB}_${TIMESTAMP}.sql.gz"
  DEST="$BACKUP_DIR/$FILENAME"
  TMP_DEST="${DEST}.tmp"

  if [ -z "$POSTGRES_CONTAINER" ]; then
    echo "ERRO: container do Postgres (serviço '$POSTGRES_SERVICE') não encontrado" >&2
    falhou=1
    break
  fi

  # pipefail garante que uma falha do pg_dump (não do gzip) derrube o status.
  if ! docker exec -i "$POSTGRES_CONTAINER" \
        pg_dump -U "$POSTGRES_USER" -d "$DB" --no-owner --no-privileges \
        | gzip > "$TMP_DEST"; then
    echo "ERRO: pg_dump falhou para '$DB'" >&2
    rm -f "$TMP_DEST"
    falhou=1
    continue
  fi

  # Um .sql.gz íntegro tem sempre mais que algumas centenas de bytes; abaixo
  # disso é quase certo dump vazio / falha silenciosa.
  TAM="$(stat -c%s "$TMP_DEST" 2>/dev/null || echo 0)"
  if [ "$TAM" -lt 200 ]; then
    echo "ERRO: dump de '$DB' suspeito ($TAM bytes) — descartado" >&2
    rm -f "$TMP_DEST"
    falhou=1
    continue
  fi

  mv "$TMP_DEST" "$DEST"
  echo "Backup criado: $DEST ($TAM bytes)"

  if [ -n "$BACKUP_S3_BUCKET" ]; then
    if ! command -v aws >/dev/null 2>&1; then
      echo "aws-cli não encontrado no host — S3 pulado para '$DB'" >&2
      falhou=1
    elif aws s3 cp "$DEST" "s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/${FILENAME}"; then
      echo "Enviado: s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/${FILENAME}"
    else
      echo "ERRO: upload S3 falhou para '$DB'" >&2
      falhou=1
    fi
  fi
done

# --- Retenção local: apaga dumps além de BACKUP_RETENTION_DAYS (default 30).
# 0 desativa. A retenção no S3 é feita por lifecycle policy no bucket, não
# aqui (lida melhor com versionamento) — ver docs/backup.md.
RET_DAYS="${BACKUP_RETENTION_DAYS:-30}"
case "$RET_DAYS" in
  ''|*[!0-9]*) echo "BACKUP_RETENTION_DAYS inválido ('$RET_DAYS') — retenção local pulada" >&2 ;;
  0) : ;;
  *)
    find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.sql.gz' -mtime +"$RET_DAYS" \
      -print -delete 2>/dev/null | sed 's/^/Expirado (local): /' || true
    ;;
esac

if [ -z "$BACKUP_S3_BUCKET" ]; then
  echo "BACKUP_S3_BUCKET não definido — backups só locais em $BACKUP_DIR." >&2
fi

exit "$falhou"
