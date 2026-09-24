# Catan Multiplayer — Figma Design Suite & UI/UX Architecture

> **Design-First Specification:** This document outlines the complete visual design system, viewport-locked layout architecture, interactive pan-and-zoom board canvas, 3D graphical assets, and motion design physics for the browser-based multiplayer Catan game.

---

## 1. How to Import and Use in Figma

All artboards in this directory are exported as **clean, valid, semantic SVG files** with named layer groups (`<g id="...">`), gradient definitions, and drop-shadow filters.

### Method A: Native Drag & Drop (Fastest & Fully Vector-Editable)
1. Open [Figma](https://figma.com) and create a new design file.
2. Drag and drop any `.svg` file from `docs/design/` directly onto your Figma canvas.
3. Figma will parse the SVG and automatically create **named frames and groups**:
   - `00_3D_ASSETS_AND_DESIGN_SYSTEM.svg` ➔ 2400×1600 Master Component & Asset Sheet.
   - `01_CANVAS_ARCHITECTURE_AND_HUD_SPEC.svg` ➔ Viewport Layer Blueprint.
   - `02_FLOW_LOBBY_AND_PREVIEW.svg` ➔ 1440×900 Room Lobby & Board Generator Preview.
   - `03_FLOW_GAMEPLAY_AND_CANVAS.svg` ➔ 1440×900 Core Gameplay & Cockpit HUD.
   - `04_FLOW_TRADE_NEGOTIATION.svg` ➔ 1440×900 Maritime & Player Trade Negotiation Modal.
   - `05_FLOW_ROBBER_AND_DISCARD.svg` ➔ 1440×900 Robber Relocation & Discard-Half Modal.
   - `06_FLOW_DEV_CARDS_AND_SBP.svg` ➔ 1440×900 Dev Card Hand Tray & 5-6P SBP Banner.
   - `07_FLOW_VICTORY_CELEBRATION.svg` ➔ 1440×900 Victory Podium & Confetti Cascade.
4. In Figma, select any imported element to inspect and tweak fills, strokes, corner radii, or typography.

### Method B: Live HTML-to-Figma Auto-Layout Conversion
1. Start the local client dev server: `pnpm dev`
2. Open Figma, install and launch the official Figma Community plugin [**html.to.design**](https://www.figma.com/community/plugin/1159123024924461424).
3. Paste `http://localhost:5173` into the plugin to import the live interactive page directly into native Figma Auto-Layout frames.

---

## 2. 100% Viewport-Locked UI Architecture (Zero Page Scroll)

### The Problem
Traditional web pages rely on vertical scrolling. For a complex tabletop strategy game, scrolling forces the player to constantly move between the board, their card hand, the leaderboard, and the dice, breaking immersion and causing missed interactions.

### The Solution: Layered Cockpit Architecture
The entire interface is strictly bound to `100vw` × `100vh` (`h-screen overflow-hidden`). No scrollbars ever appear on the window.

```
┌────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: TOP COCKPIT BAR (Fixed z-20)                                │
│  [Turn Status]           [3D Dice: = 8]     [Timer 01:38]  [Trade][End]│
├──────────────────────────────────────────────────────────┬─────────────┤
│                                                          │ LAYER 2:    │
│  LAYER 0: PAN & ZOOM CANVAS (z-0)                        │ RIGHT DOCK  │
│                                                          │ (Fixed z-20)│
│       Click & Drag anywhere on ocean to PAN              │ ┌─────────┐ │
│       Mouse Wheel / Trackpad Pinch to ZOOM (0.6x - 2.5x) │ │Players  │ │
│                                                          │ │1. Bob   │ │
│             [ 3D ISOMETRIC ELEVATED BOARD ]              │ │2. Alice │ │
│             • 3D Hex Slabs with Biomes                   │ │3. Carol │ │
│             • 3D Timber Roads, Cottages, Keeps           │ │4. Dave  │ │
│             • 3D Robber Pawn with Shadow                 │ └─────────┘ │
│             • Carved Ivory Number Tokens                 │ ┌─────────┐ │
│                                                          │ │Event Log│ │
│                                                          │ └─────────┘ │
│                                                          │ ┌─────────┐ │
│                                                          │ │Zoom Wgt │ │
│                                                          │ └─────────┘ │
├──────────────────────────────────────────────────────────┴─────────────┤
│  LAYER 4: BOTTOM COCKPIT DOCK (Fixed z-20)                             │
│  [Hand Cards: 🪵2 🧱1 🐑1 🌾2 ⛰1 | ⚔1]   [Build Bar: 🛣 🏠 🏛 🃏]      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Interactive Pan & Zoom Board Canvas

### Interaction Model
* **Mouse Wheel / Trackpad Pinch:** Smoothly zooms the board canvas between `0.6x` (birds-eye full board view) and `2.5x` (close-up inspection of road networks and vertex intersections), centered on the user's cursor.
* **Click & Drag (Pan):** Clicking and dragging anywhere on the water or empty canvas pans the camera.
* **Zoom Widget (`[+] [100%] [-] [Fit ⛶]`):** Fixed floating controls in the bottom-right corner let players quickly reset to a centered fit with one click.
* **Separation of Concerns:** Interactive elements on the board (vertices, edges, hexes) scale with the board for effortless clicking at higher zoom levels, while all HUD controls remain locked at standard scale.

---

## 4. 3D Graphical Asset Suite Specification

### A. 3D Elevated Hexagonal Biomes (Terrain Slabs)
Each hex is rendered as an extruded 3D hexagonal slab with a 30px beveled drop foundation and top surface illumination:
* **Forest (Lumber):** Deep emerald gradient (`#2d6a36` ➔ `#19401f`) with multi-tiered 3D pine and oak canopy clusters, organic cast shadows, and undergrowth foliage.
* **Hills (Brick):** Terracotta clay gradient (`#ba5d2c` ➔ `#7a3614`) featuring terraced step quarries, exposed sandstone layers, and 3D stacks of fired bricks.
* **Pasture (Wool):** Bright lime-meadow gradient (`#88c442` ➔ `#558722`) with rolling elevation contours and 3D stylized fluffy sheep silhouettes grazing.
* **Fields (Grain):** Golden harvest gradient (`#f5c938` ➔ `#b88f12`) with furrowed diagonal crop rows, golden grain stalks, and bundled 3D wheat sheaves tied with red ribbons.
* **Mountains (Ore):** Slate granite gradient (`#8f9ca8` ➔ `#56626d`) with sharp chiseled peaks, pristine snow caps, and glowing blue/cyan crystalline ore veins (`#38bdf8`).
* **Desert (Barren):** Sunlit dune gradient (`#e3cb91` ➔ `#a8915b`) with sweeping wind-carved sand ripples and a 3D saguaro cactus model.

### B. Hand-Carved 3D Wooden Player Pieces (in 6 Player Colors)
Designed with tabletop bevels, top specular highlights, and soft ambient occlusion shadows:
* **Roads:** 3D beveled timber logs (`110×22px` nominal) with chamfered edges and directional grain lines.
* **Settlements:** Peaked-roof timber cottages (`50×55px`) with a steep gable roof bevel, chimney block, and recessed doorway.
* **Cities:** Two-story fortified stone keeps (`70×55px`) with a high lookout tower, defensive battlements notches, and an arched portcullis gate.
* **The Robber:** Faceted obsidian/charcoal pawn (`50×65px`) with an ominous ground-contact drop shadow.

### C. 3D Tumbling Dice
* True isometric rounded-corner cubes (`56×56px`) with specular gloss highlights, drop shadows, and inset black/red pips.
* Driven by a CSS `preserve-3d` tumbling cube animation during roll events.

### D. Embossed Number Tokens & Harbors
* **Number Tokens:** Thick carved ivory parchment disks (`Ø 68px`) inset into hex centers with wood-grain outer rims. Numbers 6 and 8 rendered in bold hot-red (`#dc2626`) with 5 red pip dots indicating maximum probability.
* **Maritime Harbors:** 3D wooden dock piers extending from coastal edges, supporting buoyant flotation buoys with 2:1 specialty icons or 3:1 generic anchors.

---

## 5. Motion Design & Spring Physics Matrix

Fluid transitions are specified using spring physics (`framer-motion` / CSS springs) rather than linear or ease-in-out curves:

| Interaction / Event | Animation Behavior | Physics Parameters |
|---|---|---|
| **Dice Roll** | 3D tumbling cube rotation across table, settling on final pips | Duration: `800ms`, cubic-bezier or tumbling keyframes |
| **Harvest Yield** | Producing hex elevates with subtle scale pulse (`1.0 ➔ 1.06 ➔ 1.0`); resource cards float from hex into player's hand tray | Scale pulse: `stiffness: 300, damping: 18`<br>Card flight: `spring, bounce: 0.2` |
| **Settlement Drop** | Settlement drops from above with realistic tabletop bounce | `type: "spring", stiffness: 400, damping: 25, bounce: 0.45` |
| **Road Placement** | Timber log slides outward along the edge with soft settle | `type: "spring", stiffness: 350, damping: 22` |
| **Robber Movement** | Robber lifts off, hovers with elevated drop shadow, slides across to target hex, and sets down | Elevation: `scale: 1.15, shadow: 24px`<br>Slide: `duration: 400ms, ease: "easeInOut"` |
| **Trade Modal & Drawer** | Glassmorphic modal slides up with smooth spring dampening | `type: "spring", stiffness: 320, damping: 30` |
| **Counter-Offer Card** | Counter-offer card flips into view with 3D Y-axis flip | `rotateY: [-90, 0], duration: 350ms` |
| **Victory Celebration** | Full-screen gold vignette glow + multi-colored canvas confetti particle cascade | Confetti: `canvas-confetti`, 220 particles, spread 100° |

---

## 6. Color Tokens & Theme Guide

```css
:root {
  /* Background Canvas */
  --catan-sea-deep: #03111e;
  --catan-sea-surface: #0a2e52;
  --catan-sea-highlight: #072b4a;

  /* Cockpit HUD Panels */
  --catan-panel-bg: #0d3b66;
  --catan-panel-border: #1d64a6;
  --catan-panel-inner: #061c33;
  --catan-text-primary: #ffffff;
  --catan-text-secondary: #8cb3d9;
  --catan-text-muted: #64748b;

  /* Accent & Action CTAs */
  --catan-cta-orange: #f06800;
  --catan-cta-hover: #d05800;
  --catan-gold-harvest: #ffd54f;
  --catan-success-green: #1fab1c;
  --catan-danger-red: #ef3f2a;

  /* Player Piece Colors (Main / Shadow) */
  --catan-player-red: #ff4d4d;
  --catan-player-red-shadow: #800000;
  --catan-player-blue: #38bdf8;
  --catan-player-blue-shadow: #004080;
  --catan-player-orange: #f97316;
  --catan-player-orange-shadow: #803300;
  --catan-player-white: #f8fafc;
  --catan-player-white-shadow: #94a3b8;
  --catan-player-green: #4ade80;
  --catan-player-green-shadow: #0e561e;
  --catan-player-brown: #a87146;
  --catan-player-brown-shadow: #3e2723;
}
```

---

## 7. Inventory of Artboard Files in `docs/design/`

1. **`00_3D_ASSETS_AND_DESIGN_SYSTEM.svg`** — Complete 2400×1600 master design system containing all 6 elevated 3D hex biomes, 3D wooden roads, settlements, cities, robber pawn, 3D tumbling dice, 10 illustrated cards, carved number tokens, and HUD components.
2. **`01_CANVAS_ARCHITECTURE_AND_HUD_SPEC.svg`** — Blueprint specifying the 100% viewport-locked desktop frame, pan-and-zoom canvas interaction boundary, fixed HUD layers, and zoom widget.
3. **`02_FLOW_LOBBY_AND_PREVIEW.svg`** — Room lobby screen featuring 6 player seat slots with avatar colors and ready badges, host match settings drawer, and live 3D board generator preview.
4. **`03_FLOW_GAMEPLAY_AND_CANVAS.svg`** — Main gameplay screen showing the 3D board inside the draggable canvas, fixed top cockpit bar, leaderboard & live event feed, and bottom build bar + hand drawer.
5. **`04_FLOW_TRADE_NEGOTIATION.svg`** — Trade modal with maritime harbor exchange rates and player-to-player trade offer builder with live opponent counter-proposals.
6. **`05_FLOW_ROBBER_AND_DISCARD.svg`** — The 7-roll robber event: simultaneous Discard-Half dialog with card steppers and the circular Victim Steal Wheel with eligible opponent targets.
7. **`06_FLOW_DEV_CARDS_AND_SBP.svg`** — Development card tray with playable vs. turn-locked card states, Monopoly dialog, and 5-6 player Special Build Phase alert banner.
8. **`07_FLOW_VICTORY_CELEBRATION.svg`** — Full-screen victory podium with celebration banner, confetti particles, and animated Victory Point ledger breakdown.
