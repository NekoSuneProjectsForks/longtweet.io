# Automated Docker images (GitHub Actions)

The workflow `.github/workflows/docker-image.yml` builds the standalone self-hosted Longtweet Studio image for **linux/amd64** and **linux/arm64**. It publishes multi-platform images to GitHub Container Registry (GHCR) on pushes to `master`, on version tags (`v*`), and when the workflow is manually dispatched from the Actions tab. Pull requests to master validate the image build without publishing.

## Image

```text
ghcr.io/nekosuneprojectsforks/longtweet.io:latest
```

Also produced: `:master`, `:sha-<shortsha>`, and version tags when pushed. The `:latest` tag updates only from `master`.

## Deploy using the published image

1. Merge the workflow PR and wait for a successful `Docker image (GHCR)` run on master.
2. In your server or Dockge stack directory, obtain `docker-compose.ghcr.yml` and `.env.example` from the repository.
3. Copy `.env.example` to `.env`. Set a strong `ADMIN_PASSWORD`, 32+ character random `SESSION_SECRET`, and public `PUBLIC_URL`.
4. Run:

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

The image is pulled from GHCR, not compiled on the server. Compatible with AMD64 and ARM64, including Raspberry Pi 5 running a 64-bit OS. Persist `longtweet_data` and back it up.

## Permissions and package visibility

The workflow uses the built-in `GITHUB_TOKEN` with `packages: write`, so you do **not** need to create a personal access token for publishing. If GHCR denies publishing, check the repository's GitHub Actions workflow permissions and the package's workflow access. New container packages might default to private; make the package public in its GitHub Packages settings if you want anonymous `docker pull` and public self-host deployment.

## Rebuild or release

- Push/merge to `master`: publishes `latest` and `master`.
- Push tag `v1.0.0`: publishes a versioned image.
- Actions -> **Docker image (GHCR)** -> **Run workflow**: manually build and publish from the chosen branch; only use trusted branches because this job has package-write permission.

For a local build without GHCR, continue using `docker-compose.yml` with `docker compose up -d --build`.
