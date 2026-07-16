import { getSessionSid } from "../Service/SessionScope";

export function getQueryParam(key: string) {
  const params = new URLSearchParams(window.location.search);
  return params.get(key); // 不存在返回 null
}

export function getSid() {
  return getSessionSid();
}
