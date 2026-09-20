import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<typeof import('../../__mocks__/dmworkBase')>('../../__mocks__/dmworkBase');
    return { ...actual };
});

import SelectedSourcesPanel from '../SelectedSourcesPanel';

describe('SelectedSourcesPanel', () => {
    it('shows one aggregate snapshot explanation without exposing source versions', () => {
        render(<SelectedSourcesPanel sources={[
            {
                source_type: 4,
                source_id: 'doc-1',
                source_name: '项目复盘',
                source_version: 'A6v+hvAJgQjBluHbCaAQq7eowQTFBQ==',
            },
            {
                source_type: 4,
                source_id: 'doc-2',
                source_name: '方案说明',
                source_version: 'another-version',
            },
        ]} />);

        expect(screen.getByText('项目复盘')).toBeInTheDocument();
        expect(screen.getByText('方案说明')).toBeInTheDocument();
        expect(screen.getAllByRole('note')).toHaveLength(1);
        expect(screen.getByRole('note')).toHaveTextContent('基于以上 2 份文档在总结生成时的内容，后续修改不会影响本总结。');
        expect(screen.queryByText('A6v+hvAJgQjBluHbCaAQq7eowQTFBQ==')).not.toBeInTheDocument();
        expect(screen.queryByText('another-version')).not.toBeInTheDocument();
    });
});
