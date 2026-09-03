"use strict";

// The "xeapi" transport (interface3.music.163.com/xeapi/...) — the scheme the official
// Android app uses for the endpoints netease risk-controls hardest, the song url being
// the hot one. A request is three form fields:
//   B = AES-128-ECB(dynKey, midTransform(AES-256-ECB(staticKey, plain)))
//   S = ephPub ‖ iv ‖ AES-128-GCM(ecdhKey, iv, "<dynKeyB64>|<os>|<sk>")
//   R = AES-256-ECB(staticKey, "<keyVersion>|")
// where (publicKey, version, sk) come from a one-off anti-crawler session registration.
// Ported from the 1.3.0 built-in client (NeteaseCrypto#xeapi).

function call(method, args) { return qplayer.call(method, args || {}); }

var STATIC_KEY = "ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84";
// HMAC-SHA256 key signing the session registration. Used verbatim as UTF-8 bytes
// (it only looks like base64).
var SIGN_KEY = "mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3"
  + "+lL2rGeoFBpVe5g==";
var RESPONSE_KEY = "e82ckenh8dichen8";
var XEAPI_HOST = "https://interface3.music.163.com";
var KEY_HOST = "https://interface.music.163.com";
// The x-appver the reference client sends on the xeapi path (its key registration
// announces a newer app version — both are kept as-is).
var APPVER = "9.1.65";
var KEY_APPVER = "9.5.61";
var ANDROID_UA = "NeteaseMusic/9.5.61.260802021928(9005061);Dalvik/2.1.0"
  + " (Linux; U; Android 12; HBN-AL00 Build/cd737a2.0)";
var ID_XOR_KEY = "3go8&$8*3*3h0k(2)2";
var ZERO_SALT = "0000000000000000000000000000000000000000000000000000000000000000";
var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

var session = null;
// Session handed back by the server (x-encr-ssid / x-encr-sskey). While it holds, the
// dynamic key is the session key and R names the session instead of being empty.
var sessionId = "";
var sessionKey = "";

function hex2(value) {
  var text = (value & 255).toString(16);
  return text.length < 2 ? "0" + text : text;
}

function hexToBytes(hex) {
  var bytes = [];
  for (var i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
  return bytes;
}

function bytesToHex(bytes) {
  var hex = "";
  for (var i = 0; i < bytes.length; i++) hex += hex2(bytes[i]);
  return hex;
}

function utf8Bytes(value) {
  var encoded = unescape(encodeURIComponent(String(value)));
  var bytes = [];
  for (var i = 0; i < encoded.length; i++) bytes.push(encoded.charCodeAt(i) & 255);
  return bytes;
}

function utf8FromHex(hex) {
  var escaped = "";
  for (var i = 0; i + 1 < hex.length; i += 2) escaped += "%" + hex.substr(i, 2);
  try { return decodeURIComponent(escaped); } catch (_) { return unescape(escaped); }
}

function base64FromBytes(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i];
    var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET.charAt(b0 >> 2);
    out += B64_ALPHABET.charAt(((b0 & 3) << 4) | (b1 >> 4));
    out += i + 1 < bytes.length ? B64_ALPHABET.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET.charAt(b2 & 63) : "=";
  }
  return out;
}

function asciiBytes(value) {
  var bytes = [];
  for (var i = 0; i < value.length; i++) bytes.push(value.charCodeAt(i) & 255);
  return bytes;
}

/** XOR the ciphertext under a random 16-byte pad, base64 it, rotate the base64 left by
 *  rnd[0] & 0xf, and prepend the pad. Reversible obfuscation the server peels back
 *  before the outer AES. */
function midTransform(cipher, rnd) {
  var xored = [];
  for (var i = 0; i < cipher.length; i++) xored.push(cipher[i] ^ rnd[i & 15]);
  var encoded = base64FromBytes(xored);
  var rotation = encoded.length === 0 ? 0 : (rnd[0] & 15) % encoded.length;
  return rnd.concat(asciiBytes(encoded.slice(rotation) + encoded.slice(0, rotation)));
}

function randomHex(bytes) {
  return call("crypto.random", {length: bytes, outputEncoding: "hex"});
}

function randomDigits(count) {
  var value = "";
  for (var i = 0; i < count; i++) value += String(Math.floor(Math.random() * 10));
  return value;
}

function form(values) {
  var parts = [];
  Object.keys(values).forEach(function (key) {
    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(values[key])));
  });
  return parts.join("&");
}

/** HKDF(SHA-256) with a zero salt: extract over the shared secret, expand with the
 *  ephemeral public key as info, take the first 16 bytes. */
function deriveSharedKey(sharedHex, ephPubHex) {
  return call("crypto.hmac", {
    algorithm: "HmacSHA256", key: ZERO_SALT, keyEncoding: "hex",
    data: sharedHex, dataEncoding: "hex", outputEncoding: "hex"
  }).then(function (prk) {
    return call("crypto.hmac", {
      algorithm: "HmacSHA256", key: prk, keyEncoding: "hex",
      data: ephPubHex + "01", dataEncoding: "hex", outputEncoding: "hex"
    });
  }).then(function (okm) { return okm.slice(0, 32); });
}

/** S = X25519 ECDH → HKDF → AES-128-GCM over "<dynKeyB64>|<os>|<sk>", framed as
 *  ephemeralPublicKey ‖ iv ‖ ciphertext‖tag. */
function encryptSession(dynKeyHex, peerPublicKey, sk) {
  var ephPrivHex;
  var ephPubHex;
  return randomHex(32).then(function (value) {
    ephPrivHex = value;
    return call("crypto.x25519", {
      scalar: ephPrivHex, scalarEncoding: "hex", outputEncoding: "hex"
    });
  }).then(function (value) {
    ephPubHex = value;
    return call("crypto.x25519", {
      scalar: ephPrivHex, scalarEncoding: "hex",
      point: peerPublicKey, pointEncoding: "base64", outputEncoding: "hex"
    });
  }).then(function (sharedHex) {
    return deriveSharedKey(sharedHex, ephPubHex);
  }).then(function (keyHex) {
    return randomHex(12).then(function (ivHex) {
      var plain = base64FromBytes(hexToBytes(dynKeyHex)) + "|android|" + (sk || "");
      return call("crypto.aes", {
        transformation: "AES/GCM/NoPadding", operation: "encrypt",
        key: keyHex, keyEncoding: "hex", iv: ivHex, ivEncoding: "hex",
        data: plain, dataEncoding: "utf8", outputEncoding: "hex"
      }).then(function (sealed) { return ephPubHex + ivHex + sealed; });
    });
  });
}

function encryptRequest(formBody, active) {
  var reusing = !!sessionKey;
  var dynKeyHex;
  var padHex;
  var fields = {};
  var seed = reusing ? Promise.resolve(bytesToHex(utf8Bytes(sessionKey))) : randomHex(16);
  return seed.then(function (value) {
    dynKeyHex = value;
    return randomHex(16);
  }).then(function (value) {
    padHex = value;
    var plain = "{\"body\":\"" + base64FromBytes(utf8Bytes(formBody))
      + "\",\"queryString\":\"e_r=true\"}";
    return call("crypto.aes", {
      transformation: "AES/ECB/PKCS5Padding", operation: "encrypt",
      key: STATIC_KEY, keyEncoding: "hex", data: plain, dataEncoding: "utf8",
      outputEncoding: "hex"
    });
  }).then(function (innerHex) {
    var mid = midTransform(hexToBytes(innerHex), hexToBytes(padHex));
    return call("crypto.aes", {
      transformation: "AES/ECB/PKCS5Padding", operation: "encrypt",
      key: dynKeyHex, keyEncoding: "hex", data: bytesToHex(mid), dataEncoding: "hex",
      outputEncoding: "base64"
    });
  }).then(function (value) {
    fields.B = value;
    return encryptSession(dynKeyHex, active.publicKey, active.sk);
  }).then(function (sealedHex) {
    fields.S = base64FromBytes(hexToBytes(sealedHex));
    return call("crypto.aes", {
      transformation: "AES/ECB/PKCS5Padding", operation: "encrypt",
      key: STATIC_KEY, keyEncoding: "hex",
      data: active.version + "|" + (reusing ? sessionId : ""), dataEncoding: "utf8",
      outputEncoding: "base64"
    });
  }).then(function (value) {
    fields.R = value;
    return fields;
  });
}

/** Register a fresh anti-crawler session key. Anonymous — needs only a stable deviceId.
 *  Cached for the plugin's lifetime; a failure leaves the cache empty so the next call
 *  retries. */
function ensureSession(deviceId) {
  if (session) return Promise.resolve(session);
  var nonce = randomDigits(16);
  var timestamp = String(Date.now());
  var payload;
  return sign(timestamp, nonce).then(function (signature) {
    return call("http.request", {
      url: KEY_HOST + "/api/gorilla/anti/crawler/security/key/get", method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": ANDROID_UA,
        "Cookie": deviceId ? "deviceId=" + encodeURIComponent(deviceId) : ""
      },
      body: form({
        appVersion: KEY_APPVER, currentKeyVersion: "", deviceId: deviceId, nonce: nonce,
        os: "android", requestType: "active", signature: signature, t1: "", t2: "",
        timestamp: timestamp, uid: ""
      }),
      timeoutMs: 15000
    });
  }).then(function (response) {
    if (!response || response.status < 200 || response.status >= 300) {
      throw new Error("HTTP " + (response && response.status));
    }
    var body = JSON.parse(response.body || "{}");
    if (Number(body.code) !== 200 || !body.data || !body.data.encryptedData) {
      throw new Error("xeapi 密钥注册失败");
    }
    payload = body.data;
    // The server signs its own response with the nonce we sent.
    return payload.signature
      ? sign(payload.timestamp, nonce).then(function (expected) {
          if (expected !== payload.signature) throw new Error("xeapi 密钥响应签名不匹配");
        })
      : Promise.resolve();
  }).then(function () {
    return call("crypto.aes", {
      transformation: "AES/ECB/PKCS5Padding", operation: "decrypt",
      key: STATIC_KEY, keyEncoding: "hex",
      data: payload.encryptedData, dataEncoding: "base64", outputEncoding: "utf8"
    });
  }).then(function (json) {
    var registered = JSON.parse(json);
    if (!registered.publicKey || !registered.sk) throw new Error("xeapi 密钥响应缺少字段");
    session = {
      publicKey: registered.publicKey, sk: registered.sk,
      version: registered.version == null ? "" : String(registered.version)
    };
    return session;
  });
}

function sign(timestamp, nonce) {
  return call("crypto.hmac", {
    algorithm: "HmacSHA256", key: SIGN_KEY, keyEncoding: "utf8",
    data: String(timestamp) + nonce, dataEncoding: "utf8", outputEncoding: "base64"
  });
}

/** The username the anonymous-registration endpoint expects:
 *  base64("<deviceId> <base64(md5(deviceId XOR key))>"). */
function anonymousUsername(deviceId) {
  var xored = [];
  for (var i = 0; i < deviceId.length; i++) {
    xored.push(deviceId.charCodeAt(i) ^ ID_XOR_KEY.charCodeAt(i % ID_XOR_KEY.length));
  }
  return call("crypto.digest", {
    algorithm: "MD5", data: bytesToHex(xored), dataEncoding: "hex",
    outputEncoding: "base64"
  }).then(function (digest) {
    return base64FromBytes(utf8Bytes(deviceId + " " + digest));
  });
}

function decryptResponse(response) {
  var payload = response.bodyBase64;
  if (!payload) throw new Error("xeapi 响应为空");
  return call("crypto.aes", {
    transformation: "AES/ECB/PKCS5Padding", operation: "decrypt",
    key: RESPONSE_KEY, keyEncoding: "utf8", data: payload, dataEncoding: "base64",
    outputEncoding: "hex"
  }).then(function (plainHex) {
    if (plainHex.slice(0, 4).toLowerCase() === "1f8b") {
      return call("compression.gunzip", {
        data: plainHex, dataEncoding: "hex", outputEncoding: "utf8"
      });
    }
    return utf8FromHex(plainHex);
  });
}

/**
 * POST to /xeapi/<path>. `context` carries the caller's device identity:
 * {deviceId, musicU, cookie}. Returns the parsed JSON response.
 */
function request(path, data, context, timeoutMs, withCookies) {
  var deviceId = context.deviceId || "";
  var buildver = String(Date.now()).slice(0, 10);
  return ensureSession(deviceId).then(function (active) {
    return encryptRequest(form(data || {}), active);
  }).then(function (fields) {
    var headers = {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      "User-Agent": ANDROID_UA,
      "X-Client-Enc-State": "ENCRYPTED",
      "x-aeapi": "true",
      "x-deviceid": deviceId,
      "x-os": "android",
      "x-osver": "16",
      "x-appver": APPVER,
      "x-sdeviceid": deviceId,
      "x-buildver": buildver,
      "X-Real-IP": context.ip,
      "X-Forwarded-For": context.ip,
      "Cookie": cookie(context.cookie, buildver)
    };
    if (context.musicU) headers["x-music-u"] = context.musicU;
    return call("http.request", {
      url: XEAPI_HOST + "/xeapi/" + path.replace(/^\/api\//, ""), method: "POST",
      headers: headers, body: form(fields), includeBase64: true,
      timeoutMs: timeoutMs || 15000
    });
  }).then(function (response) {
    if (response.status < 200 || response.status >= 300) {
      // A rejected key or session has to be re-registered on the next call.
      session = null;
      sessionId = "";
      sessionKey = "";
      throw new Error("HTTP " + response.status);
    }
    absorbSession(response);
    return decryptResponse(response).then(function (json) {
      var body = JSON.parse(json || "{}");
      return withCookies ? {body: body, setCookies: response.setCookies || []} : body;
    });
  });
}

/** The server can hand back a session (id + key) to reuse instead of a fresh dynamic
 *  key on every call — the reference client keeps it for as long as it is offered. */
function absorbSession(response) {
  var headers = response && response.headers;
  if (!headers) return;
  var id = headers["x-encr-ssid"] || headers["X-Encr-Ssid"];
  var key = headers["x-encr-sskey"] || headers["X-Encr-Sskey"];
  if (id && key) {
    sessionId = String(id);
    sessionKey = String(key);
  }
}

/** Cookie for the xeapi path: the caller's jar with the Android device identity that
 *  matches the x-os / x-appver headers — a mismatch itself trips risk control. */
function cookie(cookies, buildver) {
  var all = Object.assign({}, cookies || {});
  all.os = "android";
  all.osver = "16";
  all.appver = APPVER;
  all.buildver = buildver;
  all.deviceId = (cookies && cookies.deviceId) || "";
  all.sDeviceId = (cookies && cookies.sDeviceId) || all.deviceId;
  return Object.keys(all).map(function (name) {
    return encodeURIComponent(name) + "=" + encodeURIComponent(all[name]);
  }).join("; ");
}

function reset() {
  session = null;
  sessionId = "";
  sessionKey = "";
}

module.exports = {
  request: request, reset: reset, anonymousUsername: anonymousUsername
};
