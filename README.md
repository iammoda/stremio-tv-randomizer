# Stremio TV Randomizer Addon

A Stremio addon that lets you add your favorite TV shows and automatically play random episodes from your collection.

## Features

- **Add TV Shows**: Search and add TV shows to your personal collection
- **Random Episode Playback**: Click "Random All Shows" (or a specific show) to instantly play a random episode
- **Fair Weighting**: Every episode across your library has equal odds (shows with more episodes are picked proportionally more often)
- **Watched Tracking**: Episodes you actually start playing go on a cooldown and won't be re-picked for a configurable number of days (default 30, 0 disables)
- **Season Filters**: Per-show season selection (e.g., only pick from seasons 2-4)
- **Catalog Search**: Search your added shows from inside Stremio's Discover page
- **Multi-Device Sync**: Your show list is stored in MongoDB per user key — the same install URL syncs across devices
- **Auto-Play Support**: Episodes can continue automatically when finished (via Torrentio/GDrive)
- **Dark/Light Mode**: Toggle between dark and light themes
- **150 Show Limit**: Maximum of 150 shows can be added (configurable)

## Installation

### Prerequisites

- Node.js 18+
- npm or pnpm
- A MongoDB database (MongoDB Atlas free tier works)
- Stremio (desktop, web, or mobile)

### Setup

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and set `MONGODB_URI`

4. Start the addon server:
   ```bash
   npm start
   ```

5. The addon will run at `http://localhost:7001/`

6. In Stremio:
   - Open `http://localhost:7001/` and copy the generated install URL
   - Go to **Addons** → **Install from URL** → paste → **Install**

### Accessing the Settings Page

Click **Configure** on the addon inside Stremio (or open `http://localhost:7001/myshows?user=YOUR-KEY`).

Here you can:
- Search for TV shows and add them to your list
- Remove shows (individually or all at once)
- Configure per-show season filters (gear icon)
- Set the watched-episode cooldown (Randomizer Settings)
- Toggle dark/light mode

## Usage

1. **Install**: Open `/` on your deployment and install the generated URL
2. **Find Random Episode**: In Stremio's **Discover** section, find the "Find Random Episode" catalog
3. **Play Random Episode**: Click "🎲 Random All Shows" to play a random episode from any show, or "🎲 Random {Show}" for one show
4. Each click re-rolls a new random episode

## How It Works

- **Metadata**: TVmaze API for show search, Cinemeta for episode data (cached in-memory + per-show stats cached in MongoDB)
- **Streaming**: Delegates to your other installed addons (Torrentio, GDrive, etc.) for actual video streams
- **Storage**: Show list, settings, and watch history are stored in MongoDB per **user key** (the key in your install URL)
- **Watched detection**: Stremio requests subtitles from the addon when playback of a video actually starts; the addon records that as "watched" and excludes the episode from random picks during the cooldown window. (The addon protocol has no completion events, so "started playing" is the signal.)
- **Random meta responses** are returned under the canonical episode ID (`tt…:season:episode`) so players and stream addons see a stable, cacheable ID

## Project Structure

```
stremio-tv-randomizer/
├── addon.js                 # Express app entry point
├── api/index.js             # Vercel serverless wrapper
├── config/index.js          # Env, constants, Stremio manifest
├── routes/
│   ├── stremio.js           # manifest / catalog / meta / stream / subtitles
│   ├── api.js               # REST API for the settings page
│   └── pages.js             # HTML pages
├── services/
│   ├── db.js                # MongoDB access (shows, settings, watch history)
│   ├── randomizer.js        # Weighted random pick + cooldown exclusion
│   ├── cinemeta.js          # Cinemeta client (TTL cache)
│   ├── tvmaze.js            # TVmaze client
│   └── descriptions.js      # Episode description resolution
├── middleware/              # Error handling, rate limiting, validation
├── utils/                   # Episode parsing/meta building, fetch timeout, HTML
├── public/                  # Install page, settings SPA, static assets
└── test/                    # node --test unit tests
```

## Configuration

- **Port**: `PORT=8080 npm start`
- **Show limit**: `MAX_SHOWS` in `config/index.js`
- **Watched cooldown default**: `DEFAULT_COOLDOWN_DAYS` in `config/index.js` (per-user override in the settings page)

## Deployment (Vercel + MongoDB)

1. Create a MongoDB database (MongoDB Atlas recommended)
2. In Vercel, set the `MONGODB_URI` environment variable
3. Deploy the repo to Vercel
4. Open `/` on your Vercel URL to generate the install URL

The install page generates a key and builds the `manifest.json?user=KEY` URL so the same key shares the same show list across devices.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/manifest.json` | GET | Addon manifest |
| `/catalog/:type/:id.json` | GET | Catalog of shows (also `/catalog/:type/:id/:extra.json` for search) |
| `/meta/:type/:id.json` | GET | Show/episode metadata (random pick for action IDs) |
| `/stream/:type/:id.json` | GET | Streams (always empty; other addons provide streams) |
| `/subtitles/:type/:id.json` | GET | Playback-start signal for watched tracking (always empty) |
| `/api/shows` | GET/POST/DELETE | List, add, or clear shows |
| `/api/shows/:imdbId` | DELETE | Remove one show |
| `/api/shows/:imdbId/seasons` | GET | Available seasons + episode counts |
| `/api/shows/:imdbId/settings` | GET/PUT | Per-show season filter |
| `/api/settings` | GET/PUT | User settings (watched cooldown days) |
| `/api/search` | GET | Search TV shows |
| `/api/health` | GET | Health check |
| `/myshows` | GET | Settings web interface |
| `/` | GET | Install page |

## Troubleshooting

### "No addons were requested for this meta!"
- Ensure Torrentio or another streaming addon is installed
- Make sure the addon server is running
- Try reinstalling the addon in Stremio

### Addon not appearing in Stremio
- Check that the server is running: `curl http://localhost:7001/manifest.json`
- Restart Stremio completely (Cmd+Q)

### Shows not loading
- Check internet connection (required for TVmaze/Cinemeta APIs)
- Check `MONGODB_URI` is set and reachable

### Watched episodes still being picked
- Existing installs pick up the new manifest (with watched tracking) when Stremio refreshes addons; reinstalling from the same URL forces it immediately (your list is tied to the key, nothing is lost)
- If every episode of a show is on cooldown, the addon allows repeats rather than failing

## Limitations

- Maximum 150 shows (configurable)
- Requires other addons for actual video streaming (Torrentio, GDrive, etc.)
- "Watched" means playback started; the Stremio addon protocol provides no watch-completion events
- Server must be reachable (deploy to Vercel or keep it running locally)

## License

MIT License - Feel free to modify and distribute.

## Acknowledgments

- [Stremio](https://www.strem.io/) - For the addon platform
- [TVmaze](https://www.tvmaze.com/) - For show data
- [Cinemeta](https://cinemeta.strem.io/) - For metadata
