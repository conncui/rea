import {createSign} from "node:crypto";

const API_URL = "https://api.github.com";

export function appJwt(appId, privateKey, now = Date.now()) {
  const encode = (value) =>
    Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(now / 1000);
  const unsigned = `${encode({alg: "RS256", typ: "JWT"})}.${encode({
    exp: issuedAt + 540,
    iat: issuedAt - 60,
    iss: appId,
  })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

function nextPage(response) {
  const link = response.headers.get("link");
  return link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
}

export class GitHubClient {
  #fetch;
  #token;

  constructor(token, fetchImpl = fetch) {
    this.#fetch = fetchImpl;
    this.#token = token;
  }

  async request(path, options = {}) {
    const response = await this.#fetch(path.startsWith("https://") ? path : `${API_URL}${path}`, {
      ...options,
      headers: {
        accept: "application/vnd.github+json",
        authorization: "Bearer " + this.#token,
        "user-agent": "upstream-sync-github-app",
        ...options.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${options.method ?? "GET"} ${path} failed (${response.status}): ${await response.text()}`);
    }
    return response.status === 204 ? undefined : response.json();
  }

  async paginate(path) {
    const pages = [];
    let next = path;
    while (next) {
      const response = await this.#fetch(next.startsWith("https://") ? next : `${API_URL}${next}`, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: "Bearer " + this.#token,
          "user-agent": "upstream-sync-github-app",
        },
      });
      if (!response.ok) {
        throw new Error(`GitHub API GET ${next} failed (${response.status}): ${await response.text()}`);
      }
      pages.push(await response.json());
      next = nextPage(response);
    }
    return pages;
  }
}

export async function installationToken(appClient, installationId) {
  const result = await appClient.request(`/app/installations/${installationId}/access_tokens`, {
    method: "POST",
  });
  return result.token;
}
