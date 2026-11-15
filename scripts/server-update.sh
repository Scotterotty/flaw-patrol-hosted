#!/usr/bin/env bash
# Flaw Patrol's update helper (ver_239). It runs on the server, beside docker-compose.hosting.yml,
# and does what Workspace settings -> Updates asks for: get the new code, back up the database,
# rebuild Flaw Patrol and restart it.
#
# Flaw Patrol itself never touches Docker. Its Update button only leaves a short note in the
# server-update folder, and this script only ever runs the fixed steps below; nothing in the
# note is run as a command.
#
# install copies this script to /usr/local/libexec/flaw-patrol-updater and the service runs that
# copy, so systemd (and SELinux) will start it wherever the code lives. If an update changes this
# script, run install again to use the new one; Flaw Patrol says so when it happens.
#
#   sudo scripts/server-update.sh install     set it up as a service that starts with the server
#   sudo scripts/server-update.sh uninstall   remove the service (your code and data stay)
#   scripts/server-update.sh run              run it in this window instead (Ctrl+C stops it)
#   scripts/server-update.sh check            look for new code once and say what's there
#   scripts/server-update.sh update           update once, right now
#
# Settings (all optional), as environment variables or in the service file:
#   FP_REMOTE=origin  FP_BRANCH=main            where new code comes from
#   FP_COMPOSE_FILE=docker-compose.hosting.yml
#   FP_BACKUP=1  FP_KEEP_BACKUPS=5              database backup before each update, in ./backups
#   FP_BACKUP_TRIES=5  FP_BACKUP_WAIT=15        tries (and seconds between) when the database is busy
#   FP_DOCKER_CLEANUP=1                         clear unused old images and week-old build cache each update
#   FP_CHECK_EVERY=300                          seconds between looks for new code
#   FP_ROOT=/path/to/flaw-patrol                the code folder (install sets this for the service)
set -uo pipefail

# The installed copy lives outside the code folder, so it's told where the code is (FP_ROOT).
# Run from the code folder, it works that out itself.
if [ -n "${FP_ROOT:-}" ]; then
  ROOT=$FP_ROOT
else
  ROOT=$(cd "$(dirname "$0")/.." && pwd)
fi
cd "$ROOT" || exit 1
if [ ! -e "$ROOT/.git" ]; then
  echo "$ROOT isn't Flaw Patrol's code folder. Run scripts/server-update.sh from the code, or set FP_ROOT." >&2
  exit 1
fi

REMOTE=${FP_REMOTE:-origin}
BRANCH=${FP_BRANCH:-main}
COMPOSE_FILE=${FP_COMPOSE_FILE:-docker-compose.hosting.yml}
CHANNEL=${FP_CHANNEL:-$ROOT/server-update}
BACKUPS=${FP_BACKUPS:-$ROOT/backups}
BACKUP=${FP_BACKUP:-1}
KEEP_BACKUPS=${FP_KEEP_BACKUPS:-5}
BACKUP_TRIES=${FP_BACKUP_TRIES:-5}
BACKUP_WAIT=${FP_BACKUP_WAIT:-15}
CHECK_EVERY=${FP_CHECK_EVERY:-300}
DOCKER_CLEANUP=${FP_DOCKER_CLEANUP:-1}
APP=${FP_APP_CONTAINER:-flaw-patrol}
# The Flaw Patrol container runs as this user and group (see Dockerfile); it must be able to
# leave its note in the server-update folder.
APP_GID=1001
UNIT=/etc/systemd/system/flaw-patrol-updater.service
# The copy the service runs, and the script in the code it's copied from.
HELPER=/usr/local/libexec/flaw-patrol-updater
REPO_SCRIPT=$ROOT/scripts/server-update.sh

git_() { git -c safe.directory="$ROOT" "$@"; }
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# One line, no tabs, not too long: the status file is key=value lines.
oneline() { printf '%s' "$1" | tr '\r\n\t' '   ' | cut -c1-400; }
version_at() { git_ show "$1:package.json" 2>/dev/null | sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' | head -n1; }
say() { echo "[$(date '+%H:%M:%S')] $*"; }
# Docker's leftovers (ver_262). Every build leaves the old image and its build cache behind, and
# after enough updates the disk fills and the next build fails partway ("no space left on device").
# Only images nothing uses (no tag, no container; on a shared server, other apps' too) and build
# cache go: running containers, the database and its data are never touched. "all" clears every bit of build cache, for when the disk is full.
clean_docker() {
  [ "$DOCKER_CLEANUP" = 1 ] || return 0
  echo "== Clearing Docker's leftovers (old images and build cache)" >>"$CHANNEL/update.log"
  docker image prune -f >>"$CHANNEL/update.log" 2>&1 || true
  if [ "${1:-}" = all ]; then
    docker builder prune -f >>"$CHANNEL/update.log" 2>&1 || true
  else
    docker builder prune -f --filter until=168h >>"$CHANNEL/update.log" 2>&1 || true
  fi
}
disk_full() { tail -n 200 "$CHANNEL/update.log" | grep -qi "no space left on device"; }

# True when the service's copy is older than the script in the code (an update changed it).
helper_outdated() { [ -f "$HELPER" ] && [ -f "$REPO_SCRIPT" ] && ! cmp -s "$HELPER" "$REPO_SCRIPT"; }

# ---- The status file Flaw Patrol reads ---------------------------------------------------------
STATE=idle RUN_ID="" STEP="" MESSAGE="" STARTED="" FINISHED="" FROM="" TO="" BACKUP_FILE="" BY=""

load_status() {
  [ -f "$CHANNEL/status" ] || return 0
  local key value
  while IFS='=' read -r key value; do
    case "$key" in
      state) STATE=$value ;; id) RUN_ID=$value ;; step) STEP=$value ;; message) MESSAGE=$value ;;
      started) STARTED=$value ;; finished) FINISHED=$value ;; from) FROM=$value ;; to) TO=$value ;;
      backup) BACKUP_FILE=$value ;; by) BY=$value ;;
    esac
  done <"$CHANNEL/status"
  # A run that was cut off (the server restarted mid-update) can't still be going.
  if [ "$STATE" = updating ]; then
    STATE=failed MESSAGE="The update helper stopped partway through. Check that Flaw Patrol is running, then update again." FINISHED=$(now)
  fi
}

# Written whole, then moved into place, so Flaw Patrol never reads half a file.
write_status() {
  local tmp="$CHANNEL/.status.tmp"
  {
    echo "state=$STATE"
    echo "id=$RUN_ID"
    echo "by=$(oneline "$BY")"
    echo "step=$(oneline "$STEP")"
    echo "message=$(oneline "$MESSAGE")"
    echo "started=$STARTED"
    echo "finished=$FINISHED"
    echo "from=$FROM"
    echo "to=$TO"
    echo "backup=$(oneline "$BACKUP_FILE")"
    echo "seen=$(now)"
  } >"$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$CHANNEL/status"
}

step() {
  STEP=$1
  say "$1"
  echo "== $1" >>"$CHANNEL/update.log"
  write_status
}

fail() {
  STATE=failed MESSAGE=$1 FINISHED=$(now)
  say "Failed: $1"
  echo "== Failed: $1" >>"$CHANNEL/update.log"
  write_status
}

# ---- Looking for new code ----------------------------------------------------------------------
check() {
  local target="$REMOTE/$BRANCH" tmp="$CHANNEL/.remote.tmp" err
  if ! err=$(git_ fetch --quiet "$REMOTE" "$BRANCH" 2>&1); then
    { echo "checked=$(now)"; echo "error=$(oneline "Couldn't reach GitHub: $err")"; } >"$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$CHANNEL/remote"
    say "Couldn't get new code: $err"
    return 1
  fi
  {
    echo "checked=$(now)"
    echo "current=$(version_at HEAD)"
    echo "currentCommit=$(git_ rev-parse --short HEAD)"
    echo "latest=$(version_at "$target")"
    echo "latestCommit=$(git_ rev-parse --short "$target")"
    echo "behind=$(git_ rev-list --count "HEAD..$target")"
    echo "ahead=$(git_ rev-list --count "$target..HEAD")"
    echo "changed=$(git_ status --porcelain --untracked-files=no | awk '{print $2}' | paste -sd' ' -)"
    echo "error="
  } >"$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$CHANNEL/remote"
  # What's coming: commit summaries, and any database changes in it.
  git_ log --no-merges --format='%h%x09%s' -n 40 "HEAD..$target" >"$CHANNEL/.commits.tmp" && chmod 644 "$CHANNEL/.commits.tmp" && mv -f "$CHANNEL/.commits.tmp" "$CHANNEL/commits"
  git_ diff --name-only HEAD "$target" -- prisma/migrations | sed -n 's#^prisma/migrations/\([^/]*\)/migration\.sql$#\1#p' >"$CHANNEL/.migrations.tmp" && chmod 644 "$CHANNEL/.migrations.tmp" && mv -f "$CHANNEL/.migrations.tmp" "$CHANNEL/migrations"
  say "Running $(version_at HEAD); $REMOTE/$BRANCH has $(version_at "$target") ($(git_ rev-list --count "HEAD..$target") new commits)"
}

# ---- Updating ----------------------------------------------------------------------------------
health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP" 2>/dev/null; }

update() {
  RUN_ID=${1:-manual} BY=${2:-} STATE=updating STARTED=$(now) FINISHED="" MESSAGE="" BACKUP_FILE="" TO=""
  FROM=$(version_at HEAD)
  : >"$CHANNEL/update.log"
  chmod 644 "$CHANNEL/update.log"
  local target="$REMOTE/$BRANCH" old
  old=$(git_ rev-parse HEAD)

  step "Getting the new code"
  if ! git_ fetch "$REMOTE" "$BRANCH" >>"$CHANNEL/update.log" 2>&1; then
    fail "Couldn't get the new code from GitHub, so nothing was changed. Check the server's deploy key (see the log)."
    return 1
  fi
  TO=$(version_at "$target")
  if [ "$(git_ rev-list --count "HEAD..$target")" = 0 ]; then
    STATE=done MESSAGE="Already up to date on $FROM." FINISHED=$(now) STEP=""
    write_status
    check
    return 0
  fi

  if [ "$BACKUP" = 1 ]; then
    step "Backing up the database"
    mkdir -p "$BACKUPS"
    local file
    file="$BACKUPS/flawpatrol-$(date -u +%Y%m%d-%H%M%S)-${FROM:-unknown}.dump"
    # A busy database ("too many clients") usually frees a slot within a minute, so try a few times.
    local tries=0
    until compose exec -T db pg_dump -U flawpatrol -Fc flawpatrol >"$file" 2>>"$CHANNEL/update.log" && [ -s "$file" ]; do
      rm -f "$file"
      tries=$((tries + 1))
      if [ "$tries" -ge "$BACKUP_TRIES" ]; then
        if grep -q "too many clients" "$CHANNEL/update.log"; then
          fail "Couldn't back up the database because it's out of connections, so nothing was changed. Restart Flaw Patrol on the server (docker restart $APP) and press Update now again."
        else
          fail "Couldn't back up the database, so nothing was changed. See the log."
        fi
        return 1
      fi
      echo "== The backup didn't work, trying again in ${BACKUP_WAIT}s ($tries of $BACKUP_TRIES)" >>"$CHANNEL/update.log"
      write_status
      sleep "$BACKUP_WAIT"
    done
    chmod 600 "$file"
    BACKUP_FILE=$file
    # Keep the newest few.
    ls -1t "$BACKUPS"/flawpatrol-*.dump 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f
  fi

  step "Moving to the new code"
  if ! git_ merge --ff-only "$target" >>"$CHANNEL/update.log" 2>&1; then
    fail "The server's copy of the code has its own changes, so the new code couldn't be added. Nothing was changed. See the log."
    return 1
  fi

  step "Building $TO (about 4 minutes)"
  clean_docker
  local built=0
  if compose build flaw-patrol >>"$CHANNEL/update.log" 2>&1; then
    built=1
  elif [ "$DOCKER_CLEANUP" = 1 ] && disk_full; then
    # The disk filled up partway: clear all the build cache and try once more.
    echo "== The server's disk is full. Clearing all Docker build cache and building again." >>"$CHANNEL/update.log"
    step "Disk was full, building $TO again"
    clean_docker all
    compose build flaw-patrol >>"$CHANNEL/update.log" 2>&1 && built=1
  fi
  if [ "$built" != 1 ]; then
    local full=0
    disk_full && full=1
    git_ reset --keep "$old" >>"$CHANNEL/update.log" 2>&1
    if [ "$full" = 1 ]; then
      fail "$TO didn't build because the server's disk is full, so $FROM is still running and the code is back where it was. Free up space on the server (df -h shows how much is left; see the README), then press Update now again."
    else
      fail "$TO didn't build, so $FROM is still running and the code is back where it was. See the log."
    fi
    return 1
  fi

  step "Restarting Flaw Patrol"
  if ! compose up -d flaw-patrol >>"$CHANNEL/update.log" 2>&1; then
    fail "Docker couldn't start $TO. See the log."
    return 1
  fi

  step "Waiting for $TO to open"
  local waited=0 h=""
  sleep 5
  while [ "$waited" -lt 600 ]; do
    h=$(health)
    case "$h" in
      healthy) break ;;
      unhealthy | exited | dead) break ;;
    esac
    sleep 5
    waited=$((waited + 5))
  done
  docker logs --tail 80 "$APP" >>"$CHANNEL/update.log" 2>&1
  if [ "$h" != healthy ]; then
    fail "$TO started but isn't answering ($h). The database backup from before is in ${BACKUP_FILE:-the backups folder}. See the log."
    return 1
  fi

  # The image $FROM ran from is unused now: clear it so updates don't slowly fill the disk.
  clean_docker
  STATE=done MESSAGE="Updated from $FROM to $TO." FINISHED=$(now) STEP=""
  # The service keeps running its installed copy until someone reinstalls it on purpose.
  if helper_outdated; then
    MESSAGE="$MESSAGE This update also changed the update helper. To use the new one, run on the server: sudo scripts/server-update.sh install"
    echo "== The update helper changed. Run: sudo $REPO_SCRIPT install" >>"$CHANNEL/update.log"
  fi
  say "$MESSAGE"
  write_status
  check
}

# ---- The server-update folder ------------------------------------------------------------------
prepare() {
  mkdir -p "$CHANNEL" || { echo "Couldn't make $CHANNEL" >&2; exit 1; }
  if [ "$(id -u)" = 0 ]; then
    # Owned by whoever owns the code, writable by the Flaw Patrol container's group.
    chown "$(stat -c %u "$ROOT")":"$APP_GID" "$CHANNEL" && chmod 2775 "$CHANNEL"
  elif [ "$(stat -c %g "$CHANNEL")" != "$APP_GID" ]; then
    say "Note: Flaw Patrol can't leave notes in $CHANNEL yet. Run: sudo $REPO_SCRIPT install"
  fi
}

read_request() {
  # Only two plain words are read from the note: what to do, and an id made of letters, numbers and dashes.
  REQ_KIND=$(sed -n 's/^kind=\(update\|check\)$/\1/p' "$CHANNEL/request" | head -n1)
  REQ_ID=$(sed -n 's/^id=\([A-Za-z0-9-]\{1,64\}\)$/\1/p' "$CHANNEL/request" | head -n1)
  REQ_BY=$(sed -n 's/^by=\(.*\)$/\1/p' "$CHANNEL/request" | head -n1 | tr -cd 'A-Za-z0-9 .@_+-' | cut -c1-120)
  rm -f "$CHANNEL/request"
}

run() {
  prepare
  load_status
  write_status
  say "Watching $CHANNEL. Flaw Patrol's Update button works while this runs."
  if helper_outdated; then
    say "Note: the code has a newer update helper than the one running. Run: sudo $REPO_SCRIPT install"
  fi
  local last=0 t
  while true; do
    if [ -f "$CHANNEL/request" ]; then
      read_request
      case "$REQ_KIND" in
        update) say "Update asked for by ${REQ_BY:-someone}"; update "$REQ_ID" "$REQ_BY"; last=$(date +%s) ;;
        check) check; last=$(date +%s) ;;
      esac
    fi
    t=$(date +%s)
    if [ $((t - last)) -ge "$CHECK_EVERY" ]; then
      check
      last=$t
    fi
    write_status
    sleep 5
  done
}

# Named install_helper, not install, so it doesn't hide the system 'install' command it uses.
install_helper() {
  [ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo $REPO_SCRIPT install" >&2; exit 1; }
  command -v docker >/dev/null || { echo "Docker isn't installed on this server." >&2; exit 1; }
  command -v systemctl >/dev/null || { echo "This server has no systemd. Run '$REPO_SCRIPT run' under your own process manager instead." >&2; exit 1; }
  [ -f "$REPO_SCRIPT" ] || { echo "Couldn't find $REPO_SCRIPT." >&2; exit 1; }
  local owner
  owner=$(stat -c %U "$ROOT")
  if [ "$owner" != root ] && ! id -nG "$owner" | tr ' ' '\n' | grep -qx docker; then
    echo "$owner owns the code but isn't in the docker group. Run: sudo usermod -aG docker $owner, then install again." >&2
    exit 1
  fi
  if ! sudo -u "$owner" git -C "$ROOT" ls-remote --exit-code "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
    echo "Warning: $owner can't reach $REMOTE/$BRANCH yet. Add the deploy key (README: Update button), then try '$REPO_SCRIPT check'." >&2
  fi
  prepare

  # Copy the helper somewhere systemd is allowed to run it from. On SELinux servers, files in a
  # data folder (like /mnt/data) usually can't be started by systemd; /usr/local/libexec can.
  mkdir -p "$(dirname "$HELPER")"
  command install -m 0755 -o root -g root "$REPO_SCRIPT" "$HELPER" || { echo "Couldn't copy the helper to $HELPER." >&2; exit 1; }
  if command -v restorecon >/dev/null; then
    restorecon "$HELPER"
  fi

  cat >"$UNIT" <<EOF
[Unit]
Description=Flaw Patrol update helper (Workspace settings, Updates)
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=$owner
Environment="FP_ROOT=$ROOT"
WorkingDirectory=$ROOT
ExecStart=$HELPER run
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable flaw-patrol-updater
  # restart, not start, so installing again picks up a new copy of the helper.
  systemctl restart flaw-patrol-updater
  echo
  echo "Done. The update helper is running as $owner and starts with the server."
  echo "If Flaw Patrol was started before this, restart it once so it sees the folder:"
  echo "  docker compose -f $COMPOSE_FILE up -d"
  echo "Its log: journalctl -u flaw-patrol-updater -f"
}

uninstall() {
  [ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo $REPO_SCRIPT uninstall" >&2; exit 1; }
  systemctl disable --now flaw-patrol-updater 2>/dev/null
  rm -f "$UNIT" "$HELPER"
  systemctl daemon-reload
  echo "Removed the update helper. Flaw Patrol, its code and its data are untouched."
}

case "${1:-}" in
  install) install_helper ;;
  uninstall) uninstall ;;
  run) run ;;
  check) prepare; check ;;
  update) prepare; load_status; update manual "$(id -un)" ;;
  *) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
