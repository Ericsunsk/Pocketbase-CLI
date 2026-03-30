#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${POCKETBASE_CLI_REPO_URL:-https://github.com/Ericsunsk/Pocketbase-CLI.git}"
BRANCH="${POCKETBASE_CLI_BRANCH:-main}"
INSTALL_DIR="${POCKETBASE_CLI_INSTALL_DIR:-$HOME/.local/share/pocketbase-cli}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_command git
require_command node
require_command npm

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "${node_major}" -lt 20 ]]; then
  printf 'PocketBase CLI requires Node.js 20+. Found %s\n' "$(node -v)" >&2
  exit 1
fi

mkdir -p "$(dirname "${INSTALL_DIR}")"

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  printf 'Updating existing checkout at %s\n' "${INSTALL_DIR}"
  git -C "${INSTALL_DIR}" fetch origin "${BRANCH}" --depth 1
  git -C "${INSTALL_DIR}" checkout "${BRANCH}"
  git -C "${INSTALL_DIR}" reset --hard "origin/${BRANCH}"
else
  rm -rf "${INSTALL_DIR}"
  git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

npm run build

global_prefix="$(npm prefix -g 2>/dev/null || true)"
if [[ -n "${global_prefix}" && -d "${global_prefix}" && -w "${global_prefix}" ]]; then
  npm install -g .
else
  global_prefix="${POCKETBASE_CLI_NPM_PREFIX:-$HOME/.local}"
  mkdir -p "${global_prefix}"
  npm install -g . --prefix "${global_prefix}"
fi

global_bin="${global_prefix}/bin"

printf '\nInstalled PocketBase CLI.\n'
printf 'Command: pocketbase-cli\n'
printf 'Checkout: %s\n' "${INSTALL_DIR}"
printf 'Global npm prefix: %s\n' "${global_prefix}"

if [[ ":$PATH:" == *":${global_bin}:"* ]]; then
  printf 'Try: pocketbase-cli --help\n'
else
  printf 'Add this to your shell profile and restart the shell:\n'
  printf 'export PATH="%s:$PATH"\n' "${global_bin}"
  printf 'Then run: pocketbase-cli --help\n'
fi
