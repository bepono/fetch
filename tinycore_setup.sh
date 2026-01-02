#!/bin/sh
# TinyCore Linux: isolate desktop tooling with per-app namespaces and a minimal web control page
# - Installs required packages via tce-load
# - Creates lightweight sandboxes for each desktop app using unshare + chroot overlays
# - Starts an Openbox session that launches Chromium inside its own namespace
# - Serves a local control page with buttons to add/remove other one-time tools, always wrapped in isolation

set -euo pipefail

# Location for extensions and writable overlays
TCE_DIR="/tmp/tce"                 # cache of downloaded extensions
OVERLAY_ROOT="/var/lib/isolated"  # per-app writable layer
CONTROL_PORT=8081                  # port for the local control page

mkdir -p "$TCE_DIR" "$OVERLAY_ROOT" /usr/local/share/applications

# Helpers ------------------------------------------------------------------
install_pkg() {
  # Usage: install_pkg <extension>
  # Ensures an extension is installed once; TinyCore keeps it lightweight.
  local pkg="$1"
  if [ ! -f "/usr/local/tce.installed/$pkg" ]; then
    tce-load -wic "$pkg"
  fi
}

make_overlay_root() {
  # Usage: make_overlay_root <name>
  # Creates a writable root for an app using tmpfs + symlinks.
  local name="$1"
  local root="$OVERLAY_ROOT/$name"
  mkdir -p "$root/{upper,work,rootfs}"
  echo "$root"
}

run_isolated() {
  # Usage: run_isolated <name> <cmd...>
  # Launches a command inside its own namespaces with a minimal overlay root.
  local name="$1"; shift
  local root
  root=$(make_overlay_root "$name")

  # Mount an overlay rootfs that reuses the host base as lowerdir (read-only).
  # This keeps images tiny while giving each app its own writable layer.
  unshare --mount --uts --ipc --net --pid --fork --user --map-root-user \
    sh -c "\
      mount -t tmpfs tmpfs $root/rootfs && \
      mkdir -p $root/rootfs/{upper,work,merged} && \
      mount -t overlay overlay -olowerdir=/,upperdir=$root/rootfs/upper,workdir=$root/rootfs/work $root/rootfs/merged && \
      mount -t proc proc $root/rootfs/merged/proc && \
      mount -t sysfs sysfs $root/rootfs/merged/sys && \
      mount --bind /dev $root/rootfs/merged/dev && \
      mount --bind /run $root/rootfs/merged/run && \
      cd $root/rootfs/merged && chroot $root/rootfs/merged "$*""
}

# Base system ----------------------------------------------------------------
install_pkg Xorg-7.7
install_pkg Xprogs
install_pkg xorg-server
install_pkg xf86-video-fbdev
install_pkg xf86-input-libinput
install_pkg openbox
install_pkg dbus
install_pkg chromium
install_pkg code
install_pkg iptables
install_pkg iproute2
install_pkg lighttpd
install_pkg curl

# Network namespace dedicated to Chromium ----------------------------------
setup_chrome_netns() {
  ip netns add chrome-ns 2>/dev/null || true
  ip link add veth0 type veth peer name veth1 2>/dev/null || true
  ip link set veth0 netns chrome-ns
  ip addr add 10.200.1.1/24 dev veth1 2>/dev/null || true
  ip link set veth1 up
  ip netns exec chrome-ns ip addr add 10.200.1.2/24 dev veth0 2>/dev/null || true
  ip netns exec chrome-ns ip link set veth0 up
  ip netns exec chrome-ns ip link set lo up

  echo 1 > /proc/sys/net/ipv4/ip_forward
  iptables -t nat -C POSTROUTING -s 10.200.1.0/24 -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -s 10.200.1.0/24 -j MASQUERADE

  # Default DROP, allow only Chrome path to OpenAI (replace IP as needed)
  iptables -F
  iptables -P INPUT DROP
  iptables -P OUTPUT DROP
  iptables -P FORWARD DROP
  iptables -A INPUT -i lo -j ACCEPT
  iptables -A OUTPUT -o lo -j ACCEPT
  iptables -A FORWARD -s 10.200.1.2 -d 104.18.12.123 -j ACCEPT
}

# X session that launches isolated apps ------------------------------------
cat > /home/tc/.xinitrc <<'EOF_XINIT'
#!/bin/sh
openbox &
# Chromium runs in its own network namespace
ip netns exec chrome-ns chromium --app=https://chat.openai.com/chat &
# VS Code (code) wrapped in an isolated mount/user namespace
tcloop=$(mktemp -d)
run_isolated codium code --disable-telemetry &
EOF_XINIT
chmod +x /home/tc/.xinitrc
chown tc:staff /home/tc/.xinitrc

# Lightweight control UI ----------------------------------------------------
CONTROL_ROOT=/var/www/localhost/htdocs/isolated
mkdir -p "$CONTROL_ROOT"
cat > "$CONTROL_ROOT"/index.html <<'EOF_HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Isolated Tool Launcher</title>
  <style>
    body { font-family: sans-serif; margin: 2rem; background: #f4f6fb; color: #1c2333; }
    h1 { margin-top: 0; }
    .tools { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
    .card { background: #fff; padding: 1rem; border-radius: 0.75rem; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
    button { padding: 0.5rem 0.75rem; border-radius: 0.5rem; border: 1px solid #d0d7e2; cursor: pointer; }
    button.primary { background: #0b6cff; color: #fff; border-color: #0b6cff; }
  </style>
</head>
<body>
  <h1>Isolated tool control</h1>
  <p>Launch or remove ephemeral tools. Every launch uses <code>unshare</code> + overlayfs to keep it contained.</p>
  <div class="tools" id="tools"></div>
  <script>
    const tools = [
      { id: 'chromium', label: 'Chromium (netns)', install: 'chromium', command: "ip netns exec chrome-ns chromium" },
      { id: 'code', label: 'VS Code', install: 'code', command: "run_isolated codium code --disable-telemetry" },
      { id: 'xterm', label: 'xterm', install: 'xterm', command: "run_isolated xterm xterm" },
      { id: 'dbus', label: 'DBus session', install: 'dbus', command: "run_isolated dbus dbus-launch" }
    ];

    const toolsContainer = document.getElementById('tools');
    tools.forEach(tool => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <strong>${tool.label}</strong><br />
        <small>${tool.command}</small><br />
        <div style="margin-top:0.75rem; display:flex; gap:0.5rem;">
          <button class="primary" onclick="fetch('/launch/' + '${tool.id}')">Launch isolated</button>
          <button onclick="fetch('/remove/' + '${tool.id}')">Remove overlay</button>
        </div>
      `;
      toolsContainer.appendChild(card);
    });
  </script>
</body>
</html>
EOF_HTML

cat > /etc/lighttpd/lighttpd.conf <<EOF_HTTP
server.document-root = "/var/www/localhost/htdocs"
server.port = $CONTROL_PORT
index-file.names = ("index.html")
EOF_HTTP

cat > /usr/local/bin/control-api <<'EOF_API'
#!/bin/sh
# Very small CGI shim: reacts to /launch/<tool> or /remove/<tool>
set -e
PATH_INFO=${PATH_INFO:-/}
ACTION=$(echo "$PATH_INFO" | awk -F/ '{print $2}')
TOOL=$(echo "$PATH_INFO" | awk -F/ '{print $3}')
OVERLAY_ROOT="/var/lib/isolated"

make_overlay_root() {
  local name="$1"
  local root="$OVERLAY_ROOT/$name"
  mkdir -p "$root/{upper,work,rootfs}"
  echo "$root"
}

run_isolated() {
  local name="$1"; shift
  local root cmd
  root=$(make_overlay_root "$name")
  cmd="$*"

  unshare --mount --uts --ipc --net --pid --fork --user --map-root-user sh -c "
    mount -t tmpfs tmpfs $root/rootfs &&
    mkdir -p $root/rootfs/{upper,work,merged} &&
    mount -t overlay overlay -olowerdir=/,upperdir=$root/rootfs/upper,workdir=$root/rootfs/work $root/rootfs/merged &&
    mount -t proc proc $root/rootfs/merged/proc &&
    mount -t sysfs sysfs $root/rootfs/merged/sys &&
    mount --bind /dev $root/rootfs/merged/dev &&
    mount --bind /run $root/rootfs/merged/run &&
    cd $root/rootfs/merged &&
    chroot $root/rootfs/merged $cmd
  " &
}

json() { printf 'Content-Type: application/json\n\n{"status":"%s"}\n' "$1"; }

case "$ACTION" in
  launch)
    case "$TOOL" in
      chromium) ip netns exec chrome-ns chromium --app=https://chat.openai.com/chat & json ok ;;
      code) run_isolated codium code --disable-telemetry & json ok ;;
      xterm) run_isolated xterm xterm & json ok ;;
      dbus) run_isolated dbus dbus-launch & json ok ;;
      *) json "unknown tool" ;;
    esac ;;
  remove)
    rm -rf "$OVERLAY_ROOT/$TOOL" && json "removed" || json "missing" ;;
  *) json "noop" ;;
esac
EOF_API
chmod +x /usr/local/bin/control-api

cat > /var/www/localhost/htdocs/index.html <<'EOF_ROOT'
<!doctype html>
<html><head><meta http-equiv="refresh" content="0; url=/isolated/index.html" /></head><body></body></html>
EOF_ROOT

setup_chrome_netns

# Start services
sudo -u tc lighttpd -f /etc/lighttpd/lighttpd.conf
sudo -u tc startx
