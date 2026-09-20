import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SelectionResult } from "./SelectionResult";
// 与侧栏同一套样式：主题变量、字体与 markdown 的样式都在这份里，结果层直接用，
// 不另起一套（结果层是独立文档，不会和页面的 CSS 互相污染）。
import "../sidepanel/styles.css";
// 结果层与侧栏的差异（滚动行为）单独一层，必须排在共享样式之后。
import "./result.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SelectionResult />
  </StrictMode>,
);
