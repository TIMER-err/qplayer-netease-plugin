"use strict";

function create(api) {
  var state = {
    initialized: false, initializing: null, inRoom: false, busy: false,
    room: null, accountId: "", leaderId: "", error: "",
    lastSongId: "", lastQueue: "", lastPlaying: false, lastSeekRevision: 0,
    lastEndRevision: 0, lastRemoteSequence: -1, lastRemoteSignature: "",
    commandSequence: 0, playlistVersion: 0, pendingEndAt: 0,
    ticks: 0, lastInitAttempt: 0, rateLimitUntil: 0, rateLimitFailures: 0,
    awaitingTransition: false
  };

  function call(method, args) { return qplayer.call(method, args || {}); }
  function text(value) { return String(value == null ? "" : value); }
  function idsSignature(values) { return (values || []).map(String).join(","); }
  function message(error) {
    var value = text(error && error.message || error);
    return value || "未知错误";
  }
  function notify(value) {
    return call("notifications.toast", {message: value}).then(function () { return true; });
  }
  // The host rejects a whole description when any field is off-schema, and these
  // strings come from the provider. Strip control characters and clamp length so
  // a hostile or merely odd server response cannot blank the dialog.
  function plain(value, limit) {
    var out = text(value).replace(/[\u0000-\u001f\u007f]/g, " ");
    return out.length > limit ? out.slice(0, limit) : out;
  }
  function memberNames(room) {
    return ((room && room.members) || []).map(function (member) {
      return text(member.displayName || member.id);
    }).filter(Boolean).join("、");
  }
  function invitation() {
    if (!state.inRoom || !state.room) return "";
    return "qplayer://listen-together?provider=netease&roomId="
      + encodeURIComponent(state.room.id) + "&inviterId=" + encodeURIComponent(state.accountId);
  }
  // QPlayer renders plugin dialogs from a description built out of its own
  // components, so this returns what the dialog should say rather than raw state
  // plus a QML document. Every action handler ends here, which keeps the whole
  // feature a plain "action in, new dialog out" loop.
  function publicState() {
    var body = [];
    body.push({
      type: "text", style: "title", center: true,
      text: state.inRoom
        ? ((state.room && state.room.members && state.room.members.length)
          ? state.room.members.length + " 人正在一起听" : "正在一起听")
        : "尚未加入房间"
    });
    if (state.inRoom) {
      body.push({
        type: "text", style: "caption", center: true,
        text: plain(memberNames(state.room), 200)
              || ("房间 " + plain(state.room && state.room.id, 64))
      });
      body.push({type: "text", style: "body", text: plain(invitation(), 300)});
      body.push({type: "row", items: [
        {type: "button", id: "copy", label: "复制邀请", style: "filled"},
        {type: "button", id: "leave", label: "退出房间", style: "outlined",
         destructive: true}
      ]});
    } else {
      body.push({
        type: "text", style: "caption", center: true,
        text: "创建房间，或粘贴好友发来的邀请链接"
      });
      body.push({type: "input", id: "invitation", placeholder: "邀请链接或房间 ID"});
      body.push({type: "row", items: [
        {type: "button", id: "create", label: "创建房间", style: "filled"},
        {type: "button", id: "join", label: "加入房间", style: "outlined"}
      ]});
    }
    if (state.error) body.push({type: "error", text: plain(state.error, 280)});
    return {
      title: "一起听",
      subtitle: "网易云音乐",
      icon: "group",
      refreshMs: 1500,
      body: body
    };
  }
  function playback() { return call("playback.read", {}); }
  function blockAutoAdvance(blocked) {
    return call("playback.blockAutoAdvance", {blocked: !!blocked});
  }
  function setRoom(room) {
    state.initialized = true;
    state.room = room || null;
    state.inRoom = !!(room && room.id);
    state.leaderId = room && room.creatorAccountId ? text(room.creatorAccountId) : "";
    if (!state.leaderId) {
      var candidates = [state.accountId];
      ((room && room.members) || []).forEach(function (member) {
        if (member && member.id) candidates.push(text(member.id));
      });
      candidates = candidates.filter(Boolean).sort(function (left, right) {
        var a = Number(left), b = Number(right);
        if (isFinite(a) && isFinite(b) && a !== b) return a - b;
        return left < right ? -1 : (left > right ? 1 : 0);
      });
      state.leaderId = candidates.length ? candidates[0] : state.accountId;
    }
    state.pendingEndAt = 0;
    return blockAutoAdvance(state.inRoom);
  }
  function clearRoom() {
    state.initialized = true;
    state.inRoom = false;
    state.room = null;
    state.leaderId = "";
    state.lastSongId = "";
    state.lastQueue = "";
    state.pendingEndAt = 0;
    state.rateLimitUntil = 0;
    state.rateLimitFailures = 0;
    state.awaitingTransition = false;
    return blockAutoAdvance(false);
  }
  function baseline(snapshot) {
    state.lastSongId = text(snapshot.currentSongId);
    state.lastQueue = idsSignature(snapshot.queueSongIds);
    state.lastPlaying = !!snapshot.playing;
    state.lastSeekRevision = Number(snapshot.seekRevision || 0);
    state.lastEndRevision = Number(snapshot.endRevision || 0);
  }
  function reportPlaylist(snapshot) {
    state.playlistVersion++;
    return api.request({operation: "reportPlaylist", roomId: state.room.id,
      accountId: state.accountId, version: state.playlistVersion,
      songIds: snapshot.queueSongIds || []});
  }
  function reportCommand(type, former, target, position, playing) {
    state.commandSequence = Math.max(state.commandSequence + 1, Date.now());
    return api.request({operation: "reportCommand", roomId: state.room.id,
      accountId: state.accountId, type: type, formerSongId: former || "0",
      targetSongId: target || "0", progressMs: Math.max(0, Number(position || 0)),
      playing: !!playing, sequence: state.commandSequence});
  }
  function reportLocalChanges(snapshot) {
    // A remote queue/track selection may still be resolving an uncached stream.
    // Baseline the host's transitional intent without echoing it as a local action;
    // the final requested play state is observable after onStarted completes.
    if (snapshot.transitioning) {
      state.awaitingTransition = true;
      baseline(snapshot);
      return Promise.resolve(true);
    }
    if (state.awaitingTransition) {
      state.awaitingTransition = false;
      baseline(snapshot);
      return Promise.resolve(true);
    }
    var work = Promise.resolve(true);
    var queueSignature = idsSignature(snapshot.queueSongIds);
    if (queueSignature !== state.lastQueue && snapshot.queueSongIds.length) {
      work = work.then(function () { return reportPlaylist(snapshot); });
    }
    var song = text(snapshot.currentSongId);
    if (song && song !== state.lastSongId) {
      var former = state.lastSongId;
      state.leaderId = state.accountId;
      state.pendingEndAt = 0;
      work = work.then(function () {
        return reportCommand("GOTO", former, song, snapshot.positionMs, snapshot.playing);
      });
    } else if (Number(snapshot.seekRevision || 0) !== state.lastSeekRevision && song) {
      work = work.then(function () {
        return reportCommand("PROGRESS", song, song, snapshot.positionMs, snapshot.playing);
      });
    } else if (!!snapshot.playing !== state.lastPlaying && song) {
      work = work.then(function () {
        return reportCommand(snapshot.playing ? "PLAY" : "PAUSE", song, song,
          snapshot.positionMs, snapshot.playing);
      });
    }
    baseline(snapshot);
    return work;
  }
  function commandSignature(command) {
    if (!command) return "";
    return [command.accountId, command.type, command.formerSongId,
      command.targetSongId, command.progressMs, command.playing].join("|");
  }
  function isNewRemote(command) {
    if (!command || !command.accountId || text(command.accountId) === state.accountId) return false;
    var signature = commandSignature(command);
    var sequence = Number(command.sequence || 0);
    if (signature === state.lastRemoteSignature) return false;
    if (sequence && sequence < state.lastRemoteSequence) return false;
    return true;
  }
  function commandToast(type) {
    type = text(type).toUpperCase();
    if (type === "PROGRESS") return "对方调整了播放进度";
    if (type === "GOTO" || type === "NEXT" || type === "PREV") return "对方切换了歌曲";
    if (type === "PLAY") return "对方开始播放";
    if (type === "PAUSE") return "对方暂停了播放";
    return "";
  }
  function isRateLimited(error) {
    var current = error;
    for (var depth = 0; current && depth < 8; depth++) {
      var value = message(current).toLowerCase();
      if (value.indexOf("429") >= 0 || value.indexOf("too many requests") >= 0
          || value.indexOf("rate limit") >= 0 || value.indexOf("操作频繁") >= 0) return true;
      current = current.cause;
    }
    return false;
  }
  function registerSyncFailure(error) {
    state.error = message(error);
    if (!isRateLimited(error)) return;
    state.rateLimitFailures++;
    if (state.rateLimitFailures > 3) {
      state.rateLimitUntil = 9007199254740991;
      state.error = "一起听同步请求过于频繁，请退出房间后重试";
      return;
    }
    var delay = Math.min(120000, 30000 * Math.pow(2, state.rateLimitFailures - 1));
    state.rateLimitUntil = Date.now() + delay;
    state.error = "一起听请求受限，将在 " + Math.round(delay / 1000) + " 秒后重试";
  }
  function applySnapshot(remote, initial, forcePaused) {
    remote = remote || {};
    var command = remote.command || null;
    var remoteSignature = commandSignature(command);
    var remoteIds = (remote.songIds || []).map(String);
    var freshCommand = !!(initial && command) || isNewRemote(command);
    var commandType = freshCommand ? text(command.type).toUpperCase() : "";
    var desiredSong = freshCommand && command.targetSongId
      ? text(command.targetSongId) : "";
    var desiredPosition = freshCommand ? Number(command.progressMs || 0) : 0;
    if (!initial && (commandType === "GOTO" || commandType === "NEXT"
        || commandType === "PREV")) desiredPosition = 0;
    var desiredPlaying = freshCommand ? !!command.playing : false;
    if (forcePaused) desiredPlaying = false;

    return playback().then(function (local) {
      var queueChanged = remoteIds.length && idsSignature(remoteIds) !== idsSignature(local.queueSongIds);
      var action = Promise.resolve(true);
      // The playlist update can become visible before its matching GOTO. Keep the
      // audible track/queue until the authoritative target arrives instead of
      // reusing an unrelated old numeric index and position in the new queue.
      if (!initial && queueChanged && !freshCommand
          && remoteIds.indexOf(text(local.currentSongId)) < 0) return true;
      if (!freshCommand) {
        desiredPosition = Number(local.positionMs || 0);
        desiredPlaying = !!local.playing;
        if (forcePaused) desiredPlaying = false;
      }
      if (queueChanged) {
        var selected = desiredSong || text(local.currentSongId) || remoteIds[0];
        if (remoteIds.indexOf(selected) < 0) selected = remoteIds[0];
        action = api.songs(remoteIds).then(function (songs) {
          return call("queue.replace", {songs: songs, currentSongId: selected,
            positionMs: desiredPosition, playing: desiredPlaying});
        });
      } else if (freshCommand) {
        var type = commandType;
        if ((type === "GOTO" || type === "NEXT" || type === "PREV") && desiredSong) {
          state.leaderId = text(command.accountId);
          state.pendingEndAt = 0;
          action = call("playback.select", {songId: desiredSong,
            positionMs: desiredPosition, playing: desiredPlaying});
        } else if (type === "PROGRESS") {
          action = call("playback.seek", {positionMs: desiredPosition});
        } else if (type === "PLAY") {
          action = call("playback.play", {});
        } else if (type === "PAUSE") {
          action = call("playback.pause", {});
        }
      }
      if (forcePaused) action = action.then(function () { return call("playback.pause", {}); });
      return action.then(function () {
        if (freshCommand) {
          state.lastRemoteSignature = remoteSignature;
          state.lastRemoteSequence = Math.max(state.lastRemoteSequence,
            Number(command.sequence || 0));
        }
        if (freshCommand && !initial) {
          var toast = commandToast(command.type);
          if (toast) return notify(toast);
        }
        return true;
      });
    }).then(function () { return playback(); }).then(function (after) {
      baseline(after);
      return after;
    });
  }
  function restore() {
    return api.account().then(function (profile) {
      state.accountId = profile && profile.loggedIn ? text(profile.id) : "";
      if (!state.accountId) { state.initialized = true; return publicState(); }
      return api.request({operation: "status"}).then(function (status) {
        if (!status || !status.inRoom || !status.room) {
          state.initialized = true;
          return clearRoom().then(publicState);
        }
        return setRoom(status.room).then(function () {
          return api.request({operation: "snapshot", roomId: state.room.id});
        }).then(function (snapshot) {
          return applySnapshot(snapshot, true, true).then(function (local) {
            var song = text(local.currentSongId);
            return song ? reportCommand("PAUSE", song, song, local.positionMs, false) : true;
          });
        }).then(function () {
          state.initialized = true;
          return notify("正在一起听");
        }).then(publicState);
      });
    });
  }
  function ensureInitialized() {
    if (state.initialized) return Promise.resolve(publicState());
    if (state.initializing) return state.initializing;
    var now = Date.now();
    if (now - state.lastInitAttempt < 5000) return Promise.resolve(publicState());
    state.lastInitAttempt = now;
    state.initializing = restore().then(function (value) {
      state.error = ""; state.initializing = null; return value;
    }, function (error) {
      state.error = message(error); state.initializing = null;
      return publicState();
    });
    return state.initializing;
  }
  function handleNaturalEnd(snapshot) {
    var revision = Number(snapshot.endRevision || 0);
    if (revision !== state.lastEndRevision) {
      state.lastEndRevision = revision;
      if (!state.leaderId || state.leaderId === state.accountId) {
        state.leaderId = state.accountId;
        return call("playback.next", {});
      }
      state.pendingEndAt = Date.now();
    }
    if (state.pendingEndAt && Date.now() - state.pendingEndAt >= 3500) {
      state.pendingEndAt = 0;
      state.leaderId = state.accountId;
      return call("playback.next", {});
    }
    return Promise.resolve(true);
  }
  function whenReady() {
    if (state.initialized) return Promise.resolve();
    return ensureInitialized().then(function () {});
  }
  function tick() {
    state.ticks++;
    if (state.busy) return true;
    // Login can complete after the plugin runtime started. Probe infrequently
    // while idle so an existing server-side room is restored without requiring
    // QPlayer to expose an account/login lifecycle event. Never return
    // publicState() from the background tick — the host discards the result,
    // and cloning a dialog tree into Java every second was steady GC on mobile.
    if (!state.inRoom) {
      if (state.initialized && state.ticks % 10 !== 0) return true;
      if (state.initializing) return true;
      if (!state.initialized && Date.now() - state.lastInitAttempt < 5000) return true;
      state.initialized = false;
      return whenReady().then(function () { return true; });
    }
    if (Date.now() < state.rateLimitUntil) return true;
    return whenReady().then(function () {
      return blockAutoAdvance(true).then(playback).then(function (local) {
        return handleNaturalEnd(local).then(function () { return playback(); });
      }).then(function (local) {
        return reportLocalChanges(local);
      }).then(function () {
        return api.request({operation: "snapshot", roomId: state.room.id});
      }).then(function (snapshot) {
        return applySnapshot(snapshot, false, false);
      }).then(function (local) {
        if (state.ticks % 8 === 0) {
          return api.request({operation: "heartbeat", roomId: state.room.id,
            songId: local.currentSongId || "0", playing: local.playing,
            progressMs: local.positionMs});
        }
        return true;
      }).then(function () {
        if (state.ticks % 12 !== 0) return true;
        return api.request({operation: "status"}).then(function (status) {
          if (!status || !status.inRoom || !status.room) return clearRoom();
          state.room = status.room;
          return true;
        });
      }).then(function () {
        state.error = "";
        state.rateLimitFailures = 0;
        state.rateLimitUntil = 0;
        return true;
      }, function (error) {
        registerSyncFailure(error);
        return true;
      });
    });
  }
  function parseInvitation(value) {
    var raw = text(value).trim();
    if (!raw) return {error: "请输入邀请链接或房间 ID"};
    if (raw.length > 1024) return {error: "邀请内容过长"};
    var query = raw.indexOf("?") >= 0 ? raw.slice(raw.indexOf("?") + 1) : raw;
    var result = {};
    try {
      query.split("&").forEach(function (part) {
        var at = part.indexOf("=");
        if (at > 0) result[decodeURIComponent(part.slice(0, at))]
          = decodeURIComponent(part.slice(at + 1));
      });
    } catch (_) {
      return {error: "邀请链接编码无效"};
    }
    if (!result.roomId && raw && raw.indexOf("=") < 0 && raw.indexOf("/") < 0) result.roomId = raw;
    result.roomId = text(result.roomId).trim();
    result.inviterId = text(result.inviterId).trim();
    if (result.provider && result.provider !== "netease") {
      return {error: "这不是网易云一起听邀请"};
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(result.roomId)) {
      return {error: "邀请链接或房间 ID 格式无效"};
    }
    if (result.inviterId && !/^\d{1,24}$/.test(result.inviterId)) {
      return {error: "邀请者 ID 格式无效"};
    }
    return result;
  }
  function operation(work) {
    if (state.busy) return Promise.resolve(publicState());
    state.busy = true; state.error = "";
    return work().then(function () {
      state.busy = false; return publicState();
    }, function (error) {
      state.busy = false; state.error = message(error); return publicState();
    });
  }
  function createRoom() {
    return operation(function () {
      var local;
      return Promise.all([api.account(), playback()]).then(function (values) {
        var profile = values[0]; local = values[1];
        if (!profile || !profile.loggedIn) throw new Error("请先登录后使用一起听");
        if (!local.currentSongId) throw new Error("请先播放一首网易云歌曲");
        state.accountId = text(profile.id);
        return api.request({operation: "create"});
      }).then(setRoom).then(function () {
        return reportPlaylist(local);
      }).then(function () {
        return reportCommand("GOTO", "0", local.currentSongId,
          local.positionMs, local.playing);
      }).then(function () {
        state.leaderId = state.accountId; baseline(local);
        return notify("一起听房间已创建");
      }).then(publicState);
    });
  }
  function joinRoom(invitationValue) {
    var parsed = parseInvitation(invitationValue);
    if (parsed.error) {
      state.error = parsed.error;
      return Promise.resolve(publicState());
    }
    return operation(function () {
      return api.account().then(function (profile) {
        if (!profile || !profile.loggedIn) throw new Error("请先登录后使用一起听");
        state.accountId = text(profile.id);
        return api.request({operation: "join", roomId: parsed.roomId,
          inviterAccountId: parsed.inviterId || "0"});
      }).then(setRoom).then(function () {
        return api.request({operation: "snapshot", roomId: state.room.id});
      }).then(function (snapshot) { return applySnapshot(snapshot, true, false); })
        .then(function () { return notify("已加入一起听"); })
        .then(publicState);
    });
  }
  function leaveRoom() {
    return operation(function () {
      if (!state.inRoom || !state.room) return publicState();
      var id = state.room.id;
      return api.request({operation: "end", roomId: id}).then(clearRoom)
        .then(function () { return notify("已退出一起听"); })
        .then(publicState);
    });
  }
  function ui(args) {
    args = args || {};
    var action = text(args.action);
    var payload = args.payload || {};
    var inputs = payload.inputs || {};
    // "open" and "refresh" are the host's own lifecycle actions; every other
    // action id is the id of a button this description declared.
    if (action === "open" || action === "refresh" || action === "status") {
      return ensureInitialized().then(publicState);
    }
    if (action === "create") return createRoom();
    if (action === "join") {
      var invitationValue = text(inputs.invitation).trim();
      if (!invitationValue) {
        state.error = "";
        return Promise.resolve(publicState());
      }
      return joinRoom(invitationValue);
    }
    if (action === "leave") return leaveRoom();
    if (action === "copy") {
      var value = invitation();
      if (!value) return Promise.resolve(publicState());
      return call("clipboard.write", {text: value})
        .then(function () { return notify("已复制一起听邀请"); })
        .then(publicState);
    }
    throw new Error("未知一起听界面操作");
  }

  return {tick: tick, ui: ui};
}

module.exports = {create: create};
