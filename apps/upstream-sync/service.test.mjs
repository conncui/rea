import assert from "node:assert/strict";
import test from "node:test";
import {configuration, synchronizeRepository} from "./service.mjs";

test("configuration requires the app credentials and trigger token", () => {
  assert.throws(() => configuration({}), /SYNC_APP_ID must be configured/);
  assert.deepEqual(
    configuration({
      SYNC_APP_ID: "123",
      SYNC_APP_PRIVATE_KEY: "line-one\\nline-two",
      SYNC_TRIGGER_TOKEN: "token",
    }),
    {
      appId: "123",
      baseBranch: "main",
      branch: "automation/sync-upstream",
      privateKey: "line-one\nline-two",
      triggerToken: "token",
      upstream: "morluto/rea",
    },
  );
});

test("synchronizeRepository creates, merges, and removes a synchronization branch", async () => {
  const calls = [];
  const client = {
    async request(path, options = {}) {
      calls.push({options, path});
      if (path === "/repos/morluto/rea/git/ref/heads/main") {
        return {object: {sha: "upstream-sha"}};
      }
      if (path.includes("/compare/")) {
        return {behind_by: 3};
      }
      if (path === "/repos/example/rea/git/ref/heads/main") {
        return {object: {sha: "base-sha"}};
      }
      if (path.includes("/git/refs/heads/automation%2Fsync-upstream") && options.method === "PATCH") {
        throw new Error("GitHub API PATCH failed (404)");
      }
      if (path.endsWith("/pulls?state=open&base=main&head=example%3Aautomation%2Fsync-upstream&per_page=1")) {
        return [];
      }
      if (path.endsWith("/pulls") && options.method === "POST") {
        return {number: 42};
      }
      if (path.endsWith("/merge")) {
        return {merged: true};
      }
      return {};
    },
  };

  const result = await synchronizeRepository(
    client,
    {full_name: "example/rea", parent: {full_name: "morluto/rea"}},
    {
      baseBranch: "main",
      branch: "automation/sync-upstream",
      upstream: "morluto/rea",
    },
  );

  assert.deepEqual(result, {pullNumber: 42, repository: "example/rea", state: "merged"});
  assert.deepEqual(
    calls.map(({options, path}) => [options.method ?? "GET", path]),
    [
      ["GET", "/repos/morluto/rea/git/ref/heads/main"],
      ["GET", "/repos/example/rea/compare/main...morluto%3Amain"],
      ["GET", "/repos/example/rea/git/ref/heads/main"],
      ["PATCH", "/repos/example/rea/git/refs/heads/automation%2Fsync-upstream"],
      ["POST", "/repos/example/rea/git/refs"],
      ["POST", "/repos/example/rea/merges"],
      ["GET", "/repos/example/rea/pulls?state=open&base=main&head=example%3Aautomation%2Fsync-upstream&per_page=1"],
      ["POST", "/repos/example/rea/pulls"],
      ["PUT", "/repos/example/rea/pulls/42/merge"],
      ["DELETE", "/repos/example/rea/git/refs/heads/automation%2Fsync-upstream"],
    ],
  );
});

test("synchronizeRepository skips forks that already contain upstream", async () => {
  const client = {
    async request(path) {
      if (path.includes("/compare/")) {
        return {behind_by: 0};
      }
      return {object: {sha: "upstream-sha"}};
    },
  };

  assert.deepEqual(
    await synchronizeRepository(
      client,
      {full_name: "example/rea", parent: {full_name: "morluto/rea"}},
      {baseBranch: "main", branch: "automation/sync-upstream", upstream: "morluto/rea"},
    ),
    {repository: "example/rea", state: "up-to-date"},
  );
});
