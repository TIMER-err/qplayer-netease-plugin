"use strict";

var assert = require("assert");
var digestInput = "";
var request = null;
var calls = [];
var token = new Array(171).join("t");

var storedCookies = JSON.stringify({
  MUSIC_U: "session",
  deviceId: "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123",
  _ntes_nuid: "0123456789abcdef0123456789abcdef",
  os: "pc",
  osver: "Microsoft-Windows-10-Professional-build-19045-64bit",
  appver: "3.1.17.204416",
  channel: "netease"
});

global.qplayer = {
  call: function (method, args) {
    calls.push(method);
    if (method === "webAuth.runScript") {
      assert.strictEqual(args.originUrl, "https://music.163.com/");
      assert.ok(args.script.indexOf("initWatchman") >= 0);
      return Promise.resolve(JSON.stringify({token: token, error: ""}));
    }
    if (method === "credentials.get") return Promise.resolve(storedCookies);
    if (method === "credentials.put") return Promise.resolve(true);
    if (method === "crypto.digest") {
      digestInput = args.data;
      return Promise.resolve("00000000000000000000000000000000");
    }
    if (method === "crypto.aes") return Promise.resolve("A1B2");
    if (method === "http.request") {
      request = args;
      return Promise.resolve({status: 200, body: '{"code":200}', setCookies: []});
    }
    return Promise.reject(new Error("unexpected host call: " + method));
  }
};

var handlers = require("../src/main").handlers;

handlers.playlistMutation({operation: "subscribe", playlistId: "123"}).then(function (result) {
  assert.strictEqual(result, true);
  assert.deepStrictEqual(calls.slice(0, 2), ["webAuth.runScript", "credentials.get"]);
  assert.ok(request);
  assert.strictEqual(request.url,
    "https://interfacepc.music.163.com/eapi/playlist/subscribe");
  assert.strictEqual(request.headers["X-Real-IP"], undefined);
  assert.strictEqual(request.headers["X-Forwarded-For"], undefined);

  var prefix = "nobody/api/playlist/subscribeuse";
  var suffix = "md5forencrypt";
  assert.ok(digestInput.indexOf(prefix) === 0);
  var payload = JSON.parse(digestInput.slice(prefix.length, -suffix.length));
  assert.strictEqual(payload.id, 123);
  assert.ok(payload.checkToken.length > 100);
  assert.strictEqual(payload.header["X-antiCheatToken"], token);
  assert.ok(request.headers.Cookie.indexOf("X-antiCheatToken=" + token) >= 0);
  console.log("playlist subscribe request environment verified");
}, function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
