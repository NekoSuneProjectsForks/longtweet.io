# Longtweet Studio (self-hosted edition)

This repository keeps the legacy AWS frontend/lambda code untouched. The independent self-hosted edition lives under `selfhost/` and uses Node.js built-ins, with no npm dependencies. **No Docker image binaries are committed.**

## Install

```bash
git clone https://github.com/NekoSuneProjectsForks/longtweet.io.git
cd longtweet.io
cp .env.example .env
# Edit .env: unique ADMIN_PASSWORD, random SESSION_SECRET, and PUBLIC_URL
docker compose up -d --build
```

Open `http://localhost:3000`, select **Admin**, and log in. Set `PUBLIC_URL` to the exact HTTPS origin (no trailing slash) when exposing the site behind nginx, Caddy, or a Cloudflare tunnel. Configure the reverse proxy to send the original Host header. On a remote host with a reverse proxy on the same machine, keep `BIND_ADDRESS=127.0.0.1`. For direct LAN testing, set `BIND_ADDRESS=0.0.0.0`; avoid exposing login over plain HTTP to the Internet.

## Features

- Password-protected owner studio; create, edit, duplicate, delete, search, and filter posts
- Draft and published statuses; public, unlisted, and private visibility
- Public listing at `/posts`; share links at `/p/<slug>`
- Lightweight Markdown preview (headings, paragraphs, emphasis, lists, links and code)
- Persistent Docker volume; posts stored in `/data/posts.json`
- Node 24 Alpine image built locally or by your own CI; works on amd64 and arm64

## Docker image / Dockge

Import `docker-compose.yml` into Dockge as a stack, update environment variables and mount a volume. Since the Compose file uses `build:`, Dockge builds a local image; there is no published container image required. To build/push your own image: `docker build -f selfhost/Dockerfile -t your-registry/longtweet:latest .`.

## Backup, upgrades, and limitations

Back up the named Docker volume or `/data/posts.json`; restore while the container is stopped. Run only **one instance** against a given volume; storage writes are atomic renames but there is no shared database coordination. This first edition is single-owner and file-backed, suited to personal or small sites. It does not migrate legacy AWS DynamoDB records automatically, provide per-user accounts, images/uploads, post revisions, or federation. Published public/unlisted post URLs can be accessed by anyone with the link; unpublished/private posts require admin login. This is a standalone edition, not a retrofit of the old AWS implementation.

To check the container: `docker compose ps`, `docker compose logs -f longtweet`, and `curl http://127.0.0.1:3000/health`.

For production use, keep HTTPS enabled, protect the `.env` file, keep backups, and periodically rebuild to receive updated Node.js security patches.
