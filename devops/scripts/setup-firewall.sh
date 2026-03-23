#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Firewall & Fail2ban Setup — Server hardening
# ============================================================
# Configures UFW firewall and fail2ban on the cloud server.
# Only allows: SSH (22), HTTP (80), HTTPS (443), and app ports.
#
# Usage: setup-firewall.sh
# ============================================================

if [[ -z "${DEPLOY_SERVER:-}" ]]; then
  echo "ERROR: DEPLOY_SERVER not set"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

echo "=== FIREWALL SETUP ==="
echo "Server: ${DEPLOY_SERVER}"

# --- Install and configure UFW ---
echo ""
echo "Configuring UFW firewall..."

ssh "${DEPLOY_SERVER}" "
  # Install UFW if not present
  apt-get install -y -qq ufw fail2ban 2>/dev/null || true

  # Reset rules
  ufw --force reset 2>/dev/null || true

  # Default policies
  ufw default deny incoming
  ufw default allow outgoing

  # Allow SSH (IMPORTANT: do this before enabling!)
  ufw allow 22/tcp

  # Allow HTTP and HTTPS
  ufw allow 80/tcp
  ufw allow 443/tcp

  # Allow app ports (3001-3100 range for portal apps)
  # Only needed for direct health checks from Mac mini
  ufw allow 3001:3100/tcp

  # Enable firewall
  echo 'y' | ufw enable 2>/dev/null || true
  ufw status
" 2>/dev/null

echo "  [OK] UFW configured"

# --- Configure fail2ban ---
echo ""
echo "Configuring fail2ban..."

ssh "${DEPLOY_SERVER}" "
  # Create jail configuration
  cat > /etc/fail2ban/jail.local << 'F2B'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
action = %(action_)s

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 7200

[nginx-http-auth]
enabled = true
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 5
bantime = 3600
F2B

  # Restart fail2ban
  systemctl enable fail2ban 2>/dev/null || true
  systemctl restart fail2ban 2>/dev/null || true
  echo 'fail2ban configured'

  # Show status
  fail2ban-client status 2>/dev/null || echo 'fail2ban not fully started yet'
" 2>/dev/null

echo "  [OK] fail2ban configured"
echo ""
echo "=== FIREWALL SETUP COMPLETE ==="
echo ""
echo "Rules:"
echo "  SSH (22):       allowed"
echo "  HTTP (80):      allowed"
echo "  HTTPS (443):    allowed"
echo "  Apps (3001-3100): allowed"
echo "  Everything else: denied"
echo ""
echo "Fail2ban:"
echo "  SSH: ban after 3 failures (2 hour ban)"
echo "  Nginx auth: ban after 5 failures (1 hour ban)"
