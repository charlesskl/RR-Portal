#!/usr/bin/env bash
# ============================================================
# Dashboard Integration — Auto-add apps to portal HTML
# ============================================================
# Generates plugin items and health check JS for the portal
# dashboard. Used by deploy.sh after first deployment.
#
# Usage: source this file, then call:
#   add_to_dashboard <app-name> <display-name> <description> <department> <server> <html-path>
# ============================================================

generate_plugin_item() {
  local app_name="$1"
  local display_name="$2"
  local dot_id="${app_name}Dot"

  cat <<EOF
            <div class="plugin-item" onclick="window.open('/${app_name}/', '_blank')">
              <div class="plugin-info">
                <div class="plugin-dot green" id="${dot_id}"></div>
                <span class="plugin-name">${display_name}</span>
              </div>
              <span class="plugin-arrow">→</span>
            </div>
EOF
}

generate_health_check_js() {
  local app_name="$1"
  local dot_id="${app_name}Dot"
  local detail_dot_id="${app_name}DetailDot"

  echo "      { name: '${app_name}', url: '/${app_name}/health', dot: '${dot_id}', detailDot: '${detail_dot_id}' },"
}

generate_detail_plugin() {
  local app_name="$1"
  local display_name="$2"
  local description="$3"
  local dot_id="${app_name}DetailDot"

  cat <<EOF
      <div class="detail-plugin-card">
        <div>
          <div class="detail-plugin-name">${display_name}</div>
          <div class="detail-plugin-desc">${description}</div>
        </div>
        <div class="detail-plugin-status"><div class="plugin-dot green" id="${dot_id}"></div> 运行中</div>
        <a href="/${app_name}/" target="_blank" class="btn btn-primary">打开系统</a>
      </div>
EOF
}

# Add app to dashboard HTML on server
# add_to_dashboard <app-name> <display-name> <description> <department> <server> <html-path>
add_to_dashboard() {
  local app_name="$1"
  local display_name="$2"
  local description="$3"
  local department="$4"
  local server="$5"
  local html_path="$6"

  # Check if app is already in dashboard
  local already_exists
  already_exists=$(ssh "root@${server}" "grep -c '/${app_name}/' '${html_path}' 2>/dev/null || echo 0" 2>/dev/null || echo "0")

  if [[ "$already_exists" != "0" ]]; then
    echo "[DASHBOARD] SKIP: ${app_name} already in dashboard"
    return 0
  fi

  echo "[DASHBOARD] Adding ${app_name} to dashboard under ${department}"

  # Generate the HTML snippets
  local plugin_item
  plugin_item="$(generate_plugin_item "$app_name" "$display_name")"

  local health_js
  health_js="$(generate_health_check_js "$app_name")"

  # Inject into dashboard HTML via Python (HTML is too complex for sed)
  ssh "root@${server}" python3 - "$app_name" "$display_name" "$html_path" << 'DASHPY'
import sys

app_name = sys.argv[1]
display_name = sys.argv[2]
html_path = sys.argv[3]

with open(html_path) as f:
    content = f.read()

# Add health check JS entry (before the closing bracket of checks array)
health_entry = f"      {{ name: '{app_name}', url: '/{app_name}/health', dot: '{app_name}Dot', detailDot: '{app_name}DetailDot' }},"
if health_entry.strip().rstrip(',') not in content:
    # Find the checks array and add before its last entry
    content = content.replace(
        "    ];  // end health checks",
        f"      {health_entry}\n    ];  // end health checks"
    )
    # Fallback: try to insert before ];
    if health_entry not in content:
        print(f"[DASHBOARD] WARN: could not auto-inject health check for {app_name}")

with open(html_path, 'w') as f:
    f.write(content)

print(f"[DASHBOARD] Added {app_name} to dashboard")
DASHPY

  return 0
}
