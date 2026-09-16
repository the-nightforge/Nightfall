#!/usr/bin/env bash
# Chuẩn bị VPS Ubuntu 24.04 cho backend ma-soi-online.
# Chạy MỘT LẦN, bằng root: bash bootstrap-vps.sh
#
# ĐIỀU KIỆN TIÊN QUYẾT: VPS phải có Internet ra ngoài.
# Kiểm tra trước: curl -sS -o /dev/null -w '%{http_code}\n' https://github.com
# Nếu treo/timeout thì dừng lại — chưa sửa xong egress thì mọi bước dưới đều fail.

set -euo pipefail

echo "==> [0/6] Kiểm tra Internet ra ngoài"
if ! curl -fsS -o /dev/null --max-time 15 https://download.docker.com/linux/ubuntu/gpg; then
    echo "LỖI: VPS không ra được Internet. Sửa egress trước rồi chạy lại." >&2
    exit 1
fi

echo "==> [1/6] Cập nhật hệ thống"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get autoremove -y
timedatectl set-timezone UTC

echo "==> [2/6] Swap (bỏ qua nếu đã có)"
if ! swapon --show | grep -q .; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
    echo "    đã có swap, bỏ qua"
fi

echo "==> [3/6] UFW + fail2ban + unattended-upgrades"
apt-get install -y ufw fail2ban unattended-upgrades ca-certificates curl gnupg
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban

echo "==> [4/6] Docker Engine (repo chính thức, không dùng docker.io của distro)"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker --version
docker compose version

echo "==> [5/6] Nginx + Certbot"
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx

echo "==> [6/6] Thư mục deploy"
mkdir -p /opt/masoi
chmod 750 /opt/masoi

cat <<'DONE'

==> Xong phần bootstrap.

Còn lại (làm thủ công vì cần secret và domain):
  1. Tạo /opt/masoi/.env từ deploy/env.production.example, điền secret thật.
     chmod 600 /opt/masoi/.env
  2. git clone <repo> /opt/masoi/app
  3. bash /opt/masoi/app/deploy/deploy.sh
  4. Khi có domain: sửa server_name trong deploy/nginx/masoi-api.conf,
     copy vào /etc/nginx/sites-available/, ln -s, nginx -t, certbot --nginx

LƯU Ý BẢO MẬT: password root của VPS đã bị lộ. Sau khi SSH key hoạt động:
  passwd root                                    # đổi password
  sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl restart ssh
DONE
