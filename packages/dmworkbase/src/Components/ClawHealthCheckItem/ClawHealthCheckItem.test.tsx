import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ClawHealthCheckItem from './ClawHealthCheckItem';

describe('ClawHealthCheckItem', () => {
  it('renders with basic props', () => {
    render(
      <ClawHealthCheckItem
        status="success"
        label="OpenClaw 进程"
        value="正常"
      />
    );

    expect(screen.getByTestId('claw-health-check-item')).toBeInTheDocument();
    expect(screen.getByTestId('claw-health-check-item-label')).toHaveTextContent('OpenClaw 进程');
    expect(screen.getByTestId('claw-health-check-item-value')).toHaveTextContent('正常');
  });

  it('renders success status with green dot', () => {
    render(
      <ClawHealthCheckItem
        status="success"
        label="Gateway 连接"
        value="已连接"
      />
    );

    const dot = screen.getByTestId('claw-health-check-item-dot');
    expect(dot).toHaveClass('octo-ui-dot--success');
  });

  it('renders warning status with yellow dot', () => {
    render(
      <ClawHealthCheckItem
        status="warning"
        label="网络连接"
        value="472.76ms"
      />
    );

    const dot = screen.getByTestId('claw-health-check-item-dot');
    expect(dot).toHaveClass('octo-ui-dot--warning');
  });

  it('renders error status with red dot', () => {
    render(
      <ClawHealthCheckItem
        status="error"
        label="磁盘空间"
        value="不足 1GB"
      />
    );

    const dot = screen.getByTestId('claw-health-check-item-dot');
    expect(dot).toHaveClass('octo-ui-dot--danger');
  });

  it('accepts custom className', () => {
    render(
      <ClawHealthCheckItem
        status="success"
        label="测试"
        value="通过"
        className="custom-class"
      />
    );

    const item = screen.getByTestId('claw-health-check-item');
    expect(item).toHaveClass('health-chip');
    expect(item).toHaveClass('custom-class');
  });

  it('accepts custom data-testid', () => {
    render(
      <ClawHealthCheckItem
        status="success"
        label="测试"
        value="通过"
        data-testid="custom-health-item"
      />
    );

    expect(screen.getByTestId('custom-health-item')).toBeInTheDocument();
    expect(screen.getByTestId('custom-health-item-dot')).toBeInTheDocument();
    expect(screen.getByTestId('custom-health-item-label')).toBeInTheDocument();
    expect(screen.getByTestId('custom-health-item-value')).toBeInTheDocument();
  });

  it('renders all three status types correctly', () => {
    const { rerender } = render(
      <ClawHealthCheckItem status="success" label="Test" value="OK" />
    );
    expect(screen.getByTestId('claw-health-check-item-dot')).toHaveClass('octo-ui-dot--success');

    rerender(<ClawHealthCheckItem status="warning" label="Test" value="OK" />);
    expect(screen.getByTestId('claw-health-check-item-dot')).toHaveClass('octo-ui-dot--warning');

    rerender(<ClawHealthCheckItem status="error" label="Test" value="OK" />);
    expect(screen.getByTestId('claw-health-check-item-dot')).toHaveClass('octo-ui-dot--danger');
  });
});
