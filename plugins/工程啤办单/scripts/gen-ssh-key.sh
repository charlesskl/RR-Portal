#!/bin/bash
# ============================================================
# gen-ssh-key.sh — 在云服务器上生成 SSH 密钥（只需运行一次）
# 用法：bash gen-ssh-key.sh
# ============================================================

echo "生成 SSH 密钥对..."
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy -N ""

echo ""
echo "允许此密钥登录本机..."
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

echo ""
echo "========================================"
echo " 请复制以下私钥内容，粘贴到 GitHub Secrets"
echo " Secret 名称：SERVER_SSH_KEY"
echo "========================================"
echo ""
cat ~/.ssh/github_deploy
echo ""
echo "========================================"
