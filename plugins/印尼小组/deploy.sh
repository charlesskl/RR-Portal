#!/usr/bin/env bash
# ============================================
# 一键部署脚本 - 印尼出货明细资料核对系统
# 用法: ./deploy.sh --server 1.2.3.4
# ============================================
set -e

# ---------- 默认值 ----------
REGISTRY="${REGISTRY:-docker.io}"
IMAGE_NAME="${IMAGE_NAME:-charlesskl/shipment-checker}"
TAG=""
SERVER=""
SSH_USER="${DEPLOY_USER:-root}"
SSH_PORT="${DEPLOY_SSH_PORT:-22}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/shipment-checker}"

# ---------- 颜色输出 ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ---------- 加载 .env 文件 ----------
if [ -f .env.production ]; then
    info "加载 .env.production 配置..."
    export $(grep -v '^#' .env.production | grep -v '^\s*$' | xargs)
fi

# ---------- 解析参数 ----------
while [[ $# -gt 0 ]]; do
    case $1 in
        --server)   SERVER="$2";   shift 2 ;;
        --registry) REGISTRY="$2"; shift 2 ;;
        --tag)      TAG="$2";      shift 2 ;;
        --user)     SSH_USER="$2"; shift 2 ;;
        --port)     SSH_PORT="$2"; shift 2 ;;
        --help)
            echo "用法: ./deploy.sh --server <IP> [选项]"
            echo "  --server   远端服务器 IP 或域名（必填）"
            echo "  --registry Docker Registry 地址（默认 docker.io）"
            echo "  --tag      镜像标签（默认 git commit hash）"
            echo "  --user     SSH 用户名（默认 root）"
            echo "  --port     SSH 端口（默认 22）"
            exit 0
            ;;
        *) error "未知参数: $1" ;;
    esac
done

# 如果没有通过参数传入 server，尝试从环境变量读取
SERVER="${SERVER:-$DEPLOY_SERVER}"
[ -z "$SERVER" ] && error "请指定服务器: ./deploy.sh --server <IP>"

# 默认使用 git commit hash 作为标签
if [ -z "$TAG" ]; then
    TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
fi

FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"
LATEST_IMAGE="${REGISTRY}/${IMAGE_NAME}:latest"

info "=============================="
info "部署目标: ${SERVER}"
info "镜像:     ${FULL_IMAGE}"
info "远端目录: ${REMOTE_DIR}"
info "=============================="

# ---------- Step 1: 本地构建镜像 ----------
info "Step 1/6: 构建 Docker 镜像..."
docker build -t "${FULL_IMAGE}" -t "${LATEST_IMAGE}" .

# ---------- Step 2: 推送到 Registry ----------
info "Step 2/6: 推送镜像到 Registry..."
docker push "${FULL_IMAGE}"
docker push "${LATEST_IMAGE}"

# ---------- Step 3: 复制配置文件到远端 ----------
info "Step 3/6: 同步配置文件到远端服务器..."
SSH_CMD="ssh -o StrictHostKeyChecking=no -p ${SSH_PORT} ${SSH_USER}@${SERVER}"

${SSH_CMD} "mkdir -p ${REMOTE_DIR}"

scp -o StrictHostKeyChecking=no -P "${SSH_PORT}" \
    docker-compose.prod.yml \
    "${SSH_USER}@${SERVER}:${REMOTE_DIR}/"

# 如果有 .env.production 也一起传
if [ -f .env.production ]; then
    scp -o StrictHostKeyChecking=no -P "${SSH_PORT}" \
        .env.production \
        "${SSH_USER}@${SERVER}:${REMOTE_DIR}/.env"
fi

# ---------- Step 4: 远端拉取最新镜像并启动 ----------
info "Step 4/6: 远端拉取镜像并重启服务..."

# 保存当前运行的镜像 ID 用于回滚
ROLLBACK_CMD=$(cat <<REMOTE_SCRIPT
cd ${REMOTE_DIR}

# 记录当前版本用于回滚
OLD_IMAGE=\$(docker inspect --format='{{.Config.Image}}' shipment-checker 2>/dev/null || echo "")
echo "\${OLD_IMAGE}" > .rollback_image

# 设置环境变量
export IMAGE_TAG=${TAG}
export REGISTRY=${REGISTRY}
export IMAGE_NAME=${IMAGE_NAME}

# 拉取新镜像
docker pull ${FULL_IMAGE}

# 停止旧容器并启动新容器
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
REMOTE_SCRIPT
)

${SSH_CMD} "${ROLLBACK_CMD}"

# ---------- Step 5: 健康检查 ----------
info "Step 5/6: 等待服务启动并检查健康状态..."
sleep 5

HEALTH_CHECK=$(${SSH_CMD} "curl -sf http://localhost:\${APP_PORT:-80}/health || echo 'FAIL'")

if [ "${HEALTH_CHECK}" = "FAIL" ]; then
    warn "健康检查失败！执行回滚..."

    ROLLBACK=$(cat <<ROLLBACK_SCRIPT
cd ${REMOTE_DIR}
OLD_IMAGE=\$(cat .rollback_image 2>/dev/null)
if [ -n "\${OLD_IMAGE}" ] && [ "\${OLD_IMAGE}" != "${FULL_IMAGE}" ]; then
    echo "回滚到: \${OLD_IMAGE}"
    docker compose -f docker-compose.prod.yml down
    # 用旧镜像重新标记
    docker tag "\${OLD_IMAGE}" ${LATEST_IMAGE}
    export IMAGE_TAG=latest
    docker compose -f docker-compose.prod.yml up -d
    echo "回滚完成"
else
    echo "无可用的回滚版本"
fi
ROLLBACK_SCRIPT
    )

    ${SSH_CMD} "${ROLLBACK}"
    error "部署失败，已回滚到上一版本"
fi

# ---------- Step 6: 清理旧镜像 ----------
info "Step 6/6: 清理旧镜像..."
${SSH_CMD} "docker image prune -f" 2>/dev/null || true

info "=============================="
info "部署成功！"
info "访问: http://${SERVER}"
info "镜像: ${FULL_IMAGE}"
info "=============================="
