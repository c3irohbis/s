# Direct entry build

Canonical served document is root index.html. release-channel.json selects an immutable parent under release/. Keep that parent unchanged. Root overrides are forum-feed.js, library-feed.js, lazy-sections.js and notification-permission.js, with explicit HTML/importmap references. Older root js/css are legacy and are not the served parent. Do not edit those to change the served application.

Run `python -m pip install beautifulsoup4==4.15.0` in your development environment, then `python scripts/build-direct.py`. The builder contains the distribution bridge, distribution worker and preserved FCM header templates. The generated files are index.html, direct-entry-bridge.js, firebase-messaging-sw.js and offline-release.json. Commit generated runtime files with source changes. The builder includes its own bytes and all override/template hashes in the release identity.

Run `node --test tests/*.test.cjs`. Current suite128 tests. No cloud writes are part of this suite. Browser integration tests and Firestore emulator tests were run separately; automated tests do not certify all authenticated student features, real calls or real FCM delivery.

Do not edit generated HTML in an editor that silently reformats whitespace without rebuilding its worker entry hash. If an upload changes bytes, inspect the exact diff, rebuild the document size/SHA and rerun offline tests against the actual committed files. Two builds from unchanged inputs must be byte-identical. A future regeneration from this source produces a new identity, not the existing live identity, because source-build layout differs from the previous local-only builder.

Offline cache is optional. Dynamic cross-origin media is not persisted by the application worker. Seven overlays load only on use and are not downloaded by offline preparation. No skipWaiting, clients.claim or forced page reload is used. Old open/offline workers remain subject to their lifecycle until activation.
