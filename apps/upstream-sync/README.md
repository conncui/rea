# Upstream sync GitHub App

This service lets one installed GitHub App synchronize every installed fork of
`morluto/rea` without committing a workflow to each fork. It runs as a
containerized HTTP service; deploy it to a managed container platform such as
Cloud Run, Azure Container Apps, or AWS App Runner. A platform scheduler must
send an authenticated `POST /sync` request at the desired schedule.

## Create and install the app

Create a GitHub App owned by the account or organization that owns the forks.
`app-manifest.json` contains the required registration permissions and can be
used with GitHub's App-manifest flow. Do not enable webhook events. Then:

- Repository permissions: **Contents: Read and write** and **Pull requests:
  Read and write**.
- Install the app only in repositories that should be synchronized. It needs no
  webhook subscription.
- Generate a private key. Store it only in the deployment platform's secret
  manager, never in the repository or an Actions secret shared with forks.

Deploy the image:

```sh
docker build -f apps/upstream-sync/Dockerfile -t upstream-sync .
docker run --rm -p 3000:3000 \
  -e SYNC_APP_ID=12345 \
  -e SYNC_APP_PRIVATE_KEY="$(cat github-app.private-key.pem)" \
  -e SYNC_TRIGGER_TOKEN="$(openssl rand -hex 32)" \
  upstream-sync
```

Use a scheduler that sends the `SYNC_TRIGGER_TOKEN` with the HTTP
`Authorization` header using the standard ****** to `POST /sync` once
daily at 9:00 AM `America/Los_Angeles`. Configure the
scheduler's timezone directly when supported; otherwise schedule both 16:00
and 17:00 UTC and make the scheduler apply the timezone check. Deploy exactly
one service instance so the in-process overlap guard is effective. The service
exposes unauthenticated `GET /health` for the platform health check.

## Operation and management

The service enumerates the App's installations, considers only direct forks
whose parent is `morluto/rea`, and syncs their `main` branch. For each
behind/diverged fork it resets `automation/sync-upstream` to its current
`main`, merges upstream `main`, reuses or creates one PR, merge-commits it,
and deletes the synchronization branch. A merge blocked by branch protection
causes the request to fail with the repository and PR number in the service
log; no auto-merge queue is used.

Manage the App by reviewing installation access, rotating its private key and
`SYNC_TRIGGER_TOKEN`, restricting network access to `/sync` where the hosting
platform supports it, retaining request logs, and monitoring non-2xx scheduler
responses. The App's `Contents` and `Pull requests` write permissions are the
minimum needed for this behavior.
