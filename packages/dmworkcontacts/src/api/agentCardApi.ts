/**
 * Agent Card API 服务
 * 
 * 对接 agent-card-server HTTP 接口
 * 统一使用 APIClient（与 AgentCardService 保持一致）
 */

import { WKApp } from '@octo/base';
import type {
  AgentCardResponse,
  FileContentResponse,
  ApiErrorResponse,
  AgentCardData,
  FileContentData,
} from './types';
import { getMockAgentCard, mockFileContents } from './mockData';

/**
 * Extract server error message from axios error response
 */
function extractErrorMessage(err: unknown): string {
  const msg = (err as any)?.response?.data?.message;
  const raw = msg || (err instanceof Error ? err.message : 'Request failed');
  return raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
}

/**
 * Mock 模式开关（环境变量控制）
 */
const USE_MOCK = import.meta.env.VITE_AGENT_CARD_MOCK === 'true';

/**
 * GET /api/v1/agent-cards/:bot_id — 获取 Agent Card
 * 
 * @param botId - Bot 唯一标识
 * @returns Agent Card 数据
 * @throws Error 当请求失败或无权访问时
 */
export async function getAgentCard(botId: string): Promise<AgentCardData> {
  // Mock 模式
  if (USE_MOCK) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const mock = getMockAgentCard(botId);
        if (mock.status === 200 && mock.data) {
          resolve(mock.data);
        } else if (mock.error) {
          reject(new Error(mock.error.message));
        } else {
          reject(new Error('Unknown error'));
        }
      }, 300); // 模拟网络延迟
    });
  }

  // 真实 API 调用（统一使用 APIClient）
  try {
    const resp = await WKApp.apiClient.get<AgentCardResponse>(
      `/agent-cards/${botId}`,
    );
    if (resp.data.code === 0) {
      return resp.data.data;
    } else {
      throw new Error(resp.data.message || 'Failed to fetch agent card');
    }
  } catch (err: unknown) {
    throw new Error(extractErrorMessage(err));
  }
}

/**
 * GET /api/v1/agent-cards/:bot_id/files/*file_name — 获取文件内容
 * 
 * @param botId - Bot 唯一标识
 * @param fileName - 文件路径（如 "AGENTS.md" 或 "memory/2026-05-07.md"）
 * @returns 文件内容数据
 * @throws Error 当请求失败或文件不存在时
 */
export async function getAgentCardFile(
  botId: string,
  fileName: string,
): Promise<FileContentData> {
  // Mock 模式
  if (USE_MOCK) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const mock = getMockAgentCard(botId);
        
        // 检查权限
        if (mock.status === 403) {
          reject(new Error('permission denied'));
          return;
        }
        if (mock.status === 404) {
          reject(new Error('agent not found'));
          return;
        }

        // 检查文件是否存在
        const content = mockFileContents[fileName];
        if (!content) {
          reject(new Error('file not found'));
          return;
        }

        // 返回文件内容
        resolve({
          bot_id: botId,
          file_name: fileName,
          content_type: 'text/markdown',
          file_size: content.length,
          content: content,
          last_synced_at: new Date().toISOString(),
        });
      }, 200);
    });
  }

  // 真实 API 调用（统一使用 APIClient）
  try {
    const resp = await WKApp.apiClient.get<FileContentResponse>(
      `/agent-cards/${botId}/files/${fileName}`,
    );
    if (resp.data.code === 0) {
      return resp.data.data;
    } else {
      throw new Error(resp.data.message || 'Failed to fetch file content');
    }
  } catch (err: unknown) {
    throw new Error(extractErrorMessage(err));
  }
}
