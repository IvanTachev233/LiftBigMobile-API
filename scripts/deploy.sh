#!/usr/bin/env bash
# Deploys the API to Google Cloud Run from this repo's source (built with the
# Dockerfile). Inputs come from env vars or flags; in a terminal the script asks
# for a missing value, otherwise it stops and names it, so a pipeline can run it
# unchanged. Secrets are passed by Secret Manager name only and never read here.
# One-time project setup (login, APIs, IAM, secrets): scripts/gcp-setup.sh.

set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Container env var = Secret Manager secret of the same name, latest version.
SECRETS=(DATABASE_URL JWT_SECRET MAIL_PROVIDER_KEY)
# Must be set; CORS_ORIGINS may be set to an empty string for "none".
REQUIRED=(GCP_PROJECT_ID MAIL_FROM CORS_ORIGINS PRIVACY_OPERATOR_NAME PRIVACY_CONTACT_EMAIL)
# Separates env vars on the gcloud command line (`gcloud topic escaping`), so
# values may contain commas, e.g. CORS_ORIGINS.
D=';;'

usage() {
  cat <<'EOF'
Usage: scripts/deploy.sh [options]

Deploys the API to Cloud Run from source.

Options:
  --project ID        Google Cloud project ID (env GCP_PROJECT_ID)
  --region REGION     Cloud Run region (env GCP_REGION, default europe-west1)
  --service NAME      Cloud Run service (env SERVICE, default liftbig-api)
  --dry-run           Print the gcloud command and exit without deploying
  --non-interactive   Never prompt; fail when a value is missing (the default
                      when stdin is not a terminal)
  -h, --help          Show this help

Env vars (required; CORS_ORIGINS may be empty):
  MAIL_FROM              Sender of code mails, e.g. "LiftBig <codes@example.com>"
  CORS_ORIGINS           Extra web origins, comma-separated exact URLs
  PRIVACY_OPERATOR_NAME  Who runs the app, shown on /privacy
  PRIVACY_CONTACT_EMAIL  Contact email shown on /privacy

Secrets (Secret Manager, latest version): DATABASE_URL, JWT_SECRET,
MAIL_PROVIDER_KEY.
EOF
}

die() {
  echo "Error: $*" >&2
  exit 1
}

describe() {
  case "$1" in
    GCP_PROJECT_ID) echo "Google Cloud project ID (the string ID, not the project number)" ;;
    MAIL_FROM) echo "Sender of code mails, e.g. LiftBig <codes@example.com>" ;;
    CORS_ORIGINS) echo "Extra web origins, comma-separated exact URLs (empty for none)" ;;
    PRIVACY_OPERATOR_NAME) echo "Operator name shown on /privacy" ;;
    PRIVACY_CONTACT_EMAIL) echo "Contact email shown on /privacy" ;;
  esac
}

is_set() {
  [ -n "${!1+x}" ]
}

DRY_RUN=false
INTERACTIVE=true
[ -t 0 ] || INTERACTIVE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --project | --region | --service)
      [ $# -ge 2 ] || die "$1 needs a value"
      case "$1" in
        --project) GCP_PROJECT_ID=$2 ;;
        --region) GCP_REGION=$2 ;;
        --service) SERVICE=$2 ;;
      esac
      shift
      ;;
    --project=*) GCP_PROJECT_ID=${1#*=} ;;
    --region=*) GCP_REGION=${1#*=} ;;
    --service=*) SERVICE=${1#*=} ;;
    --dry-run) DRY_RUN=true ;;
    --non-interactive) INTERACTIVE=false ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

GCP_REGION=${GCP_REGION:-europe-west1}
SERVICE=${SERVICE:-liftbig-api}

missing=()
for name in "${REQUIRED[@]}"; do
  # An empty CORS_ORIGINS means "none"; any other empty value counts as missing.
  if is_set "$name" && { [ -n "${!name}" ] || [ "$name" = CORS_ORIGINS ]; }; then
    continue
  fi
  if [ "$INTERACTIVE" = true ]; then
    while true; do
      read -r -p "$(describe "$name"): " value
      if [ -n "$value" ] || [ "$name" = CORS_ORIGINS ]; then
        break
      fi
      echo "A value is required." >&2
    done
    printf -v "$name" '%s' "$value"
  else
    missing+=("$name")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "Error: missing required values (set them in the environment):" >&2
  for name in "${missing[@]}"; do
    echo "  $name: $(describe "$name")" >&2
  done
  exit 1
fi

[[ "$GCP_PROJECT_ID" =~ ^[0-9]+$ ]] &&
  die "GCP_PROJECT_ID is the project number; use the string project ID"
for name in "${REQUIRED[@]}"; do
  case "${!name}" in
    *"$D"* | *$'\n'*) die "$name must not contain '$D' or a line break" ;;
  esac
done

env_vars="^${D}^MAIL_FROM=$MAIL_FROM${D}CORS_ORIGINS=$CORS_ORIGINS"
env_vars+="${D}PRIVACY_OPERATOR_NAME=$PRIVACY_OPERATOR_NAME${D}PRIVACY_CONTACT_EMAIL=$PRIVACY_CONTACT_EMAIL"
env_vars+="${D}TYPEORM_SYNC=true${D}RUN_MIGRATIONS=true"

secret_refs=""
for name in "${SECRETS[@]}"; do
  secret_refs+="${secret_refs:+,}$name=$name:latest"
done
secret_names="$(IFS=,; echo "${SECRETS[*]}")"

# --remove-env-vars runs before the secrets are set, so a service that still has
# one of these as a plain value switches to the secret in the same deploy.
cmd=(
  gcloud run deploy "$SERVICE"
  --project="$GCP_PROJECT_ID"
  --region="$GCP_REGION"
  --source="$API_DIR"
  --allow-unauthenticated
  --remove-env-vars="$secret_names"
  --update-env-vars="$env_vars"
  --set-secrets="$secret_refs"
)
[ "$INTERACTIVE" = true ] || cmd+=(--quiet)

print_cmd() {
  printf '%q %q %q %q' "${cmd[@]:0:4}"
  printf ' \\\n  %q' "${cmd[@]:4}"
  printf '\n'
}

if [ "$DRY_RUN" = true ]; then
  print_cmd
  exit 0
fi

command -v gcloud >/dev/null 2>&1 ||
  die "gcloud CLI not found; install it: https://cloud.google.com/sdk/docs/install"
account="$(gcloud config get-value account 2>/dev/null || true)"
if [ "$account" = "(unset)" ]; then
  account=""
fi
# A pipeline may authenticate through a credentials file with no account set.
if [ -z "$account" ] && [ "$INTERACTIVE" = true ]; then
  die "no active gcloud account; run 'gcloud auth login' (or scripts/gcp-setup.sh)"
fi

echo "Deploying $SERVICE to $GCP_PROJECT_ID ($GCP_REGION)${account:+ as $account}."
echo "TYPEORM_SYNC and RUN_MIGRATIONS are on: entity changes alter the production schema."
if [ "$INTERACTIVE" = true ]; then
  print_cmd
  read -r -p "Deploy now? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || die "cancelled"
fi

"${cmd[@]}"

echo "Deployed. If the service URL changed, update liftbig-app/src/environments/environment.prod.ts."
