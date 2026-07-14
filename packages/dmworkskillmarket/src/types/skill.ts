export type Visibility = "public" | "space" | "private";

export interface Category {
  id: string;
  name: string;
  iconKey: string;
  sortOrder: number;
  skillCount: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  tags: string[];
  ownerId: string;
  ownerName: string;
  spaceId: string;
  visibility: Visibility;
  version: string;
  readmeContent: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillListQuery {
  q?: string;
  categoryId?: string;
  cursor?: string;
  limit?: number;
  mine?: boolean;
}

export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface NewSkillForm {
  name: string;
  description: string;
  categoryId: string;
  tags: string[];
  visibility: Visibility;
  readmeContent: string;
  fileName: string;
  fileSize: number;
}

export type UpdateSkillForm = Partial<NewSkillForm>;
