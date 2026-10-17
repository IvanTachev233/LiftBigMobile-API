#!/usr/bin/env bash
# One-time Google Cloud setup for scripts/deploy.sh: login, APIs, the IAM roles
# Cloud Build needs for source deploys, and the Secret Manager secrets the
# service reads (created here if missing, values typed hidden and never
# printed). Safe to run again; existing secrets are left as they are.

set -euo pipefail

SECRETS=(DATABASE_URL JWT_SECRET MAIL_PROVIDER_KEY)

usage() {
  cat <<'EOF'
Usage: scripts/gcp-setup.sh [options]

One-time setup of a Google Cloud project for scripts/deploy.sh. Run it in a
terminal: it asks for the secret values.

Options:
  --project ID      Google Cloud project ID (env GCP_PROJECT_ID; asked if unset)
  --region REGION   Cloud Run region (env GCP_REGION, default europe-west1)
  --service NAME    Cloud Run service (env SERVICE, default liftbig-api)
  -h, --help        Show this help
EOF
}

die() {
  echo "Error: $*" >&2
  exit 1
}

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

[ -t 0 ] || die "run this in a terminal; it asks for secret values"
command -v gcloud >/dev/null 2>&1 ||
  die "gcloud CLI not found; install it: https://cloud.google.com/sdk/docs/install"

account="$(gcloud config get-value account 2>/dev/null || true)"
if [ -z "$account" ] || [ "$account" = "(unset)" ]; then
  echo "No active Google Cloud account; logging in."
  gcloud auth login
fi

if [ -z "${GCP_PROJECT_ID:-}" ]; then
  gcloud projects list
  read -r -p "Project ID (the string ID, not the project number): " GCP_PROJECT_ID
fi
[ -n "$GCP_PROJECT_ID" ] || die "a project ID is required"
[[ "$GCP_PROJECT_ID" =~ ^[0-9]+$ ]] &&
  die "that is the project number; use the string project ID"

project_number="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
compute_sa="${project_number}-compute@developer.gserviceaccount.com"

echo "Enabling the Cloud Run, Cloud Build, Artifact Registry and Secret Manager APIs..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com \
  --project="$GCP_PROJECT_ID"

# Source deploys build as the Compute Engine default service account.
echo "Granting Cloud Build's service account ($compute_sa) the build roles..."
for role in roles/run.builder roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:$compute_sa" --role="$role" \
    --condition=None --quiet >/dev/null
done

# The service reads its secrets as its runtime service account: the one set on
# an existing service, otherwise the Compute Engine default.
runtime_sa="$(gcloud run services describe "$SERVICE" --project="$GCP_PROJECT_ID" \
  --region="$GCP_REGION" --format='value(spec.template.spec.serviceAccountName)' \
  2>/dev/null || true)"
runtime_sa=${runtime_sa:-$compute_sa}

read_secret() {
  local name=$1 value
  while true; do
    case "$name" in
      DATABASE_URL) read -r -s -p "DATABASE_URL (postgresql://...): " value ;;
      JWT_SECRET) read -r -s -p "JWT_SECRET (blank to generate one): " value ;;
      MAIL_PROVIDER_KEY) read -r -s -p "MAIL_PROVIDER_KEY (Resend API key): " value ;;
    esac
    echo >&2
    if [ "$name" = JWT_SECRET ] && [ -z "$value" ]; then
      value="$(openssl rand -base64 48)"
    fi
    if [ -z "$value" ]; then
      echo "A value is required." >&2
    elif [ "$name" = DATABASE_URL ] && ! [[ "$value" =~ ^postgres(ql)?:// ]]; then
      echo "It must start with postgresql:// or postgres://." >&2
    else
      break
    fi
  done
  printf '%s' "$value" |
    gcloud secrets create "$name" --project="$GCP_PROJECT_ID" --data-file=- >/dev/null
}

for name in "${SECRETS[@]}"; do
  if gcloud secrets describe "$name" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    echo "Secret $name exists; left unchanged."
  else
    read_secret "$name"
    echo "Created secret $name."
  fi
  gcloud secrets add-iam-policy-binding "$name" --project="$GCP_PROJECT_ID" \
    --member="serviceAccount:$runtime_sa" \
    --role=roles/secretmanager.secretAccessor >/dev/null
done

echo
echo "Done. $runtime_sa can read ${SECRETS[*]}."
echo "Deploy with: GCP_PROJECT_ID=$GCP_PROJECT_ID scripts/deploy.sh"
