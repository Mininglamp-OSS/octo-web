import React from 'react';
import { Dot } from '@octo/ui';
import './ClawHealthCheckItem.css';

export type HealthStatus = 'success' | 'warning' | 'error';

export interface ClawHealthCheckItemProps {
  /** 健康检查项状态：success(绿), warning(黄), error(红) */
  status: HealthStatus;
  /** 检查项标签 */
  label: string;
  /** 检查项数值 */
  value: string;
  /** 自定义样式类名 */
  className?: string;
  /** 测试标识 */
  'data-testid'?: string;
}

/**
 * 健康检查单项组件
 * 用于展示单个健康检查项的状态、标签和值
 */
const ClawHealthCheckItem: React.FC<ClawHealthCheckItemProps> = ({
  status,
  label,
  value,
  className = '',
  'data-testid': testId = 'claw-health-check-item',
}) => {
  const dotTone = status === 'error' ? 'danger' : status;

  return (
    <div
      className={`health-chip ${className}`}
      data-testid={testId}
    >
      <Dot
        tone={dotTone}
        data-testid={`${testId}-dot`}
      />
      <span
        className="hc-label"
        data-testid={`${testId}-label`}
      >
        {label}
      </span>
      <span
        className="hc-value"
        data-testid={`${testId}-value`}
      >
        {value}
      </span>
    </div>
  );
};

export default ClawHealthCheckItem;
