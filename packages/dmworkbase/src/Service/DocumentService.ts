import APIClient from "./APIClient";

export interface DocumentResponse {
  doc_type: string;
  title: string;
  content: string;
  version: string;
  updated_at: string;
}

export async function getDocument(docType: string): Promise<DocumentResponse> {
  return APIClient.shared.get<DocumentResponse>(`/voice/document/${docType}`);
}
