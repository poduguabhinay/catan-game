import os
import json
def build_plugin():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(os.path.dirname(script_dir))
    design_dir = os.path.join(project_root, "docs", "design")
    plugin_dir = script_dir
    os.makedirs(plugin_dir, exist_ok=True)
    
    artboards = [
        {
            "id": "00_3D_ASSETS_AND_DESIGN_SYSTEM",
            "name": "00 • 3D Assets & Design System (Master Library)",
            "file": "00_3D_ASSETS_AND_DESIGN_SYSTEM.svg",
            "x": 0,
            "y": 0,
            "category": "assets"
        },
        {
            "id": "01_CANVAS_ARCHITECTURE_AND_HUD_SPEC",
            "name": "01 • Viewport Canvas & HUD Architecture (100% Viewport-Locked)",
            "file": "01_CANVAS_ARCHITECTURE_AND_HUD_SPEC.svg",
            "x": 0,
            "y": 1750,
            "category": "architecture"
        },
        {
            "id": "02_FLOW_LOBBY_AND_PREVIEW",
            "name": "02 • Flow 1 & 2: Room Lobby & 3D Board Preview",
            "file": "02_FLOW_LOBBY_AND_PREVIEW.svg",
            "x": 0,
            "y": 2950,
            "category": "flow"
        },
        {
            "id": "03_FLOW_GAMEPLAY_AND_CANVAS",
            "name": "03 • Flow 3, 4 & 5: Main Gameplay, 3D Board & Cockpit HUD",
            "file": "03_FLOW_GAMEPLAY_AND_CANVAS.svg",
            "x": 1600,
            "y": 2950,
            "category": "flow"
        },
        {
            "id": "04_FLOW_TRADE_NEGOTIATION",
            "name": "04 • Flow 6: Trade Dock & Counter-Offer Negotiation",
            "file": "04_FLOW_TRADE_NEGOTIATION.svg",
            "x": 3200,
            "y": 2950,
            "category": "flow"
        },
        {
            "id": "05_FLOW_ROBBER_AND_DISCARD",
            "name": "05 • Flow 7: Robber Strike, Discard Half & Steal Wheel",
            "file": "05_FLOW_ROBBER_AND_DISCARD.svg",
            "x": 0,
            "y": 4000,
            "category": "flow"
        },
        {
            "id": "06_FLOW_DEV_CARDS_AND_SBP",
            "name": "06 • Flow 8 & 9: Dev Cards Tray & 5-6P Special Build Phase",
            "file": "06_FLOW_DEV_CARDS_AND_SBP.svg",
            "x": 1600,
            "y": 4000,
            "category": "flow"
        },
        {
            "id": "07_FLOW_VICTORY_CELEBRATION",
            "name": "07 • Flow 10: Victory Celebration Podium & Confetti",
            "file": "07_FLOW_VICTORY_CELEBRATION.svg",
            "x": 3200,
            "y": 4000,
            "category": "flow"
        }
    ]
    
    # Load all SVG strings
    artboard_data = []
    for ab in artboards:
        path = os.path.join(design_dir, ab["file"])
        with open(path, "r", encoding="utf-8") as f:
            svg_str = f.read()
        artboard_data.append({
            "id": ab["id"],
            "name": ab["name"],
            "x": ab["x"],
            "y": ab["y"],
            "category": ab["category"],
            "svg": svg_str
        })
        print(f"Loaded {ab['file']} ({len(svg_str)} bytes)")
    
    # Generate code.js
    code_js = f'''// Figma Plugin Code: Generates Catan 3D Visual Suite on canvas
// Uses native figma.createNodeFromSvg() to generate vector nodes & frames

const ARTBOARDS = {json.dumps(artboard_data, indent=2)};

figma.showUI(__html__, {{ width: 460, height: 600 }});

figma.ui.onmessage = async (msg) => {{
  if (msg.type === 'generate') {{
    const categoryFilter = msg.category; // 'all', 'assets', 'flows'
    
    try {{
      figma.notify("🎨 Initializing Catan 3D Design Suite generation...", {{ timeout: 2000 }});
      
      const createdNodes = [];
      
      for (let i = 0; i < ARTBOARDS.length; i++) {{
        const ab = ARTBOARDS[i];
        if (categoryFilter !== 'all' && ab.category !== categoryFilter) {{
          continue;
        }}
        
        figma.ui.postMessage({{
          type: 'progress',
          current: i + 1,
          total: ARTBOARDS.length,
          name: ab.name
        }});
        
        // Native Figma SVG Parser creates full vector hierarchy
        const node = figma.createNodeFromSvg(ab.svg);
        node.name = ab.name;
        node.x = ab.x;
        node.y = ab.y;
        
        figma.currentPage.appendChild(node);
        createdNodes.push(node);
      }}
      
      if (createdNodes.length > 0) {{
        // Auto-focus and zoom into all generated frames
        figma.viewport.scrollAndZoomIntoView(createdNodes);
        figma.notify("🎉 Successfully generated " + createdNodes.length + " artboards on your canvas!", {{ timeout: 5000 }});
        
        figma.ui.postMessage({{
          type: 'completed',
          count: createdNodes.length
        }});
      }} else {{
        figma.notify("No artboards matched the selected filter.", {{ error: true }});
      }}
    }} catch (err) {{
      console.error("Figma generation error:", err);
      figma.notify("Error generating design: " + String(err), {{ error: true }});
      figma.ui.postMessage({{ type: 'error', message: String(err) }});
    }}
  }} else if (msg.type === 'close') {{
    figma.closePlugin();
  }}
}};
'''
    with open(os.path.join(plugin_dir, "code.js"), "w", encoding="utf-8") as f:
        f.write(code_js)
    print(f"Generated {plugin_dir}/code.js ({len(code_js)} bytes)")
    
    # Generate ui.html
    ui_html = '''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #03111e;
      color: #f6f8fa;
      padding: 24px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    .header {
      margin-bottom: 20px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    p {
      font-size: 12px;
      color: #7fa6c9;
      margin-top: 6px;
      line-height: 1.5;
    }
    .badge {
      display: inline-block;
      background: #f06800;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .card {
      background: #072644;
      border: 1px solid #164e80;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 16px;
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .feature-list {
      list-style: none;
      font-size: 12px;
      color: #cbd5e1;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .feature-list li {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .feature-list span.icon {
      font-size: 14px;
    }
    .btn {
      width: 100%;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn-primary {
      background: #f06800;
      color: #ffffff;
      margin-bottom: 8px;
    }
    .btn-primary:hover {
      background: #d95800;
      box-shadow: 0 4px 12px rgba(240, 104, 0, 0.4);
    }
    .btn-secondary {
      background: #0d3b66;
      color: #38bdf8;
      border: 1px solid #1d64a6;
      margin-bottom: 8px;
    }
    .btn-secondary:hover {
      background: #114c82;
      color: #ffffff;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      box-shadow: none;
    }
    .progress-box {
      background: #04182a;
      border: 1px solid #1d4d7a;
      border-radius: 8px;
      padding: 12px;
      font-size: 11px;
      color: #8cb3d9;
      display: none;
    }
    .progress-box.active {
      display: block;
    }
    .progress-bar-bg {
      width: 100%;
      height: 6px;
      background: #08294a;
      border-radius: 3px;
      margin-top: 8px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: #ffd54f;
      width: 0%;
      transition: width 0.2s ease;
    }
    .footer {
      font-size: 11px;
      color: #64748b;
      text-align: center;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1><span>🎲</span> Catan 3D Design Suite <span class="badge">v1.0</span></h1>
    <p>Generate high-fidelity 3D isometric hexes, hand-carved wooden pieces, tumbling dice, and 10 complete viewport-locked screen flow artboards directly onto your Figma canvas.</p>
  </div>

  <div class="card">
    <ul class="feature-list">
      <li><span class="icon">🏔</span> <b>6 Elevated 3D Hex Biomes</b> with trees, quarries, sheep, wheat, and mountains</li>
      <li><span class="icon">🏠</span> <b>3D Beveled Wooden Pieces</b> (Roads, Cottages, Castle Keeps, Robber) in 6 player colors</li>
      <li><span class="icon">🎲</span> <b>3D Tumbling Isometric Dice</b> with specular reflections and pips</li>
      <li><span class="icon">⛶</span> <b>100% Viewport-Locked Canvas Architecture</b> (Zero page scroll, pan &amp; zoom)</li>
      <li><span class="icon">🔁</span> <b>10 Screen Flow Artboards</b> (Lobby, Placement, Harvest, Trade, Robber, Victory)</li>
    </ul>

    <div style="margin-top: 16px;">
      <button class="btn btn-primary" id="btn-all">
        <span>🚀</span> Generate Complete 3D Suite (All 8 Artboards)
      </button>
      <button class="btn btn-secondary" id="btn-assets">
        <span>🎨</span> Generate 3D Asset Master Library Only
      </button>
      <button class="btn btn-secondary" id="btn-flows">
        <span>📱</span> Generate Gameplay Screen Flows Only
      </button>
    </div>

    <div class="progress-box" id="progress-box">
      <div id="progress-text">Generating artboards...</div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" id="progress-fill"></div>
      </div>
    </div>
  </div>

  <div class="footer">
    Catan Multiplayer • Built for Figma Plugin API • Fully Editable Vectors
  </div>

  <script>
    const btnAll = document.getElementById('btn-all');
    const btnAssets = document.getElementById('btn-assets');
    const btnFlows = document.getElementById('btn-flows');
    const progressBox = document.getElementById('progress-box');
    const progressText = document.getElementById('progress-text');
    const progressFill = document.getElementById('progress-fill');

    function startGeneration(category) {
      btnAll.disabled = true;
      btnAssets.disabled = true;
      btnFlows.disabled = true;
      progressBox.classList.add('active');
      progressText.textContent = 'Generating on Figma canvas...';
      progressFill.style.width = '10%';

      parent.postMessage({ pluginMessage: { type: 'generate', category } }, '*');
    }

    btnAll.onclick = () => startGeneration('all');
    btnAssets.onclick = () => startGeneration('assets');
    btnFlows.onclick = () => startGeneration('flow');

    window.onmessage = (event) => {
      const msg = event.data.pluginMessage;
      if (!msg) return;

      if (msg.type === 'progress') {
        const pct = Math.round((msg.current / msg.total) * 100);
        progressFill.style.width = pct + '%';
        progressText.textContent = 'Creating: ' + msg.name;
      } else if (msg.type === 'completed') {
        progressFill.style.width = '100%';
        progressText.textContent = 'Done! Generated ' + msg.count + ' artboards on canvas 🎉';
        setTimeout(() => {
          btnAll.disabled = false;
          btnAssets.disabled = false;
          btnFlows.disabled = false;
        }, 1500);
      } else if (msg.type === 'error') {
        progressText.textContent = 'Error: ' + msg.message;
        btnAll.disabled = false;
        btnAssets.disabled = false;
        btnFlows.disabled = false;
      }
    };
  </script>
</body>
</html>
'''
    with open(os.path.join(plugin_dir, "ui.html"), "w", encoding="utf-8") as f:
        f.write(ui_html)
    print(f"Generated {plugin_dir}/ui.html ({len(ui_html)} bytes)")

build_plugin()
