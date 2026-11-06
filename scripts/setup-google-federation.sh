#!/usr/bin/env bash
set -euo pipefail

# Konfiguracja dla jednego projektu Vercel i środowiska production.
# Nie tworzy kluczy, nie zmienia zasad organizacji, nie włącza płatności.
GCP_PROJECT_ID='project-dcc520bb-b866-4147-a65'
SERVICE_ACCOUNT='prohous-portal@project-dcc520bb-b866-4147-a65.iam.gserviceaccount.com'
POOL_ID='prohous-portal'
PROVIDER_ID='vercel-production'
VERCEL_TEAM_ID='team_CHkBCTDHHnuipFfpNfntp0Qy'
VERCEL_PROJECT_ID='prj_YgaNjU6WFP8a7nEHGCdlUxmcS9UU'
SUBJECT='owner:prohous:project:prohous-portal:environment:production'
ISSUER='https://oidc.vercel.com/prohous'
AUDIENCE='https://vercel.com/prohous'
CONDITION="assertion.owner_id == '${VERCEL_TEAM_ID}' && assertion.project_id == '${VERCEL_PROJECT_ID}' && assertion.environment == 'production' && assertion.sub == '${SUBJECT}'"
MAPPING='google.subject=assertion.sub,attribute.project_id=assertion.project_id,attribute.owner_id=assertion.owner_id,attribute.environment=assertion.environment'

if [[ "${1:-}" != '--apply' ]]; then
  printf '%s\n' 'Plan: utworzenie puli/providera OIDC i prawa Workload Identity User tylko dla produkcyjnego portalu PROHOUS.'
  printf 'Projekt Google: %s\nKonto usługi: %s\nZaufana aplikacja: %s\n' "$GCP_PROJECT_ID" "$SERVICE_ACCOUNT" "$SUBJECT"
  printf '%s\n' 'Uruchom z --apply w Google Cloud Shell po sprawdzeniu planu.'
  exit 0
fi
command -v gcloud >/dev/null || { printf '%s\n' 'Uruchom skrypt w Google Cloud Shell.' >&2; exit 1; }
command -v python3 >/dev/null
# Zatrzymaj się, jeśli konto usługi nie istnieje w podanym projekcie.
actual_account=$(gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project="$GCP_PROJECT_ID" --format='value(email)')
[[ "$actual_account" == "$SERVICE_ACCOUNT" ]] || { printf '%s\n' 'Nieprawidłowe konto usługi.' >&2; exit 1; }
project_number=$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')
[[ "$project_number" =~ ^[0-9]+$ ]] || { printf '%s\n' 'Nie udało się odczytać numeru projektu.' >&2; exit 1; }
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com drive.googleapis.com --project="$GCP_PROJECT_ID" --quiet
pool_name="projects/${project_number}/locations/global/workloadIdentityPools/${POOL_ID}"
provider_name="${pool_name}/providers/${PROVIDER_ID}"
existing_pool=$(gcloud iam workload-identity-pools list --project="$GCP_PROJECT_ID" --location=global --filter="name=${pool_name}" --format='value(name)')
if [[ -z "$existing_pool" ]]; then
  gcloud iam workload-identity-pools create "$POOL_ID" --project="$GCP_PROJECT_ID" --location=global --display-name='PROHOUS Portal production' --quiet
elif [[ "$existing_pool" != "$pool_name" ]]; then
  printf '%s\n' 'Niejednoznaczna pula. Zatrzymano bez zmiany uprawnień.' >&2; exit 1
fi
pool_state=$(gcloud iam workload-identity-pools describe "$POOL_ID" --project="$GCP_PROJECT_ID" --location=global --format='value(state)')
[[ "$pool_state" == 'ACTIVE' ]] || { printf '%s\n' 'Pula nie jest aktywna. Zatrzymano.' >&2; exit 1; }
existing_provider=$(gcloud iam workload-identity-pools providers list --project="$GCP_PROJECT_ID" --location=global --workload-identity-pool="$POOL_ID" --filter="name=${provider_name}" --format='value(name)')
if [[ -z "$existing_provider" ]]; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" --project="$GCP_PROJECT_ID" --location=global --workload-identity-pool="$POOL_ID" --issuer-uri="$ISSUER" --allowed-audiences="$AUDIENCE" --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION" --display-name='Vercel PROHOUS production' --quiet
elif [[ "$existing_provider" != "$provider_name" ]]; then
  printf '%s\n' 'Niejednoznaczny provider. Zatrzymano bez zmiany uprawnień.' >&2; exit 1
fi
# Nie modyfikuj istniejącego providera ani nie poszerzaj jego polityki.
metadata_file=$(mktemp)
trap 'rm -f "$metadata_file"' EXIT
gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" --project="$GCP_PROJECT_ID" --location=global --workload-identity-pool="$POOL_ID" --format=json > "$metadata_file"
python3 - "$metadata_file" "$ISSUER" "$AUDIENCE" "$CONDITION" "$MAPPING" <<'PY'
import json,sys
path,issuer,audience,condition,mapping=sys.argv[1:]
with open(path) as f: provider=json.load(f)
expected=dict(item.split('=',1) for item in mapping.split(','))
if not (provider.get('state')=='ACTIVE' and provider.get('oidc',{}).get('issuerUri')==issuer and provider.get('oidc',{}).get('allowedAudiences')==[audience] and provider.get('attributeCondition')==condition and provider.get('attributeMapping')==expected):
    raise SystemExit('Istniejący provider ma inną konfigurację. Zatrzymano bez zmiany polityki.')
PY
principal="principal://iam.googleapis.com/${pool_name}/subject/${SUBJECT}"
gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT" --project="$GCP_PROJECT_ID" --role='roles/iam.workloadIdentityUser' --member="$principal" --quiet >/dev/null
# Wyświetlane wartości są publicznymi identyfikatorami; nie są tokenami ani kluczami.
printf '\n%s\n' 'GOTOWE. Przekaż do konfiguracji Vercel tylko tę wartość:'
printf 'GCP_WORKLOAD_IDENTITY_AUDIENCE=//iam.googleapis.com/%s\n' "$provider_name"
printf '%s\n' 'Udostępnij kontu usługi wybrane foldery Google Drive jako Przeglądający.'
