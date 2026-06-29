// cc install model picker — fetch the operator gateway's model list through the
// fleet proxy (POST /v1/runtimes/llm-models). Going through fleet avoids browser
// CORS to the gateway and reuses the session/space auth the apiClient injects.
import WKApp from '../../App';
import { fleetApiBase } from './botsApi';

/**
 * Ask fleet to list the models the given gateway exposes. Returns the model ids,
 * or [] when the gateway/key is rejected or returns nothing — the modal falls
 * back to manual entry, so this never throws to the caller's UI path.
 */
export async function fetchLlmModels(gatewayUrl: string, apiKey: string): Promise<string[]> {
  const res = await WKApp.apiClient.post(
    '/runtimes/llm-models',
    { gateway_url: gatewayUrl, api_key: apiKey },
    { baseURL: fleetApiBase() },
  );
  const models = (res as { data?: { models?: unknown } })?.data?.models;
  return Array.isArray(models) ? (models as string[]) : [];
}
