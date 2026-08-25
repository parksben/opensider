#!/usr/bin/env python3
"""生成 Cursor Sidebar 扩展图标 packages/extension/assets/icon.svg。

造型：Cursor 官方立方体轮廓（CUBE_2D 路径，nonzero 规则中央光标区域自动镂空透明），
内部填 Google 三色顺时针渐变风车：红(上) → 黄(右下) → 绿(左下)。
渐变用 360 个 1° 扇形逼近 conic gradient；交界为直线，两侧各 20° 平滑过渡。
"""

import math
from pathlib import Path

# Cursor CUBE_2D 官方复合路径：六边形外轮廓 + 中央光标镂空（内子路径反向缠绕）
CUBE_PATH = (
    "M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94"
    "c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11"
    "l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98"
    "c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01Z"
    "M444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21"
    "c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06"
    "h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z"
)

CX, CY = 233.37, 266.05  # 立方体中心（原始路径坐标系）
WEDGE_R = 600.0  # 扇形半径，需超出六边形最远顶点（约 266）

RED = (234, 67, 53)  # #EA4335
YELLOW = (251, 188, 5)  # #FBBC05
GREEN = (52, 168, 83)  # #34A853

# 角度约定：SVG 坐标系（y 向下），0°=正右，角度增大 = 顺时针
# 三色中心：红 270°(正上)、黄 30°(右下)、绿 150°(左下)，顺时针红→黄→绿
CENTERS = {270.0: RED, 30.0: YELLOW, 150.0: GREEN}
# 交界（相邻中心角平分线）：起点色 → 顺时针下一色
BOUNDARIES = [(330.0, RED, YELLOW), (90.0, YELLOW, GREEN), (210.0, GREEN, RED)]
TRANSITION = 40.0  # 交界渐变总宽度（度）


def smoothstep(x: float) -> float:
    return x * x * (3 - 2 * x)


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
      <path d="{CUBE_PATH}"/>
    </clipPath>
  </defs>

  <g transform="translate(45.48 16) scale(0.9021)">
    <!-- Google 三色顺时针渐变风车：红(上) → 黄(右下) → 绿(左下)，中央光标区域镂空透明 -->
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
