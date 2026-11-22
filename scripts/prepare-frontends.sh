#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARD_DIR="$ROOT_DIR/dashboard"
TEMPLATES_FILE="$DASHBOARD_DIR/service/singleton/frontend-templates.yaml"

MODE="all"
for arg in "$@"; do
  case "$arg" in
    --local-only)
      MODE="local-only"
      ;;
    --community-only)
      MODE="community-only"
      ;;
    --all)
      MODE="all"
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [--all | --local-only | --community-only]" >&2
      exit 1
      ;;
  esac
done

copy_local_dist() {
  local src="$1"
  local dst="$2"

  if [[ ! -f "$src/index.html" ]]; then
    echo "Error: missing $src/index.html. Build the frontend first." >&2
    exit 1
  fi

  rm -rf "$dst"
  mkdir -p "$dst"
  cp -a "$src"/. "$dst"/
  touch "$dst/.gitkeep"
}

download_community_theme() {
  local repository="$1"
  local version="$2"
  local target_dir="$3"
  local tmp_dir

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' RETURN

  echo "Downloading community theme: $repository ($version) -> $target_dir"
  curl -fsSL -o "$tmp_dir/dist.zip" "$repository/releases/download/$version/dist.zip"
  unzip -q "$tmp_dir/dist.zip" -d "$tmp_dir/extracted"

  rm -rf "$target_dir"
  if [[ -d "$tmp_dir/extracted/dist" ]]; then
    mv "$tmp_dir/extracted/dist" "$target_dir"
  else
    mv "$tmp_dir/extracted" "$target_dir"
  fi
}

if [[ "$MODE" == "all" || "$MODE" == "local-only" ]]; then
  echo "Syncing local frontend-user -> dashboard/cmd/dashboard/user-dist"
  copy_local_dist "$ROOT_DIR/frontend-user/dist" "$DASHBOARD_DIR/cmd/dashboard/user-dist"

  echo "Syncing local frontend-admin -> dashboard/cmd/dashboard/admin-dist"
  copy_local_dist "$ROOT_DIR/frontend-admin/dist" "$DASHBOARD_DIR/cmd/dashboard/admin-dist"
fi

if [[ "$MODE" == "all" || "$MODE" == "community-only" ]]; then
  if ! command -v yq >/dev/null 2>&1; then
    echo "Error: yq is required to download community themes." >&2
    exit 1
  fi

  count=$(yq eval '. | length' "$TEMPLATES_FILE")
  for i in $(seq 0 $((count - 1))); do
    path=$(yq -r ".[$i].path" "$TEMPLATES_FILE")
    repository=$(yq -r ".[$i].repository" "$TEMPLATES_FILE")
    version=$(yq -r ".[$i].version" "$TEMPLATES_FILE")

    # Never overwrite our locally built admin-dist and user-dist
    if [[ "$path" == "admin-dist" || "$path" == "user-dist" ]]; then
      continue
    fi

    if [[ -n "$path" && -n "$repository" && -n "$version" ]]; then
      download_community_theme "$repository" "$version" "$DASHBOARD_DIR/cmd/dashboard/$path"
    fi
  done
fi

echo "Frontend assets prepared successfully."
