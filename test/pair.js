// Kör: node test/pair.js
const assert = require("assert");
const { createPairServer, parseCredentials } = require("../service/pair-server");

assert.deepStrictEqual(parseCredentials('{"url":"1.2.3.4","username":"a","password":"b","extra":1}'), { url: "1.2.3.4", username: "a", password: "b" });
assert.deepStrictEqual(parseCredentials('{"url":"1.2.3.4","token":"t"}'), { url: "1.2.3.4", token: "t" });
for (const bad of ["", "inte json", "null", "[]", '{"url":"x"}', '{"username":"a","password":"b"}', '{"url":"x","username":"a"}',
  '{"url":"x","username":"a","password":""}', '{"url":5,"token":"t"}', '{"url":"x","token":{"a":1}}', JSON.stringify({ url: "x".repeat(201), token: "t" })])
  assert.strictEqual(parseCredentials(bad), null, bad);

(async () => {
  const got = [];
  const server = createPairServer("hemligkod", 'http://192.168.1.165:8123"><script>alert(1)</script>', c => got.push(c));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (path, body) => fetch(base + path, { method: "POST", body });

  assert.strictEqual((await fetch(base + "/")).status, 404, "utan kod");
  assert.strictEqual((await fetch(base + "/felkod")).status, 404, "fel kod");
  assert.strictEqual((await fetch(base + "/hemligkod/extra")).status, 404);
  assert.strictEqual((await post("/felkod", '{"url":"x","token":"t"}')).status, 404, "fel kod kan inte skicka uppgifter");
  assert.strictEqual(got.length, 0);

  const page = await fetch(base + "/hemligkod");
  const html = await page.text();
  assert.strictEqual(page.status, 200);
  assert.strictEqual(page.headers.get("cache-control"), "no-store");
  assert.ok(html.includes("192.168.1.165:8123"), "adressen är förifylld");
  assert.ok(!html.includes("<script>alert(1)"), "adressen kan inte smyga in kod i sidan");

  assert.strictEqual((await post("/hemligkod", "skräp")).status, 400);
  assert.strictEqual((await post("/hemligkod", "x".repeat(5000))).status, 413);
  assert.strictEqual((await fetch(base + "/hemligkod", { method: "DELETE" })).status, 405);
  assert.strictEqual(got.length, 0);

  assert.strictEqual((await post("/hemligkod", '{"url":"192.168.1.165","username":"anna","password":"hemligt"}')).status, 200);
  assert.deepStrictEqual(got, [{ url: "192.168.1.165", username: "anna", password: "hemligt" }]);
  server.close();
  console.log("ok");
})().catch(e => { console.error("FEL:", e.message); process.exit(1); });
