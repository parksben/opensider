#!/usr/bin/env python3
"""生成 README 横幅概念图 docs/banner.svg。

版式（左 → 中 → 右）：
  左  浏览器窗口：窗口外观 + 抽象网页线框，窗口内部右侧画侧栏聊天面板
  中  品牌图标 + 产品名 OpenSider，作为浏览器与本机 Agent 之间的连接枢纽
  右  一个圆角容器容纳 Claude Code / Codex / GitHub Copilot / OpenCode /
      Cursor 五家本机 Agent CLI，末行三颗点提示「还有更多」

连接关系用图形表达：浏览器 ↔ 枢纽是两条方向相反的数据流（流动光点），
枢纽 → 五家 Agent 是五条扇形分叉的线（末行那句提示不连线）。

图标几何不复制：直接 import 同目录的 generate_icon，复用同一套 conic 渐变
算法、立方体 clipPath 与扇形半径；banner 里图标约 164px，扇形步长从 1° 放宽到
2°（肉眼无差，多边形数量减半）。

主题：SVG 内部用 CSS 变量 + @media (prefers-color-scheme: dark) 切两套调色板。
第三方品牌标记为手写简化几何，不使用官方素材、不引外链资源。
"""

import math
import re
import sys
from pathlib import Path

# 只为一次生成而 import 同目录脚本，不要留下 scripts/__pycache__
sys.dont_write_bytecode = True

import generate_icon as gi

BRAND_DIR = Path(__file__).resolve().parent / "brand"

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

# 右侧 Agent 容器：一个圆角面板容纳 5 行 Agent + 1 行「还有更多」。
# 与左侧浏览器窗口等高（76..452）、上下边缘对齐；右边缘离画布 60，与左边缘 56 呼应。
# 命名避开窗口那段的 PANEL_W（那里是窗口内侧栏面板宽度，132）。
AGENTS_X, AGENTS_W = 1192.0, 348.0
AGENTS_Y, AGENTS_H, AGENTS_R = 76.0, 376.0, 20.0
AGENTS_PAD = 24.0  # 容器内上下留白
ROW_H = 54.0  # 每行 Agent 的高度（容器内共 5 行）
MORE_GAP = 14.0  # 末行提示与上面列表的间距
MORE_H = 44.0  # 末行提示高度
# 容器宽 348 = 左段（24 内边距 + 34 标记列 + 14 名字距列）+ 最长名字实测宽度
# （`GitHub Copilot CLI` 在 24px 下约 200）+ 右侧留白
MARK_SLOT = 34.0  # 标记列宽（五个名字靠固定列宽左对齐，不跟标记实际宽度跑）
MARK_PAD = 24.0  # 标记列距容器左边
NAME_GAP = 14.0  # 名字距标记列

# 左侧双向链路的两条线（浏览器右边缘 → 枢纽左侧环上）
LINK_A = "M576,252 C636,252 636,206 696,206"
LINK_B = "M576,276 C636,276 636,230 696,230"

AGENTS = ["Claude Code", "Codex", "GitHub Copilot", "OpenCode", "Cursor"]


def row_cy(i: int) -> float:
    """容器内第 i 行 Agent 的垂直中心。"""
    return AGENTS_Y + AGENTS_PAD + ROW_H / 2 + i * ROW_H


def more_cy() -> float:
    """末行「还有更多」提示的垂直中心。"""
    return AGENTS_Y + AGENTS_PAD + ROW_H * len(AGENTS) + MORE_GAP + MORE_H / 2


# ---------------------------------------------------------------- 中段图标


def icon_group(cx: float, cy: float, size: float, step: int = WEDGE_STEP) -> str:
    """把 generate_icon 的立方体 + conic 风车按 size 居中画在 (cx, cy)。

    step 是扇形步长：164px 的枢纽用 2°，20px 的侧栏小图标用 6° 就够。
    """
    scale = size / 512.0
    wedges = []
    for deg in range(0, 360, step):
        a1, a2 = math.radians(deg), math.radians(deg + step)
        x1 = gi.CX + gi.WEDGE_R * math.cos(a1)
        y1 = gi.CY + gi.WEDGE_R * math.sin(a1)
        x2 = gi.CX + gi.WEDGE_R * math.cos(a2)
        y2 = gi.CY + gi.WEDGE_R * math.sin(a2)
        r, g, b = gi.color_at(deg + step / 2)
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
    """枢纽右侧环上一点 → 容器内第 i 行左边沿的贝塞尔。"""
    cy = row_cy(i)
    deg = math.degrees(math.atan2(cy - HUB_CY, AGENTS_X - HUB_CX))
    sx, sy = ring_point(deg)
    end = AGENTS_X - 8  # 留一点空隙，光点不压到容器描边
    return (
        f"M{sx:.1f},{sy:.1f} "
        f"C{sx + 72:.1f},{sy:.1f} {end - 96:.1f},{cy:.1f} {end:.1f},{cy:.1f}"
    )


# ---------------------------------------------------------------- 卡片标记
#
# 四家标记都用各品牌官方矢量，不手抄 path、不改形状，只换填充色。
# 上游文件整份存 scripts/brand/（来源与商标说明见 docs/TECH_DESIGN.md）。

MARK_SIZE = 26.0  # 标记目标高度；行高 54，上下各留约 14 的呼吸
_PATH_TAG = re.compile(r"<path\b[^>]*>")
_D_ATTR = re.compile(r'\sd="([^"]*)"')
_FILL_ATTR = re.compile(r'\sfill="([^"]*)"')


def upstream_paths(filename: str) -> list:
    """读 scripts/brand/<filename>，每条 <path> 给一个 {d, fill, fill-rule, clip-rule}。

    上游 fill 只用来认出「是哪条 path」，不直接沿用：颜色由 banner 自己给，
    同一条 path 才能在深浅两套主题里复用。
    """
    svg = (BRAND_DIR / filename).read_text(encoding="utf-8")
    tags = _PATH_TAG.findall(svg)
    if not tags:
        raise ValueError("{}: 没找到 <path>".format(filename))
    out = []
    for tag in tags:
        fm = _FILL_ATTR.search(tag)
        item = {"d": _D_ATTR.search(tag).group(1), "fill": fm.group(1) if fm else None}
        for name in ("fill-rule", "clip-rule"):
            m = re.search(r'\s{0}="([^"]*)"'.format(name), tag)
            if m:
                item[name] = m.group(1)
        out.append(item)
    return out


def _mark_group(cx: float, cy: float, box: tuple, body: str) -> str:
    """把上游坐标系里的标记按实测 bbox 归一后居中画在 (cx, cy)。

    box 是标记本体的实测 bbox（x, y, w, h），不是上游 viewBox——上游
    viewBox 里常带无关留白或整块底板，按它缩放会偏小、偏位。

    注意是 bbox 的**中心**对到 (cx, cy)：早先写成对齐左上角，标记会整体
    下沉半个身高，跟右边的名字错位，右边距也被吃掉。
    """
    bx, by, bw, bh = box
    scale = MARK_SIZE / bh
    return (
        f'  <g transform="translate({cx} {cy}) scale({scale:.6f})'
        f' translate({-(bx + bw / 2):.3f} {-(by + bh / 2):.3f})">\n    {body}\n  </g>'
    )


def _path_tag(item: dict, cls=None, fill=None) -> str:
    attrs = ['d="{}"'.format(item["d"])]
    for name in ("fill-rule", "clip-rule"):
        if name in item:
            attrs.append('{}="{}"'.format(name, item[name]))
    if fill:
        attrs.append('fill="{}"'.format(fill))
    if cls:
        attrs.append('class="{}"'.format(cls))
    return "<path {} />".format(" ".join(attrs))


def _pick(filename: str, fill: str) -> dict:
    """按上游 fill 认出要的那条 path；认不出就报错，别静默画少一笔。"""
    hits = [p for p in upstream_paths(filename) if p["fill"] == fill]
    if len(hits) != 1:
        raise ValueError(
            "{}: 期望 1 条 fill={} 的 <path>，实际 {} 条".format(filename, fill, len(hits))
        )
    return hits[0]


def mark_claude(cx: float, cy: float) -> str:
    """Claude 星标：官方橙那条 path，同文件其余 path 是 "Claude Code" 字标。"""
    star = _pick("claude-code.svg", "#D97757")
    return _mark_group(
        cx, cy, (0.17, 1.10, 25.00, 25.00), _path_tag(star, fill="#D97757")
    )


def mark_copilot(cx: float, cy: float) -> str:
    """GitHub Octicons 的 copilot-24：头部轮廓 + 两只眼。"""
    body = "\n    ".join(
        _path_tag(p, cls="mkf") for p in upstream_paths("github-copilot.svg")
    )
    return _mark_group(cx, cy, (0.0, 0.0, 24.0, 24.0), body)


def mark_opencode(cx: float, cy: float) -> str:
    """opencode favicon：外框 + 内方块，丢掉深色底板（banner 里不需要垫底）。"""
    inner = _pick("opencode.svg", "#5A5858")
    outer = [p for p in upstream_paths("opencode.svg") if p["fill"] != "#5A5858"]
    if len(outer) != 1:
        raise ValueError("opencode.svg: 外框 path 不止一条（{} 条）".format(len(outer)))
    body = _path_tag(outer[0], cls="mkf") + _path_tag(inner, cls="mkdim")
    return _mark_group(cx, cy, (128.0, 96.0, 256.0, 320.0), body)


def mark_cursor(cx: float, cy: float) -> str:
    """Cursor 立方体：取官方 favicon 里那条立方体，丢掉圆角底板与描边层。"""
    cube = _pick("cursor.svg", "#edecec")
    return _mark_group(
        cx, cy, (96.0, 73.0, 320.735, 365.65), _path_tag(cube, cls="mkf")
    )


def mark_codex(cx: float, cy: float) -> str:
    """Codex（OpenAI 结）：上游 registry 给的单条 path，几何占满 24×24。"""
    knot = _pick("codex.svg", "currentColor")
    return _mark_group(
        cx, cy, (0.163, 0.001, 23.674, 24.0), _path_tag(knot, cls="mkf")
    )


# 顺序必须与 AGENTS 一一对应（Codex 在第二位）。
MARKERS = (mark_claude, mark_codex, mark_copilot, mark_opencode, mark_cursor)


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
{icon_group(452, 162, 20, step=6)}
    <rect x="470" y="159" width="46" height="7" rx="3.5" class="wire2f"/>
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
    nodes += [(AGENTS_X, row_cy(i)) for i in range(len(AGENTS))]
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


def agent_panel() -> str:
    """右段：一个圆角容器容纳多家本机 Agent，末行提示「还有更多」。

    容器本身承担「这是一组本机 Agent」的意象，行间只留一条细线；
    一行一个圆角矩形既占地方，也说不清「支持的不止这些」。
    """
    mx = AGENTS_X + MARK_PAD + MARK_SLOT / 2
    nx = AGENTS_X + MARK_PAD + MARK_SLOT + NAME_GAP
    rows = []
    for i, name in enumerate(AGENTS):
        cy = row_cy(i)
        rows.append(
            f"{MARKERS[i](mx, cy)}\n"
            f'    <text x="{nx:.1f}" y="{cy + 9:.1f}" class="chipname">'
            f'{name}<tspan class="chipcli" dx="6">CLI</tspan></text>'
        )
        if i < len(AGENTS) - 1:
            y = cy + ROW_H / 2
            rows.append(
                f'    <path d="M{AGENTS_X + MARK_PAD},{y:.1f}'
                f' H{AGENTS_X + AGENTS_W - 20:.1f}" class="hairline"/>'
            )

    cy = more_cy()
    dots = " ".join(
        f'<circle cx="{mx - 7 + k * 7:.1f}" cy="{cy:.1f}" r="1.9" class="moredot"/>'
        for k in range(3)
    )
    rows.append(
        f"    {dots}\n"
        f'    <text x="{nx:.1f}" y="{cy + 6:.1f}" class="morename">'
        f"and more local agents</text>"
    )

    return (
        "  <!-- 右段：本机 Agent（一个容器 + 末行还有更多） -->\n  <g>\n"
        f'    <rect x="{AGENTS_X}" y="{AGENTS_Y}" width="{AGENTS_W}" height="{AGENTS_H}"'
        f' rx="{AGENTS_R}" class="cardf stk"/>\n'
        + "\n".join(rows)
        + "\n  </g>"
    )


def zone_labels() -> str:
    return (
        f'  <text x="{(WIN_X + WIN_X + WIN_W) / 2:.1f}" y="56" text-anchor="middle"'
        f' class="zlabel">BROWSER</text>\n'
        f'  <text x="{AGENTS_X + AGENTS_W / 2:.1f}" y="56" text-anchor="middle"'
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
    .chipname{font-size:24px;font-weight:500;fill:var(--ink)}
    /* 不设 font-size：继承 .chipname，跟品牌名同字号，改上面不会脱节 */
    .chipcli{fill:var(--muted)}
    /* 末行「还有更多」：三颗点 + 次要色小字 */
    .morename{font-size:18px;fill:var(--muted)}
    .moredot{fill:var(--muted);opacity:.75}
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
    .stk{stroke:var(--line);stroke-width:1.2}
    .hairline{fill:none;stroke:var(--line);stroke-width:1.2}
    .lock{fill:none;stroke:var(--muted);stroke-width:1.5}
    .paperline{fill:none;stroke:var(--wire2);stroke-width:5;stroke-linecap:round;stroke-linejoin:round}
    .pickbox{stroke:var(--accent);stroke-width:2;stroke-dasharray:7 6}
    .ripple{fill:none;stroke:var(--accent);stroke-width:1.6;opacity:.35}
    .cursorring{fill:none;stroke:var(--accent);stroke-width:2.6}
    .mkf{fill:var(--ink)}
    .mkdim{fill:var(--muted)}
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
  <desc id="banner-desc">左：浏览器窗口（窗口内右侧是侧栏聊天面板）。中：OpenSider 图标与产品名，作为连接枢纽。右：一个容器列出 Claude Code、Codex、GitHub Copilot、OpenCode、Cursor 五家本机 Agent，末行提示还有更多。连线表示浏览器与 Agent 之间的双向数据流。</desc>
{DEFS}

  <rect x="0" y="0" width="{W}" height="{H}" rx="{BG_R}" class="bgf frame"/>

{zone_labels()}

{browser_window()}

{link_cables()}

{hub()}

{agent_panel()}

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
