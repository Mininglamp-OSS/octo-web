// RED tests for PR #1593 P1-2 / P1-3 (yujiawei review 5087124100):
// the decoder demanded an EXPLICIT null and hard-failed on an omitted key.
// Go backends default to omitempty for pointer fields, so a turn whose
// pending_proposal / workflow / current_preview keys are ABSENT (not null)
// routed undefined into decodeProposal(undefined) etc. -> requireRecord
// throws -> the ENTIRE turn was rejected as a protocol error. Same
// asymmetry in the envelope: getSummaryWorkspaceHistory (allowNullData)
// threw "no data" when the backend omitted `data` instead of null.
//
// Expected at this head (pre-fix): these tests FAIL with protocol-error text.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adaptSummaryWorkspaceTurn } from '../adapter';

// A minimal valid turn payload with every optional pointer key OMITTED
// (the shape a Go omitempty backend actually emits) instead of explicit null.
function turnWithOmittedPointers(resultType: string, extra?: Record<string, unknown>) {
  return {
    contract_version: 1,
    session_id: 'session-omit',
    request_id: 'req-omit',
    message_id: 11,
    scope_version: 1,
    result_type: resultType,
    reply: '正文',
    state: {
      scope_version: 1,
      summary_context: {
        selected_channels: [],
        participants: [],
        referenced_task_ids: [],
        // template / time_range omitted entirely
      },
      // current_preview / pending_proposal / workflow omitted entirely
    },
    // top-level current_preview / pending_proposal / workflow omitted
    ...extra,
  };
}

describe('adapter — omitted optional pointer keys are tolerated (P1-2)', () => {
  it('decodes an explanation turn whose pointer keys are ABSENT, not null', () => {
    const turn = adaptSummaryWorkspaceTurn(turnWithOmittedPointers('explanation'));
    expect(turn.resultType).toBe('explanation');
    expect(turn.reply).toBe('正文');
  });

  it('decodes a clarification turn whose pointer keys are ABSENT, not null', () => {
    const turn = adaptSummaryWorkspaceTurn(turnWithOmittedPointers('clarification'));
    expect(turn.resultType).toBe('clarification');
  });

  it('decodes a workflow_started turn with workflow PRESENT but current_preview/pending_proposal ABSENT', () => {
    const turn = adaptSummaryWorkspaceTurn(
      turnWithOmittedPointers('workflow_started', {
        workflow: { task_id: 42, status: 'processing', saved: false, scope: 'personal' },
      }),
    );
    expect(turn.resultType).toBe('workflow_started');
  });
});

// P1-3 test moved to src/api/__tests__/summaryApi.omittedData.test.ts —
// the import resolution from this directory differs; see that file.

// Local axios mock declaration so the adapter tests stay transport-free.
vi.mock('axios', () => ({
  default: { get: vi.fn(), isCancel: () => false },
}));
