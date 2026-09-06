# Playback

Playback in Litefin is handled by a sophisticated triple-backend system that prioritizes hardware acceleration.

## Advanced Player Core

The player is implemented as a standalone sub-project under `src/player/` with two major modules:

- **`core/`** (11 files): Low-level playback engines and subtitle rendering.
- **`osd/`** (19 files): On-Screen Display menus and controllers for user interaction.

### Platform Players

- **Tizen AVPlay** (`src/player/core/TizenAVPlayer.js`): The primary backend for Samsung TVs. Utilizes native hardware decoding via `webapis.avplay` with:
    - **Buffer Tuning**: Hardware-level buffer thresholds (byte-based and property-based).
    - **Trickplay**: Support for previewing thumbnails during seeking.
    - **Rewind Buffer**: A 10-second rewind buffer for direct streams to improve responsiveness.
- **webOS Player** (`src/player/core/WebOSPlayer.js`): Dedicated hardware integration for LG webOS devices using webOS video APIs.
- **HTML5 Web Player** (`src/player/core/HtmlVideoPlayer.js`): A fallback renderer for environments where native hardware APIs are unavailable or unsupported.

### JellyfinPlayer

The main player controller (`src/player/core/JellyfinPlayer.js`) orchestrates all platform players. It handles:

- Player backend selection based on platform and content type.
- Playback reporting (start/progress/stop) to the Jellyfin server.
- Quality switching, seeking, and trickplay.
- Integration with SyncPlay for synchronized group playback.

### Subtitle Management

Subtitles are a core focus of the playback experience:

- **SubtitleManager** (`src/player/core/SubtitleManager.js`): Centralizes tracking and rendering of all subtitle formats with format detection and delivery strategy.
- **ASS/SSA Rendering**: Uses `LibassWasmRenderer` — libass compiled to WebAssembly (via `@jellyfin/libass-wasm`). Replaces the older libjass approach. Includes Tizen-targeted optimizations for skew, vertical spacing, and "staircase" layouts. A legacy variant (`LibassWasmRenderer.legacy.js`) is available for older Tizen builds.
- **PGS Support** (`src/player/core/PGSRenderer.js`): Native rendering support for image-based PGS subtitles (via `libpgs`).
- **ASS Renderer** (`src/player/core/ASSRenderer.js`): Alternative pure-JS ASS rendering using `libjass` for environments where WebAssembly is unavailable.
- **External Delivery**: Logic to force external subtitle delivery when transcoding to avoid playback out-of-bounds errors on certain hardware.
- **Subtitle Parsing** (`src/player/core/SubtitleParser.js`): Parses and normalizes subtitle streams for consistent rendering.

### On-Screen Display (OSD)

The OSD subsystem (`src/player/osd/`) provides 19 modular menus managed by `OSDController.js`:

| Menu                    | File                       | Purpose                          |
| ----------------------- | -------------------------- | -------------------------------- |
| Chapters                | `ChaptersModal.js`         | Chapter navigation               |
| Quality                 | `QualityMenu.js`           | Bitrate/resolution switching     |
| Tracks                  | `TrackMenu.js`             | Audio/subtitle track selection   |
| Playback Mode           | `PlaybackModeMenu.js`      | Shuffle, repeat                  |
| Playback Speed          | `PlaybackSpeedMenu.js`     | Speed control (0.5x–2x)          |
| Aspect Ratio            | `AspectRatioMenu.js`       | Force aspect ratio               |
| Subtitle Offset         | `SubtitleOffset.js`        | Subtitle timing offset           |
| Subtitle Quick Settings | `SubtitleQuickSettings.js` | Font size, color, position       |
| Lyrics                  | `LyricsModal.js`           | Synchronized lyrics view         |
| Queue                   | `QueueModal.js`            | Now playing queue                |
| Up Next                 | `UpNextDialog.js`          | Auto-play next episode countdown |
| Playback Info           | `PlaybackInfo.js`          | Transcode details, codec info    |
| Settings                | `SettingsMenu.js`          | Player settings                  |
| SyncPlay Notifications  | `SyncPlayNotification.js`  | Group playback events            |
| Trickplay               | `TrickplayManager.js`      | Seek thumbnails                  |
| Description             | `DescriptionModal.js`      | Item description/overview        |
| Repeat Mode             | `RepeatModeMenu.js`        | Repeat off/all/one               |
| Base Menu               | `BaseMenu.js`              | Abstract base for OSD menus      |

### Transcoding & Negotiation

The **Device Profile** system (`src/api/DeviceProfile.js` and `src/api/profiles/`) negotiates capabilities with the Jellyfin server. It provides specific profiles for:

- 4K / HEVC / HDR10+ support.
- Dolby Vision (DoVi) profiles (7/8) with HDR10 fallback logic.
- Audio codec constraints (e.g., forcing transcoding for unsupported DTS or EAC3 streams).
- Real-time quality switching and bit-rate limitation management.

## Remote timeline confirmation (this fork)

Player settings → **Confirm seeking with OK** is enabled by default. The Italian
label is **Conferma spostamento con OK**. The preference is stored through
`PlayerSettings` as `player:confirmSeekWithOK`; disabling it restores the original
800 ms automatic seek debounce, including combined skip button behavior.

Physical remote keys go through the input event bus to `OSDController.handleInput`
and `_navigate`; server remote navigation uses the same entry point via
`PlayerPage`. Timeline Left/Right calls `_seekTimeline`, which updates the OSD-only
`_seekTargetTicks`. Timestamp, slider and `TrickplayManager` previews use that target;
the actual player is paused on the first preview step. Holding an arrow retains
acceleration only for native keydowns with `repeat: true` in the same direction.
Separate presses, direction changes and keyup reset acceleration immediately. A
300 ms inactivity timer clears the speed badge without erasing hold history. A
subsequent native repeat continues the same hold even if rendering delayed input;
a fresh non-repeated keydown resets it. The timer never commits the seek or resumes
playback. Inputs without repeat metadata conservatively stay at 1×.

The confirmation ramp reaches 2× at 0.75 s, 3× at 1.5 s, 4× at 2.25 s, 5× at 3 s
and 10× at 4.5 s of held input. Each interval contributes at most 200 ms, so a long
UI stall cannot abruptly boost the multiplier. Automatic seeking retains its
original 2/4/6/8/12-second thresholds.
Neither the 800 ms commit timer nor the 30-second scrub safety timeout applies to a
confirmation preview. Auto-hide is suspended until the preview ends.

OK clears the pending state and calls `JellyfinPlayer.seek` once. That preserves
subtitle cue clearing, backend dispatch and the seek event used by SyncPlay.
The original playing/paused state is remembered: confirmation seeks while paused,
then resumes only if the video was playing before the preview. Back also restores
the original state. Destruction or a media change discards the saved state without
restarting the outgoing video. Pause/resume use the normal JellyfinPlayer methods,
so reporting (including the paused transcoding heartbeat) and SyncPlay receive the
normal playback events; no backend calls or event suppression bypass these paths.
Repeated OK events in the confirmation burst are swallowed (native `repeat`, with
an 800 ms inactivity fallback for remotes without reliable keyup events).

Back cancels to the current real position. Moving vertically away from the timeline,
using another OSD action, closing the OSD, changing media or destroying the player
also clears the preview. Pointer input replaces it with the existing direct slider
behavior; quick-seek and chapter selection keep their existing execution paths.

Run `npm test` for deterministic remote-state, preference and backend seek tests.
These isolate browser dependencies and use simulated media elements; they do not
replace testing on a TV. Check both settings with short and held arrow presses,
OK and Back, paused and playing video, Magic Remote clicks/dragging, chapter skips,
subtitle synchronization and a real SyncPlay group. Test direct play and transcoded
HLS content, including thumbnail loading over the network.

Build an LG package with `npm run package:webos-modern` (webOS 6+) or
`npm run package:webos-normal` (webOS 4+). These produce
`Litefin-VERSION-webOS-Modern.ipk` and `Litefin-VERSION-webOS-Normal.ipk` at the repository
root (`VERSION` is the version in `package.json`). With the TV Developer Mode app enabled and its Key Server running, configure
the TV using the installed CLI, retrieve its key, then install and launch:

```bash
npx ares-setup-device
npx ares-novacom --device TV --getkey
npx ares-install --device TV Litefin-VERSION-webOS-Modern.ipk
npx ares-launch --device TV org.litefin.app
```

Use your configured device name instead of `TV` and the Normal package if needed.
For a TV already using Homebrew Channel, the IPK can also be sideloaded through its
package manager as described in the README.
