export type PageInput = { page: number; text: string };
export type DocumentInput = {
  filename: string;
  title: string;
  version: string;
  byteSize: number;
  pages: PageInput[];
};
export type Chunk = {
  id: string;
  documentId: string;
  documentName: string;
  version: string;
  page: number;
  section: string;
  text: string;
};
export type SearchHit = Chunk & { score: number };
export type DocumentSummary = {
  id: string;
  title: string;
  version: string;
  filename: string;
  byteSize: number;
  pageCount: number;
  chunkCount: number;
  createdAt: string;
};
