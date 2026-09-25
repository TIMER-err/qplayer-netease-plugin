"use strict";

var PRESET_KEY = "0CoJUm6Qyw8W8jud";
var EAPI_KEY = "e82ckenh8dichen8";
var IV = "0102030405060708";
var RSA_EXPONENT = "010001";
var RSA_MODULUS = "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
var EAPI_HOST = "https://interfacepc.music.163.com";
var WEB_HOST = "https://music.163.com";
var CLIENT_LOG_HOST = "https://clientlog.music.163.com";
var AMLL_HOST = "https://amlldb.bikonoo.com";
// APP_CONF.checkToken: a separate, static token subscribe wants in the body. It rides
// alongside the freshly fetched 易盾 token, not instead of it.
var CHECK_TOKEN = "9ca17ae2e6ffcda170e2e6ee8af14fbabdb988f225b3868eb2c15a879b9a83d274a790ac8"
  + "ff54a97b889d5d42af0feaec3b92af58cff99c470a7eafd88f75e839a9ea7c14e909da883e83fb692a3"
  + "abdb6b92adee9e";
var EAPI_UA = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)";
var WEAPI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
  + " (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
var OSX_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
  + " (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// Response codes the reference client treats as a delivered answer rather than a
// failure — the QR-login states live in here.
var ACCEPTED_CODES = [200, 201, 302, 400, 502, 800, 801, 802, 803];

function call(method, args) { return qplayer.call(method, args || {}); }

var xeapiTransport = require("./xeapi");
var watchman = require("./watchman");

function padLeft(value, width, fill) {
  value = String(value);
  while (value.length < width) value = fill + value;
  return value;
}

function utf8Hex(value) {
  var encoded = unescape(encodeURIComponent(String(value)));
  var result = "";
  for (var i = 0; i < encoded.length; i++) {
    result += padLeft((encoded.charCodeAt(i) & 255).toString(16), 2, "0");
  }
  return result;
}

function form(values) {
  var parts = [];
  Object.keys(values).forEach(function (key) {
    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(values[key])));
  });
  return parts.join("&");
}

/** The weapi secret key: 16 base62 characters, as the reference client generates it. */
function base62Secret() {
  var alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return call("crypto.random", {length: 16, outputEncoding: "hex"}).then(function (value) {
    var secret = "";
    for (var i = 0; i < 16; i++) {
      secret += alphabet.charAt(parseInt(String(value).substr(i * 2, 2), 16) % 62);
    }
    return secret;
  });
}

/**
 * 列表行用的小图。网易云的图床支持 param 缩放,原图动辄一兆像素,滚动歌单时
 * 每一行都去下载并解码一张,卡顿和内存都吃不消。
 */
function thumbUrl(value, size) {
  var url = secureUrl(value);
  if (!url) return "";
  var pixels = size || 140;
  return url + (url.indexOf("?") >= 0 ? "&" : "?") + "param=" + pixels + "y" + pixels;
}

function secureUrl(value) {
  value = String(value || "");
  return value.indexOf("http://") === 0 ? "https://" + value.slice(7) : value;
}

function parseCookieHeader(header) {
  var result = {};
  String(header || "").split(";").forEach(function (part) {
    var at = part.indexOf("=");
    if (at <= 0) return;
    var name = part.slice(0, at).trim();
    var value = part.slice(at + 1).trim();
    if (name) result[name] = value;
  });
  return result;
}

function randomHex(bytes) {
  var value = "";
  for (var i = 0; i < bytes; i++) {
    value += padLeft(Math.floor(Math.random() * 256).toString(16), 2, "0");
  }
  return value;
}

/** 52 upper-case hex characters, the shape the official client's deviceId has. */
function generateDeviceId() {
  var value = "";
  for (var i = 0; i < 52; i++) value += "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16));
  return value;
}

// Computed once per plugin lifetime, like the reference implementation.
var WNMCID = (function () {
  var value = "";
  for (var i = 0; i < 6; i++) value += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  return value + "." + Date.now() + ".01.0";
})();

// Netease hands out NMTID via Set-Cookie to a client that asks for an eapi endpoint
// without one. We probe a few times like the reference client, then fall back.
var nmtid = "";
var nmtidRetriesLeft = 3;

var realIp = null;

/** Stable synthetic mainland-China IP used only by the separate xeapi transport.
 * Watchman-protected eapi/weapi requests must use the connection's real address. */
function clientIp() {
  if (!realIp) {
    var firsts = [36, 39, 42, 58, 59, 60, 101, 106, 110, 111, 112, 113, 114, 115, 116, 117,
      118, 119, 120, 121, 122, 123, 124, 125, 175, 180, 182, 183, 202, 203, 210, 211, 218,
      219, 220, 221, 222, 223];
    realIp = firsts[Math.floor(Math.random() * firsts.length)]
      + "." + Math.floor(Math.random() * 256)
      + "." + Math.floor(Math.random() * 256)
      + "." + (1 + Math.floor(Math.random() * 254));
  }
  return realIp;
}


// Per-platform client identity, mirroring the reference implementation's osMap.
var OS_MAP = {
  pc: {os: "pc", appver: "3.1.17.204416",
    osver: "Microsoft-Windows-10-Professional-build-19045-64bit", channel: "netease"},
  android: {os: "android", appver: "8.20.20.231215173437", osver: "14", channel: "xiaomi"},
  iphone: {os: "iPhone OS", appver: "9.0.90", osver: "16.2", channel: "distribution"},
  osx: {os: "osx", appver: "3.1.10.5100", osver: "15.5", channel: "netease"}
};

/** The cookie jar a real client sends: the stored values plus the device-identity
 *  flags. Without them netease's risk control rejects sensitive ops with code 524
 *  "当前环境异常". `crypto` selects the NMTID rule the reference client uses. */
function processCookies(cookies, crypto) {
  var all = Object.assign({}, cookies || {});
  var identity = OS_MAP[all.os] || OS_MAP.pc;
  all.__remember_me = "true";
  all.ntes_kaola_ad = "1";
  all._ntes_nnid = all._ntes_nnid || ((all._ntes_nuid || "") + "," + Date.now());
  all.WNMCID = all.WNMCID || WNMCID;
  all.WEVNSM = all.WEVNSM || "1.0.0";
  all.os = all.os || identity.os;
  all.osver = all.osver || identity.osver;
  all.appver = all.appver || identity.appver;
  all.channel = all.channel || identity.channel;
  if (nmtid) all.NMTID = nmtid;
  else if (nmtidRetriesLeft <= 0 || crypto !== "eapi") all.NMTID = "00O" + randomHex(19);
  if (!all.MUSIC_U && anonymousToken) all.MUSIC_A = all.MUSIC_A || anonymousToken;
  return all;
}

function joinCookies(values) {
  return Object.keys(values).map(function (name) {
    return encodeURIComponent(name) + "=" + encodeURIComponent(values[name]);
  }).join("; ");
}

function cookieHeader(cookies, crypto) {
  return joinCookies(processCookies(cookies, crypto));
}

/** Cookie for the mobile (eapi) host: the device header object itself, mirrored into
 *  the Cookie the way the official apps do it. */
function headerCookie(header) {
  return joinCookies(header);
}

/** Capture the NMTID netease issues to a client that asked without one. Only a real
 *  probe — a request that carried none — consumes a retry. */
function absorbNmtid(response, sentNmtid) {
  if (nmtid || sentNmtid || nmtidRetriesLeft <= 0) return;
  nmtidRetriesLeft--;
  var values = response && response.setCookies instanceof Array ? response.setCookies : [];
  for (var i = 0; i < values.length; i++) {
    var match = /(?:^|;\s*)NMTID=([^;]+)/.exec(String(values[i]));
    if (match) { nmtid = match[1]; return; }
  }
}

/** Run the provider-owned 易盾 probe in QPlayer's generic system-WebView surface.
 * The reference implementation runs raw.I before getToken and never reuses tokens. */
function checkTokenFor(options) {
  if (!options || !options.checkToken) return Promise.resolve("");
  var originUrl = WEB_HOST + "/";
  return call("webAuth.runScript", {
    originUrl: originUrl,
    script: watchman.script(originUrl)
  }).then(watchman.tokenFromResult);
}

var anonymousToken = "";
var anonymousRequest = null;

/** Register an anonymous session so unauthenticated requests carry a real MUSIC_A
 *  instead of no account at all. Attempted once per plugin lifetime, like the
 *  reference client does at startup; a failure just leaves the token empty. */
function ensureAnonymousToken(cookies) {
  if (anonymousToken) return Promise.resolve(anonymousToken);
  if (anonymousRequest) return anonymousRequest;
  var deviceId = cookies.deviceId || "";
  anonymousRequest = xeapiTransport.anonymousUsername(deviceId).then(function (username) {
    return xeapiTransport.request("/api/register/anonimous", {username: username},
      xeapiContext(cookies), 15000, true);
  }).then(function (result) {
    var body = result.body || {};
    if (Number(body.code) !== 200) return "";
    var values = result.setCookies || [];
    for (var i = 0; i < values.length; i++) {
      var match = /(?:^|;\s*)MUSIC_A=([^;]+)/.exec(String(values[i]));
      if (match) { anonymousToken = match[1]; break; }
    }
    return anonymousToken;
  }, function () { return ""; });
  return anonymousRequest;
}

/** The cookie jar for an outgoing request. The first unauthenticated call kicks off
 *  anonymous registration without waiting on it, so the token joins later requests
 *  instead of delaying this one. */
function requestCookies() {
  return loadCookies().then(function (stored) {
    if (!stored.MUSIC_U && !anonymousToken && !anonymousRequest) {
      ensureAnonymousToken(stored);
    }
    return stored;
  });
}

function loadCookies() {
  return call("credentials.get", {key: "cookies"}).then(function (stored) {
    var cookies = {};
    if (stored) {
      try { cookies = JSON.parse(stored) || {}; } catch (_) { cookies = {}; }
    }
    return ensureDeviceCookies(cookies);
  });
}

/** Persist a stable deviceId + _ntes_nuid so the client fingerprint doesn't change
 *  between requests — a moving fingerprint itself trips risk control. */
function ensureDeviceCookies(cookies) {
  var changed = false;
  if (!cookies._ntes_nuid) { cookies._ntes_nuid = randomHex(32); changed = true; }
  if (!cookies.deviceId) { cookies.deviceId = generateDeviceId(); changed = true; }
  if (!changed) return Promise.resolve(cookies);
  return saveCookies(cookies).then(function () { return cookies; });
}

function saveCookies(cookies) {
  return call("credentials.put", {key: "cookies", value: JSON.stringify(cookies)});
}

function absorbCookies(cookies, response) {
  var values = response && response.setCookies instanceof Array ? response.setCookies : [];
  values.forEach(function (line) {
    var pair = String(line).split(";", 1)[0];
    var parsed = parseCookieHeader(pair);
    Object.keys(parsed).forEach(function (key) { cookies[key] = parsed[key]; });
  });
  return values.length ? saveCookies(cookies) : Promise.resolve(true);
}

/** The client header signed into the eapi body and mirrored into the Cookie. The
 *  identity fields come from the processed jar so they stay consistent with the
 *  Cookie the same request sends. */
function eapiClientHeader(cookies, token) {
  var header = {
    osver: cookies.osver,
    deviceId: cookies.deviceId,
    os: cookies.os,
    appver: cookies.appver,
    versioncode: cookies.versioncode || "140",
    mobilename: cookies.mobilename || "",
    buildver: cookies.buildver || String(Date.now()).slice(0, 10),
    resolution: cookies.resolution || "1920x1080",
    __csrf: cookies.__csrf || "",
    channel: cookies.channel,
    requestId: Date.now() + "_" + padLeft(Math.floor(Math.random() * 1000), 4, "0")
  };
  if (cookies.MUSIC_U) header.MUSIC_U = cookies.MUSIC_U;
  if (cookies.MUSIC_A) header.MUSIC_A = cookies.MUSIC_A;
  if (token) header["X-antiCheatToken"] = token;
  if (cookies.NMTID) header.NMTID = cookies.NMTID;
  return header;
}

function eapi(path, data, options) {
  options = options || {};
  return checkTokenFor(options).then(function (token) {
    return requestCookies().then(function (stored) {
      var source = stored;
      if (options.os) {
        // Take the whole platform identity, not just the os name.
        source = Object.assign({}, stored, {os: options.os});
        delete source.osver;
        delete source.appver;
        delete source.channel;
      }
      var cookies = processCookies(source, "eapi");
      var header = eapiClientHeader(cookies, token);
      var payload = Object.assign({}, data || {}, {e_r: false, header: header});
      var json = JSON.stringify(payload);
      return call("crypto.digest", {
        algorithm: "MD5", data: "nobody" + path + "use" + json + "md5forencrypt",
        outputEncoding: "hex"
      }).then(function (digest) {
        var signed = path + "-36cd479b6b5-" + json + "-36cd479b6b5-" + digest;
        return call("crypto.aes", {
          transformation: "AES/ECB/PKCS5Padding", operation: "encrypt",
          key: EAPI_KEY, keyEncoding: "utf8", data: signed, dataEncoding: "utf8",
          outputEncoding: "hex"
        });
      }).then(function (params) {
        return call("http.request", {
          url: (options.domain || EAPI_HOST) + "/eapi/" + path.slice(5), method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": cookies.os === "osx" ? OSX_UA : EAPI_UA,
            "Referer": WEB_HOST,
            "Cookie": headerCookie(header)
          },
          body: form({params: String(params).toUpperCase()}),
          timeoutMs: options.timeoutMs || 15000
        });
      }).then(function (response) {
        absorbNmtid(response, !!cookies.NMTID);
        return absorbCookies(stored, response).then(function () {
          if (response.status < 200 || response.status >= 300) throw new Error("HTTP " + response.status);
          var body = JSON.parse(response.body || "{}");
          if (body.code && ACCEPTED_CODES.indexOf(Number(body.code)) < 0) {
            throw new Error(body.message || body.msg || ("API " + body.code));
          }
          return body;
        });
      });
    });
  });
}

function xeapiContext(cookies) {
  var processed = processCookies(cookies, "xeapi");
  return {
    deviceId: processed.deviceId || "",
    musicU: processed.MUSIC_U || "",
    ip: clientIp(),
    cookie: processed
  };
}

/** POST through the xeapi transport. Netease risk-controls the eapi host hard on the
 *  song-url endpoint; the official Android app moved it here, so we follow. */
function xeapi(path, data, timeoutMs) {
  return loadCookies().then(function (cookies) {
    return xeapiTransport.request(path, data, xeapiContext(cookies), timeoutMs)
      .then(function (body) {
        if (body.code && ACCEPTED_CODES.indexOf(Number(body.code)) < 0) {
          throw new Error(body.message || body.msg || ("API " + body.code));
        }
        return body;
      });
  });
}

function weapi(path, data, options) {
  options = options || {};
  return checkTokenFor(options).then(function (token) {
    return weapiCall(path, data, token, options);
  });
}

function weapiCall(path, data, token, options) {
  return requestCookies().then(function (cookies) {
    var payload = Object.assign({}, data || {}, {csrf_token: cookies.__csrf || ""});
    var first;
    var secret;
    var params;
    return call("crypto.aes", {
      transformation: "AES/CBC/PKCS5Padding", key: PRESET_KEY, keyEncoding: "utf8",
      iv: IV, ivEncoding: "utf8", data: JSON.stringify(payload), dataEncoding: "utf8",
      outputEncoding: "base64"
    }).then(function (value) {
      first = value;
      return base62Secret();
    }).then(function (value) {
      secret = value;
      return call("crypto.aes", {
        transformation: "AES/CBC/PKCS5Padding", key: secret, keyEncoding: "utf8",
        iv: IV, ivEncoding: "utf8", data: first, dataEncoding: "utf8",
        outputEncoding: "base64"
      });
    }).then(function (value) {
      params = value;
      return call("crypto.modPow", {
        baseHex: utf8Hex(secret.split("").reverse().join("")), exponentHex: RSA_EXPONENT,
        modulusHex: RSA_MODULUS, width: 256
      });
    }).then(function (encSecKey) {
      var headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": WEAPI_UA,
        "Referer": WEB_HOST, "Origin": WEB_HOST,
        "Cookie": cookieHeader(cookies, "weapi")
      };
      if (token) headers["X-antiCheatToken"] = token;
      return call("http.request", {
        url: WEB_HOST + "/weapi/" + path.replace(/^\/?api\//, ""), method: "POST",
        headers: headers,
        body: form({params: params, encSecKey: encSecKey}),
        timeoutMs: options.timeoutMs || 15000
      });
    }).then(function (response) {
      return absorbCookies(cookies, response).then(function () {
        if (response.status < 200 || response.status >= 300) throw new Error("HTTP " + response.status);
        var body = JSON.parse(response.body || "{}");
        if (body.code && ACCEPTED_CODES.indexOf(Number(body.code)) < 0) {
          throw new Error(body.message || body.msg || ("API " + body.code));
        }
        return body;
      });
    });
  });
}

function artistRefs(song) {
  return (song.ar || song.artists || []).map(function (artist) {
    return {id: String(artist.id), name: artist.name || ""};
  });
}

function songDto(song) {
  var album = song.al || song.album || {};
  return {
    id: String(song.id), title: song.name || "", artists: artistRefs(song),
    album: album.id ? {id: String(album.id), name: album.name || ""} : null,
    durationMs: Number(song.dt || song.duration || 0),
    artworkUrl: secureUrl(album.picUrl || album.blurPicUrl || ""),
    artworkThumbUrl: thumbUrl(album.picUrl || album.blurPicUrl || ""),
    playable: !(song.noCopyrightRcmd), trial: false
  };
}

/**
 * 「XX喜欢的音乐」是账号自带的歌单,删不掉。网易云用 specialType 5 标记它,列表和
 * 详情两个接口都会带上;之前详情这边没判断,打开它时右上角会多出一个删除按钮。
 */
function isFavoritePlaylist(value) {
  return Number((value || {}).specialType || 0) === 5;
}

function playlistDto(value) {
  value = value || {};
  var creator = value.creator || {};
  return {
    id: String(value.id || ""), name: value.name || "",
    description: value.description || "",
    artworkUrl: secureUrl(value.picUrl || value.coverImgUrl || ""),
    artworkThumbUrl: thumbUrl(value.picUrl || value.coverImgUrl || "", 300),
    owner: creator.userId ? {id: String(creator.userId), name: creator.nickname || ""} : null,
    trackCount: Number(value.trackCount || 0), playCount: Number(value.playCount || 0),
    subscribed: !!value.subscribed, owned: false
  };
}

function albumDto(value, songs) {
  value = value || {};
  var artists = value.artists || (value.artist ? [value.artist] : []);
  return {
    id: String(value.id || ""), name: value.name || "",
    artworkUrl: secureUrl(value.picUrl || value.blurPicUrl || ""),
    artworkThumbUrl: thumbUrl(value.picUrl || value.blurPicUrl || "", 300),
    publishTimeMs: Number(value.publishTime || 0), description: value.description || "",
    trackCount: Number(value.size || value.trackCount || (songs || []).length),
    artists: artists.map(function (artist) {
      return {id: String(artist.id), name: artist.name || ""};
    }),
    songs: (songs || []).map(songDto)
  };
}

function artistDto(value, songs, albums) {
  value = value || {};
  return {
    id: String(value.id || ""), name: value.name || "",
    artworkUrl: secureUrl(value.picUrl || value.img1v1Url || value.cover || ""),
    artworkThumbUrl: thumbUrl(value.picUrl || value.img1v1Url || value.cover || "", 300),
    description: value.briefDesc || value.briefIntroduction || "",
    albumCount: Number(value.albumSize || 0), songCount: Number(value.musicSize || 0),
    songs: (songs || []).map(songDto), albums: albums || []
  };
}

function searchPage(args, type, resultKey, mapper) {
  var offset = Number(args.cursor || 0);
  return eapi("/api/cloudsearch/pc", {
    s: args.query || "", type: type, limit: Number(args.limit || 50),
    offset: offset, total: true
  }).then(function (body) {
    var result = body.result || {};
    var items = result[resultKey] || [];
    var total = Number(result[resultKey.slice(0, -1) + "Count"] || items.length);
    return {items: items.map(mapper), nextCursor: offset + items.length < total
      ? String(offset + items.length) : ""};
  });
}

function searchAlbums(args) {
  return searchPage(args, 10, "albums", function (album) { return albumDto(album, []); });
}

function searchArtists(args) {
  return searchPage(args, 100, "artists", function (artist) { return artistDto(artist, [], []); });
}

function hotSearch() {
  return weapi("hotsearchlist/get", {}).then(function (body) {
    var values = body.data || body.result && body.result.hots || [];
    return values.map(function (item) { return item.searchWord || item.first || ""; })
      .filter(function (value) { return !!value; });
  });
}

function personalizedPlaylists(limit) {
  return weapi("personalized/playlist", {limit: Number(limit || 12), total: true, n: 1000})
    .then(function (body) { return (body.result || []).map(playlistDto); });
}

function recommendSongs() {
  return weapi("v3/discovery/recommend/songs", {afresh: false}).then(function (body) {
    var songs = body.data && body.data.dailySongs || body.recommend || [];
    return songs.map(songDto);
  });
}

/** One playlist card out of a 首页-发现 block resource. */
function blockPlaylistDto(resource) {
  var ui = resource.uiElement || {};
  var ext = resource.resourceExtInfo || {};
  return {
    id: String(resource.resourceId || ""),
    name: (ui.mainTitle || {}).title || "",
    description: (ui.subTitle || {}).title || "",
    artworkUrl: secureUrl((ui.image || {}).imageUrl || ""),
    artworkThumbUrl: thumbUrl((ui.image || {}).imageUrl || "", 300),
    owner: null,
    // Block cards carry no track count, only a play count; the host falls back
    // to that rather than claiming the playlist is empty.
    trackCount: Number(ext.trackCount || 0),
    playCount: Number(ext.playCount || 0),
    subscribed: false, owned: false
  };
}

/** Playlists inside a 首页-发现 block; the API calls them "list", not "playlist". */
function blockPlaylists(block, seen) {
  var out = [];
  (block.creatives || []).forEach(function (creative) {
    (creative.resources || []).forEach(function (resource) {
      var type = String(resource.resourceType || "").toLowerCase();
      if (type !== "list" && type !== "playlist") return;
      var item = blockPlaylistDto(resource);
      // The same playlist shows up in several blocks and again in the plain
      // recommendation grid; the first group to claim it keeps it.
      if (!item.id || !item.name || seen[item.id]) return;
      seen[item.id] = true;
      out.push(item);
    });
  });
  return out;
}

/**
 * 首页-发现的歌单分组:雷达歌单、专属场景歌单…官方 App 把它们各自成组,混进
 * 推荐歌单里就找不着了。跳过官方的「推荐歌单」块,那批歌单由 personalized
 * 那条路走,数量还受用户设置控制。需要登录。
 */
function homeSections(seen) {
  return weapi("homepage/block/page", {refresh: false, cursor: ""}).then(function (body) {
    var blocks = (body.data || {}).blocks || [];
    var sections = [];
    blocks.forEach(function (block) {
      if (String(block.blockCode || "") === "HOMEPAGE_BLOCK_PLAYLIST_RCMD") return;
      var ui = block.uiElement || {};
      var title = (ui.mainTitle || {}).title || (ui.subTitle || {}).title || "";
      if (!title) return;
      var playlists = blockPlaylists(block, seen);
      // A single card is not worth a heading of its own.
      if (playlists.length > 1) {
        sections.push({title: title, playlists: playlists.slice(0, 30)});
      }
    });
    return sections.slice(0, 6);
  }, function () { return []; });
}

function home(args) {
  if (args.operation === "recommendSongs") return recommendSongs();
  var limit = Math.max(1, Number(args.limit || 12));
  var claimed = {};
  return loadCookies().then(function (cookies) {
    var loggedIn = !!cookies.MUSIC_U;
    return Promise.all([
      // Ask for extra: the ones a section already claimed are dropped below, and
      // the user asked to see `limit` playlists, not `limit` minus the overlap.
      personalizedPlaylists(limit + 15),
      loggedIn ? recommendSongs().catch(function () { return []; }) : [],
      loggedIn ? homeSections(claimed) : []
    ]);
  }).then(function (values) {
    var playlists = values[0].filter(function (item) {
      return !claimed[item.id];
    }).slice(0, limit);
    return {playlists: playlists, songs: values[1], sections: values[2]};
  });
}

var SONG_DETAIL_BATCH = 200;

function songDetails(nativeIds) {
  var ids = [];
  (nativeIds || []).forEach(function (id) {
    if (id !== undefined && id !== null && String(id) !== "") ids.push(id);
  });
  if (!ids.length) return Promise.resolve([]);
  return mapBatches(ids, SONG_DETAIL_BATCH, function (batch) {
    var c = "[" + batch.map(function (id) { return JSON.stringify({id: Number(id)}); }).join(",") + "]";
    return weapi("v3/song/detail", {c: c}).then(function (body) {
      return (body.songs || []).map(songDto);
    });
  });
}

function mapBatches(values, size, mapper) {
  var acc = [];
  function next(offset) {
    if (offset >= values.length) return Promise.resolve(acc);
    return mapper(values.slice(offset, offset + size)).then(function (part) {
      acc = acc.concat(part || []);
      return next(offset + size);
    });
  }
  return next(0);
}

function playlistDetails(args) {
  return Promise.all([
    eapi("/api/v6/playlist/detail", {id: args.id, n: 100000, s: 8}, {timeoutMs: 30000}),
    account()
  ]).then(function (values) {
      var body = values[0];
      var profile = values[1];
      var playlist = body.playlist || {};
      var tracks = playlist.tracks || [];
      var trackIds = (playlist.trackIds || []).map(function (item) { return String(item.id); })
        .filter(function (id) { return !!id && id !== "undefined"; });
      var songs = tracks.map(songDto);
      var have = {};
      songs.forEach(function (song) { have[String(song.id)] = true; });
      var missing = trackIds.filter(function (id) { return !have[id]; });
      var loadMissing = missing.length ? songDetails(missing) : Promise.resolve([]);
      return loadMissing.then(function (extra) {
        var byId = {};
        songs.concat(extra).forEach(function (song) { byId[String(song.id)] = song; });
        var ordered = trackIds.length
          ? trackIds.map(function (id) { return byId[id]; }).filter(Boolean)
          : songs.concat(extra);
        var result = playlistDto(playlist);
        result.owned = !!(profile.loggedIn && playlist.creator
          && String(playlist.creator.userId) === String(profile.id));
        result.mutable = result.owned;
        result.deletable = result.owned && !isFavoritePlaylist(playlist);
        result.songs = ordered;
        return result;
      });
    });
}

function artistDetails(args) {
  return Promise.all([
    weapi("v1/artist/" + args.id, {}),
    weapi("artist/albums/" + args.id, {limit: 50, offset: 0, total: true})
  ]).then(function (values) {
    var artistBody = values[0];
    var albums = (values[1].hotAlbums || []).map(function (album) { return albumDto(album, []); });
    return artistDto(artistBody.artist || {}, artistBody.hotSongs || [], albums);
  });
}

function albumDetails(args) {
  return weapi("v1/album/" + args.id, {}).then(function (body) {
    return albumDto(body.album || {}, body.songs || []);
  });
}

function recent(args) {
  return loadCookies().then(function (cookies) {
    if (!cookies.MUSIC_U) return [];
    return weapi("play-record/song/list", {limit: Number(args.limit || 100)})
      .then(function (body) {
        var values = body.data && body.data.list || body.allData || [];
        return values.map(function (row) { return songDto(row.data || row.song || row); });
      });
  });
}

function userPlaylists(args) {
  return account().then(function (profile) {
    if (!profile.loggedIn) return [];
    return weapi("user/playlist", {uid: Number(profile.id), limit: Number(args.limit || 100),
      offset: 0, includeVideo: true}).then(function (body) {
        return (body.playlist || []).map(function (value) {
          var playlist = playlistDto(value);
          playlist.owned = !!(value.creator && String(value.creator.userId) === String(profile.id));
          playlist.mutable = playlist.owned;
          playlist.deletable = playlist.owned && !isFavoritePlaylist(value);
          return playlist;
        });
      });
  });
}

function like(args) {
  if (args.operation === "list") {
    return account().then(function (profile) {
      if (!profile.loggedIn) return [];
      return eapi("/api/song/like/get", {uid: Number(profile.id)}).then(function (body) {
        return (body.ids || []).map(String);
      });
    });
  }
  if (args.operation !== "set") throw new Error("未知喜欢操作");
  return weapi("radio/like", {
    trackId: Number(args.id), like: !!args.liked, alg: "itembased", time: 3
  }).then(function (body) { return Number(body.code || 0) === 200; });
}

function playlistMutation(args) {
  var op = String(args.operation || "");
  if (op === "create") {
    return weapi("playlist/create", {
      name: String(args.name || ""), privacy: args.private ? "10" : "0", type: "NORMAL"
    }).then(function (body) {
      var id = body.id || body.playlist && body.playlist.id;
      if (!id) throw new Error("创建歌单失败");
      return {success: true, id: String(id)};
    });
  }
  if (op === "delete") {
    return weapi("playlist/remove", {ids: "[" + args.playlistId + "]"})
      .then(function (body) { return Number(body.code || 0) === 200; });
  }
  if (op === "subscribe" || op === "unsubscribe") {
    var subscribing = op === "subscribe";
    var path = subscribing ? "playlist/subscribe" : "playlist/unsubscribe";
    var body = {id: Number(args.playlistId)};
    if (subscribing) body.checkToken = CHECK_TOKEN;
    return eapi("/api/" + path, body, {checkToken: true})
      .then(function (result) { return Number(result.code || 0) === 200; });
  }
  if (op === "add" || op === "remove") {
    var ids = args.songIds || [];
    return eapi("/api/playlist/manipulate/tracks", {
      op: op === "add" ? "add" : "del", pid: Number(args.playlistId),
      trackIds: JSON.stringify(ids.map(Number)), imme: "true"
    }).then(function (body) { return Number(body.code || 0) === 200; });
  }
  throw new Error("未知歌单操作");
}

/** Replace a playlist's artwork. Two steps, mirroring the official web client:
 *  nos/token/alloc hands back an upload token plus an object key, then the raw
 *  image bytes are POSTed straight to the NOS host carrying that token. Unlike
 *  every other write here that second request is neither weapi- nor eapi-encrypted
 *  — it is a plain authenticated binary upload, which is why it goes out as
 *  bodyBase64 rather than the text body every other call uses.
 *
 *  ext and Content-Type stay "jpg"/"image/jpeg" whatever the user picked: NOS is
 *  only object storage, and the server re-encodes from docId when the cover is
 *  applied, so the pair merely has to agree with itself. */
function playlistCover(args) {
  var playlistId = Number(args.playlistId);
  if (!playlistId) throw new Error("缺少歌单 ID");
  var imageBase64 = String(args.imageBase64 || "");
  if (!imageBase64) throw new Error("图片为空");
  var filename = String(args.filename || "") || "cover.jpg";
  return weapi("nos/token/alloc", {
    bucket: "yyimgs",
    ext: "jpg",
    filename: filename,
    local: false,
    nos_product: 0,
    return_body: "{\"code\":200,\"size\":\"$(ObjectSize)\"}",
    type: "other"
  }).then(function (body) {
    var result = body.result || {};
    if (!result.objectKey || !result.token || !result.docId) {
      throw new Error("获取上传凭证失败");
    }
    return call("http.request", {
      url: "https://nosup-hz1.127.net/yyimgs/" + result.objectKey
        + "?offset=0&complete=true&version=1.0",
      method: "POST",
      headers: {"x-nos-token": String(result.token), "Content-Type": "image/jpeg"},
      bodyBase64: imageBase64,
      timeoutMs: 30000
    }).then(function (response) {
      if (response.status < 200 || response.status >= 300) {
        throw new Error("图片上传失败 HTTP " + response.status);
      }
      return weapi("playlist/cover/update", {
        id: playlistId, coverImgId: Number(result.docId)
      });
    });
  }).then(function (body) {
    return {success: Number(body.code || 0) === 200};
  });
}

/** Listening report. The reference client sends two eapi weblogs to the client-log
 *  host under an os=osx jar: "startplay" puts the song in 最近播放, "play" credits the
 *  listening count. */
function scrobble(args) {
  return loadCookies().then(function (cookies) {
    if (!cookies.MUSIC_U || Number(args.playedMs || 0) < 3000) return true;
    var sourceId = args.sourceId ? String(args.sourceId) : "";
    var options = {domain: CLIENT_LOG_HOST, os: "osx"};
    var startplay = {action: "startplay", json: {
      id: Number(args.id), type: "song", mainsite: "1", mainsiteWeb: "1",
      content: "id=" + sourceId
    }};
    var play = {action: "play", json: {
      download: 0, end: args.completed ? "playend" : "ui", id: Number(args.id),
      sourceId: sourceId, time: Math.floor(Number(args.playedMs || 0) / 1000),
      type: "song", wifi: 0, source: "list", mainsite: "1", mainsiteWeb: "1",
      content: "id=" + sourceId
    }};
    return eapi("/api/feedback/weblog", {logs: JSON.stringify([startplay])}, options)
      .then(function () {
        return eapi("/api/feedback/weblog", {logs: JSON.stringify([play])}, options);
      })
      .then(function () { return true; }, function () { return true; });
  });
}

function heartRecommendation(args) {
  return eapi("/api/playmode/intelligence/list", {
    songId: Number(args.songId), type: "fromPlayOne",
    playlistId: Number(args.playlistId), startMusicId: Number(args.songId), count: 1
  }).then(function (body) {
    var rows = body.data || [];
    var embedded = rows.filter(function (row) { return !!row.songInfo; })
      .map(function (row) { return songDto(row.songInfo); });
    if (embedded.length === rows.length) return embedded.slice(0, Number(args.limit || 100));
    var ids = rows.map(function (row) { return row.id || row.songInfo && row.songInfo.id; })
      .filter(Boolean).map(String);
    return songDetails(ids).then(function (songs) { return songs.slice(0, Number(args.limit || 100)); });
  });
}

function share(args) {
  var kind = String(args.kind || "song");
  if (kind !== "song" && kind !== "playlist" && kind !== "album" && kind !== "artist") {
    throw new Error("不支持分享该媒体类型");
  }
  return "https://music.163.com/#/" + kind + "?id=" + encodeURIComponent(String(args.id));
}

function searchSongs(args) {
  var offset = Number(args.cursor || 0);
  return eapi("/api/cloudsearch/pc", {
    s: args.query || "", type: 1, limit: Number(args.limit || 50), offset: offset, total: true
  }).then(function (body) {
    var songs = body.result && body.result.songs || [];
    var total = body.result && Number(body.result.songCount || songs.length);
    return {items: songs.map(songDto), nextCursor: offset + songs.length < total
      ? String(offset + songs.length) : ""};
  });
}

function officialStream(args) {
  return xeapi("/api/song/enhance/player/url/v1", {
    ids: "[" + args.id + "]", level: args.quality || "exhigh", encodeType: "flac"
  }).then(function (body) {
    var item = body.data && body.data[0];
    if (!item || !item.url) return {ok: false};
    return {
      ok: true,
      trial: !!item.freeTrialInfo,
      stream: {
        url: secureUrl(item.url), headers: {}, mimeType: item.type || "",
        expiresAtMs: Date.now() + 15 * 60 * 1000,
        trial: !!item.freeTrialInfo, cacheable: !item.freeTrialInfo
      }
    };
  }, function () { return {ok: false}; });
}

function resolveStream(args) {
  return officialStream(args).then(function (official) {
    if (official.ok && !official.trial) return official.stream;
    return unblock.resolve({
      songId: args.id,
      official: official,
      songDetails: function () { return songDetails([args.id]); }
    });
  });
}

function lyrics(args) {
  function providerLyrics() { return eapi("/api/song/lyric/v1", {
    id: args.id, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0
  }).then(function (body) {
    var assets = [];
    if (body.yrc && body.yrc.lyric) assets.push({format: "yrc", role: "original", text: body.yrc.lyric});
    else if (body.lrc && body.lrc.lyric) assets.push({format: "lrc", role: "original", text: body.lrc.lyric});
    if (body.tlyric && body.tlyric.lyric) assets.push({format: "lrc", role: "translation", text: body.tlyric.lyric});
    if (body.romalrc && body.romalrc.lyric) assets.push({format: "lrc", role: "romanization", text: body.romalrc.lyric});
    return {assets: assets};
  }); }
  return call("http.request", {
    url: AMLL_HOST + "/ncm-lyrics/" + encodeURIComponent(args.id) + ".ttml",
    method: "GET", timeoutMs: 8000
  }).then(function (response) {
    if (response.status === 200 && String(response.body || "").trim()) {
      return {assets: [{format: "ttml", role: "original", text: response.body}]};
    }
    return providerLyrics();
  }, function () { return providerLyrics(); });
}

function account() {
  return loadCookies().then(function (cookies) {
    if (!cookies.MUSIC_U) return {loggedIn: false};
    return weapi("w/nuser/account/get", {}).then(function (body) {
      var profile = body.profile || {};
      var result = {
        loggedIn: !!profile.userId,
        id: profile.userId ? String(profile.userId) : "",
        displayName: profile.nickname || "",
        avatarUrl: profile.avatarUrl || "",
        membershipTier: Number(profile.vipType || profile.vipRights && profile.vipRights.redVipLevel || 0),
        level: Number(profile.level || body.level || 0),
        signature: profile.signature || ""
      };
      if (!result.loggedIn) return result;
      // account/get does not normally include a level. The level endpoint
      // returns it under data, separately from the account profile.
      return weapi("user/level", {}).then(function (levelBody) {
        var level = levelBody.data && levelBody.data.level;
        if (level !== undefined && level !== null && level !== ""
            && isFinite(Number(level)) && Number(level) >= 0) {
          result.level = Number(level);
        }
        return result;
      }, function () {
        // A failed optional lookup must not turn a valid session into a
        // failed login (credential login would otherwise delete its cookie).
        return result;
      });
    });
  });
}

function roomDto(raw) {
  raw = raw || {};
  var users = raw.roomUsers || raw.users || [];
  return {
    id: String(raw.roomId || ""),
    creatorAccountId: raw.creatorId ? String(raw.creatorId) : "",
    effectiveDurationMs: Number(raw.effectiveDurationMs || 0),
    members: users.map(function (user) {
      return {id: String(user.userId || ""), displayName: user.nickname || "",
        avatarUrl: secureUrl(user.avatarUrl || "")};
    })
  };
}

function responseRoom(body, fallbackId) {
  var data = body.data || {};
  var room = data.roomInfo || data;
  if (!room.roomId && fallbackId) room.roomId = fallbackId;
  return roomDto(room);
}

function listenTogether(args) {
  switch (args.operation) {
    case "create":
      return eapi("/api/listen/together/room/create", {refer: "songplay_more"})
        .then(function (body) { return responseRoom(body, ""); });
    case "status":
      return weapi("listen/together/status/get", {}).then(function (body) {
        var data = body.data || {};
        return {inRoom: !!data.inRoom, status: data.status || "",
          room: data.roomInfo ? roomDto(data.roomInfo) : null};
      });
    case "check":
      return eapi("/api/listen/together/room/check", {roomId: args.roomId})
        .then(function (body) { return !!(body.data && body.data.joinable); });
    case "join":
      return eapi("/api/listen/together/play/invitation/accept", {
        refer: "inbox_invite", roomId: args.roomId,
        inviterId: args.inviterAccountId || "0"
      }).then(function (body) { return responseRoom(body, args.roomId); });
    case "snapshot":
      return eapi("/api/listen/together/sync/playlist/get", {roomId: args.roomId})
        .then(function (body) {
          var data = body.data || {};
          var playlist = data.playlist || {};
          var mode = String(playlist.playMode || "").toUpperCase();
          var list = mode.indexOf("RANDOM") >= 0 || mode.indexOf("SHUFFLE") >= 0
            ? playlist.randomList : playlist.displayList;
          list = list || playlist.displayList || {};
          var rawCommand = data.playCommand || data.commandInfo;
          var command = null;
          if (rawCommand) {
            var type = rawCommand.commandType || "";
            var playStatus = String(rawCommand.playStatus || "").toUpperCase();
            command = {
              accountId: rawCommand.userId ? String(rawCommand.userId) : "",
              type: type,
              formerSongId: rawCommand.formerSongId ? String(rawCommand.formerSongId) : "",
              targetSongId: rawCommand.targetSongId ? String(rawCommand.targetSongId) : "",
              progressMs: Number(rawCommand.progress || 0),
              playing: type === "PLAY" || type === "GOTO" || type === "NEXT"
                || type === "PREV" || playStatus === "PLAY" || playStatus === "PLAYING",
              sequence: Number(rawCommand.serverSeq || 0)
            };
          }
          return {songIds: (list.result || []).map(String), command: command};
        });
    case "reportPlaylist": {
      var version = [{userId: Number(args.accountId || 0), version: Number(args.version || 0)}];
      var playlist = {commandType: "REPLACE", version: version,
        anchorSongId: "", anchorPosition: -1,
        randomList: args.songIds || [], displayList: args.songIds || []};
      return eapi("/api/listen/together/sync/list/command/report", {
        roomId: args.roomId, playlistParam: JSON.stringify(playlist)
      }).then(function () { return true; });
    }
    case "reportCommand": {
      var commandInfo = {commandType: args.type,
        progress: Math.max(0, Number(args.progressMs || 0)),
        playStatus: args.playing ? "PLAY" : "PAUSE",
        formerSongId: String(args.formerSongId || "0"),
        targetSongId: String(args.targetSongId || "0"),
        clientSeq: Number(args.sequence || 0)};
      return eapi("/api/listen/together/play/command/report", {
        roomId: args.roomId, commandInfo: JSON.stringify(commandInfo)
      }).then(function () { return true; });
    }
    case "heartbeat":
      return eapi("/api/listen/together/heartbeat", {roomId: args.roomId,
        songId: args.songId || "0", playStatus: args.playing ? "PLAY" : "PAUSE",
        progress: Math.max(0, Number(args.progressMs || 0))})
        .then(function () { return true; });
    case "end":
      return eapi("/api/listen/together/end/v2", {roomId: args.roomId})
        .then(function () { return true; });
    default: throw new Error("未知一起听操作");
  }
}

function login(args) {
  switch (args.operation) {
    case "methods":
      return [
        {id: "qr", type: "qr", label: "扫码", instructions: "请使用网易云音乐 App 扫码"},
        {id: "web", type: "web", label: "网页登录",
          instructions: "将在系统 WebView 中打开网易云官网。登录成功后，QPlayer 会自动读取登录 Cookie、验证账号并加密保存。",
          webUrl: "https://music.163.com/#/login", cookieUrl: "https://music.163.com/",
          credentialCookieName: "MUSIC_U"},
        {id: "cookie", type: "credential", label: "Cookie",
          instructions: "在 music.163.com 登录后按 F12，复制请求头中的 Cookie 值并粘贴到下方。Cookie 仅用于验证，成功后会加密保存。",
          credentialLabel: "Cookie 请求头"}
      ];
    case "begin": {
      if (args.methodId !== "qr") throw new Error("该登录方式不需要创建挑战");
      return eapi("/api/login/qrcode/unikey", {type: 3}).then(function (keyBody) {
        var key = keyBody.unikey || keyBody.data && keyBody.data.unikey;
        if (!key) throw new Error("未能获取二维码密钥");
        return {id: key, methodId: "qr", status: "waiting",
          qrContent: "https://music.163.com/login?codekey=" + encodeURIComponent(key),
          expiresAtMs: Date.now() + 3 * 60 * 1000};
      });
    }
    case "poll": {
      return eapi("/api/login/qrcode/client/login", {key: args.challengeId, type: 3}).then(function (result) {
        if (result.code === 803) return {id: args.challengeId, methodId: "qr", status: "success"};
        if (result.code === 802) return {id: args.challengeId, methodId: "qr", status: "scanned"};
        if (result.code === 800) return {id: args.challengeId, methodId: "qr", status: "expired"};
        return {id: args.challengeId, methodId: "qr", status: "waiting"};
      });
    }
    case "submit": {
      var imported = parseCookieHeader(args.credential || "");
      if (!imported.MUSIC_U) return {methodId: args.methodId, status: "failed", message: "Cookie 中缺少 MUSIC_U"};
      // Carry the existing device identity over to the imported jar: a login that resets
      // deviceId/_ntes_nuid looks like a brand-new device to risk control.
      return loadCookies().then(function (existing) {
        var candidate = {};
        if (existing._ntes_nuid) candidate._ntes_nuid = existing._ntes_nuid;
        if (existing.deviceId) candidate.deviceId = existing.deviceId;
        Object.keys(imported).forEach(function (name) { candidate[name] = imported[name]; });
        if (!candidate._ntes_nuid) candidate._ntes_nuid = randomHex(32);
        if (!candidate.deviceId) candidate.deviceId = randomHex(16);
        return saveCookies(candidate);
      }).then(function () {
        return account();
      }).then(function (profile) {
        if (!profile.loggedIn) throw new Error("登录凭据无效");
        return {methodId: args.methodId, status: "success", account: profile};
      }, function (error) {
        return call("credentials.delete", {key: "cookies"}).then(function () {
          return {methodId: args.methodId, status: "failed", message: String(error.message || error)};
        });
      });
    }
    case "logout":
      // Tell the server first so the session really ends; it may 301, which is fine —
      // the local jar is cleared either way.
      return eapi("/api/logout", {}).then(function () { return true; }, function () { return true; })
        .then(function () { return call("credentials.delete", {key: "cookies"}); })
        .then(function () { return true; });
    default: throw new Error("未知登录操作");
  }
}

var unblock = require("./unblock");
var togetherFeature = require("./together").create({
  request: listenTogether,
  songs: function (ids) { return songDetails(ids || []); },
  account: account
});

module.exports = {handlers: {
  hotSearch: hotSearch,
  searchSongs: searchSongs,
  searchAlbums: searchAlbums,
  searchArtists: searchArtists,
  home: home,
  songDetails: function (args) { return songDetails(args.ids || []); },
  playlistDetails: playlistDetails,
  artistDetails: artistDetails,
  albumDetails: albumDetails,
  recent: recent,
  userPlaylists: userPlaylists,
  scrobble: scrobble,
  like: like,
  playlistMutation: playlistMutation,
  playlistCover: playlistCover,
  heartRecommendation: heartRecommendation,
  share: share,
  resolveStream: resolveStream,
  lyrics: lyrics,
  account: account,
  login: login,
  backgroundTick: togetherFeature.tick,
  "ui.listen-together": togetherFeature.ui,
  "ui.unblock": unblock.ui
}};
