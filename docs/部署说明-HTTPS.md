# HTTPS 部署说明（可选）

仓库默认的 `docker-compose.yml` 只监听 `8080` 的 HTTP，适合由宿主机 Nginx 终止 TLS，或在内网/NAS 直接使用。若需要平台自身提供 HTTPS，使用本目录下的叠加配置。

> 说明：演示环境因 ICP 备案未完成，域名链路不可达，当前线上仍以 `http://1.14.125.216/` 提供。本方案用于备案完成后的生产部署，或本地/内网复用同一套配置。

## 1. 准备证书

任选一种方式获得 `fullchain.pem` 与 `privkey.pem`：

- **已有证书**：直接复制到 `deploy/certs/`。
- **Let's Encrypt（域名已解析到本机）**：

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d 你的域名
sudo mkdir -p deploy/certs
sudo cp /etc/letsencrypt/live/你的域名/fullchain.pem deploy/certs/
sudo cp /etc/letsencrypt/live/你的域名/privkey.pem deploy/certs/
sudo chown -R $USER:$USER deploy/certs
```

- **本地自测**：生成自签证书（浏览器会提示不受信任）：

```bash
mkdir -p deploy/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout deploy/certs/privkey.pem -out deploy/certs/fullchain.pem \
  -subj "/CN=localhost"
```

证书目录已在 `.gitignore` 中排除，不会被提交。

## 2. 配置环境变量

在项目根目录 `.env` 中改为 HTTPS 相关取值：

```bash
JWT_SECRET=请替换为随机长字符串
CORS_ORIGINS=https://你的域名
COOKIE_SECURE=1
```

- `COOKIE_SECURE=1` 让登录 Cookie 只在 HTTPS 下发送；若仍用 HTTP 访问会登录失败，务必与访问方式一致。
- `CORS_ORIGINS` 填实际前端来源（含协议），用作小程序的 HTTPS 域名也需登记。

## 3. 启动

前置：Docker Compose 2.24+（叠加文件使用 `!override` 替换默认端口，`docker compose version` 可查看）。

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d
docker compose ps
```

容器 Nginx 将监听 `80` 与 `443`：`80` 全量 301 到 HTTPS，`443` 终止 TLS 并反代到 `app:8787`。

## 4. 验证

```bash
curl -I http://你的域名            # 期望 301，Location 为 https://
curl -I https://你的域名           # 期望 200，含 Strict-Transport-Security
curl -s https://你的域名/api/v1/health
```

浏览器访问 `https://你的域名` 应显示正常锁标，登录后 Cookie 带 `Secure` 与 `HttpOnly`。

## 5. 回退

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml down
docker compose up -d
```

同时把 `.env` 中的 `COOKIE_SECURE` 改回 `0`，否则 HTTP 下无法登录。

## 与宿主机 Nginx 方案的关系

若已有宿主机 Nginx 统一管理证书（本项目的线上做法），无需使用本叠加配置，直接使用 `deploy/nginx-astmgr.conf` 在宿主机终止 TLS 并反代到 `127.0.0.1:8080` 即可，此时容器保持默认 `docker-compose.yml`。
