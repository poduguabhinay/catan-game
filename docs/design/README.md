# Catan Multiplayer — UI/UX Design Suite (Figma Ready)

Welcome to the design suite for the online multiplayer Settlers of Catan game. This directory contains the complete graphical asset kit, viewport-locked canvas architecture, and high-fidelity screen flow artboards designed before coding the UI.

---

## 🎨 How to Open and Inspect the Designs

### Option A: Open in Figma (Recommended)
1. Open [Figma](https://figma.com) and create or open a project.
2. Drag and drop any of the `.svg` files below directly onto the canvas:
   - **`00_3D_ASSETS_AND_DESIGN_SYSTEM.svg`** — 2400×1600 Master Component & Asset Sheet (3D Hexes, Wooden Pieces, Dice, Cards, Tokens).
   - **`01_CANVAS_ARCHITECTURE_AND_HUD_SPEC.svg`** — Viewport-Locked Canvas & Fixed HUD Blueprint.
   - **`02_FLOW_LOBBY_AND_PREVIEW.svg`** — Room Lobby & Live 3D Board Preview.
   - **`03_FLOW_GAMEPLAY_AND_CANVAS.svg`** — Main Game Screen with 3D Board & Cockpit HUD.
   - **`04_FLOW_TRADE_NEGOTIATION.svg`** — Trade Exchange & Live Counter-Offers.
   - **`05_FLOW_ROBBER_AND_DISCARD.svg`** — Discard Half Dialog & Robber Steal Target Wheel.
   - **`06_FLOW_DEV_CARDS_AND_SBP.svg`** — Dev Card Hand Tray & 5-6P Special Build Phase.
   - **`07_FLOW_VICTORY_CELEBRATION.svg`** — Victory Podium & Confetti Cascade.
3. In Figma, all layers are grouped with semantic IDs (`#Left-Roster-Column`, `#3D-Board-Cluster`, `#Layer-1-Fixed-Top-Bar`), making them fully editable vector components.

### Option B: Open in Any Web Browser
Double-click any `.svg` file to open it in Chrome, Edge, or Firefox. It will render at crisp vector resolution with full drop shadows, gradients, and typography.

---

## 📋 Comprehensive Specifications

Read **[FIGMA_AND_UX_ARCHITECTURE.md](./FIGMA_AND_UX_ARCHITECTURE.md)** for:
* **100% Viewport-Locked Layout:** How zero-scroll is achieved across all screen sizes.
* **Pan & Zoom Canvas:** Mouse wheel zoom (0.6x to 2.5x), drag pan, and the `[+] [100%] [-] [Fit ⛶]` floating widget.
* **3D Graphical Asset Kit:** Detailed specs for 3D elevated hex biomes, timber roads, cottages, keeps, and tumbling dice.
* **Motion & Spring Physics Matrix:** `framer-motion` parameters for dice tumbling, card flight trajectories, settlement drops, and confetti.
* **Color Tokens & Typography:** Full design tokens table.
