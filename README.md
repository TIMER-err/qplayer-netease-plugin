# QPlayer NetEase source plugin

An independent, user-installed source plugin for QPlayer. It implements the public QPlayer JavaScript plugin ABI and keeps all NetEase-specific endpoints, request transforms, login handling and credentials outside QPlayer core.

This project is not affiliated with or endorsed by NetEase Cloud Music. Users are responsible for complying with the service terms and local law. No audio, account credential or copyrighted media is distributed with the plugin.

The plugin implements search, home/recommendations, details, playback resolution,
AMLL TTML/provider lyrics, account/login, likes, playlist actions, scrobbling,
Heart Mode and sharing through QPlayer's capability-based ABI. Its credentials
are stored only through QPlayer's namespaced encrypted vault.
Listen Together's QML, room protocol, synchronization/leadership policy and
notifications are implemented inside this package; QPlayer exposes only generic
playback, queue, clipboard and toast services.

The public ABI and package format are documented in the
[QPlayer plugin template](https://github.com/TIMER-err/qplayer-plugin-template/blob/main/docs/ABI.md).

Build an unsigned package for manual testing:

```bash
chmod +x scripts/package.sh
./scripts/package.sh
python3 scripts/verify-package.py dist/*.qplug
```

QPlayer always shows a code-execution warning for manually imported packages whose publisher signature is not in its trust store.

Release packages must be signed with the publisher's P-256 key (kept outside the
repository, normally in the release workflow's secret store):

```bash
QPLAYER_PLUGIN_SIGNING_KEY=/secure/path/publisher-private.pem ./scripts/package.sh
```

The package is independently distributed and is not bundled into or hosted by
QPlayer. NetEase Cloud Music is a trademark of its respective owner.
