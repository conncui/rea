import {createServer} from "node:http";
import {configuration, synchronizeInstallations} from "./service.mjs";

const config = configuration();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

let running;

function send(response, status, body) {
  response.writeHead(status, {"content-type": "application/json; charset=utf-8"});
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, {status: "ok"});
    return;
  }
  if (request.method !== "POST" || request.url !== "/sync") {
    send(response, 404, {error: "not found"});
    return;
  }
  if (request.headers.authorization !== "Bearer " + config.triggerToken) {
    send(response, 401, {error: "unauthorized"});
    return;
  }
  if (running) {
    send(response, 409, {error: "synchronization already running"});
    return;
  }

  running = synchronizeInstallations(config)
    .then((results) => {
      console.log(JSON.stringify({event: "synchronization-complete", results}));
      return results;
    })
    .finally(() => {
      running = undefined;
    });
  try {
    send(response, 200, {results: await running});
  } catch (error) {
    console.error(error);
    send(response, 500, {error: error instanceof Error ? error.message : "synchronization failed"});
  }
}).listen(port, () => {
  console.log(`upstream-sync GitHub App listening on port ${port}`);
});
