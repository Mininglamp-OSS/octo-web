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
    it('shows the generation snapshot label without exposing the document source_version', () => {
        render(<SelectedSourcesPanel sources={[{
            source_type: 4,
            source_id: 'doc-1',
            source_name: '项目复盘',
            source_version: 'A6v+hvAJgQjBluHbCaAQq7eowQTFBQ==',
        }]} />);

        expect(screen.getByText('项目复盘')).toBeInTheDocument();
        expect(screen.getByText('生成时快照')).toBeInTheDocument();
        expect(screen.queryByText('A6v+hvAJgQjBluHbCaAQq7eowQTFBQ==')).not.toBeInTheDocument();
    });
});
