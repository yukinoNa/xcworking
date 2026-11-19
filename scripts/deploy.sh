#!/bin/bash
# 宣传部工作台 —— Ubuntu 22.04/24.04 一键部署
# 用法（以 root 登录服务器后）：
#   bash <(curl -fsSL https://raw.githubusercontent.com/yukinoNa/xcworking/main/scripts/deploy.sh)
set -e

REPO="https://github.com/yukinoNa/xcworking.git"
APP_DIR="/opt/publicity-hub"
SVC="publicity-hub"
APP_USER="pubhub"
PORT="80"

echo ">>> 1/6 安装基础工具"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates

echo ">>> 2/6 安装 Node.js 20"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
echo "    Node $(node -v) / npm $(npm -v)"

echo ">>> 3/6 拉取代码到 $APP_DIR"
rm -rf "$APP_DIR"
git clone --depth 1 "$REPO" "$APP_DIR" 2>&1 | tail -2
cd "$APP_DIR"

echo ">>> 4/6 安装依赖"
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3

echo ">>> 5/6 配置系统服务（监听 $PORT，开机自启、崩溃自动重启）"
id -u "$APP_USER" >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d "$APP_DIR" "$APP_USER"
mkdir -p "$APP_DIR/data" "$APP_DIR/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

cat > /etc/systemd/system/$SVC.service <<'EOF'
[Unit]
Description=Publicity Hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pubhub
Group=pubhub
WorkingDirectory=/opt/publicity-hub
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=80
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1
systemctl restart "$SVC"

echo ">>> 6/6 检查运行状态"
sleep 4
systemctl is-active "$SVC" >/dev/null && echo "    服务运行中" || echo "    启动失败，用 journalctl -u $SVC -n 50 查看"

KEY=""
for i in 1 2 3 4 5; do
  KEY=$(cat "$APP_DIR/data/admin-key.txt" 2>/dev/null | tr -d '\r\n')
  [ -n "$KEY" ] && break
  sleep 1
done

IP=$(curl -s --max-time 5 https://api.ipify.org || echo "你的服务器IP")
echo ""
echo "================================================"
echo " 部署完成"
echo ""
echo " 网站地址 : http://$IP"
echo " 委托入口 : http://$IP/order.html"
echo " 内部看板 : http://$IP/admin.html"
echo " 看板口令 : $KEY"
echo ""
echo " 常用命令"
echo "   查看日志 : journalctl -u $SVC -f"
echo "   重启服务 : systemctl restart $SVC"
echo "   数据目录 : $APP_DIR/data  $APP_DIR/uploads"
echo "================================================"
echo ""
echo "重要：如果浏览器打不开，去阿里云控制台"
echo "  「安全组 - 配置规则 - 入方向」放行 TCP 80 端口"
