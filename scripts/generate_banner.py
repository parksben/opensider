#!/usr/bin/env python3
"""生成 README 横幅概念图 docs/banner.svg。

版式（左 → 中 → 右）：
  左  浏览器窗口：窗口外观 + 抽象网页线框，窗口内部右侧画侧栏聊天面板
  中  品牌图标 + 产品名 OpenSider，作为浏览器与本机 Agent 之间的连接枢纽
  右  Claude Code / GitHub Copilot / OpenCode / Cursor 四家本机 Agent CLI

连接关系用图形表达：浏览器 ↔ 枢纽是两条方向相反的数据流（流动光点），
枢纽 → 四家 Agent 是四条扇形分叉的线。

图标几何不复制：直接 import 同目录的 generate_icon，复用同一套 conic 渐变
算法、立方体 clipPath 与扇形半径；banner 里图标约 164px，扇形步长从 1° 放宽到
2°（肉眼无差，多边形数量减半）。

主题：SVG 内部用 CSS 变量 + @media (prefers-color-scheme: dark) 切两套调色板。
第三方品牌标记为手写简化几何，不使用官方素材、不引外链资源。
"""

import math
import sys
from pathlib import Path

# 只为一次生成而 import 同目录脚本，不要留下 scripts/__pycache__
sys.dont_write_bytecode = True

import generate_icon as gi

# ---------------------------------------------------------------- 画布与布局

W, H = 1600, 520
BG_R = 28.0  # 背景圆角

# 浏览器窗口
WIN_X, WIN_Y, WIN_W, WIN_H = 56.0, 76.0, 520.0, 376.0
BAR_H = 48.0  # 窗口标题栏高度
PAD = 16.0  # 内容区与窗口边框的间距
PANEL_W = 132.0  # 窗口内右侧栏宽度

# 中段枢纽
HUB_CX, HUB_CY = 800.0, 218.0
RING_R = 104.0
ICON_SIZE = 152.0
WEDGE_STEP = 2  # 扇形步长（度），generate_icon 用 1°

# 右侧 Agent 卡片
CHIP_X, CHIP_W, CHIP_H, CHIP_GAP, CHIP_TOP = 1120.0, 420.0, 72.0, 32.0, 76.0
MARK_BOX = 48.0  # 标记方框边长
MARK_PAD = 22.0  # 标记距卡片左边距
NAME_GAP = 22.0  # 标记与名字之间的间距

# 左侧双向链路的两条线（浏览器右边缘 → 枢纽左侧环上）
LINK_A = "M576,252 C636,252 636,206 696,206"
LINK_B = "M576,276 C636,276 636,230 696,230"

AGENTS = ["Claude Code", "GitHub Copilot", "OpenCode", "Cursor"]


def chip_cy(i: int) -> float:
    """第 i 张 Agent 卡片的垂直中心。"""
    return CHIP_TOP + CHIP_H / 2 + i * (CHIP_H + CHIP_GAP)


# ---------------------------------------------------------------- 中段图标


def icon_group(cx: float, cy: float, size: float) -> str:
    """把 generate_icon 的立方体 + conic 风车按 size 居中画在 (cx, cy)。"""
    scale = size / 512.0
    wedges = []
    for deg in range(0, 360, WEDGE_STEP):
        a1, a2 = math.radians(deg), math.radians(deg + WEDGE_STEP)
        x1 = gi.CX + gi.WEDGE_R * math.cos(a1)
        y1 = gi.CY + gi.WEDGE_R * math.sin(a1)
        x2 = gi.CX + gi.WEDGE_R * math.cos(a2)
        y2 = gi.CY + gi.WEDGE_R * math.sin(a2)
        r, g, b = gi.color_at(deg + WEDGE_STEP / 2)
        wedges.append(
            f'<polygon points="{gi.CX},{gi.CY} {x1:.1f},{y1:.1f} {x2:.1f},{y2:.1f}"'
            f' fill="#{r:02X}{g:02X}{b:02X}"/>'
        )
    body = "\n        ".join(wedges)
    return (
        f'  <g transform="translate({cx} {cy}) scale({scale:.6f}) translate(-256 -256)">\n'
        f'    <g transform="translate(45.48 16) scale(0.9021)">\n'
        f'      <g clip-path="url(#opensider-cube)">\n'
        f"        {body}\n"
        f"      </g>\n"
        f"    </g>\n"
        f"  </g>"
    )


def cube_clip_path() -> str:
    outer = gi.rounded_polygon_path(gi.HEX_VERTICES, gi.HEX_CORNER_R)
    hole = gi.rounded_polygon_path(gi.TRI_VERTICES, gi.CORNER_R, transform=True)
    return f"{outer}{hole}"


# ---------------------------------------------------------------- 连线


def ring_point(deg: float) -> tuple:
    a = math.radians(deg)
    return HUB_CX + RING_R * math.cos(a), HUB_CY + RING_R * math.sin(a)


def fan_path(i: int) -> str:
    """枢纽右侧环上一点 → 第 i 张卡片左边沿的贝塞尔。"""
    cy = chip_cy(i)
    deg = math.degrees(math.atan2(cy - HUB_CY, CHIP_X - HUB_CX))
    sx, sy = ring_point(deg)
    end = CHIP_X - 6  # 留一点空隙，光点不压到卡片描边
    return (
        f"M{sx:.1f},{sy:.1f} "
        f"C{sx + 72:.1f},{sy:.1f} {end - 96:.1f},{cy:.1f} {end:.1f},{cy:.1f}"
    )


# ---------------------------------------------------------------- 卡片标记


def mark_claude(cx: float, cy: float) -> str:
    """放射花：12 片由中心向外收尖的细花瓣。花瓣要细，粗了就糊成一坨。"""
    petal = (
        "M0,-22 C1.8,-22 2.6,-11 2.6,-6 C2.6,-2 1.6,0 0,0 "
        "C-1.6,0 -2.6,-2 -2.6,-6 C-2.6,-11 -1.8,-22 0,-22 Z"
    )
    rays = "".join(
        f'<path d="{petal}" transform="rotate({i * 30})"/>' for i in range(12)
    )
    return f'  <g transform="translate({cx} {cy})" fill="#D97757">{rays}</g>'


def mark_copilot(cx: float, cy: float) -> str:
    """护目面罩：圆角头盔 + 下颌缺口，中间两个镂空竖眼。

    别做成「圆角方框 + 两个居中竖条」——缩到 README 宽度就只剩一对白棍，
    看着像暂停键。下颌缺口是把它读成「脸」的关键。
    """
    face = (
        "M0,-19 C-11.6,-19 -21,-9.6 -21,2 V19 H-8 V15 "
        "C-8,12.4 -3.6,10.4 0,10.4 C3.6,10.4 8,12.4 8,15 V19 H21 V2 "
        "C21,-9.6 11.6,-19 0,-19 Z"
    )
    return (
        f'  <g transform="translate({cx} {cy})" class="mkf">\n'
        f'    <path d="{face}"/>\n'
        f'    <rect x="-8.5" y="-8" width="6" height="11" rx="3" class="eyef"/>\n'
        f'    <rect x="2.5" y="-8" width="6" height="11" rx="3" class="eyef"/>\n'
        f"  </g>"
    )


def mark_opencode(cx: float, cy: float) -> str:
    """终端框：圆角方框 + 提示符 `>_`。"""
    return (
        f'  <g transform="translate({cx} {cy})" class="mk">\n'
        f'    <rect x="-19" y="-19" width="38" height="38" rx="11"/>\n'
        f'    <path d="M-8,-6 L-1,1 L-8,8"/>\n'
        f'    <path d="M2,8 H9"/>\n'
        f"  </g>"
    )


def mark_cursor(cx: float, cy: float) -> str:
    """等轴立方体：尖顶六边形 + 中心三条棱。"""
    r = 21.0
    rx = r * math.sqrt(3) / 2
    hexagon = (
        f"M0,{-r:.1f} L{rx:.1f},{-r / 2:.1f} L{rx:.1f},{r / 2:.1f} "
        f"L0,{r:.1f} L{-rx:.1f},{r / 2:.1f} L{-rx:.1f},{-r / 2:.1f} Z"
    )
    spokes = "".join(
        f'<path d="M0,0 L{px:.1f},{py:.1f}"/>'
        for px, py in ((0, -r), (rx, r / 2), (-rx, r / 2))
    )
    return (
        f'  <g transform="translate({cx} {cy})" class="mk3">\n'
        f'    <path d="{hexagon}"/>\n'
        f"    {spokes}\n"
        f"  </g>"
    )


MARKERS = (mark_claude, mark_copilot, mark_opencode, mark_cursor)


# ---------------------------------------------------------------- 各区域


def browser_window() -> str:
    """左段：浏览器窗口（标题栏 + 网页线框 + 内置侧栏聊天面板）。"""
    inner_y = WIN_Y + BAR_H + PAD  # 内容区顶
    inner_b = WIN_Y + WIN_H - PAD  # 内容区底
    page_x, page_r = WIN_X + PAD, WIN_X + WIN_W - PAD - PANEL_W - 16
    panel_x = WIN_X + WIN_W - PAD - PANEL_W

    nav = "".join(
        f'<rect x="{x}" y="158" width="{w}" height="6" rx="3" class="wiref"/>'
        for x, w in ((100, 34), (146, 28), (186, 40))
    )
    lines = "".join(
        f'<rect x="{page_x}" y="{y}" width="{w}" height="7" rx="3.5" class="wiref"/>'
        for y, w in ((282, 320), (298, 236))
    )
    cards = "".join(
        f'<rect x="{x}" y="390" width="{w}" height="46" rx="10" class="wiref"/>'
        f'<rect x="{x + 12}" y="404" width="{l1}" height="6" rx="3" class="wire2f"/>'
        f'<rect x="{x + 12}" y="418" width="{l2}" height="6" rx="3" class="wire2f"/>'
        for x, w, l1, l2 in ((page_x, 160, 110, 72), (242, 170, 120, 80))
    )
    bubbles = (
        # Agent 气泡 ×2 + 用户气泡
        '<rect x="442" y="186" width="104" height="44" rx="10" class="wiref"/>'
        '<rect x="454" y="196" width="80" height="5" rx="2.5" class="wire2f"/>'
        '<rect x="454" y="206" width="64" height="5" rx="2.5" class="wire2f"/>'
        '<rect x="454" y="216" width="44" height="5" rx="2.5" class="wire2f"/>'
        '<rect x="466" y="240" width="80" height="32" rx="10" class="accentsoftf"/>'
        '<rect x="478" y="250" width="56" height="5" rx="2.5" class="accentline"/>'
        '<rect x="478" y="259" width="36" height="5" rx="2.5" class="accentline"/>'
        '<rect x="442" y="282" width="104" height="58" rx="10" class="wiref"/>'
        '<rect x="454" y="292" width="80" height="5" rx="2.5" class="wire2f"/>'
        '<rect x="454" y="302" width="60" height="5" rx="2.5" class="wire2f"/>'
        '<rect x="454" y="314" width="10" height="10" rx="3" class="wire2f"/>'
        '<rect x="470" y="316" width="52" height="5" rx="2.5" class="wire2f"/>'
    )

    return f"""  <!-- 左段：浏览器窗口 -->
  <g>
    <rect x="{WIN_X}" y="{WIN_Y}" width="{WIN_W}" height="{WIN_H}" rx="18" class="cardf stk"/>
    <rect x="{WIN_X}" y="{WIN_Y}" width="{WIN_W}" height="{BAR_H}" rx="18" class="softf"/>
    <rect x="{WIN_X}" y="{WIN_Y + 22}" width="{WIN_W}" height="{BAR_H - 22}" class="softf"/>
    <path d="M{WIN_X},{WIN_Y + BAR_H} H{WIN_X + WIN_W}" class="hairline"/>
    <circle cx="88" cy="100" r="5.5" class="wire2f"/>
    <circle cx="110" cy="100" r="5.5" class="wire2f"/>
    <circle cx="132" cy="100" r="5.5" class="wire2f"/>
    <rect x="156" y="87" width="392" height="26" rx="13" class="cardf stk"/>
    <rect x="173" y="97" width="9" height="8" rx="2.5" class="lock"/>
    <path d="M175.2,97 v-2 a2.4,2.4 0 0 1 4.8,0 v2" class="lock"/>
    <rect x="192" y="98" width="150" height="5" rx="2.5" class="wire2f"/>

    <!-- 网页线框 -->
    <rect x="{page_x}" y="152" width="18" height="18" rx="5" class="wire2f"/>
    {nav}
    <rect x="{page_r - 56}" y="150" width="56" height="22" rx="11" class="wire2f"/>
    <rect x="{page_x}" y="186" width="340" height="80" rx="12" class="wiref"/>
    <circle cx="100" cy="208" r="7" class="wire2f"/>
    <path d="M86,250 L120,214 L148,244 L166,224 L200,250" class="paperline"/>
    {lines}

    <!-- 正在被 Agent 操作的控件 -->
    <rect x="{page_x}" y="318" width="340" height="56" rx="12" class="accentsoftf pickbox"/>
    <rect x="88" y="334" width="88" height="24" rx="12" class="accentf"/>
    <rect x="204" y="342" width="110" height="7" rx="3.5" class="wire2f"/>
    <circle cx="190" cy="336" r="15" class="ripple"/>
    <circle cx="190" cy="336" r="7.5" class="cursorring"/>
    <circle cx="190" cy="336" r="2.6" class="accentf"/>
    {cards}

    <!-- 窗口内置侧栏聊天面板 -->
    <rect x="{panel_x}" y="{inner_y}" width="{PANEL_W}" height="{inner_b - inner_y}" rx="12" class="panelf stk"/>
    <rect x="442" y="154" width="16" height="16" rx="5" class="brandf"/>
    <rect x="466" y="159" width="50" height="7" rx="3.5" class="wire2f"/>
    {bubbles}
    <rect x="442" y="382" width="104" height="42" rx="10" class="cardf stk"/>
    <rect x="454" y="396" width="52" height="6" rx="3" class="wiref"/>
    <circle cx="532" cy="403" r="9" class="accentf"/>
  </g>"""


def hub() -> str:
    """中段：光晕 + 虚线环 + 品牌图标 + 产品名。"""
    return f"""  <!-- 中段：产品本体（连接枢纽） -->
  <g>
    <circle cx="{HUB_CX}" cy="{HUB_CY}" r="122" class="hubglow"/>
    <circle cx="{HUB_CX}" cy="{HUB_CY}" r="{RING_R}" class="ring"/>
{icon_group(HUB_CX, HUB_CY, ICON_SIZE)}
    <text x="{HUB_CX}" y="364" text-anchor="middle" class="wordmark">OpenSider</text>
    <text x="{HUB_CX}" y="398" text-anchor="middle" class="sub">Browser × Local Agent</text>
  </g>"""


def link_cables() -> str:
    """连线的基线（不做动画，动画覆盖线另画）。"""
    paths = [f'<path class="cable" d="{LINK_A}"/>', f'<path class="cable" d="{LINK_B}"/>']
    for i in range(len(AGENTS)):
        paths.append(f'<path class="cable" d="{fan_path(i)}"/>')
    return (
        "  <!-- 连线基线 -->\n  <g>\n    "
        + "\n    ".join(paths)
        + "\n  </g>"
    )


def link_nodes() -> str:
    """连接点。画在卡片之上，才不会被卡片底色吃掉半颗。"""
    nodes = [(576, 252), (576, 276), (696, 206), (696, 230)]
    nodes += [(CHIP_X, chip_cy(i)) for i in range(len(AGENTS))]
    dots = "\n    ".join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.4" class="node"/>' for x, y in nodes
    )
    return f"  <!-- 连接点 -->\n  <g>\n    {dots}\n  </g>"


def link_flows() -> str:
    """流动光点：A 段向枢纽，B 段向浏览器（反向），四条扇形向外。"""
    flows = [
        f'<path class="flow" d="{LINK_A}"/>',
        f'<path class="flow rev" d="{LINK_B}"/>',
    ]
    for i in range(len(AGENTS)):
        flows.append(
            f'<path class="flow fan" style="animation-delay:{-0.9 * i:.2f}s"'
            f' d="{fan_path(i)}"/>'
        )
    return (
        "  <!-- 流动光点 -->\n  <g>\n    "
        + "\n    ".join(flows)
        + "\n  </g>"
    )


def agent_chips() -> str:
    """右段：四张 Agent 卡片（标记 + 名字）。"""
    rows = []
    for i, name in enumerate(AGENTS):
        cy = chip_cy(i)
        y = cy - CHIP_H / 2
        mx = CHIP_X + MARK_PAD + MARK_BOX / 2
        nx = CHIP_X + MARK_PAD + MARK_BOX + NAME_GAP
        rows.append(
            f'    <rect x="{CHIP_X}" y="{y:.1f}" width="{CHIP_W}" height="{CHIP_H}"'
            f' rx="16" class="cardf stk"/>\n'
            f"{MARKERS[i](mx, cy)}\n"
            f'    <text x="{nx:.1f}" y="{cy + 10:.1f}" class="chipname">{name}</text>'
        )
    return "  <!-- 右段：本机 Agent CLI -->\n  <g>\n" + "\n".join(rows) + "\n  </g>"


def zone_labels() -> str:
    return (
        f'  <text x="{(WIN_X + WIN_X + WIN_W) / 2:.1f}" y="56" text-anchor="middle"'
        f' class="zlabel">BROWSER</text>\n'
        f'  <text x="{CHIP_X + CHIP_W / 2:.1f}" y="56" text-anchor="middle"'
        f' class="zlabel">LOCAL AGENTS</text>'
    )


# ---------------------------------------------------------------- 样式与装配

STYLE = """
    :root{
      --bg-a:#FFFFFF; --bg-b:#F4F7FA; --frame:#E6EBF1;
      --card:#FFFFFF; --line:#E3E9F0; --soft:#F2F6FA; --panel:#FAFCFE;
      --wire:#E9EEF4; --wire2:#D6DFE9;
      --ink:#111827; --muted:#7C8A9A;
      --cable:#DCE4ED; --ring:#C6D2E0; --node:#B4C2D2;
      --accent:#4285F4; --accent-soft:#E8F0FE;
    }
    @media (prefers-color-scheme: dark){
      :root{
        --bg-a:#0D1117; --bg-b:#131A22; --frame:#232C37;
        --card:#161C24; --line:#27313C; --soft:#1A222B; --panel:#121922;
        --wire:#232D38; --wire2:#303C49;
        --ink:#E8EEF5; --muted:#8492A2;
        --cable:#2C3742; --ring:#33404E; --node:#4A5A6C;
        --accent:#8AB4F8; --accent-soft:#17273C;
      }
    }
    text{font-family:"IBM Plex Sans","Inter",-apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif}
    .zlabel{font-size:19px;font-weight:500;letter-spacing:2.8px;fill:var(--muted)}
    .wordmark{font-size:58px;font-weight:600;letter-spacing:-0.8px;fill:var(--ink)}
    .sub{font-size:19px;letter-spacing:1.4px;fill:var(--muted)}
    .chipname{font-size:27px;font-weight:500;fill:var(--ink)}
    .bgf{fill:url(#bg-grad)}
    .stop-a{stop-color:var(--bg-a)}
    .stop-b{stop-color:var(--bg-b)}
    /* 只描边，不能写 fill:none——会和 .bgf 同权重抢 fill */
    .frame{stroke:var(--frame);stroke-width:1.2}
    .cardf{fill:var(--card)}
    .softf{fill:var(--soft)}
    .panelf{fill:var(--panel)}
    .wiref{fill:var(--wire)}
    .wire2f{fill:var(--wire2)}
    .accentf{fill:var(--accent)}
    .accentsoftf{fill:var(--accent-soft)}
    .accentline{fill:var(--accent);opacity:.5}
    /* #brand-grad 用 objectBoundingBox，小元素才不会掉到渐变的端色上 */
    .brandf{fill:url(#brand-grad)}
    .eyef{fill:var(--card)}
    .stk{stroke:var(--line);stroke-width:1.2}
    .hairline{fill:none;stroke:var(--line);stroke-width:1.2}
    .lock{fill:none;stroke:var(--muted);stroke-width:1.5}
    .paperline{fill:none;stroke:var(--wire2);stroke-width:5;stroke-linecap:round;stroke-linejoin:round}
    .pickbox{stroke:var(--accent);stroke-width:2;stroke-dasharray:7 6}
    .ripple{fill:none;stroke:var(--accent);stroke-width:1.6;opacity:.35}
    .cursorring{fill:none;stroke:var(--accent);stroke-width:2.6}
    .mkf{fill:var(--ink)}
    .mk{fill:none;stroke:var(--ink);stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round}
    .mk3{fill:none;stroke:var(--ink);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
    .cable{fill:none;stroke:var(--cable);stroke-width:2.4}
    .ring{fill:none;stroke:var(--ring);stroke-width:1.4;stroke-dasharray:3 7}
    .node{fill:var(--node)}
    .hubglow{fill:url(#hub-glow)}
    .flow{fill:none;stroke:url(#flow-grad);stroke-width:4.4;stroke-linecap:round;
          stroke-dasharray:.5 26.5;animation:dash 3.4s linear infinite}
    .flow.rev{animation-direction:reverse}
    .flow.fan{animation-duration:4s}
    @keyframes dash{to{stroke-dashoffset:-27}}
    @media (prefers-reduced-motion: reduce){ .flow{animation:none} }
"""

DEFS = f"""  <defs>
    <style>{STYLE}  </style>
    <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" class="stop-a"/>
      <stop offset="1" class="stop-b"/>
    </linearGradient>
    <!-- 链路用 Chrome 四色：左段偏暖（红黄），右段偏冷（绿蓝） -->
    <linearGradient id="flow-grad" gradientUnits="userSpaceOnUse" x1="560" y1="0" x2="1130" y2="0">
      <stop offset="0" stop-color="#EA4335"/>
      <stop offset=".34" stop-color="#FBBC05"/>
      <stop offset=".67" stop-color="#34A853"/>
      <stop offset="1" stop-color="#4285F4"/>
    </linearGradient>
    <radialGradient id="hub-glow">
      <stop offset="0" stop-color="#4285F4" stop-opacity=".16"/>
      <stop offset=".6" stop-color="#34A853" stop-opacity=".06"/>
      <stop offset="1" stop-color="#34A853" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#EA4335"/>
      <stop offset=".4" stop-color="#FBBC05"/>
      <stop offset=".72" stop-color="#34A853"/>
      <stop offset="1" stop-color="#4285F4"/>
    </linearGradient>
    <clipPath id="opensider-cube">
      <path d="{cube_clip_path()}"/>
    </clipPath>
  </defs>"""


def build_svg() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!-- 由 scripts/generate_banner.py 生成，请勿手改 -->
<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"
     role="img" aria-labelledby="banner-title banner-desc">
  <title id="banner-title">OpenSider — 在浏览器里连接本机 Agent CLI</title>
  <desc id="banner-desc">左：浏览器窗口（窗口内右侧是侧栏聊天面板）。中：OpenSider 图标与产品名，作为连接枢纽。右：Claude Code、GitHub Copilot、OpenCode、Cursor 四家本机 Agent。连线表示浏览器与 Agent 之间的双向数据流。</desc>
{DEFS}

  <rect x="0" y="0" width="{W}" height="{H}" rx="{BG_R}" class="bgf frame"/>

{zone_labels()}

{browser_window()}

{link_cables()}

{hub()}

{agent_chips()}

{link_nodes()}

{link_flows()}
</svg>
"""


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "docs/banner.svg"
    out.write_text(build_svg(), encoding="utf-8")
    print(f"written: {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
