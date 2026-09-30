const Service = require("webos-service");
const crypto = require("crypto"), os = require("os");
const { createPairServer } = require("./pair-server");

const LIFETIME_MS = 10 * 60 * 1000; // the server shuts itself down if the app does not get to it
const service = new Service("io.github.haansen.homedash.pair");
let server = null, timer = null, activity = null;

function lanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) for (const n of nets[name]) if (n.family === "IPv4" && !n.internal) return n.address;
  return null;
}

function stop() {
  clearTimeout(timer);
  if (server) server.close();
  server = null;
  if (activity) service.activityManager.complete(activity, () => {});
  activity = null;
}

service.register("start", message => {
  stop();
  const code = crypto.randomBytes(8).toString("hex");
  const current = server = createPairServer(code, String(message.payload.server || ""), credentials => {
    message.respond({ returnValue: true, subscribed: true, credentials });
  });
  current.on("error", err => { message.respond({ returnValue: false, errorText: String(err && err.message) }); if (server === current) stop(); });
  current.listen(0, "0.0.0.0", () => {
    service.activityManager.create("pairing", a => { if (server === current) activity = a; }); // keeps the service alive
    timer = setTimeout(stop, LIFETIME_MS);
    message.respond({ returnValue: true, subscribed: true, ip: lanIp(), port: current.address().port, code });
  });
}, stop); // the app cancels the subscription once sign-in is done

service.register("stop", message => { stop(); message.respond({ returnValue: true }); });
