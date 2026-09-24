# Catan 3D Design Suite — Figma Plugin

A dedicated local Figma plugin that generates the **complete 3D visual design suite, viewport-locked canvas architecture, and 10 screen flow artboards** directly onto your Figma canvas with native, editable vector nodes and components.

---

## 🚀 How to Run in Figma (Takes 30 Seconds)

### If using the Figma Desktop App (Windows / Mac)
1. Open the **Figma Desktop app** and open any design file (or create a new empty file).
2. Right-click anywhere on the canvas (or click the Figma logo in the top-left menu) and go to:
   **Plugins** ➔ **Development** ➔ **Import plugin from manifest...**
3. In the file picker, select:
   `C:\Users\abhin\Projects\catan-game\tools\figma-plugin\manifest.json`
4. The plugin is now imported! To run it:
   Right-click canvas ➔ **Plugins** ➔ **Development** ➔ **Catan 3D Design Suite Generator** (or search for it in the Quick Actions menu `Ctrl + /` or `Cmd + /`).
5. A dark-blue modal will appear:
   * Click **🚀 Generate Complete 3D Suite (All 8 Artboards)**.
   * Watch as the plugin parses all vector graphics, extrudes the 3D elevated hexes, places the hand-carved pieces, and lays out all 10 screen flows.
   * Figma will automatically zoom and center onto the full design system!

### If using Figma in the Browser (Chrome, Edge, Brave, etc.)
1. Make sure you have the [Figma Desktop App](https://figma.com/downloads) installed or the [Figma Desktop Agent](https://help.figma.com/hc/en-us/articles/360041539433-Install-the-Figma-desktop-app) running so local plugins can be read.
2. Open your Figma design file in the browser.
3. Go to: **Menu** (top-left) ➔ **Plugins** ➔ **Development** ➔ **Import plugin from manifest...**
4. Select `C:\Users\abhin\Projects\catan-game\tools\figma-plugin\manifest.json` and click **Run**.

---

## 📦 What the Plugin Generates on Your Canvas

The plugin creates a structured grid of 8 master artboards directly on your active Figma page:

```
[Row 1: y = 0]
  00 • 3D Assets & Design System (Master Library - 2400×1600)
       ├── 6 Elevated 3D Isometric Hex Biomes (Extruded stone slabs with canopy trees, clay quarries, sheep, wheat sheaves, mountain peaks, cactus)
       ├── 3D Beveled Wooden Playing Pieces (Roads, Cottages, Castle Keeps, Robber) in 6 Player Colors
       ├── 3D Isometric Tumbling Dice with specular reflections and pips
       ├── Carved Ivory Number Tokens with wood rims and red hot numbers (6 & 8)
       ├── 3D Maritime Harbor Buoys (3:1 generic anchors & 2:1 specialty docks)
       └── 10 Illustrated Cards (5 Resource cards + 5 Dev cards + Awards)

[Row 2: y = 1750]
  01 • Viewport Canvas & HUD Architecture (1600×1050)
       ├── 100% Viewport-Locked blueprint (100vw × 100vh, zero page scroll)
       ├── Draggable & Zoomable Canvas Layer boundary (0.6x to 2.5x zoom, pan gesture)
       ├── Fixed Top Cockpit Bar (Turn indicator, 3D dice display, turn timer)
       ├── Fixed Floating Right Dock (Leaderboard & live event feed)
       ├── Fixed Floating Bottom Dock (Tactile build bar + 5-card resource hand drawer)
       └── Floating Zoom Widget ([+] [100%] [-] [Fit ⛶])

[Row 3: y = 2950]  (1440×900 Desktop Screen Artboards)
  02 • Flow 1 & 2: Room Lobby, 6-Seat Roster, Settings Drawer, & Live 3D Board Preview
  03 • Flow 3, 4 & 5: Core In-Game HUD, 3D Board, Action Bar, & Hover Ghost Preview
  04 • Flow 6: Trade Exchange Modal (Bank rates + Player proposal builder + Counter-offers)

[Row 4: y = 4000]  (1440×900 Desktop Screen Artboards)
  05 • Flow 7: The Robber Strike (Simultaneous Discard-Half dialog + Victim Steal Wheel)
  06 • Flow 8 & 9: Development Card Hand Tray & 5-6 Player Special Build Phase Flag Alert
  07 • Flow 10: Victory Celebration Podium (Gold celebration banner, confetti particles, VP ledger)
```

---

## 🛠 Features & Technology
* **100% Native Figma Vectors:** Uses `figma.createNodeFromSvg()` so every piece, tile, text, and button is fully editable (you can change colors, adjust strokes, ungroup, and componentize).
* **Zero Network Dependency:** All vector artboards are bundled directly into `code.js`, so the plugin runs instantly offline.
* **Auto-Focus:** Automatically centers and frames your Figma viewport over the generated suite when generation completes.
