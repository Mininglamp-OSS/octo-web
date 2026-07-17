/**
 * Integration tests for summaryApi with MSW.
 * These tests do NOT mock axios or summaryApi - they go through the real HTTP stack
 * and are intercepted by MSW handlers.
 */
import { describe, it, expect } from 'vitest';
import * as summaryApi from '../summaryApi';

describe('summaryApi integration (MSW)', () => {
    it('should create a summary task', async () => {
        const result = await summaryApi.createSummary({
            topic: '测试总结',
            sources: [{ source_type: 1, source_id: 'group-123' }],
            time_range: { start: '2026-07-05T00:00:00Z', end: '2026-07-06T00:00:00Z' },
        });
        expect(result).toHaveProperty('task_id');
        expect(typeof result.task_id).toBe('number');
    });

    it('should list summaries with pagination', async () => {
        const result = await summaryApi.listSummaries({ page: 1, page_size: 10 });
        expect(result).toHaveProperty('items');
        expect(result).toHaveProperty('total');
        expect(Array.isArray(result.items)).toBe(true);
    });

    it('should get summary detail by task_id', async () => {
        // First create a task
        const createResult = await summaryApi.createSummary({
            topic: '获取详情测试',
            sources: [],
        });
        
        // Then fetch it
        const detail = await summaryApi.getSummaryDetail(createResult.task_id);
        expect(detail).toHaveProperty('task_id', createResult.task_id);
        expect(detail).toHaveProperty('title');
    });

    it('should return 404 for non-existent task', async () => {
        await expect(summaryApi.getSummaryDetail(999999)).rejects.toThrow();
    });

    it('should delete a summary task', async () => {
        const createResult = await summaryApi.createSummary({
            topic: '删除测试',
            sources: [],
        });
        
        await expect(summaryApi.deleteSummary(createResult.task_id)).resolves.not.toThrow();
    });

    it('should get templates', async () => {
        const result = await summaryApi.getTemplates();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
        expect(result[0]).toHaveProperty('template_id');
        expect(result[0]).toHaveProperty('name');
    });

    it('should infer scope from topic', async () => {
        const result = await summaryApi.inferScope('团队周报');
        expect(result).toHaveProperty('suggested_mode', 2);
        
        const result2 = await summaryApi.inferScope('个人总结');
        expect(result2).toHaveProperty('suggested_mode', 1);
    });

    it('should get chat candidates', async () => {
        const result = await summaryApi.getChatCandidates();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
    });

    it('should filter chat candidates by keyword', async () => {
        const result = await summaryApi.getChatCandidates({ keyword: '项目' });
        // Mock data has "项目组" which includes "项目"
        expect(result.length).toBe(1);
        expect(result[0].name).toBe('项目组');
    });

    it('should get member candidates', async () => {
        const result = await summaryApi.getMemberCandidates();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
    });

    it('should create and manage schedules', async () => {
        // Create schedule
        const schedule = await summaryApi.createSchedule({
            title: '每周总结',
            summary_mode: 1,
            cron_expr: '0 9 * * 1',
            sources: [],
            participants: [],
            time_range_type: 1,
        });
        
        expect(schedule).toHaveProperty('schedule_id');
        expect(schedule).toHaveProperty('is_active', true);
        
        // List schedules
        const schedules = await summaryApi.listSchedules();
        expect(Array.isArray(schedules)).toBe(true);
        
        // Get schedule
        const detail = await summaryApi.getSchedule(schedule.schedule_id);
        expect(detail).toHaveProperty('schedule_id', schedule.schedule_id);
        
        // Toggle schedule
        const toggled = await summaryApi.toggleSchedule(schedule.schedule_id, false);
        expect(toggled).toHaveProperty('is_active', false);
        
        // Delete schedule
        await expect(summaryApi.deleteSchedule(schedule.schedule_id)).resolves.not.toThrow();
    });

    it('should handle agent summary creation', async () => {
        const result = await summaryApi.createAgentSummary({
            session_id: 'test-session-123',
            origin_channel_id: 'group-123',
            origin_channel_type: 1,
            sources: [],
        });
        expect(result).toHaveProperty('task_id');
        expect(typeof result.task_id).toBe('number');
    });
});
