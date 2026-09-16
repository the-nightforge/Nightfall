#!/usr/bin/env bash
# Chuẩn bị VPS Ubuntu 24.04 cho backend ma-soi-online.
# Chạy MỘT LẦN, bằng root: bash bootstrap-vps.sh
#
# ĐIỀU KIỆN TIÊN QUYẾT: VPS phải có Internet ra ngoài.
# Kiểm tra trước: curl -sS -o /dev/null -w '%{http_code}\n' https://github.com
# Nếu treo/timeout thì dừng lại — chưa sửa xong egress thì mọi bước dưới đều fail.

set -euo pipefail

echo "==> [0/7] Kiểm tra Internet ra ngoài"
if ! curl -fsS -o /dev/null --max-time 15 https://download.docker.com/linux/ubuntu/gpg; then
    echo "LỖI: VPS không ra được Internet. Sửa egress trước rồi chạy lại." >&2
    exit 1
fi

echo "==> [1/7] Cập nhật hệ thống"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get autoremove -y
timedatectl set-timezone UTC

echo "==> [2/7] Swap (bỏ qua nếu đã có)"
if ! swapon --show | grep -q .; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
    echo "    đã có swap, bỏ qua"
fi

echo "==> [3/7] UFW + fail2ban + unattended-upgrades"
apt-get install -y ufw fail2ban unattended-upgrades ca-certificates curl gnupg
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban

echo "==> [4/7] Docker Engine (repo chính thức, không dùng docker.io của distro)"
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

echo "==> [5/7] Nginx + Certbot"
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx

echo "==> [6/7] Thư mục deploy"
mkdir -p /opt/masoi
chmod 750 /opt/masoi

echo "==> [7/7] User deploy (không đặt mật khẩu: chỉ vào được bằng SSH key)"
# Idempotent: chạy lại script trên máy đã dựng thì bỏ qua, không ghi đè gì.
if id deploy > /dev/null 2>&1; then
    echo "    user deploy đã có, bỏ qua"
else
    adduser --disabled-password --gecos "" deploy
    # docker group tương đương root, nên cấp nó là đã cấp toàn quyền thực tế.
    usermod -aG sudo,docker deploy
    install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
    install -m 600 -o deploy -g deploy /dev/null /home/deploy/.ssh/authorized_keys
    echo "    đã tạo user deploy (sudo + docker), chưa có key nào"
fi

cat <<'DONE'

==> Xong phần bootstrap.

Còn lại (làm thủ công vì cần secret và domain):
  1. Tạo /opt/masoi/.env từ deploy/env.production.example, điền secret thật.
     chmod 600 /opt/masoi/.env
  2. git clone <repo> /opt/masoi/app
  3. bash /opt/masoi/app/deploy/deploy.sh
  4. Khi có domain: sửa server_name trong deploy/nginx/masoi.conf,
     cp deploy/nginx/masoi-proxy.conf /etc/nginx/snippets/
     ln -s vào sites-enabled, rm sites-enabled/default (nó cũng khai
     default_server nên để lại là nginx từ chối load), nginx -t,
     certbot --nginx -d <domain> --redirect

  5. User deploy đã tạo nhưng CHƯA có key nào - chưa ai vào được. Nạp key:
       echo 'ssh-ed25519 AAAA... ai-do@example.com' \
         >> /home/deploy/.ssh/authorized_keys
     Lấy key dạng văn bản, đừng chép từ ảnh chụp màn hình: sai một ký tự thì
     key vẫn đúng định dạng nên không có gì báo lỗi, chỉ thấy
     "Permission denied (publickey)" và rất khó lần ra.

     Muốn user đó dùng sudo thì phải đặt mật khẩu cho nó (adduser
     --disabled-password không đặt gì, nên sudo sẽ hỏi một mật khẩu không
     tồn tại):
       passwd deploy
     Mật khẩu này KHÔNG dùng để SSH được nếu đã tắt PasswordAuthentication.

LƯU Ý BẢO MẬT - làm ngay sau khi CHẮC CHẮN key đã đăng nhập được:

  Máy mới dựng để mặc định cho đăng nhập bằng mật khẩu, và bot quét Internet
  tìm thấy trong vài phút. Đo trên chính máy này lúc chưa khoá: 1.402 lần dò
  mật khẩu trong 24 giờ từ 58 IP, 1.220 lần nhắm thẳng vào root.

  Ubuntu cloud image có /etc/ssh/sshd_config.d/50-cloud-init.conf ĐÈ LÊN
  sshd_config. Chỉ sửa file chính là không có tác dụng - phải sửa cả hai:

    cp /etc/ssh/sshd_config{,.bak}
    sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' \
        /etc/ssh/sshd_config.d/50-cloud-init.conf
    sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
        /etc/ssh/sshd_config
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' \
        /etc/ssh/sshd_config
    sshd -t && systemctl restart ssh          # sshd -t chặn tự khoá mình ra
    sshd -T | grep -E 'passwordauthentication|permitrootlogin'

  Kiểm tra lại bằng MỘT KẾT NỐI MỚI trước khi đóng phiên đang mở:
    ssh -o BatchMode=yes <user>@<host> 'echo OK'

  Đổi luôn mật khẩu root nếu nó từng bị lộ: tắt PasswordAuthentication chỉ
  chặn đường SSH, VNC console của nhà cung cấp vẫn nhận mật khẩu đó.
    passwd root
DONE
