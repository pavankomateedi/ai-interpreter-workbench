# Deployment

The workbench ships as a **single container**: the backend serves the built SPA,
the REST API, and the WebSocket endpoints on one port (`3001`). One image, one
URL, same-origin WebSockets — no CORS. The image is described by the repo-root
[`Dockerfile`](./Dockerfile) and verified to match the local production run
(`node packages/backend/dist/server.js`).

Target platform: **AWS Elastic Beanstalk** (Docker platform). The brief also
accepts local-only; see "Run the container locally" at the bottom.

---

## 1. Prerequisites

- An AWS account with permissions for Elastic Beanstalk, EC2, S3, and IAM.
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) configured: `aws configure`.
- [EB CLI](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/eb-cli3-install.html): `pip install awsebcli`.
- Your API keys (optional but recommended): `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.

---

## 2. First deploy (EB CLI)

From the repo root:

```bash
# Initialise the EB application on the Docker platform.
eb init interpreter-workbench --platform docker --region us-east-2

# Create an environment. An Application Load Balancer is recommended (it carries
# WebSockets cleanly); --single uses one instance with no load balancer (cheapest).
eb create interpreter-workbench-env --elb-type application

# Provide runtime configuration. Without keys the app still runs in mock mode;
# Realtime mode needs OPENAI_API_KEY, cascade translation defaults to Claude.
eb setenv NODE_ENV=production OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-ant-...

# Open the deployed URL.
eb open
```

EB builds the `Dockerfile`, maps the load balancer / proxy `:80` to the
container's `EXPOSE`d `:3001`, and the [`.platform/nginx`](./.platform) include
forwards the WebSocket upgrade headers for `/ws/*`.

### Verify the deploy

1. `https://<env>.elasticbeanstalk.com/api/health` returns `{"status":"ok",...}`.
2. The root URL loads the SPA.
3. Start a **Cascade** session and confirm transcripts stream — this exercises
   the WebSocket path end-to-end. If the session never goes "Live", the WS
   handshake is being dropped: confirm the app's published host port and adjust
   `proxy_pass` in [`.platform/nginx/conf.d/elasticbeanstalk/websocket.conf`](./.platform/nginx/conf.d/elasticbeanstalk/websocket.conf), then `eb deploy`.

### Redeploy

```bash
eb deploy
```

---

## 3. Continuous deployment (optional, auto-deploy on push)

[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) deploys `main`
to EB after CI passes. One-time setup in the GitHub repo:

- **Secrets:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (an IAM user limited
  to EB deploys).
- **Variables:** `AWS_REGION`, `EB_APPLICATION_NAME`, `EB_ENVIRONMENT_NAME`.

Until those are set the workflow safely no-ops. After that, every push to `main`
that passes CI redeploys — the "iterate from here" loop.

---

## 4. Configuration reference

| Variable | Purpose |
|----------|---------|
| `NODE_ENV=production` | Disables pretty logs; enables static SPA serving. |
| `PORT` | Listen port (default `3001`; the Dockerfile sets it). |
| `OPENAI_API_KEY` | Realtime mode + default cascade STT + TTS. |
| `ANTHROPIC_API_KEY` | Default cascade translation. |
| `DEEPGRAM_API_KEY` | Optional swappable cascade STT. |
| `STT_PROVIDER` / `TRANSLATION_PROVIDER` / `TTS_PROVIDER` | Preferred provider per stage. |

Keys are read only on the server and never sent to the browser. See
[`.env.example`](./.env.example) for the full list.

---

## 5. Run the container locally

```bash
docker build -t interpreter-workbench .
docker run --rm -p 3001:3001 \
  -e OPENAI_API_KEY=sk-... -e ANTHROPIC_API_KEY=sk-ant-... \
  interpreter-workbench
# open http://localhost:3001
```

With no `-e` keys it runs in mock/offline mode. This is the same image EB builds.

---

## 6. Teardown

```bash
eb terminate interpreter-workbench-env
```

Removes the environment and its AWS resources to stop incurring cost.
