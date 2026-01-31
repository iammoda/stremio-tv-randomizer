# Stremio TV Randomizer Addon

A Stremio addon that lets you add your favorite TV shows and automatically play random episodes from your collection.

## Features

- **Add TV Shows**: Search and add TV shows to your personal collection
- **Random Episode Playback**: Click "Random Episode" to instantly play a random episode from any show in your list
- **Auto-Play Support**: Episodes can continue automatically when finished (via Torrentio/GDrive)
- **Persistent Storage**: Your show list is saved locally and persists between sessions
- **Dark/Light Mode**: Toggle between dark and light themes
- **Search & Filter**: Search through your added shows
- **Pagination**: Shows are displayed in groups of 4 with "Show More" and "Show All" options
- **150 Show Limit**: Maximum of 150 shows can be added (configurable)

## Installation

### Prerequisites

- Node.js 14+ 
- npm or pnpm
- Stremio desktop app (macOS, Windows, or Linux)

### Setup

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the addon server:
   ```bash
   npm start
   ```

4. The addon will run at `http://localhost:7001/`

5. In Stremio:
   - Go to **Addons**
   - Click **"Install from URL"**
   - Open `http://localhost:7001/` and copy the generated install URL
   - Click **Install**

### Accessing the Settings Page

Open your browser and navigate to:
```
http://localhost:7001/myshows
```

Here you can:
- Search for TV shows and add them to your list
- Remove shows from your collection
- Toggle dark/light mode
- Search/filter through your added shows
- Clear all shows

## Usage

1. **Install**: Open `http://localhost:7001/` and install the addon using the generated URL.

2. **Find Random Episode**: In Stremio's **Discover** section, find the "Find Random Episode" catalog

3. **Play Random Episode**: Click the "🎲 Random Episode" item at the top of the catalog to play a random episode from any show in your list

4. **Select Specific Show**: Click any show in the catalog to see its episodes and select one manually

## How It Works

- **Metadata**: Uses TVmaze API for show search and Cinemeta for episode information
- **Streaming**: Delegates to other addons (Torrentio, GDrive, etc.) for actual video streams
- **Storage**: Show list is stored in MongoDB per **User Key**
- **CORS**: Enabled for cross-origin requests

## Project Structure

```
stremio-tv-randomizer/
├── addon.js           # Main addon server and logic
├── package.json       # Node.js dependencies
└── public/
    ├── index.html     # Settings web interface
    └── styles.css     # Styles for settings page
```

## Configuration

### Changing the Port

```bash
PORT=8080 npm start
```

### Changing the Show Limit

Edit `addon.js` and change:
```javascript
const MAX_SHOWS = 150;
```

## Deployment (Vercel + MongoDB)

1. Create a MongoDB database (MongoDB Atlas recommended).
2. In Vercel, set the `MONGODB_URI` environment variable.
3. Deploy the repo to Vercel.
4. Open `/` on your Vercel URL to generate the install URL.

The install page generates a key and builds the `manifest.json?user=KEY` URL so the same key shares the same show list across devices.

## Technologies Used

- **Node.js** - Runtime environment
- **Express.js** - Web server framework
- **Stremio Addon SDK** - Stremio addon protocol implementation
- **TVmaze API** - TV show search
- **Cinemeta** - TV show metadata and episode information

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/manifest.json` | GET | Addon manifest |
| `/catalog/:type/:id.json` | GET | Catalog of shows |
| `/meta/:type/:id.json` | GET | Show/episode metadata |
| `/stream/:type/:id.json` | GET | Stream URLs |
| `/api/shows` | GET/POST | Manage show list |
| `/api/search` | GET | Search TV shows |
| `/myshows` | GET | Settings web interface |
| `/` | GET | Install page |

## Troubleshooting

### "No addons were requested for this meta!"
- Ensure Torrentio or another streaming addon is installed
- Make sure the addon server is running
- Try reinstalling the addon in Stremio

### Addon not appearing in Stremio
- Check that the server is running: `curl http://localhost:7001/manifest.json`
- Verify the correct URL: `http://localhost:7001/manifest.json`
- Restart Stremio completely (Cmd+Q)

### Shows not loading
- Check internet connection (required for TVmaze/Cinemeta APIs)
- Verify TVmaze/Cinemeta APIs are accessible

## Limitations

- Local storage only (no cloud sync between devices)
- Maximum 150 shows (configurable)
- Requires other addons for actual video streaming (Torrentio, GDrive, etc.)
- Server must be running to use the addon

## License

MIT License - Feel free to modify and distribute.

## Contributing

Pull requests are welcome! Please open an issue first to discuss changes.

## Acknowledgments

- [Stremio](https://www.strem.io/) - For the addon platform
- [TVmaze](https://www.tvmaze.com/) - For show data
- [Cinemeta](https://cinemeta.strem.io/) - For metadata
- [Stremio Addon SDK](https://github.com/Stremio/stremio-addon-sdk) - For addon development tools
