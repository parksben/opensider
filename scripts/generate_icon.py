#!/usr/bin/env python3
"""生成 OpenSider 扩展图标 packages/extension/assets/icon.svg。

造型：Cursor 官方立方体轮廓（CUBE_2D 路径，nonzero 规则中央光标区域自动镂空透明），
内部填 Google 三色顺时针渐变风车：红(上) → 黄(右下) → 绿(左下)。
渐变用 360 个 1° 扇形逼近 conic gradient；交界为直线，两侧各 20° 平滑过渡。
"""

import math
from pathlib import Path

# Cursor CUBE_2D 官方路径：六边形外轮廓
HEXAGON_PATH = (
    "M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94"
    "c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11"
    "l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98"
    "c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01Z"
)

# 镂空造型：等腰三角形（去掉原光标底部两条边、连成一条直边）。
# 三个锐角顶点由原光标外轮廓边线延长相交得到（原始坐标系），顺序保持原子路径缠绕方向
TRI_VERTICES = [
    (450.63, 140.61),  # 原光标右上顶点（旋转后显示为左上角）
    (238.23, 507.86),  # 原光标下尖端（旋转后显示为右侧角）
    (21.89, 140.61),   # 原光标左上顶点（旋转后显示为左下角）
]
# 三个角统一圆角半径，与原光标圆角一致（原路径圆角：切距 13.14、内角约 60°，r ≈ 7.59）
CORNER_R = 7.59

# 镂空三角形变换（以六边形中心为基准）：先逆时针 120°、再顺时针 30°，净逆时针 90°；
# 并等比缩放为原来的 √3/2（SVG 坐标系旋转正值为顺时针，故逆时针取负）
ARROW_ROTATE_DEG = -90.0
ARROW_SCALE = math.sqrt(3) / 2

CX, CY = 233.37, 266.05  # 立方体中心（原始路径坐标系）
WEDGE_R = 600.0  # 扇形半径，需超出六边形最远顶点（约 266）

RED = (234, 67, 53)  # #EA4335
YELLOW = (251, 188, 5)  # #FBBC05
GREEN = (52, 168, 83)  # #34A853

# 角度约定：SVG 坐标系（y 向下），0°=正右，角度增大 = 顺时针
# 三色中心：红 270°(正上)、黄 30°(右下)、绿 150°(左下)，顺时针红→黄→绿
_BASE_CENTERS = {270.0: RED, 30.0: YELLOW, 150.0: GREEN}
# 交界（相邻中心角平分线）：起点色 → 顺时针下一色
_BASE_BOUNDARIES = [(330.0, RED, YELLOW), (90.0, YELLOW, GREEN), (210.0, GREEN, RED)]
# 渐变风车整体顺时针旋转 30°（图形本体不动；SVG 坐标系角度增大 = 顺时针）
GRADIENT_ROTATE_DEG = 30.0

CENTERS = {(c + GRADIENT_ROTATE_DEG) % 360: col for c, col in _BASE_CENTERS.items()}
BOUNDARIES = [((b + GRADIENT_ROTATE_DEG) % 360, c0, c1) for b, c0, c1 in _BASE_BOUNDARIES]
TRANSITION = 40.0  # 交界渐变总宽度（度）


def smoothstep(x: float) -> float:
    return x * x * (3 - 2 * x)


def transform_point(x: float, y: float) -> tuple[float, float]:
    a = math.radians(ARROW_ROTATE_DEG)
    dx, dy = (x - CX) * ARROW_SCALE, (y - CY) * ARROW_SCALE
    return (
        CX + math.cos(a) * dx - math.sin(a) * dy,
        CY + math.sin(a) * dx + math.cos(a) * dy,
    )


def cutout_path() -> str:
    """圆角等腰三角形镂空路径：逐顶点算圆角切点，直线段 + 圆弧交替；
    切点经旋转/缩放变换后输出，圆角半径随 ARROW_SCALE 同步缩放。"""
    n = len(TRI_VERTICES)
    edges = []
    for i in range(n):
        x1, y1 = TRI_VERTICES[i]
        x2, y2 = TRI_VERTICES[(i + 1) % n]
        d = math.hypot(x2 - x1, y2 - y1)
        edges.append(((x2 - x1) / d, (y2 - y1) / d))
    tangents = []
    for i in range(n):
        x, y = TRI_VERTICES[i]
        ui, uo = edges[(i - 1) % n], edges[i]
        cos_theta = -(ui[0] * uo[0] + ui[1] * uo[1])  # 内角余弦：-u_in · u_out
        theta = math.acos(max(-1.0, min(1.0, cos_theta)))
        t = CORNER_R / math.tan(theta / 2)  # 圆角切距
        tangents.append(((x - ui[0] * t, y - ui[1] * t), (x + uo[0] * t, y + uo[1] * t)))
    r = CORNER_R * ARROW_SCALE
    parts = []
    for i in range(n):
        if i == 0:
            parts.append("M{:.2f},{:.2f}".format(*transform_point(*tangents[0][1])))
        t_in, t_out = tangents[(i + 1) % n]
        parts.append("L{:.2f},{:.2f}".format(*transform_point(*t_in)))
        parts.append("A{:.2f} {:.2f} 0 0 1 {:.2f},{:.2f}".format(r, r, *transform_point(*t_out)))
    parts.append("Z")
    return "".join(parts)


def color_at(deg: float) -> tuple[int, int, int]:
    deg %= 360.0
    for boundary, c0, c1 in BOUNDARIES:
        d = ((deg - boundary + 180) % 360) - 180  # 相对交界的有向角度
        if -TRANSITION / 2 <= d < TRANSITION / 2:
            s = smoothstep((d + TRANSITION / 2) / TRANSITION)
            return tuple(round(a + (b - a) * s) for a, b in zip(c0, c1))
    # 纯色区：取角度最近的扇区中心
    center = min(CENTERS, key=lambda c: abs(((deg - c + 180) % 360) - 180))
    return CENTERS[center]


def build_svg() -> str:
    wedges = []
    for i in range(360):
        a1, a2 = math.radians(i), math.radians(i + 1)
        x1, y1 = CX + WEDGE_R * math.cos(a1), CY + WEDGE_R * math.sin(a1)
        x2, y2 = CX + WEDGE_R * math.cos(a2), CY + WEDGE_R * math.sin(a2)
        r, g, b = color_at(i + 0.5)
        wedges.append(
            f'      <polygon points="{CX},{CY} {x1:.1f},{y1:.1f} '
            f'{x2:.1f},{y2:.1f}" fill="#{r:02X}{g:02X}{b:02X}"/>'
        )
    wedge_xml = "\n".join(wedges)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!-- 由 scripts/generate_icon.py 生成，请勿手改 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <clipPath id="cube-clip">
      <path d="{HEXAGON_PATH}{cutout_path()}"/>
    </clipPath>
  </defs>

  <g transform="translate(45.48 16) scale(0.9021)">
    <!-- Google 三色顺时针渐变风车：红(上) → 黄(右下) → 绿(左下)，中央圆角等腰三角形镂空 -->
    <g clip-path="url(#cube-clip)">
{wedge_xml}
    </g>
  </g>
</svg>
"""


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "packages/extension/assets/icon.svg"
    out.write_text(build_svg(), encoding="utf-8")
    print(f"written: {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
