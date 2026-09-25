# QPlayer NetEase source plugin

<p><a href="README.md">简体中文</a> · <b>English</b></p>

An independent, user-installed source plugin for QPlayer. It implements the public
QPlayer JavaScript plugin ABI and keeps all NetEase-specific endpoints, request
transforms, anti-cheat browser probing, login handling and credentials outside
QPlayer core. The host only supplies a generic system-WebView execution surface
guarded by the `webAuth` permission.

This project is not affiliated with, endorsed by or partnered with NetEase Cloud
Music. It distributes no audio, account credentials or copyrighted media. Users are
responsible for complying with the service terms and local law.

## Features

Provided through QPlayer's capability-based ABI:

- Search (songs, albums, artists) and trending keywords
- Home content: daily recommended songs, recommended playlists, and playlist
  sections following the service's own grouping (radar playlists, scenario
  playlists and so on)
- Song, playlist, album and artist details
- Stream resolution and lyrics, including word-level TTML lyrics from AMLL
- Login, account profile, recent plays, likes, playlist mutations, playlist cover
  replacement, scrobbling, heart mode and sharing

Two plugin-owned entries, declared by the plugin and rendered by QPlayer:

- **Listen Together** (player entry) — the room protocol, synchronization policy,
  leadership rules and notifications are implemented inside this package; QPlayer
  provides only generic playback, queue, clipboard and toast services.
- **Source unlock** (settings switch) — when a track is unplayable on NetEase, it
  attempts to match a stream URL from another source.

Login credentials are stored only through QPlayer's namespaced encrypted vault.

The public ABI and package format are documented in the
[QPlayer plugin template](https://github.com/TIMER-err/qplayer-plugin-template/blob/main/docs/ABI.en.md).

## Build

Produce an unsigned development package:

```bash
chmod +x scripts/package.sh
./scripts/package.sh
python3 scripts/verify-package.py dist/*.qplug
```

QPlayer shows a code-execution warning for manually imported packages whose
publisher signature is not in its trust store.

Release packages are signed with the publisher's P-256 key, which is kept outside
the repository, normally in the release workflow's secret store:

```bash
QPLAYER_PLUGIN_SIGNING_KEY=/secure/path/publisher-private.pem ./scripts/package.sh
```

`publisher-key.pub` holds the matching public key. QPlayer pins it, so it cannot be
changed: rotating the publisher key would make this plugin uninstallable on every
already-released QPlayer. The release workflow refuses to sign with a key that does
not derive to that file.

## Releasing

Pushing a `v<version>` tag matching the version in `plugin.json` triggers the
release workflow, which signs, verifies and creates a GitHub Release. QPlayer reads
the installable version from this repository's latest release, so the release must
carry exactly one `.qplug` and must not be a draft or pre-release.

The package is distributed independently and is neither bundled into nor hosted by
QPlayer. NetEase Cloud Music is a trademark of its respective owner.
