#!/bin/bash
# Installs the latest Northshell into /Applications:
#   curl -fsSL https://raw.githubusercontent.com/nikserbur/northshell/main/scripts/install.sh | bash
# Files fetched with curl get no quarantine flag, so macOS doesn't block the app on first launch.
# NORTHSHELL_INSTALL_DIR picks another folder; NORTHSHELL_NO_OPEN=1 leaves the app closed afterwards.
set -euo pipefail

REPO="nikserbur/northshell"
APP="Northshell"

fail() {
  echo "Northshell: $1" >&2
  exit 1
}

# Everything runs from here, so a download cut off half way cannot run half a script.
main() {
  [ "$(uname -s)" = Darwin ] || fail "this is a macOS app."
  [ "$(uname -m)" = arm64 ] || fail "the published build needs Apple Silicon; on an Intel Mac build it from source."

  local dest="${NORTHSHELL_INSTALL_DIR:-/Applications}"
  mkdir -p "$dest" 2>/dev/null || fail "cannot create $dest."
  [ -w "$dest" ] || fail "cannot write to $dest. Try: NORTHSHELL_INSTALL_DIR=~/Applications, or use an administrator account."
  if pgrep -x "$APP" >/dev/null 2>&1 && [ "$dest" = /Applications ]; then
    fail "quit Northshell first, then run this again."
  fi

  local work mount=""
  work="$(mktemp -d)"
  mount="$work/mnt"
  mkdir "$mount"
  # shellcheck disable=SC2064 # expand now: these locals are gone when the trap fires
  trap "hdiutil detach '$mount' -quiet -force >/dev/null 2>&1 || true; rm -rf '$work'" EXIT

  local latest version file base
  latest="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")"
  version="${latest##*/v}"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "could not find the latest version."
  file="$APP-$version-arm64.dmg"
  base="https://github.com/$REPO/releases/download/v$version"

  echo "Downloading Northshell $version…"
  curl -fL --progress-bar -o "$work/$file" "$base/$file"
  curl -fsSL -o "$work/SHA256SUMS.txt" "$base/SHA256SUMS.txt"

  echo "Checking the download…"
  local expected actual
  expected="$(awk -v f="$file" '$2 == f { print $1 }' "$work/SHA256SUMS.txt")"
  actual="$(shasum -a 256 "$work/$file" | awk '{ print $1 }')"
  [ -n "$expected" ] || fail "the release has no checksum for $file."
  [ "$expected" = "$actual" ] || fail "the download does not match its checksum. Nothing was installed."

  echo "Installing into $dest…"
  hdiutil attach "$work/$file" -nobrowse -readonly -noautoopen -quiet -mountpoint "$mount"
  local fresh="$dest/.$APP-$version.app" target="$dest/$APP.app"
  rm -rf "$fresh"
  ditto "$mount/$APP.app" "$fresh"
  xattr -dr com.apple.quarantine "$fresh" 2>/dev/null || true
  rm -rf "$target"
  mv "$fresh" "$target"

  echo "Northshell $version is installed: $target"
  [ "${NORTHSHELL_NO_OPEN:-}" = 1 ] || open "$target"
}

main "$@"
