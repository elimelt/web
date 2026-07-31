#!/usr/bin/env bash
set -euo pipefail

repo_url="${GITHUB_RUNNER_REPO_URL:-}"
runner_name="${GITHUB_RUNNER_NAME:-$(hostname)}"
runner_labels="${GITHUB_RUNNER_LABELS:-backend}"
runner_workdir="${GITHUB_RUNNER_WORKDIR:-/runner/_work}"
runner_token="${GITHUB_RUNNER_TOKEN:-}"
runner_home="${GITHUB_RUNNER_HOME:-/runner}"

if [ -z "${repo_url}" ]; then
  echo "GITHUB_RUNNER_REPO_URL is required."
  exit 1
fi

mkdir -p "${runner_home}"

if [ ! -x "${runner_home}/config.sh" ]; then
  cp -a /opt/actions-runner/. "${runner_home}/"
fi

cd "${runner_home}"

if [ ! -f .runner ]; then
  if [ -z "${runner_token}" ]; then
    echo "GITHUB_RUNNER_TOKEN is required for first-time runner registration."
    exit 1
  fi

  ./config.sh \
    --url "${repo_url}" \
    --token "${runner_token}" \
    --name "${runner_name}" \
    --labels "${runner_labels}" \
    --work "${runner_workdir}" \
    --unattended \
    --replace
fi

cleanup() {
  if [ -n "${runner_token}" ]; then
    ./config.sh remove --token "${runner_token}" || true
  fi
}

trap cleanup TERM INT

./run.sh &
wait $!
