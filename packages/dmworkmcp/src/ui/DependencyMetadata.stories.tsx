import React from "react";
import DependencyMetadata from "./DependencyMetadata";

export default {
  title: "Marketplace/DependencyMetadata",
  component: DependencyMetadata,
};
export const Skill = () => (
  <DependencyMetadata
    authorLabel="作者"
    creatorName="林雨桐"
    summary="核查数据粒度、完整性、重复值与质量，给出可信度结论。"
  />
);
export const Bot = () => (
  <DependencyMetadata
    authorLabel="作者"
    creatorName="林雨桐"
    botName="数据助手"
    summary="查询业务指标。"
  />
);
export const Missing = () => (
  <DependencyMetadata
    authorLabel="作者"
    unknownAuthor="暂未提供"
    noSummary="暂无简介"
  />
);
