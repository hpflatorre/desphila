#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$project_root/manifest.json" | head -n 1)"
if [[ -z "$version" || ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Versão inválida no manifest.json" >&2
  exit 1
fi

package_root="$(mktemp -d)"
archive_root="$(mktemp -d)"
temporary_archive="$archive_root/desphila-$version.zip"
trap 'rm -rf "$package_root" "$archive_root"' EXIT

cp "$project_root/manifest.json" "$project_root/INSTALLATION.md" "$project_root/README.md" "$project_root/PRIVACY.md" "$project_root/SECURITY.md" "$project_root/LICENSE" "$package_root/"
cp -R "$project_root/src" "$package_root/src"
cp -R "$project_root/assets" "$package_root/assets"

mkdir -p "$project_root/dist"
(cd "$package_root" && zip -q -r "$temporary_archive" manifest.json INSTALLATION.md README.md PRIVACY.md SECURITY.md LICENSE assets src)
mv "$temporary_archive" "$project_root/dist/desphila-$version.zip"
echo "$project_root/dist/desphila-$version.zip"
