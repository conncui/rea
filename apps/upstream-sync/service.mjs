import {GitHubClient, appJwt, installationToken} from "./github.mjs";

function branchRef(branch) {
  return `refs/heads/${branch}`;
}

function refPath(branch) {
  return `heads/${encodeURIComponent(branch)}`;
}

function repositoryPath(repository) {
  return `/repos/${repository}`;
}

export function configuration(environment = process.env) {
  const required = ["SYNC_APP_ID", "SYNC_APP_PRIVATE_KEY", "SYNC_TRIGGER_TOKEN"];
  for (const name of required) {
    if (!environment[name]) {
      throw new Error(`${name} must be configured`);
    }
  }
  return {
    appId: environment.SYNC_APP_ID,
    baseBranch: environment.SYNC_BASE_BRANCH ?? "main",
    branch: environment.SYNC_BRANCH ?? "automation/sync-upstream",
    privateKey: environment.SYNC_APP_PRIVATE_KEY.replaceAll("\\n", "\n"),
    triggerToken: environment.SYNC_TRIGGER_TOKEN,
    upstream: environment.SYNC_UPSTREAM_REPOSITORY ?? "morluto/rea",
  };
}

async function openSynchronizationPullRequest(client, repository, branch, baseBranch) {
  const [owner] = repository.full_name.split("/");
  const pulls = await client.request(
    `${repositoryPath(repository.full_name)}/pulls?state=open&base=${encodeURIComponent(baseBranch)}&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=1`,
  );
  if (pulls[0]) {
    return pulls[0].number;
  }
  const pull = await client.request(`${repositoryPath(repository.full_name)}/pulls`, {
    body: JSON.stringify({
      base: baseBranch,
      body: `Automated synchronization from \`${repository.parent.full_name}\` branch \`${baseBranch}\`.`,
      head: branch,
      title: `chore: sync upstream ${repository.parent.full_name}`,
    }),
    headers: {"content-type": "application/json"},
    method: "POST",
  });
  return pull.number;
}

async function setSynchronizationBranch(client, repository, branch, sha) {
  try {
    await client.request(`${repositoryPath(repository.full_name)}/git/refs/${refPath(branch)}`, {
      body: JSON.stringify({force: true, sha}),
      headers: {"content-type": "application/json"},
      method: "PATCH",
    });
  } catch (error) {
    if (!String(error).includes("(404)")) {
      throw error;
    }
    await client.request(`${repositoryPath(repository.full_name)}/git/refs`, {
      body: JSON.stringify({ref: branchRef(branch), sha}),
      headers: {"content-type": "application/json"},
      method: "POST",
    });
  }
}

export async function synchronizeRepository(client, repository, config) {
  const [upstreamOwner] = config.upstream.split("/");
  const upstream = await client.request(`${repositoryPath(config.upstream)}/git/ref/heads/${encodeURIComponent(config.baseBranch)}`);
  const comparison = await client.request(
    `${repositoryPath(repository.full_name)}/compare/${encodeURIComponent(`${config.baseBranch}...${upstreamOwner}:${config.baseBranch}`)}`,
  );
  if (comparison.behind_by === 0) {
    return {repository: repository.full_name, state: "up-to-date"};
  }

  const base = await client.request(
    `${repositoryPath(repository.full_name)}/git/ref/heads/${encodeURIComponent(config.baseBranch)}`,
  );
  await setSynchronizationBranch(client, repository, config.branch, base.object.sha);
  await client.request(`${repositoryPath(repository.full_name)}/merges`, {
    body: JSON.stringify({
      base: config.branch,
      commit_message: `chore: sync upstream ${config.upstream}`,
      head: `${upstreamOwner}:${config.baseBranch}`,
    }),
    headers: {"content-type": "application/json"},
    method: "POST",
  });

  const pullNumber = await openSynchronizationPullRequest(client, repository, config.branch, config.baseBranch);
  const merged = await client.request(`${repositoryPath(repository.full_name)}/pulls/${pullNumber}/merge`, {
    body: JSON.stringify({merge_method: "merge"}),
    headers: {"content-type": "application/json"},
    method: "PUT",
  });
  if (!merged.merged) {
    throw new Error(`${repository.full_name}: synchronization PR #${pullNumber} was not merged: ${merged.message ?? "unknown reason"}`);
  }
  await client.request(`${repositoryPath(repository.full_name)}/git/refs/${refPath(config.branch)}`, {
    method: "DELETE",
  });
  return {pullNumber, repository: repository.full_name, state: "merged"};
}

export async function synchronizeInstallations(config, fetchImpl = fetch) {
  const appClient = new GitHubClient(appJwt(config.appId, config.privateKey), fetchImpl);
  const installations = (await appClient.paginate("/app/installations?per_page=100")).flat();
  const results = [];

  for (const installation of installations) {
    const token = await installationToken(appClient, installation.id);
    const client = new GitHubClient(token, fetchImpl);
    const repositories = (await client.paginate("/installation/repositories?per_page=100"))
      .flatMap((page) => page.repositories);
    for (const candidate of repositories) {
      const repository = await client.request(repositoryPath(candidate.full_name));
      if (repository.fork && repository.parent?.full_name === config.upstream) {
        results.push(await synchronizeRepository(client, repository, config));
      }
    }
  }
  return results;
}
