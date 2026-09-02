"use strict";

var PRESET_KEY = "0CoJUm6Qyw8W8jud";
var EAPI_KEY = "e82ckenh8dichen8";
var IV = "0102030405060708";
var RSA_EXPONENT = "010001";
var RSA_MODULUS = "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
var EAPI_HOST = "https://interfacepc.music.163.com";
var WEB_HOST = "https://music.163.com";
var AMLL_HOST = "https://amlldb.bikonoo.com";

function call(method, args) { return qplayer.call(method, args || {}); }

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

function cookieHeader(cookies) {
  return Object.keys(cookies).map(function (name) {
    return encodeURIComponent(name) + "=" + encodeURIComponent(cookies[name]);
  }).join("; ");
}

function loadCookies() {
  return call("credentials.get", {key: "cookies"}).then(function (stored) {
    if (!stored) return {};
    try { return JSON.parse(stored); } catch (_) { return {}; }
  });
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

function eapiClientHeader(cookies) {
  var now = Date.now();
  return {
    osver: cookies.osver || "16.2",
    deviceId: cookies.deviceId || "",
    os: cookies.os || "iPhone OS",
    appver: cookies.appver || "9.0.90",
    versioncode: cookies.versioncode || "140",
    mobilename: "",
    buildver: String(Math.floor(now / 1000)),
    resolution: "1920x1080",
    __csrf: cookies.__csrf || "",
    channel: cookies.channel || "distribution",
    requestId: now + "_" + padLeft(Math.floor(Math.random() * 1000), 4, "0"),
    MUSIC_U: cookies.MUSIC_U || "",
    MUSIC_A: cookies.MUSIC_A || ""
  };
}

function eapi(path, data, timeoutMs) {
  return loadCookies().then(function (cookies) {
    var header = eapiClientHeader(cookies);
    var payload = Object.assign({}, data || {}, {header: header, e_r: false});
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
        url: EAPI_HOST + "/eapi/" + path.slice(5), method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)",
          "Cookie": cookieHeader(header)
        },
        body: form({params: String(params).toUpperCase()}),
        timeoutMs: timeoutMs || 15000
      });
    }).then(function (response) {
      return absorbCookies(cookies, response).then(function () {
        if (response.status < 200 || response.status >= 300) throw new Error("HTTP " + response.status);
        var body = JSON.parse(response.body || "{}");
        if (body.code && body.code !== 200 && body.code !== 801 && body.code !== 802 && body.code !== 803) {
          throw new Error(body.message || body.msg || ("API " + body.code));
        }
        return body;
      });
    });
  });
}

function weapi(path, data) {
  return loadCookies().then(function (cookies) {
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
      return call("crypto.random", {length: 8, outputEncoding: "hex"});
    }).then(function (value) {
      secret = String(value).slice(0, 16);
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
      return call("http.request", {
        url: WEB_HOST + "/weapi/" + path.replace(/^\/?api\//, ""), method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "Referer": WEB_HOST, "Origin": WEB_HOST, "Cookie": cookieHeader(cookies)
        },
        body: form({params: params, encSecKey: encSecKey}), timeoutMs: 15000
      });
    }).then(function (response) {
      return absorbCookies(cookies, response).then(function () {
        if (response.status < 200 || response.status >= 300) throw new Error("HTTP " + response.status);
        var body = JSON.parse(response.body || "{}");
        if (body.code && body.code !== 200 && body.code !== 801 && body.code !== 802 && body.code !== 803) {
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
    playable: !(song.noCopyrightRcmd), trial: false
  };
}

function playlistDto(value) {
  value = value || {};
  var creator = value.creator || {};
  return {
    id: String(value.id || ""), name: value.name || "",
    description: value.description || "",
    artworkUrl: secureUrl(value.picUrl || value.coverImgUrl || ""),
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

function home(args) {
  if (args.operation === "recommendSongs") return recommendSongs();
  return loadCookies().then(function (cookies) {
    var songPromise = cookies.MUSIC_U ? recommendSongs().catch(function () { return []; })
      : Promise.resolve([]);
    return Promise.all([personalizedPlaylists(args.limit), songPromise]);
  }).then(function (values) { return {playlists: values[0], songs: values[1]}; });
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
    eapi("/api/v6/playlist/detail", {id: args.id, n: 100000, s: 8}, 30000),
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
        result.deletable = result.owned;
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
        var seenOwned = false;
        return (body.playlist || []).map(function (value) {
          var playlist = playlistDto(value);
          playlist.owned = !!(value.creator && String(value.creator.userId) === String(profile.id));
          playlist.mutable = playlist.owned;
          playlist.deletable = playlist.owned && seenOwned;
          if (playlist.owned) seenOwned = true;
          return playlist;
        });
      });
  });
}

function like(args) {
  if (args.operation === "list") {
    return account().then(function (profile) {
      if (!profile.loggedIn) return [];
      return weapi("song/like/get", {uid: Number(profile.id)}).then(function (body) {
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
    var path = op === "subscribe" ? "playlist/subscribe" : "playlist/unsubscribe";
    return eapi("/api/" + path, {id: Number(args.playlistId)})
      .then(function (body) { return Number(body.code || 0) === 200; });
  }
  if (op === "add" || op === "remove") {
    var ids = args.songIds || [];
    return weapi("playlist/manipulate/tracks", {
      op: op === "add" ? "add" : "del", pid: Number(args.playlistId),
      trackIds: JSON.stringify(ids.map(Number)), imme: "true"
    }).then(function (body) { return Number(body.code || 0) === 200; });
  }
  throw new Error("未知歌单操作");
}

function scrobble(args) {
  return loadCookies().then(function (cookies) {
    if (!cookies.MUSIC_U || Number(args.playedMs || 0) < 3000) return true;
    var event = {action: "play", json: {
      type: "song", wifi: 0, download: 0, id: Number(args.id),
      time: Math.floor(Number(args.playedMs || 0) / 1000),
      end: args.completed ? "playend" : "ui", source: "list", sourceId: 0,
      mainsite: 1, content: ""
    }};
    return weapi("feedback/weblog", {logs: JSON.stringify([event])})
      .then(function () { return true; });
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
  return eapi("/api/song/enhance/player/url/v1", {
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
      return {
        loggedIn: !!profile.userId,
        id: profile.userId ? String(profile.userId) : "",
        displayName: profile.nickname || "",
        avatarUrl: profile.avatarUrl || "",
        membershipTier: Number(profile.vipType || profile.vipRights && profile.vipRights.redVipLevel || 0),
        level: Number(profile.level || body.level || 0),
        signature: profile.signature || ""
      };
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
      var cookies = parseCookieHeader(args.credential || "");
      if (!cookies.MUSIC_U) return {methodId: args.methodId, status: "failed", message: "Cookie 中缺少 MUSIC_U"};
      return saveCookies(cookies).then(function () {
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
      return call("credentials.delete", {key: "cookies"}).then(function () { return true; });
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
