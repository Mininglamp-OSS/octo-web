import React from "react";
import MatterList from "../ui/MatterList";

/**
 * MatterPage — 事项全屏页面（NavRail "事项" 入口）。
 *
 * 已统一到 ui/MatterList（mode="page"）。本文件保留为薄封装，
 * 维持路由注册（WKApp.route.register("/matter", ...)）不变。
 */

export default function MatterPage() {
  return <MatterList mode="page" />;
}
